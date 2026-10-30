"""Issue #45 acceptance box 2 — the CSV export respects the active filter.

`GET /admin/stats/export.csv?range=&agent_id=&...` is the tile query's own
window, rendered one row per day:

* `text/csv`, `Content-Disposition: attachment`, and a **UTF-8 BOM** as the very
  first byte — the operator opens the file on Windows in Excel, and without the
  BOM every Chinese cell is mojibake;
* the frozen column set, in order;
* the agent filter is applied, so `agent_id=A` contains A's rows and nobody
  else's, and the row count matches the same filtered tile query;
* a cell that starts with `=`, `+`, `-` or `@` is prefixed with `'`, so Excel
  treats it as text instead of evaluating it.
"""

import csv
import io
from datetime import datetime, timedelta, timezone

import pytest

import database
from models import Agent, ChatMessage, ChatSession, Lead, Workspace
from services.analytics_service import CSV_COLUMNS, UTF8_BOM, build_csv, csv_cell

# --------------------------------------------------------- the guard, in unit

def test_formula_leading_cells_are_escaped():
    for dangerous in ("=SUM(A1)", "+1+1", "-2+3", "@SUM(A1)"):
        assert csv_cell(dangerous) == f"'{dangerous}"

def test_ordinary_cells_are_untouched():
    assert csv_cell("2026-03-10") == "2026-03-10"
    assert csv_cell(0) == "0"
    assert csv_cell(None) == ""
    assert csv_cell("退款窗口") == "退款窗口"
    # A cell already escaped by a producer is not escaped twice.
    assert csv_cell("'=SUM(A1)") == "'=SUM(A1)"

def test_build_csv_prefixes_the_bom_and_keeps_the_frozen_column_order():
    body = build_csv(
        [
            {
                "date": "=cmd|calc",
                "sessions": 1,
                "messages": 2,
                "answered": 1,
                "unanswered": 0,
                "degraded": 0,
                "leads": 0,
                "negative_feedback": 0,
                "avg_confidence": None,
            }
        ]
    )

    assert body.startswith(UTF8_BOM), "Excel needs the BOM to read the Chinese cells"
    assert body.encode("utf-8").startswith(b"\xef\xbb\xbf")
    assert "\r\n" in body, "CRLF, so Windows Excel sees rows"

    rows = list(csv.reader(io.StringIO(body.lstrip(UTF8_BOM))))
    assert rows[0] == [
        "date",
        "sessions",
        "messages",
        "answered",
        "unanswered",
        "degraded",
        "leads",
        "negative_feedback",
        "avg_confidence",
    ]
    assert CSV_COLUMNS == tuple(rows[0])
    # The injection guard applies to the real rendering, not just the helper.
    assert rows[1][0] == "'=cmd|calc"

# ------------------------------------------------------------- seeded scenario

async def _make_agent(name: str) -> str:
    from sqlalchemy import select

    async with database.AsyncSessionLocal() as session:
        workspace = (
            await session.execute(select(Workspace).order_by(Workspace.id))
        ).scalars().first()
        assert workspace is not None
        agent = Agent(
            workspace_id=workspace.id,
            name=name,
            model="deepseek-v4-flash",
            api_key="encrypted-placeholder",
        )
        session.add(agent)
        await session.commit()
        await session.refresh(agent)
        return agent.id

