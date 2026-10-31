"""Lane C — API semantics the clients depend on (3a, 3b, 3d).

Three separate lies are pinned here, each measured against a live stack first:

* 3a — a rate-limited turn was reported as `mode="ai"`. `prepare_chat_request`
  builds `{"mode": "rate_limited", ...}` but the blocking handler dropped it
  (`ChatResponse.mode` defaulted to `"ai"`) and the SSE handler hardcoded
  `"mode": "ai"`. Measured: `rate_limit_per_minute=2`, 6 messages in a minute →
  turn 3+ replies with the rate-limit copy and `mode: "ai"`. A client cannot
  tell a refusal from an answer, so the widget renders the refusal as a normal
  bot message. Both transports must carry `rate_limited`.

* 3b — `GET /api/v1/admin/sessions` accepted any int: `limit=-1` → 200 with
  rows, `limit=0` → 200 with none, and the SPA hardcoded `skip=0&limit=50` with
  no pager, so with `total=86` the last 36 sessions were unreachable. The
  params are now bounded (`limit` 1..200, `skip` >= 0) and `total` is what a
  pager walks.

* 3d — `GET /api/v1/agents/{agent_id}` answered 405 because only the DELETE
  route matched that path; the working form was `/agent?agent_id=`. One handler
  now serves both routes, so the two must return the same body.
"""

import json
from typing import Any, Dict, Optional

import pytest
import pytest_asyncio
from sqlalchemy import select

import database
from core.encryption import encrypt_api_key
from models import Agent, ChatSession

LIMIT = 2
RESTRICTED = "Limited — please try again shortly."


# --------------------------------------------------------------- 3a helpers


@pytest_asyncio.fixture(autouse=True, loop_scope="function")
async def chat_ready_agent(default_agent_id: str) -> str:
    """A stored key is enough: `conftest.mock_llm_service` stubs the provider."""
    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, default_agent_id)
        assert agent is not None
        agent.api_key = encrypt_api_key("sk-test-chat-mode")
        await session.commit()
    return default_agent_id


def _parse_sse(body: str) -> list[tuple[str, Dict[str, Any]]]:
    events: list[tuple[str, Dict[str, Any]]] = []
    for raw_event in body.split("\n\n"):
        if not raw_event.strip():
            continue
        name: Optional[str] = None
        payload: list[str] = []
        for line in raw_event.splitlines():
            if line.startswith("event:"):
                name = line.split(":", 1)[1].strip()
            elif line.startswith("data:"):
                payload.append(line.split(":", 1)[1].strip())
        if name is None:
            continue
        events.append((name, json.loads("\n".join(payload))))
    return events


def _sse_done(body: str) -> Dict[str, Any]:
    dones = [payload for name, payload in _parse_sse(body) if name == "done"]
    assert dones, f"no `done` event in the SSE body: {body!r}"
    return dones[-1]


async def _enable_limit(client: Any, agent_id: str, limit: int = LIMIT) -> None:
    response = await client.put(
        f"/api/v1/agent?agent_id={agent_id}",
        json={"rate_limit_per_minute": limit, "restricted_reply": RESTRICTED},
    )
    assert response.status_code == 200, response.text
    assert response.json()["rate_limit_per_minute"] == limit


