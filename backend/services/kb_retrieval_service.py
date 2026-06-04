"""KB retrieval service: validate agent/kb/tenant, embed query, Qdrant search + threshold filter."""

import logging
from typing import Any

from sqlalchemy import select

from database import AsyncSessionLocal
from models import Agent, KnowledgeBase
from services.document_parser import DocumentParser
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
        tenant_id: str | None,
        agent_id: str,
        query: str,
        top_k: int = 5,
        threshold: float | None = None,
    ) -> list[dict[str, Any]]:
        """Retrieve top-K chunks from agent's bound KB with double isolation.

        If tenant_id is None (chat path), the effective tenant for the Qdrant
        payload filter is derived from the agent's KB (ensuring isolation is still
        enforced by the specific KB's tenant_id).

        Returns: [{"text":, "doc_id":, "chunk_index":, "score":, "filename":?}, ...]
        Returns [] if agent has no kb_id bound or validation fails.
        """
        if not agent_id:
            return []

        async with AsyncSessionLocal() as session:
            # 1. Validate agent exists and get kb_id (outer join so agent without kb still found)
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

            # 2. Derive effective tenant and enforce match
            # When tenant_id is None (chat path), derive from KB to allow retrieval
            # When tenant_id is explicit, it must match KB's tenant
            effective_tenant = tenant_id or kb.tenant_id
            if tenant_id is not None and kb.tenant_id != tenant_id:
                logger.warning(
                    f"Tenant mismatch: requested {tenant_id} but KB {kb.id} belongs to {kb.tenant_id}"
                )
                return []

            # 3. Embed query (single item, reuse existing parser)
            try:
                embeddings = await self.parser.embed_texts(
                    [query], kb.embedding_model, kb.embedding_base_url
                )
                if not embeddings:
                    return []
                query_vec = embeddings[0]
            except Exception as e:
                logger.warning(f"Query embed failed: {e}")
                return []

            # 4. Search with double isolation (collection + payload filter)
            # Use effective_tenant (derived from KB when tenant_id is None)
            raw_hits = await self.qdrant.search_kb(
                kb_id=kb.id,
                tenant_id=effective_tenant,
                query_vector=query_vec,
                top_k=top_k * 2,  # fetch extra for threshold filtering
            )

            # 5. Post-filter by threshold and cap at top_k
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
                    }
                )
                if len(results) >= top_k:
                    break

            logger.info(
                f"KB retrieve tenant={tenant_id} agent={agent_id} kb={kb.id} "
                f"got {len(results)} chunks (threshold={eff_threshold})"
            )
            return results
