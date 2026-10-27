"""Agent ⇄ KB binding contract, exercised through `KbService.bind_agent`.

Binding is decoupled from the KB lifecycle: unbinding keeps every document, chunk
and vector, and rebinding makes the previous agent's content retrievable by the
new one. Binding is strictly one-to-one and explicit — there is no auto-create
path, so an unbound agent is simply unbound.
"""

from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select

import database
from models import Agent, KbChunk, KbDocument, KnowledgeBase, Workspace
from services.kb_service import KbService

EMBED_DIMENSION = 1024

@pytest.fixture(autouse=True)
def fake_qdrant(monkeypatch):
    from services.qdrant_service import QdrantKbService

    calls: list[tuple] = []

    async def ensure_collection(self, kb_id, dimension):
        calls.append(("ensure", kb_id, dimension))
        return f"kb_{str(kb_id).replace('-', '')[:12]}"

    async def delete_collection(self, kb_id):
        calls.append(("delete", kb_id))
        return True

    monkeypatch.setattr(QdrantKbService, "ensure_collection", ensure_collection)
    monkeypatch.setattr(QdrantKbService, "delete_collection", delete_collection)
    return calls

async def _workspace_id() -> int:
    async with database.AsyncSessionLocal() as session:
        workspace = (
            await session.execute(select(Workspace).order_by(Workspace.id).limit(1))
        ).scalar_one_or_none()
        if workspace is None:
            workspace = Workspace(
                name="Binding Workspace", owner_email="binding@example.com"
            )
            session.add(workspace)
            await session.commit()
        return workspace.id

async def _create_kb(workspace_id: int, name: str, *, status: str = "active") -> str:
    kb = await KbService().create_knowledge_base(
        workspace_id,
        name,
        embedding_provider="jina",
        embedding_model="jina-embeddings-v3",
        embedding_base_url="https://api.jina.ai/v1",
        embedding_api_key="enc:test-encrypted-key",
        embedding_dimension=EMBED_DIMENSION,
        embedding_batch_size=4,
    )
    if status != "active":
        async with database.AsyncSessionLocal() as session:
            row = await session.get(KnowledgeBase, kb.id)
            object.__setattr__(row, "status", status)
            await session.commit()
    return kb.id

async def _create_agent(workspace_id: int, name: str) -> str:
    async with database.AsyncSessionLocal() as session:
        agent = Agent(
            workspace_id=workspace_id,
            name=name,
            model="deepseek-v4-flash",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
        )
        session.add(agent)
        await session.commit()
        return agent.id

async def _seed_contents(kb_id: str, source_agent_id: str | None = None) -> str:
    async with database.AsyncSessionLocal() as session:
        doc = KbDocument(
            kb_id=kb_id,
            filename="legacy-notes.txt",
            file_type="txt",
            status="ready",
            chunk_count=1,
            file_size=12,
            source_agent_id=source_agent_id,
        )
        session.add(doc)
        await session.flush()
        session.add(
            KbChunk(kb_id=kb_id, doc_id=doc.id, vector_id="vec-1", chunk_index=0)
        )
        await session.commit()
        return doc.id

async def _counts(kb_id: str) -> tuple[int, int]:
    async with database.AsyncSessionLocal() as session:
        docs = await session.scalar(
            select(func.count(KbDocument.id)).where(KbDocument.kb_id == kb_id)
        )
        chunks = await session.scalar(
            select(func.count(KbChunk.id)).where(KbChunk.kb_id == kb_id)
        )
    return docs or 0, chunks or 0

# ---- binding ---------------------------------------------------------------

@pytest.mark.asyncio
async def test_bind_sets_agent_kb_id(setup_test_db):
    workspace_id = await _workspace_id()
    kb_id = await _create_kb(workspace_id, "Bindable KB")
    agent_id = await _create_agent(workspace_id, "Bindable Agent")

    agent = await KbService().bind_agent(agent_id, workspace_id, kb_id)

    assert agent.kb_id == kb_id
    async with database.AsyncSessionLocal() as session:
        assert (await session.get(Agent, agent_id)).kb_id == kb_id