async def _chat(public_client: Any, agent_id: str, **extra: Any) -> Dict[str, Any]:
    response = await public_client.post(
        "/api/v1/chat",
        json={"agent_id": agent_id, "message": "spam", **extra},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def _chat_stream(
    public_client: Any, agent_id: str, **extra: Any
) -> Dict[str, Any]:
    response = await public_client.post(
        "/api/v1/chat/stream",
        json={"agent_id": agent_id, "message": "spam", **extra},
    )
    assert response.status_code == 200, response.text
    return _sse_done(response.text)


@pytest.mark.asyncio
async def test_blocking_chat_reports_rate_limited_mode(
    client, public_client, default_agent_id
) -> None:
    """Measured before the fix: the third turn carried `mode="ai"`."""
    await _enable_limit(client, default_agent_id)

    turns = [
        await _chat(public_client, default_agent_id, visitor_id="mode-probe")
        for _ in range(LIMIT + 1)
    ]

    answered, refused = turns[:LIMIT], turns[-1]
    assert refused["reply"] == RESTRICTED, "the rate-limit copy answered the turn"
    assert refused["mode"] == "rate_limited", (
        "a refusal must not be reported as an AI answer"
    )
    assert all(turn["mode"] != "rate_limited" for turn in answered), (
        "the turns under the limit are real answers"
    )


@pytest.mark.asyncio
async def test_streaming_chat_reports_rate_limited_mode(
    client, public_client, default_agent_id
) -> None:
    """Measured before the fix: the `done` event hardcoded `"mode": "ai"`."""
    await _enable_limit(client, default_agent_id)

    dones = [
        await _chat_stream(public_client, default_agent_id, visitor_id="mode-probe")
        for _ in range(LIMIT + 1)
    ]

    answered, refused = dones[:LIMIT], dones[-1]
    assert refused["mode"] == "rate_limited", (
        "the SSE `done` event must carry the same marker as the blocking body"
    )
    assert refused["message_id"] is None, "a refusal persists no assistant turn"
    assert all(done["mode"] != "rate_limited" for done in answered)


@pytest.mark.asyncio
async def test_both_transports_agree_on_the_marker(
    client, public_client, default_agent_id
) -> None:
    """The two transports must not drift: one refusal, one spelling."""
    await _enable_limit(client, default_agent_id, limit=1)

    # The first turn is under the limit; the next two are refusals, one per
    # transport, so the comparison is refusal-vs-refusal.
    warmup = await _chat(public_client, default_agent_id, visitor_id="agree-probe")
    assert warmup["mode"] != "rate_limited", "the warm-up turn is a real answer"

    blocking = await _chat(public_client, default_agent_id, visitor_id="agree-probe")
    streamed = await _chat_stream(
        public_client, default_agent_id, visitor_id="agree-probe"
    )

    assert blocking["mode"] == streamed["mode"] == "rate_limited"


# --------------------------------------------------------------- 3b helpers


async def _seed_sessions(agent_id: str, count: int) -> None:
    async with database.AsyncSessionLocal() as session:
        for index in range(count):
            session.add(
                ChatSession(
                    id=f"sess_pager_{index:03d}",
                    agent_id=agent_id,
                    session_id=f"sess_pager_public_{index:03d}",
                    status="active",
                    mode="ai",
                    visitor_id=f"pager-visitor-{index:03d}",
                )
            )
        await session.commit()


@pytest.mark.asyncio
@pytest.mark.parametrize("query", ["limit=-1", "limit=0", "limit=201", "skip=-1"])
async def test_session_paging_params_are_validated(
    client, default_agent_id, query: str
) -> None:
    """Measured before the fix: `limit=-1` returned 200 with rows, `limit=0` 200
    with none. Both are now a 422 instead of a silently different result set."""
    response = await client.get(f"/api/v1/admin/sessions?{query}")
    assert response.status_code == 422, (
        f"{query} must be rejected, got {response.status_code}: {response.text}"
    )


@pytest.mark.asyncio
async def test_every_session_is_reachable_by_paging(client, default_agent_id) -> None:
    """The SPA hardcoded `skip=0&limit=50`; with `total=86` the last 36 rows were
    unreachable. Walking `skip` by `limit` must reach `total` rows."""
    await _seed_sessions(default_agent_id, 60)

    first = await client.get("/api/v1/admin/sessions?skip=0&limit=50")
    assert first.status_code == 200, first.text
    first_body = first.json()
    assert first_body["total"] >= 60
    assert len(first_body["items"]) == 50, "a page is exactly `limit` rows"

    seen = {row["id"] for row in first_body["items"]}
    skip = 50
    while skip < first_body["total"]:
        page = await client.get(f"/api/v1/admin/sessions?skip={skip}&limit=50")
        assert page.status_code == 200, page.text
        body = page.json()
        assert body["total"] == first_body["total"], "`total` is page-independent"
        seen.update(row["id"] for row in body["items"])
        skip += 50

    assert len(seen) == first_body["total"], (
        "walking `skip` must enumerate every session, not the first page twice"
    )
    assert len(seen) > 50, "the fixture must exceed one page for this to mean anything"


@pytest.mark.asyncio
async def test_paging_composes_with_the_status_filter(client, default_agent_id) -> None:
    """Filters already compose with `skip`/`limit`; pin it so a pager cannot
    silently drop them."""
    await _seed_sessions(default_agent_id, 5)
    async with database.AsyncSessionLocal() as session:
        rows = (
            await session.execute(
                select(ChatSession).where(ChatSession.id.like("sess_pager_%"))
            )
        ).scalars().all()
        for index, row in enumerate(rows):
            row.status = "resolved" if index % 2 else "active"
        await session.commit()

    filtered = await client.get(
        "/api/v1/admin/sessions?status=resolved&skip=0&limit=50"
    )
    assert filtered.status_code == 200, filtered.text
    body = filtered.json()
    assert body["items"], "the filter must still return the matching rows"
    assert all(row["status"] == "resolved" for row in body["items"])


# --------------------------------------------------------------- 3d

@pytest.mark.asyncio
async def test_agents_path_serves_the_same_agent_as_the_query_form(
    client, default_agent_id
) -> None:
    """Measured before the fix: `GET /api/v1/agents/{id}` → 405, because only the
    DELETE route matched that path."""
    by_path = await client.get(f"/api/v1/agents/{default_agent_id}")
    assert by_path.status_code == 200, (
        f"the REST-looking path must answer, got {by_path.status_code}: {by_path.text}"
    )

    by_query = await client.get(f"/api/v1/agent?agent_id={default_agent_id}")
    assert by_query.status_code == 200, by_query.text

    assert by_path.json() == by_query.json(), (
        "one handler, two routes: the bodies must be identical"
    )
    assert by_path.json()["id"] == default_agent_id


@pytest.mark.asyncio
async def test_agents_path_keeps_the_unknown_id_404(client) -> None:
    """The alias must not turn a missing agent into a 200 or a 405."""
    response = await client.get("/api/v1/agents/agt_does_not_exist")
    assert response.status_code == 404, response.text
