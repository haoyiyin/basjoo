"""Curated Q&A, revise-answer write-back, fixed facts and procedures (#39).

Q&A belongs to the **KB**, not the agent: a pair is embedded into the KB's own
`qa_<hex>` collection with the KB's own embedding model, and a KB outlives every
agent bound to it. The agent-scoped write-back routes resolve the KB through the
`agents.kb_id` binding (`require_bound_kb`) and answer 409 when it is missing.

The admin auth dependencies are the ones `api.v1.endpoints` already uses; no new
permission model is introduced here.
"""

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from api.endpoints.auth import (
    get_current_admin,
    require_admin_or_super_admin,
    require_chat_operator,
)
from api.v1.endpoints import require_bound_kb
from api.v1.schemas import (
    FixedFactsRequest,
    FixedFactsResponse,
    ProcedureCreateRequest,
    ProcedureListResponse,
    ProcedurePayload,
    ProcedureUpdateRequest,
    QaFromMessageResponse,
    QaImportRequest,
    QaImportResponse,
    QaItemCreateRequest,
    QaItemListResponse,
    QaItemPayload,
    QaItemUpdateRequest,
    QaMatchRequest,
    QaMatchResponse,
    ReviseAnswerRequest,
    ReviseAnswerResponse,
    UnansweredItem,
    UnansweredListResponse,
)
from database import get_db
from models import (
    AdminUser,
    Agent,
    AgentMember,
    ChatMessage,
    ChatSession,
    KnowledgeBase,
    Procedure,
    QaItem,
)
from services.answer_quality import UNANSWERED_MIN_QUESTION_CHARS
from services.keyword_fallback import MIN_KEYWORD_LENGTH, match_for_kb, normalize
from services.qa_service import QaService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["qa"])

# Issue #42's rule, reused here: a question shorter than this cannot be a real
# visitor question, so it is never turned into a curated pair.
MIN_QA_QUESTION_LENGTH = UNANSWERED_MIN_QUESTION_CHARS

# #60 — the keyword-path limits the write endpoint enforces. The per-keyword
# floor is `keyword_fallback.MIN_KEYWORD_LENGTH`: the same constant the matcher
# uses to skip a keyword, so "rejected at write time" and "can never match"
# cannot drift apart.
MAX_QA_KEYWORDS = 20
MAX_QA_KEYWORD_LENGTH = 40

def _require_workspace(current_user: AdminUser) -> int:
    workspace_id = getattr(current_user, "workspace_id", None)
    if not workspace_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current admin has no workspace assigned",
        )
    return int(workspace_id)

async def _load_kb_in_workspace(
    db: AsyncSession, kb_id: str, current_user: AdminUser
) -> KnowledgeBase:
    """A KB from another workspace behaves exactly like a missing one."""
    kb = await db.scalar(
        select(KnowledgeBase).where(
            KnowledgeBase.id == kb_id,
            KnowledgeBase.workspace_id == _require_workspace(current_user),
        )
    )
    if not kb:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge base not found"
        )
    return kb

async def _load_qa_item(db: AsyncSession, kb_id: str, qa_id: str) -> QaItem:
    item = await db.scalar(
        select(QaItem).where(QaItem.id == qa_id, QaItem.kb_id == kb_id)
    )
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Q&A item not found"
        )
    return item

def _validate_question(question: str) -> str:
    text = (question or "").strip()
    if len(text) < MIN_QA_QUESTION_LENGTH:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Question must be at least {MIN_QA_QUESTION_LENGTH} characters",
        )
    return text

