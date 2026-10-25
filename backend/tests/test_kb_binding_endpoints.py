"""Binding contract for `PUT /api/v1/agents/{agent_id}/knowledge-base`.

The KB lifecycle is decoupled from agents: binding, rebinding and unbinding never
touch the KB's contents, and one KB is bound to at most one agent.
"""

from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import func, select

import database
from models import Agent, KbChunk, KbDocument, KnowledgeBase


async def _make_second_agent(workspace_id: int | None = None) -> str:
    async with database.AsyncSessionLocal() as session:
        if workspace_id is None:
            first_agent = (
                await session.execute(
                    select(Agent).where(Agent.is_active).order_by(Agent.created_at)
                )
            ).scalars().first()
            assert first_agent is not None
            workspace_id = first_agent.workspace_id

        agent = Agent(
            workspace_id=workspace_id,
            name="Second Agent",
            description="Binding test agent",
            model="deepseek-v4-flash",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
        )
        session.add(agent)
        await session.commit()
        return agent.id


async def _seed_document(kb_id: str, filename: str = "notes.txt") -> tuple[str, str]:
    """Insert one KbDocument + one KbChunk, returning (doc_id, chunk_id)."""
    async with database.AsyncSessionLocal() as session:
        doc = KbDocument(
            kb_id=kb_id,
            filename=filename,
            file_type="txt",
            status="ready",
            chunk_count=1,
            file_size=42,
            storage_path="/tmp/basjoo-binding-test.txt",
        )
        session.add(doc)
        await session.flush()
        chunk = KbChunk(kb_id=kb_id, doc_id=doc.id, vector_id="vec-bind", chunk_index=0)
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


@pytest.mark.asyncio
async def test_bind_sets_agent_kb_id(client, default_agent_id, unbound_kb_id):
    response = await client.put(
        f"/api/v1/agents/{default_agent_id}/knowledge-base",
        json={"kb_id": unbound_kb_id},
    )

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["agent"]["kb_id"] == unbound_kb_id
    assert data["agent"]["kb_name"] == "Unbound Test KB"
    assert data["knowledge_base"]["id"] == unbound_kb_id
    assert data["knowledge_base"]["bound_agent"]["id"] == default_agent_id

    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, default_agent_id)
        assert agent.kb_id == unbound_kb_id


@pytest.mark.asyncio
async def test_bind_kb_already_bound_to_other_agent_conflicts(
    client, default_agent_id, bound_kb_id
):
    other_agent_id = await _make_second_agent()

    response = await client.put(
        f"/api/v1/agents/{other_agent_id}/knowledge-base",
        json={"kb_id": bound_kb_id},
    )

    assert response.status_code == 409
    assert "already bound" in response.json()["detail"].lower()

    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, other_agent_id)
        assert agent.kb_id is None


@pytest.mark.asyncio
async def test_bind_same_kb_twice_is_idempotent(client, default_agent_id, bound_kb_id):
    response = await client.put(
        f"/api/v1/agents/{default_agent_id}/knowledge-base",
        json={"kb_id": bound_kb_id},
    )

    assert response.status_code == 200, response.text
    assert response.json()["agent"]["kb_id"] == bound_kb_id


@pytest.mark.asyncio
async def test_unbind_keeps_documents_and_chunks(
    client, default_agent_id, bound_kb_id, monkeypatch
):
    await _seed_document(bound_kb_id)
    before = await _counts(bound_kb_id)
    assert before == (1, 1)

    delete_points = AsyncMock(return_value=0)
    monkeypatch.setattr(
        "services.qdrant_service.QdrantKbService.delete_points_by_doc_id", delete_points
    )
    delete_collection = AsyncMock(return_value=True)
    monkeypatch.setattr(
        "services.qdrant_service.QdrantKbService.delete_collection", delete_collection
    )

    response = await client.put(
        f"/api/v1/agents/{default_agent_id}/knowledge-base", json={"kb_id": None}
    )

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["agent"]["kb_id"] is None
    assert data["knowledge_base"] is None

    after = await _counts(bound_kb_id)
    assert after == before, "Unbinding must not delete any content"
    delete_points.assert_not_called()
    delete_collection.assert_not_called()

    async with database.AsyncSessionLocal() as session:
        assert await session.get(KnowledgeBase, bound_kb_id) is not None


