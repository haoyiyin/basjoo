"""Knowledge base endpoints (workspace-scoped, no Tenant in the request path).

Every route resolves the workspace from the authenticated admin. Reads are open to
`admin`/`super_admin`; every mutation calls `require_super_admin`.

Create and reset probe the embedding provider before anything is persisted so the
stored `embedding_dimension` is always the MEASURED vector length, never a guess
derived from the model name.
"""

import logging
from typing import Any, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.endpoints.auth import (
    get_current_admin,
    require_admin_or_super_admin,
    require_super_admin,
)
from api.v1.schemas import (
    KbBindRequest,
    KbBindResponse,
    KbCreateRequest,
    KbDeleteResponse,
    KbDetail,
    KbEmbeddingTestRequest,
    KbEmbeddingTestResponse,
    KbListResponse,
    KbResetRequest,
    KbResetResponse,
    KbUpdateRequest,
)
from core.encryption import decrypt_api_key, encrypt_api_key
from database import get_db
from models import AdminUser, Agent, KnowledgeBase, KbDocument
from services.document_parser import DocumentParser
from services.kb_service import KbService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["knowledge-bases"])

# Text used to force a single embedding round-trip when probing a provider.
PROBE_TEXT = "basjoo-capability-probe"
PROBE_ERROR_MAX_LENGTH = 300

# Default base URLs per provider. `custom` always requires an explicit base URL.
PROVIDER_DEFAULT_BASE_URLS = {
    "jina": "https://api.jina.ai/v1",
    "siliconflow": "https://api.siliconflow.cn/v1",
}


def _require_workspace(current_user: AdminUser) -> int:
    """Every KB operation is workspace-scoped; a missing workspace is a hard 400."""
    workspace_id = getattr(current_user, "workspace_id", None)
    if not workspace_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current admin has no workspace assigned",
        )
    return workspace_id


def _resolve_base_url(provider: str, base_url: Optional[str]) -> Optional[str]:
    """Resolve the embeddings base URL for a provider, validating `custom`."""
    cleaned = (base_url or "").strip()
    if provider == "custom":
        if not cleaned.startswith(("http://", "https://")):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Custom embedding provider requires an embedding_base_url "
                    "starting with http:// or https://"
                ),
            )
        return cleaned
    if cleaned:
        return cleaned
    return PROVIDER_DEFAULT_BASE_URLS.get(provider)


def _bound_message(detail: Any) -> str:
    text = str(detail).strip() or "Embedding provider rejected the request"
    return text[:PROBE_ERROR_MAX_LENGTH]


async def _probe_provider(
    provider: str,
    model: str,
    base_url: Optional[str],
    api_key: str,
) -> int:
    """Embed one probe string and return the MEASURED vector length.

    Raises 400 with a bounded provider message when the probe fails. Nothing is
    persisted by this function, so a bad key can never create a KB row.
    """
    resolved_base = _resolve_base_url(provider, base_url)
    try:
        vectors = await DocumentParser().embed_texts(
            [PROBE_TEXT], model, resolved_base, api_key=api_key
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning(
            "Embedding provider probe failed provider=%s model=%s: %s",
            provider,
            model,
            exc,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_bound_message(exc),
        ) from exc

    if not vectors:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Embedding provider returned no vectors",
        )
    dimension = len(vectors[0])
    if dimension <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Embedding provider returned an empty vector",
        )
    return dimension


async def _bound_agents_by_kb(
    db: AsyncSession, kb_ids: list[str]
) -> dict[str, dict[str, str]]:
    """Fetch the bound agent per KB in a single grouped query (no N+1).

    Soft-deleted agents are ignored on purpose: a deleted agent must never make a
    KB look bound (the UI would then hide the KB behind a dead agent). Deleting an
    agent also clears `Agent.kb_id`, so this filter is the defensive second line.
    """
    if not kb_ids:
        return {}
    result = await db.execute(
        select(Agent.id, Agent.name, Agent.kb_id).where(
            Agent.kb_id.in_(kb_ids),
            Agent.deleted_at.is_(None),
            Agent.is_active.is_(True),
        )
    )
    return {
        agent_kb_id: {"id": agent_id, "name": agent_name}
        for agent_id, agent_name, agent_kb_id in result.all()
        if agent_kb_id
    }


