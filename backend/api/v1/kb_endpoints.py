"""Knowledge base endpoints (workspace-scoped, no Tenant in the request path).

Every route resolves the workspace from the authenticated admin. Reads are open to
`admin`/`super_admin`; every mutation calls `require_super_admin`.

Create and reset probe the embedding provider before anything is persisted so the
stored `embedding_dimension` is always the MEASURED vector length, never a guess
derived from the model name.
"""

import logging
import os
import shutil
import uuid
from typing import Any, Literal, Optional

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from sqlalchemy import delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.endpoints.auth import (
    get_current_admin,
    require_admin_or_super_admin,
    require_super_admin,
)
from api.v1.schemas import (
    FileItem,
    FileListResponse,
    FileUploadResponse,
    IndexRebuildRequest,
    IndexRebuildResponse,
    KbBindRequest,
    KbBindResponse,
    KbCreateRequest,
    KbDeleteResponse,
    KbDetail,
    KbEmbeddingTestRequest,
    KbEmbeddingTestResponse,
    KbIndexStatusResponse,
    KbListResponse,
    KbResetRequest,
    KbResetResponse,
    KbUpdateRequest,
    SiteCrawlRequest,
    SiteCrawlResponse,
    SourcesFileSummary,
    SourcesSummaryResponse,
    SourcesURLSummary,
    URLCancelResponse,
    URLCreateRequest,
    URLItem,
    URLListResponse,
    URLRefetchRequest,
    URLRefetchResponse,
)
from constants import ALLOWED_EXTENSIONS, MAX_FILES_PER_UPLOAD, MAX_FILE_SIZE
from core.encryption import decrypt_api_key, encrypt_api_key
from config import settings
from database import get_db
from i18n.core import get_localized_document_processing_error
from models import AdminUser, Agent, KbDocument, KnowledgeBase, KbChunk, URLSource
from services import task_lock
from services.document_parser import DocumentParser
from services.kb_service import KbService
from services.task_lock import TaskType

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["knowledge-bases"])

# Text used to force a single embedding round-trip when probing a provider.
PROBE_TEXT = "basjoo-capability-probe"
PROBE_ERROR_MAX_LENGTH = 300

# Default base URLs per provider. `custom` always requires an explicit base URL.
# `local` points at the self-hosted TEI container (OpenAI-compatible /v1/embeddings).
PROVIDER_DEFAULT_BASE_URLS = {
    "jina": "https://api.jina.ai/v1",
    "siliconflow": "https://api.siliconflow.cn/v1",
    "local": settings.local_embedding_base_url,
}

def _require_embedding_api_key(provider: str, api_key: Optional[str]) -> None:
    """Every provider needs a non-empty key except `local`.

    `local` is the self-hosted TEI container inside the private compose network: it
    takes no credentials, so an empty key is valid there and must stay valid.
    """
    if provider != "local" and not (api_key or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Embedding API key is required",
        )


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
    """Resolve the embeddings base URL for a provider, validating `custom`.

    `local` follows the same rule as the hosted providers: an explicitly supplied
    URL wins (a deployment may run TEI somewhere else), otherwise the configured
    in-network default is used.
    """
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
    api_key: Optional[str],
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

    Deleted agents are ignored on purpose: a deleted agent must never make a KB
    look bound (the UI would then hide the KB behind a dead agent). A paused agent
    is still the owner and must show as bound. Deleting an agent also clears
    `Agent.kb_id`, so this filter is the defensive second line.
    """
    if not kb_ids:
        return {}
    result = await db.execute(
        select(Agent.id, Agent.name, Agent.kb_id).where(
            Agent.kb_id.in_(kb_ids),
            Agent.deleted_at.is_(None),
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

    _require_embedding_api_key(payload.embedding_provider, payload.embedding_api_key)
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

    _require_embedding_api_key(payload.embedding_provider, payload.embedding_api_key)
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
    _require_embedding_api_key(payload.embedding_provider, api_key)
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


# ============================================================================
# KB-scoped knowledge source routes (URLs / files / index)
# ============================================================================
#
# A URL source, a KB document and the index all belong to the *knowledge base*,
# never to an agent. These handlers therefore take `kb_id` and never call
# `require_bound_kb`: an unbound KB is a first-class KB and can ingest URLs and
# files with no agent in the picture.
#
# The legacy `/api/v1/urls:*`, `/api/v1/files:*`, `/api/v1/index:*` aliases in
# `api/v1/endpoints.py` delegate to the same helpers after resolving the agent's
# bound KB, so there is exactly one implementation of each behaviour.

EXT_TO_MIME = {
    "txt": "text/plain",
    "md": "text/markdown",
    "html": "text/html",
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
}

URL_DOC_PREFIX = "url\\_%"

async def _load_kb_in_workspace(
    db: AsyncSession, kb_id: str, current_user: AdminUser
) -> KnowledgeBase:
    """Load a KB by id inside the caller's workspace; 404 outside it."""
    workspace_id = _require_workspace(current_user)
    return await _load_kb_for_mutation(db, kb_id, workspace_id)

