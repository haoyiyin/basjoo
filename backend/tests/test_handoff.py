"""Issue #43 — human handoff: reply without takeover, release, resolve, reopen.

Contract C3 restated, because every assertion below hangs off it:

    should_ai_answer(session) is True only when
        session.status == "active" AND session.mode == "ai".

`resolved` is deliberately NOT `closed`: an operator closing the question and the
inactivity timeout are different states and must stay distinguishable in the
session list. `closed` is a pre-existing value, so an old row must keep
rendering.

The chat-path assertions drive the real `prepare_chat_request` (the single gate
both `/chat` and `/chat/stream` use) and then assert on persisted rows, so a
regression in the gate shows up as "the bot answered" rather than as a unit-test
failure of a helper.
"""

import json
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

import database
from models import Agent, ChatMessage, ChatSession, Workspace, WorkspaceQuota
from services.session_state import should_ai_answer
from tests.qa_fakes import fake_qa_index, make_http_request

# ---------------------------------------------------------------- helpers


async def _prepare(agent_id: str, session_public_id: str, message: str, visitor_id: str = "v1"):
    """Run the real gate the way both chat endpoints do."""
    from api.v1.endpoints import prepare_chat_request
    from api.v1.schemas import ChatRequest

    request = ChatRequest(
        agent_id=agent_id,
        message=message,
        session_id=session_public_id,
        visitor_id=visitor_id,
        params={},
    )
    async with database.AsyncSessionLocal() as db:
        return await prepare_chat_request(request, make_http_request(), db)


async def _chat(public_client, agent_id: str, session_public_id: str, message: str, visitor_id: str = "v1"):
    """One full visitor turn through `POST /api/v1/chat` (mocked LLM).

    Used where the *persistence* is the point: the gate decides in
    `prepare_chat_request`, but the visitor message is written by the endpoint's
    no-answer path, so only the real request proves nothing was lost.
    """
    return await public_client.post(
        "/api/v1/chat",
        json={
            "agent_id": agent_id,
            "message": message,
            "session_id": session_public_id,
            "visitor_id": visitor_id,
        },
    )


async def _seed_session(agent_id: str, public_id: str, **kwargs) -> str:
    """Insert a session directly and return its database id."""
    async with database.AsyncSessionLocal() as db:
        row = ChatSession(
            agent_id=agent_id,
            session_id=public_id,
            visitor_id=kwargs.pop("visitor_id", "v1"),
            **kwargs,
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
        return row.id


async def _session_by_public_id(public_id: str) -> ChatSession:
    async with database.AsyncSessionLocal() as db:
        row = await db.scalar(
            select(ChatSession)
            .where(ChatSession.session_id == public_id)
            .order_by(ChatSession.created_at.desc(), ChatSession.id.desc())
        )
        assert row is not None, f"session {public_id} should exist"
        return row


async def _assistant_message_count(session_db_id: str) -> int:
    async with database.AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                select(ChatMessage).where(
                    ChatMessage.session_id == session_db_id,
                    ChatMessage.role == "assistant",
                )
            )
        ).scalars().all()
        return len(rows)


def _sse_events(body: str) -> list[tuple[str, dict]]:
    """Parse an SSE body into `(event_name, payload)` pairs."""
    events: list[tuple[str, dict]] = []
    name = ""
    for line in body.splitlines():
        if line.startswith("event:"):
            name = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            raw = line.split(":", 1)[1].strip()
            try:
                events.append((name, json.loads(raw)))
            except json.JSONDecodeError:
                events.append((name, {"raw": raw}))
    return events

def _sse_done(body: str) -> dict:
    """The single `done` payload of a streamed turn."""
    done = [payload for name, payload in _sse_events(body) if name == "done"]
    assert len(done) == 1, f"expected exactly one done event, got {done}"
    return done[0]

async def _message_contents(session_db_id: str) -> list[str]:
    async with database.AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                select(ChatMessage)
                .where(ChatMessage.session_id == session_db_id)
                .order_by(ChatMessage.id.asc())
            )
        ).scalars().all()
        return [row.content for row in rows]