def _validate_keywords(keywords: Optional[list[str]]) -> list[str]:
    """Normalise, reject, dedupe — the write-time half of the #60 contract.

    `services.keyword_fallback.normalize` is the *same* function `match()` calls
    on both sides, so a keyword this accepts is a keyword the matcher compares
    exactly. A blank entry normalises to `""` and is therefore rejected by the
    same length rule as a single character — never silently dropped, because a
    silently dropped trigger is an operator believing a pair is reachable when
    it is not.

    Order is preserved on dedupe so the operator's own ordering is what the
    admin API gives back.
    """
    if not keywords:
        return []
    normalised: list[str] = []
    seen: set[str] = set()
    for raw in keywords:
        if not isinstance(raw, str):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"keyword_too_short: {raw}",
            )
        keyword = normalize(raw)
        if len(keyword) < MIN_KEYWORD_LENGTH:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"keyword_too_short: {raw.strip()}",
            )
        if len(keyword) > MAX_QA_KEYWORD_LENGTH:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"keyword_too_long: {keyword}",
            )
        if keyword in seen:
            continue
        seen.add(keyword)
        normalised.append(keyword)
        if len(normalised) > MAX_QA_KEYWORDS:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"too_many_keywords: {len(normalised)} > {MAX_QA_KEYWORDS}"
                ),
            )
    return normalised

async def _sync_best_effort(item: QaItem, db: AsyncSession) -> None:
    """Persist first, index second: an embedding outage must not lose the row."""
    try:
        await QaService().sync_item(item, db)
        await db.commit()
        # `embedding_hash` is written by the sync and `updated_at` is
        # server-generated, so both need one round trip before serialisation.
        await db.refresh(item)
    except Exception as error:
        logger.warning("Q&A indexing skipped for item %s: %s", item.id, error)
        await db.rollback()

async def _create_qa_item(
    db: AsyncSession,
    kb: KnowledgeBase,
    *,
    question: str,
    answer: str,
    keywords: Optional[list[str]] = None,
    source: str = "manual",
    source_message_id: Optional[int] = None,
) -> tuple[QaItem, bool]:
    """Insert or update one pair. Returns ``(item, replaced)``.

    Uniqueness is `(kb_id, question)`, so re-saving the same question *corrects*
    the answer instead of duplicating it — that is what makes `revise-answer`
    idempotent and what makes a corrected pair replace the old text in the prompt.

    `keywords` is written on **both** branches: the create route owns the
    operator's trigger words, and a corrected pair that kept stale keywords
    would keep matching messages it no longer answers for. The transcript
    write-back routes pass `None` and therefore leave whatever is stored alone.
    """
    existing = await db.scalar(
        select(QaItem).where(
            QaItem.kb_id == kb.id, QaItem.question == question
        )
    )
    if existing:
        existing.answer = answer
        existing.enabled = True
        existing.source = source
        if keywords is not None:
            existing.keywords = list(keywords)
        if source_message_id is not None:
            existing.source_message_id = source_message_id
        await db.commit()
        await db.refresh(existing)
        return existing, True

    if await QaService().max_items_reached(kb.workspace_id, db):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Q&A item limit reached",
        )

    item = QaItem(
        kb_id=kb.id,
        question=question,
        answer=answer,
        enabled=True,
        keywords=list(keywords) if keywords else None,
        source=source,
        source_message_id=source_message_id,
    )
    db.add(item)
    try:
        await db.commit()
    except IntegrityError as error:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Q&A item already exists",
        ) from error
    await db.refresh(item)
    return item, False

# --------------------------------------------------------------- KB-scoped Q&A