async def _url_documents_by_url_id(
    db: AsyncSession, kb_id: str, url_ids: list[int]
) -> dict[int, KbDocument]:
    """Map URL id -> the KbDocument its ingestion produced.

    URL-derived documents are named `url_{url_id}.txt`. Test fixtures sometimes
    use a non-numeric URL filename, so those are matched to the first URL without
    a document (same compatibility rule the agent-scoped route had).
    """
    if not url_ids:
        return {}

    docs_by_url_id: dict[int, KbDocument] = {}
    doc_filenames = [f"url_{url_id}.txt" for url_id in url_ids]
    result = await db.execute(
        select(KbDocument).where(
            KbDocument.kb_id == kb_id,
            KbDocument.filename.in_(doc_filenames),
        )
    )
    for doc in result.scalars().all():
        if doc.filename.startswith("url_") and doc.filename.endswith(".txt"):
            try:
                docs_by_url_id[int(doc.filename[4:-4])] = doc
            except ValueError:
                continue

    loose_result = await db.execute(
        select(KbDocument).where(
            KbDocument.kb_id == kb_id,
            KbDocument.filename.like("url%"),
        )
    )
    for doc in loose_result.scalars().all():
        if doc.filename.startswith("url_") and doc.filename.endswith(".txt"):
            try:
                url_id = int(doc.filename[4:-4])
            except ValueError:
                for candidate in url_ids:
                    if candidate not in docs_by_url_id:
                        docs_by_url_id[candidate] = doc
                        break
                continue
            if url_id not in docs_by_url_id:
                docs_by_url_id[url_id] = doc
    return docs_by_url_id

