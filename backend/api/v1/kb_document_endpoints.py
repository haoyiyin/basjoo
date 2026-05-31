"""KB document endpoints: upload, progress, delete, retrieve."""

import logging

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Body,
    Depends,
    File,
    HTTPException,
    Path,
    UploadFile,
)
from sqlalchemy.ext.asyncio import AsyncSession

from api.endpoints.auth import require_admin_or_super_admin, require_tenant_access
from api.v1.schemas import (
    KbConfigResponse,
    KbConfigUpdate,
    KbDeleteResponse,
    KbDetailResponse,
    KbDocumentItem,
    KbDocumentProgressResponse,
    KbDocumentUploadResponse,
    KbResetRequest,
    RetrieveChunk,
    RetrieveRequest,
    RetrieveResponse,
)
from database import get_db
from models import AdminUser
from services.kb_document_processor import KbDocumentProcessor
from services.kb_retrieval_service import KbRetrievalService
from services.kb_service import KbService
from typing import Literal, cast

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tenants", tags=["kb-documents"])

MAX_FILES = 5
MAX_SIZE = 20 * 1024 * 1024  # 20MB
ALLOWED = {"txt", "md", "html", "pdf", "docx", "xlsx"}

processor = KbDocumentProcessor()


@router.post(
    "/{tenant_id}/knowledge_bases/{kb_id}/documents",
    response_model=KbDocumentUploadResponse,
)
async def upload_kb_documents(
    tenant_id: str = Path(...),
    kb_id: str = Path(...),
    files: list[UploadFile] = File(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),  # default is overridden by FastAPI injection
    current_user: AdminUser = Depends(require_admin_or_super_admin),
    db: AsyncSession = Depends(get_db),
    _tenant: str = Depends(require_tenant_access),
):
    """Upload file(s) to a knowledge base. Max 5 files, 20MB each."""
    # Block uploads during KB reset
    kb = await kb_svc.get_knowledge_base(tenant_id, kb_id)
    if kb and str(getattr(kb, "status", "active")) == "resetting":
        raise HTTPException(423, "Knowledge base is resetting, uploads locked")
    if len(files) > MAX_FILES:
        raise HTTPException(400, f"Max {MAX_FILES} files per upload")

    uploaded_items = []
    errors = []
    for upload_file in files[:MAX_FILES]:
        filename = upload_file.filename or "unnamed"
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if ext not in ALLOWED:
            errors.append(f"{filename}: unsupported .{ext}")
            continue
        content = await upload_file.read()
        if len(content) > MAX_SIZE:
            errors.append(f"{filename}: >20MB")
            continue
        # create pending record
        doc = await processor.create_document_record(
            tenant_id, kb_id, filename, len(content), db
        )
        storage_path = processor.save_uploaded_file(doc, content, ext)
        object.__setattr__(doc, "storage_path", storage_path)
        object.__setattr__(doc, "file_type", ext)
        doc_id = cast(str, getattr(doc, "id", ""))
        filename = cast(str, getattr(doc, "filename", ""))
        status_val = cast(
            Literal["pending", "processing", "ready", "error"],
            getattr(doc, "status", "pending"),
        )
        uploaded_items.append(
            KbDocumentItem(id=doc_id, filename=filename, status=status_val)
        )
        background_tasks.add_task(processor.process_document, doc_id, tenant_id, kb_id)
    await db.commit()
    return KbDocumentUploadResponse(
        uploaded=len(uploaded_items),
        failed=len(errors),
        documents=uploaded_items,
    )


@router.get(
    "/{tenant_id}/knowledge_bases/{kb_id}/documents/{doc_id}",
    response_model=KbDocumentProgressResponse,
)
async def get_kb_document_progress(
    tenant_id: str = Path(...),
    kb_id: str = Path(...),
    doc_id: str = Path(...),
    current_user: AdminUser = Depends(require_admin_or_super_admin),
    db: AsyncSession = Depends(get_db),
    _tenant: str = Depends(require_tenant_access),
):
    """Get document indexing progress."""
    result = await processor.get_document_progress(tenant_id, doc_id, db)
    if result.get("status") == "not_found":
        raise HTTPException(404, "Document not found")
    return KbDocumentProgressResponse(**result)


@router.delete(
    "/{tenant_id}/knowledge_bases/{kb_id}/documents/{doc_id}",
    status_code=204,
)
async def delete_kb_document(
    tenant_id: str = Path(...),
    kb_id: str = Path(...),
    doc_id: str = Path(...),
    current_user: AdminUser = Depends(require_admin_or_super_admin),
    db: AsyncSession = Depends(get_db),
    _tenant: str = Depends(require_tenant_access),
):
    """Delete a document and its chunks from Qdrant and DB."""
    await processor.delete_document(tenant_id, kb_id, doc_id, db)