def _kb_detail(
    kb: KnowledgeBase,
    detail: dict | None,
    bound_agent: dict[str, str] | None,
) -> KbDetail:
    """Build the wire representation of a KB from the row plus its counters."""
    counts = detail or {}
    return KbDetail(
        id=kb.id,
        name=kb.name,
        workspace_id=getattr(kb, "workspace_id", None),
        embedding_provider=getattr(kb, "embedding_provider", None) or "jina",
        embedding_model=kb.embedding_model,
        embedding_base_url=getattr(kb, "embedding_base_url", None),
        embedding_batch_size=getattr(kb, "embedding_batch_size", None) or 4,
        embedding_dimension=getattr(kb, "embedding_dimension", None),
        chunk_size=kb.chunk_size,
        chunk_overlap=kb.chunk_overlap,
        status=str(getattr(kb, "status", "active")),
        is_locked=bool(getattr(kb, "is_locked", False)),
        error_message=getattr(kb, "error_message", None),
        document_count=counts.get("document_count", 0) or 0,
        ready_document_count=counts.get("ready_document_count", 0) or 0,
        total_chunks=counts.get("total_chunks", 0) or 0,
        bound_agent=bound_agent,
    )


async def build_kb_detail(
    db: AsyncSession, kb_id: str, workspace_id: int
) -> KbDetail:
    """Load one KB with its counts and bound agent (404 outside the workspace)."""
    service = KbService(session=db)
    kb = await service.get_knowledge_base(kb_id, workspace_id)
    if not kb:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge base not found"
        )
    detail = await service.get_kb_detail(kb_id, workspace_id)
    agents = await _bound_agents_by_kb(db, [kb_id])
    return _kb_detail(kb, detail, agents.get(kb_id))


async def _load_kb_for_mutation(
    db: AsyncSession, kb_id: str, workspace_id: int
) -> KnowledgeBase:
    kb = await KbService(session=db).get_knowledge_base(kb_id, workspace_id)
    if not kb:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge base not found"
        )
    return kb