@pytest.mark.asyncio
async def test_rebind_to_second_kb_keeps_first_kb_rows(
    client, default_agent_id, bound_kb_id, unbound_kb_id
):
    await _seed_document(bound_kb_id)
    before = await _counts(bound_kb_id)

    response = await client.put(
        f"/api/v1/agents/{default_agent_id}/knowledge-base",
        json={"kb_id": unbound_kb_id},
    )

    assert response.status_code == 200, response.text
    assert response.json()["agent"]["kb_id"] == unbound_kb_id

    assert await _counts(bound_kb_id) == before
    async with database.AsyncSessionLocal() as session:
        first_kb = await session.get(KnowledgeBase, bound_kb_id)
        assert first_kb is not None, "The previous KB survives the rebind"
        assert first_kb.status == "active"


@pytest.mark.asyncio
async def test_unbind_then_bind_to_agent_b_reads_agent_a_content(
    client, default_agent_id, bound_kb_id, monkeypatch
):
    """Contents travel with the KB: after A→B the new agent retrieves A's chunks."""
    doc_id, _ = await _seed_document(bound_kb_id, filename="agent-a-content.txt")
    other_agent_id = await _make_second_agent()

    # A's KB is released, then B takes it.
    unbind = await client.put(
        f"/api/v1/agents/{default_agent_id}/knowledge-base", json={"kb_id": None}
    )
    assert unbind.status_code == 200
    rebind = await client.put(
        f"/api/v1/agents/{other_agent_id}/knowledge-base",
        json={"kb_id": bound_kb_id},
    )
    assert rebind.status_code == 200, rebind.text

    async def fake_embed_texts(self, texts, model, base_url, api_key=None):
        return [[0.02] * 1024 for _ in texts]

    monkeypatch.setattr(
        "services.document_parser.DocumentParser.embed_texts", fake_embed_texts
    )

    async def fake_search_kb(self, kb_id, query_vector, top_k=5):
        assert kb_id == bound_kb_id
        return [
            {
                "score": 0.91,
                "payload": {
                    "text": "Agent A knowledge chunk",
                    "doc_id": doc_id,
                    "chunk_index": 0,
                    "filename": "agent-a-content.txt",
                    "source_type": "file",
                },
            }
        ]

    monkeypatch.setattr(
        "services.qdrant_service.QdrantKbService.search_kb", fake_search_kb
    )
    # No session-factory patch is needed: `KbRetrievalService` does `import database`
    # and calls `database.AsyncSessionLocal()` at request time, so it already picks up
    # the per-test database that `setup_test_db` installed via `configure_database`.
    # (The previous patch targeted a module-level `AsyncSessionLocal` that the service
    # no longer imports — it never had the attribute, so the test errored at setup.)

    from services.kb_retrieval_service import KbRetrievalService

    results = await KbRetrievalService().retrieve(
        agent_id=other_agent_id, query="anything", top_k=5, threshold=0.1
    )

    assert results, "Agent B must retrieve the content that came with the KB"
    assert results[0]["text"] == "Agent A knowledge chunk"