async def build_kb_url_list(
    db: AsyncSession,
    kb_id: str,
    skip: int = 0,
    limit: int = 100,
) -> URLListResponse:
    """List a KB's URL sources with fetch/indexing diagnostics."""
    stmt = (
        select(URLSource)
        .where(URLSource.kb_id == kb_id)
        .order_by(URLSource.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    url_sources = list((await db.execute(stmt)).scalars().all())

    total = (
        await db.scalar(
            select(func.count(URLSource.id)).where(URLSource.kb_id == kb_id)
        )
    ) or 0

    docs_by_url_id = await _url_documents_by_url_id(
        db, kb_id, [u.id for u in url_sources]
    )

    items: list[URLItem] = []
    for url_source in url_sources:
        item = URLItem.model_validate(url_source)
        doc = docs_by_url_id.get(url_source.id)
        if doc is not None:
            item.indexing_status = doc.status
            if doc.status == "error":
                item.indexing_error = doc.error_message
        elif url_source.is_indexed:
            item.indexing_status = "ready"
        else:
            item.indexing_status = "pending"
        if url_source.last_error:
            item.last_error = url_source.last_error
        items.append(item)

    return URLListResponse(
        urls=items, total=total, quota={"used": total, "max": 500}
    )

async def create_kb_urls(
    db: AsyncSession,
    kb_id: str,
    payload: URLCreateRequest,
    background_tasks: BackgroundTasks,
    source_agent_id: Optional[str] = None,
) -> URLListResponse:
    """Create URL sources for a KB and queue a background fetch for the new ones."""
    from models import normalize_url
    from services.url_service import process_url_refetch

    new_url_ids: list[int] = []
    for url_str in payload.urls:
        normalized = normalize_url(url_str)
        exists = (
            await db.execute(
                select(URLSource).where(
                    URLSource.kb_id == kb_id,
                    URLSource.normalized_url == normalized,
                )
            )
        ).scalar_one_or_none()
        if exists:
            continue
        url_source = URLSource(
            kb_id=kb_id, url=url_str, normalized_url=normalized, status="pending"
        )
        db.add(url_source)
        await db.flush()
        new_url_ids.append(url_source.id)

    await db.commit()

    listing = await build_kb_url_list(db, kb_id, 0, 100)

    job_id: Optional[str] = None
    auto_fetch_queued = False
    if new_url_ids:
        job_id = f"refetch_{kb_id}_{uuid.uuid4().hex[:8]}"
        acquired, _ = await task_lock.acquire_task(kb_id, TaskType.URL_REFETCH, job_id)
        if acquired:
            background_tasks.add_task(
                process_url_refetch,
                kb_id=kb_id,
                url_ids=new_url_ids,
                force=False,
                job_id=job_id,
                source_agent_id=source_agent_id,
            )
            auto_fetch_queued = True
        else:
            # The row stays `pending`; the scheduler catch-all will pick it up.
            job_id = None

    return URLListResponse(
        urls=listing.urls,
        total=listing.total,
        quota=listing.quota,
        job_id=job_id,
        auto_fetch_queued=auto_fetch_queued,
    )

async def _delete_url_documents(
    db: AsyncSession,
    kb_id: str,
    source_agent_id: Optional[str] = None,
    url_ids: Optional[list[int]] = None,
) -> dict[str, int]:
    """Delete the `url_{id}.txt` documents derived from a KB's URLs.

    The single cascade used by both `delete_kb_url` and `clear_kb_urls`: Qdrant
    points, `KbChunk` rows, the on-disk document directory and finally the
    `KbDocument` row itself. URLSource rows are NOT touched and the caller owns
    the transaction (this helper never commits).

    `source_agent_id` narrows the deletion to that agent's ingests so a shared KB
    never loses another agent's content; `url_ids` narrows it to the documents
    derived from those URL rows (`None` means every URL document of the KB).
    """
    from services.qdrant_service import QdrantKbService

    filters = [
        KbDocument.kb_id == kb_id,
        KbDocument.filename.like(URL_DOC_PREFIX, escape="\\"),
    ]
    if source_agent_id is not None:
        filters.append(KbDocument.source_agent_id == source_agent_id)
    if url_ids is not None:
        filters.append(
            KbDocument.filename.in_([f"url_{url_id}.txt" for url_id in url_ids])
        )

    url_docs = list(
        (await db.execute(select(KbDocument).where(*filters))).scalars().all()
    )

    counters = {"docs": 0, "chunks": 0, "qdrant": 0, "files": 0}
    if not url_docs:
        return counters

    qdrant = QdrantKbService()
    for doc in url_docs:
        try:
            await qdrant.delete_points_by_doc_id(kb_id, str(doc.id))
            counters["qdrant"] += 1
        except Exception as exc:
            # Qdrant cleanup is best-effort: never fail the DB deletion on it.
            logger.warning(
                "Failed to delete Qdrant points for doc %s: %s", doc.id, exc
            )

    doc_ids = [doc.id for doc in url_docs]
    chunk_result = await db.execute(delete(KbChunk).where(KbChunk.doc_id.in_(doc_ids)))
    counters["chunks"] = chunk_result.rowcount or 0

    for doc in url_docs:
        storage_path = getattr(doc, "storage_path", None)
        if storage_path and os.path.exists(storage_path):
            try:
                doc_dir = os.path.dirname(storage_path)
                if doc_dir and os.path.exists(doc_dir):
                    shutil.rmtree(doc_dir)
                    counters["files"] += 1
            except Exception as exc:
                logger.warning("Failed to delete file for doc %s: %s", doc.id, exc)

    await db.execute(delete(KbDocument).where(KbDocument.id.in_(doc_ids)))
    counters["docs"] = len(url_docs)
    return counters

async def delete_kb_url(db: AsyncSession, kb_id: str, url_id: int) -> dict[str, Any]:
    """Delete one URL row *and* the document/chunks/points it produced."""
    url_source = await db.get(URLSource, url_id)
    if url_source is None or url_source.kb_id != kb_id:
        raise HTTPException(status_code=404, detail="URL not found")
    await _delete_url_documents(db, kb_id, url_ids=[url_id])
    await db.delete(url_source)
    await db.commit()
    return {"success": True}

async def clear_kb_urls(
    db: AsyncSession,
    kb_id: str,
    source_agent_id: Optional[str] = None,
) -> dict[str, Any]:
    """Clear a KB's URL sources and the KB data derived from them.

    `source_agent_id` narrows the *document* deletion to that agent's ingests: a
    shared KB must never lose another agent's content. URL rows themselves are
    KB-owned, so all of them go.
    """
    deleted_url_count = (
        await db.scalar(
            select(func.count(URLSource.id)).where(URLSource.kb_id == kb_id)
        )
    ) or 0

    counters = await _delete_url_documents(
        db, kb_id, source_agent_id=source_agent_id, url_ids=None
    )

    await db.execute(delete(URLSource).where(URLSource.kb_id == kb_id))
    await db.commit()

    return {
        "success": True,
        "message": "All URLs and their knowledge base data cleared successfully",
        "deleted_count": counters["docs"],
        "deleted_url_count": deleted_url_count,
        "deleted_doc_count": counters["docs"],
        "deleted_chunk_count": counters["chunks"],
        "deleted_qdrant_count": counters["qdrant"],
        "deleted_files_count": counters["files"],
    }

async def list_kb_files(
    db: AsyncSession,
    kb_id: str,
    http_request: Request,
    skip: int = 0,
    limit: int = 100,
    source: Literal["all", "own"] = "all",
    source_agent_id: Optional[str] = None,
) -> FileListResponse:
    """List a KB's uploaded files (URL-derived documents are excluded)."""
    filters = [
        KbDocument.kb_id == kb_id,
        ~KbDocument.filename.like(URL_DOC_PREFIX, escape="\\"),
    ]
    if source == "own" and source_agent_id is not None:
        filters.append(
            or_(
                KbDocument.source_agent_id == source_agent_id,
                KbDocument.source_agent_id.is_(None),
            )
        )

    docs = list(
        (
            await db.execute(
                select(KbDocument)
                .where(*filters)
                .order_by(KbDocument.created_at.desc())
                .offset(skip)
                .limit(limit)
            )
        )
        .scalars()
        .all()
    )
    total = (await db.scalar(select(func.count(KbDocument.id)).where(*filters))) or 0

    items: list[FileItem] = []
    for doc in docs:
        doc_status = doc.status
        error_message = None
        if doc_status == "error":
            doc_status = "failed"
            error_message = get_localized_document_processing_error(
                http_request, getattr(doc, "error_message", None)
            )
        items.append(
            FileItem(
                id=str(doc.id),
                filename=doc.filename,
                file_type=getattr(doc, "file_type", "") or "",
                file_size=getattr(doc, "file_size", 0) or 0,
                status=doc_status,
                error_message=error_message,
                created_at=str(doc.created_at) if doc.created_at else "",
            )
        )

    return FileListResponse(
        files=items, total=total, quota={"used": total, "max": 500}
    )

async def upload_kb_files(
    db: AsyncSession,
    kb: KnowledgeBase,
    background_tasks: BackgroundTasks,
    files: list[UploadFile],
    source_agent_id: Optional[str] = None,
) -> FileUploadResponse:
    """Store uploads and queue KB document processing (parse→chunk→embed→Qdrant)."""
    from services.kb_document_processor import KbDocumentProcessor

    if len(files) > MAX_FILES_PER_UPLOAD:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Max {MAX_FILES_PER_UPLOAD} files per upload",
        )

    kb_id = kb.id
    workspace_id = int(kb.workspace_id)
    processor = KbDocumentProcessor()

    uploaded = 0
    failed = 0
    errors: list[str] = []
    items: list[FileItem] = []

    for upload_file in files[:MAX_FILES_PER_UPLOAD]:
        filename = upload_file.filename or "unnamed"
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

        if ext not in ALLOWED_EXTENSIONS:
            failed += 1
            errors.append(f"{filename}: unsupported .{ext}")
            continue

        try:
            content = await upload_file.read()

            if len(content) > MAX_FILE_SIZE:
                failed += 1
                errors.append(f"{filename}: exceeds 20MB limit")
                continue

            if len(content) == 0:
                failed += 1
                errors.append(f"Empty file: {filename} (0 bytes)")
                continue

            doc = await processor.create_document_record(
                workspace_id,
                kb_id,
                filename,
                len(content),
                source_agent_id=source_agent_id,
                db=db,
            )
            storage_path = processor.save_uploaded_file(doc, content, ext)
            object.__setattr__(doc, "storage_path", storage_path)
            object.__setattr__(doc, "file_type", ext)

            doc_id = str(getattr(doc, "id", ""))
            background_tasks.add_task(processor.process_document, doc_id, kb_id)

            items.append(
                FileItem(
                    id=doc_id,
                    filename=filename,
                    file_type=EXT_TO_MIME.get(ext, ext),
                    file_size=len(content),
                    status="pending",
                    created_at=str(getattr(doc, "created_at", "")),
                )
            )
            uploaded += 1
        except Exception as exc:
            logger.exception("File upload failed for %s: %s", filename, exc)
            failed += 1
            errors.append(f"{filename}: {str(exc)}")

    await db.commit()

    return FileUploadResponse(
        uploaded=uploaded, failed=failed, files=items, errors=errors
    )

async def delete_kb_file(db: AsyncSession, kb_id: str, file_id: str) -> dict[str, Any]:
    from services.kb_document_processor import KbDocumentProcessor

    doc = (
        await db.execute(
            select(KbDocument).where(
                KbDocument.id == file_id, KbDocument.kb_id == kb_id
            )
        )
    ).scalar_one_or_none()
    if doc is None:
        raise HTTPException(status_code=404, detail="File not found")

    await KbDocumentProcessor().delete_document(kb_id, file_id, db)
    return {"success": True}

async def clear_kb_files(db: AsyncSession, kb_id: str) -> dict[str, Any]:
    """Delete every uploaded (non-URL) document of a KB."""
    from services.kb_document_processor import KbDocumentProcessor

    doc_ids = [
        row[0]
        for row in (
            await db.execute(
                select(KbDocument.id).where(
                    KbDocument.kb_id == kb_id,
                    ~KbDocument.filename.like(URL_DOC_PREFIX, escape="\\"),
                )
            )
        ).all()
    ]

    processor = KbDocumentProcessor()
    for doc_id in doc_ids:
        try:
            await processor.delete_document(kb_id, doc_id, db)
        except Exception as exc:
            logger.warning("Failed to delete document %s: %s", doc_id, exc)

    return {
        "success": True,
        "message": "All files cleared successfully",
        "deleted_count": len(doc_ids),
    }

async def refetch_kb_urls(
    db: AsyncSession,
    kb_id: str,
    payload: URLRefetchRequest,
    background_tasks: BackgroundTasks,
    source_agent_id: Optional[str] = None,
) -> URLRefetchResponse:
    """Queue a background refetch for a KB's URLs (task lock keyed by kb_id)."""
    from services.url_service import process_url_refetch

    job_id = f"refetch_{kb_id}_{uuid.uuid4().hex[:8]}"
    acquired, error = await task_lock.acquire_task(
        kb_id, TaskType.URL_REFETCH, job_id
    )
    if not acquired:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=f"Refetch already in progress: {error}",
        )

    background_tasks.add_task(
        process_url_refetch,
        kb_id=kb_id,
        url_ids=payload.url_ids,
        force=payload.force,
        job_id=job_id,
        source_agent_id=source_agent_id,
    )
    return URLRefetchResponse(
        job_id=job_id, status="queued", message="URL refetch queued"
    )

