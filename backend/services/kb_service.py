"""KnowledgeBase service. 所有查询强制 tenant_id 过滤。"""

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal
from models import KnowledgeBase
from services.qdrant_service import QdrantKbService, get_kb_collection_name

logger = logging.getLogger(__name__)


class KbService:
    def __init__(self, session: AsyncSession | None = None):
        self.session = session
        self.qdrant = QdrantKbService()

    async def _get_session(self) -> AsyncSession:
        if self.session:
            return self.session
        return AsyncSessionLocal()

    async def create_knowledge_base(
        self, tenant_id: str, name: str, embedding_model: str = "BAAI/bge-m3", **kwargs
    ) -> KnowledgeBase:
        if not tenant_id:
            raise ValueError("tenant_id is required for all KB operations")

        async with await self._get_session() as session:
            kb = KnowledgeBase(
                tenant_id=tenant_id,
                name=name,
                embedding_model=embedding_model,
                qdrant_collection="",  # will set after
                **kwargs,
            )
            session.add(kb)
            await session.flush()  # get id

            # set collection name using kb.id
            # SQLAlchemy Column assignment is a false positive for pyright
            kb_id_str = str(kb.id)
            object.__setattr__(
                kb, "qdrant_collection", get_kb_collection_name(kb_id_str)
            )

            # ensure Qdrant (幂等)
            await self.qdrant.ensure_collection(kb_id_str, embedding_model)

            await session.commit()
            await session.refresh(kb)
            return kb

    async def list_knowledge_bases(self, tenant_id: str | None) -> list[KnowledgeBase]:
        if not tenant_id:
            raise ValueError("tenant_id is required")
        async with await self._get_session() as session:
            stmt = select(KnowledgeBase).where(KnowledgeBase.tenant_id == tenant_id)
            result = await session.execute(stmt)
            return list(result.scalars().all())

    async def get_knowledge_base(
        self, tenant_id: str, kb_id: str
    ) -> KnowledgeBase | None:
        if not tenant_id:
            raise ValueError("tenant_id is required")
        async with await self._get_session() as session:
            stmt = select(KnowledgeBase).where(
                KnowledgeBase.id == kb_id,
                KnowledgeBase.tenant_id == tenant_id,
            )
            result = await session.execute(stmt)
            return result.scalar_one_or_none()

    async def get_kb_config(self, tenant_id: str, kb_id: str) -> dict:
        """Return KB embedding configuration (read-only)."""
        kb = await self.get_knowledge_base(tenant_id, kb_id)
        if not kb:
            raise ValueError("KB not found")
        return {
            "id": kb.id,
            "name": kb.name,
            "embedding_model": kb.embedding_model,
            "embedding_base_url": kb.embedding_base_url,
            "vector_backend": kb.vector_backend,
            "chunk_size": kb.chunk_size,
            "chunk_overlap": kb.chunk_overlap,
            "is_locked": kb.is_locked,
            "status": kb.status,
        }

    async def update_kb_config(
        self, tenant_id: str, kb_id: str, updates: dict
    ) -> KnowledgeBase:
        """Update KB config. Embedding fields blocked when is_locked=True."""
        if not tenant_id:
            raise ValueError("tenant_id is required")
        async with await self._get_session() as session:
            stmt = (
                select(KnowledgeBase)
                .where(
                    KnowledgeBase.id == kb_id,
                    KnowledgeBase.tenant_id == tenant_id,
                )
                .with_for_update()
            )
            res = await session.execute(stmt)
            kb = res.scalar_one_or_none()
            if not kb:
                raise ValueError("KB not found")
            kb_status = str(getattr(kb, "status", "active"))
            if kb_status == "resetting":
                from fastapi import HTTPException
                raise HTTPException(423, "KB is resetting, config changes locked")
            # embedding fields: only allowed when not locked
            embedding_fields = {"embedding_model", "embedding_base_url"}
            kb_is_locked = bool(getattr(kb, "is_locked", False))
            for f in embedding_fields:
                if f in updates and kb_is_locked:
                    from fastapi import HTTPException
                    raise HTTPException(
                        409,
                        "Embedding config locked (has chunks). Use reset first.",
                    )
            for k, v in updates.items():
                if hasattr(kb, k) and k not in {"id", "tenant_id", "created_at"}:
                    object.__setattr__(kb, k, v)
            await session.commit()
            await session.refresh(kb)
            return kb
