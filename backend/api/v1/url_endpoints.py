"""URL和Q&A管理API v1"""

from fastapi import APIRouter, HTTPException, status, BackgroundTasks, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from typing import List
import logging
import csv
import asyncio

import database
from database import get_db
from models import (
    Agent,
    URLSource,
    QAItem,
    WorkspaceQuota,
    DocumentChunk,
)
from api.v1.schemas import (
    URLCreateRequest,
    URLListResponse,
    URLRefetchRequest,
    URLRefetchResponse,
    SiteCrawlRequest,
    SiteCrawlResponse,
    QABatchImportRequest,
    QAListResponse,
    QAUpdateRequest,
    QABatchImportResponse,
)
from services import URLNormalizer, QdrantVectorStore, TextChunker, SiteCrawler, TaskType, task_lock
from services.scraper import URLScraper

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1")

# 全局服务实例
qdrant_store = None
text_chunker = TextChunker()


# ========== URL Management ==========


async def _run_tracked_task(agent_id: str, task_id: str, coro):
    task = asyncio.current_task()
    if task:
        await task_lock.register_task_handle(agent_id, task_id, task)
    await coro


async def fetch_url_task(url_source_id: int):
    """异步抓取URL任务 - 使用短生命周期 DB session"""
    agent_id = None
    task_id = f"fetch_{url_source_id}"

    try:
        async with database.AsyncSessionLocal() as db:
            result = await db.execute(
                select(URLSource).where(URLSource.id == url_source_id)
            )
            url_source = result.scalar_one_or_none()

            if not url_source:
                logger.error(f"URLSource {url_source_id} not found")
                return

            agent_id = url_source.agent_id
            url = url_source.url

            agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
            agent = agent_result.scalar_one_or_none()
            jina_api_key = agent.jina_api_key if agent else ""

        success, error = await task_lock.acquire_task(agent_id, TaskType.URL_FETCH, task_id)
        if not success:
            logger.warning(f"Cannot start URL fetch: {error}")
            async with database.AsyncSessionLocal() as db:
                result = await db.execute(select(URLSource).where(URLSource.id == url_source_id))
                url_source = result.scalar_one_or_none()
                if url_source:
                    url_source.status = "failed"
                    url_source.last_error = error
                    await db.commit()
            return

        try:
            async with database.AsyncSessionLocal() as db:
                result = await db.execute(select(URLSource).where(URLSource.id == url_source_id))
                url_source = result.scalar_one_or_none()
                if not url_source:
                    return
                url_source.status = "fetching"
                await db.commit()

            if task_lock.is_cancelled(agent_id, task_id):
                async with database.AsyncSessionLocal() as db:
                    result = await db.execute(select(URLSource).where(URLSource.id == url_source_id))
                    url_source = result.scalar_one_or_none()
                    if url_source:
                        url_source.status = "failed"
                        url_source.last_error = "Fetch cancelled by user"
                        url_source.updated_at = func.now()
                        await db.commit()
                return

            agent_scraper = URLScraper(jina_api_key=jina_api_key or "")
            fetch_result = await agent_scraper.fetch(url)

            async with database.AsyncSessionLocal() as db:
                result = await db.execute(select(URLSource).where(URLSource.id == url_source_id))
                url_source = result.scalar_one_or_none()
                if not url_source:
                    return

                if task_lock.is_cancelled(agent_id, task_id):
                    url_source.status = "failed"
                    url_source.last_error = "Fetch cancelled by user"
                    url_source.updated_at = func.now()
                    await db.commit()
                    return

                if fetch_result.get("success"):
                    url_source.status = "success"
                    url_source.title = fetch_result.get("title")
                    url_source.content = fetch_result.get("content")
                    url_source.content_hash = fetch_result.get("content_hash")
                    url_source.last_fetch_at = func.now()
                    url_source.fetch_metadata = fetch_result.get("metadata")
                    await db.commit()
                    logger.info(f"Successfully fetched {url_source.url}")
                else:
                    url_source.status = "failed"
                    url_source.last_error = fetch_result.get("error") or "Unknown error"
                    url_source.updated_at = func.now()
                    await db.commit()
                    logger.error(
                        f"Failed to fetch {url_source.url}: {fetch_result.get('error')}"
                    )
        finally:
            await task_lock.release_task(agent_id, task_id)

    except asyncio.CancelledError:
        logger.info(f"fetch_url_task cancelled for URLSource {url_source_id}")
        raise
    except Exception as e:
        logger.exception(f"Error in fetch_url_task: {e}")
        if agent_id:
            try:
                async with database.AsyncSessionLocal() as db:
                    result = await db.execute(select(URLSource).where(URLSource.id == url_source_id))
                    url_source = result.scalar_one_or_none()
                    if url_source:
                        url_source.status = "failed"
                        url_source.last_error = str(e)[:500]
                        url_source.updated_at = func.now()
                        await db.commit()
            except Exception:
                logger.exception("Failed to update URL fetch failure status")


