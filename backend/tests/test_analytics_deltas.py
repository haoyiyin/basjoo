"""Issue #45 acceptance box 1 — every tile states its number, its delta, its window.

The contract, restated because every assertion hangs off it:

    every tile = (value, previous, delta, delta_pct, delta_kind, window_label)

`window_label` is part of the tile builder's return value, not a render-time
detail, so a tile cannot be produced without the words that say what `previous`
means. The zero-baseline rule is explicit:

    previous 0, current 0   -> no delta        (`delta_pct=None`, `delta_kind="none"`)
    previous 0, current > 0 -> "new"           (`delta_pct=None`, `delta_kind="new"`)
    previous > 0            -> a percentage    (`delta_pct` a number)

`None` — never `NaN`, never `Infinity`: neither survives JSON, and
`+Infinity%` is worse than no delta at all.

The integration half drives the real `GET /admin/stats/overview` against seeded
rows and asserts on the response body, so "the tile is right" is proven on the
artefact the console actually consumes.
"""

from datetime import datetime, timedelta, timezone

import pytest

import database
from models import Agent, ChatMessage, ChatSession, Lead, Workspace
from services.analytics_service import build_tile, frozen_metric

C4_METRICS = (
    "sessions",
    "messages",
    "ai_replies",
    "visitors",
    "leads",
    "handoffs",
    "unanswered",
    "positive_feedback_rate",
    "widget_opens",
)

# ------------------------------------------------------------ the rule itself

def test_zero_previous_and_zero_current_is_no_delta():
    """Previous 0 and current 0: no percentage, no NaN, no infinity."""
    tile = build_tile(0, 0, "vs previous 7 days")

    assert tile["value"] == 0
    assert tile["previous"] == 0
    assert tile["delta"] == 0
    assert tile["delta_pct"] is None, "there is no baseline to divide by"
    assert tile["delta_kind"] == "none"
    assert tile["window_label"] == "vs previous 7 days"

def test_zero_previous_with_new_value_says_new_not_infinite():
    """Previous 0 and current > 0: 'new', never a percentage."""
    tile = build_tile(5, 0, "vs 前 7 天")

    assert tile["value"] == 5
    assert tile["delta"] == 5
    assert tile["delta_pct"] is None, "a percentage of zero is not a number"
    assert tile["delta_kind"] == "new"
    assert tile["window_label"] == "vs 前 7 天"

def test_previous_window_produces_a_percentage_without_the_label():
    """A real baseline is the only case that yields a percentage."""
    growth = build_tile(150, 100, "vs previous 7 days")
    assert growth["delta_pct"] == 50.0
    assert growth["delta_kind"] == "pct"
    assert growth["delta"] == 50

    decline = build_tile(50, 100, "vs previous 7 days")
    assert decline["delta_pct"] == -50.0
    assert decline["delta_kind"] == "pct"
    assert decline["delta"] == -50

def test_no_tile_can_ever_be_built_without_its_window_in_words():
    """The label is a required argument, so it is never forgotten."""
    tile = build_tile(1, 2, "vs previous 30 days")
    assert tile["window_label"] == "vs previous 30 days"

    # An empty label is a caller bug, but the key still exists rather than the
    # tile silently losing the field the console renders beside every number.
    assert "window_label" in build_tile(1, 2, "")

def test_tile_builder_is_total_over_garbage_inputs():
    """A missing column or a text value degrades to 0, never to NaN."""
    for current, previous in [(None, None), ("x", "y"), (None, 4), (4, None)]:
        tile = build_tile(current, previous, "vs previous 7 days")
        for key in ("value", "previous", "delta", "delta_pct", "delta_kind"):
            assert key in tile
        assert tile["value"] != float("nan")
        assert tile["previous"] != float("nan")
        assert tile["delta_pct"] is None or tile["delta_pct"] == tile["delta_pct"]

def test_frozen_metric_keeps_exactly_the_c4_keys():
    tile = build_tile(3, 1, "vs previous 7 days")
    assert set(frozen_metric(tile)) == {"value", "previous", "delta", "delta_pct"}

# ---------------------------------------------------------- window resolution