@router.get(
    "/knowledge-bases/{kb_id}/qa-items", response_model=QaItemListResponse
)
async def list_qa_items(
    kb_id: str,
    skip: int = 0,
    limit: int = 100,
    current_user: AdminUser = Depends(require_admin_or_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """List the KB's curated pairs, newest first."""
    await _load_kb_in_workspace(db, kb_id, current_user)
    total = await db.scalar(
        select(func.count(QaItem.id)).where(QaItem.kb_id == kb_id)
    )
    result = await db.execute(
        select(QaItem)
        .where(QaItem.kb_id == kb_id)
        .order_by(QaItem.created_at.desc(), QaItem.id.desc())
        .offset(max(0, skip))
        .limit(max(1, min(limit, 500)))
    )
    items = result.scalars().all()
    return QaItemListResponse(
        items=[QaItemPayload.model_validate(item) for item in items],
        total=int(total or 0),
    )

@router.post(
    "/knowledge-bases/{kb_id}/qa-items",
    response_model=QaItemPayload,
    status_code=status.HTTP_201_CREATED,
)
async def create_qa_item(
    kb_id: str,
    payload: QaItemCreateRequest,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a pair and index it immediately (no KB reindex needed)."""
    kb = await _load_kb_in_workspace(db, kb_id, current_user)
    question = _validate_question(payload.question)
    keywords = _validate_keywords(payload.keywords)
    existing = await db.scalar(
        select(QaItem.id).where(QaItem.kb_id == kb.id, QaItem.question == question)
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Q&A item already exists",
        )
    item, _ = await _create_qa_item(
        db, kb, question=question, answer=payload.answer, keywords=keywords
    )
    await _sync_best_effort(item, db)
    return QaItemPayload.model_validate(item)

@router.put(
    "/knowledge-bases/{kb_id}/qa-items/{qa_id}", response_model=QaItemPayload
)
async def update_qa_item(
    kb_id: str,
    qa_id: str,
    payload: QaItemUpdateRequest,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update a pair. An answer-only edit reuses the stored vector (hash match)."""
    await _load_kb_in_workspace(db, kb_id, current_user)
    item = await _load_qa_item(db, kb_id, qa_id)

    if payload.question is not None:
        question = payload.question.strip()
        clash = await db.scalar(
            select(QaItem.id).where(
                QaItem.kb_id == kb_id,
                QaItem.question == question,
                QaItem.id != item.id,
            )
        )
        if clash:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Q&A item already exists",
            )
        item.question = question
    if payload.answer is not None:
        item.answer = payload.answer.strip()
    if payload.enabled is not None:
        # Disabling deletes the point; enabling re-embeds it.
        item.enabled = payload.enabled
    if payload.keywords is not None:
        # `[]` clears the trigger words; absent leaves them untouched.
        item.keywords = _validate_keywords(payload.keywords) or None
    await db.commit()
    await db.refresh(item)
    await _sync_best_effort(item, db)
    return QaItemPayload.model_validate(item)

@router.delete("/knowledge-bases/{kb_id}/qa-items/{qa_id}")
async def delete_qa_item(
    kb_id: str,
    qa_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Delete a pair and its vector point — the next prompt no longer has it."""
    await _load_kb_in_workspace(db, kb_id, current_user)
    item = await _load_qa_item(db, kb_id, qa_id)
    qa_id_value = item.id
    kb_id_value = item.kb_id
    await QaService().delete_item(item, db)
    await db.delete(item)
    await db.commit()
    logger.info("Deleted Q&A item %s from kb %s", qa_id_value, kb_id_value)
    return {"deleted": True, "id": qa_id_value}

@router.post(
    "/knowledge-bases/{kb_id}/qa-items:match", response_model=QaMatchResponse
)
async def match_qa_items(
    kb_id: str,
    payload: QaMatchRequest,
    current_user: AdminUser = Depends(require_admin_or_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Ask the LLM-free keyword path what it would serve for one message (#60).

    Read-only and hermetic: one `SELECT` over the KB's enabled pairs, no
    embedding, no Qdrant, no provider. It is the operator's tester, so it must
    answer exactly what a real outage would answer — it calls the same
    `match_for_kb` the chat seam calls, never a reimplementation.

    A miss is a `200` with `matched: null`: a miss is a normal answer in chat,
    and turning it into an error here would make the tester lie about the path.
    """
    await _load_kb_in_workspace(db, kb_id, current_user)
    hit = await match_for_kb(db, kb_id, payload.message)
    if hit is None:
        return QaMatchResponse(matched=None, score=None, matched_keywords=[])
    # The full payload (hits, source, timestamps) lives on the row, so it is read
    # back by the id the matcher returned. Scoped to the same KB: the tester can
    # never surface a pair from another KB.
    item = await db.scalar(
        select(QaItem).where(QaItem.id == hit.qa_id, QaItem.kb_id == kb_id)
    )
    if item is None:
        return QaMatchResponse(matched=None, score=None, matched_keywords=[])
    return QaMatchResponse(
        matched=QaItemPayload.model_validate(item),
        score=hit.score,
        matched_keywords=list(hit.matched),
    )

@router.post(
    "/knowledge-bases/{kb_id}/qa-items:import", response_model=QaImportResponse
)
async def import_qa_items(
    kb_id: str,
    payload: QaImportRequest,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Bulk import. Blank rows and duplicates are skipped, never fatal."""
    kb = await _load_kb_in_workspace(db, kb_id, current_user)
    created = 0
    skipped = 0
    for pair in payload.items:
        question = (pair.question or "").strip()
        answer = (pair.answer or "").strip()
        if not question or not answer:
            skipped += 1
            continue
        try:
            item, replaced = await _create_qa_item(
                db, kb, question=question, answer=answer
            )
        except HTTPException:
            # Quota reached or a race on the unique index: this row is skipped,
            # the ones already written stay.
            skipped += 1
            continue
        if replaced:
            skipped += 1
        else:
            created += 1
        await _sync_best_effort(item, db)
    return QaImportResponse(created=created, skipped=skipped)

# ------------------------------------------------------- transcript write-back

async def _agent_bound_kb(db: AsyncSession, agent: Agent) -> KnowledgeBase:
    """The KB an agent's write-back lands on; 409 when nothing is bound."""
    kb_id = require_bound_kb(agent)
    kb = await db.scalar(select(KnowledgeBase).where(KnowledgeBase.id == kb_id))
    if not kb:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Agent has no knowledge base bound. Bind one first.",
        )
    return kb

async def _load_session_for_admin(
    db: AsyncSession, session_id: str, current_user: AdminUser
) -> ChatSession:
    from api.v1.endpoints import require_agent_for_admin, resolve_admin_chat_session

    session = await resolve_admin_chat_session(db, session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Session not found"
        )
    agent = await require_agent_for_admin(db, session.agent_id, current_user)
    return session, agent

@router.post(
    "/admin/sessions/{session_id}/revise-answer",
    response_model=ReviseAnswerResponse,
)
async def revise_answer(
    session_id: str,
    payload: ReviseAnswerRequest,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Turn an operator's correction into a curated pair on the agent's KB."""
    session, agent = await _load_session_for_admin(db, session_id, current_user)
    kb = await _agent_bound_kb(db, agent)

    last_user = await db.scalar(
        select(ChatMessage)
        .where(ChatMessage.session_id == session.id, ChatMessage.role == "user")
        .order_by(ChatMessage.created_at.desc(), ChatMessage.id.desc())
        .limit(1)
    )
    if not last_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Session has no user message to revise",
        )
    question = _validate_question(last_user.content)

    item, replaced = await _create_qa_item(
        db,
        kb,
        question=question,
        answer=payload.answer,
        source="revise",
        source_message_id=last_user.id,
    )
    await _sync_best_effort(item, db)
    return ReviseAnswerResponse(
        qa_item=QaItemPayload.model_validate(item), replaced=replaced
    )

@router.post(
    "/admin/qa/from-message/{message_id}", response_model=QaFromMessageResponse
)
async def qa_from_message(
    message_id: int,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Add the question that produced an assistant message to the agent's KB.

    The question is the nearest earlier `role="user"` message *in the same
    session*; the answer is the assistant message's own content.
    """
    message = await db.get(ChatMessage, message_id)
    if not message:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Message not found"
        )
    # #42: only an assistant message is an answer worth curating. Accepting a
    # user message would store the visitor's own words as the answer.
    if message.role != "assistant":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only an assistant message can be added to the Q&A index",
        )
    session, agent = await _load_session_for_admin(
        db, message.session_id, current_user
    )
    kb = await _agent_bound_kb(db, agent)

    question_row = await db.scalar(
        select(ChatMessage)
        .where(
            ChatMessage.session_id == message.session_id,
            ChatMessage.role == "user",
            ChatMessage.id < message.id,
        )
        .order_by(ChatMessage.id.desc())
        .limit(1)
    )
    if not question_row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No preceding user message found",
        )

    question = _validate_question(question_row.content)
    answer = (message.content or "").strip()
    if not answer:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Message has no answer text",
        )

    item, _ = await _create_qa_item(
        db,
        kb,
        question=question,
        answer=answer,
        source="unanswered",
        source_message_id=message.id,
    )
    await _sync_best_effort(item, db)
    return QaFromMessageResponse(qa_item=QaItemPayload.model_validate(item))