# ========== KB Retrieval Endpoint ==========

retrieval_svc = KbRetrievalService()


@router.post(
    "/{tenant_id}/agents/{agent_id}/retrieve",
    response_model=RetrieveResponse,
)
async def retrieve_kb_for_agent(
    tenant_id: str = Path(...),
    agent_id: str = Path(...),
    body: RetrieveRequest = Body(...),
    current_user: AdminUser = Depends(require_admin_or_super_admin),
    db: AsyncSession = Depends(get_db),
    _tenant: str = Depends(require_tenant_access),
):
    """Retrieve top-K chunks from agent's bound KB.

    Double isolation: Qdrant collection (physical) + payload filter (logical).
    Returns empty array if agent has no kb_id bound (no error).
    Exposes text, doc_id, chunk_index, score, filename only (no vector_id or collection).
    """
    results = await retrieval_svc.retrieve(
        tenant_id=tenant_id,
        agent_id=agent_id,
        query=body.query,
        top_k=body.top_k,
    )
    chunks = [RetrieveChunk(**r) for r in results]
    return RetrieveResponse(results=chunks)


# ========== KB Config/Detail/Delete/Reset Endpoints ==========

kb_svc = KbService()


@router.get(
    "/{tenant_id}/knowledge_bases/{kb_id}/config",
    response_model=KbConfigResponse,
)
async def get_kb_config(
    tenant_id: str = Path(...),
    kb_id: str = Path(...),
    current_user: AdminUser = Depends(require_admin_or_super_admin),
    _tenant: str = Depends(require_tenant_access),
):
    """Get KB embedding configuration."""
    try:
        return await kb_svc.get_kb_config(tenant_id, kb_id)
    except ValueError as e:
        raise HTTPException(404, str(e)) from None


@router.put(
    "/{tenant_id}/knowledge_bases/{kb_id}/config",
    response_model=KbConfigResponse,
)
async def update_kb_config(
    tenant_id: str = Path(...),
    kb_id: str = Path(...),
    body: KbConfigUpdate = Body(...),
    current_user: AdminUser = Depends(require_admin_or_super_admin),
    _tenant: str = Depends(require_tenant_access),
):
    """Update KB config. Embedding fields blocked when is_locked=True (409)."""
    try:
        updates = body.model_dump(exclude_none=True)
        await kb_svc.update_kb_config(tenant_id, kb_id, updates)
        return await kb_svc.get_kb_config(tenant_id, kb_id)
    except ValueError as e:
        raise HTTPException(404, str(e)) from None


@router.post(
    "/{tenant_id}/knowledge_bases/{kb_id}/reset",
)
async def reset_knowledge_base(
    tenant_id: str = Path(...),
    kb_id: str = Path(...),
    body: KbResetRequest = Body(...),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    current_user: AdminUser = Depends(require_admin_or_super_admin),
    _tenant: str = Depends(require_tenant_access),
):
    """Reset KB: clear Qdrant, recreate with new embedding model, reindex docs."""
    result = await kb_svc.reset_knowledge_base(
        tenant_id, kb_id, body.new_embedding_model, body.new_embedding_base_url
    )
    # Trigger reindex for each doc
    for doc_id in result.get("doc_ids", []):
        background_tasks.add_task(processor.process_document, doc_id, tenant_id, kb_id)
    return {
        "status": "resetting",
        "documents_to_reindex": len(result.get("doc_ids", [])),
    }


@router.get(
    "/{tenant_id}/knowledge_bases/{kb_id}",
    response_model=KbDetailResponse,
)
async def get_knowledge_base_detail(
    tenant_id: str = Path(...),
    kb_id: str = Path(...),
    current_user: AdminUser = Depends(require_admin_or_super_admin),
    _tenant: str = Depends(require_tenant_access),
):
    """Get KB detail with document/chunk counts and status."""
    try:
        return await kb_svc.get_kb_detail(tenant_id, kb_id)
    except ValueError as e:
        raise HTTPException(404, str(e)) from None


@router.delete(
    "/{tenant_id}/knowledge_bases/{kb_id}",
    response_model=KbDeleteResponse,
)
async def delete_knowledge_base(
    tenant_id: str = Path(...),
    kb_id: str = Path(...),
    current_user: AdminUser = Depends(require_admin_or_super_admin),
    _tenant: str = Depends(require_tenant_access),
):
    """Delete KB (blocked if agents reference it, 400)."""
    await kb_svc.delete_knowledge_base(tenant_id, kb_id)
    return KbDeleteResponse(deleted=True)