@router.post("/urls:create")
async def create_urls(
    request: URLCreateRequest,
    agent_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    创建URL知识源（批量）

    根据PRD第8.3节规范
    """
    # 获取Agent
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent {agent_id} not found"
        )

    # 获取配额并加锁
    quota_result = await db.execute(
        select(WorkspaceQuota)
        .where(WorkspaceQuota.workspace_id == agent.workspace_id)
        .with_for_update()
    )
    quota = quota_result.scalar_one_or_none()

    if not quota:
        quota = WorkspaceQuota(workspace_id=agent.workspace_id)
        db.add(quota)
        await db.flush()

    # 检查配额（在锁保护下）
    if quota.used_urls + len(request.urls) > quota.max_urls:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"URL quota exceeded. Max: {quota.max_urls}, Used: {quota.used_urls}",
        )

    # 创建URL记录并同步更新配额
    created_urls = []
    for url in request.urls:
        normalized = URLNormalizer.normalize(url)

        existing = await db.execute(
            select(URLSource).where(
                URLSource.agent_id == agent_id, URLSource.normalized_url == normalized
            )
        )
        if existing.scalar_one_or_none():
            continue

        url_source = URLSource(
            agent_id=agent_id,
            url=url,
            normalized_url=normalized,
            status="pending",
        )

        try:
            async with db.begin_nested():
                db.add(url_source)
                await db.flush()
                created_urls.append(url_source)
                quota.used_urls += 1
        except IntegrityError:
            logger.info(f"URL {url} already exists (concurrent creation), skipping")
            continue

    await db.commit()

    # 异步抓取
    for url_source in created_urls:
        task_id = f"fetch_{url_source.id}"
        background_tasks.add_task(_run_tracked_task, agent_id, task_id, fetch_url_task(url_source.id))

    return {
        "created": len(created_urls),
        "message": f"Successfully added {len(created_urls)} URLs",
    }


@router.get("/urls:list", response_model=URLListResponse)
async def list_urls(
    agent_id: str,
    status_filter: str = None,
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """
    列出URL知识源

    根据PRD第8.3节规范
    """
    # 获取配额
    agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = agent_result.scalar_one_or_none()

    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent {agent_id} not found"
        )

    quota_result = await db.execute(
        select(WorkspaceQuota).where(WorkspaceQuota.workspace_id == agent.workspace_id)
    )
    quota = quota_result.scalar_one_or_none()

    # 查询URL列表
    query = select(URLSource).where(URLSource.agent_id == agent_id)

    if status_filter:
        query = query.where(URLSource.status == status_filter)

    query = query.order_by(URLSource.created_at.desc()).offset(skip).limit(limit)

    result = await db.execute(query)
    urls = result.scalars().all()

    # 获取总数
    count_result = await db.execute(
        select(func.count(URLSource.id)).where(URLSource.agent_id == agent_id)
    )
    total = count_result.scalar() or 0

    from api.v1.schemas import URLItem

    return URLListResponse(
        urls=[URLItem.model_validate(u) for u in urls],
        total=total,
        quota={
            "used": quota.used_urls if quota else 0,
            "max": quota.max_urls if quota else 50,
        },
    )


@router.post("/urls:refetch", response_model=URLRefetchResponse)
async def refetch_urls(
    request: URLRefetchRequest,
    agent_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    重新抓取URL

    根据PRD第8.3节规范
    """
    # 获取要重抓的URL
    query = select(URLSource).where(URLSource.agent_id == agent_id)

    if request.url_ids:
        query = query.where(URLSource.id.in_(request.url_ids))

    result = await db.execute(query)
    urls = result.scalars().all()

    if not urls:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No URLs found to refetch"
        )

    # 异步抓取
    job_id = f"job_refetch_{agent_id}"
    for url_source in urls:
        if request.force or url_source.status != "success":
            url_source.status = "pending"
            background_tasks.add_task(fetch_url_task, url_source.id)

    await db.commit()

    return URLRefetchResponse(
        job_id=job_id,
        status="queued",
        message=f"Queued {len(urls)} URLs for refetching",
    )


