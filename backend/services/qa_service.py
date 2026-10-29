"""Curated Q&A index (#39): a separate collection, searched with the raw message.

A pair is not a `KbDocument`. It is embedded alone and searched on its own index,
so a near-miss is never diluted by the rest of the site's chunks, and a hit can be
injected above the ordinary `[来源N]` passages with "prefer this answer".

Everything vector-shaped goes through `QdrantKbService` — there is no second
Qdrant client in the codebase on purpose.
"""

import hashlib
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

import database
from models import KnowledgeBase, QaItem, WorkspaceQuota
from services.document_parser import DocumentParser
from services.kb_document_processor import get_embedding_api_key
from services.qdrant_service import QdrantKbService

logger = logging.getLogger(__name__)

# A curated pair only earns a prompt slot when it is a real match; 0.75 is the
# product default (a near-miss would outrank every ordinary chunk otherwise).
QA_SIMILARITY_THRESHOLD = 0.75
QA_SEARCH_LIMIT = 3

def qa_embedding_hash(text: str) -> str:
    """sha256 of the text actually sent to the provider (used to skip re-embedding)."""
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()

async def embed_qa_texts(
    kb: KnowledgeBase | None, texts: list[str]
) -> list[list[float]]:
    """Embed *texts* with the KB's own model/base URL/key.

    Thin wrapper over `DocumentParser.embed_texts` so the Q&A index can never
    drift onto a different provider than the KB that owns it.
    """
    if not kb or not texts:
        return []
    api_key = get_embedding_api_key(kb)
    return await DocumentParser().embed_texts(
        texts, kb.embedding_model, kb.embedding_base_url, api_key=api_key
    )

def _qa_payload(item: QaItem) -> dict[str, Any]:
    return {
        "qa_id": item.id,
        "kb_id": item.kb_id,
        "question": item.question,
        "answer": item.answer,
    }

class QaService:
    def __init__(self):
        self.qdrant = QdrantKbService()

    async def _load_kb(self, db: AsyncSession, kb_id: str) -> KnowledgeBase | None:
        return await db.scalar(select(KnowledgeBase).where(KnowledgeBase.id == kb_id))

    async def sync_item(self, item: QaItem, db: AsyncSession) -> None:
        """Embed the question and upsert ONE point in ``qa_<hex>``.

        `enabled=False` deletes the point instead. The embedding call is skipped
        while `embedding_hash` still matches the question, so an answer-only edit
        costs no provider round trip.
        """
        kb = await self._load_kb(db, item.kb_id)
        if not kb:
            logger.warning("Q&A sync skipped: KB %s not found", item.kb_id)
            return

        if not item.enabled:
            await self.qdrant.delete_qa_point(item.kb_id, item.id)
            return

        new_hash = qa_embedding_hash(item.question)
        if item.embedding_hash == new_hash and item.embedding_hash is not None:
            # The vector is already in Qdrant; only the payload can have changed.
            if await self.qdrant.set_qa_payload(
                item.kb_id, item.id, _qa_payload(item)
            ):
                return
            # Point/collection missing (e.g. KB reset) — fall through and rebuild.

        vectors = await embed_qa_texts(kb, [item.question])
        if not vectors:
            logger.warning(
                "Q&A sync skipped: embedding returned nothing for pair %s", item.id
            )
            return

        dimension = int(
            getattr(kb, "embedding_dimension", None) or len(vectors[0])
        )
        await self.qdrant.ensure_qa_collection(item.kb_id, dimension)
        await self.qdrant.upsert_qa_point(
            item.kb_id, item.id, vectors[0], _qa_payload(item)
        )
        item.embedding_hash = new_hash

    async def delete_item(self, item: QaItem, db: AsyncSession) -> None:
        """Remove one pair's point. Never raises into the caller's transaction."""
        await self.qdrant.delete_qa_point(item.kb_id, item.id)

    async def search(
        self,
        kb_id: str,
        query: str,
        threshold: float = QA_SIMILARITY_THRESHOLD,
        limit: int = QA_SEARCH_LIMIT,
    ) -> list[dict[str, Any]]:
        """Search one KB's curated index with the visitor's raw phrasing.

        Returns ``[{"qa_id", "question", "answer", "score"}]`` above *threshold*.
        An embedding/search failure is logged and reported as "no hits" — the chat
        path must never fail because the Q&A index is unreachable.
        """
        if not kb_id or not (query or "").strip():
            return []

        try:
            async with database.AsyncSessionLocal() as session:
                kb = await self._load_kb(session, kb_id)
                if not kb:
                    return []
            vectors = await embed_qa_texts(kb, [query])
            if not vectors:
                return []
            hits = await self.qdrant.search_qa(kb_id, vectors[0], top_k=limit)
        except Exception as error:  # embedding provider, Qdrant, or DB down
            logger.warning("Q&A search failed for kb=%s: %s", kb_id, error)
            return []

        results: list[dict[str, Any]] = []
        for hit in hits:
            score = float(hit.get("score") or 0.0)
            if score < threshold:
                continue
            payload = hit.get("payload") or {}
            results.append(
                {
                    "qa_id": payload.get("qa_id") or hit.get("id"),
                    "question": payload.get("question", ""),
                    "answer": payload.get("answer", ""),
                    "score": round(score, 4),
                }
            )
        return results[:limit]

    async def record_hit(self, qa_id: str, db: AsyncSession) -> None:
        """Count one served pair: ``hits += 1`` and stamp ``last_hit_at``."""
        item = await db.get(QaItem, qa_id)
        if not item:
            return
        item.hits = (item.hits or 0) + 1
        item.last_hit_at = datetime.now(timezone.utc)
        await db.commit()

    async def max_items_reached(self, workspace_id: int, db: AsyncSession) -> bool:
        """True when the workspace's real `qa_items` count reached its quota.

        `WorkspaceQuota.max_qa_items` used to be read as a *file* cap; it now
        counts curated pairs, computed from the rows rather than a counter column
        that a background job would have to keep in sync.
        """
        quota = await db.scalar(
            select(WorkspaceQuota).where(
                WorkspaceQuota.workspace_id == workspace_id
            )
        )
        if not quota or quota.max_qa_items is None:
            return False
        used = await db.scalar(
            select(func.count(QaItem.id)).join(
                KnowledgeBase, KnowledgeBase.id == QaItem.kb_id
            ).where(KnowledgeBase.workspace_id == workspace_id)
        )
        return (used or 0) >= int(quota.max_qa_items)
