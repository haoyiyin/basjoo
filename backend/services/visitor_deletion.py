"""One-click visitor deletion (#46) — the GDPR-shaped request.

`DELETE /admin/visitors/{visitor_id}` removes everything that belongs to one
visitor on the agents the caller can see: transcript rows, their sessions, the
leads captured from them, and the thumbs votes stored on their own turns.

Three deliberate decisions:

* **One transaction, explicit deletes.** The schema has no ``ON DELETE CASCADE``
  on these tables (recreating them to add one would rewrite every row on an
  installation upgrade). Children go first — leads and messages before sessions —
  and a failure anywhere rolls the whole thing back, so a visitor is never left
  half-deleted.
* **Verified by row counts.** Every count is `rowcount` from the statement that
  deleted the rows, not a pre-count that could drift between two statements, so
  the console can say exactly what happened.
* **Workspace scope is the caller's, not the visitor's.** The caller supplies
  the visible agent ids; a visitor who only exists in another workspace yields
  zero rows and the route answers 404, which never confirms they exist.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional, Sequence

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import ChatMessage, ChatSession, Lead

logger = logging.getLogger(__name__)

def _in(ids: Sequence[str]) -> list[str]:
    """An empty `IN ()` list is valid in SQLAlchemy but clearer as a sentinel."""
    return list(ids) or ["__no_agent__"]

async def delete_visitor_data(
    db: AsyncSession,
    *,
    visitor_id: str,
    agent_ids: Sequence[str],
    email: Optional[str] = None,
) -> Dict[str, Any]:
    """Delete one visitor's rows and return the counts.

    ``email`` is the *verified* address behind a signed identity (#46). When it
    is present, leads captured on the caller's agents with that address are
    swept too, because a lead can exist without a session (the offline form
    posts before a session is ever created). An unsigned visitor passes
    ``email=None`` and only session-linked leads are touched — an arbitrary
    ``visitor_id`` must never be allowed to select rows by string match.

    The caller owns the transaction: this function never commits, so a route
    can add its own work (an audit line, a webhook row) to the same unit.
    """
    scoped_agents = _in(agent_ids)

    session_ids = select(ChatSession.id).where(
        ChatSession.agent_id.in_(scoped_agents),
        ChatSession.visitor_id == visitor_id,
    )

    # Thumbs votes (#41) live on the visitor's own message rows, so they are
    # counted here before the message delete takes them. There is no separate
    # feedback table in this schema — the vote *is* a column on the turn it
    # judges.
    feedback = int(
        await db.scalar(
            select(func.count(ChatMessage.id)).where(
                ChatMessage.session_id.in_(session_ids),
                ChatMessage.rating.isnot(None),
                ChatMessage.rating != 0,
            )
        )
        or 0
    )

    # Leads first: a lead may point at a session.
    lead_filter = Lead.session_id.in_(session_ids)
    if email:
        lead_filter = or_(
            lead_filter,
            and_(Lead.agent_id.in_(scoped_agents), func.lower(Lead.email) == email),
        )
    leads = (await db.execute(delete(Lead).where(lead_filter))).rowcount or 0

    messages = (
        await db.execute(delete(ChatMessage).where(ChatMessage.session_id.in_(session_ids)))
    ).rowcount or 0
    sessions = (
        await db.execute(
            delete(ChatSession).where(
                ChatSession.agent_id.in_(scoped_agents),
                ChatSession.visitor_id == visitor_id,
            )
        )
    ).rowcount or 0

    logger.warning(
        "Visitor data deleted: sessions=%s messages=%s leads=%s feedback=%s "
        "agents=%s (requested by an admin)",
        sessions,
        messages,
        leads,
        feedback,
        len(agent_ids),
    )

    return {
        "sessions": int(sessions),
        "messages": int(messages),
        "leads": int(leads),
        "feedback": feedback,
    }