@router.post("/urls:cancel")
async def cancel_url_tasks(
    agent_id: str,
):
    cancelled = await task_lock.cancel_tasks(
        agent_id,
        {TaskType.URL_CRAWL, TaskType.URL_FETCH, TaskType.URL_REFETCH},
    )
    return {
        "cancelled": len(cancelled),
        "task_ids": cancelled,
        "message": f"Cancelled {len(cancelled)} URL tasks",
    }


@router.delete("/urls:delete")
async def delete_url(
    url_id: int,
    agent_id: str,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(URLSource).where(URLSource.id == url_id, URLSource.agent_id == agent_id)
    )
    url_source = result.scalar_one_or_none()

    if not url_source:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"URL {url_id} not found"
        )

    agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = agent_result.scalar_one_or_none()

    await db.delete(url_source)

    if agent:
        quota_result = await db.execute(
            select(WorkspaceQuota).where(
                WorkspaceQuota.workspace_id == agent.workspace_id
            )
        )
        quota = quota_result.scalar_one_or_none()
        if quota:
            quota.used_urls = max(0, quota.used_urls - 1)

    await db.commit()

    # 同步删除 Qdrant 向量索引中的数据
    try:
        if agent and agent.jina_api_key:
            qdrant_store = QdrantVectorStore(
                jina_api_key=agent.jina_api_key,
                embedding_model=agent.embedding_model,
            )
            qdrant_store.delete_by_source(agent_id, "url", str(url_id))
    except Exception as e:
        logger.warning(f"Failed to delete vectors for URL {url_id}: {e}")

    return {"message": "URL deleted successfully"}


@router.post("/urls:discover")
async def discover_subpages(
    agent_id: str,
    url: str,
    max_depth: int = 1,
    max_pages: int = 10,
    background_tasks: BackgroundTasks = None,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent {agent_id} not found"
        )

    quota_result = await db.execute(
        select(WorkspaceQuota).where(WorkspaceQuota.workspace_id == agent.workspace_id)
    )
    quota = quota_result.scalar_one_or_none()

    agent_scraper = URLScraper(jina_api_key=agent.jina_api_key or "")
    discovered_urls = await agent_scraper.discover_subpages(
        url, max_depth=max_depth, max_pages=max_pages
    )

    created_urls = []
    for discovered_url, _depth in discovered_urls:
        if quota and quota.used_urls >= quota.max_urls:
            break

        normalized = URLNormalizer.normalize(discovered_url)

        existing = await db.execute(
            select(URLSource).where(
                URLSource.agent_id == agent_id, URLSource.normalized_url == normalized
            )
        )
        if existing.scalar_one_or_none():
            continue

        url_source = URLSource(
            agent_id=agent_id,
            url=discovered_url,
            normalized_url=normalized,
            status="pending",
        )
        db.add(url_source)
        created_urls.append(url_source)

        if quota:
            quota.used_urls += 1

    await db.commit()

    if background_tasks:
        for url_source in created_urls:
            task_id = f"fetch_{url_source.id}"
            background_tasks.add_task(_run_tracked_task, agent_id, task_id, fetch_url_task(url_source.id))

    return {
        "discovered": len(discovered_urls),
        "created": len(created_urls),
        "message": f"Discovered {len(discovered_urls)} URLs, added {len(created_urls)} new ones",
    }


# ========== Site Crawl ==========


