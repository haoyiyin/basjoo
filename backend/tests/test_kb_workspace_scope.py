"""Workspace scoping and one-to-one binding for the KB data layer.

A knowledge base is scoped to a workspace (`KnowledgeBase.workspace_id` is
authoritative) and bound to at most one agent at a time — enforced both in
`KbService.bind_agent` and by a unique index on `agents.kb_id`.

Everything here drives the service directly (no HTTP), and KB rows are created
through `KbService.create_knowledge_base` so the production code path is exercised.
"""

from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

import database
from models import Agent, KbChunk, KbDocument, KnowledgeBase, Workspace, WorkspaceQuota
from services.kb_service import KbService
from services.qdrant_service import QdrantKbService

EMBED_KEY = "test-jina-key"
EMBED_DIMENSION = 1024

@pytest.fixture(autouse=True)
def fake_qdrant(monkeypatch):
    """Record collection calls instead of talking to a live Qdrant."""
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

async def _create_workspace(email: str) -> int:
    async with database.AsyncSessionLocal() as session:
        workspace = Workspace(name=f"Workspace {email}", owner_email=email)
        session.add(workspace)
        await session.flush()
        session.add(WorkspaceQuota(workspace_id=workspace.id))
        await session.commit()
        return workspace.id

async def _create_kb(
    workspace_id: int, name: str, *, status: str = "active"
) -> str:
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

async def _seed_contents(kb_id: str, source_agent_id: str | None = None) -> tuple[str, str]:
    """Insert one document plus one chunk; returns (doc_id, chunk_id)."""
    async with database.AsyncSessionLocal() as session:
        doc = KbDocument(
            kb_id=kb_id,
            filename="notes.txt",
            file_type="txt",
            status="ready",
            chunk_count=1,
            file_size=10,
            source_agent_id=source_agent_id,
        )
        session.add(doc)
        await session.flush()
        chunk = KbChunk(kb_id=kb_id, doc_id=doc.id, vector_id="vec-1", chunk_index=0)
        session.add(chunk)
        await session.commit()
        return doc.id, chunk.id

async def _counts(kb_id: str) -> tuple[int, int]:
    async with database.AsyncSessionLocal() as session:
        docs = await session.scalar(
            select(func.count(KbDocument.id)).where(KbDocument.kb_id == kb_id)
        )
        chunks = await session.scalar(
            select(func.count(KbChunk.id)).where(KbChunk.kb_id == kb_id)
        )
    return docs or 0, chunks or 0

# ---- workspace scoping -----------------------------------------------------

@pytest.mark.asyncio
async def test_get_knowledge_base_is_workspace_scoped(setup_test_db):
    workspace_a = await _create_workspace("scope-a@example.com")
    workspace_b = await _create_workspace("scope-b@example.com")
    kb_a = await _create_kb(workspace_a, "KB A")
    kb_b = await _create_kb(workspace_b, "KB B")

    service = KbService()

    assert (await service.get_knowledge_base(kb_a, workspace_a)).id == kb_a
    assert await service.get_knowledge_base(kb_a, workspace_b) is None
    assert await service.get_knowledge_base(kb_b, workspace_a) is None
    assert await service.get_knowledge_base("kb_missing", workspace_a) is None

@pytest.mark.asyncio
async def test_list_knowledge_bases_never_leaks_another_workspace(setup_test_db):
    workspace_a = await _create_workspace("list-a@example.com")
    workspace_b = await _create_workspace("list-b@example.com")
    kb_a = await _create_kb(workspace_a, "Listed KB A")
    kb_b = await _create_kb(workspace_b, "Listed KB B")

    service = KbService()
    listed_a = [kb.id for kb in await service.list_knowledge_bases(workspace_a)]
    listed_b = [kb.id for kb in await service.list_knowledge_bases(workspace_b)]

    assert kb_a in listed_a
    assert kb_b not in listed_a
    assert kb_b in listed_b
    assert kb_a not in listed_b

    for kb in await service.list_knowledge_bases(workspace_a):
        assert kb.workspace_id == workspace_a

