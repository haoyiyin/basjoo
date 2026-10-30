"""Analytics numbers for the operator console (#45).

Two contracts live here:

* **C4** — ``GET /admin/analytics`` returns exactly the metric dictionary the
  spec froze (each metric ``{value, previous, delta, delta_pct}``, plus
  ``window`` and ``funnel``).
* **#45 acceptance box 1** — every *tile* states its number, the delta against
  the previous equal-length window, and that window **in words**.

The second one is why `build_tile` is the only way a tile gets built: it takes
``(current, previous, window_label)`` and returns all of them together, so a
caller cannot produce a naked ``+12%`` — the label is part of the return value,
not a render-time detail somebody can forget. ``delta_pct`` is explicit about
the zero-previous case:

* previous ``0``, current ``0``  -> ``delta_pct=None``, ``delta_kind="none"``
* previous ``0``, current ``>0`` -> ``delta_pct=None``, ``delta_kind="new"``
* previous ``>0``                -> ``delta_pct`` a number, ``delta_kind="pct"``

``None`` (not ``NaN``, not ``Infinity``): JSON cannot carry either, and a
JavaScript client renders ``+Infinity%`` as garbage.

Every number is computed from existing rows — ``chat_sessions``,
``chat_messages`` and ``leads`` — with no counter column a background job would
have to keep in sync (spec ground rule). The one addition is
``chat_messages.degraded``, which simply *persists* the flag #44 already returns
on `ChatResponse.degraded` / the SSE `done` event; without it "how many answers
came from the fallback model" is not answerable from the database at all.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable, Optional, Sequence

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import ChatMessage, ChatSession, Lead

logger = logging.getLogger(__name__)

#: The ranges the console offers. Each is a whole number of days so the previous
#: window is exactly the same length as the current one.
DEFAULT_RANGE = "7d"
RANGE_DAYS: dict[str, int] = {"24h": 1, "7d": 7, "30d": 30, "90d": 90}

#: The comparison window in words, per response locale. It lives with the data
#: instead of the gettext catalogs on purpose: the tile payload is consumed by
#: scripts as well as by the SPA, and the window has to travel with the number
#: or the number is unreadable outside the console.
WINDOW_LABELS: dict[str, str] = {
    "zh-CN": "vs 前 {days} 天",
    "en-US": "vs previous {days} days",
}

#: CSV columns, in order. Frozen by the issue body.
CSV_COLUMNS: tuple[str, ...] = (
    "date",
    "sessions",
    "messages",
    "answered",
    "unanswered",
    "degraded",
    "leads",
    "negative_feedback",
    "avg_confidence",
)

#: Outcomes the async classifier writes (#45), and therefore the split the
#: console prints. Order is the reading order of the console.
OUTCOMES: tuple[str, ...] = ("resolved", "abandoned", "escalated", "no-answer")

#: A cell starting with one of these makes Excel (and Google Sheets) treat the
#: value as a formula. The operator opens this file on Windows in Excel, so the
#: guard is not theoretical.
FORMULA_PREFIXES = ("=", "+", "-", "@")

UTF8_BOM = "\ufeff"


# ------------------------------------------------------------------ windows


@dataclass(frozen=True)
class Window:
    """One analysis window plus the equal-length window before it."""

    days: float
    start: datetime
    end: datetime
    previous_start: datetime
    previous_end: datetime

    def as_dict(self) -> dict[str, Any]:
        return {
            "from": self.start.isoformat(),
            "to": self.end.isoformat(),
            "previous_from": self.previous_start.isoformat(),
            "previous_to": self.previous_end.isoformat(),
        }


def _utc_midnight(value: datetime) -> datetime:
    """Snap to 00:00 UTC — the boundary the daily CSV is bucketed on."""
    return value.astimezone(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )


def resolve_window(
    range_key: Optional[str] = None, *, now: Optional[datetime] = None
) -> Window:
    """Turn a range token into the current and previous windows.

    Windows are aligned to UTC midnight so a window of ``N`` days is exactly
    ``N`` calendar days — "today plus the N-1 days before it". That is what makes
    the CSV's row count equal to the window's day count (a mid-day boundary would
    straddle ``N+1`` dates and make the export's size depend on the hour the
    operator clicked), and it keeps the previous window exactly as long.

    Raises ``ValueError`` for an unknown token — callers turn that into a 400
    rather than silently analysing a window nobody asked for.
    """
    key = (range_key or DEFAULT_RANGE).strip()
    if key not in RANGE_DAYS:
        raise ValueError(f"unknown range: {range_key!r}")
    days = RANGE_DAYS[key]
    today = _utc_midnight(now or datetime.now(timezone.utc))
    start = today - timedelta(days=days - 1)
    end = today + timedelta(days=1)
    return Window(
        days=days,
        start=start,
        end=end,
        previous_start=start - timedelta(days=days),
        previous_end=start,
    )


def window_from_bounds(start: datetime, end: datetime) -> Window:
    """Explicit ``from``/``to`` (contract C4) -> window + equal-length previous."""
    span = end - start
    if span.total_seconds() <= 0:
        raise ValueError("`from` must be before `to`")
    return Window(
        days=span.total_seconds() / 86400,
        start=start,
        end=end,
        previous_start=start - span,
        previous_end=start,
    )


def locale_key(locale: Optional[str]) -> str:
    """Map any request locale onto one of the two catalogs we ship."""
    if locale and str(locale).lower().startswith("zh"):
        return "zh-CN"
    return "en-US"


def _pretty_days(days: Any) -> Any:
    """Whole days print as integers; a fractional span keeps one decimal."""
    try:
        value = float(days)
    except (TypeError, ValueError):
        return days
    return int(value) if value == int(value) else round(value, 1)


def window_label(days: Any, locale: Optional[str] = None) -> str:
    """The window in words: "vs 前 7 天" / "vs previous 7 days"."""
    template = WINDOW_LABELS[locale_key(locale)]
    if abs(float(days) - 1) < 1e-9:
        # "1 day", not "1 days": the label is prose the operator reads.
        template = template.replace("{days} days", "{days} day")
    return template.format(days=_pretty_days(days))


# -------------------------------------------------------------------- tiles


def _number(value: Any) -> Any:
    """None becomes 0; integers stay integers; floats keep their value."""
    if value is None:
        return 0
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0
    return int(number) if number == int(number) else number


def _round(value: float) -> Any:
    rounded = round(float(value), 4)
    return int(rounded) if rounded == int(rounded) else rounded


def build_tile(current: Any, previous: Any, label: str) -> dict[str, Any]:
    """The single tile builder: ``(current, previous, window_label)`` -> tile.

    Every tile in the console and every metric in the C4 dictionary goes through
    this function, so the label can never be left off and the zero-previous case
    can never turn into ``NaN`` or ``+Infinity%``.
    """
    current_value = _number(current)
    previous_value = _number(previous)

    if previous_value == 0:
        # No baseline: a percentage would be a division by zero. Distinguish
        # "nothing happened twice" from "something new happened".
        return {
            "value": current_value,
            "previous": previous_value,
            "delta": _round(current_value - previous_value),
            "delta_pct": None,
            "delta_kind": "none" if current_value == 0 else "new",
            "window_label": label,
        }

    delta_pct = (current_value - previous_value) / previous_value * 100
    return {
        "value": current_value,
        "previous": previous_value,
        "delta": _round(current_value - previous_value),
        "delta_pct": round(delta_pct, 1),
        "delta_kind": "pct",
        "window_label": label,
    }


def frozen_metric(tile: dict[str, Any]) -> dict[str, Any]:
    """Project a tile onto the four keys contract C4 froze."""
    return {
        "value": tile["value"],
        "previous": tile["previous"],
        "delta": tile["delta"],
        "delta_pct": tile["delta_pct"],
    }


# ----------------------------------------------------------------- queries


def human_handoff_predicate():
    """SQL predicate: "a human was expected in this session" (#43's two axes)."""
    return (
        (ChatSession.human_replied_at.isnot(None))
        | (ChatSession.status == "taken_over")
        | (ChatSession.mode == "human")
    )


async def collect_metrics(
    db: AsyncSession,
    agent_ids: Sequence[str],
    start: datetime,
    end: datetime,
) -> dict[str, Any]:
    """Every number the console shows for one window, from existing rows only."""
    ids = list(agent_ids) or ["__none__"]
    session_scope = (
        ChatSession.agent_id.in_(ids),
        ChatSession.created_at >= start,
        ChatSession.created_at < end,
    )
    message_scope = (
        ChatMessage.created_at >= start,
        ChatMessage.created_at < end,
    )
    assistant = ChatMessage.role == "assistant"

    async def _session_count(*extra) -> int:
        return int(
            await db.scalar(
                select(func.count(ChatSession.id)).where(*session_scope, *extra)
            )
            or 0
        )

    async def _message_count(*extra) -> int:
        value = await db.scalar(
            select(func.count(ChatMessage.id))
            .select_from(ChatMessage)
            .join(ChatSession, ChatSession.id == ChatMessage.session_id)
            .where(ChatSession.agent_id.in_(ids), *message_scope, *extra)
        )
        return int(value or 0)

    sessions = await _session_count()
    visitors = int(
        await db.scalar(
            select(func.count(func.distinct(ChatSession.visitor_id))).where(
                *session_scope,
                ChatSession.visitor_id.isnot(None),
                ChatSession.visitor_id != "",
            )
        )
        or 0
    )
    handoffs = await _session_count(human_handoff_predicate())
    conversations = int(
        await db.scalar(
            select(func.count(func.distinct(ChatSession.id)))
            .select_from(ChatSession)
            .join(ChatMessage, ChatMessage.session_id == ChatSession.id)
            .where(*session_scope, ChatMessage.role == "user")
        )
        or 0
    )
    ai_replies = await _message_count(
        assistant, func.coalesce(ChatMessage.sender_type, "") != "human"
    )
    answered = await _message_count(assistant, ChatMessage.is_unanswered.is_(False))
    unanswered = await _message_count(assistant, ChatMessage.is_unanswered.is_(True))
    degraded = await _message_count(assistant, ChatMessage.degraded.is_(True))
    negative_feedback = await _message_count(ChatMessage.rating == -1)
    positive_feedback = await _message_count(ChatMessage.rating == 1)
    rated = await _message_count(ChatMessage.rating.in_((1, -1)))
    avg_confidence = await db.scalar(
        select(func.avg(ChatMessage.confidence))
        .select_from(ChatMessage)
        .join(ChatSession, ChatSession.id == ChatMessage.session_id)
        .where(
            ChatSession.agent_id.in_(ids),
            *message_scope,
            assistant,
            ChatMessage.confidence.isnot(None),
        )
    )
    leads = int(
        await db.scalar(
            select(func.count(Lead.id)).where(
                Lead.agent_id.in_(ids), Lead.created_at >= start, Lead.created_at < end
            )
        )
        or 0
    )

    return {
        "sessions": sessions,
        # There is no "widget opened" row anywhere in the schema, and the ground
        # rules forbid adding a counter a job must keep in sync, so the funnel's
        # first step is the conversation that open actually produced. An open
        # that never becomes a message leaves no trace and is not counted.
        "widget_opens": sessions,
        "conversations": conversations,
        "visitors": visitors,
        "messages": await _message_count(),
        "ai_replies": ai_replies,
        "answered": answered,
        "unanswered": unanswered,
        "degraded": degraded,
        "handoffs": handoffs,
        "leads": leads,
        "negative_feedback": negative_feedback,
        "positive_feedback_rate": (
            round(int(positive_feedback) / int(rated), 4) if rated else 0.0
        ),
        "avg_confidence": (
            round(float(avg_confidence), 4) if avg_confidence is not None else None
        ),
    }


async def daily_series(
    db: AsyncSession,
    agent_ids: Sequence[str],
    start: datetime,
    end: datetime,
) -> list[dict[str, Any]]:
    """One CSV row per day of the window.

    Zero-filled on purpose: the row count is then the window length (so the
    export's row count is checkable against the tile query's window) and a quiet
    day is visible instead of simply missing.
    """
    ids = list(agent_ids) or ["__none__"]
    day = func.date

    sessions_by_day = {
        str(row[0]): int(row[1] or 0)
        for row in (
            await db.execute(
                select(day(ChatSession.created_at), func.count(ChatSession.id))
                .where(
                    ChatSession.agent_id.in_(ids),
                    ChatSession.created_at >= start,
                    ChatSession.created_at < end,
                )
                .group_by(day(ChatSession.created_at))
            )
        ).all()
    }
    leads_by_day = {
        str(row[0]): int(row[1] or 0)
        for row in (
            await db.execute(
                select(day(Lead.created_at), func.count(Lead.id))
                .where(
                    Lead.agent_id.in_(ids),
                    Lead.created_at >= start,
                    Lead.created_at < end,
                )
                .group_by(day(Lead.created_at))
            )
        ).all()
    }

    messages_by_day: dict[str, int] = {}
    answered_by_day: dict[str, int] = {}
    unanswered_by_day: dict[str, int] = {}
    degraded_by_day: dict[str, int] = {}
    negative_by_day: dict[str, int] = {}
    confidence_by_day: dict[str, Optional[float]] = {}
    for row in (
        await db.execute(
            select(
                day(ChatMessage.created_at),
                func.count(ChatMessage.id),
                func.sum(ChatMessage.is_unanswered.is_(True)),
                func.sum(ChatMessage.degraded.is_(True)),
                func.sum(ChatMessage.rating == -1),
                func.avg(ChatMessage.confidence),
            )
            .select_from(ChatMessage)
            .join(ChatSession, ChatSession.id == ChatMessage.session_id)
            .where(
                ChatSession.agent_id.in_(ids),
                ChatMessage.created_at >= start,
                ChatMessage.created_at < end,
            )
            .group_by(day(ChatMessage.created_at))
        )
    ).all():
        key = str(row[0])
        messages_by_day[key] = int(row[1] or 0)
        unanswered_by_day[key] = int(row[2] or 0)
        degraded_by_day[key] = int(row[3] or 0)
        negative_by_day[key] = int(row[4] or 0)
        confidence_by_day[key] = (
            round(float(row[5]), 4) if row[5] is not None else None
        )
    # "answered" is its own grouped query rather than `messages - unanswered`,
    # because `messages` counts visitor turns too; keeping them separate means
    # the two columns can never disagree through a Python approximation.
    for row in (
        await db.execute(
            select(day(ChatMessage.created_at), func.count(ChatMessage.id))
            .select_from(ChatMessage)
            .join(ChatSession, ChatSession.id == ChatMessage.session_id)
            .where(
                ChatSession.agent_id.in_(ids),
                ChatMessage.created_at >= start,
                ChatMessage.created_at < end,
                ChatMessage.role == "assistant",
                ChatMessage.is_unanswered.is_(False),
            )
            .group_by(day(ChatMessage.created_at))
        )
    ).all():
        answered_by_day[str(row[0])] = int(row[1] or 0)

    rows: list[dict[str, Any]] = []
    cursor = start.date()
    last = (end - timedelta(microseconds=1)).date()
    while cursor <= last:
        key = cursor.isoformat()
        rows.append(
            {
                "date": key,
                "sessions": sessions_by_day.get(key, 0),
                "messages": messages_by_day.get(key, 0),
                "answered": answered_by_day.get(key, 0),
                "unanswered": unanswered_by_day.get(key, 0),
                "degraded": degraded_by_day.get(key, 0),
                "leads": leads_by_day.get(key, 0),
                "negative_feedback": negative_by_day.get(key, 0),
                "avg_confidence": confidence_by_day.get(key),
            }
        )
        cursor += timedelta(days=1)
    return rows


async def outcome_split(
    db: AsyncSession,
    agent_ids: Sequence[str],
    start: datetime,
    end: datetime,
) -> dict[str, Any]:
    """The classifier's verdict, split four ways, plus what is still unfinished.

    Only ``closed``/``resolved`` sessions are classifiable, so ``total`` is the
    number of *finished* sessions in the window and ``unclassified`` is how many
    of them the scheduler has not reached yet. A fresh install is all zero.
    """
    ids = list(agent_ids) or ["__none__"]
    finished = int(
        await db.scalar(
            select(func.count(ChatSession.id)).where(
                ChatSession.agent_id.in_(ids),
                ChatSession.created_at >= start,
                ChatSession.created_at < end,
                ChatSession.status.in_(("closed", "resolved")),
            )
        )
        or 0
    )
    counts = {outcome: 0 for outcome in OUTCOMES}
    for outcome, count in (
        await db.execute(
            select(ChatSession.outcome, func.count(ChatSession.id))
            .where(
                ChatSession.agent_id.in_(ids),
                ChatSession.created_at >= start,
                ChatSession.created_at < end,
                ChatSession.outcome.isnot(None),
            )
            .group_by(ChatSession.outcome)
        )
    ).all():
        if outcome in counts:
            counts[outcome] = int(count or 0)
    classified = sum(counts.values())
    return {
        **counts,
        "total": finished,
        "classified": classified,
        "unclassified": max(finished - classified, 0),
    }


async def top_unanswered(
    db: AsyncSession,
    agent_ids: Sequence[str],
    start: datetime,
    end: datetime,
    *,
    limit: int = 5,
) -> list[dict[str, Any]]:
    """The most-asked unanswered questions — a pointer into #42's queue.

    The row carries the queue's own coordinates plus the question text, and the
    console links to ``/agents/<id>/sessions?unanswered=1``; nothing is
    duplicated, the grouping key is the queue's own normaliser so the two
    surfaces cannot disagree about "the same question".
    """
    from sqlalchemy.orm import aliased

    from api.v1.qa_endpoints import normalized_question_sql

    ids = list(agent_ids) or ["__none__"]
    assistant = aliased(ChatMessage)
    prior_question = (
        select(ChatMessage.content)
        .where(
            ChatMessage.session_id == assistant.session_id,
            ChatMessage.role == "user",
            ChatMessage.id < assistant.id,
        )
        .order_by(ChatMessage.id.desc())
        .limit(1)
        .correlate(assistant)
        .scalar_subquery()
    )
    key = normalized_question_sql(func.trim(prior_question))
    grouped = (
        select(
            func.coalesce(key, "").label("question_key"),
            func.count(assistant.id).label("occurrences"),
            func.max(assistant.id).label("message_id"),
            func.max(assistant.created_at).label("last_seen"),
            func.max(prior_question).label("sample_question"),
        )
        .select_from(assistant)
        .join(ChatSession, ChatSession.id == assistant.session_id)
        .where(
            ChatSession.agent_id.in_(ids),
            assistant.role == "assistant",
            assistant.is_unanswered.is_(True),
            assistant.created_at >= start,
            assistant.created_at < end,
        )
        .group_by(func.coalesce(key, ""))
        .order_by(func.count(assistant.id).desc(), func.max(assistant.id).desc())
        .limit(limit)
    )
    return [
        {
            "question": (row.sample_question or row.question_key).strip(),
            "occurrences": int(row.occurrences or 1),
            "message_id": int(row.message_id),
            "last_seen": (
                row.last_seen.isoformat() if row.last_seen is not None else None
            ),
        }
        for row in (await db.execute(grouped)).all()
        if row.question_key
    ]


def funnel_summary(metrics: dict[str, Any]) -> dict[str, Any]:
    """Open widget -> started a conversation -> left a lead, with conversions."""
    opens = int(metrics.get("widget_opens") or 0)
    conversations = int(metrics.get("conversations") or 0)
    leads = int(metrics.get("leads") or 0)
    return {
        "opens": opens,
        "conversations": conversations,
        "leads": leads,
        "conversation_rate": round(conversations / opens, 4) if opens else 0.0,
        "lead_rate": round(leads / conversations, 4) if conversations else 0.0,
    }


# --------------------------------------------------------------------- CSV


def csv_cell(value: Any) -> str:
    """One CSV cell: formula-prefixed text is escaped with a leading apostrophe."""
    text = "" if value is None else str(value)
    if text.startswith("'"):
        # Already escaped once by a producer: do not stack apostrophes.
        return text
    if text[:1] in FORMULA_PREFIXES:
        return f"'{text}"
    return text


def build_csv(rows: Iterable[dict[str, Any]]) -> str:
    """Render the frozen column set as CRLF CSV with a UTF-8 BOM.

    The BOM is what makes Excel on Windows open a Chinese cell without
    mojibake, so it must be the very first character of the body.
    """
    lines = [",".join(CSV_COLUMNS)]
    for row in rows:
        lines.append(",".join(csv_cell(row.get(column)) for column in CSV_COLUMNS))
    return UTF8_BOM + "\r\n".join(lines) + "\r\n"
