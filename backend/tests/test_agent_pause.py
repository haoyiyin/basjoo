"""Pause / resume lifecycle and the chat guard (issue #29, backend half).

Frozen contract:
- `POST /api/v1/agents/{id}:pause`  -> is_active False, deleted_at/purge_after NULL,
  `kb_id` kept, `status == "inactive"`; idempotent.
- `POST /api/v1/agents/{id}:resume` -> is_active True, `status == "active"`.
- A soft-deleted agent is 410 on both; `:restore` stays the only way back.
- `POST /api/v1/chat` on a paused agent -> 403 "Agent is paused"; on a deleted
  agent -> 410. After resume the same call reaches the API-key 400 again.
- The SSE error codes are `AGENT_PAUSED` / `AGENT_DELETED`.
- A paused agent is never the default (`/agent:default`, `/config:public`).
- `DELETE` still sets a ~7 day purge window and releases the KB.
"""

import json
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

import database
from models import Agent

PAUSED_DETAIL = "Agent is paused"
KEYLESS_DETAIL = "Agent has no LLM API key configured"


def _sse_events(body: str) -> list[tuple[str, dict]]:
    events: list[tuple[str, dict]] = []
    for raw_event in body.strip().split("\n\n"):
        if not raw_event.strip():
            continue
        name = None
        payload_lines: list[str] = []
        for line in raw_event.splitlines():
            if line.startswith("event:"):
                name = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                payload_lines.append(line.split(":", 1)[1].strip())
        events.append((name, json.loads("\n".join(payload_lines))))
    return events


async def _keyless_agent() -> str:
    """An active agent with no stored key (so chat can only reach the 400)."""
    async with database.AsyncSessionLocal() as session:
        workspace_agent = (
            await session.execute(select(Agent).order_by(Agent.created_at).limit(1))
        ).scalars().first()
        assert workspace_agent is not None

        agent = Agent(
            workspace_id=workspace_agent.workspace_id,
            name="Keyless Pausable Agent",
            model="deepseek-v4-flash",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
            api_key=None,
        )
        session.add(agent)
        await session.commit()
        return agent.id