async def cancel_kb_url_tasks(kb_id: str) -> URLCancelResponse:
    """Cancel this KB's active crawl/refetch tasks."""
    cancelled_task_ids = await task_lock.cancel_tasks(
        kb_id, {TaskType.URL_CRAWL, TaskType.URL_REFETCH}
    )
    return URLCancelResponse(
        cancelled=len(cancelled_task_ids),
        task_ids=cancelled_task_ids,
        message=f"Cancelled {len(cancelled_task_ids)} task(s)"
        if cancelled_task_ids
        else "No active tasks",
    )

async def crawl_kb_site(
    kb_id: str,
    payload: SiteCrawlRequest,
    source_agent_id: Optional[str] = None,
) -> SiteCrawlResponse:
    """Start a whole-site crawl for a KB (crawl internals stay in the service)."""
    import asyncio

    from services.url_service import process_site_crawl

    job_id = f"crawl_{kb_id}_{uuid.uuid4().hex[:8]}"
    acquired, error = await task_lock.acquire_task(kb_id, TaskType.URL_CRAWL, job_id)
    if not acquired:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=f"Crawl already in progress: {error}",
        )

    task = asyncio.create_task(
        process_site_crawl(
            kb_id=kb_id,
            start_url=payload.url,
            max_depth=payload.max_depth,
            max_pages=payload.max_pages,
            job_id=job_id,
            source_agent_id=source_agent_id,
        )
    )
    await task_lock.register_task_handle(kb_id, job_id, task)

    return SiteCrawlResponse(
        job_id=job_id,
        status="queued",
        discovered=0,
        created=0,
        message="Site crawl queued",
    )