async def _set_agent(agent_id: str, **fields) -> None:
    """Patch the agent row directly: these tests are about the gate, not the edit API."""
    async with database.AsyncSessionLocal() as db:
        agent = await db.scalar(select(Agent).where(Agent.id == agent_id))
        assert agent is not None
        for key, value in fields.items():
            setattr(agent, key, value)
        await db.commit()


# A fixed instant so the assertions never depend on the wall clock: Monday
# 2024-03-04 01:30 Shanghai = Sunday 2024-03-03 17:30 UTC.
FROZEN_NOW = datetime(2024, 3, 4, 1, 30, tzinfo=ZoneInfo("Asia/Shanghai"))

# Closed at FROZEN_NOW: the same one-hour window, but on Tuesday (weekday 1)
# while FROZEN_NOW is Monday 01:30 Shanghai.
CLOSED_WINDOW = {
    "timezone": "Asia/Shanghai",
    "schedule": [{"day": 1, "start": 60, "end": 120}],
}


# ------------------------------------------- 1. reply is not a takeover


@pytest.mark.asyncio
async def test_reply_without_takeover_mutes_the_bot_until_release(
    client, public_client, default_agent_id, fake_qa_index
):
    """Assertion 1: reply → visitor message persisted, NO assistant message.

    `status` must stay `active` (reply is not a takeover) while `mode` becomes
    `human`, and only `release` makes `should_ai_answer` true again.
    """
    public_id = "sess_reply_no_takeover"
    session_db_id = await _seed_session(default_agent_id, public_id)

    reply = await client.post(
        f"/api/v1/admin/sessions/{session_db_id}/reply",
        json={"message": "人工回复：我来看一下。"},
    )
    assert reply.status_code == 200, reply.text
    body = reply.json()
    assert body["message_id"]
    assert body["session"]["status"] == "active", "reply must not change status"
    assert body["session"]["mode"] == "human"
    assert body["session"]["human_replied_at"], "first human message stamps the time"

    session = await _session_by_public_id(public_id)
    assert session.status == "active"
    assert session.mode == "human"
    assert should_ai_answer(session) is False

    # The visitor writes; the message is stored and the bot stays silent.
    visitor_turn = await _chat(
        public_client, default_agent_id, public_id, "访客在人工回复之后的消息。"
    )
    assert visitor_turn.status_code == 200, visitor_turn.text
    assert visitor_turn.json()["taken_over"] is True
    assert visitor_turn.json()["reply"] == "", "the bot answers nothing"
    assert visitor_turn.json()["mode"] == "human"
    assert visitor_turn.json()["no_answer_reason"] == "human"

    contents = await _message_contents(session_db_id)
    assert "访客在人工回复之后的消息。" in contents, "the visitor message is persisted"
    assert await _assistant_message_count(session_db_id) == 1, (
        "only the operator's reply is an assistant message; the bot produced none"
    )

    # Release → the gate opens again.
    released = await client.post(f"/api/v1/admin/sessions/{session_db_id}/release")
    assert released.status_code == 200, released.text
    assert released.json()["session"]["mode"] == "ai"
    assert released.json()["session"]["status"] == "active"

    session = await _session_by_public_id(public_id)
    assert should_ai_answer(session) is True

    after = await _prepare(default_agent_id, public_id, "继续由 AI 回答。")
    assert "messages" in after, "the bot answers again after release"