async def _create_active_agent(client, name: str) -> dict:
    response = await client.post("/api/v1/agents", json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


async def _agent_row(agent_id: str) -> Agent:
    async with database.AsyncSessionLocal() as session:
        row = (
            await session.execute(select(Agent).where(Agent.id == agent_id))
        ).scalar_one()
        session.expunge(row)
        return row


async def test_pause_keeps_binding_and_marks_inactive(client, default_agent_id):
    before = await _agent_row(default_agent_id)
    assert before.kb_id, "fixture agent must start with a KB bound"

    response = await client.post(f"/api/v1/agents/{default_agent_id}:pause")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["is_active"] is False
    assert payload["status"] == "inactive"
    assert payload["deleted_at"] is None
    assert payload["purge_after"] is None
    assert payload["kb_id"] == before.kb_id

    row = await _agent_row(default_agent_id)
    assert row.is_active is False
    assert row.deleted_at is None
    assert row.purge_after is None
    assert row.kb_id == before.kb_id


async def test_pause_is_idempotent(client, default_agent_id):
    first = await client.post(f"/api/v1/agents/{default_agent_id}:pause")
    assert first.status_code == 200, first.text
    second = await client.post(f"/api/v1/agents/{default_agent_id}:pause")
    assert second.status_code == 200, second.text
    assert second.json()["is_active"] is False
    assert second.json()["status"] == "inactive"
    assert second.json()["deleted_at"] is None
    assert second.json()["kb_id"] == first.json()["kb_id"]


async def test_resume_reactivates(client, default_agent_id):
    await client.post(f"/api/v1/agents/{default_agent_id}:pause")
    response = await client.post(f"/api/v1/agents/{default_agent_id}:resume")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["is_active"] is True
    assert payload["status"] == "active"
    assert payload["deleted_at"] is None

    row = await _agent_row(default_agent_id)
    assert row.is_active is True
    assert row.deleted_at is None
    assert row.purge_after is None


async def test_pause_and_resume_refuse_a_deleted_agent(client, default_agent_id):
    deleted = await client.delete(f"/api/v1/agents/{default_agent_id}")
    assert deleted.status_code == 200, deleted.text

    paused = await client.post(f"/api/v1/agents/{default_agent_id}:pause")
    assert paused.status_code == 410, paused.text
    assert paused.json()["detail"] == "Agent is deleted"

    resumed = await client.post(f"/api/v1/agents/{default_agent_id}:resume")
    assert resumed.status_code == 410, resumed.text
    assert resumed.json()["detail"] == "Agent is deleted"

    # The unchanged restore path is still the one way back.
    restored = await client.post(f"/api/v1/agents/{default_agent_id}:restore")
    assert restored.status_code == 200, restored.text
    assert restored.json()["is_active"] is True


async def test_chat_refuses_a_paused_agent_and_serves_after_resume(public_client):
    """paused -> 403 "Agent is paused"; resumed -> the API-key 400."""
    agent_id = await _keyless_agent()

    keyless = await public_client.post(
        "/api/v1/chat", json={"agent_id": agent_id, "message": "Hello?"}
    )
    assert keyless.status_code == 400, keyless.text
    assert keyless.json()["detail"] == KEYLESS_DETAIL

    async with database.AsyncSessionLocal() as session:
        row = (
            await session.execute(select(Agent).where(Agent.id == agent_id))
        ).scalar_one()
        row.is_active = False
        await session.commit()

    paused = await public_client.post(
        "/api/v1/chat", json={"agent_id": agent_id, "message": "Hello?"}
    )
    assert paused.status_code == 403, paused.text
    assert paused.json()["detail"] == PAUSED_DETAIL

    async with database.AsyncSessionLocal() as session:
        row = (
            await session.execute(select(Agent).where(Agent.id == agent_id))
        ).scalar_one()
        row.is_active = True
        await session.commit()

    resumed = await public_client.post(
        "/api/v1/chat", json={"agent_id": agent_id, "message": "Hello?"}
    )
    assert resumed.status_code == 400, resumed.text
    assert resumed.json()["detail"] == KEYLESS_DETAIL


async def test_stream_reports_agent_paused(public_client):
    agent_id = await _keyless_agent()
    async with database.AsyncSessionLocal() as session:
        row = (
            await session.execute(select(Agent).where(Agent.id == agent_id))
        ).scalar_one()
        row.is_active = False
        await session.commit()

    response = await public_client.post(
        "/api/v1/chat/stream", json={"agent_id": agent_id, "message": "Hello stream?"}
    )
    assert response.status_code == 200, response.text
    events = _sse_events(response.text)
    error_events = [payload for name, payload in events if name == "error"]
    assert len(error_events) == 1, events
    assert error_events[0]["code"] == "AGENT_PAUSED"
    assert error_events[0]["error"] == "This assistant is paused"
    assert [payload for name, payload in events if name == "content"] == []


async def test_stream_reports_agent_deleted(public_client):
    agent_id = await _keyless_agent()
    async with database.AsyncSessionLocal() as session:
        row = (
            await session.execute(select(Agent).where(Agent.id == agent_id))
        ).scalar_one()
        row.is_active = False
        row.deleted_at = datetime.now(timezone.utc)
        row.purge_after = datetime.now(timezone.utc) + timedelta(days=7)
        await session.commit()

    response = await public_client.post(
        "/api/v1/chat/stream", json={"agent_id": agent_id, "message": "Hello stream?"}
    )
    assert response.status_code == 200, response.text
    events = _sse_events(response.text)
    error_events = [payload for name, payload in events if name == "error"]
    assert len(error_events) == 1, events
    assert error_events[0]["code"] == "AGENT_DELETED"
    assert error_events[0]["error"] == "This assistant is no longer available"


async def test_paused_agent_is_never_the_default(client, public_client, default_agent_id):
    second = await _create_active_agent(client, "Second Agent")

    default_before = await client.get("/api/v1/agent:default")
    assert default_before.status_code == 200, default_before.text
    assert default_before.json()["id"] == default_agent_id

    await client.post(f"/api/v1/agents/{default_agent_id}:pause")

    default_after = await client.get("/api/v1/agent:default")
    assert default_after.status_code == 200, default_after.text
    assert default_after.json()["id"] == second["id"]
    assert default_after.json()["id"] != default_agent_id

    public_config = await public_client.get("/api/v1/config:public")
    assert public_config.status_code == 200, public_config.text
    assert public_config.json()["default_agent_id"] is not None
    assert public_config.json()["default_agent_id"] != default_agent_id


async def test_delete_still_opens_the_seven_day_window(client, default_agent_id):
    before = await _agent_row(default_agent_id)
    assert before.kb_id

    response = await client.delete(f"/api/v1/agents/{default_agent_id}")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["success"] is True

    purge_after = datetime.fromisoformat(payload["purge_after"])
    if purge_after.tzinfo is None:
        purge_after = purge_after.replace(tzinfo=timezone.utc)
    expected = datetime.now(timezone.utc) + timedelta(days=7)
    assert abs((purge_after - expected).total_seconds()) < 120

    row = await _agent_row(default_agent_id)
    assert row.deleted_at is not None
    assert row.kb_id is None


def test_stream_error_code_map_covers_pause_and_delete():
    """Unit pin on the SSE mapping helpers; every old mapping stays intact."""
    from fastapi import HTTPException

    from api.v1.endpoints import get_safe_stream_error_message, get_stream_error_code

    paused = HTTPException(status_code=403, detail=PAUSED_DETAIL)
    assert get_stream_error_code(paused) == "AGENT_PAUSED"
    assert get_safe_stream_error_message("AGENT_PAUSED") == "This assistant is paused"

    deleted = HTTPException(status_code=410, detail="Agent is deleted")
    assert get_stream_error_code(deleted) == "AGENT_DELETED"
    assert (
        get_safe_stream_error_message("AGENT_DELETED")
        == "This assistant is no longer available"
    )

    # Existing mappings unchanged.
    assert (
        get_stream_error_code(HTTPException(status_code=403, detail="Request was denied"))
        == "FORBIDDEN"
    )
    assert (
        get_stream_error_code(HTTPException(status_code=403, detail="Widget origin not allowed"))
        == "ORIGIN_NOT_ALLOWED"
    )
    missing_key = HTTPException(status_code=400, detail=KEYLESS_DETAIL)
    assert get_stream_error_code(missing_key) == "API_KEY_MISSING"


@pytest.mark.asyncio
async def test_chat_guards_are_ordered_and_independent():
    """MagicMock agent: deleted_at alone -> 410; is_active alone -> 403.

    Pins the order in `prepare_chat_request`: the 410 gate runs first, so a
    soft-deleted agent never reports "paused", and the 403 gate fires on its
    own when `deleted_at is None`.
    """
    from unittest.mock import AsyncMock, MagicMock

    from fastapi import HTTPException

    from api.v1.endpoints import prepare_chat_request
    from api.v1.schemas import ChatRequest

    request = ChatRequest(
        agent_id="agent_guard", message="Hello?", session_id=None, params={}
    )
    http_request = MagicMock()
    http_request.headers.get.return_value = ""

    def _agent(deleted_at, is_active):
        agent = MagicMock()
        agent.id = "agent_guard"
        agent.deleted_at = deleted_at
        agent.is_active = is_active
        return agent

    async def _prepare(agent):
        db = AsyncMock()
        result = MagicMock()
        result.scalar_one_or_none.return_value = agent
        db.execute.return_value = result
        return await prepare_chat_request(request, http_request, db)

    # Paused only: 403, and not the 410 path.
    with pytest.raises(HTTPException) as paused:
        await _prepare(_agent(None, False))
    assert paused.value.status_code == 403
    assert paused.value.detail == PAUSED_DETAIL

    # Deleted while still flagged active: 410 wins over the pause check.
    with pytest.raises(HTTPException) as deleted:
        await _prepare(_agent(datetime.now(timezone.utc), True))
    assert deleted.value.status_code == 410
    assert deleted.value.detail == "Agent is deleted"

    # Deleted and paused: still 410 (order is fixed).
    with pytest.raises(HTTPException) as both:
        await _prepare(_agent(datetime.now(timezone.utc), False))
    assert both.value.status_code == 410

# ---- pause keeps KB ownership ---------------------------------------------
#
# Pause keeps `kb_id` (issue #29), so a paused agent is still the KB's owner:
# only `deleted_at` ends ownership. Rebind and delete must answer 409, the KB
# list must name the paused agent, and unbinding still works while paused.

async def test_paused_agent_blocks_rebinding_its_kb(client, default_agent_id, bound_kb_id):
    second = await _create_active_agent(client, "Rebind Rival")
    paused = await client.post(f"/api/v1/agents/{default_agent_id}:pause")
    assert paused.status_code == 200, paused.text

    response = await client.put(
        f"/api/v1/agents/{second['id']}/knowledge-base", json={"kb_id": bound_kb_id}
    )
    assert response.status_code == 409, response.text
    assert response.json()["detail"] == "KB is already bound to another agent"
    assert (await _agent_row(default_agent_id)).kb_id == bound_kb_id
    assert (await _agent_row(second["id"])).kb_id is None

async def test_paused_agent_blocks_kb_deletion(client, default_agent_id, bound_kb_id):
    paused = await client.post(f"/api/v1/agents/{default_agent_id}:pause")
    assert paused.status_code == 200, paused.text

    response = await client.delete(f"/api/v1/knowledge-bases/{bound_kb_id}")
    assert response.status_code == 409, response.text
    assert response.json()["detail"] == "KB is bound to an agent. Unbind it first."

    detail = await client.get(f"/api/v1/knowledge-bases/{bound_kb_id}")
    assert detail.status_code == 200, detail.text
    assert (await _agent_row(default_agent_id)).kb_id == bound_kb_id

async def test_kb_list_reports_a_paused_agent_as_bound(
    client, default_agent_id, bound_kb_id
):
    agent = await _agent_row(default_agent_id)
    paused = await client.post(f"/api/v1/agents/{default_agent_id}:pause")
    assert paused.status_code == 200, paused.text

    listed = await client.get("/api/v1/knowledge-bases")
    assert listed.status_code == 200, listed.text
    item = next(
        kb for kb in listed.json()["knowledge_bases"] if kb["id"] == bound_kb_id
    )
    assert item["bound_agent"] == {"id": default_agent_id, "name": agent.name}

async def test_paused_agent_can_still_unbind(
    client, default_agent_id, bound_kb_id
):
    second = await _create_active_agent(client, "Unbind2")
    paused = await client.post(f"/api/v1/agents/{default_agent_id}:pause")
    assert paused.status_code == 200, paused.text

    unbound = await client.put(
        f"/api/v1/agents/{default_agent_id}/knowledge-base", json={"kb_id": None}
    )
    assert unbound.status_code == 200, unbound.text
    assert (await _agent_row(default_agent_id)).kb_id is None

    bind = await client.put(
        f"/api/v1/agents/{second['id']}/knowledge-base", json={"kb_id": bound_kb_id}
    )
    assert bind.status_code == 200, bind.text
    assert bind.json()["agent"]["kb_id"] == bound_kb_id
    assert (await _agent_row(second["id"])).kb_id == bound_kb_id

async def test_deleted_agent_never_owns_or_blocks_a_kb(
    client, default_agent_id, bound_kb_id
):
    """Deleted (not paused) still releases ownership, even if the row kept kb_id."""
    second = await _create_active_agent(client, "Successor")

    async with database.AsyncSessionLocal() as session:
        row = (
            await session.execute(select(Agent).where(Agent.id == default_agent_id))
        ).scalar_one()
        row.is_active = False
        row.deleted_at = datetime.now(timezone.utc)
        row.purge_after = datetime.now(timezone.utc) + timedelta(days=7)
        # kb_id deliberately kept: a legacy delete that never cleared the binding.
        await session.commit()

    listed = await client.get("/api/v1/knowledge-bases")
    assert listed.status_code == 200, listed.text
    item = next(
        kb for kb in listed.json()["knowledge_bases"] if kb["id"] == bound_kb_id
    )
    assert item["bound_agent"] is None, "a deleted agent must not look bound"

    bind = await client.put(
        f"/api/v1/agents/{second['id']}/knowledge-base", json={"kb_id": bound_kb_id}
    )
    assert bind.status_code == 200, bind.text
    assert (await _agent_row(default_agent_id)).kb_id is None
