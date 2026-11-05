"""Visitor chat attachments (#71) — upload and read back one attachment.

Both routes are **public**, exactly like their siblings under ``/api/v1/chat``:
the agent must exist and be live, the widget origin whitelist applies, and the
visitor must own the session the file belongs to. Nothing here reads an admin
token.

The metadata row is ``models.ChatAttachment``; the bytes live on disk under
``<CHAT_ATTACHMENTS_ROOT>/<session_id>/``. Parsed document text is prompt
material only and is never returned by an endpoint here.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Query,
    Request,
    UploadFile,
    status,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.v1.endpoints import (
    AGENT_PAUSED_DETAIL,
    enforce_signed_visitor_identity,
    enforce_widget_origin_whitelist,
    get_or_create_chat_session,
    resolve_public_chat_session,
)
from api.v1.schemas import (
    ATTACHMENT_MAX_FILE_BYTES,
    ATTACHMENT_MAX_FILES,
    ChatAttachmentPayload,
    ChatRequest,
)
from database import get_db
from models import Agent, ChatAttachment, ChatSession
from services.attachment_service import (
    ALLOWED_ATTACHMENT_EXTENSIONS,
    AttachmentService,
    attachment_extension,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["attachments"])

#: The visitor-facing rejection copy: one readable sentence per rule, so a client
#: that only renders `detail` still tells the visitor what to change.
TOO_MANY_FILES_DETAIL = f"At most {ATTACHMENT_MAX_FILES} files per conversation"
FILE_TOO_LARGE_DETAIL = (
    f"Each file must be {ATTACHMENT_MAX_FILE_BYTES // (1024 * 1024)}MB or smaller"
)
EMPTY_FILE_DETAIL = "Empty file"
UNSUPPORTED_TYPE_DETAIL = (
    "Unsupported file type (allowed: "
    + ", ".join(sorted(ALLOWED_ATTACHMENT_EXTENSIONS))
    + ")"
)
SESSION_NOT_FOUND_DETAIL = "Session not found"

async def _load_live_agent(db: AsyncSession, agent_id: str) -> Agent:
    """The agent must exist, not be deleted, and be active — like every sibling."""
    agent = (
        await db.execute(select(Agent).where(Agent.id == agent_id))
    ).scalar_one_or_none()
    if not agent or getattr(agent, "deleted_at", None):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found"
        )
    if not agent.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=AGENT_PAUSED_DETAIL
        )
    return agent

@router.post("/chat/attachments", response_model=ChatAttachmentPayload)
async def upload_chat_attachment(
    request: Request,
    file: UploadFile = File(..., description="One file: png/jpg/jpeg/pdf/docx/xlsx/txt/md/html"),
    agent_id: str = Query(..., description="Agent the visitor is talking to"),
    visitor_id: Optional[str] = Query(None, description="Owning visitor"),
    session_id: Optional[str] = Query(
        None, description="Owning public session id; minted when absent"
    ),
    db: AsyncSession = Depends(get_db),
):
    """Store one visitor file and return its metadata row.

    One file per request: the widget uploads sequentially, which is what lets a
    single over-size file be rejected with its own readable sentence instead of
    failing the whole batch. Every rejection is a 4xx that says why — an
    attachment is never dropped silently.
    """
    agent = await _load_live_agent(db, agent_id)
    enforce_signed_visitor_identity(agent, visitor_id)

    filename = (file.filename or "").strip()
    extension = attachment_extension(filename)
    if not filename or extension not in ALLOWED_ATTACHMENT_EXTENSIONS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=UNSUPPORTED_TYPE_DETAIL
        )

    # The session is resolved through the chat path's own helpers, so an upload
    # before the first message mints the same kind of row the first turn would
    # have created, and a foreign `session_id` is never adopted.
    session = None
    if session_id:
        session = await resolve_public_chat_session(db, session_id)
        if (
            not session
            or session.agent_id != agent.id
            or (session.visitor_id and session.visitor_id != (visitor_id or ""))
        ):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=SESSION_NOT_FOUND_DETAIL
            )
    if session is None:
        session = await get_or_create_chat_session(
            agent,
            ChatRequest(
                agent_id=agent.id,
                message="attachment",
                visitor_id=visitor_id,
                session_id=session_id,
            ),
            request,
            db,
        )

    enforce_widget_origin_whitelist(agent, request)

    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=EMPTY_FILE_DETAIL
        )
    if len(content) > ATTACHMENT_MAX_FILE_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=FILE_TOO_LARGE_DETAIL,
        )

    # Per-conversation ceiling, read from the rows themselves so five uploads
    # that each passed are still refused on the sixth.
    already_stored = int(
        await db.scalar(
            select(func.count(ChatAttachment.id)).where(
                ChatAttachment.session_id == session.id
            )
        )
        or 0
    )
    if already_stored >= ATTACHMENT_MAX_FILES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=TOO_MANY_FILES_DETAIL
        )

    stored = await AttachmentService().store(
        db,
        session_db_id=session.id,
        filename=filename,
        mime=file.content_type,
        content=content,
    )
    logger.info(
        "Attachment %s stored for session %s (%s, %s bytes, %s)",
        stored.id,
        session.session_id,
        stored.kind,
        stored.size_bytes,
        stored.status,
    )
    return _payload(stored, session.session_id)

def _payload(attachment: ChatAttachment, public_session_id: str) -> ChatAttachmentPayload:
    """The client payload, carrying the PUBLIC session id the visitor knows.

    ``ChatAttachment.session_id`` is the internal row id; echoing it would hand
    the client an id its next chat turn cannot use (and reveal an internal key).
    """
    payload = ChatAttachmentPayload.model_validate(attachment)
    payload.session_id = public_session_id
    return payload

@router.get("/chat/attachments/{attachment_id}", response_model=ChatAttachmentPayload)
async def get_chat_attachment(
    attachment_id: str,
    request: Request,
    visitor_id: Optional[str] = Query(None, description="Owning visitor"),
    db: AsyncSession = Depends(get_db),
):
    """One attachment's metadata, scoped to the session that owns it.

    A missing id and somebody else's id answer the same 404, so the endpoint
    never confirms that an attachment exists — the rule ``/chat/messages``
    already follows for sessions.
    """
    attachment = (
        await db.execute(
            select(ChatAttachment).where(ChatAttachment.id == attachment_id)
        )
    ).scalar_one_or_none()
    if attachment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found"
        )

    session = (
        await db.execute(
            select(ChatSession).where(ChatSession.id == attachment.session_id)
        )
    ).scalar_one_or_none()
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found"
        )

    agent = (
        await db.execute(select(Agent).where(Agent.id == session.agent_id))
    ).scalar_one_or_none()
    if agent is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found"
        )

    # #46: the signed-identity gate first (it explains a stale hash), then the
    # ownership 404 — the same order `/chat/messages` uses.
    enforce_signed_visitor_identity(agent, visitor_id)
    if session.visitor_id and session.visitor_id != (visitor_id or ""):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found"
        )
    enforce_widget_origin_whitelist(agent, request)

    return _payload(attachment, session.session_id)
