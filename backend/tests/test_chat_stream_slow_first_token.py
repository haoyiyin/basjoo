"""A slow first token must pause the stream, not cancel it (LANE A / A1).

`asyncio.wait_for` cancels the awaited coroutine on timeout, so wrapping
`stream_iter.__anext__()` in `wait_for` tore the provider stream down and the
reply was replaced by the fallback. The watchdog now runs `__anext__` as its own
task and keeps waiting on that same task.
"""

import asyncio
import json
from typing import Any, AsyncIterator, Dict, Optional

import pytest
import pytest_asyncio

import database
from api.v1 import endpoints
from core.encryption import encrypt_api_key
from models import Agent


@pytest_asyncio.fixture(autouse=True, loop_scope="function")
async def chat_ready_agent(default_agent_id: str) -> str:
    """A stored key is enough: `get_llm_service` is monkeypatched below."""
    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, default_agent_id)
        assert agent is not None
        agent.api_key = encrypt_api_key("sk-test-slow-first-token")
        await session.commit()
    return default_agent_id


class _SlowFirstTokenLLM:
    """Provider stub: first token arrives after `delay` seconds."""

    def __init__(self, delay: float, chunk: str) -> None:
        self._delay = delay
        self._chunk = chunk

    async def chat_completion(self, **kwargs: Any) -> AsyncIterator[str]:
        await asyncio.sleep(self._delay)
        yield self._chunk

    def get_last_usage(self) -> Optional[Dict[str, int]]:
        return None


def _parse_sse(body: str) -> list:
    events = []
    for raw_event in body.split("\n\n"):
        if not raw_event.strip():
            continue
        event_name = None
        payload_lines = []
        for line in raw_event.splitlines():
            if line.startswith("event:"):
                event_name = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                payload_lines.append(line.split(":", 1)[1].strip())
        if event_name is None:
            continue
        events.append((event_name, json.loads("\n".join(payload_lines))))
    return events


@pytest.mark.asyncio
async def test_slow_first_token_still_streams_the_reply(
    public_client, default_agent_id, monkeypatch
) -> None:
    monkeypatch.setattr(endpoints, "STREAM_FIRST_TOKEN_TIMEOUT_SECONDS", 0.05)
    monkeypatch.setattr(
        endpoints,
        "get_llm_service",
        lambda **kwargs: _SlowFirstTokenLLM(0.2, "hello"),
    )

    response = await public_client.post(
        "/api/v1/chat/stream",
        json={"agent_id": default_agent_id, "message": "slow provider"},
    )

    assert response.status_code == 200
    body = response.text
    assert ": keepalive" in body, "the watchdog must still emit a keepalive"
    assert "event: thinking" in body, "the waiting UX must be preserved"

    events = _parse_sse(body)
    content = "".join(
        payload["content"] for name, payload in events if name == "content"
    )
    assert content == "hello"
    assert "抱歉" not in content
    assert [name for name, _ in events if name == "done"] == ["done"]