async def _insert_session(agent_id: str, public_id: str, when: datetime) -> str:
    async with database.AsyncSessionLocal() as session:
        row = ChatSession(
            agent_id=agent_id,
            session_id=public_id,
            visitor_id=public_id,
            created_at=when,
            updated_at=when,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        return row.id

async def _insert_message(session_db_id: str, role: str, when: datetime, **kwargs) -> None:
    async with database.AsyncSessionLocal() as session:
        session.add(
            ChatMessage(
                session_id=session_db_id,
                role=role,
                content=kwargs.pop("content", "question?" if role == "user" else "answer."),
                created_at=when,
                **kwargs,
            )
        )
        await session.commit()

async def _insert_lead(agent_id: str, when: datetime) -> None:
    from uuid import uuid4

    async with database.AsyncSessionLocal() as session:
        session.add(
            Lead(
                id=str(uuid4()),
                agent_id=agent_id,
                created_at=when,
                source="offline-form",
                email="lead@example.com",
            )
        )
        await session.commit()

def _parse_csv(response) -> list[dict[str, str]]:
    body = response.content.decode("utf-8")
    assert body.startswith(UTF8_BOM)
    return list(csv.DictReader(io.StringIO(body.lstrip(UTF8_BOM))))

# ---------------------------------------------------------- the export itself

@pytest.mark.asyncio
async def test_export_is_a_csv_attachment_with_a_utf8_bom(client, default_agent_id):
    response = await client.get(
        f"/api/v1/admin/stats/export.csv?range=7d&agent_id={default_agent_id}"
    )
    assert response.status_code == 200, response.text

    assert response.headers["content-type"].startswith("text/csv")
    assert "charset=utf-8" in response.headers["content-type"].lower()
    disposition = response.headers["content-disposition"]
    assert disposition.startswith("attachment;")
    assert ".csv" in disposition
    # The BOM must be the first three bytes of the body, not somewhere inside.
    assert response.content.startswith(b"\xef\xbb\xbf")

    rows = _parse_csv(response)
    assert rows, "an empty window still exports its days"
    assert list(rows[0]) == list(CSV_COLUMNS)

@pytest.mark.asyncio
async def test_export_row_count_matches_the_same_filtered_tile_window(
    client, default_agent_id
):
    """The CSV's rows are the tile window's days, not "days that had activity"."""
    now = datetime.now(timezone.utc)
    session_db_id = await _insert_session(
        default_agent_id, "sess_csv_a", now - timedelta(days=2)
    )
    await _insert_message(session_db_id, "user", now - timedelta(days=2))
    await _insert_message(
        session_db_id,
        "assistant",
        now - timedelta(days=2) + timedelta(minutes=1),
        confidence=0.75,
    )
    await _insert_lead(default_agent_id, now - timedelta(days=2))

    overview = await client.get(
        f"/api/v1/admin/stats/overview?range=7d&agent_id={default_agent_id}"
    )
    assert overview.status_code == 200, overview.text
    window = overview.json()["window"]
    tiles = overview.json()["tiles"]

    start = datetime.fromisoformat(window["from"])
    end = datetime.fromisoformat(window["to"])
    expected_days = (end.date() - start.date()).days

    export = await client.get(
        f"/api/v1/admin/stats/export.csv?range=7d&agent_id={default_agent_id}"
    )
    assert export.status_code == 200, export.text
    rows = _parse_csv(export)

    assert len(rows) == expected_days == 7, "one row per day of the window"
    assert sum(int(row["sessions"]) for row in rows) == tiles["sessions"]["value"]
    assert sum(int(row["messages"]) for row in rows) == tiles["messages"]["value"]
    assert sum(int(row["leads"]) for row in rows) == tiles["leads"]["value"]
    # The one assistant turn was answered, so `answered` totals 1 and
    # `unanswered` totals 0 — the two columns are counted separately rather
    # than derived from `messages`, which also counts visitor turns.
    assert sum(int(row["answered"]) for row in rows) == 1
    assert sum(int(row["unanswered"]) for row in rows) == 0
    # avg_confidence is a per-day average, so only the day with a rated answer
    # carries a number — an absent signal stays empty rather than 0.
    confidences = [row["avg_confidence"] for row in rows if row["avg_confidence"]]
    assert confidences == ["0.75"]

@pytest.mark.asyncio
async def test_export_for_one_agent_contains_only_that_agents_rows(client, default_agent_id):
    """Acceptance box 2: the active filter is respected by the export."""
    other_agent_id = await _make_agent("Second Agent")
    now = datetime.now(timezone.utc)

    mine = await _insert_session(
        default_agent_id, "sess_mine", now - timedelta(days=1)
    )
    await _insert_message(mine, "user", now - timedelta(days=1))
    await _insert_message(
        mine, "assistant", now - timedelta(days=1, minutes=-1), is_unanswered=True
    )
    await _insert_lead(default_agent_id, now - timedelta(days=1))

    for index in range(3):
        theirs = await _insert_session(
            other_agent_id, f"sess_theirs_{index}", now - timedelta(days=1)
        )
        await _insert_message(theirs, "user", now - timedelta(days=1))
        await _insert_message(theirs, "assistant", now - timedelta(days=1))
        await _insert_lead(other_agent_id, now - timedelta(days=1))

    mine_export = await client.get(
        f"/api/v1/admin/stats/export.csv?range=7d&agent_id={default_agent_id}"
    )
    assert mine_export.status_code == 200, mine_export.text
    mine_rows = _parse_csv(mine_export)
    assert sum(int(row["sessions"]) for row in mine_rows) == 1
    assert sum(int(row["messages"]) for row in mine_rows) == 2
    assert sum(int(row["unanswered"]) for row in mine_rows) == 1
    assert sum(int(row["leads"]) for row in mine_rows) == 1

    theirs_export = await client.get(
        f"/api/v1/admin/stats/export.csv?range=7d&agent_id={other_agent_id}"
    )
    assert theirs_export.status_code == 200, theirs_export.text
    theirs_rows = _parse_csv(theirs_export)
    assert sum(int(row["sessions"]) for row in theirs_rows) == 3
    assert sum(int(row["leads"]) for row in theirs_rows) == 3
    assert sum(int(row["unanswered"]) for row in theirs_rows) == 0

    # Same window length for both, so "row count" is not what distinguishes
    # them — the counts inside the rows are. That is exactly what a filter means.
    assert len(mine_rows) == len(theirs_rows) == 7

@pytest.mark.asyncio
async def test_export_carries_the_same_window_words_as_the_tiles(client):
    """The attachment's header names the same comparison window as the tiles.

    HTTP header values are latin-1, so a Chinese label travels percent-encoded;
    the day count rides beside it as plain ASCII.
    """
    from urllib.parse import unquote

    response = await client.get("/api/v1/admin/stats/export.csv?range=7d&locale=zh-CN")
    assert response.status_code == 200, response.text
    assert unquote(response.headers["x-analytics-window"]) == "vs 前 7 天"
    assert response.headers["x-analytics-window-days"] == "7"

    english = await client.get(
        "/api/v1/admin/stats/export.csv?range=7d&locale=en-US"
    )
    assert unquote(english.headers["x-analytics-window"]) == "vs previous 7 days"

@pytest.mark.asyncio
async def test_export_rejects_a_malformed_explicit_window(client):
    response = await client.get(
        "/api/v1/admin/stats/export.csv",
        params={"from": "2026-03-10T00:00:00+00:00", "to": "not-a-date"},
    )
    assert response.status_code == 400

    missing_bound = await client.get(
        "/api/v1/admin/stats/export.csv",
        params={"from": "2026-03-10T00:00:00+00:00"},
    )
    assert missing_bound.status_code == 400