@pytest.mark.asyncio
async def test_stream_gate_silences_every_no_answer_state(
    client, public_client, default_agent_id, fake_qa_index
):
    """The contract says `/chat/stream` honours the gate too.

    `/chat` is covered above; this pins the SSE path, whose `done` payload must
    carry both `mode` and the machine-readable reason so the widget can render
    the right notice without guessing.

    `closed` is deliberately NOT in this list. A `closed` row is *retired*, not
    muted: `get_or_create_chat_session` skips it (pre-existing behaviour) and the
    returning visitor gets a fresh active session, which the bot answers. The
    contract only asks that closed rows keep *rendering* in the admin list, which
    `test_existing_closed_rows_keep_rendering` covers. That retirement is
    asserted separately below so the distinction is pinned rather than implied.
    """
    public_id = "sess_stream_gate"
    session_db_id = await _seed_session(default_agent_id, public_id)

    # `active` + `ai` answers normally, so the stream has a baseline.
    ok = await public_client.post(
        "/api/v1/chat/stream",
        json={
            "agent_id": default_agent_id,
            "message": "正常提问。",
            "session_id": public_id,
            "visitor_id": "v1",
        },
    )
    assert ok.status_code == 200, ok.text
    assert _sse_done(ok.text)["mode"] == "ai"

    for state in ("taken_over", "resolved", "paused"):
        async with database.AsyncSessionLocal() as db:
            row = await db.get(ChatSession, session_db_id)
            row.status = state
            row.mode = "human" if state == "taken_over" else "ai"
            await db.commit()

        response = await public_client.post(
            "/api/v1/chat/stream",
            json={
                "agent_id": default_agent_id,
                "message": f"在 {state} 状态下提问。",
                "session_id": public_id,
                "visitor_id": "v1",
            },
        )
        assert response.status_code == 200, response.text
        events = _sse_events(response.text)
        assert [payload for name, payload in events if name == "content"] == [], (
            f"{state}: the bot must answer nothing"
        )
        done = _sse_done(response.text)
        assert done["taken_over"] is True, state
        # `no_answer_reason` is the status token when a status blocks the answer,
        # and only falls back to "human" for a bare `mode="human"` session.
        assert done["no_answer_reason"] == state

    # Every visitor message was persisted even though nothing was answered.
    contents = await _message_contents(session_db_id)
    for state in ("taken_over", "resolved", "paused"):
        assert f"在 {state} 状态下提问。" in contents, state

@pytest.mark.asyncio
async def test_a_closed_session_is_retired_rather_than_muted(
    client, public_client, default_agent_id, fake_qa_index
):
    """A `closed` row is the inactivity timeout, so it is *retired*.

    `get_or_create_chat_session` filters `status != "closed"`, so the returning
    visitor is handed a fresh active row and the bot answers. Muting a retired
    conversation forever would be a behaviour change beyond #43.
    """
    public_id = "sess_retired"
    session_db_id = await _seed_session(default_agent_id, public_id, status="closed")

    response = await public_client.post(
        "/api/v1/chat/stream",
        json={
            "agent_id": default_agent_id,
            "message": "会话超时后再次提问。",
            "session_id": public_id,
            "visitor_id": "v1",
        },
    )
    assert response.status_code == 200, response.text
    assert [payload for name, payload in _sse_events(response.text) if name == "content"], (
        "a retired session must not silence the bot"
    )

    async with database.AsyncSessionLocal() as db:
        rows = (
            await db.execute(
                select(ChatSession)
                .where(ChatSession.session_id == public_id)
                .order_by(ChatSession.created_at.asc())
            )
        ).scalars().all()

    assert len(rows) == 2, "a fresh row is minted next to the retired one"
    assert rows[0].id == session_db_id
    assert rows[0].status == "closed", "the old row is untouched"
    assert rows[1].status == "active"
    assert rows[1].id != session_db_id

# ------------------------------------------- 2. visitor can return to AI


