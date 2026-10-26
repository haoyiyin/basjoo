"""Chat must refuse to run when the agent has no LLM API key (issue #19).

The bug this pins down: `prepare_chat_request` used to set `use_mock_llm = True`
whenever an agent had no key, so a production visitor silently got Mock tokens
(including the "you are talking to a mock" disclaimer) instead of a clear error.

Frozen contract:
- `POST /api/v1/chat`            -> 400, detail contains "API key"
- `POST /api/v1/chat/stream`     -> SSE `error` event, `code == "API_KEY_MISSING"`
- no Mock token is ever emitted through the stream
"""

import json

import pytest
from sqlalchemy import select

import database
from models import Agent

# Async tests are picked up by the repo-wide `asyncio_mode = auto`.

EXPECTED_DETAIL = "Agent has no LLM API key configured"


async def _keyless_agent() -> str:
    """Create an active agent with no stored key and no env fallback."""
    async with database.AsyncSessionLocal() as session:
        workspace_agent = (
            await session.execute(select(Agent).order_by(Agent.created_at).limit(1))
        ).scalars().first()
        assert workspace_agent is not None

        agent = Agent(
            workspace_id=workspace_agent.workspace_id,
            name="Keyless Agent",
            model="deepseek-v4-flash",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
            api_key=None,
        )
        session.add(agent)
        await session.commit()
        return agent.id


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


async def test_chat_without_api_key_returns_400(setup_test_db):
    """The blocking chat endpoint answers 400 with an actionable detail."""
    from main import app
    from httpx import ASGITransport, AsyncClient

    agent_id = await _keyless_agent()

    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport, base_url="http://test", timeout=30.0
    ) as public_client:
        response = await public_client.post(
            "/api/v1/chat",
            json={"agent_id": agent_id, "message": "Hello?"},
        )

    assert response.status_code == 400, response.text
    assert "API key" in response.json()["detail"]
    assert response.json()["detail"] == EXPECTED_DETAIL


async def test_chat_stream_without_api_key_reports_api_key_missing(setup_test_db):
    """Streaming reports `API_KEY_MISSING` and emits no Mock tokens."""
    from main import app
    from httpx import ASGITransport, AsyncClient

    agent_id = await _keyless_agent()

    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport, base_url="http://test", timeout=30.0
    ) as public_client:
        response = await public_client.post(
            "/api/v1/chat/stream",
            json={"agent_id": agent_id, "message": "Hello stream?"},
        )

    assert response.status_code == 200, response.text
    events = _sse_events(response.text)

    error_events = [payload for name, payload in events if name == "error"]
    assert len(error_events) == 1, events
    assert error_events[0]["code"] == "API_KEY_MISSING"
    assert error_events[0]["error"] == "Configure an LLM API key before chatting"

    # Critique: nothing from MockLLMService may reach the client.
    content_events = [payload for name, payload in events if name == "content"]
    assert content_events == []
    assert "Mock" not in response.text
    assert "AI助手" not in response.text
    assert "event: done" not in response.text


async def test_missing_key_never_builds_a_mock_llm(monkeypatch, setup_test_db):
    """`prepare_chat_request` must raise before `get_llm_service` is consulted."""
    from api.v1 import endpoints

    agent_id = await _keyless_agent()

    def _explode(**kwargs):  # pragma: no cover - must never be reached
        raise AssertionError("get_llm_service must not be called without a key")

    monkeypatch.setattr(endpoints, "get_llm_service", _explode)

    class _Request:
        headers: dict[str, str] = {}

    from api.v1.schemas import ChatRequest

    async with database.AsyncSessionLocal() as session:
        with pytest.raises(Exception) as excinfo:
            await endpoints.prepare_chat_request(
                ChatRequest(agent_id=agent_id, message="hi"), _Request(), session
            )

    assert getattr(excinfo.value, "status_code", None) == 400
    assert EXPECTED_DETAIL in str(excinfo.value.detail)


def test_stream_error_code_and_message_for_missing_api_key():
    """The SSE mapping helpers are pinned directly (no HTTP round-trip)."""
    from fastapi import HTTPException

    from api.v1.endpoints import get_safe_stream_error_message, get_stream_error_code

    error = HTTPException(status_code=400, detail=EXPECTED_DETAIL)

    code = get_stream_error_code(error)
    assert code == "API_KEY_MISSING"
    assert get_safe_stream_error_message(code) == (
        "Configure an LLM API key before chatting"
    )

    # Other 400s keep the generic code: the API-key branch must not swallow them.
    generic = HTTPException(status_code=400, detail="something else")
    assert get_stream_error_code(generic) == "BAD_REQUEST"