@pytest.mark.asyncio
async def test_get_kb_detail_counts_and_bound_agent(setup_test_db):
    workspace_id = await _create_workspace("detail@example.com")
    kb_id = await _create_kb(workspace_id, "Detail KB")
    agent_id = await _create_agent(workspace_id, "Detail Agent")
    await KbService().bind_agent(agent_id, workspace_id, kb_id)
    await _seed_contents(kb_id, source_agent_id=agent_id)

    detail = await KbService().get_kb_detail(kb_id, workspace_id)

    assert detail["id"] == kb_id
    assert detail["workspace_id"] == workspace_id
    assert detail["document_count"] == 1
    assert detail["ready_document_count"] == 1
    assert detail["total_chunks"] == 1
    assert detail["bound_agent"] == {"id": agent_id, "name": "Detail Agent"}

@pytest.mark.asyncio
async def test_delete_knowledge_base_is_workspace_scoped(setup_test_db, fake_qdrant):
    workspace_a = await _create_workspace("del-a@example.com")
    workspace_b = await _create_workspace("del-b@example.com")
    kb_a = await _create_kb(workspace_a, "Delete KB A")

    # Cross-workspace delete behaves like a missing KB: no-op, row survives.
    await KbService().delete_knowledge_base(kb_a, workspace_b)

    async with database.AsyncSessionLocal() as session:
        assert await session.get(KnowledgeBase, kb_a) is not None
    assert not [c for c in fake_qdrant if c == ("delete", kb_a)]

    # The owning workspace can delete it.
    await KbService().delete_knowledge_base(kb_a, workspace_a)
    async with database.AsyncSessionLocal() as session:
        assert await session.get(KnowledgeBase, kb_a) is None
    assert ("delete", kb_a) in fake_qdrant

@pytest.mark.asyncio
async def test_delete_knowledge_base_refused_while_bound(setup_test_db):
    from fastapi import HTTPException

    workspace_id = await _create_workspace("del-bound@example.com")
    kb_id = await _create_kb(workspace_id, "Bound KB")
    agent_id = await _create_agent(workspace_id, "Bound Agent")
    await KbService().bind_agent(agent_id, workspace_id, kb_id)

    with pytest.raises(HTTPException) as exc_info:
        await KbService().delete_knowledge_base(kb_id, workspace_id)

    assert exc_info.value.status_code == 409
    assert "unbind" in str(exc_info.value.detail).lower()

# ---- bind_agent matrix -----------------------------------------------------

@pytest.mark.asyncio
async def test_bind_ok_and_idempotent(setup_test_db):
    workspace_id = await _create_workspace("bind-ok@example.com")
    kb_id = await _create_kb(workspace_id, "Bind KB")
    agent_id = await _create_agent(workspace_id, "Bind Agent")

    service = KbService()
    agent = await service.bind_agent(agent_id, workspace_id, kb_id)
    assert agent.kb_id == kb_id

    # Binding the KB the agent already has is a no-op success.
    again = await service.bind_agent(agent_id, workspace_id, kb_id)
    assert again.kb_id == kb_id

@pytest.mark.asyncio
async def test_bind_same_kb_to_second_agent_conflicts(setup_test_db):
    from fastapi import HTTPException

    workspace_id = await _create_workspace("bind-conflict@example.com")
    kb_id = await _create_kb(workspace_id, "Contended KB")
    agent_a = await _create_agent(workspace_id, "Agent A")
    agent_b = await _create_agent(workspace_id, "Agent B")

    service = KbService()
    await service.bind_agent(agent_a, workspace_id, kb_id)

    with pytest.raises(HTTPException) as exc_info:
        await service.bind_agent(agent_b, workspace_id, kb_id)

    assert exc_info.value.status_code == 409
    assert str(exc_info.value.detail) == "KB is already bound to another agent"

    async with database.AsyncSessionLocal() as session:
        assert (await session.get(Agent, agent_b)).kb_id is None
        assert (await session.get(Agent, agent_a)).kb_id == kb_id

@pytest.mark.asyncio
async def test_unbind_keeps_contents_and_frees_the_kb_for_another_agent(setup_test_db):
    workspace_id = await _create_workspace("unbind@example.com")
    kb_id = await _create_kb(workspace_id, "Shared KB")
    agent_a = await _create_agent(workspace_id, "Agent A")
    agent_b = await _create_agent(workspace_id, "Agent B")
    await _seed_contents(kb_id, source_agent_id=agent_a)
    before = await _counts(kb_id)
    assert before == (1, 1)

    service = KbService()
    await service.bind_agent(agent_a, workspace_id, kb_id)
    unbound = await service.bind_agent(agent_a, workspace_id, None)

    assert unbound.kb_id is None
    assert await _counts(kb_id) == before, "Unbinding must not touch contents"

    async with database.AsyncSessionLocal() as session:
        assert await session.get(KnowledgeBase, kb_id) is not None

    rebound = await service.bind_agent(agent_b, workspace_id, kb_id)
    assert rebound.kb_id == kb_id
    assert await _counts(kb_id) == before