async def discover_urls_for_site(
    url: str,
    max_depth: int = 1,
    max_pages: int = 10,
) -> dict[str, Any]:
    """Discover sub-pages without indexing them."""
    from services.crawler import SiteCrawler
    from services.url_safety import validate_url_safe

    safe, reason = validate_url_safe(url)
    if not safe:
        raise HTTPException(status_code=400, detail=f"Unsafe URL: {reason}")

    results = await SiteCrawler().crawl_site(
        url, max_depth=max_depth, max_pages=max_pages
    )
    discovered_urls = [r.url for r in results if r.url and not r.error]
    return {
        "discovered": len(results),
        "urls": discovered_urls,
        "message": f"Discovered {len(discovered_urls)} URLs",
    }

async def rebuild_kb_index(
    kb_id: str,
    payload: IndexRebuildRequest,
    background_tasks: BackgroundTasks,
    source_agent_id: Optional[str] = None,
) -> IndexRebuildResponse:
    """Queue a full index rebuild for a KB."""
    from services.url_service import process_index_rebuild

    job_id = f"rebuild_{kb_id}_{uuid.uuid4().hex[:8]}"
    acquired, error = await task_lock.acquire_task(
        kb_id, TaskType.INDEX_REBUILD, job_id
    )
    if not acquired:
        raise HTTPException(
            status_code=status.HTTP_423_LOCKED,
            detail=f"Index rebuild already in progress: {error}",
        )

    background_tasks.add_task(
        process_index_rebuild,
        kb_id=kb_id,
        force=payload.force,
        job_id=job_id,
        source_agent_id=source_agent_id,
    )
    return IndexRebuildResponse(
        job_id=job_id, status="queued", message="Index rebuild queued"
    )