def test_window_label_is_localised_and_matches_its_length():
    from services.analytics_service import window_label

    assert window_label(7, "zh-CN") == "vs 前 7 天"
    assert window_label(7, "en-US") == "vs previous 7 days"
    # A one-day window is prose, so it must read "1 day", not "1 days".
    assert window_label(1, "en-US") == "vs previous 1 day"
    assert window_label(1, "zh-CN") == "vs 前 1 天"
    # Anything unrecognised falls back to the English catalog.
    assert window_label(7, None) == "vs previous 7 days"

def test_previous_window_is_exactly_as_long_as_the_current_one():
    from services.analytics_service import resolve_window

    now = datetime(2026, 3, 10, 12, 0, tzinfo=timezone.utc)
    window = resolve_window("7d", now=now)
    assert (window.end - window.start) == timedelta(days=7)
    assert (window.previous_end - window.previous_start) == timedelta(days=7)
    assert window.previous_end == window.start

# ----------------------------------------------------------- seeded scenario

async def _insert_session(
    agent_id: str, public_id: str, when: datetime, **kwargs
) -> str:
    async with database.AsyncSessionLocal() as session:
        row = ChatSession(
            agent_id=agent_id,
            session_id=public_id,
            visitor_id=kwargs.pop("visitor_id", f"v_{public_id}"),
            created_at=when,
            updated_at=when,
            **kwargs,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row.id

async def _insert_message(session_db_id: str, role: str, when: datetime, **kwargs) -> int:
    async with database.AsyncSessionLocal() as session:
        row = ChatMessage(
            session_id=session_db_id,
            role=role,
            content=kwargs.pop("content", "question?" if role == "user" else "answer."),
            created_at=when,
            **kwargs,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row.id

async def _insert_lead(agent_id: str, when: datetime, **kwargs) -> str:
    from uuid import uuid4

    async with database.AsyncSessionLocal() as session:
        row = Lead(
            id=str(uuid4()),
            agent_id=agent_id,
            created_at=when,
            source=kwargs.pop("source", "offline-form"),
            email=kwargs.pop("email", "lead@example.com"),
            **kwargs,
        )
        session.add(row)
        await session.commit()
        return row.id

@pytest.mark.asyncio
async def test_every_tile_on_the_wire_carries_its_comparison_window(
    client, default_agent_id
):
    """Acceptance box 1: no tile reaches the console as a naked number."""
    response = await client.get("/api/v1/admin/stats/overview?range=7d")
    assert response.status_code == 200, response.text
    body = response.json()

    from api.v1.analytics_endpoints import TILE_METRICS

    assert set(body["tiles"]) == set(TILE_METRICS)
    labels = {tile["window_label"] for tile in body["tiles"].values()}
    assert labels == {body["window"]["label"]}
    assert body["window"]["label"] == "vs 前 7 天", "default locale is zh-CN"
    for name, tile in body["tiles"].items():
        assert set(tile) == {
            "value",
            "previous",
            "delta",
            "delta_pct",
            "delta_kind",
            "window_label",
        }, name

    english = await client.get(
        "/api/v1/admin/stats/overview?range=7d&locale=en-US"
    )
    assert english.status_code == 200, english.text
    assert english.json()["window"]["label"] == "vs previous 7 days"
    assert {
        tile["window_label"] for tile in english.json()["tiles"].values()
    } == {"vs previous 7 days"}

@pytest.mark.asyncio
async def test_tiles_count_the_current_and_previous_windows_from_real_rows(
    client, default_agent_id
):
    """The numbers come from `chat_sessions` / `chat_messages` / `leads`."""
    now = datetime.now(timezone.utc)
    current_day = now - timedelta(days=1)
    second_current_day = now - timedelta(days=2)
    previous_day = now - timedelta(days=9)
    too_old = now - timedelta(days=40)

    first = await _insert_session(
        default_agent_id, "sess_cur_a", current_day, visitor_id="visitor_a"
    )
    second = await _insert_session(
        default_agent_id, "sess_cur_b", second_current_day, visitor_id="visitor_b"
    )
    await _insert_session(
        default_agent_id, "sess_old_a", too_old, visitor_id="visitor_d"
    )

    # Session A: a good answer and a thumbs-up on the visitor turn. (#62: the
    # `degraded` flag is retired — no message carries it any more.)
    await _insert_message(
        first, "user", current_day, content="你们的退款窗口是多长时间？", rating=1
    )
    await _insert_message(
        first,
        "assistant",
        current_day + timedelta(minutes=1),
        content="退款窗口为收货后 30 天。",
        confidence=0.8,
        is_unanswered=False,
    )
    # Session B: a thumbs-down and an answer flagged unanswered.
    await _insert_message(
        second, "user", second_current_day, content="发票怎么开？", rating=-1
    )
    await _insert_message(
        second,
        "assistant",
        second_current_day + timedelta(minutes=1),
        content="抱歉，我无法回答。",
        confidence=0.4,
        is_unanswered=True,
    )
    # The previous window has one session and one message pair of its own.
    previous_session = await _insert_session(
        default_agent_id, "sess_prev_b", previous_day - timedelta(hours=1)
    )
    await _insert_message(previous_session, "user", previous_day - timedelta(hours=1))
    await _insert_message(
        previous_session,
        "assistant",
        previous_day - timedelta(minutes=59),
        confidence=0.6,
        is_unanswered=False,
    )
    await _insert_lead(default_agent_id, current_day)

    response = await client.get(
        f"/api/v1/admin/stats/overview?range=7d&agent_id={default_agent_id}"
    )
    assert response.status_code == 200, response.text
    tiles = response.json()["tiles"]

    # Current window: 2 sessions, 4 messages, 2 distinct visitors, 1 lead.
    assert tiles["sessions"]["value"] == 2
    assert tiles["sessions"]["previous"] == 1
    assert tiles["sessions"]["delta"] == 1
    assert tiles["sessions"]["delta_pct"] == 100.0

    assert tiles["messages"]["value"] == 4
    assert tiles["visitors"]["value"] == 2
    assert tiles["leads"]["value"] == 1
    assert tiles["unanswered"]["value"] == 1
    # #62 / D6: the `degraded` tile is retired and absent from the payload.
    assert "degraded" not in tiles
    assert tiles["negative_feedback"]["value"] == 1
    # One up, one down: the positive share of the rated turns is exactly half.
    assert tiles["positive_feedback_rate"]["value"] == 0.5
    # Two assistant replies in the current window (human replies do not count).
    assert tiles["ai_replies"]["value"] == 2

@pytest.mark.asyncio
async def test_a_range_with_no_baseline_reports_new_instead_of_a_percentage(
    client, default_agent_id
):
    """previous 0 / current > 0 -> `new`, asserted on the HTTP body."""
    now = datetime.now(timezone.utc)
    await _insert_session(default_agent_id, "sess_only_current", now - timedelta(days=1))

    response = await client.get("/api/v1/admin/stats/overview?range=7d")
    assert response.status_code == 200, response.text
    sessions = response.json()["tiles"]["sessions"]

    assert sessions["value"] == 1
    assert sessions["previous"] == 0
    assert sessions["delta_pct"] is None
    assert sessions["delta_kind"] == "new"
    # The wire format must be plain JSON: no NaN, no Infinity.
    assert "NaN" not in response.text
    assert "Infinity" not in response.text

@pytest.mark.asyncio
async def test_a_fresh_install_renders_zeroes_not_nan(client):
    """Nothing has happened yet: every tile is 0 with a 'none' delta."""
    response = await client.get("/api/v1/admin/stats/overview?range=7d")
    assert response.status_code == 200, response.text
    body = response.json()

    for name, tile in body["tiles"].items():
        assert tile["value"] == 0, name
        assert tile["previous"] == 0, name
        assert tile["delta"] == 0, name
        assert tile["delta_pct"] is None, name
        assert tile["delta_kind"] == "none", name
        assert tile["window_label"] == body["window"]["label"], name

    assert body["window"]["days"] == 7
    assert body["outcome_split"] == {
        "resolved": 0,
        "abandoned": 0,
        "escalated": 0,
        "no-answer": 0,
        "total": 0,
        "classified": 0,
        "unclassified": 0,
    }
    assert body["top_unanswered"] == []
    assert "NaN" not in response.text and "Infinity" not in response.text

@pytest.mark.asyncio
async def test_explicit_from_to_derives_an_equal_length_previous_window(
    client, default_agent_id
):
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=10)).replace(microsecond=0)
    end = (now - timedelta(days=3)).replace(microsecond=0)
    await _insert_session(default_agent_id, "sess_in_bounds", now - timedelta(days=5))
    await _insert_session(
        default_agent_id, "sess_before_bounds", now - timedelta(days=13)
    )

    response = await client.get(
        "/api/v1/admin/stats/overview",
        params={"from": start.isoformat(), "to": end.isoformat()},
    )
    assert response.status_code == 200, response.text
    body = response.json()

    window = body["window"]
    assert datetime.fromisoformat(window["from"]) == start
    assert datetime.fromisoformat(window["to"]) == end
    assert datetime.fromisoformat(window["previous_to"]) == start
    assert window["days"] == 7
    assert window["label"] == "vs 前 7 天"
    # Only the in-bounds session counts; the older one is the "previous" window.
    assert body["tiles"]["sessions"]["value"] == 1
    assert body["tiles"]["sessions"]["previous"] == 1

