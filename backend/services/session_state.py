"""Session answer gate (#43, contract C3) — one source of truth.

Two independent axes decide who speaks next:

* ``status`` — the lifecycle: ``active | taken_over | resolved | closed | paused``.
  ``resolved`` (an operator closed the question) is **not** ``closed`` (the
  inactivity timeout / cost control), so the session list can tell them apart.
* ``mode`` — who is expected to answer: ``ai | human``. A single operator reply
  sets ``mode="human"`` without touching ``status``, so "human answered, bot is
  still available" is representable; ``taken_over`` implies ``mode="human"``.

The bot answers only when the session is ``active`` **and** in ``ai`` mode. Every
other combination persists the visitor message and answers nothing. Both
``/chat`` and ``/chat/stream`` go through `answer_gate` (which is
`should_ai_answer` plus the business-hours axis, #43 contract C6) so the rule
cannot drift between the two surfaces.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from services.business_hours import is_online

logger = logging.getLogger(__name__)

AI_MODE = "ai"
HUMAN_MODE = "human"

# The reason token for "the session is fine, the schedule is closed".
AFTER_HOURS = "after_hours"

# Statuses that are terminal for the bot: the visitor message is still stored,
# but no assistant turn is produced.
NO_ANSWER_STATUSES = frozenset({"taken_over", "resolved", "closed", "paused"})

# `ChatSession.mode` is nullable on rows written before the column existed.
DEFAULT_MODE = AI_MODE


def session_mode(session) -> str:
    """The effective mode of a session row (legacy NULL reads as ``ai``)."""
    mode = getattr(session, "mode", None)
    if mode in (AI_MODE, HUMAN_MODE):
        return mode
    return DEFAULT_MODE


def should_ai_answer(session) -> bool:
    """True only when status == 'active' and mode == 'ai'."""
    if session is None:
        return False
    if getattr(session, "status", None) != "active":
        return False
    return session_mode(session) == AI_MODE


def no_answer_reason(session) -> Optional[str]:
    """Why the bot stays silent, as a stable machine token (``None`` if it talks).

    ``human`` means "a human is expected to answer but nobody took the session
    over" — the visitor-side escalation state. The widget maps the token to its
    own localized copy; the backend never ships user-facing prose for this.
    """
    if session is None:
        return "missing"
    status = getattr(session, "status", None)
    if status in NO_ANSWER_STATUSES:
        return status
    if session_mode(session) == HUMAN_MODE:
        return "human"
    return None


def answer_gate(session, agent=None, now: Optional[datetime] = None) -> Optional[str]:
    """The single answer gate: ``None`` means the bot answers, else why it is mute.

    `should_ai_answer` stays the status/mode rule and is consulted first, so a
    session an operator already took over never reports ``after_hours`` — a human
    is there, the clock is irrelevant. Only an ``active``/``ai`` session then
    consults the agent's business hours, and an agent with no (or unparsable)
    config is always online inside `is_online`.

    ``now`` exists so tests can pin the instant instead of racing the wall clock.
    """
    if not should_ai_answer(session):
        return no_answer_reason(session) or getattr(session, "status", None) or "missing"
    if not is_online(agent, now):
        return AFTER_HOURS
    return None

def set_mode(session, mode: str) -> None:
    """Assign a validated mode; anything else is a programming error."""
    if mode not in (AI_MODE, HUMAN_MODE):
        raise ValueError(f"invalid session mode: {mode!r}")
    session.mode = mode


def mark_human_replied(session, now: Optional[datetime] = None) -> bool:
    """Stamp ``human_replied_at`` on the *first* human message only.

    Returns True when this call set it (the caller can log/broadcast that once).
    """
    if getattr(session, "human_replied_at", None) is not None:
        return False
    session.human_replied_at = now or datetime.now(timezone.utc)
    return True