@pytest.mark.asyncio
async def test_release_lets_the_visitor_talk_to_the_bot_again(
    client, public_client, default_agent_id, fake_qa_index
):
    """Assertion 2: after `release`, a visitor message produces an assistant answer."""
    public_id = "sess_release_returns_to_ai"
    session_db_id = await _seed_session(
        default_agent_id, public_id, status="active", mode="human"
    )

    blocked = await _chat(public_client, default_agent_id, public_id, "还在人工吗？")
    assert blocked.status_code == 200, blocked.text
    assert blocked.json()["taken_over"] is True
    assert await _assistant_message_count(session_db_id) == 0

    released = await client.post(f"/api/v1/admin/sessions/{session_db_id}/release")
    assert released.status_code == 200, released.text

    allowed = await _chat(public_client, default_agent_id, public_id, "现在可以问 AI 了吗？")
    assert allowed.status_code == 200, allowed.text
    payload = allowed.json()
    assert payload["taken_over"] is False
    assert payload["reply"], "the bot answers again after release"
    assert await _assistant_message_count(session_db_id) == 1


# ------------------------------------------- 3/4. resolved vs closed


@pytest.mark.asyncio
async def test_resolved_is_distinct_from_a_timeout_closed_row(client, default_agent_id):
    """Assertion 3: both rows list, with different `status`; resolved still lists."""
    resolved_public = "sess_operator_resolved"
    closed_public = "sess_timeout_closed"

    resolved_id = await _seed_session(default_agent_id, resolved_public)
    await _seed_session(default_agent_id, closed_public, status="closed")

    resolved = await client.post(f"/api/v1/admin/sessions/{resolved_id}/resolve")
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["session"]["status"] == "resolved"

    listing = await client.get("/api/v1/admin/sessions?skip=0&limit=50")
    assert listing.status_code == 200, listing.text
    by_public_id = {item["session_id"]: item for item in listing.json()["items"]}

    assert by_public_id[resolved_public]["status"] == "resolved"
    assert by_public_id[closed_public]["status"] == "closed"
    assert (
        by_public_id[resolved_public]["status"]
        != by_public_id[closed_public]["status"]
    ), "a resolve and a timeout close must be distinguishable in the list"

    # A resolved row is filterable, exactly like the pre-existing statuses.
    filtered = await client.get("/api/v1/admin/sessions?status=resolved")
    assert filtered.status_code == 200, filtered.text
    assert [item["session_id"] for item in filtered.json()["items"]] == [resolved_public]


@pytest.mark.asyncio
async def test_existing_closed_rows_keep_rendering(client, default_agent_id):
    """Assertion 4: a pre-existing `closed` row lists without a 500."""
    closed_public = "sess_legacy_closed_row"
    await _seed_session(default_agent_id, closed_public, status="closed")

    listing = await client.get("/api/v1/admin/sessions?skip=0&limit=50")
    assert listing.status_code == 200, listing.text

    matched = [
        item for item in listing.json()["items"] if item["session_id"] == closed_public
    ]
    assert len(matched) == 1, "an old closed row must still render"
    assert matched[0]["status"] == "closed"
    assert matched[0]["mode"] == "ai", "a legacy row with no mode reads as ai"


@pytest.mark.asyncio
async def test_resolve_then_reopen_restores_the_answer_gate(client, default_agent_id):
    """The reopen route is the documented undo of a resolve."""
    public_id = "sess_resolve_then_reopen"
    session_db_id = await _seed_session(default_agent_id, public_id)

    resolved = await client.post(f"/api/v1/admin/sessions/{session_db_id}/resolve")
    assert resolved.status_code == 200

    blocked = await _prepare(default_agent_id, public_id, "解决之后还能问吗？")
    assert blocked["no_answer_reason"] == "resolved"
    assert "messages" not in blocked, "the bot must not build a prompt"

    reopened = await client.post(f"/api/v1/admin/sessions/{session_db_id}/reopen")
    assert reopened.status_code == 200, reopened.text
    assert reopened.json()["session"]["status"] == "active"
    assert reopened.json()["session"]["mode"] == "ai"

    allowed = await _prepare(default_agent_id, public_id, "重新打开之后的问题。")
    assert allowed.get("messages")


