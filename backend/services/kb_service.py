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