@pytest.mark.asyncio
async def test_bind_twice_is_idempotent(setup_test_db):
    workspace_id = await _workspace_id()
    kb_id = await _create_kb(workspace_id, "Idempotent KB")
    agent_id = await _create_agent(workspace_id, "Idempotent Agent")

    service = KbService()
    await service.bind_agent(agent_id, workspace_id, kb_id)
    agent = await service.bind_agent(agent_id, workspace_id, kb_id)

    assert agent.kb_id == kb_id

@pytest.mark.asyncio
async def test_binding_creates_the_qdrant_collection(setup_test_db, fake_qdrant):
    workspace_id = await _workspace_id()
    kb_id = await _create_kb(workspace_id, "Qdrant KB")

    async with database.AsyncSessionLocal() as session:
        kb = await session.get(KnowledgeBase, kb_id)
        assert kb.qdrant_collection is not None
        assert kb.qdrant_collection.startswith("kb_")

    assert ("ensure", kb_id, EMBED_DIMENSION) in fake_qdrant

@pytest.mark.asyncio
async def test_unbind_leaves_contents_untouched(setup_test_db, fake_qdrant):
    workspace_id = await _workspace_id()
    kb_id = await _create_kb(workspace_id, "Keeps Contents KB")
    agent_id = await _create_agent(workspace_id, "Keeps Contents Agent")
    await _seed_contents(kb_id, source_agent_id=agent_id)
    before = await _counts(kb_id)
    assert before == (1, 1)

    service = KbService()
    await service.bind_agent(agent_id, workspace_id, kb_id)
    agent = await service.bind_agent(agent_id, workspace_id, None)

    assert agent.kb_id is None
    assert await _counts(kb_id) == before
    assert not [c for c in fake_qdrant if c == ("delete", kb_id)]

    async with database.AsyncSessionLocal() as session:
        assert await session.get(KnowledgeBase, kb_id) is not None

@pytest.mark.asyncio
async def test_rebind_keeps_the_previous_kbs_contents(setup_test_db):
    workspace_id = await _workspace_id()
    first_kb = await _create_kb(workspace_id, "First KB")
    second_kb = await _create_kb(workspace_id, "Second KB")
    agent_id = await _create_agent(workspace_id, "Rebinding Agent")
    await _seed_contents(first_kb)
    before = await _counts(first_kb)

    service = KbService()
    await service.bind_agent(agent_id, workspace_id, first_kb)
    agent = await service.bind_agent(agent_id, workspace_id, second_kb)

    assert agent.kb_id == second_kb
    assert await _counts(first_kb) == before
    async with database.AsyncSessionLocal() as session:
        assert await session.get(KnowledgeBase, first_kb) is not None

@pytest.mark.asyncio
async def test_bind_one_kb_to_two_agents_is_rejected(setup_test_db):
    from fastapi import HTTPException

    workspace_id = await _workspace_id()
    kb_id = await _create_kb(workspace_id, "Contended KB")
    agent_a = await _create_agent(workspace_id, "Contender A")
    agent_b = await _create_agent(workspace_id, "Contender B")

    service = KbService()
    await service.bind_agent(agent_a, workspace_id, kb_id)

    with pytest.raises(HTTPException) as exc_info:
        await service.bind_agent(agent_b, workspace_id, kb_id)

    assert exc_info.value.status_code == 409
    assert str(exc_info.value.detail) == "KB is already bound to another agent"

@pytest.mark.asyncio
async def test_unbound_agent_stays_unbound(setup_test_db):
    """No implicit KB creation: an agent without kb_id is simply unbound."""
    workspace_id = await _workspace_id()
    agent_id = await _create_agent(workspace_id, "Never Bound Agent")

    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, agent_id)
        assert agent.kb_id is None
        assert not hasattr(KbService, "get_or_create_agent_kb")