@pytest.mark.asyncio
async def test_takeover_sets_human_mode_and_send_no_longer_requires_it(
    client, default_agent_id
):
    """A takeover implies `mode="human"`; `send` answers one question without one."""
    public_id = "sess_takeover_sets_mode"
    session_db_id = await _seed_session(default_agent_id, public_id)

    takeover = await client.post(f"/api/v1/admin/sessions/{session_db_id}/takeover")
    assert takeover.status_code == 200, takeover.text
    assert takeover.json()["session"]["status"] == "taken_over"
    assert takeover.json()["session"]["mode"] == "human"

    # `send` keeps its route and response shape, and now works on a plain active
    # session (no forced takeover).
    fresh_public = "sess_send_without_takeover"
    fresh_id = await _seed_session(default_agent_id, fresh_public)

    sent = await client.post(
        "/api/v1/admin/sessions/send",
        json={"session_id": fresh_id, "content": "只回答这一个问题。"},
    )
    assert sent.status_code == 200, sent.text
    assert sent.json()["success"] is True

    session = await _session_by_public_id(fresh_public)
    assert session.status == "active", "send must not take the session over"
    assert session.mode == "human"


# ------------------------------------------- visitor-side escalation


@pytest.mark.asyncio
async def test_visitor_escalation_sets_human_mode_and_records_a_system_message(
    client, public_client, default_agent_id
):
    """`/chat/escalate` mutes the bot and leaves a trace in the transcript."""
    public_id = "sess_visitor_escalates"
    session_db_id = await _seed_session(default_agent_id, public_id, visitor_id="visitor_abc")

    response = await public_client.post(
        "/api/v1/chat/escalate",
        json={
            "agent_id": default_agent_id,
            "session_id": public_id,
            "visitor_id": "visitor_abc",
            "reason": "想要人工开发票",
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mode"] == "human"
    assert body["status"] == "active", "escalating is not a status change"

    async with database.AsyncSessionLocal() as db:
        system_messages = (
            await db.execute(
                select(ChatMessage).where(
                    ChatMessage.session_id == session_db_id,
                    ChatMessage.role == "system",
                )
            )
        ).scalars().all()
    assert [message.content for message in system_messages] == [
        "escalated: 想要人工开发票"
    ]

    blocked = await _prepare(default_agent_id, public_id, "转人工之后的第一句。", "visitor_abc")
    assert blocked["no_answer_reason"] == "human"
    assert "messages" not in blocked, "the bot must not build a prompt"


@pytest.mark.asyncio
async def test_visitor_release_route_returns_the_session_to_ai(
    public_client, default_agent_id
):
    """The widget's *Continue with AI* has a public, ownership-checked route."""
    public_id = "sess_visitor_releases"
    await _seed_session(
        default_agent_id, public_id, visitor_id="visitor_rel", mode="human"
    )

    response = await public_client.post(
        "/api/v1/chat/release",
        json={
            "agent_id": default_agent_id,
            "session_id": public_id,
            "visitor_id": "visitor_rel",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["mode"] == "ai"

    session = await _session_by_public_id(public_id)
    assert should_ai_answer(session) is True


# ------------------------------------------- C6. business hours gate the answer

def _pin_clock(monkeypatch, moment=FROZEN_NOW):
    """Pin *when* the gate thinks it is, without stubbing the gate itself.

    Only the clock is frozen: `answer_gate` still calls the real `is_online`, so a
    broken schedule parser or a missing wiring shows up here rather than being
    papered over by the patch.
    """
    import services.session_state as session_state
    from services.business_hours import is_online as real_is_online

    monkeypatch.setattr(
        session_state,
        "is_online",
        lambda agent, now=None: real_is_online(agent, moment),
    )


@pytest.mark.asyncio
async def test_a_closed_window_stores_the_message_and_answers_nothing(
    public_client, default_agent_id, fake_qa_index, monkeypatch
):
    """(a) `active`/`ai` + closed schedule → message stored, no assistant row.

    Business hours were a dead setting: the console round-tripped them and the
    bot answered anyway. This drives the real `/chat` path, so "the bot answered"
    fails here instead of silently regressing.
    """
    _pin_clock(monkeypatch)
    await _set_agent(default_agent_id, business_hours=CLOSED_WINDOW, away_message=None)

    public_id = "sess_after_hours_closed"
    session_db_id = await _seed_session(default_agent_id, public_id)

    response = await _chat(public_client, default_agent_id, public_id, "下班时间提问。")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["reply"] == "", "no away copy configured, so no reply at all"
    assert payload["no_answer_reason"] == "after_hours"
    assert payload["mode"] == "ai", "the mode is unchanged: the session is still AI"
    assert payload["taken_over"] is False, "a closed schedule is not a handoff"

    contents = await _message_contents(session_db_id)
    assert "下班时间提问。" in contents, "the visitor message is still persisted"
    assert await _assistant_message_count(session_db_id) == 0, (
        "nobody answered, so no assistant row may be written"
    )


@pytest.mark.asyncio
async def test_b_away_message_reaches_the_stream_but_not_the_transcript(
    public_client, default_agent_id, fake_qa_index, monkeypatch
):
    """(b) The away copy is visitor-visible in the SSE body, never an assistant row.

    That split is why `away_message` exists: the visitor must see something, and
    the transcript must not later claim a person wrote it.
    """
    _pin_clock(monkeypatch)
    away_copy = "当前非服务时间，请留言，我们会在工作时间回复。"
    await _set_agent(
        default_agent_id, business_hours=CLOSED_WINDOW, away_message=away_copy
    )

    public_id = "sess_after_hours_away_copy"
    session_db_id = await _seed_session(default_agent_id, public_id)

    response = await public_client.post(
        "/api/v1/chat/stream",
        json={
            "agent_id": default_agent_id,
            "message": "非工作时间还能问吗？",
            "session_id": public_id,
            "visitor_id": "v1",
        },
    )
    assert response.status_code == 200, response.text

    content_events = [
        payload["content"]
        for name, payload in _sse_events(response.text)
        if name == "content"
    ]
    assert "".join(content_events) == away_copy, (
        "the away copy is the visitor-visible reply"
    )

    done = _sse_done(response.text)
    assert done["no_answer_reason"] == "after_hours"
    assert done["mode"] == "ai"
    assert done["taken_over"] is False
    assert done["message_id"] is None, "nothing was persisted as an assistant turn"

    contents = await _message_contents(session_db_id)
    assert "非工作时间还能问吗？" in contents, "the visitor message is still persisted"
    assert away_copy not in contents, (
        "the away copy must NOT be stored as an assistant message"
    )
    assert await _assistant_message_count(session_db_id) == 0


@pytest.mark.asyncio
async def test_c_an_open_window_still_answers(
    public_client, default_agent_id, fake_qa_index
):
    """(c) The gate must not be an always-off switch: an open window answers.

    The window is computed from the real clock in a fixed timezone rather than
    pinned, because this is the assertion that live behaviour still answers.
    """
    now_local = datetime.now(ZoneInfo("Asia/Shanghai"))
    minutes_now = now_local.hour * 60 + now_local.minute
    # The window is computed in week-absolute minutes (Monday 00:00 = 0) so a
    # range that straddles midnight — or the Sunday→Monday boundary — still
    # lands on the weekday it opens on, which is how the format defines it.
    # +/- 30 minutes around now, so a minute rolling over mid-test cannot flake it.
    week_abs_now = now_local.weekday() * 24 * 60 + minutes_now
    opens_at = (week_abs_now - 30) % (7 * 24 * 60)
    closes_at = (week_abs_now + 30) % (7 * 24 * 60)
    await _set_agent(
        default_agent_id,
        business_hours={
            "timezone": "Asia/Shanghai",
            "schedule": [
                {
                    "day": opens_at // (24 * 60),
                    "start": opens_at % (24 * 60),
                    # `end <= start` means "wraps past midnight"; midnight itself
                    # is written as end-of-day so the close is never lost.
                    "end": (closes_at % (24 * 60)) or 24 * 60,
                }
            ],
        },
        away_message="不该出现的留言。",
    )

    public_id = "sess_business_hours_open"
    session_db_id = await _seed_session(default_agent_id, public_id)

    response = await _chat(public_client, default_agent_id, public_id, "工作时间提问。")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["taken_over"] is False
    assert payload["no_answer_reason"] is None, "the bot answered, so there is no reason"
    assert payload["reply"], "an open window must produce a normal answer"
    assert await _assistant_message_count(session_db_id) == 1


@pytest.mark.asyncio
async def test_d_no_business_hours_config_still_answers(
    public_client, default_agent_id, fake_qa_index
):
    """(d) No config = always online, exactly as before the gate existed."""
    await _set_agent(default_agent_id, business_hours=None, away_message=None)

    public_id = "sess_business_hours_unset"
    session_db_id = await _seed_session(default_agent_id, public_id)

    response = await _chat(public_client, default_agent_id, public_id, "没有配置营业时间。")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["taken_over"] is False
    assert payload["no_answer_reason"] is None
    assert payload["reply"]
    assert await _assistant_message_count(session_db_id) == 1


@pytest.mark.asyncio
async def test_a_resolved_row_still_lists_after_it_receives_a_message(
    client, public_client, default_agent_id, fake_qa_index
):
    """A `resolved` session that receives a message stays silent AND stays listed.

    The silent half is contract C3; the listed half is what makes the silence
    usable — the operator has to be able to find the conversation afterwards.
    """
    public_id = "sess_resolved_then_message"
    session_db_id = await _seed_session(default_agent_id, public_id)

    resolved = await client.post(f"/api/v1/admin/sessions/{session_db_id}/resolve")
    assert resolved.status_code == 200, resolved.text

    turn = await _chat(public_client, default_agent_id, public_id, "解决之后又问了一句。")
    assert turn.status_code == 200, turn.text
    assert turn.json()["no_answer_reason"] == "resolved"
    assert turn.json()["reply"] == ""
    assert await _assistant_message_count(session_db_id) == 0

    listing = await client.get("/api/v1/admin/sessions?skip=0&limit=50")
    assert listing.status_code == 200, listing.text
    matched = [
        item for item in listing.json()["items"] if item["session_id"] == public_id
    ]
    assert len(matched) == 1, "a resolved row must remain visible after it gets a message"
    assert matched[0]["status"] == "resolved"
    assert matched[0]["last_message"] == "解决之后又问了一句。"


# ------------------------------------------- 9. rejections


async def _foreign_workspace_agent() -> tuple[str, str]:
    """A second workspace with its own agent and a session on it."""
    async with database.AsyncSessionLocal() as db:
        workspace = Workspace(name="Other Workspace", owner_email="other@example.com")
        db.add(workspace)
        await db.flush()
        db.add(WorkspaceQuota(workspace_id=workspace.id))
        agent = Agent(
            workspace_id=workspace.id,
            name="Foreign Agent",
            model="deepseek-v4-flash",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
        )
        db.add(agent)
        await db.flush()
        session = ChatSession(
            agent_id=agent.id, session_id="sess_foreign_workspace", visitor_id="v_foreign"
        )
        db.add(session)
        await db.commit()
        await db.refresh(session)
        return agent.id, session.id


@pytest.mark.asyncio
async def test_handoff_actions_404_on_another_workspaces_session(client):
    """Assertion 9: reply/release/resolve on a foreign session answer 404."""
    _agent_id, foreign_session_id = await _foreign_workspace_agent()

    reply = await client.post(
        f"/api/v1/admin/sessions/{foreign_session_id}/reply",
        json={"message": "跨工作区"},
    )
    assert reply.status_code == 404, reply.text

    release = await client.post(f"/api/v1/admin/sessions/{foreign_session_id}/release")
    assert release.status_code == 404, release.text

    resolve = await client.post(f"/api/v1/admin/sessions/{foreign_session_id}/resolve")
    assert resolve.status_code == 404, resolve.text

    reopen = await client.post(f"/api/v1/admin/sessions/{foreign_session_id}/reopen")
    assert reopen.status_code == 404, reopen.text

    sent = await client.post(
        "/api/v1/admin/sessions/send",
        json={"session_id": foreign_session_id, "content": "跨工作区"},
    )
    assert sent.status_code == 404, sent.text

    # `takeover` keeps its pre-existing 403 ("Agent not in your workspace"): it
    # is an unchanged route that only gained `mode="human"`.
    takeover = await client.post(
        f"/api/v1/admin/sessions/{foreign_session_id}/takeover"
    )
    assert takeover.status_code == 403, takeover.text

    # The session was never touched.
    async with database.AsyncSessionLocal() as db:
        row = await db.scalar(
            select(ChatSession).where(ChatSession.id == foreign_session_id)
        )
        assert row.status == "active"
        assert row.mode == "ai"


@pytest.mark.asyncio
async def test_escalate_404s_on_a_foreign_or_unknown_visitor(
    public_client, default_agent_id
):
    """Assertion 9: a foreign `visitor_id` answers the same 404 as an unknown session."""
    public_id = "sess_escalate_owner_check"
    await _seed_session(default_agent_id, public_id, visitor_id="visitor_owner")

    foreign_visitor = await public_client.post(
        "/api/v1/chat/escalate",
        json={
            "agent_id": default_agent_id,
            "session_id": public_id,
            "visitor_id": "visitor_someone_else",
            "reason": "劫持",
        },
    )
    assert foreign_visitor.status_code == 404, foreign_visitor.text
    assert foreign_visitor.json()["detail"] == "Session not found"

    unknown_session = await public_client.post(
        "/api/v1/chat/escalate",
        json={
            "agent_id": default_agent_id,
            "session_id": "sess_does_not_exist",
            "visitor_id": "visitor_owner",
            "reason": "不存在",
        },
    )
    assert unknown_session.status_code == 404, unknown_session.text
    assert unknown_session.json()["detail"] == "Session not found"

    # Nothing was escalated by the rejected attempts.
    async with database.AsyncSessionLocal() as db:
        row = await db.scalar(
            select(ChatSession).where(ChatSession.session_id == public_id)
        )
        assert row.mode == "ai"


@pytest.mark.asyncio
async def test_reply_rejects_an_empty_message(client, default_agent_id):
    public_id = "sess_reply_empty"
    session_db_id = await _seed_session(default_agent_id, public_id)

    response = await client.post(
        f"/api/v1/admin/sessions/{session_db_id}/reply", json={"message": "   "}
    )
    assert response.status_code == 400, response.text


@pytest.mark.asyncio
async def test_reply_404s_on_an_unknown_session(client):
    response = await client.post(
        "/api/v1/admin/sessions/sess_missing/reply", json={"message": "hi"}
    )
    assert response.status_code == 404, response.text


# ------------------------------------------- admin payload round-trip


@pytest.mark.asyncio
async def test_agent_payload_round_trips_the_handoff_settings(client):
    """The console edits these three fields; they must come back from the API."""
    agent_response = await client.get("/api/v1/agent:default")
    agent_id = agent_response.json()["id"]

    business_hours = {
        "timezone": "Asia/Shanghai",
        "schedule": [{"day": 0, "start": 540, "end": 1080}],
    }
    updated = await client.put(
        f"/api/v1/agent?agent_id={agent_id}",
        json={
            "escalation_rules": "如果用户要求人工，请建议转人工。",
            "business_hours": business_hours,
            "away_message": "当前非服务时间。",
        },
    )
    assert updated.status_code == 200, updated.text
    payload = updated.json()
    assert payload["escalation_rules"] == "如果用户要求人工，请建议转人工。"
    assert payload["business_hours"] == business_hours
    assert payload["away_message"] == "当前非服务时间。"
