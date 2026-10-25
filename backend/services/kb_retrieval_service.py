"""KB retrieval service: resolve agent → KB, embed the query with the KB's own
embedding config, search the KB's collection, threshold-filter.

No tenant parameter: a KB is scoped to a workspace and lives in its own Qdrant
collection, so physical isolation replaces the old payload-level tenant filter.
"""

import logging
from typing import Any

from sqlalchemy import select

import database
from models import Agent, KnowledgeBase
from services.document_parser import DocumentParser
from services.kb_document_processor import get_embedding_api_key
from services.kb_service import KbService
from services.qdrant_service import QdrantKbService

logger = logging.getLogger(__name__)

class KbRetrievalService:
    def __init__(self):
        self.parser = DocumentParser()
        self.qdrant = QdrantKbService()
        self.kb_svc = KbService()
        self.default_threshold = 0.6  # Fallback default, but agent threshold is preferred

    async def retrieve(
        self,
        agent_id: str,
        query: str,
        top_k: int = 5,
        threshold: float | None = None,
    ) -> list[dict[str, Any]]:
        """Retrieve top-K chunks from the KB bound to *agent_id*.

        Returns: [{"text":, "doc_id":, "chunk_index":, "score":, "filename":?}, ...]
        Returns [] if the agent has no kb_id bound or validation fails.
        """
        if not agent_id:
            return []

        async with database.AsyncSessionLocal() as session:
            # 1. Resolve the agent and its bound KB (outer join: unbound agents still load)
            stmt = (
                select(Agent, KnowledgeBase)
                .join(KnowledgeBase, Agent.kb_id == KnowledgeBase.id, isouter=True)
                .where(Agent.id == agent_id)
            )
            res = await session.execute(stmt)
            row = res.first()
            if not row or not row[0]:
                logger.info(f"Agent {agent_id} not found")
                return []
            agent, kb = row[0], row[1]

            if not agent.kb_id or not kb:
                logger.info(
                    f"Agent {agent_id} has no kb_id bound, returning empty retrieval"
                )
                return []

            # 2. Embed the query with the KB's own provider config and key
            api_key = get_embedding_api_key(kb)

            try:
                embeddings = await self.parser.embed_texts(
                    [query], kb.embedding_model, kb.embedding_base_url, api_key=api_key
                )
                if not embeddings:
                    return []
                query_vec = embeddings[0]
            except Exception as e:
                logger.warning(f"Query embed failed: {e}")
                return []

            # 3. Search this KB's collection (physical isolation, kb_id payload filter)
            raw_hits = await self.qdrant.search_kb(
                kb_id=kb.id,
                query_vector=query_vec,
                top_k=top_k * 2,  # fetch extra for threshold filtering
            )

            # 4. Post-filter by threshold and cap at top_k
            # Use explicit threshold > agent config > service default
            agent_threshold = getattr(agent, "similarity_threshold", None)
            if threshold is not None:
                eff_threshold = threshold
            elif agent_threshold is not None:
                eff_threshold = agent_threshold
            else:
                eff_threshold = self.default_threshold

            results = []
            for h in raw_hits:
                p = h.get("payload", {})
                score = h.get("score", 0.0)
                if score < eff_threshold:
                    continue
                results.append(
                    {
                        "text": p.get("text", ""),
                        "doc_id": p.get("doc_id", ""),
                        "chunk_index": p.get("chunk_index", 0),
                        "score": round(score, 4),
                        "filename": p.get("filename"),
                        # Include source info for proper display
                        "source_type": p.get("source_type", "file"),
                        "source_url": p.get("source_url", ""),
                        "source_title": p.get("source_title", ""),
                    }
                )
                if len(results) >= top_k:
                    break

            logger.info(
                f"KB retrieve agent={agent_id} kb={kb.id} "
                f"got {len(results)} chunks (threshold={eff_threshold})"
            )
            return results