@pytest.mark.asyncio
async def test_bind_inactive_kb_is_rejected(setup_test_db):
    from fastapi import HTTPException

    workspace_id = await _workspace_id()
    broken_kb = await _create_kb(workspace_id, "Broken KB", status="error")
    agent_id = await _create_agent(workspace_id, "Broken KB Agent")

    with pytest.raises(HTTPException) as exc_info:
        await KbService().bind_agent(agent_id, workspace_id, broken_kb)

    assert exc_info.value.status_code == 400
    assert str(exc_info.value.detail) == "KB is not active"

# ---- paused agents still own their binding ---------------------------------
#
# Pause (`POST /agents/{id}:pause`, issue #29) sets `is_active = False` and keeps
# `kb_id` on purpose. Only `deleted_at` means "no longer an owner", so a paused
# agent must keep the KB bound: it blocks a competing bind and blocks deletion.

async def _pause_agent(agent_id: str) -> None:
    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, agent_id)
        agent.is_active = False
        await session.commit()

async def _kb_id_of(agent_id: str) -> str | None:
    async with database.AsyncSessionLocal() as session:
        return (await session.get(Agent, agent_id)).kb_id

@pytest.mark.asyncio
async def test_paused_agent_blocks_a_competing_bind(setup_test_db):
    from fastapi import HTTPException

    workspace_id = await _workspace_id()
    kb_id = await _create_kb(workspace_id, "Paused Owner KB")
    owner_id = await _create_agent(workspace_id, "Paused Owner")
    rival_id = await _create_agent(workspace_id, "Rival Agent")

    service = KbService()
    await service.bind_agent(owner_id, workspace_id, kb_id)
    await _pause_agent(owner_id)

    with pytest.raises(HTTPException) as exc_info:
        await service.bind_agent(rival_id, workspace_id, kb_id)

    assert exc_info.value.status_code == 409
    assert str(exc_info.value.detail) == "KB is already bound to another agent"
    assert await _kb_id_of(owner_id) == kb_id, "paused owner keeps its binding"
    assert await _kb_id_of(rival_id) is None, "no silent steal"

@pytest.mark.asyncio
async def test_paused_agent_blocks_kb_deletion(setup_test_db, fake_qdrant):
    from fastapi import HTTPException

    workspace_id = await _workspace_id()
    kb_id = await _create_kb(workspace_id, "Paused Delete KB")
    owner_id = await _create_agent(workspace_id, "Delete Guard Owner")

    service = KbService()
    await service.bind_agent(owner_id, workspace_id, kb_id)
    await _pause_agent(owner_id)

    with pytest.raises(HTTPException) as exc_info:
        await service.delete_knowledge_base(kb_id, workspace_id)

    assert exc_info.value.status_code == 409
    assert str(exc_info.value.detail) == "KB is bound to an agent. Unbind it first."
    async with database.AsyncSessionLocal() as session:
        assert await session.get(KnowledgeBase, kb_id) is not None
    assert await _kb_id_of(owner_id) == kb_id
    assert not [c for c in fake_qdrant if c[0] == "delete"]

@pytest.mark.asyncio
async def test_deleted_agent_never_blocks_a_bind(setup_test_db):
    """Purge-window rows that still hold a kb_id must not block (or steal) a bind."""
    workspace_id = await _workspace_id()
    kb_id = await _create_kb(workspace_id, "Legacy Deleted KB")
    dead_id = await _create_agent(workspace_id, "Legacy Deleted Agent")
    successor_id = await _create_agent(workspace_id, "Legacy Successor")

    async with database.AsyncSessionLocal() as session:
        dead = await session.get(Agent, dead_id)
        dead.kb_id = kb_id
        dead.is_active = False
        dead.deleted_at = datetime.now(timezone.utc)
        await session.commit()

    agent = await KbService().bind_agent(successor_id, workspace_id, kb_id)

    assert agent.kb_id == kb_id
    assert await _kb_id_of(dead_id) is None, "the dead binding is released"