# --------------------------------------------------- unanswered triage (#42)

def _scope_session_query(query, current_user: AdminUser, agent_id: Optional[str]):
    """Apply the workspace/agent-membership rule the session routes already use.

    Kept local so the new endpoints scope identically: a super admin sees only
    its own workspace, an agent member sees only its agents, and an explicit
    `agent_id` still has to pass `require_agent_for_admin` (a foreign agent is
    therefore a 403 before any row is read).
    """
    if agent_id:
        query = query.where(ChatSession.agent_id == agent_id)
    elif current_user.role == "super_admin":
        if not current_user.workspace_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Current admin has no workspace assigned",
            )
        query = query.join(Agent, Agent.id == ChatSession.agent_id).where(
            Agent.workspace_id == current_user.workspace_id
        )
    else:
        query = query.where(
            ChatSession.agent_id.in_(
                select(AgentMember.agent_id).where(
                    AgentMember.admin_user_id == current_user.id
                )
            )
        )
    return query

#: `2026-01-01T00:00:00+08:00` sent unencoded arrives as `...00:00 08:00`,
#: because `+` means space in a query string. Put the offset sign back.
_UNENCODED_OFFSET = re.compile(r"^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?) (\d{2}:?\d{2})$")

def _parse_since(since: Optional[str]) -> datetime:
    """ISO-8601 `since`, default 30 days back. A bad value is a 400, not a 500."""
    if not since:
        return datetime.now(timezone.utc) - timedelta(days=30)
    text = since.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    unencoded = _UNENCODED_OFFSET.match(text)
    if unencoded:
        text = f"{unencoded.group(1)}+{unencoded.group(2)}"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="`since` must be an ISO-8601 timestamp",
        ) from error
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed

def normalized_question_sql(column):
    """`normalize_text` as a SQL expression: trim, collapse whitespace, lowercase.

    The `occurrences` count is a `GROUP BY` over this key, so the whole queue is
    one query instead of a Python scan of every unanswered row. SQLite has no
    regexp `replace`, so runs of spaces are halved eight times — 256 consecutive
    spaces collapse to one, far past anything a visitor types.
    """
    text = func.lower(column)
    for whitespace in ("\t", "\n", "\r"):
        text = func.replace(text, whitespace, " ")
    for _ in range(8):
        text = func.replace(text, "  ", " ")
    return func.trim(text)

@router.get("/admin/sessions/unanswered", response_model=UnansweredListResponse)
async def list_unanswered(
    since: Optional[str] = None,
    agent_id: Optional[str] = None,
    skip: int = 0,
    limit: int = Query(50, ge=1, le=200),
    current_user: AdminUser = Depends(require_chat_operator),
    db: AsyncSession = Depends(get_db),
):
    """The triage queue: assistant answers that did not really answer.

    `question` is the visitor's own message — the nearest earlier `role="user"`
    row in the session, the same rule `qa/from-message` uses to prefill a pair —
    never the assistant's answer text.
    """
    from api.v1.endpoints import require_agent_for_admin

    if agent_id:
        await require_agent_for_admin(db, agent_id, current_user)
    cutoff = _parse_since(since)

    assistant = aliased(ChatMessage)
    question_sq = (
        select(ChatMessage.content)
        .where(
            ChatMessage.session_id == assistant.session_id,
            ChatMessage.role == "user",
            ChatMessage.id < assistant.id,
        )
        .order_by(ChatMessage.id.desc())
        .limit(1)
        .correlate(assistant)
        .scalar_subquery()
    )

    base = (
        select(
            assistant.id.label("message_id"),
            ChatSession.session_id.label("session_public_id"),
            ChatSession.agent_id.label("agent_id"),
            assistant.content.label("answer"),
            assistant.confidence.label("confidence"),
            assistant.created_at.label("created_at"),
            # Trimmed for display: the operator reads it, and the pair's question
            # is stored trimmed by `from-message` too. The grouping key below
            # normalises further (collapse + lowercase).
            func.trim(question_sq).label("question"),
        )
        .join(ChatSession, ChatSession.id == assistant.session_id)
        .where(
            assistant.role == "assistant",
            assistant.is_unanswered.is_(True),
            assistant.created_at >= cutoff,
        )
    )
    base = _scope_session_query(base, current_user, agent_id)
    rows_cte = base.cte("unanswered_rows")

    # COALESCE: an assistant message with no preceding user row (a human reply,
    # say) must still be listed. Without it the grouping key is NULL, `NULL =
    # NULL` never joins, and the row would silently vanish from the queue.
    keyed = select(
        rows_cte,
        func.coalesce(
            normalized_question_sql(rows_cte.c.question), ""
        ).label("question_key"),
    ).cte("unanswered_keyed")

    counts = (
        select(
            keyed.c.agent_id.label("agent_id"),
            keyed.c.question_key.label("question_key"),
            func.count().label("occurrences"),
        )
        .group_by(keyed.c.agent_id, keyed.c.question_key)
        .cte("unanswered_counts")
    )

    joined = keyed.join(
        counts,
        (counts.c.agent_id == keyed.c.agent_id)
        & (counts.c.question_key == keyed.c.question_key),
    )

    total = await db.scalar(select(func.count()).select_from(joined))

    result = await db.execute(
        select(
            keyed.c.message_id,
            keyed.c.session_public_id,
            keyed.c.question,
            keyed.c.answer,
            keyed.c.confidence,
            keyed.c.created_at,
            counts.c.occurrences,
        )
        .select_from(joined)
        .order_by(keyed.c.created_at.desc(), keyed.c.message_id.desc())
        .offset(max(0, skip))
        .limit(limit)
    )

    items = [
        UnansweredItem(
            message_id=row.message_id,
            session_id=row.session_public_id,
            question=row.question or "",
            answer=row.answer or "",
            confidence=row.confidence,
            created_at=row.created_at,
            occurrences=int(row.occurrences or 1),
        )
        for row in result.all()
    ]
    return UnansweredListResponse(items=items, total=int(total or 0))