@pytest.mark.asyncio
async def test_rebind_to_another_kb_keeps_the_old_kbs_contents(setup_test_db):
    workspace_id = await _create_workspace("rebind@example.com")
    first_kb = await _create_kb(workspace_id, "First KB")
    second_kb = await _create_kb(workspace_id, "Second KB")
    agent_id = await _create_agent(workspace_id, "Rebind Agent")
    await _seed_contents(first_kb)
    before = await _counts(first_kb)

    service = KbService()
    await service.bind_agent(agent_id, workspace_id, first_kb)
    agent = await service.bind_agent(agent_id, workspace_id, second_kb)

    assert agent.kb_id == second_kb
    assert await _counts(first_kb) == before
    async with database.AsyncSessionLocal() as session:
        old_kb = await session.get(KnowledgeBase, first_kb)
        assert old_kb is not None
        assert old_kb.status == "active"

@pytest.mark.asyncio
async def test_unbind_then_bind_to_agent_b_retrieves_agent_a_content(setup_test_db):
    """Contents travel with the KB: agent B retrieves what agent A ingested."""
    workspace_id = await _create_workspace("travel@example.com")
    kb_id = await _create_kb(workspace_id, "Travelling KB")
    agent_a = await _create_agent(workspace_id, "Agent A")
    agent_b = await _create_agent(workspace_id, "Agent B")
    doc_id, _ = await _seed_contents(kb_id, source_agent_id=agent_a)

    service = KbService()
    await service.bind_agent(agent_a, workspace_id, kb_id)
    await service.bind_agent(agent_a, workspace_id, None)
    await service.bind_agent(agent_b, workspace_id, kb_id)

    from services.kb_retrieval_service import KbRetrievalService

    async def fake_embed_texts(self, texts, model, base_url, api_key=None):
        return [[0.02] * EMBED_DIMENSION for _ in texts]

    expected_kb_id = kb_id

    async def fake_search_kb(self, kb_id, query_vector, top_k=5):
        assert kb_id == expected_kb_id
        return [
            {
                "score": 0.93,
                "payload": {
                    "text": "Agent A knowledge chunk",
                    "doc_id": doc_id,
                    "chunk_index": 0,
                    "filename": "notes.txt",
                    "source_type": "file",
                    "source_agent_id": agent_a,
                },
            }
        ]

    import services.kb_retrieval_service as retrieval_module

    original_embed = retrieval_module.DocumentParser.embed_texts
    original_search = retrieval_module.QdrantKbService.search_kb
    retrieval_module.DocumentParser.embed_texts = fake_embed_texts
    retrieval_module.QdrantKbService.search_kb = fake_search_kb
    try:
        results = await KbRetrievalService().retrieve(
            agent_id=agent_b, query="anything", top_k=5, threshold=0.1
        )
    finally:
        retrieval_module.DocumentParser.embed_texts = original_embed
        retrieval_module.QdrantKbService.search_kb = original_search

    assert results, "Agent B must retrieve the content that came with the KB"
    assert results[0]["text"] == "Agent A knowledge chunk"

@pytest.mark.asyncio
async def test_bind_missing_kb_is_404(setup_test_db):
    from fastapi import HTTPException

    workspace_id = await _create_workspace("bind-missing@example.com")
    agent_id = await _create_agent(workspace_id, "Missing KB Agent")

    with pytest.raises(HTTPException) as exc_info:
        await KbService().bind_agent(agent_id, workspace_id, "kb_does_not_exist")

    assert exc_info.value.status_code == 404

@pytest.mark.asyncio
async def test_bind_kb_from_another_workspace_is_404(setup_test_db):
    from fastapi import HTTPException

    workspace_a = await _create_workspace("foreign-a@example.com")
    workspace_b = await _create_workspace("foreign-b@example.com")
    foreign_kb = await _create_kb(workspace_b, "Foreign KB")
    agent_id = await _create_agent(workspace_a, "Foreign KB Agent")

    with pytest.raises(HTTPException) as exc_info:
        await KbService().bind_agent(agent_id, workspace_a, foreign_kb)

    assert exc_info.value.status_code == 404