@pytest.mark.asyncio
async def test_bind_missing_kb_returns_404(client, default_agent_id):
    response = await client.put(
        f"/api/v1/agents/{default_agent_id}/knowledge-base",
        json={"kb_id": "kb_does_not_exist"},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_bind_inactive_kb_returns_400(client, default_agent_id):
    from tests.conftest import make_test_kb

    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, default_agent_id)
        broken_kb = make_test_kb(agent.workspace_id, "Broken KB", status="error")
        session.add(broken_kb)
        await session.commit()
        broken_kb_id = broken_kb.id

    response = await client.put(
        f"/api/v1/agents/{default_agent_id}/knowledge-base",
        json={"kb_id": broken_kb_id},
    )

    assert response.status_code == 400
    assert "not active" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_bind_kb_from_other_workspace_returns_404(client, default_agent_id):
    from models import Workspace
    from tests.conftest import make_test_kb

    async with database.AsyncSessionLocal() as session:
        other_workspace = Workspace(
            name="Third Workspace", owner_email="third@example.com"
        )
        session.add(other_workspace)
        await session.flush()
        foreign_kb = make_test_kb(other_workspace.id, "Foreign KB 2")
        session.add(foreign_kb)
        await session.commit()
        foreign_kb_id = foreign_kb.id

    response = await client.put(
        f"/api/v1/agents/{default_agent_id}/knowledge-base",
        json={"kb_id": foreign_kb_id},
    )
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_bind_agent_from_other_workspace_is_forbidden(
    client, bound_kb_id, unbound_kb_id
):
    from models import Workspace

    async with database.AsyncSessionLocal() as session:
        other_workspace = Workspace(
            name="Fourth Workspace", owner_email="fourth@example.com"
        )
        session.add(other_workspace)
        await session.flush()
        foreign_agent = Agent(
            workspace_id=other_workspace.id,
            name="Foreign Agent",
            model="deepseek-v4-flash",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
        )
        session.add(foreign_agent)
        await session.commit()
        foreign_agent_id = foreign_agent.id

    response = await client.put(
        f"/api/v1/agents/{foreign_agent_id}/knowledge-base",
        json={"kb_id": unbound_kb_id},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_kb_status_is_derived_from_binding(
    client, default_agent_id, bound_kb_id
):
    bound = await client.get(f"/api/v1/agent:kb-status?agent_id={default_agent_id}")
    assert bound.status_code == 200
    payload = bound.json()
    assert payload["agent_id"] == default_agent_id
    assert payload["kb_id"] == bound_kb_id
    assert payload["kb_setup_completed"] is True
    assert payload["kb"]["id"] == bound_kb_id

    await client.put(
        f"/api/v1/agents/{default_agent_id}/knowledge-base", json={"kb_id": None}
    )

    unbound = await client.get(f"/api/v1/agent:kb-status?agent_id={default_agent_id}")
    payload = unbound.json()
    assert payload["kb_id"] is None
    assert payload["kb_setup_completed"] is False
    assert payload["kb"] is None


# ── Deleting an agent must free its KB ───────────────────────────────────────
#
# `DELETE /api/v1/agents/{id}` is a soft delete: the row survives for 7 days with
# `deleted_at` set. `agents.kb_id` is UNIQUE, so if the delete left the column
# pointing at the KB, the KB could never be bound to anyone else — not until the
# purge job removed the row — and `bound_agent` would keep naming a deleted agent.
# Deleting an agent therefore clears the binding immediately; the KB row and its
# documents/chunks are untouched (that is the point of decoupling).

async def _create_agent_via_api(client, name: str = "FreedAgent") -> str:
    response = await client.post(
        "/api/v1/agents",
        json={"name": name, "description": "KB release test agent"},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


@pytest.mark.asyncio
async def test_delete_agent_unbinds_kb_and_keeps_its_contents(
    client, default_agent_id, unbound_kb_id
):
    await _seed_document(unbound_kb_id, filename="survives-agent-delete.txt")
    before = await _counts(unbound_kb_id)
    assert before == (1, 1)

    bind = await client.put(
        f"/api/v1/agents/{default_agent_id}/knowledge-base",
        json={"kb_id": unbound_kb_id},
    )
    assert bind.status_code == 200, bind.text
    assert bind.json()["knowledge_base"]["bound_agent"]["id"] == default_agent_id

    detail_before = await client.get(f"/api/v1/knowledge-bases/{unbound_kb_id}")
    assert detail_before.status_code == 200
    assert detail_before.json()["bound_agent"]["id"] == default_agent_id
    assert detail_before.json()["document_count"] == before[0]

    deleted = await client.delete(f"/api/v1/agents/{default_agent_id}")
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["success"] is True
    assert deleted.json()["purge_after"]

    detail_after = await client.get(f"/api/v1/knowledge-bases/{unbound_kb_id}")
    assert detail_after.status_code == 200, detail_after.text
    payload = detail_after.json()
    assert payload["bound_agent"] is None, "a soft-deleted agent must not look bound"
    assert payload["document_count"] == before[0], "the KB keeps its documents"
    assert payload["total_chunks"] == before[1], "the KB keeps its chunks"

    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, default_agent_id)
        assert agent.deleted_at is not None, "delete is still a soft delete"
        assert agent.kb_id is None, "the binding is cleared on delete"
        kb = await session.get(KnowledgeBase, unbound_kb_id)
        assert kb is not None, "the KB row itself is never deleted"
        assert kb.status == "active"

    listed = await client.get("/api/v1/knowledge-bases")
    assert listed.status_code == 200
    listed_kb = next(
        item for item in listed.json()["knowledge_bases"] if item["id"] == unbound_kb_id
    )
    assert listed_kb["bound_agent"] is None


@pytest.mark.asyncio
async def test_deleted_agents_kb_can_be_bound_to_a_new_agent(
    client, default_agent_id, unbound_kb_id
):
    """The regression that matters: before the fix this failed with a 409."""
    second_agent_id = await _create_agent_via_api(client, "Successor")

    bind = await client.put(
        f"/api/v1/agents/{default_agent_id}/knowledge-base",
        json={"kb_id": unbound_kb_id},
    )
    assert bind.status_code == 200, bind.text

    deleted = await client.delete(f"/api/v1/agents/{default_agent_id}")
    assert deleted.status_code == 200, deleted.text

    rebind = await client.put(
        f"/api/v1/agents/{second_agent_id}/knowledge-base",
        json={"kb_id": unbound_kb_id},
    )
    assert rebind.status_code == 200, rebind.text
    assert rebind.json()["agent"]["kb_id"] == unbound_kb_id
    assert rebind.json()["knowledge_base"]["bound_agent"]["id"] == second_agent_id

    detail = await client.get(f"/api/v1/knowledge-bases/{unbound_kb_id}")
    assert detail.json()["bound_agent"] == {
        "id": second_agent_id,
        "name": "Successor",
    }

    legacy_status = await client.get(
        f"/api/v1/agent:kb-status?agent_id={default_agent_id}"
    )
    assert legacy_status.status_code == 410, "a deleted agent stays gone for the UI"


@pytest.mark.asyncio
async def test_restored_agent_comes_back_unbound_while_kb_survives(
    client, default_agent_id, unbound_kb_id
):
    await _seed_document(unbound_kb_id, filename="restore-survivor.txt")
    before = await _counts(unbound_kb_id)

    bind = await client.put(
        f"/api/v1/agents/{default_agent_id}/knowledge-base",
        json={"kb_id": unbound_kb_id},
    )
    assert bind.status_code == 200, bind.text
    assert (await client.delete(f"/api/v1/agents/{default_agent_id}")).status_code == 200

    restore = await client.post(f"/api/v1/agents/{default_agent_id}:restore")
    assert restore.status_code == 200, restore.text
    restored = restore.json()
    assert restored["is_active"] is True
    assert restored["kb_id"] is None, "a restored agent comes back unbound"

    status = await client.get(f"/api/v1/agent:kb-status?agent_id={default_agent_id}")
    assert status.status_code == 200
    assert status.json()["kb_id"] is None
    assert status.json()["kb_setup_completed"] is False
    assert status.json()["kb"] is None

    detail = await client.get(f"/api/v1/knowledge-bases/{unbound_kb_id}")
    assert detail.status_code == 200, detail.text
    payload = detail.json()
    assert payload["bound_agent"] is None
    assert payload["document_count"] == before[0]
    assert payload["total_chunks"] == before[1]
    assert await _counts(unbound_kb_id) == before, "the KB files are still there"

    # And the now-unbound KB is bindable again by the restored agent.
    rebind = await client.put(
        f"/api/v1/agents/{default_agent_id}/knowledge-base",
        json={"kb_id": unbound_kb_id},
    )
    assert rebind.status_code == 200, rebind.text
    assert rebind.json()["agent"]["kb_id"] == unbound_kb_id


@pytest.mark.asyncio
async def test_bind_heals_binding_left_by_a_soft_deleted_agent(
    client, unbound_kb_id
):
    """Rows written before the delete-clear fix must not wedge the KB forever.

    A soft-deleted agent that still points at the KB keeps the UNIQUE index busy,
    so `bind_agent` releases such stale pointers before checking for a conflict.
    The row is created directly here to simulate pre-fix data.
    """
    from tests.conftest import make_test_kb

    successor_id = await _create_agent_via_api(client, "Healer")

    async with database.AsyncSessionLocal() as session:
        live_agent = (
            await session.execute(
                select(Agent).where(
                    Agent.is_active.is_(True), Agent.deleted_at.is_(None)
                )
            )
        ).scalars().first()
        stub_kb = make_test_kb(live_agent.workspace_id, "Stale Pointer KB")
        session.add(stub_kb)
        await session.flush()
        now = datetime.now(timezone.utc)
        stale = Agent(
            workspace_id=live_agent.workspace_id,
            name="StaleAgent",
            model="deepseek-v4-flash",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
            is_active=False,
            deleted_at=now,
            kb_id=stub_kb.id,
        )
        session.add(stale)
        await session.commit()
        stale_id, stale_kb_id = stale.id, stub_kb.id

    rebind = await client.put(
        f"/api/v1/agents/{successor_id}/knowledge-base",
        json={"kb_id": stale_kb_id},
    )
    assert rebind.status_code == 200, rebind.text
    assert rebind.json()["knowledge_base"]["bound_agent"]["id"] == successor_id

    async with database.AsyncSessionLocal() as session:
        assert (await session.get(Agent, stale_id)).kb_id is None
        assert await session.get(KnowledgeBase, stale_kb_id) is not None