@router.post("/admin/sessions/unanswered/{message_id}:dismiss")
async def dismiss_unanswered(
    message_id: int,
    current_user: AdminUser = Depends(require_chat_operator),
    db: AsyncSession = Depends(get_db),
):
    """Take a triaged row out of the queue without deleting the message."""
    from api.v1.endpoints import require_agent_for_admin

    message = await db.get(ChatMessage, message_id)
    if not message or message.role != "assistant":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Message not found"
        )
    session = await db.get(ChatSession, message.session_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Message not found"
        )
    # A message from another workspace answers exactly like a missing one, so
    # the queue never confirms that a foreign id exists.
    try:
        await require_agent_for_admin(db, session.agent_id, current_user)
    except HTTPException as error:
        if error.status_code in (status.HTTP_403_FORBIDDEN, status.HTTP_410_GONE):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Message not found"
            ) from error
        raise

    message.is_unanswered = False
    await db.commit()
    return {"dismissed": True}

# ------------------------------------------------------------- procedures

async def _load_agent_for_admin(
    db: AsyncSession, agent_id: str, current_user: AdminUser
) -> Agent:
    from api.v1.endpoints import require_agent_admin

    return await require_agent_admin(db, agent_id, current_user)

def _procedure_payload(procedure: Procedure) -> ProcedurePayload:
    steps = procedure.steps if isinstance(procedure.steps, list) else []
    return ProcedurePayload(
        id=procedure.id,
        agent_id=procedure.agent_id,
        name=procedure.name,
        steps=[
            {
                "text": str(step.get("text", "")),
                "requires_action": step.get("requires_action"),
            }
            for step in steps
            if isinstance(step, dict) and str(step.get("text", "")).strip()
        ],
        enabled=bool(procedure.enabled),
        created_at=procedure.created_at,
        updated_at=procedure.updated_at,
    )