def kb_task_status(kb_id: str) -> tuple[str, Optional[str]]:
    """Derive (status, active job id) for a KB from the task lock."""
    is_rebuilding = task_lock.is_task_running(kb_id, TaskType.INDEX_REBUILD)
    is_crawling = task_lock.is_task_running(kb_id, TaskType.URL_CRAWL)
    is_refetching = task_lock.is_task_running(kb_id, TaskType.URL_REFETCH)

    if is_rebuilding:
        state = "rebuilding"
    elif is_crawling or is_refetching:
        state = "indexing"
    else:
        state = "idle"

    job_id = None
    for task_id, task_info in task_lock.get_active_tasks(kb_id).items():
        if task_info.get("type") in [
            TaskType.INDEX_REBUILD.value,
            TaskType.URL_CRAWL.value,
            TaskType.URL_REFETCH.value,
        ]:
            job_id = task_id
            break
    return state, job_id

async def build_kb_sources_summary(
    db: AsyncSession, kb_id: str
) -> SourcesSummaryResponse:
    """URL + file counters for one KB (the only scoping key)."""
    # Every URL row counts towards `total`, whatever its fetch status: a KB whose
    # only URL failed must still report the failure (pending == 1), not vanish.
    url_total = (
        await db.scalar(
            select(func.count(URLSource.id)).where(URLSource.kb_id == kb_id)
        )
    ) or 0
    url_indexed = (
        await db.scalar(
            select(func.count(URLSource.id)).where(
                URLSource.kb_id == kb_id, URLSource.is_indexed == True  # noqa: E712
            )
        )
    ) or 0
    url_size_bytes = (
        await db.scalar(
            select(func.sum(func.length(URLSource.content))).where(
                URLSource.kb_id == kb_id, URLSource.status == "success"
            )
        )
    ) or 0

    file_total = (
        await db.scalar(
            select(func.count(KbDocument.id)).where(KbDocument.kb_id == kb_id)
        )
    ) or 0
    file_ready = (
        await db.scalar(
            select(func.count(KbDocument.id)).where(
                KbDocument.kb_id == kb_id, KbDocument.status == "ready"
            )
        )
    ) or 0
    file_processing = (
        await db.scalar(
            select(func.count(KbDocument.id)).where(
                KbDocument.kb_id == kb_id,
                KbDocument.status.in_(["pending", "processing"]),
            )
        )
    ) or 0
    file_size_bytes = (
        await db.scalar(
            select(func.sum(KbDocument.file_size)).where(KbDocument.kb_id == kb_id)
        )
    ) or 0

    url_pending = url_total - url_indexed
    return SourcesSummaryResponse(
        urls=SourcesURLSummary(
            total=url_total,
            indexed=url_indexed,
            pending=url_pending,
            total_size_kb=round(url_size_bytes / 1024, 2),
        ),
        files=SourcesFileSummary(
            total=file_total,
            ready=file_ready,
            processing=file_processing,
            total_size_kb=round(file_size_bytes / 1024, 2),
        ),
        has_pending=url_pending > 0 or file_processing > 0,
    )

