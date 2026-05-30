"""KB document endpoints: upload, progress, delete."""

import logging

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Path,
    UploadFile,
)
from sqlalchemy.ext.asyncio import AsyncSession

from api.endpoints.auth import require_admin_or_super_admin, require_tenant_access
from api.v1.schemas import (
    KbDocumentItem,
    KbDocumentProgressResponse,
    KbDocumentUploadResponse,
)
from database import get_db
from models import AdminUser
from services.kb_document_processor import KbDocumentProcessor

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
    background_tasks: BackgroundTasks = BackgroundTasks(),
    current_user: AdminUser = Depends(require_admin_or_super_admin),
    db: AsyncSession = Depends(get_db),
    _tenant: str = Depends(require_tenant_access),
):
    """Upload file(s) to a knowledge base. Max 5 files, 20MB each."""
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
        doc.storage_path = storage_path
        doc.file_type = ext
        uploaded_items.append(
            KbDocumentItem(id=doc.id, filename=doc.filename, status=doc.status)
        )
        background_tasks.add_task(
            processor.process_document, doc.id, tenant_id, kb_id
        )
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
