"""KnowledgeBase service. 所有查询强制 tenant_id 过滤。"""

import logging
from pathlib import Path

from sqlalchemy import delete as sa_delete, func, select, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal
from models import Agent, KnowledgeBase, KbChunk, KbDocument, Tenant
from services.qdrant_service import QdrantKbService, get_kb_collection_name
from services.task_lock import TaskType, task_lock

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

    async def get_kb_detail(self, tenant_id: str, kb_id: str) -> dict:
        """Return KB config plus document/chunk counts."""
        kb = await self.get_knowledge_base(tenant_id, kb_id)
        if not kb:
            raise ValueError("KB not found")
        async with await self._get_session() as session:
            doc_count = await session.scalar(
                select(func.count()).where(
                    KbDocument.kb_id == kb_id,
                    KbDocument.tenant_id == tenant_id,
                )
            )
            ready_count = await session.scalar(
                select(func.count()).where(
                    KbDocument.kb_id == kb_id,
                    KbDocument.tenant_id == tenant_id,
                    KbDocument.status == "ready",
                )
            )
            chunk_count = await session.scalar(
                select(func.count()).where(
                    KbChunk.kb_id == kb_id,
                    KbChunk.tenant_id == tenant_id,
                )
            )
        return {
            **(await self.get_kb_config(tenant_id, kb_id)),
            "document_count": doc_count or 0,
            "ready_document_count": ready_count or 0,
            "total_chunks": chunk_count or 0,
        }

    async def delete_knowledge_base(self, tenant_id: str, kb_id: str) -> None:
        """Delete KB after checking no agents reference it."""
        if not tenant_id:
            raise ValueError("tenant_id is required")
        async with await self._get_session() as session:
            # Check agent references
            from models import Agent

            agent_ref = await session.scalar(
                select(Agent.id).where(Agent.kb_id == kb_id).limit(1)
            )
            if agent_ref:
                from fastapi import HTTPException

                raise HTTPException(400, "KB referenced by agent(s). Unbind first.")
            kb = await session.get(KnowledgeBase, kb_id)
            if not kb:
                return
            # Delete Qdrant
            await self.qdrant.delete_collection(kb_id)
            # Delete chunks + docs
            await session.execute(
                sa_delete(KbChunk).where(
                    KbChunk.kb_id == kb_id, KbChunk.tenant_id == tenant_id
                )
            )
            await session.execute(
                sa_delete(KbDocument).where(
                    KbDocument.kb_id == kb_id, KbDocument.tenant_id == tenant_id
                )
            )
            # Physical files
            import shutil

            upload_dir = Path("/app/data/kb_uploads") / tenant_id / kb_id
            if upload_dir.exists():
                shutil.rmtree(upload_dir, ignore_errors=True)
            # Delete KB
            await session.delete(kb)
            await session.commit()

    async def reset_knowledge_base(
        self,
        tenant_id: str,
        kb_id: str,
        new_model: str,
        new_base_url: str | None,
    ) -> dict:
        """Atomic reset: clear Qdrant, recreate, reset docs, trigger reindex.

        Returns dict with status info for the caller to trigger reindex.
        """
        if not tenant_id:
            raise ValueError("tenant_id is required")

        # Row lock + status check
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
            if str(getattr(kb, "status", "active")) == "resetting":
                from fastapi import HTTPException

                raise HTTPException(423, "Reset already in progress")
            # Mark as resetting
            object.__setattr__(kb, "status", "resetting")
            object.__setattr__(kb, "error_message", None)
            await session.commit()

        # Acquire distributed lock
        task_id = f"reset_{kb_id}"
        acquired, err = await task_lock.acquire_task(kb_id, TaskType.KB_RESET, task_id)
        if not acquired:
            from fastapi import HTTPException

            # Rollback status
            async with await self._get_session() as session:
                kb = await session.get(KnowledgeBase, kb_id)
                if kb:
                    object.__setattr__(kb, "status", "error")
                    object.__setattr__(kb, "error_message", f"Lock failed: {err}")
                await session.commit()
            raise HTTPException(423, f"Reset lock failed: {err}")

        try:
            # 1. Delete Qdrant collection (idempotent)
            await self.qdrant.delete_collection(kb_id)

            # 2. Recreate with new model
            await self.qdrant.ensure_collection(kb_id, new_model)

            # 3. Clear chunks, reset docs, update KB config
            async with await self._get_session() as session:
                await session.execute(
                    sa_delete(KbChunk).where(
                        KbChunk.kb_id == kb_id, KbChunk.tenant_id == tenant_id
                    )
                )
                await session.execute(
                    sa_update(KbDocument)
                    .where(
                        KbDocument.kb_id == kb_id,
                        KbDocument.tenant_id == tenant_id,
                    )
                    .values(status="pending", chunk_count=0, error_message=None)
                )
                kb = await session.get(KnowledgeBase, kb_id)
                if kb:
                    object.__setattr__(kb, "embedding_model", new_model)
                    object.__setattr__(kb, "embedding_base_url", new_base_url)
                    object.__setattr__(kb, "is_locked", False)
                    object.__setattr__(kb, "status", "active")
                await session.commit()

            # 4. Get doc IDs for reindex
            async with await self._get_session() as session:
                docs = await session.execute(
                    select(KbDocument.id).where(
                        KbDocument.kb_id == kb_id,
                        KbDocument.tenant_id == tenant_id,
                    )
                )
                doc_ids = [row[0] for row in docs.all()]

            return {
                "status": "active",
                "doc_ids": doc_ids,
                "tenant_id": tenant_id,
                "kb_id": kb_id,
            }

        except Exception as e:
            # Failure: set error, unlock
            async with await self._get_session() as session:
                kb = await session.get(KnowledgeBase, kb_id)
                if kb:
                    object.__setattr__(kb, "status", "error")
                    object.__setattr__(kb, "error_message", str(e)[:500])
                    object.__setattr__(kb, "is_locked", False)
                await session.commit()
            raise
        finally:
            await task_lock.release_task(kb_id, task_id)

    async def get_or_create_agent_kb(
        self, agent_id: str, session: AsyncSession | None = None
    ) -> tuple[Tenant, KnowledgeBase]:
        """Get or create a tenant-scoped KnowledgeBase for an agent.

        If the agent already has a kb_id bound, return the existing KB and its tenant.
        Otherwise, create a new tenant, create a new KB bound to that tenant,
        bind it to the agent, and set kb_setup_completed=True.

        Args:
            agent_id: The agent ID to bind
            session: Optional existing session to use (for endpoint integration).
                    If not provided, creates a new session.

        Returns:
            Tuple of (tenant, knowledge_base)
        """
        if not agent_id:
            raise ValueError("agent_id is required")

        # Use provided session or get new one
        if session is not None:
            return await self._get_or_create_agent_kb_with_session(agent_id, session)

        # Create new session context
        async with await self._get_session() as session:
            return await self._get_or_create_agent_kb_with_session(agent_id, session)

    async def _get_or_create_agent_kb_with_session(
        self, agent_id: str, session: AsyncSession
    ) -> tuple[Tenant, KnowledgeBase]:
        """Internal implementation using provided session."""
        # Get agent with its current kb_id
        result = await session.execute(select(Agent).where(Agent.id == agent_id))
        agent = result.scalar_one_or_none()
        if not agent:
            raise ValueError(f"Agent {agent_id} not found")

        # If agent already has KB bound, reconcile state
        if agent.kb_id:
            result = await session.execute(
                select(KnowledgeBase, Tenant)
                .join(Tenant, KnowledgeBase.tenant_id == Tenant.id)
                .where(KnowledgeBase.id == agent.kb_id)
            )
            row = result.first()
            if row:
                kb, tenant = row[0], row[1]
                # Reconcile: ensure kb_setup_completed is True and Qdrant collection exists
                agent.kb_setup_completed = True
                # Re-ensure Qdrant collection using current embedding model
                embedding_model = (
                    getattr(agent, "embedding_model", None) or kb.embedding_model
                )
                await self.qdrant.ensure_collection(str(kb.id), embedding_model)
                await session.commit()
                await session.refresh(kb)
                await session.refresh(tenant)
                return tenant, kb
            else:
                # KB record not found - clear stale binding and fall through to create new
                agent.kb_id = None

        # Create new tenant for this agent's workspace
        from uuid import uuid4

        tenant = Tenant(
            id=str(uuid4()),
            name=f"Tenant for Agent {agent.name}",
            slug=f"agent-{agent_id[:8]}",
        )
        session.add(tenant)
        await session.flush()

        # Get agent's embedding config
        embedding_model = getattr(agent, "embedding_model", None) or "BAAI/bge-m3"
        embedding_base_url = getattr(agent, "embedding_api_base", None)

        # Create new KB
        kb = KnowledgeBase(
            tenant_id=tenant.id,
            name=f"KB for Agent {agent.name}",
            embedding_model=embedding_model,
            embedding_base_url=embedding_base_url,
            qdrant_collection="",  # Will be set below
        )
        session.add(kb)
        await session.flush()

        # Set qdrant_collection name
        kb_id_str = str(kb.id)
        object.__setattr__(kb, "qdrant_collection", get_kb_collection_name(kb_id_str))

        # Ensure Qdrant collection exists
        await self.qdrant.ensure_collection(kb_id_str, embedding_model)

        # Bind KB to agent and mark setup complete
        agent.kb_id = kb.id
        agent.kb_setup_completed = True

        await session.commit()
        await session.refresh(kb)
        await session.refresh(tenant)

        logger.info(
            f"Created and bound KB {kb.id} (tenant {tenant.id}) to agent {agent_id}"
        )

        return tenant, kb
