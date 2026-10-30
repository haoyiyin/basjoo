"""Business hours (#43, contract C6) — `zoneinfo`, never a fixed offset.

`agent.business_hours` is JSON::

    {"timezone": "Asia/Shanghai",
     "schedule": [{"day": 0, "start": 540, "end": 1080}]}

* ``day`` is 0 = Monday (Python ``weekday()``), ``start``/``end`` are minutes
  from local midnight.
* ``end <= start`` means the range wraps past midnight (22:00→02:00 is one
  range on the day it opens, not two).
* Resolution goes through `zoneinfo.ZoneInfo`, so DST is the library's job: a
  schedule is wall-clock local time, and the offset follows the date.
* No config, an empty schedule, or anything unparsable = "no hours configured"
  = always online (today's behaviour), with a warning for the unparsable case.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

logger = logging.getLogger(__name__)

MINUTES_PER_DAY = 24 * 60
_WEEK = 7

# Extra days scanned around "today" so a wrapping range that opened yesterday
# and one that opens tomorrow are both considered.
_DAY_WINDOW = (-1, 0, 1, 2)


def _as_utc(now: Optional[datetime]) -> datetime:
    if now is None:
        return datetime.now(timezone.utc)
    if now.tzinfo is None:
        # A naive datetime is UTC by convention in this codebase (SQLite drops
        # the offset on read, and every writer stores UTC).
        return now.replace(tzinfo=timezone.utc)
    return now


def _parse_config(agent) -> Optional[tuple[ZoneInfo, list[tuple[int, int, int]]]]:
    """Return ``(tz, [(day, start, end), ...])`` or None when not configured.

    Anything malformed is logged once per call and treated as "no hours", which
    is always-online: a broken schedule must never lock visitors out of chat.
    """
    raw = getattr(agent, "business_hours", None) if agent is not None else None
    if not raw:
        return None
    if not isinstance(raw, dict):
        logger.warning(
            "business_hours is not an object (%s); treating the agent as always online",
            type(raw).__name__,
        )
        return None

    tz_name = raw.get("timezone")
    if not isinstance(tz_name, str) or not tz_name.strip():
        logger.warning("business_hours has no timezone; treating the agent as always online")
        return None
    try:
        tz = ZoneInfo(tz_name.strip())
    except Exception:
        # ZoneInfoNotFoundError / ValueError / OSError: an unknown IANA name.
        logger.warning(
            "business_hours timezone %r is not a known IANA name; "
            "treating the agent as always online",
            tz_name,
        )
        return None

    schedule = raw.get("schedule")
    if schedule is None:
        return None
    if not isinstance(schedule, list):
        logger.warning(
            "business_hours.schedule is not a list (%s); treating the agent as always online",
            type(schedule).__name__,
        )
        return None

    ranges: list[tuple[int, int, int]] = []
    for entry in schedule:
        if not isinstance(entry, dict):
            logger.warning("business_hours schedule entry is not an object: %r", entry)
            return None
        try:
            day = int(entry["day"])
            start = int(entry["start"])
            end = int(entry["end"])
        except (KeyError, TypeError, ValueError):
            logger.warning("business_hours schedule entry is unparsable: %r", entry)
            return None
        if not (0 <= day < _WEEK) or not (0 <= start <= MINUTES_PER_DAY) or not (
            0 <= end <= MINUTES_PER_DAY
        ):
            logger.warning(
                "business_hours schedule entry is out of range: %r", entry
            )
            return None
        ranges.append((day, start, end))

    if not ranges:
        # A timezone with no ranges says nothing about when to be open.
        return None
    return tz, ranges


def _is_open_at(ranges: list[tuple[int, int, int]], weekday: int, minutes: int) -> bool:
    """Is ``minutes``-past-midnight on ``weekday`` inside any configured range?"""
    for day, start, end in ranges:
        if start < end:
            if weekday == day and start <= minutes < end:
                return True
        else:
            # Wraps past midnight: opens on `day`, closes on the next weekday.
            if weekday == day and minutes >= start:
                return True
            if weekday == (day + 1) % _WEEK and minutes < end:
                return True
    return False


def _localize(day: date, minutes: int, tz: ZoneInfo) -> datetime:
    """The instant a wall-clock boundary happens, DST-safe.

    A local time can be ambiguous (fall back: 01:30 happens twice) or missing
    (spring forward: 01:30 never happens). Resolving through `zoneinfo` with
    both ``fold`` values and keeping the earliest instant means a fall-back
    boundary is the first occurrence and a spring-forward boundary lands on the
    transition window instead of an hour off. No arithmetic on a fixed offset
    anywhere — the offset is always the library's answer for that date.
    """
    naive = datetime.combine(day, time(0, 0)) + timedelta(minutes=minutes)
    first = naive.replace(tzinfo=tz, fold=0)
    second = naive.replace(tzinfo=tz, fold=1)
    earliest = min(
        first.astimezone(timezone.utc), second.astimezone(timezone.utc)
    )
    return earliest.astimezone(tz)


def is_online(agent, now: Optional[datetime] = None) -> bool:
    """True when the agent is inside its configured hours (always-on if none)."""
    parsed = _parse_config(agent)
    if parsed is None:
        return True
    tz, ranges = parsed
    local = _as_utc(now).astimezone(tz)
    minutes = local.hour * 60 + local.minute
    return _is_open_at(ranges, local.weekday(), minutes)


def next_transition(agent, now: Optional[datetime] = None) -> Optional[datetime]:
    """The next instant `is_online` flips, or None when hours are not configured.

    Returned in the agent's own timezone, so ``.hour`` is the wall-clock hour the
    operator configured (this is what makes the DST assertion meaningful).
    """
    parsed = _parse_config(agent)
    if parsed is None:
        return None
    tz, ranges = parsed

    moment = _as_utc(now)
    local_today = moment.astimezone(tz).date()

    candidates: list[datetime] = []
    for offset in _DAY_WINDOW:
        day = local_today + timedelta(days=offset)
        for _day_index, start, end in ranges:
            candidates.append(_localize(day, start, tz))
            candidates.append(_localize(day, end, tz))

    future = [candidate for candidate in candidates if candidate > moment]
    if not future:
        return None
    return min(future)


def config_payload(agent) -> Optional[dict[str, Any]]:
    """The public `business_hours` value for `config:public` (raw or None)."""
    raw = getattr(agent, "business_hours", None) if agent is not None else None
    return raw if isinstance(raw, dict) else None


def away_message(agent) -> Optional[str]:
    """The operator's away copy, or None so the caller applies its default."""
    message = getattr(agent, "away_message", None) if agent is not None else None
    if isinstance(message, str) and message.strip():
        return message
    return None