async def site_crawl_task(agent_id: str, url: str, max_depth: int, max_pages: int):
    """后台全站爬取任务 - 使用短生命周期 DB session"""
    task_id = f"crawl_{url[:50]}_{max_depth}_{max_pages}"
    logger.info(f"[site_crawl_task] Starting task {task_id} for agent {agent_id}")

    success, error = await task_lock.acquire_task(agent_id, TaskType.URL_CRAWL, task_id)
    if not success:
        logger.warning(f"[site_crawl_task] Cannot start site crawl: {error}")
        return

    logger.info(f"[site_crawl_task] Lock acquired, starting crawl for {url}")

    try:
        async with database.AsyncSessionLocal() as db:
            agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
            agent = agent_result.scalar_one_or_none()
            if not agent:
                logger.error(f"[site_crawl_task] Agent {agent_id} not found for site crawl")
                return
            jina_api_key = agent.jina_api_key or ""
            workspace_id = agent.workspace_id

        logger.info(f"[site_crawl_task] Initializing SiteCrawler...")
        crawler = SiteCrawler(jina_api_key=jina_api_key)
        logger.info(f"[site_crawl_task] Starting crawl_site({url}, depth={max_depth}, pages={max_pages})")
        results = await crawler.crawl_site(
            url=url,
            max_depth=max_depth,
            max_pages=max_pages
        )
        logger.info(f"[site_crawl_task] Crawl completed, got {len(results)} results")

        if task_lock.is_cancelled(agent_id, task_id):
            logger.info(f"[site_crawl_task] Task {task_id} cancelled before persisting results")
            return

        async with database.AsyncSessionLocal() as db:
            try:
                quota_result = await db.execute(
                    select(WorkspaceQuota).where(WorkspaceQuota.workspace_id == workspace_id)
                )
                quota = quota_result.scalar_one_or_none()
                logger.info(f"[site_crawl_task] Quota: {quota.used_urls if quota else 'N/A'}/{quota.max_urls if quota else 'N/A'}")

                created_count = 0
                seen_normalized_urls = set()

                for page_result in results:
                    if task_lock.is_cancelled(agent_id, task_id):
                        logger.info(f"[site_crawl_task] Task {task_id} cancelled during result persistence")
                        await db.rollback()
                        return
                    if not page_result.success:
                        continue

                    if quota and quota.used_urls >= quota.max_urls:
                        logger.warning(f"URL quota exceeded for agent {agent_id}")
                        break

                    normalized = URLNormalizer.normalize(page_result.url)
                    if normalized in seen_normalized_urls:
                        continue
                    seen_normalized_urls.add(normalized)

                    existing = await db.execute(
                        select(URLSource).where(
                            URLSource.agent_id == agent_id,
                            URLSource.normalized_url == normalized
                        )
                    )
                    if existing.scalar_one_or_none():
                        continue

                    url_source = URLSource(
                        agent_id=agent_id,
                        url=page_result.url,
                        normalized_url=normalized,
                        status="success",
                        title=page_result.title,
                        content=page_result.content,
                        content_hash=page_result.content_hash,
                        fetch_metadata=page_result.metadata,
                    )
                    db.add(url_source)

                    try:
                        await db.flush()
                        created_count += 1
                        if quota:
                            quota.used_urls += 1
                    except IntegrityError:
                        await db.rollback()
                        quota_result = await db.execute(
                            select(WorkspaceQuota).where(WorkspaceQuota.workspace_id == workspace_id)
                        )
                        quota = quota_result.scalar_one_or_none()
                        logger.info(f"Skipping duplicate URL: {normalized}")
                        continue

                await db.commit()
                logger.info(f"Site crawl completed for {url}: {created_count} pages added")

            except asyncio.CancelledError:
                logger.info(f"[site_crawl_task] Task {task_id} cancelled")
                await db.rollback()
                raise
            except Exception as e:
                logger.exception(f"[site_crawl_task] Error in site_crawl_task: {e}")
                await db.rollback()
    finally:
        logger.info(f"[site_crawl_task] Releasing task lock {task_id}")
        await task_lock.release_task(agent_id, task_id)


