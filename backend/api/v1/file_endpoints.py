"""File upload API endpoints — replaces QA endpoints."""

from fastapi import APIRouter, HTTPException, status, UploadFile, File, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
import logging
import uuid

import database
from database import get_db
from api.endpoints.auth import require_admin_or_super_admin
from models import Agent, KnowledgeFile, WorkspaceQuota
from api.v1.schemas import FileUploadResponse, FileListResponse, FileItem
from services.r2r_client import R2RClient

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_admin_or_super_admin)])

ALLOWED_EXTENSIONS = {
    "txt", "md", "csv", "tsv", "json", "html", "htm",
    "pdf", "doc", "docx", "rtf",
    "pptx", "xlsx",
    "epub",
}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB


def _get_extension(filename: str) -> str:
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else ""


@router.post("/files:upload", response_model=FileUploadResponse)
async def upload_files(
    agent_id: str,
    files: list[UploadFile] = File(...),
    db: AsyncSession = Depends(get_db),
):
    """Upload file(s) and ingest them into R2R."""
    # Verify agent exists
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")

    # Check quota
    quota_result = await db.execute(
        select(WorkspaceQuota).where(WorkspaceQuota.workspace_id == agent.workspace_id)
    )
    quota = quota_result.scalar_one_or_none()
    if quota:
        current_files = await db.execute(
            select(func.count()).select_from(KnowledgeFile).where(
                KnowledgeFile.agent_id == agent_id
            )
        )
        file_count = current_files.scalar() or 0
        max_files = quota.max_qa_items
        if file_count + len(files) > max_files:
            raise HTTPException(
                status_code=429,
                detail=f"File quota exceeded: {file_count}/{max_files}"
            )

    r2r = R2RClient()
    uploaded = []
    errors = []

    for upload_file in files:
        filename = upload_file.filename or "unnamed"
        ext = _get_extension(filename)

        if ext not in ALLOWED_EXTENSIONS:
            errors.append(f"{filename}: unsupported file type '.{ext}'")
            continue

        content = await upload_file.read()
        if len(content) > MAX_FILE_SIZE:
            errors.append(f"{filename}: file too large (max 50MB)")
            continue

        file_id = f"kf_{uuid.uuid4().hex[:12]}"
        file_type = ext
        file_size = len(content)

        # Create DB record first
        kf = KnowledgeFile(
            id=file_id,
            agent_id=agent_id,
            filename=filename,
            file_size=file_size,
            file_type=file_type,
            status="uploading",
        )
        db.add(kf)
        await db.flush()

        try:
            # Upload to R2R
            result = await r2r.ingest_file(
                agent_id=agent_id,
                file_content=content,
                filename=filename,
                metadata={
                    "source_type": "file",
                    "knowledge_file_id": file_id,
                    "filename": filename,
                    "file_type": file_type,
                },
            )

            r2r_doc_id = result.get("id", result.get("document_id", ""))
            kf.r2r_document_id = str(r2r_doc_id)
            kf.status = "ready"  # R2R processes synchronously during the request
            uploaded.append(kf)
            logger.info(f"Uploaded file '{filename}' to R2R (doc_id={r2r_doc_id})")

        except Exception as e:
            kf.status = "failed"
            kf.error_message = str(e)[:500]
            errors.append(f"{filename}: {str(e)[:100]}")
            logger.warning(f"Failed to upload file '{filename}': {e}")

    file_items = [
        FileItem(
            id=f.id,
            filename=f.filename,
            file_size=f.file_size,
            file_type=f.file_type,
            status=f.status,
            error_message=f.error_message,
            created_at=f.created_at,
            updated_at=f.updated_at,
        )
        for f in uploaded
    ]

    await db.commit()

    return FileUploadResponse(
        uploaded=len(uploaded),
        failed=len(errors),
        files=file_items,
        errors=errors,
    )


@router.get("/files:list", response_model=FileListResponse)
async def list_files(
    agent_id: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """List uploaded files for an agent."""
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")

    # Total count
    total_result = await db.execute(
        select(func.count()).select_from(KnowledgeFile).where(
            KnowledgeFile.agent_id == agent_id
        )
    )
    total = total_result.scalar() or 0

    # Get quota
    from models import WorkspaceQuota
    quota_result = await db.execute(
        select(WorkspaceQuota).where(WorkspaceQuota.workspace_id == agent.workspace_id)
    )
    quota = quota_result.scalar_one_or_none()
    max_files = quota.max_qa_items if quota else 500

    # Paginated list
    files_result = await db.execute(
        select(KnowledgeFile)
        .where(KnowledgeFile.agent_id == agent_id)
        .order_by(KnowledgeFile.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    files = files_result.scalars().all()

    return FileListResponse(
        files=[
            FileItem(
                id=f.id,
                filename=f.filename,
                file_size=f.file_size,
                file_type=f.file_type,
                status=f.status,
                error_message=f.error_message,
                created_at=f.created_at,
                updated_at=f.updated_at,
            )
            for f in files
        ],
        total=total,
        quota={"used": total, "max": max_files},
    )


@router.delete("/files:delete")
async def delete_file(
    agent_id: str,
    file_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Delete a file and its R2R document."""
    result = await db.execute(
        select(KnowledgeFile).where(
            KnowledgeFile.id == file_id,
            KnowledgeFile.agent_id == agent_id,
        )
    )
    kf = result.scalar_one_or_none()
    if not kf:
        raise HTTPException(status_code=404, detail="File not found")

    # Delete from R2R if we have the document ID
    if kf.r2r_document_id:
        r2r = R2RClient()
        try:
            await r2r.delete_document(kf.r2r_document_id)
        except Exception as e:
            logger.warning(f"Failed to delete R2R document {kf.r2r_document_id}: {e}")

    await db.delete(kf)
    await db.commit()

    return {"message": "File deleted"}


@router.delete("/files:clear_all")
async def clear_all_files(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Clear all files for an agent."""
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()
    if not agent:
        raise HTTPException(status_code=404, detail=f"Agent {agent_id} not found")

    # Delete R2R collection
    r2r = R2RClient()
    try:
        await r2r.delete_collection(agent_id)
    except Exception as e:
        logger.warning(f"Failed to delete R2R collection: {e}")

    # Delete all file records
    files_result = await db.execute(
        select(KnowledgeFile).where(KnowledgeFile.agent_id == agent_id)
    )
    files = files_result.scalars().all()
    for f in files:
        await db.delete(f)

    await db.commit()

    return {"message": f"Cleared {len(files)} files", "deleted_count": len(files)}
