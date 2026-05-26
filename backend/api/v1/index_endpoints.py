"""索引管理API v1 — R2R version"""

from fastapi import APIRouter, HTTPException, status, BackgroundTasks, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
import logging

import database
from database import get_db
from api.endpoints.auth import require_admin_or_super_admin
from models import (
    Agent,
    URLSource,
    KnowledgeFile,
    IndexJob,
)
from api.v1.schemas import IndexRebuildRequest, IndexRebuildResponse
from services import R2RClient, TaskType, task_lock

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_admin_or_super_admin)])


async def rebuild_index_task(agent_id: str, job_id: str, force: bool = False):
    """异步重建索引任务 — re-ingest URL content into R2R without destroying existing file documents."""
    task_id = f"rebuild_{job_id}"

    success, error = await task_lock.acquire_task(agent_id, TaskType.INDEX_REBUILD, task_id)
    if not success:
        logger.warning(f"Cannot start index rebuild: {error}")
        async with database.AsyncSessionLocal() as db:
            result = await db.execute(select(IndexJob).where(IndexJob.id == job_id))
            job = result.scalar_one_or_none()
            if job:
                job.status = "failed"
                job.error_message = error
                job.completed_at = func.now()
                await db.commit()
        return

    try:
        async with database.AsyncSessionLocal() as db:
            try:
                logger.info(f"Starting index rebuild for agent {agent_id}, job {job_id}")

                result = await db.execute(select(IndexJob).where(IndexJob.id == job_id))
                job = result.scalar_one_or_none()
                if job:
                    job.status = "running"
                    job.started_at = func.now()
                    await db.commit()

                r2r = R2RClient()

                # Determine which URL sources need ingestion:
                # - force=False: only ingest URLs that haven't been indexed yet
                # - force=True: re-ingest all successful URLs
                if force:
                    url_result = await db.execute(
                        select(URLSource).where(
                            URLSource.agent_id == agent_id, URLSource.status == "success"
                        )
                    )
                else:
                    url_result = await db.execute(
                        select(URLSource).where(
                            URLSource.agent_id == agent_id,
                            URLSource.status == "success",
                            URLSource.is_indexed == False,
                        )
                    )
                url_sources = url_result.scalars().all()

                # Ingest URL content (never delete the collection — files must be preserved)
                ingested_count = 0
                failed_count = 0
                errors = []
                for url_source in url_sources:
                    if not url_source.content:
                        continue
                    # Always unassign existing R2R document before re-ingesting to avoid stale content
                    # This handles both force rebuild and the case where previous refetch failed mid-way
                    if url_source.r2r_document_id:
                        unassigned = await r2r.unassign_document(agent_id, url_source.r2r_document_id)
                        if not unassigned:
                            failed_count += 1
                            errors.append(
                                f"URL {url_source.url}: failed to unassign old R2R doc "
                                f"{url_source.r2r_document_id}; skipping to avoid stale content"
                            )
                            continue
                        url_source.r2r_document_id = None
                        url_source.is_indexed = False
                    try:
                        doc = await r2r.ingest_text(
                            agent_id=agent_id,
                            text=url_source.content,
                            title=url_source.title or url_source.url,
                            metadata={
                                "url": url_source.url,
                                "title": url_source.title,
                                "source_type": "url",
                                "url_source_id": url_source.id,
                            },
                        )
                        r2r_doc_id = doc.get("id", doc.get("document_id", ""))
                        if r2r_doc_id:
                            url_source.r2r_document_id = str(r2r_doc_id)
                        url_source.is_indexed = True
                        ingested_count += 1
                    except Exception as e:
                        url_source.is_indexed = False
                        failed_count += 1
                        errors.append(f"URL {url_source.url}: {str(e)[:100]}")
                        logger.warning(f"Failed to ingest URL {url_source.url}: {e}")
                await db.commit()

                # Update job status
                result = await db.execute(select(IndexJob).where(IndexJob.id == job_id))
                job = result.scalar_one_or_none()
                if job:
                    job.status = "completed"
                    job.completed_at = func.now()
                    job.result = {
                        "urls_ingested": ingested_count,
                        "urls_failed": failed_count,
                        "errors": errors[:10],
                    }
                    await db.commit()

                logger.info(f"Index rebuild completed: {ingested_count} URLs ingested, {len(errors)} errors")

            except Exception as e:
                logger.exception(f"Error in rebuild_index_task: {e}")
                try:
                    async with database.AsyncSessionLocal() as fail_db:
                        result = await fail_db.execute(select(IndexJob).where(IndexJob.id == job_id))
                        job = result.scalar_one_or_none()
                        if job:
                            job.status = "failed"
                            job.completed_at = func.now()
                            job.error_message = str(e)[:500]
                            await fail_db.commit()
                except Exception:
                    logger.exception("Failed to update IndexJob failure status")
    finally:
        await task_lock.release_task(agent_id, task_id)


@router.post("/index:rebuild", response_model=IndexRebuildResponse)
async def rebuild_index(
    request: IndexRebuildRequest,
    agent_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """重建索引 — re-ingest URL content into R2R"""
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent {agent_id} not found"
        )

    import uuid
    job_id = f"job_{uuid.uuid4().hex[:12]}"

    job = IndexJob(
        id=job_id,
        agent_id=agent_id,
        status="queued",
        job_type="full",
        created_at=func.now(),
    )

    db.add(job)
    await db.commit()

    background_tasks.add_task(rebuild_index_task, agent_id, job_id, request.force)

    return IndexRebuildResponse(
        job_id=job_id, status="queued", message="Index rebuild job queued"
    )


@router.get("/index:status")
async def get_index_status(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
):
    """获取索引任务状态"""
    result = await db.execute(
        select(IndexJob)
        .where(IndexJob.agent_id == agent_id)
        .order_by(IndexJob.created_at.desc())
        .limit(1)
    )
    job = result.scalar_one_or_none()

    if not job:
        return {"status": "idle", "job_id": None}

    return {
        "status": job.status,
        "job_id": job.id,
        "created_at": job.created_at,
        "started_at": job.started_at,
        "completed_at": job.completed_at,
        "error_message": job.error_message,
        "result": job.result,
    }


@router.get("/index:info")
async def get_index_info(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
):
    """获取索引信息"""
    agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = agent_result.scalar_one_or_none()

    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent {agent_id} not found"
        )

    # Count URLs
    url_result = await db.execute(
        select(func.count()).select_from(URLSource).where(
            URLSource.agent_id == agent_id, URLSource.status == "success"
        )
    )
    urls_indexed = url_result.scalar() or 0

    # Count files
    file_result = await db.execute(
        select(func.count()).select_from(KnowledgeFile).where(
            KnowledgeFile.agent_id == agent_id, KnowledgeFile.status == "ready"
        )
    )
    files_ready = file_result.scalar() or 0

    # Try to get R2R collection info
    r2r = R2RClient()
    try:
        r2r_healthy = await r2r.health()
    except Exception:
        r2r_healthy = False

    return {
        "agent_id": agent_id,
        "index_exists": r2r_healthy and (urls_indexed > 0 or files_ready > 0),
        "urls_indexed": urls_indexed,
        "files_ready": files_ready,
        "r2r_healthy": r2r_healthy,
        "status": "ready" if r2r_healthy else "unavailable",
    }