@router.post("/urls:crawl_site", response_model=SiteCrawlResponse)
async def crawl_site(
    request: SiteCrawlRequest,
    agent_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    全站爬取：输入根URL，自动发现并抓取所有子页面

    使用 URLScraper 发现并抓取站内页面内容
    """
    logger.info(f"[crawl_site] Received request: agent_id={agent_id}, url={request.url}, depth={request.max_depth}, pages={request.max_pages}")

    # 获取Agent
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()

    if not agent:
        logger.error(f"[crawl_site] Agent {agent_id} not found")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent {agent_id} not found"
        )

    # 检查配额
    quota_result = await db.execute(
        select(WorkspaceQuota).where(WorkspaceQuota.workspace_id == agent.workspace_id)
    )
    quota = quota_result.scalar_one_or_none()

    if quota and quota.used_urls >= quota.max_urls:
        logger.warning(f"[crawl_site] Quota exceeded for agent {agent_id}: {quota.used_urls}/{quota.max_urls}")
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"URL quota exceeded. Max: {quota.max_urls}, Used: {quota.used_urls}",
        )

    # 生成任务ID
    import uuid
    job_id = f"crawl_{uuid.uuid4().hex[:12]}"

    logger.info(f"[crawl_site] Adding background task for {request.url}, job_id={job_id}")

    # 添加后台任务
    task_id = f"crawl_{request.url[:50]}_{request.max_depth}_{request.max_pages}"
    background_tasks.add_task(
        _run_tracked_task,
        agent_id,
        task_id,
        site_crawl_task(
            agent_id,
            request.url,
            request.max_depth,
            request.max_pages,
        ),
    )

    logger.info(f"[crawl_site] Background task added successfully")

    return SiteCrawlResponse(
        job_id=job_id,
        status="queued",
        discovered=0,
        created=0,
        message=f"Site crawl started for {request.url} (depth={request.max_depth}, max_pages={request.max_pages})",
    )


# ========== Q&A Management ==========


@router.post("/qa:batch_import", response_model=QABatchImportResponse)
async def batch_import_qa(
    request: QABatchImportRequest,
    agent_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    批量导入Q&A

    根据PRD第8.4节规范
    """
    import json
    import io

    # 获取Agent
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent {agent_id} not found"
        )

    # 获取配额并加锁（一次性完成，防止并发问题）
    quota_result = await db.execute(
        select(WorkspaceQuota)
        .where(WorkspaceQuota.workspace_id == agent.workspace_id)
        .with_for_update()  # 立即加锁
    )
    quota = quota_result.scalar_one_or_none()

    if not quota:
        # 如果配额不存在，创建并加锁
        quota = WorkspaceQuota(workspace_id=agent.workspace_id)
        db.add(quota)
        await db.flush()  # flush以确保行存在但不释放锁

    # 解析内容
    items_to_import = []
    errors = []

    try:
        if request.format == "json":
            data = json.loads(request.content)
            if isinstance(data, list):
                items_to_import = data
            elif isinstance(data, dict) and "items" in data:
                items_to_import = data["items"]
            else:
                errors.append("Invalid JSON format")

        elif request.format == "csv":
            lines = request.content.strip().split("\n")
            reader = csv.reader(lines)
            for index, row in enumerate(reader):
                normalized_row = [cell.strip() for cell in row]
                if index == 0 and len(normalized_row) >= 2 and normalized_row[0].lower() == "question" and normalized_row[1].lower() == "answer":
                    continue
                if len(normalized_row) >= 2:
                    items_to_import.append(
                        {
                            "question": normalized_row[0],
                            "answer": normalized_row[1],
                        }
                    )
                elif len(normalized_row) > 0:
                    errors.append(f"Invalid CSV row: {row}")

    except Exception as e:
        errors.append(f"Parse error: {str(e)}")

    # 导入
    imported = 0
    failed = 0

    for item in items_to_import[:100]:  # 限制单次最多100条
        try:
            question = item.get("question", "").strip()
            answer = item.get("answer", "").strip()

            if not question or not answer:
                errors.append(f"Empty question or answer: {item}")
                failed += 1
                continue

            # 检查是否已存在
            existing = await db.execute(
                select(QAItem).where(
                    QAItem.agent_id == agent_id, QAItem.question == question
                )
            )
            existing_qa = existing.scalar_one_or_none()
            if existing_qa:
                if request.overwrite:
                    existing_qa.answer = answer
                    imported += 1
                else:
                    failed += 1
                    continue
            else:
                # 检查配额（使用锁定的quota值）
                if quota.used_qa_items >= quota.max_qa_items:
                    errors.append("Q&A quota exceeded")
                    break

                # 创建新Q&A
                qa = QAItem(
                    agent_id=agent_id,
                    question=question,
                    answer=answer,
                )
                db.add(qa)

                # 立即更新配额计数
                quota.used_qa_items += 1
                imported += 1

        except Exception as e:
            errors.append(str(e))
            failed += 1

    await db.commit()

    # Invalidate QA cache for this agent
    try:
        from services.redis_service import get_redis
        redis = await get_redis()
        await redis.delete_cache(f"qa_items:{agent_id}")
    except Exception:
        pass

    # 注意：不再自动增量更新索引，由用户手动点击"重新训练智能体"

    return QABatchImportResponse(
        imported=imported,
        failed=failed,
        errors=errors[:10],  # 最多返回10个错误
    )