# ── canonical routes ─────────────────────────────────────────────────────────

@router.get("/knowledge-bases/{kb_id}/urls:list", response_model=URLListResponse)
async def list_kb_urls(
    kb_id: str,
    skip: int = 0,
    limit: int = 100,
    current_user: AdminUser = Depends(require_admin_or_super_admin),
    db: AsyncSession = Depends(get_db),
):
    """List the KB's URL sources. Works with no agent bound."""
    await _load_kb_in_workspace(db, kb_id, current_user)
    return await build_kb_url_list(db, kb_id, skip, limit)

@router.post("/knowledge-bases/{kb_id}/urls:create", response_model=URLListResponse)
async def create_kb_urls_endpoint(
    kb_id: str,
    payload: URLCreateRequest,
    background_tasks: BackgroundTasks,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Add URLs to an unbound KB and queue their first fetch."""
    require_super_admin(current_user)
    await _load_kb_in_workspace(db, kb_id, current_user)
    return await create_kb_urls(db, kb_id, payload, background_tasks)

@router.delete("/knowledge-bases/{kb_id}/urls:delete")
async def delete_kb_url_endpoint(
    kb_id: str,
    url_id: int,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    require_super_admin(current_user)
    await _load_kb_in_workspace(db, kb_id, current_user)
    return await delete_kb_url(db, kb_id, url_id)

@router.post("/knowledge-bases/{kb_id}/urls:clear_all")
async def clear_kb_urls_endpoint(
    kb_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    require_super_admin(current_user)
    await _load_kb_in_workspace(db, kb_id, current_user)
    return await clear_kb_urls(db, kb_id)

@router.post("/knowledge-bases/{kb_id}/urls:refetch", response_model=URLRefetchResponse)
async def refetch_kb_urls_endpoint(
    kb_id: str,
    payload: URLRefetchRequest,
    background_tasks: BackgroundTasks,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    require_super_admin(current_user)
    await _load_kb_in_workspace(db, kb_id, current_user)
    return await refetch_kb_urls(db, kb_id, payload, background_tasks)

@router.post("/knowledge-bases/{kb_id}/urls:cancel", response_model=URLCancelResponse)
async def cancel_kb_url_tasks_endpoint(
    kb_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    require_super_admin(current_user)
    await _load_kb_in_workspace(db, kb_id, current_user)
    return await cancel_kb_url_tasks(kb_id)

@router.post("/knowledge-bases/{kb_id}/urls:crawl_site", response_model=SiteCrawlResponse)
async def crawl_kb_site_endpoint(
    kb_id: str,
    payload: SiteCrawlRequest,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    require_super_admin(current_user)
    await _load_kb_in_workspace(db, kb_id, current_user)
    return await crawl_kb_site(kb_id, payload)

@router.post("/knowledge-bases/{kb_id}/urls:discover")
async def discover_kb_urls_endpoint(
    kb_id: str,
    url: str,
    max_depth: int = 1,
    max_pages: int = 10,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    require_super_admin(current_user)
    await _load_kb_in_workspace(db, kb_id, current_user)
    return await discover_urls_for_site(url, max_depth=max_depth, max_pages=max_pages)

@router.get("/knowledge-bases/{kb_id}/files:list", response_model=FileListResponse)
async def list_kb_files_endpoint(
    kb_id: str,
    http_request: Request,
    skip: int = 0,
    limit: int = 100,
    source: Literal["all", "own"] = "all",
    current_user: AdminUser = Depends(require_admin_or_super_admin),
    db: AsyncSession = Depends(get_db),
):
    await _load_kb_in_workspace(db, kb_id, current_user)
    return await list_kb_files(
        db, kb_id, http_request, skip, limit, source=source
    )

@router.post("/knowledge-bases/{kb_id}/files:upload", response_model=FileUploadResponse)
async def upload_kb_files_endpoint(
    kb_id: str,
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    """Upload files into an unbound KB and queue their processing."""
    require_super_admin(current_user)
    kb = await _load_kb_in_workspace(db, kb_id, current_user)
    return await upload_kb_files(db, kb, background_tasks, files)

@router.delete("/knowledge-bases/{kb_id}/files:delete")
async def delete_kb_file_endpoint(
    kb_id: str,
    file_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    require_super_admin(current_user)
    await _load_kb_in_workspace(db, kb_id, current_user)
    return await delete_kb_file(db, kb_id, file_id)

@router.post("/knowledge-bases/{kb_id}/files:clear_all")
async def clear_kb_files_endpoint(
    kb_id: str,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    require_super_admin(current_user)
    await _load_kb_in_workspace(db, kb_id, current_user)
    return await clear_kb_files(db, kb_id)

@router.post("/knowledge-bases/{kb_id}/index:rebuild", response_model=IndexRebuildResponse)
async def rebuild_kb_index_endpoint(
    kb_id: str,
    payload: IndexRebuildRequest,
    background_tasks: BackgroundTasks,
    current_user: AdminUser = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
):
    require_super_admin(current_user)
    await _load_kb_in_workspace(db, kb_id, current_user)
    return await rebuild_kb_index(kb_id, payload, background_tasks)

@router.get("/knowledge-bases/{kb_id}/index:status", response_model=KbIndexStatusResponse)
async def kb_index_status_endpoint(
    kb_id: str,
    current_user: AdminUser = Depends(require_admin_or_super_admin),
    db: AsyncSession = Depends(get_db),
):
    await _load_kb_in_workspace(db, kb_id, current_user)
    state, job_id = kb_task_status(kb_id)
    return KbIndexStatusResponse(
        kb_id=kb_id, job_id=job_id, status=state, result=None
    )

@router.get(
    "/knowledge-bases/{kb_id}/sources:summary", response_model=SourcesSummaryResponse
)
async def kb_sources_summary_endpoint(
    kb_id: str,
    current_user: AdminUser = Depends(require_admin_or_super_admin),
    db: AsyncSession = Depends(get_db),
):
    await _load_kb_in_workspace(db, kb_id, current_user)
    return await build_kb_sources_summary(db, kb_id)