def _steps_to_json(steps) -> list[dict]:
    return [
        {"text": step.text, "requires_action": step.requires_action}
        for step in steps
    ]

@router.get("/agents/{agent_id}/procedures", response_model=ProcedureListResponse)
async def list_procedures(
    agent_id: str,
    current_user: AdminUser = Depends(require_admin_or_super_admin),
    db: AsyncSession = Depends(get_db),
):
    await _load_agent_for_admin(db, agent_id, current_user)
    result = await db.execute(
        select(Procedure)
        .where(Procedure.agent_id == agent_id)
        .order_by(Procedure.created_at.asc(), Procedure.id.asc())
    )
    items = [_procedure_payload(procedure) for procedure in result.scalars().all()]
    return ProcedureListResponse(items=items, total=len(items))

@router.post(
    "/agents/{agent_id}/procedures",
    response_model=ProcedurePayload,
    status_code=status.HTTP_201_CREATED,
)
async def create_procedure(
    agent_id: str,
    payload: ProcedureCreateRequest,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    await _load_agent_for_admin(db, agent_id, current_user)
    procedure = Procedure(
        agent_id=agent_id,
        name=payload.name.strip(),
        steps=_steps_to_json(payload.steps),
        enabled=payload.enabled,
    )
    db.add(procedure)
    await db.commit()
    await db.refresh(procedure)
    return _procedure_payload(procedure)

@router.put(
    "/agents/{agent_id}/procedures/{proc_id}", response_model=ProcedurePayload
)
async def update_procedure(
    agent_id: str,
    proc_id: str,
    payload: ProcedureUpdateRequest,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    await _load_agent_for_admin(db, agent_id, current_user)
    procedure = await db.scalar(
        select(Procedure).where(
            Procedure.id == proc_id, Procedure.agent_id == agent_id
        )
    )
    if not procedure:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found"
        )
    if payload.name is not None:
        procedure.name = payload.name.strip()
    if payload.steps is not None:
        procedure.steps = _steps_to_json(payload.steps)
    if payload.enabled is not None:
        procedure.enabled = payload.enabled
    await db.commit()
    await db.refresh(procedure)
    return _procedure_payload(procedure)

@router.delete("/agents/{agent_id}/procedures/{proc_id}")
async def delete_procedure(
    agent_id: str,
    proc_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    await _load_agent_for_admin(db, agent_id, current_user)
    procedure = await db.scalar(
        select(Procedure).where(
            Procedure.id == proc_id, Procedure.agent_id == agent_id
        )
    )
    if not procedure:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Procedure not found"
        )
    await db.delete(procedure)
    await db.commit()
    return {"deleted": True, "id": proc_id}

# ------------------------------------------------------------ fixed facts

@router.put("/agents/{agent_id}/fixed-facts", response_model=FixedFactsResponse)
async def update_fixed_facts(
    agent_id: str,
    payload: FixedFactsRequest,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Store the operator's fixed facts; the prompt reads them on every message."""
    agent = await _load_agent_for_admin(db, agent_id, current_user)
    value = payload.fixed_facts
    agent.fixed_facts = value.strip() if isinstance(value, str) and value.strip() else None
    await db.commit()
    await db.refresh(agent)
    return FixedFactsResponse(fixed_facts=agent.fixed_facts)
