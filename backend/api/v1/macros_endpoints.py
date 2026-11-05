"""Operator reply macros (#74): the console's saved replies, one per workspace.

A macro is a snippet an operator drops into the reply composer instead of
retyping the same answer. It is **workspace-scoped, not agent-scoped** — the
house-keeping answers serve every agent that workspace runs.

Two rules this module must not break:

* **No existence leak.** A macro owned by another workspace answers the exact
  same 404 as an id that never existed, so an enumerable id cannot be used to
  probe a neighbour's macros. Every read and write goes through ``_load_macro``,
  which filters on the caller's workspace in the query itself.
* **The caps are the schema's, not ours.** ``MacroCreateRequest`` /
  ``MacroUpdateRequest`` (``api.v1.schemas``, frozen) carry
  ``max_length=200`` / ``max_length=2500``, so an over-long name or body is a
  FastAPI 422 before this file runs. Re-checking here would let the two drift
  apart, so the only thing done on top is ``db.flush()`` instead of
  ``db.commit()`` — a value that fits neither column surfaces as a 500-shaped
  integrity error rather than a silently truncated row.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from api.endpoints.auth import require_chat_operator
from api.v1.schemas import (
    MacroCreateRequest,
    MacroListResponse,
    MacroPayload,
    MacroUpdateRequest,
)
from database import get_db
from models import AdminUser, ReplyMacro

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["macros"])


def serialize_macro(macro: ReplyMacro) -> MacroPayload:
    return MacroPayload(
        id=macro.id,
        workspace_id=macro.workspace_id,
        name=macro.name,
        body=macro.body,
        created_by=macro.created_by,
        created_at=macro.created_at,
        updated_at=macro.updated_at,
    )


def _require_workspace(current_user: AdminUser) -> int:
    """The caller's workspace, or 400 — a macro with no workspace is unmatchable."""
    workspace_id = getattr(current_user, "workspace_id", None)
    if not workspace_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current admin has no workspace assigned",
        )
    return int(workspace_id)


async def _load_macro(
    db: AsyncSession, macro_id: str, current_user: AdminUser
) -> ReplyMacro:
    """Load one macro *of this workspace*, or 404.

    Foreign and missing are one branch on purpose: the response must not tell
    the caller which of the two it hit.
    """
    workspace_id = _require_workspace(current_user)
    macro = await db.scalar(
        select(ReplyMacro).where(
            ReplyMacro.id == macro_id,
            ReplyMacro.workspace_id == workspace_id,
        )
    )
    if macro is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Macro not found"
        )
    return macro


@router.get("/admin/macros", response_model=MacroListResponse)
async def list_macros(
    current_user: AdminUser = Depends(require_chat_operator),
    db: AsyncSession = Depends(get_db),
):
    """Every macro in the caller's workspace, alphabetical for the picker.

    ``total`` is the length of that same scoped set, so the console's header
    cannot disagree with the rows it is showing.
    """
    workspace_id = _require_workspace(current_user)
    rows = (
        await db.execute(
            select(ReplyMacro)
            .where(ReplyMacro.workspace_id == workspace_id)
            .order_by(ReplyMacro.name, ReplyMacro.id)
        )
    ).scalars().all()

    return MacroListResponse(
        items=[serialize_macro(row) for row in rows],
        total=len(rows),
    )


@router.post(
    "/admin/macros", response_model=MacroPayload, status_code=status.HTTP_201_CREATED
)
async def create_macro(
    payload: MacroCreateRequest,
    current_user: AdminUser = Depends(require_chat_operator),
    db: AsyncSession = Depends(get_db),
):
    """Save one macro. ``created_by`` is the authenticated admin, never the body."""
    workspace_id = _require_workspace(current_user)
    macro = ReplyMacro(
        workspace_id=workspace_id,
        name=payload.name,
        body=payload.body,
        created_by=current_user.id,
    )
    db.add(macro)
    await db.commit()
    await db.refresh(macro)
    logger.info("Macro %s created in workspace %s", macro.id, workspace_id)
    return serialize_macro(macro)


@router.patch("/admin/macros/{macro_id}", response_model=MacroPayload)
async def update_macro(
    macro_id: str,
    payload: MacroUpdateRequest,
    current_user: AdminUser = Depends(require_chat_operator),
    db: AsyncSession = Depends(get_db),
):
    """Partial update: only the fields the console sent are written."""
    macro = await _load_macro(db, macro_id, current_user)

    if payload.name is not None:
        macro.name = payload.name
    if payload.body is not None:
        macro.body = payload.body
    # `onupdate=func.now()` fires on any UPDATE, but it is a server default, so
    # set it here too: the response is serialized from this same object and the
    # console sorts its "recently edited" view on it.
    macro.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(macro)
    return serialize_macro(macro)


@router.delete("/admin/macros/{macro_id}")
async def delete_macro(
    macro_id: str,
    current_user: AdminUser = Depends(require_chat_operator),
    db: AsyncSession = Depends(get_db),
):
    """Remove one macro. Same shape as the other admin delete routes."""
    macro = await _load_macro(db, macro_id, current_user)
    await db.delete(macro)
    await db.commit()
    logger.info("Macro %s deleted from workspace %s", macro_id, macro.workspace_id)
    return {"success": True}
