"""Async outcome classification (#45) — and why it can never hurt live chat.

The console's "what to do next" block needs to know how finished conversations
ended: ``resolved``, ``abandoned``, ``escalated`` or ``no-answer``. That is a
job for later, not for the visitor's request, so the classifier is a scheduler
tick and nothing else:

* it reads **only** ``closed`` / ``resolved`` sessions that went quiet at least
  ``CLASSIFY_QUIET_MINUTES`` ago — an active conversation is never touched;
* it runs in its own ``AsyncSessionLocal`` transaction per batch, so a failure
  aborts that batch and rolls it back — it cannot roll back anything the chat
  path wrote, and it cannot hold a connection the chat path wants;
* every failure is caught and logged here; the tick returns normally. A broken
  classifier therefore cannot fail a request, cannot retry inline, and cannot
  corrupt a session row (a partially written batch is rolled back as a unit);
* the classifier itself is a **plain callable** (`Classifier`), so a test can
  inject one that raises and prove the containment.

The shipped classifier is deterministic and needs no model: the outcome is
derivable from rows the chat path already writes (a human reply, an unanswered
answer, whether the visitor ever got an answer at all). A deployment that wants
a model instead injects any async callable that returns a `Classification` and
declares ``requires_provider = True`` on itself; such a classifier is skipped —
logged once, never a traceback per tick — when no agent has a usable provider
configuration. That is the "an install without an LLM key must not log a
traceback every tick" rule, and it is why the default classifier is the
deterministic one: a fresh install classifies from day one.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Awaitable, Callable, Optional, Sequence

from sqlalchemy import or_, select

from models import Agent, ChatMessage, ChatSession
from services.answer_quality import normalize_text

logger = logging.getLogger(__name__)

#: How long a session has to be quiet before its outcome is decided. The issue
#: says "about 30 minutes after a session goes quiet".
CLASSIFY_QUIET_MINUTES = 30

#: Only these statuses are classifiable. `active` / `taken_over` / `paused` are
#: still in flight; `closed` (inactivity) and `resolved` (operator) are done.
CLASSIFIABLE_STATUSES: tuple[str, ...] = ("closed", "resolved")

#: `topic` is a display string on the session row.
TOPIC_MAX_CHARS = 100


@dataclass(frozen=True)
class SessionSnapshot:
    """Everything the classifier may look at, read before it is called.

    A plain frozen value object on purpose: the classifier cannot reach back
    into the session or the database, so it cannot leave a transaction dirty
    when it raises.
    """

    session_db_id: str
    agent_id: str
    status: str
    mode: str
    human_replied_at: Optional[datetime]
    message_count: int
    #: ``(role, content, is_unanswered, sender_type)`` in chronological order.
    messages: tuple[tuple[str, str, bool, Optional[str]], ...] = field(default=())

    @property
    def user_messages(self) -> list[str]:
        return [content for role, content, _u, _s in self.messages if role == "user"]

    @property
    def assistant_messages(self) -> list[tuple[str, bool, Optional[str]]]:
        return [
            (content, unanswered, sender)
            for role, content, unanswered, sender in self.messages
            if role == "assistant"
        ]


@dataclass(frozen=True)
class Classification:
    """What the classifier decided. Every field is optional except `outcome`."""

    outcome: str
    topic: Optional[str] = None
    sentiment: Optional[str] = None


#: A plain function: snapshot in, verdict (or None for "leave it alone") out.
Classifier = Callable[[SessionSnapshot], Awaitable[Optional[Classification]]]

OUTCOMES: tuple[str, ...] = ("resolved", "abandoned", "escalated", "no-answer")


def derive_topic(snapshot: SessionSnapshot) -> Optional[str]:
    """The visitor's first real question, trimmed — the session's subject."""
    for question in snapshot.user_messages:
        text = " ".join((question or "").split())
        if text:
            return text[:TOPIC_MAX_CHARS]
    return None


async def classify_snapshot(snapshot: SessionSnapshot) -> Optional[Classification]:
    """The shipped classifier: deterministic, no model, no I/O.

    Reading order, first match wins:

    1. ``escalated`` — a human was expected: they replied, or the session was
       taken over (#43's own signal, not a guess).
    2. ``no-answer`` — the visitor asked something real and the last answer the
       bot gave was flagged unanswered (#42's flag).
    3. ``abandoned`` — the visitor never got a single answer, or never wrote
       anything at all.
    4. ``resolved`` — the bot answered and nobody needed a human.
    """
    if snapshot.human_replied_at is not None or snapshot.mode == "human" \
            or snapshot.status == "taken_over":
        return Classification(outcome="escalated", topic=derive_topic(snapshot))

    assistants = snapshot.assistant_messages
    if assistants:
        last_content, last_unanswered, _sender = assistants[-1]
        if last_unanswered and normalize_text(last_content):
            return Classification(outcome="no-answer", topic=derive_topic(snapshot))
    if not assistants:
        return Classification(outcome="abandoned", topic=derive_topic(snapshot))
    return Classification(outcome="resolved", topic=derive_topic(snapshot))


#: The default classifier the scheduler runs.
DEFAULT_CLASSIFIER: Classifier = classify_snapshot


def provider_configured(agent: Optional[Agent]) -> bool:
    """True when the agent could actually reach a model.

    Only model-backed classifiers consult this. The shipped classifier is
    deterministic and needs no provider, so a fresh install classifies without
    an LLM key; a *model-backed* classifier installed by a deployment declares
    ``requires_provider = True`` and the scheduler skips it — logging the reason
    once, never a traceback per tick — when this returns False.
    """
    if agent is None:
        return False
    if not (getattr(agent, "api_key", None) or getattr(agent, "fallback_api_key", None)):
        return False
    return bool(getattr(agent, "model", None))


def requires_provider(classifier: Classifier) -> bool:
    """Whether a classifier needs a live provider (opt-in, default False)."""
    return bool(getattr(classifier, "requires_provider", False))


# ------------------------------------------------------------- row plumbing


def snapshot_from_rows(
    row: ChatSession, messages: Sequence[ChatMessage]
) -> SessionSnapshot:
    """Freeze a session and its messages into the value the classifier sees."""
    return SessionSnapshot(
        session_db_id=row.id,
        agent_id=row.agent_id,
        status=str(row.status or ""),
        mode=str(row.mode or "ai"),
        human_replied_at=row.human_replied_at,
        message_count=int(row.message_count or 0),
        messages=tuple(
            (
                str(message.role),
                message.content or "",
                bool(message.is_unanswered),
                message.sender_type,
            )
            for message in messages
        ),
    )


def classify_candidates_query(cutoff: datetime, limit: int):
    """The rows a tick may look at: finished, quiet, not yet classified."""
    return (
        select(ChatSession)
        .where(
            ChatSession.status.in_(CLASSIFIABLE_STATUSES),
            ChatSession.outcome.is_(None),
            or_(
                ChatSession.updated_at <= cutoff,
                (ChatSession.updated_at.is_(None))
                & (ChatSession.created_at <= cutoff),
            ),
        )
        .order_by(ChatSession.created_at.asc())
        .limit(limit)
    )
