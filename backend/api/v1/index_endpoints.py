"""索引管理API v1"""

from fastapi import APIRouter, HTTPException, status, BackgroundTasks, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List
import logging

import database
from database import get_db
from api.endpoints.auth import get_current_admin
from models import (
    Agent,
    URLSource,
    QAItem,
    DocumentChunk,
    IndexJob,
)
from api.v1.schemas import IndexRebuildRequest, IndexRebuildResponse
from services import QdrantVectorStore, TextChunker, TaskType, task_lock

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", dependencies=[Depends(get_current_admin)])

# 全局服务实例
qdrant_store = None
text_chunker = TextChunker()


async def rebuild_index_task(agent_id: str, job_id: str, force: bool = False):
    """异步重建索引任务 - 使用双缓冲模式"""
    task_id = f"rebuild_{job_id}"
    
    # 尝试获取任务锁
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

                # 更新任务状态为运行中
                result = await db.execute(select(IndexJob).where(IndexJob.id == job_id))
                job = result.scalar_one_or_none()
                if job:
                    job.status = "running"
                    job.started_at = func.now()
                    await db.commit()

                # 获取Agent
                agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
                agent = agent_result.scalar_one_or_none()
                if not agent:
                    raise ValueError(f"Agent {agent_id} not found")

                # 获取所有需要索引的内容
                # 1. 获取成功的URL内容
                url_result = await db.execute(
                    select(URLSource).where(
                        URLSource.agent_id == agent_id, URLSource.status == "success"
                    )
                )
                url_sources = url_result.scalars().all()

                # 2. 获取所有Q&A
                qa_result = await db.execute(
                    select(QAItem).where(QAItem.agent_id == agent_id)
                )
                qa_items = qa_result.scalars().all()

                # 准备文档块
                chunks_to_index = []
                db_chunks_to_add = []

                # 处理URL内容
                for url_source in url_sources:
                    if url_source.content:
                        # 分块
                        chunks = text_chunker.chunk_text(
                            url_source.content,
                            metadata={
                                "url": url_source.url,
                                "title": url_source.title,
                                "source_type": "url",
                                "url_source_id": url_source.id,
                            },
                        )

                        # 保存document_chunks到数据库
                        for i, chunk in enumerate(chunks):
                            doc_chunk = DocumentChunk(
                                agent_id=agent_id,
                                url_source_id=url_source.id,
                                content=chunk["content"],
                                chunk_index=i,
                                doc_metadata=chunk["metadata"],
                            )
                            db_chunks_to_add.append(doc_chunk)
                            chunks_to_index.append(chunk)

                # 处理Q&A内容
                for qa_item in qa_items:
                    if qa_item.answer:
                        chunks = text_chunker.chunk_text(
                            qa_item.answer,
                            metadata={
                                "qa_id": qa_item.id,
                                "question": qa_item.question,
                                "source_type": "qa",
                            },
                        )

                        for i, chunk in enumerate(chunks):
                            doc_chunk = DocumentChunk(
                                agent_id=agent_id,
                                content=chunk["content"],
                                chunk_index=i,
                                doc_metadata=chunk["metadata"],
                            )
                            db_chunks_to_add.append(doc_chunk)
                            chunks_to_index.append(chunk)

                if db_chunks_to_add:
                    db.add_all(db_chunks_to_add)
                    await db.commit()
                    logger.info(
                        f"Saved {len(chunks_to_index)} chunks to DB for agent {agent_id}"
                    )

                # 使用 Qdrant 索引
                if chunks_to_index:
                    if not agent.jina_api_key:
                        raise ValueError("Jina API key is required")

                    # 为chunks添加必要的元数据
                    for chunk in chunks_to_index:
                        metadata = chunk.get("metadata", {})
                        if "url_source_id" in metadata:
                            chunk["metadata"]["url_id"] = metadata["url_source_id"]

                    qdrant_store = QdrantVectorStore(
                        jina_api_key=agent.jina_api_key,
                        embedding_model=agent.embedding_model,
                    )

                    # 先清空再添加
                    qdrant_store.clear_collection(agent_id)
                    count = qdrant_store.add_documents(agent_id, chunks_to_index)
                    logger.info(f"Indexed {count} chunks for agent {agent_id} using Qdrant")
                    
                    # 更新所有URL和QA的is_indexed状态为True
                    for url_source in url_sources:
                        url_source.is_indexed = True
                    for qa_item in qa_items:
                        qa_item.is_indexed = True
                    await db.commit()
                    logger.info(f"Updated is_indexed status for {len(url_sources)} URLs and {len(qa_items)} QA items")
                else:
                    # 没有内容，清空索引
                    if agent.jina_api_key:
                        qdrant_store = QdrantVectorStore(
                            jina_api_key=agent.jina_api_key,
                            embedding_model=agent.embedding_model,
                        )
                        qdrant_store.delete_collection(agent_id)
                    logger.info(f"No content to index for agent {agent_id}, cleared index")

                # 更新任务状态为完成
                result = await db.execute(select(IndexJob).where(IndexJob.id == job_id))
                job = result.scalar_one_or_none()
                if job:
                    job.status = "completed"
                    job.completed_at = func.now()
                    job.result = {
                        "chunks_indexed": len(chunks_to_index),
                        "urls_processed": len(url_sources),
                        "qa_items_processed": len(qa_items),
                    }
                    await db.commit()

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
        # 释放任务锁
        await task_lock.release_task(agent_id, task_id)


@router.post("/index:rebuild", response_model=IndexRebuildResponse)
async def rebuild_index(
    request: IndexRebuildRequest,
    agent_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    重建索引

    根据PRD规范
    """
    # 验证Agent存在
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent {agent_id} not found"
        )

    if not agent.jina_api_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Jina API key is required",
        )

    # 创建索引任务
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

    # 后台任务：不传递db，在任务内部创建新的session
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

    if agent.jina_api_key:
        qdrant_store = QdrantVectorStore(
            jina_api_key=agent.jina_api_key,
            embedding_model=agent.embedding_model,
        )
        info = qdrant_store.get_collection_info(agent_id)
    else:
        info = {
            "vectors_count": 0,
            "points_count": 0,
            "status": "not_found",
        }

    # 统计URL和Q&A数量
    url_result = await db.execute(
        select(func.count()).select_from(URLSource).where(
            URLSource.agent_id == agent_id, URLSource.status == "success"
        )
    )
    urls_indexed = url_result.scalar() or 0

    qa_result = await db.execute(
        select(func.count()).select_from(QAItem).where(QAItem.agent_id == agent_id)
    )
    qa_items_indexed = qa_result.scalar() or 0

    return {
        "agent_id": agent_id,
        "index_exists": info["vectors_count"] > 0 or info["status"] != "not_found",
        "urls_indexed": urls_indexed,
        "qa_items_indexed": qa_items_indexed,
        "chunks_indexed": info["vectors_count"],
        "total_chunks": info["vectors_count"],
        "total_vectors": info["vectors_count"],
        "total_documents": info["points_count"],
        "status": info["status"],
    }