@pytest.mark.asyncio
async def test_outcome_split_and_top_unanswered_ride_along_with_the_tiles(
    client, default_agent_id
):
    """The 'what to do next' block is one request away from the tiles."""
    now = datetime.now(timezone.utc)
    resolved = await _insert_session(
        default_agent_id,
        "sess_resolved",
        now - timedelta(days=1),
        status="resolved",
        outcome="resolved",
        topic="退款窗口",
    )
    await _insert_message(resolved, "user", now - timedelta(days=1), content="退款？")
    await _insert_message(
        resolved, "assistant", now - timedelta(days=1), content="30 天。"
    )
    unanswered = await _insert_session(
        default_agent_id, "sess_unanswered", now - timedelta(days=2), status="closed"
    )
    await _insert_message(
        unanswered,
        "user",
        now - timedelta(days=2),
        content="你们支持哪些付款方式？可以用对公转账吗？",
    )
    message_id = await _insert_message(
        unanswered,
        "assistant",
        now - timedelta(days=2) + timedelta(minutes=1),
        content="抱歉，我无法回答。",
        is_unanswered=True,
    )
    # An active session is never classifiable and never finished.
    await _insert_session(default_agent_id, "sess_active", now - timedelta(days=1))

    response = await client.get(
        f"/api/v1/admin/stats/overview?range=7d&agent_id={default_agent_id}"
    )
    assert response.status_code == 200, response.text
    body = response.json()

    split = body["outcome_split"]
    assert split["resolved"] == 1
    assert split["total"] == 2, "only closed/resolved sessions are finished"
    assert split["classified"] == 1
    assert split["unclassified"] == 1
    assert split["abandoned"] == split["escalated"] == split["no-answer"] == 0

    top = body["top_unanswered"]
    assert len(top) == 1
    assert top[0]["message_id"] == message_id
    assert top[0]["question"] == "你们支持哪些付款方式？可以用对公转账吗？"
    assert top[0]["occurrences"] == 1

