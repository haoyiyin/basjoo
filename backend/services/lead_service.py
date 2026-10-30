"""Lead capture (#41): one row per session, updated by a re-submit.

Two entry points write leads and they must not disagree:

* the widget's offline form (`POST /api/v1/leads`), and
* the prechat form, which stores the same identity on the session and upserts a
  `source="prechat"` lead.

**Idempotency is per session.** A double click, a retry after a lost response
and a resubmit with corrected details all land on the same row, so the
dashboard's lead count is the number of visitors who left contact details —
not the number of HTTP requests. The key is `(agent_id, session_id)` where
`session_id` is the **public** id the widget sends, which is the same pair the
chat path already treats as one conversation (`uq_chat_sessions_active_session`).
A submit with no `session_id` cannot be deduplicated that way and mints a fresh
row each time on purpose: there is no session for it to be the same as.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from models import Agent, ChatSession, Lead

logger = logging.getLogger(__name__)

SOURCE_OFFLINE_FORM = "offline-form"
SOURCE_PRECHAT = "prechat"
LEAD_SOURCES = frozenset({SOURCE_OFFLINE_FORM, SOURCE_PRECHAT, "trigger", "manual"})


def normalize_source(value: Optional[str]) -> str:
    """Coerce anything unrecognised to the offline form."""
    candidate = (value or "").strip()
    return candidate if candidate in LEAD_SOURCES else SOURCE_OFFLINE_FORM


async def upsert_lead(
    db: AsyncSession,
    *,
    agent: Agent,
    session: Optional[ChatSession],
    session_public_id: Optional[str],
    name: Optional[str],
    email: Optional[str],
    message: Optional[str] = None,
    page_url: Optional[str] = None,
    source: str = SOURCE_OFFLINE_FORM,
    commit: bool = True,
) -> tuple[Lead, bool]:
    """Create or update this session's lead; mirror the contact on the session.

    Returns ``(lead, created)`` so the route can answer 201 for a new capture and
    200 for "already had one, updated". A blank name/email on a re-submit never
    erases a value the operator already has; only non-empty fields overwrite.
    """
    cleaned_name = (name or "").strip() or None
    cleaned_email = (email or "").strip() or None
    cleaned_message = (message or "").strip() or None
    cleaned_page = (page_url or "").strip() or None
    cleaned_public_id = (session_public_id or "").strip() or None
    resolved_source = normalize_source(source)

    existing: Optional[Lead] = None
    if cleaned_public_id:
        existing = await db.scalar(
            select(Lead)
            .where(
                Lead.agent_id == agent.id,
                Lead.session_id == cleaned_public_id,
            )
            .order_by(Lead.created_at.asc().nulls_last(), Lead.id.asc())
        )

    now = datetime.now(timezone.utc)
    created = existing is None
    if existing is not None:
        if cleaned_name:
            existing.name = cleaned_name
        if cleaned_email:
            existing.email = cleaned_email
        if cleaned_message:
            existing.message = cleaned_message
        if cleaned_page:
            existing.page_url = cleaned_page
        # A later offline-form submit upgrades a prechat capture's provenance:
        # the visitor volunteered more than a name this time.
        if resolved_source in (SOURCE_OFFLINE_FORM, "trigger"):
            existing.source = resolved_source
        existing.updated_at = now
        lead = existing
    else:
        lead = Lead(
            agent_id=agent.id,
            workspace_id=getattr(agent, "workspace_id", None),
            session_id=cleaned_public_id,
            name=cleaned_name,
            email=cleaned_email,
            message=cleaned_message,
            page_url=cleaned_page,
            source=resolved_source,
            contacted=False,
            created_at=now,
            updated_at=now,
        )
        db.add(lead)

    if session is not None:
        # The session carries the visitor's identity so the transcript email has
        # a recipient and the console can show "who is this?" without a join.
        if cleaned_email:
            session.contact_email = cleaned_email
        if cleaned_name:
            session.contact_name = cleaned_name

    if commit:
        await db.commit()
        await db.refresh(lead)
    else:
        await db.flush()
    return lead, created


async def set_contacted(db: AsyncSession, lead: Lead, contacted: bool) -> Lead:
    """Flip the operator's "contacted" mark (idempotent in both directions)."""
    lead.contacted = bool(contacted)
    lead.contacted_at = datetime.now(timezone.utc) if contacted else None
    await db.commit()
    await db.refresh(lead)
    return lead


async def touch_transcript_sent(
    db: AsyncSession, session_id: str
) -> tuple[bool, Optional[datetime]]:
    """Claim the transcript send for `session_id`'s DB row, exactly once.

    `UPDATE ... WHERE transcript_sent_at IS NULL` is the guard: two concurrent
    callers both run it, the database serialises them, and exactly one sees
    `rowcount == 1`. The loser gets `(False, <existing timestamp>)` and must not
    send. This is deliberately a conditional UPDATE rather than a read-then-write
    in Python, which cannot be atomic across two processes.
    """
    now = datetime.now(timezone.utc)
    result = await db.execute(
        update(ChatSession)
        .where(
            ChatSession.id == session_id,
            ChatSession.transcript_sent_at.is_(None),
        )
        .values(transcript_sent_at=now)
    )
    await db.commit()
    if result.rowcount == 1:
        return True, now
    stamped = await db.scalar(
        select(ChatSession.transcript_sent_at).where(ChatSession.id == session_id)
    )
    return False, stamped


async def release_transcript_claim(db: AsyncSession, session_id: str) -> None:
    """Undo a claim after a failed send, so the operator can retry.

    Only ever called on the path where *this* request won the claim and then the
    SMTP server refused the mail: leaving the stamp set would report "already
    sent" forever for a message nobody received.
    """
    await db.execute(
        update(ChatSession)
        .where(ChatSession.id == session_id)
        .values(transcript_sent_at=None)
    )
    await db.commit()