@pytest.mark.asyncio
async def test_bind_inactive_kb_is_400(setup_test_db):
    from fastapi import HTTPException

    workspace_id = await _create_workspace("bind-inactive@example.com")
    error_kb = await _create_kb(workspace_id, "Error KB", status="error")
    agent_id = await _create_agent(workspace_id, "Inactive KB Agent")

    with pytest.raises(HTTPException) as exc_info:
        await KbService().bind_agent(agent_id, workspace_id, error_kb)

    assert exc_info.value.status_code == 400
    assert str(exc_info.value.detail) == "KB is not active"

@pytest.mark.asyncio
async def test_bind_missing_agent_is_404(setup_test_db):
    from fastapi import HTTPException

    workspace_id = await _create_workspace("bind-noagent@example.com")
    kb_id = await _create_kb(workspace_id, "Orphan KB")

    with pytest.raises(HTTPException) as exc_info:
        await KbService().bind_agent("agt_missing", workspace_id, kb_id)

    assert exc_info.value.status_code == 404

@pytest.mark.asyncio
async def test_unbind_kb_from_agents_clears_every_binding(setup_test_db):
    workspace_id = await _create_workspace("unbind-all@example.com")
    kb_id = await _create_kb(workspace_id, "Multi Agent KB")
    agent_id = await _create_agent(workspace_id, "Sole Agent")
    await KbService().bind_agent(agent_id, workspace_id, kb_id)

    cleared = await KbService().unbind_kb_from_agents(kb_id)

    assert cleared == 1
    async with database.AsyncSessionLocal() as session:
        assert (await session.get(Agent, agent_id)).kb_id is None

@pytest.mark.asyncio
async def test_no_auto_create_kb_path_exists(setup_test_db):
    """The implicit KB-creation helpers are gone: binding is the only way in."""
    service = KbService()
    assert not hasattr(service, "get_or_create_agent_kb")
    assert not hasattr(service, "_get_or_create_agent_kb_with_session")

# ---- DB-level uniqueness ---------------------------------------------------

@pytest.mark.asyncio
async def test_duplicate_kb_binding_is_rejected_by_the_database(setup_test_db):
    workspace_id = await _create_workspace("unique@example.com")
    kb_id = await _create_kb(workspace_id, "Unique KB")
    agent_a = await _create_agent(workspace_id, "Unique Agent A")
    agent_b = await _create_agent(workspace_id, "Unique Agent B")
    await KbService().bind_agent(agent_a, workspace_id, kb_id)

    with pytest.raises(IntegrityError):
        async with database.AsyncSessionLocal() as session:
            await session.execute(
                text("UPDATE agents SET kb_id = :kb_id WHERE id = :agent_id"),
                {"kb_id": kb_id, "agent_id": agent_b},
            )
            await session.commit()

    async with database.AsyncSessionLocal() as session:
        assert (await session.get(Agent, agent_b)).kb_id is None

@pytest.mark.asyncio
async def test_agents_kb_id_has_a_unique_index(setup_test_db):
    """One KB ⇄ one agent is enforced by the schema, not just by the service."""
    async with database.AsyncSessionLocal() as session:
        index_names = [
            row[1]
            for row in (await session.execute(text("PRAGMA index_list('agents')"))).all()
            if row[2] == 1
        ]
        kb_id_indexes = []
        for name in index_names:
            columns = [
                row[2]
                for row in (
                    await session.execute(text(f"PRAGMA index_info('{name}')"))
                ).all()
            ]
            if columns == ["kb_id"]:
                kb_id_indexes.append(name)

    assert kb_id_indexes, f"agents.kb_id needs a unique index, found {index_names}"

@pytest.mark.asyncio
async def test_multiple_agents_can_stay_unbound(setup_test_db):
    """The unique index is partial: NULL kb_id must not collide."""
    workspace_id = await _create_workspace("partial@example.com")
    await _create_agent(workspace_id, "Unbound 1")
    await _create_agent(workspace_id, "Unbound 2")

    async with database.AsyncSessionLocal() as session:
        unbound = await session.scalar(
            select(func.count(Agent.id)).where(
                Agent.workspace_id == workspace_id, Agent.kb_id.is_(None)
            )
        )
    assert unbound == 2
