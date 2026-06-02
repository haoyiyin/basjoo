"""File knowledge source service (extracted from endpoints.py per AGENTS.md)."""

from fastapi import HTTPException, UploadFile
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from api.v1.schemas import FileItem, FileListResponse, FileUploadResponse
from models import KnowledgeFile


async def list_files(
    db: AsyncSession, agent_id: str, skip: int = 0, limit: int = 100
) -> FileListResponse:
    stmt = (
        select(KnowledgeFile)
        .where(KnowledgeFile.agent_id == agent_id)
        .order_by(KnowledgeFile.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(stmt)
    files = result.scalars().all()

    total = (
        await db.execute(
            select(func.count(KnowledgeFile.id)).where(
                KnowledgeFile.agent_id == agent_id
            )
        )
    ).scalar() or 0

    quota: dict[str, int] = {"used": total, "max": 500}
    items = [FileItem.model_validate(f) for f in files]
    return FileListResponse(files=items, total=total, quota=quota)


async def upload_files(
    db: AsyncSession, agent_id: str, files: list[UploadFile]
) -> FileUploadResponse:
    uploaded = 0
    failed = 0
    errors: list[str] = []
    items: list[FileItem] = []
    for f in files:
        try:
            kf = KnowledgeFile(
                agent_id=agent_id,
                filename=f.filename or "unknown",
                file_size=getattr(f, "size", None),
                file_type=getattr(f, "content_type", None),
                status="pending",
            )
            db.add(kf)
            await db.commit()
            await db.refresh(kf)
            items.append(FileItem.model_validate(kf))
            uploaded += 1
        except Exception as e:
            failed += 1
            errors.append(str(e))
    return FileUploadResponse(
        uploaded=uploaded, failed=failed, files=items, errors=errors
    )


async def delete_file(db: AsyncSession, agent_id: str, file_id: str) -> dict[str, bool]:
    kf = await db.get(KnowledgeFile, file_id)
    if kf is None or getattr(kf, "agent_id", None) != agent_id:
        raise HTTPException(status_code=404, detail="File not found")
    await db.delete(kf)
    await db.commit()
    return {"success": True}


async def clear_all_files(db: AsyncSession, agent_id: str) -> dict[str, bool]:
    await db.execute(delete(KnowledgeFile).where(KnowledgeFile.agent_id == agent_id))
    await db.commit()
    return {"success": True}
