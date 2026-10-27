"""KnowledgeBase service.

Every query is scoped to a workspace: ``KnowledgeBase.workspace_id`` is the only
authority since the KB-decoupling change. There is no tenant parameter anywhere
and no implicit KB creation — an agent only ever reaches a KB through
``Agent.kb_id``, set by :meth:`KbService.bind_agent`.
"""

import logging
import os
import shutil
from pathlib import Path

from sqlalchemy import (
    delete as sa_delete,
    func,
    select,
    update as sa_update,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

import database
from models import Agent, KnowledgeBase, KbChunk, KbDocument
from services.qdrant_service import QdrantKbService, get_kb_collection_name, get_embedding_dimension
from services.task_lock import TaskType, task_lock

logger = logging.getLogger(__name__)

# Root for uploaded KB files: ``UPLOAD_ROOT/<workspace_id>/<kb_id>/<doc_id>/<file>``.
# Mirrors `services.kb_document_processor.UPLOAD_ROOT` (same env override).
UPLOAD_ROOT = Path(os.environ.get("KB_UPLOAD_ROOT", "/app/data/kb_uploads"))

# Fields a caller may change through ``update_kb_config``.
UPDATABLE_FIELDS = {
    "name",
    "chunk_size",
    "chunk_overlap",
    "embedding_provider",
    "embedding_model",
    "embedding_base_url",
    "embedding_api_key",
}

EMBEDDING_FIELDS = {
    "embedding_provider",
    "embedding_model",
    "embedding_base_url",
    "embedding_api_key",
}

class KbService:
    def __init__(self, session: AsyncSession | None = None):
        self.session = session
        self.qdrant = QdrantKbService()

    async def _get_session(self) -> AsyncSession:
        if self.session:
            return self.session
        return database.AsyncSessionLocal()

    def _upload_dir(self, workspace_id: int, kb_id: str) -> Path:
        return UPLOAD_ROOT / str(workspace_id) / kb_id

    # ── reads ────────────────────────────────────────────────────────────────

    async def list_knowledge_bases(self, workspace_id: int) -> list[KnowledgeBase]:
        """List the workspace's KBs. A KB outside the workspace is never returned."""
        if not workspace_id:
            raise ValueError("workspace_id is required")
        async with await self._get_session() as session:
            stmt = (
                select(KnowledgeBase)
                .where(KnowledgeBase.workspace_id == workspace_id)
                .order_by(KnowledgeBase.created_at, KnowledgeBase.id)
            )
            result = await session.execute(stmt)
            return list(result.scalars().all())

    async def get_knowledge_base(
        self, kb_id: str, workspace_id: int
    ) -> KnowledgeBase | None:
        """Fetch one KB. A KB from another workspace behaves like a missing KB."""
        if not workspace_id:
            raise ValueError("workspace_id is required")
        async with await self._get_session() as session:
            stmt = select(KnowledgeBase).where(
                KnowledgeBase.id == kb_id,
                KnowledgeBase.workspace_id == workspace_id,
            )
            result = await session.execute(stmt)
            return result.scalar_one_or_none()

    async def get_kb_detail(self, kb_id: str, workspace_id: int) -> dict:
        """Config plus document/chunk counters plus the bound agent (or None)."""
        kb = await self.get_knowledge_base(kb_id, workspace_id)
        if not kb:
            raise ValueError("KB not found")

        async with await self._get_session() as session:
            doc_count = await session.scalar(
                select(func.count()).where(KbDocument.kb_id == kb_id)
            )
            ready_count = await session.scalar(
                select(func.count()).where(
                    KbDocument.kb_id == kb_id,
                    KbDocument.status == "ready",
                )
            )
            chunk_count = await session.scalar(
                select(func.count()).where(KbChunk.kb_id == kb_id)
            )
            bound_agent = (
                await session.execute(
                    select(Agent.id, Agent.name)
                    .where(
                        Agent.kb_id == kb_id,
                        # Only deletion ends ownership: a paused agent (is_active
                        # False, deleted_at NULL) still owns its binding.
                        Agent.deleted_at.is_(None),
                    )
                    .limit(1)
                )
            ).first()

        return {
            "id": kb.id,
            "name": kb.name,
            "workspace_id": getattr(kb, "workspace_id", None),
            "embedding_provider": getattr(kb, "embedding_provider", None) or "jina",
            "embedding_model": kb.embedding_model,
            "embedding_base_url": getattr(kb, "embedding_base_url", None),
            "embedding_batch_size": getattr(kb, "embedding_batch_size", None) or 4,
            "embedding_dimension": getattr(kb, "embedding_dimension", None),
            "vector_backend": getattr(kb, "vector_backend", "qdrant"),
            "chunk_size": kb.chunk_size,
            "chunk_overlap": kb.chunk_overlap,
            "is_locked": bool(getattr(kb, "is_locked", False)),
            "status": str(getattr(kb, "status", "active")),
            "error_message": getattr(kb, "error_message", None),
            "document_count": doc_count or 0,
            "ready_document_count": ready_count or 0,
            "total_chunks": chunk_count or 0,
            "bound_agent": (
                {"id": bound_agent[0], "name": bound_agent[1]} if bound_agent else None
            ),
        }

    # ── writes ───────────────────────────────────────────────────────────────

    async def create_knowledge_base(
        self,
        workspace_id: int,
        name: str,
        *,
        embedding_provider: str,
        embedding_model: str,
        embedding_base_url: str | None,
        embedding_api_key: str | None,
        embedding_dimension: int,
        embedding_batch_size: int = 4,
        chunk_size: int = 512,
        chunk_overlap: int = 64,
    ) -> KnowledgeBase:
        """Create a workspace-scoped KB and its Qdrant collection.

        ``embedding_api_key`` is expected to be ALREADY encrypted by the caller
        (``core.encryption.encrypt_api_key``); the service stores it verbatim and
        never sees a plaintext key. ``embedding_dimension`` must be the width
        MEASURED from the provider, never derived from the model name.
        """
        if not workspace_id:
            raise ValueError("workspace_id is required")

        async with await self._get_session() as session:
            kb = KnowledgeBase(
                workspace_id=workspace_id,
                name=name,
                embedding_provider=embedding_provider,
                embedding_model=embedding_model,
                embedding_base_url=embedding_base_url,
                embedding_api_key=embedding_api_key,
                embedding_dimension=embedding_dimension,
                embedding_batch_size=embedding_batch_size,
                chunk_size=chunk_size,
                chunk_overlap=chunk_overlap,
                qdrant_collection="",  # set after the id is known
                status="active",
            )
            session.add(kb)
            await session.flush()  # get id

            kb_id_str = str(kb.id)
            object.__setattr__(kb, "qdrant_collection", get_kb_collection_name(kb_id_str))

            await self.qdrant.ensure_collection(kb_id_str, embedding_dimension)

            await session.commit()
            await session.refresh(kb)
            return kb

    async def update_kb_config(
        self, kb_id: str, workspace_id: int, updates: dict
    ) -> KnowledgeBase:
        """Update KB config.

        - 423 while the KB is resetting.
        - Embedding fields -> 409 once the KB is locked (chunks exist).
        - A model change that alters the vector width -> 409; use reset instead.
        """
        from fastapi import HTTPException

        if not workspace_id:
            raise ValueError("workspace_id is required")

        async with await self._get_session() as session:
            stmt = select(KnowledgeBase).where(
                KnowledgeBase.id == kb_id,
                KnowledgeBase.workspace_id == workspace_id,
            )
            res = await session.execute(stmt)
            kb = res.scalar_one_or_none()
            if not kb:
                raise ValueError("KB not found")

            if str(getattr(kb, "status", "active")) == "resetting":
                raise HTTPException(423, "KB is resetting, config changes locked")

            if bool(getattr(kb, "is_locked", False)):
                for field in EMBEDDING_FIELDS:
                    if field in updates:
                        raise HTTPException(
                            409,
                            "Embedding config locked (has chunks). Use reset first.",
                        )

            new_model = updates.get("embedding_model")
            if new_model and new_model != getattr(kb, "embedding_model", None):
                current_dim = getattr(kb, "embedding_dimension", None) or (
                    get_embedding_dimension(str(getattr(kb, "embedding_model", "")))
                )
                if get_embedding_dimension(str(new_model)) != current_dim:
                    chunk_count = await session.scalar(
                        select(func.count()).where(KbChunk.kb_id == kb_id)
                    )
                    if chunk_count:
                        raise HTTPException(
                            409,
                            "Embedding model changes the vector dimension. "
                            "Use reset first.",
                        )

            for key, value in updates.items():
                if key in UPDATABLE_FIELDS:
                    object.__setattr__(kb, key, value)

            await session.commit()
            await session.refresh(kb)
            return kb

    async def delete_knowledge_base(self, kb_id: str, workspace_id: int) -> None:
        """Delete an unbound KB: vectors, chunks, documents, files and the row.

        409 while any agent is bound. A KB from another workspace is a no-op.
        """
        from fastapi import HTTPException

        if not workspace_id:
            raise ValueError("workspace_id is required")

        async with await self._get_session() as session:
            kb = await session.scalar(
                select(KnowledgeBase).where(
                    KnowledgeBase.id == kb_id,
                    KnowledgeBase.workspace_id == workspace_id,
                )
            )
            if not kb:
                logger.info(f"KB {kb_id} not in workspace {workspace_id}; nothing to delete")
                return

            agent_ref = await session.scalar(
                select(Agent.id)
                .where(
                    Agent.kb_id == kb_id,
                    # Only deletion releases the KB: a paused agent still owns it,
                    # so it must keep blocking deletion.
                    Agent.deleted_at.is_(None),
                )
                .limit(1)
            )
            if agent_ref:
                raise HTTPException(409, "KB is bound to an agent. Unbind it first.")

            await self.qdrant.delete_collection(kb_id)

            await session.execute(sa_delete(KbChunk).where(KbChunk.kb_id == kb_id))
            await session.execute(sa_delete(KbDocument).where(KbDocument.kb_id == kb_id))

            upload_dir = self._upload_dir(workspace_id, kb_id)
            if upload_dir.exists():
                shutil.rmtree(upload_dir, ignore_errors=True)

            # Deleting the built-in example KB is a decision: record `declined` in
            # the same transaction (and before the row is gone) so a later login
            # does not mint it again. The KB owns its seed state, not the agent.
            from services.example_seed import (
                EXAMPLE_KB_NAME,
                mark_example_seed_declined,
            )

            if kb.name == EXAMPLE_KB_NAME:
                await mark_example_seed_declined(session, workspace_id)

            await session.delete(kb)
            await session.commit()

    async def reset_knowledge_base(
        self,
        kb_id: str,
        workspace_id: int,
        *,
        embedding_provider: str | None = None,
        embedding_model: str,
        embedding_base_url: str | None,
        embedding_api_key: str | None = None,
        embedding_dimension: int,
        embedding_batch_size: int | None = None,
    ) -> dict:
        """Rebuild the collection at a new width and re-queue every document.

        The API layer validates the key and measures ``embedding_dimension``
        before calling; this method only persists what it is given. Deleting and
        recreating the collection is what actually changes the vector width.
        """
        from fastapi import HTTPException

        if not workspace_id:
            raise ValueError("workspace_id is required")

        async with await self._get_session() as session:
            kb = await session.scalar(
                select(KnowledgeBase).where(
                    KnowledgeBase.id == kb_id,
                    KnowledgeBase.workspace_id == workspace_id,
                )
            )
            if not kb:
                raise ValueError("KB not found")
            if str(getattr(kb, "status", "active")) == "resetting":
                raise HTTPException(423, "Reset already in progress")
            object.__setattr__(kb, "status", "resetting")
            object.__setattr__(kb, "error_message", None)
            await session.commit()

        task_id = f"reset_{kb_id}"
        acquired, err = await task_lock.acquire_task(kb_id, TaskType.KB_RESET, task_id)
        if not acquired:
            async with await self._get_session() as session:
                kb = await session.get(KnowledgeBase, kb_id)
                if kb:
                    object.__setattr__(kb, "status", "error")
                    object.__setattr__(kb, "error_message", f"Lock failed: {err}"[:500])
                await session.commit()
            raise HTTPException(423, f"Reset lock failed: {err}")

        try:
            # 1. Drop the collection, 2. recreate it at the new (measured) width.
            await self.qdrant.delete_collection(kb_id)
            await self.qdrant.ensure_collection(kb_id, embedding_dimension)

            async with await self._get_session() as session:
                await session.execute(sa_delete(KbChunk).where(KbChunk.kb_id == kb_id))
                await session.execute(
                    sa_update(KbDocument)
                    .where(KbDocument.kb_id == kb_id)
                    .values(status="pending", chunk_count=0, error_message=None)
                )

                kb = await session.get(KnowledgeBase, kb_id)
                if kb:
                    object.__setattr__(kb, "embedding_provider", embedding_provider or getattr(kb, "embedding_provider", "jina"))
                    object.__setattr__(kb, "embedding_model", embedding_model)
                    object.__setattr__(kb, "embedding_base_url", embedding_base_url)
                    object.__setattr__(kb, "embedding_dimension", int(embedding_dimension))
                    if embedding_api_key is not None:
                        object.__setattr__(kb, "embedding_api_key", embedding_api_key)
                    if embedding_batch_size is not None:
                        object.__setattr__(kb, "embedding_batch_size", int(embedding_batch_size))
                    object.__setattr__(kb, "is_locked", False)
                    object.__setattr__(kb, "status", "active")
                    object.__setattr__(kb, "error_message", None)
                await session.commit()

            async with await self._get_session() as session:
                docs = await session.execute(
                    select(KbDocument.id).where(KbDocument.kb_id == kb_id)
                )
                doc_ids = [row[0] for row in docs.all()]

            return {"status": "active", "kb_id": kb_id, "doc_ids": doc_ids}

        except Exception as e:
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

    # ── binding ──────────────────────────────────────────────────────────────

    async def bind_agent(
        self, agent_id: str, workspace_id: int, kb_id: str | None
    ) -> Agent:
        """Bind, rebind or unbind an agent's KB. Contents are never touched.

        ``kb_id is None`` unbinds. A KB outside the workspace behaves like a
        missing KB (404), a non-active KB is 400, and a KB already bound to a
        different agent is 409. Re-binding the current KB is idempotent.
        """
        from fastapi import HTTPException

        if not workspace_id:
            raise ValueError("workspace_id is required")

        async with await self._get_session() as session:
            agent = await session.get(Agent, agent_id)
            if not agent:
                raise HTTPException(404, f"Agent {agent_id} not found")

            if kb_id is None:
                object.__setattr__(agent, "kb_id", None)
                await session.commit()
                await session.refresh(agent)
                return agent

            kb = await session.scalar(
                select(KnowledgeBase).where(
                    KnowledgeBase.id == kb_id,
                    KnowledgeBase.workspace_id == workspace_id,
                )
            )
            if not kb:
                raise HTTPException(404, "Knowledge base not found")

            if str(getattr(kb, "status", "active")) != "active":
                raise HTTPException(400, "KB is not active")

            if agent.kb_id == kb_id:
                return agent  # idempotent

            # A deleted agent that still points at this KB (a row written by a
            # release that did not clear the binding on delete) would keep the
            # UNIQUE index busy and every rebind would fail with a 409. Release it
            # here so old databases heal on the next bind. Only deletion qualifies:
            # a paused agent (is_active False) keeps its binding.
            await session.execute(
                sa_update(Agent)
                .where(
                    Agent.kb_id == kb_id,
                    Agent.id != agent_id,
                    Agent.deleted_at.is_not(None),
                )
                .values(kb_id=None)
            )

            other_agent = await session.scalar(
                select(Agent.id)
                .where(
                    Agent.kb_id == kb_id,
                    Agent.id != agent_id,
                    # Only a deleted agent stops blocking: a paused agent is still
                    # the owner, so a competing bind answers 409 instead of stealing.
                    Agent.deleted_at.is_(None),
                )
                .limit(1)
            )
            if other_agent:
                raise HTTPException(409, "KB is already bound to another agent")

            object.__setattr__(agent, "kb_id", kb_id)
            try:
                await session.commit()
            except IntegrityError as exc:
                await session.rollback()
                # Defence for the race the partial unique index exists for.
                raise HTTPException(409, "KB is already bound to another agent") from exc

            await session.refresh(agent)
            logger.info(f"Bound KB {kb_id} to agent {agent_id}")
            return agent

    async def unbind_kb_from_agents(self, kb_id: str) -> int:
        """Drop every binding pointing at *kb_id*. Returns the number cleared.

        Deliberately ignores `deleted_at`/`is_active`: soft-deleted agents still
        hold the UNIQUE value, and leaving one set would make the KB permanently
        unbindable.
        """
        async with await self._get_session() as session:
            result = await session.execute(
                sa_update(Agent).where(Agent.kb_id == kb_id).values(kb_id=None)
            )
            await session.commit()
            return result.rowcount or 0