@router.get("/qa:list", response_model=QAListResponse)
async def list_qa(
    agent_id: str,
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """
    列出Q&A

    根据PRD第8.4节规范
    """
    # 获取Agent
    agent_result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = agent_result.scalar_one_or_none()

    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent {agent_id} not found"
        )

    # 获取配额
    quota_result = await db.execute(
        select(WorkspaceQuota).where(WorkspaceQuota.workspace_id == agent.workspace_id)
    )
    quota = quota_result.scalar_one_or_none()

    # 查询Q&A列表
    result = await db.execute(
        select(QAItem)
        .where(QAItem.agent_id == agent_id)
        .order_by(QAItem.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    items = result.scalars().all()

    # 获取总数
    count_result = await db.execute(
        select(func.count(QAItem.id)).where(QAItem.agent_id == agent_id)
    )
    total = count_result.scalar() or 0

    from api.v1.schemas import QAItem as QASchema

    return QAListResponse(
        items=[QASchema.model_validate(q) for q in items],
        total=total,
        quota={
            "used": quota.used_qa_items if quota else 0,
            "max": quota.max_qa_items if quota else 500,
        },
    )


@router.put("/qa:update")
async def update_qa(
    qa_id: str,
    request: QAUpdateRequest,
    db: AsyncSession = Depends(get_db),
):
    """更新Q&A"""
    result = await db.execute(select(QAItem).where(QAItem.id == qa_id))
    qa = result.scalar_one_or_none()

    if not qa:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Q&A {qa_id} not found"
        )

    # 更新字段
    update_data = request.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(qa, field, value)

    await db.commit()

    # Invalidate QA cache for this agent
    try:
        from services.redis_service import get_redis
        redis = await get_redis()
        await redis.delete_cache(f"qa_items:{qa.agent_id}")
    except Exception:
        pass

    return {"message": "Q&A updated successfully"}


@router.delete("/qa:delete")
async def delete_qa(
    qa_id: str,
    db: AsyncSession = Depends(get_db),
):
    """删除Q&A"""
    result = await db.execute(select(QAItem).where(QAItem.id == qa_id))
    qa = result.scalar_one_or_none()

    if not qa:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Q&A {qa_id} not found"
        )

    # 获取Agent
    agent_result = await db.execute(select(Agent).where(Agent.id == qa.agent_id))
    agent = agent_result.scalar_one_or_none()

    # 保存 agent_id 用于后续删除向量
    agent_id_for_vectors = qa.agent_id

    # 删除
    await db.delete(qa)

    # 更新配额
    if agent:
        quota_result = await db.execute(
            select(WorkspaceQuota).where(
                WorkspaceQuota.workspace_id == agent.workspace_id
            )
        )
        quota = quota_result.scalar_one_or_none()
        if quota:
            quota.used_qa_items = max(0, quota.used_qa_items - 1)

    await db.commit()

    # Invalidate QA cache for this agent
    try:
        from services.redis_service import get_redis
        redis = await get_redis()
        await redis.delete_cache(f"qa_items:{agent_id_for_vectors}")
    except Exception:
        pass

    # 同步删除 Qdrant 向量索引中的数据
    try:
        if agent and agent.jina_api_key:
            qdrant_store = QdrantVectorStore(
                jina_api_key=agent.jina_api_key,
                embedding_model=agent.embedding_model,
            )
            qdrant_store.delete_by_source(agent_id_for_vectors, "qa", qa_id)
    except Exception as e:
        logger.warning(f"Failed to delete vectors for QA {qa_id}: {e}")

    return {"message": "Q&A deleted successfully"}


@router.delete("/urls:clear_all")
async def clear_all_urls(
    agent_id: str,
    db: AsyncSession = Depends(get_db),
):
    """
    清空所有URL
    """
    # 获取Agent
    result = await db.execute(select(Agent).where(Agent.id == agent_id))
    agent = result.scalar_one_or_none()

    if not agent:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Agent {agent_id} not found"
        )

    # 获取所有URL
    result = await db.execute(
        select(URLSource).where(URLSource.agent_id == agent_id)
    )
    url_sources = result.scalars().all()

    deleted_count = len(url_sources)

    # 删除所有URL记录
    for url_source in url_sources:
        await db.delete(url_source)

    # 更新配额
    quota_result = await db.execute(
        select(WorkspaceQuota).where(
            WorkspaceQuota.workspace_id == agent.workspace_id
        )
    )
    quota = quota_result.scalar_one_or_none()
    if quota:
        quota.used_urls = 0

    await db.commit()

    # 同步清空 Qdrant 向量索引
    try:
        if agent.jina_api_key:
            qdrant_store = QdrantVectorStore(
                jina_api_key=agent.jina_api_key,
                embedding_model=agent.embedding_model,
            )
            qdrant_store.delete_collection(agent_id)
    except Exception as e:
        logger.warning(f"Failed to delete collection for agent {agent_id}: {e}")

    return {
        "message": f"Successfully cleared {deleted_count} URLs",
        "deleted_count": deleted_count
    }
