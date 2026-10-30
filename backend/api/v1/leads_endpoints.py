"""Lead capture (#41): the widget's public form plus the operator's list.

The write route is **public on purpose** — it is what a visitor who got no
answer submits — so it enforces the same rules the chat surface does: the agent
must exist and be live (a paused or soft-deleted agent answers exactly like an
unknown one), and the widget origin whitelist applies. Nothing here reads an
admin token.

The read/write-admin routes (`/admin/leads*`) are workspace-scoped like every
other admin surface: a lead from another workspace answers the same 404 as a
missing one.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.endpoints.auth import get_current_admin, require_chat_operator
from api.v1.endpoints import (
    AGENT_PAUSED_DETAIL,
    enforce_widget_origin_whitelist,
)
from api.v1.schemas import (
    LEAD_MESSAGE_MAX_LENGTH,
    LEAD_NAME_MAX_LENGTH,
    LeadContactedRequest,
    LeadListResponse,
    LeadPayload,
    LeadSubmitRequest,
)
from database import get_db
from models import AdminUser, Agent, ChatSession, Lead
from services.lead_service import SOURCE_OFFLINE_FORM, set_contacted, upsert_lead
logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["leads"])


def serialize_lead(lead: Lead) -> LeadPayload:
    return LeadPayload(
        id=lead.id,
        agent_id=lead.agent_id,
        session_id=lead.session_id,
        name=lead.name,
        email=lead.email,
        phone=lead.phone,
        message=lead.message,
        source=lead.source or SOURCE_OFFLINE_FORM,
        page_url=lead.page_url,
        contacted=bool(lead.contacted),
        contacted_at=lead.contacted_at,
        created_at=lead.created_at,
        updated_at=lead.updated_at,
    )


def _require_workspace(current_user: AdminUser) -> int:
    workspace_id = getattr(current_user, "workspace_id", None)
    if not workspace_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current admin has no workspace assigned",
        )
    return int(workspace_id)


@router.post("/leads", response_model=LeadPayload)
async def submit_lead(
    payload: LeadSubmitRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    """Capture one visitor's details. **Idempotent per session.**

    A second submit from the same session updates the row instead of creating
    one, so a double click cannot invent a second lead. A new capture answers
    201; a re-submit answers 200 with the same body, which is how the widget
    tells "saved" from "saved again" without ever creating a duplicate.
    """
    agent = await db.scalar(select(Agent).where(Agent.id == payload.agent_id))
    if agent is None or getattr(agent, "deleted_at", None):
        # An unknown and a deleted agent answer the same way: existence is
        # never confirmed to the public.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found"
        )
    if not agent.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=AGENT_PAUSED_DETAIL
        )

    enforce_widget_origin_whitelist(agent, request)

    session: Optional[ChatSession] = None
    if payload.session_id:
        session = await db.scalar(
            select(ChatSession)
            .where(
                ChatSession.agent_id == agent.id,
                ChatSession.session_id == payload.session_id,
            )
            .order_by(ChatSession.created_at.desc(), ChatSession.id.desc())
        )
        # An enumerable public id must not let one visitor attach details to a
        # stranger's conversation; an unknown id is simply not linked.
        if session is None:
            logger.info(
                "Lead submitted for agent %s with unknown session id %r",
                agent.id,
                payload.session_id,
            )

    lead, created = await upsert_lead(
        db,
        agent=agent,
        session=session,
        session_public_id=payload.session_id,
        name=payload.name,
        email=payload.email,
        message=payload.message,
        page_url=payload.page_url,
        source=payload.source,
    )
    response.status_code = (
        status.HTTP_201_CREATED if created else status.HTTP_200_OK
    )
    logger.info(
        "Lead %s for agent %s (session=%s, source=%s)",
        "created" if created else "updated",
        agent.id,
        lead.session_id,
        lead.source,
    )
    return serialize_lead(lead)


@router.get("/admin/leads", response_model=LeadListResponse)
async def list_leads(
    agent_id: Optional[str] = None,
    contacted: Optional[bool] = None,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    current_user: AdminUser = Depends(require_chat_operator),
    db: AsyncSession = Depends(get_db),
):
    """The operator's lead list, newest first."""
    workspace_id = _require_workspace(current_user)
    conditions = [Agent.workspace_id == workspace_id]
    if agent_id:
        conditions.append(Lead.agent_id == agent_id)
    if contacted is not None:
        conditions.append(Lead.contacted.is_(contacted))

    def _scoped(*extra):
        return (
            select(Lead)
            .join(Agent, Agent.id == Lead.agent_id)
            .where(*conditions, *extra)
        )

    scoped = _scoped().subquery()
    total = (await db.scalar(select(func.count()).select_from(scoped))) or 0
    # How much of the inbox still needs a human: one count from the same rows,
    # never a counter column the writer could forget to bump.
    uncontacted = (
        await db.scalar(
            select(func.count())
            .select_from(scoped)
            .where(scoped.c.contacted.is_(False))
        )
    ) or 0

    rows = (
        await db.execute(
            _scoped()
            .order_by(Lead.created_at.desc().nulls_last(), Lead.id.desc())
            .offset(skip)
            .limit(limit)
        )
    ).scalars().all()

    return LeadListResponse(
        items=[serialize_lead(row) for row in rows],
        total=total,
        uncontacted=uncontacted,
    )


async def _load_lead(db: AsyncSession, lead_id: str, current_user: AdminUser) -> Lead:
    workspace_id = _require_workspace(current_user)
    lead = await db.scalar(
        select(Lead)
        .join(Agent, Agent.id == Lead.agent_id)
        .where(Lead.id == lead_id, Agent.workspace_id == workspace_id)
    )
    if lead is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found"
        )
    return lead


@router.patch("/admin/leads/{lead_id}", response_model=LeadPayload)
async def update_lead_contacted(
    lead_id: str,
    payload: LeadContactedRequest,
    current_user: AdminUser = Depends(require_chat_operator),
    db: AsyncSession = Depends(get_db),
):
    """Toggle "contacted". Both directions are idempotent."""
    lead = await _load_lead(db, lead_id, current_user)
    lead = await set_contacted(db, lead, payload.contacted)
    return serialize_lead(lead)


@router.get("/admin/leads/{lead_id}", response_model=LeadPayload)
async def get_lead(
    lead_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    lead = await _load_lead(db, lead_id, current_user)
    return serialize_lead(lead)