@router.get("/knowledge-bases", response_model=KbListResponse)
async def list_knowledge_bases(
    current_user: AdminUser = Depends(require_admin_or_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """List the workspace's knowledge bases with counts and bound agents."""
    workspace_id = _require_workspace(current_user)
    service = KbService(session=db)
    kbs = await service.list_knowledge_bases(workspace_id)
    kb_ids = [kb.id for kb in kbs]
    bound_agents = await _bound_agents_by_kb(db, kb_ids)

    items: list[KbDetail] = []
    for kb in kbs:
        detail = await service.get_kb_detail(kb.id, workspace_id)
        items.append(_kb_detail(kb, detail, bound_agents.get(kb.id)))

    return KbListResponse(knowledge_bases=items, total=len(items))


@router.post(
    "/knowledge-bases",
    response_model=KbDetail,
    status_code=status.HTTP_201_CREATED,
)
async def create_knowledge_base(
    payload: KbCreateRequest,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Create a KB. The provider is probed first; the measured width is persisted."""
    require_super_admin(current_user)
    workspace_id = _require_workspace(current_user)

    dimension = await _probe_provider(
        payload.embedding_provider,
        payload.embedding_model,
        payload.embedding_base_url,
        payload.embedding_api_key,
    )

    kb = await KbService(session=db).create_knowledge_base(
        workspace_id,
        payload.name,
        embedding_provider=payload.embedding_provider,
        embedding_model=payload.embedding_model,
        embedding_base_url=_resolve_base_url(
            payload.embedding_provider, payload.embedding_base_url
        ),
        embedding_api_key=encrypt_api_key(payload.embedding_api_key),
        embedding_dimension=dimension,
        embedding_batch_size=payload.embedding_batch_size,
        chunk_size=payload.chunk_size,
        chunk_overlap=payload.chunk_overlap,
    )
    return await build_kb_detail(db, kb.id, workspace_id)


@router.post("/knowledge-bases/test-embedding", response_model=KbEmbeddingTestResponse)
async def test_embedding(
    payload: KbEmbeddingTestRequest,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Probe an embedding config without persisting anything."""
    require_super_admin(current_user)
    _require_workspace(current_user)

    dimension = await _probe_provider(
        payload.embedding_provider,
        payload.embedding_model,
        payload.embedding_base_url,
        payload.embedding_api_key,
    )
    return KbEmbeddingTestResponse(
        success=True,
        dimension=dimension,
        message=f"Embedding provider reachable ({dimension} dimensions)",
    )


@router.get("/knowledge-bases/{kb_id}", response_model=KbDetail)
async def get_knowledge_base(
    kb_id: str,
    current_user: AdminUser = Depends(require_admin_or_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """Fetch one KB. A KB from another workspace behaves exactly like a missing one."""
    workspace_id = _require_workspace(current_user)
    return await build_kb_detail(db, kb_id, workspace_id)


@router.patch("/knowledge-bases/{kb_id}", response_model=KbDetail)
async def update_knowledge_base(
    kb_id: str,
    payload: KbUpdateRequest,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Update KB config. Embedding changes are refused once contents exist."""
    require_super_admin(current_user)
    workspace_id = _require_workspace(current_user)

    updates = payload.model_dump(exclude_unset=True)
    if "embedding_api_key" in updates:
        updates["embedding_api_key"] = encrypt_api_key(updates["embedding_api_key"])
    if "embedding_base_url" in updates and (
        updates.get("embedding_provider") or "custom"
    ) == "custom":
        _resolve_base_url("custom", updates["embedding_base_url"])

    if updates:
        kb = await _load_kb_for_mutation(db, kb_id, workspace_id)
        # Sizing must be checked after merging with the stored values: a partial
        # update may only touch one of the two fields.
        effective_chunk_size = int(updates.get("chunk_size", kb.chunk_size))
        effective_overlap = int(updates.get("chunk_overlap", kb.chunk_overlap))
        if effective_overlap >= effective_chunk_size:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="chunk_overlap must be smaller than chunk_size",
            )
        await KbService(session=db).update_kb_config(kb_id, workspace_id, updates)
    return await build_kb_detail(db, kb_id, workspace_id)


@router.post("/knowledge-bases/{kb_id}/reset", response_model=KbResetResponse)
async def reset_knowledge_base(
    kb_id: str,
    payload: KbResetRequest,
    background_tasks: BackgroundTasks,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Reset a KB: probe the new provider, recreate the collection, reindex docs."""
    require_super_admin(current_user)
    workspace_id = _require_workspace(current_user)
    kb = await _load_kb_for_mutation(db, kb_id, workspace_id)

    api_key = payload.embedding_api_key or decrypt_api_key(
        getattr(kb, "embedding_api_key", None)
    )
    dimension = await _probe_provider(
        payload.embedding_provider,
        payload.embedding_model,
        payload.embedding_base_url,
        api_key,
    )

    result = await KbService(session=db).reset_knowledge_base(
        kb_id,
        workspace_id,
        embedding_provider=payload.embedding_provider,
        embedding_model=payload.embedding_model,
        embedding_base_url=_resolve_base_url(
            payload.embedding_provider, payload.embedding_base_url
        ),
        embedding_api_key=encrypt_api_key(api_key),
        embedding_dimension=dimension,
        embedding_batch_size=payload.embedding_batch_size,
    )

    from services.kb_document_processor import KbDocumentProcessor

    processor = KbDocumentProcessor()
    doc_ids = [str(doc_id) for doc_id in result.get("doc_ids", [])]
    for doc_id in doc_ids:
        background_tasks.add_task(processor.process_document, doc_id, kb_id)

    await db.commit()

    return KbResetResponse(
        status=str(result.get("status", "active")),
        kb_id=kb_id,
        requeued_documents=len(doc_ids),
        doc_ids=doc_ids,
    )


@router.delete("/knowledge-bases/{kb_id}", response_model=KbDeleteResponse)
async def delete_knowledge_base(
    kb_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Delete a KB. Refused (409) while an agent is bound to it.

    A KB from another workspace is indistinguishable from a missing one: the
    scoped pre-load 404s before the service's own (no-op) workspace guard runs,
    so the caller never learns the row exists.
    """
    require_super_admin(current_user)
    workspace_id = _require_workspace(current_user)

    await _load_kb_for_mutation(db, kb_id, workspace_id)
    await KbService(session=db).delete_knowledge_base(kb_id, workspace_id)
    return KbDeleteResponse(deleted=True)


@router.put("/agents/{agent_id}/knowledge-base", response_model=KbBindResponse)
async def bind_agent_knowledge_base(
    agent_id: str,
    payload: KbBindRequest,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Bind, rebind or unbind (`kb_id: null`) an agent's knowledge base."""
    require_super_admin(current_user)
    workspace_id = _require_workspace(current_user)

    # Local import keeps the module importable without pulling the whole v1 router.
    from api.v1.endpoints import build_agent_config_with_stats, require_workspace_super_for_agent

    await require_workspace_super_for_agent(db, agent_id, current_user)

    agent = await KbService(session=db).bind_agent(agent_id, workspace_id, payload.kb_id)
    # Re-read through this session: the service may have closed/expired its own
    # handle, and the response must reflect the committed binding.
    agent = (
        await db.execute(select(Agent).where(Agent.id == agent_id))
    ).scalar_one_or_none()
    if agent is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent {agent_id} not found"
        )

    kb_detail = None
    if agent.kb_id:
        kb_detail = await build_kb_detail(db, agent.kb_id, workspace_id)

    return KbBindResponse(
        agent=await build_agent_config_with_stats(agent, db),
        knowledge_base=kb_detail,
    )


async def kb_document_counts(db: AsyncSession, kb_id: str) -> dict[str, int]:
    """Counters helper reused by tests and the detail builder."""
    document_count = await db.scalar(
        select(func.count(KbDocument.id)).where(KbDocument.kb_id == kb_id)
    )
    ready_count = await db.scalar(
        select(func.count(KbDocument.id)).where(
            KbDocument.kb_id == kb_id, KbDocument.status == "ready"
        )
    )
    return {
        "document_count": document_count or 0,
        "ready_document_count": ready_count or 0,
    }
