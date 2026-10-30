"""Analytics endpoints (#45): tiles with deltas, CSV export, outcome split.

Three routes, all on the existing admin auth dependencies:

* ``GET /admin/analytics`` — contract **C4**'s frozen metric dictionary
  (``metrics.<name> = {value, previous, delta, delta_pct}``, plus ``window`` and
  ``funnel``). Kept byte-compatible with the spec even though the console reads
  the richer tile payload below.
* ``GET /admin/stats/overview`` — what the dashboard renders: the same numbers
  as tiles that each carry ``window_label`` in prose, the outcome split and the
  top unanswered questions (a pointer to #42's queue, not a copy of it).
* ``GET /admin/stats/export.csv`` — the same filter params as the tiles, one row
  per day, ``text/csv`` + ``Content-Disposition: attachment`` + a UTF-8 BOM so
  Excel on Windows opens the Chinese cells correctly.

Every route resolves the caller's visible agents once (`_visible_agent_ids`), so
"the export respects the active filter" is the same code path as "the tiles do".
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.endpoints.auth import require_chat_operator
from api.v1.endpoints import require_agent_for_admin
from database import get_db
from models import AdminUser, Agent, AgentMember
from services import analytics_service
from services.analytics_service import (
    RANGE_DAYS,
    build_csv,
    build_tile,
    collect_metrics,
    daily_series,
    frozen_metric,
    funnel_summary,
    outcome_split,
    resolve_window,
    top_unanswered,
    window_from_bounds,
    window_label,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1")

#: The tiles the console renders, in reading order. Each maps to a metric key;
#: building them all through `build_tile` is what guarantees none of them can be
#: rendered without its comparison window.
TILE_METRICS: tuple[str, ...] = (
    "sessions",
    "messages",
    "ai_replies",
    "visitors",
    "leads",
    "handoffs",
    "unanswered",
    "degraded",
    "negative_feedback",
    "positive_feedback_rate",
)


async def _visible_agent_ids(
    db: AsyncSession, current_user: AdminUser, agent_id: Optional[str]
) -> list[str]:
    """The agents this admin may analyse — the scope every number is computed in.

    An explicit ``agent_id`` has to pass `require_agent_for_admin` (so a foreign
    agent is a 403 before a single row is read), which is exactly the rule the
    session list and #42's queue already apply.
    """
    if agent_id:
        await require_agent_for_admin(db, agent_id, current_user)
        return [agent_id]
    if current_user.role == "super_admin":
        if not current_user.workspace_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current admin has no workspace assigned",
            )
        rows = await db.execute(
            select(Agent.id).where(
                Agent.workspace_id == current_user.workspace_id,
                Agent.deleted_at.is_(None),
            )
        )
        return [row[0] for row in rows.all()]
    rows = await db.execute(
        select(AgentMember.agent_id).where(
            AgentMember.admin_user_id == current_user.id
        )
    )
    return [row[0] for row in rows.all()]


def _request_locale(request: Request) -> Optional[str]:
    """The caller's locale: `?locale=`, else `Accept-Language`, else zh-CN.

    Resolved with the same helper the rest of the API uses (`i18n.core`), so the
    window label an operator sees matches the language of the console they are
    reading, instead of always being the server default.
    """
    from i18n.core import get_locale_from_request

    return get_locale_from_request(request)


def _resolve_or_400(
    range_key: Optional[str], request: Request, *, now: Optional[datetime] = None
):
    try:
        window = resolve_window(range_key, now=now)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"`range` must be one of {', '.join(RANGE_DAYS)}"
                f" (got {range_key!r})"
            ),
        ) from error
    label = window_label(window.days, _request_locale(request))
    return window, label

def _resolve_filters(
    request: Request,
    range_key: Optional[str],
    from_: Optional[str],
    to: Optional[str],
):
    """The tiles' and the export's window, resolved by exactly one function.

    The console's one window resolver, so the tiles and the CSV cannot describe
    different periods: ``from``/``to`` win when given (an equal-length previous
    window is derived), otherwise ``range`` selects one of the shipped spans.
    """
    if from_ or to:
        try:
            start = _parse_bound(from_, "from")
            end = _parse_bound(to, "to")
            window = window_from_bounds(start, end)
        except ValueError as error:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)
            ) from error
        return window, window_label(window.days, _request_locale(request))
    return _resolve_or_400(range_key, request)


@router.get("/admin/analytics")
async def get_analytics(
    request: Request,
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
    range: Optional[str] = None,
    agent_id: Optional[str] = None,
    current_user: AdminUser = Depends(require_chat_operator),
    db: AsyncSession = Depends(get_db),
):
    """Contract C4: the frozen metric dictionary, plus `window` and `funnel`.

    ``range`` is the console's own shorthand and is only consulted when
    ``from``/``to`` are absent, so both spellings produce the same numbers.
    """
    window, _label = _resolve_filters(request, range, from_, to)

    agent_ids = await _visible_agent_ids(db, current_user, agent_id)
    current = await collect_metrics(db, agent_ids, window.start, window.end)
    previous = await collect_metrics(
        db, agent_ids, window.previous_start, window.previous_end
    )

    metrics = {}
    for name in (
        "sessions",
        "messages",
        "ai_replies",
        "visitors",
        "leads",
        "handoffs",
        "unanswered",
        "positive_feedback_rate",
        "widget_opens",
    ):
        metrics[name] = frozen_metric(
            build_tile(current.get(name), previous.get(name), "")
        )
    return {
        "metrics": metrics,
        "window": window.as_dict(),
        "funnel": funnel_summary(current),
    }


def _parse_bound(value: Optional[str], field: str) -> datetime:
    """Parse an ISO-8601 bound; a bad value is a 400, never a 500."""
    if not value:
        raise ValueError(f"`{field}` is required when the other bound is given")
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as error:
        raise ValueError(f"`{field}` must be an ISO-8601 timestamp") from error
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


@router.get("/admin/stats/overview")
async def get_stats_overview(
    request: Request,
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
    range: Optional[str] = None,
    agent_id: Optional[str] = None,
    top_limit: int = Query(5, ge=1, le=20),
    current_user: AdminUser = Depends(require_chat_operator),
    db: AsyncSession = Depends(get_db),
):
    """The dashboard's payload: tiles with deltas **and** their window in words.

    Acceptance box 1 is satisfied by construction — every tile comes out of
    `build_tile`, which cannot produce a delta without a ``window_label``. The
    payload also carries the outcome split and the top unanswered questions, so
    one request fills the whole console and the tiles, the export and the
    "what to do next" block can never disagree about the window.
    """
    window, label = _resolve_filters(request, range, from_, to)
    agent_ids = await _visible_agent_ids(db, current_user, agent_id)
    current = await collect_metrics(db, agent_ids, window.start, window.end)
    previous = await collect_metrics(
        db, agent_ids, window.previous_start, window.previous_end
    )

    tiles = {
        name: build_tile(current.get(name), previous.get(name), label)
        for name in TILE_METRICS
    }

    return {
        "range": (range or analytics_service.DEFAULT_RANGE),
        "window": {
            **window.as_dict(),
            "days": window.days,
            "label": label,
        },
        "tiles": tiles,
        "funnel": funnel_summary(current),
        "outcome_split": await outcome_split(
            db, agent_ids, window.start, window.end
        ),
        "top_unanswered": await top_unanswered(
            db, agent_ids, window.start, window.end, limit=top_limit
        ),
    }


@router.get("/admin/stats/export.csv")
async def export_stats_csv(
    request: Request,
    from_: Optional[str] = Query(None, alias="from"),
    to: Optional[str] = None,
    range: Optional[str] = None,
    agent_id: Optional[str] = None,
    current_user: AdminUser = Depends(require_chat_operator),
    db: AsyncSession = Depends(get_db),
):
    """`text/csv` + attachment + UTF-8 BOM, filtered exactly like the tiles.

    The row set is the window's days (zero-filled), so the export's row count is
    checkable against the same filtered tile query rather than being an
    incidental count of whatever had activity.
    """
    window, label = _resolve_filters(request, range, from_, to)
    agent_ids = await _visible_agent_ids(db, current_user, agent_id)
    rows = await daily_series(db, agent_ids, window.start, window.end)
    body = build_csv(rows)

    filename = f"basjoo-stats-{window.start.date().isoformat()}_{window.end.date().isoformat()}.csv"
    return Response(
        content=body.encode("utf-8"),
        media_type="text/csv; charset=utf-8",
        headers={
            # The BOM is inside the body; `attachment` is what makes the browser
            # save it instead of rendering it. Both are required by the issue.
            "Content-Disposition": f'attachment; filename="{filename}"',
            # Same window words as the tiles, so an operator who prints one and
            # opens the other sees the identical comparison period. HTTP header
            # values are latin-1, so the label travels percent-encoded (UTF-8)
            # next to an ASCII day count rather than being dropped or mangled.
            "X-Analytics-Window": quote(label, safe=""),
            "X-Analytics-Window-Days": str(int(window.days)
                                          if window.days == int(window.days)
                                          else round(window.days, 1)),
            "Cache-Control": "no-store",
        },
    )
