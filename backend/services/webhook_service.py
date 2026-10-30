"""Outbound webhooks that never touch the request path (#47).

Two halves, deliberately split:

* ``enqueue_webhook`` runs **inside the caller's transaction** and does one
  thing — insert a ``webhook_deliveries`` row with ``status="pending"``. No
  ``httpx``, no DNS, no sleep. That is the whole reason a dead subscriber can
  never delay (or fail) the chat request, the lead write or the indexing commit.
* ``drain_pending_webhooks`` is the scheduler's job. It POSTs the stored body,
  signed with ``X-Basjoo-Signature: sha256=<hmac>`` over the *exact bytes* that
  are sent, 5 s timeout, three attempts with exponential backoff, then
  ``failed``. A bounded batch per tick means one dead endpoint cannot starve the
  rest of the queue.

The signing secret is Fernet-encrypted at rest on the agent
(``Agent.webhook_secret``), exactly like ``api_key``; it is decrypted only here,
in the worker.

Payload shape (contract C5)::

    {"event": "<name>", "timestamp": "<iso8601>", "agent_id": "...", "data": {...}}

The ``payload`` column stores the serialised body verbatim, so every retry signs
and sends byte-identical JSON — a receiver that checks the signature never sees
a mismatch caused by re-serialisation.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.encryption import decrypt_api_key
from models import Agent, WebhookDelivery

logger = logging.getLogger(__name__)

#: Event names this build can emit. `session.created` / `session.closed` /
#: `lead.created` / `message.unanswered` are the frozen C5 set; the other three
#: are the #47 additions and must not be renamed.
WEBHOOK_EVENTS = frozenset(
    {
        "session.created",
        "session.closed",
        "message.created",
        "message.unanswered",
        "handoff.requested",
        "lead.created",
        "document.indexed",
    }
)

#: One POST attempt never blocks a worker for longer than this.
WEBHOOK_TIMEOUT_SECONDS = 5.0
#: A delivery is given up after this many attempts (3 total POSTs).
WEBHOOK_MAX_ATTEMPTS = 3
#: First retry wait; doubled per attempt (exponential backoff).
WEBHOOK_BACKOFF_BASE_SECONDS = 30
#: Upper bound on deliveries drained by a single scheduler tick.
WEBHOOK_BATCH_SIZE = 50

SIGNATURE_HEADER = "X-Basjoo-Signature"

def agent_has_webhook(agent: Optional[Agent]) -> bool:
    """True when this agent has somewhere to deliver to."""
    return bool(getattr(agent, "webhook_url", None))

def build_payload(event: str, agent_id: str, data: dict[str, Any]) -> str:
    """Serialise one delivery body. The stored bytes are the signed bytes."""
    if event not in WEBHOOK_EVENTS:
        raise ValueError(f"Unknown webhook event: {event}")
    return json.dumps(
        {
            "event": event,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "agent_id": agent_id,
            "data": data,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )

def sign_payload(secret: Optional[str], body: bytes) -> str:
    """Return ``sha256=<hex hmac>`` for the exact body that will be sent."""
    key = (secret or "").encode("utf-8")
    digest = hmac.new(key, body, hashlib.sha256).hexdigest()
    return f"sha256={digest}"

def enqueue_webhook(
    db: AsyncSession,
    agent: Optional[Agent],
    event: str,
    data: dict[str, Any],
) -> Optional[WebhookDelivery]:
    """Register a delivery in the caller's transaction. Never performs I/O.

    Returns the row (unflushed) so a caller/test can inspect it, or ``None``
    when the agent has no endpoint configured — the common case, and the reason
    an unconfigured installation writes no rows at all.
    """
    if not agent_has_webhook(agent):
        return None
    delivery = WebhookDelivery(
        agent_id=str(agent.id),
        event=event,
        payload=build_payload(event, str(agent.id), data),
        status="pending",
        attempts=0,
    )
    db.add(delivery)
    return delivery

async def enqueue_webhook_for_agent_id(
    db: AsyncSession, agent_id: Optional[str], event: str, data: dict[str, Any]
) -> Optional[WebhookDelivery]:
    """Worker-side variant: one lightweight lookup, then ``enqueue_webhook``.

    Background jobs (document indexing, the session auto-close sweep) do not hold
    the ``Agent`` row, so they pay a single indexed read here instead of caching
    a copy that can go stale.
    """
    if not agent_id:
        return None
    agent = (
        await db.execute(
            select(Agent).where(Agent.id == str(agent_id)).limit(1)
        )
    ).scalar_one_or_none()
    return enqueue_webhook(db, agent, event, data)

def enqueue_lead_created(
    db: AsyncSession, agent: Optional[Agent], lead: Any
) -> Optional[WebhookDelivery]:
    """`lead.created` for a freshly added ``Lead`` row (#47 / #41 seam)."""
    return enqueue_webhook(
        db,
        agent,
        "lead.created",
        {
            "lead_id": str(getattr(lead, "id", "")),
            "session_id": getattr(lead, "session_id", None),
            "email": getattr(lead, "email", None),
            "name": getattr(lead, "name", None),
            "source": getattr(lead, "source", None),
        },
    )

def _backoff_deadline(attempts: int) -> datetime:
    """Next attempt time for the *n*-th failure (1-based)."""
    delay = WEBHOOK_BACKOFF_BASE_SECONDS * (2 ** max(attempts - 1, 0))
    return datetime.now(timezone.utc) + timedelta(seconds=delay)

async def _post(
    url: str, body: bytes, secret: Optional[str]
) -> None:
    """One signed POST. Raises on any non-2xx or transport failure."""
    headers = {
        "Content-Type": "application/json",
        SIGNATURE_HEADER: sign_payload(secret, body),
    }
    async with httpx.AsyncClient(timeout=WEBHOOK_TIMEOUT_SECONDS) as client:
        response = await client.post(url, content=body, headers=headers)
        response.raise_for_status()

async def drain_pending_webhooks(
    db: AsyncSession,
    limit: int = WEBHOOK_BATCH_SIZE,
    now: Optional[datetime] = None,
) -> dict[str, int]:
    """Deliver one bounded batch of pending rows. Returns per-outcome counts.

    ``now`` exists so a test can walk the exponential backoff without sleeping.
    Every failure is persisted on the row (`last_error`, `attempts`,
    `next_attempt_at`) — never raised — because a webhook problem must not take
    down the scheduler tick for the rest of the queue.
    """
    cutoff = now or datetime.now(timezone.utc)
    rows = list(
        (
            await db.execute(
                select(WebhookDelivery)
                .where(
                    WebhookDelivery.status == "pending",
                    or_(
                        WebhookDelivery.next_attempt_at.is_(None),
                        WebhookDelivery.next_attempt_at <= cutoff,
                    ),
                )
                .order_by(WebhookDelivery.created_at.asc(), WebhookDelivery.id.asc())
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )

    stats = {"delivered": 0, "retrying": 0, "failed": 0, "skipped": 0}
    if not rows:
        return stats

    agent_ids = {row.agent_id for row in rows}
    agents = {
        agent.id: agent
        for agent in (
            await db.execute(select(Agent).where(Agent.id.in_(agent_ids)))
        )
        .scalars()
        .all()
    }

    for row in rows:
        agent = agents.get(row.agent_id)
        url = getattr(agent, "webhook_url", None) if agent else None
        if not url:
            # The endpoint was removed between enqueue and delivery (or the agent
            # was unbound). Nothing to send; retrying forever would be a leak.
            row.status = "failed"
            row.last_error = "Agent has no webhook endpoint configured"
            stats["failed"] += 1
            continue

        secret = decrypt_api_key(getattr(agent, "webhook_secret", None))
        body = str(row.payload or "").encode("utf-8")
        try:
            await _post(url, body, secret)
        except Exception as exc:  # noqa: BLE001 - recorded on the row, never re-raised
            row.attempts = int(row.attempts or 0) + 1
            row.last_error = _bounded(str(exc))
            if row.attempts >= WEBHOOK_MAX_ATTEMPTS:
                row.status = "failed"
                stats["failed"] += 1
                logger.warning(
                    "Webhook %s delivery failed permanently after %s attempts: %s",
                    row.event,
                    row.attempts,
                    row.last_error,
                )
            else:
                row.next_attempt_at = _backoff_deadline(row.attempts)
                stats["retrying"] += 1
                logger.info(
                    "Webhook %s delivery attempt %s failed, retrying: %s",
                    row.event,
                    row.attempts,
                    row.last_error,
                )
        else:
            row.status = "delivered"
            row.delivered_at = datetime.now(timezone.utc)
            row.last_error = None
            stats["delivered"] += 1

    await db.commit()
    return stats

def _bounded(message: str, limit: int = 500) -> str:
    return " ".join(str(message or "").split())[:limit]