@pytest.mark.asyncio
async def test_analytics_endpoint_keeps_the_frozen_c4_dictionary(client):
    """Contract C4: exactly nine metrics, each with the four frozen keys."""
    response = await client.get("/api/v1/admin/analytics?range=7d")
    assert response.status_code == 200, response.text
    body = response.json()

    assert set(body["metrics"]) == set(C4_METRICS)
    for name, metric in body["metrics"].items():
        assert set(metric) == {"value", "previous", "delta", "delta_pct"}, name
    assert set(body["window"]) == {"from", "to", "previous_from", "previous_to"}
    assert set(body["funnel"]) == {
        "opens",
        "conversations",
        "leads",
        "conversation_rate",
        "lead_rate",
    }

@pytest.mark.asyncio
async def test_an_unknown_range_is_rejected_on_both_routes(client):
    overview = await client.get("/api/v1/admin/stats/overview?range=forever")
    assert overview.status_code == 400
    assert "range" in overview.json()["detail"]

    export = await client.get("/api/v1/admin/stats/export.csv?range=forever")
    assert export.status_code == 400

@pytest.mark.asyncio
async def test_a_foreign_agent_is_refused_before_any_row_is_read(client):
    """Wrong owner -> 403, the same rule the session list applies."""
    async with database.AsyncSessionLocal() as session:
        other_workspace = Workspace(
            name="Other Workspace", owner_email="other@example.com"
        )
        session.add(other_workspace)
        await session.flush()
        foreign = Agent(
            workspace_id=other_workspace.id,
            name="Foreign Agent",
            model="deepseek-v4-flash",
        )
        session.add(foreign)
        await session.commit()
        foreign_id = foreign.id

    response = await client.get(
        f"/api/v1/admin/stats/overview?range=7d&agent_id={foreign_id}"
    )
    assert response.status_code == 403, response.text
