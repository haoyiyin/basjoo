"""`GET /api/v1/agent:kb-status` contract.

The endpoint is now *derived*: `kb_setup_completed` is true only when the agent has a
bound KB whose status is `active`. The legacy `Agent.kb_setup_completed` column is no
longer read anywhere, so an inconsistent flag can never influence the answer.
"""

import pytest
from sqlalchemy import select

import database
from models import Agent, KnowledgeBase


async def _kb_status(client, agent_id: str) -> dict:
    response = await client.get(f"/api/v1/agent:kb-status?agent_id={agent_id}")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_bound_active_kb_is_completed(client, default_agent_id, bound_kb_id):
    payload = await _kb_status(client, default_agent_id)

    assert payload["agent_id"] == default_agent_id
    assert payload["kb_id"] == bound_kb_id
    assert payload["kb_setup_completed"] is True
    assert payload["kb"] is not None
    assert payload["kb"]["id"] == bound_kb_id
    assert payload["kb"]["embedding_provider"] == "jina"
    assert payload["kb"]["embedding_model"] == "jina-embeddings-v3"
    assert payload["kb"]["status"] == "active"


@pytest.mark.asyncio
async def test_unbound_agent_is_not_completed(client, default_agent_id):
    await client.put(
        f"/api/v1/agents/{default_agent_id}/knowledge-base", json={"kb_id": None}
    )

    payload = await _kb_status(client, default_agent_id)

    assert payload["kb_id"] is None
    assert payload["kb_setup_completed"] is False
    assert payload["kb"] is None


@pytest.mark.asyncio
async def test_errored_kb_is_not_completed(client, default_agent_id, bound_kb_id):
    async with database.AsyncSessionLocal() as session:
        kb = await session.get(KnowledgeBase, bound_kb_id)
        kb.status = "error"
        kb.error_message = "provider outage"
        await session.commit()

    payload = await _kb_status(client, default_agent_id)

    assert payload["kb_id"] == bound_kb_id, "The binding itself is untouched"
    assert payload["kb_setup_completed"] is False
    assert payload["kb"]["status"] == "error"


@pytest.mark.asyncio
async def test_resetting_kb_is_not_completed(client, default_agent_id, bound_kb_id):
    async with database.AsyncSessionLocal() as session:
        kb = await session.get(KnowledgeBase, bound_kb_id)
        kb.status = "resetting"
        await session.commit()

    payload = await _kb_status(client, default_agent_id)
    assert payload["kb_setup_completed"] is False


@pytest.mark.asyncio
async def test_legacy_flag_is_ignored(client, default_agent_id):
    """A stale `kb_setup_completed=True` with no binding must still report false."""
    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, default_agent_id)
        agent.kb_id = None
        agent.kb_setup_completed = True
        await session.commit()

    payload = await _kb_status(client, default_agent_id)
    assert payload["kb_id"] is None
    assert payload["kb_setup_completed"] is False
    assert payload["kb"] is None


@pytest.mark.asyncio
async def test_stale_kb_reference_is_not_completed(client, default_agent_id):
    """A kb_id pointing at a deleted KB must report false, not crash."""
    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, default_agent_id)
        agent.kb_id = "stale-kb-id"
        agent.kb_setup_completed = True
        await session.commit()

    payload = await _kb_status(client, default_agent_id)
    assert payload["kb_id"] == "stale-kb-id"
    assert payload["kb_setup_completed"] is False
    assert payload["kb"] is None


@pytest.mark.asyncio
async def test_kb_setup_endpoints_are_gone(client, default_agent_id):
    """The old setup/reset/jina routes must not exist any more."""
    for path in (
        "/api/v1/agent:kb-setup",
        "/api/v1/agent:kb-reset",
        "/api/v1/agent:jina-key",
        "/api/v1/agent:jina-key-status",
        "/api/v1/agent:test-jina-api",
        "/api/v1/agent:test-embedding-api",
    ):
        response = await client.post(f"{path}?agent_id={default_agent_id}", json={})
        assert response.status_code in (404, 405), (
            f"{path} should be removed, got {response.status_code}"
        )
