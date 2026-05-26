"""URL管理API v1"""

from fastapi import APIRouter, HTTPException, status, BackgroundTasks, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from typing import List
import logging
import asyncio

import database
from database import get_db
from api.endpoints.auth import require_admin_or_super_admin
from models import (
    Agent,
    URLSource,
    WorkspaceQuota,
)
from api.v1.schemas import (
    URLCreateRequest,
    URLListResponse,
    URLRefetchRequest,
    URLRefetchResponse,
    SiteCrawlRequest,
    SiteCrawlResponse,
)
from services import URLNormalizer, SiteCrawler, TaskType, task_lock
from services.r2r_client import R2RClient
from services.scraper import URLScraper

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_admin_or_super_admin)])


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

            agent_scraper = URLScraper()
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

                    # Auto-ingest into R2R so content is immediately searchable
                    try:
                        r2r = R2RClient()
                        # Unassign previous R2R document before re-ingesting changed content
                        if url_source.r2r_document_id:
                            unassigned = await r2r.unassign_document(agent_id, url_source.r2r_document_id)
                            if not unassigned:
                                raise RuntimeError(
                                    f"Failed to unassign old R2R document {url_source.r2r_document_id} "
                                    f"for URL {url_source.url}; cannot re-ingest without removing stale content"
                                )
                            url_source.r2r_document_id = None
                            url_source.is_indexed = False
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
                        await db.commit()
                        logger.info(f"R2R ingest OK for URL {url_source.url} (doc_id={r2r_doc_id})")
                    except Exception as e:
                        url_source.is_indexed = False
                        await db.commit()
                        logger.warning(f"R2R ingest failed for URL {url_source.url}: {type(e).__name__}: {e}")
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

    # Unassign R2R document from agent collection; do NOT delete globally (doc may be shared)
    if url_source.r2r_document_id:
        r2r = R2RClient()
        try:
            await r2r.unassign_document(agent_id, url_source.r2r_document_id)
        except Exception as e:
            logger.warning(f"Failed to unassign R2R doc {url_source.r2r_document_id}: {e}")
    else:
        # Best-effort cleanup for pre-migration URLs that lack r2r_document_id
        try:
            r2r = R2RClient()
            all_docs = await r2r.list_documents(agent_id)
            for doc in all_docs:
                meta = (doc.get("metadata") or {})
                if meta.get("source_type") == "url" and meta.get("url_source_id") == url_id:
                    doc_id = doc.get("id", doc.get("document_id", ""))
                    if doc_id:
                        await r2r.unassign_document(agent_id, str(doc_id))
        except Exception as e:
            logger.warning(f"Best-effort R2R doc cleanup failed for URL {url_id}: {e}")

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

    # Acquire quota lock upfront
    quota_result = await db.execute(
        select(WorkspaceQuota)
        .where(WorkspaceQuota.workspace_id == agent.workspace_id)
        .with_for_update()
    )
    quota = quota_result.scalar_one_or_none()

    agent_scraper = URLScraper()
    discovered_urls = await agent_scraper.discover_subpages(
        url, max_depth=max_depth, max_pages=max_pages
    )

    # Deduplicate and filter out already-existing URLs in one pass
    normalized_candidates = []
    for discovered_url, _depth in discovered_urls:
        normalized = URLNormalizer.normalize(discovered_url)
        normalized_candidates.append((discovered_url, normalized))

    existing_normalized = {
        row.normalized_url
        for row in (await db.execute(
            select(URLSource.normalized_url).where(URLSource.agent_id == agent_id)
        )).scalars().all()
    }

    to_insert = [
        (url, norm) for url, norm in normalized_candidates
        if norm not in existing_normalized
    ]

    # Apply quota cap
    if quota:
        remaining = max(0, quota.max_urls - quota.used_urls)
        to_insert = to_insert[:remaining]

    # Insert only new rows
    created_urls = []
    for discovered_url, normalized in to_insert:
        url_source = URLSource(
            agent_id=agent_id,
            url=discovered_url,
            normalized_url=normalized,
            status="pending",
        )
        db.add(url_source)
        created_urls.append(url_source)

    if quota:
        quota.used_urls += len(created_urls)

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
            workspace_id = agent.workspace_id

        logger.info(f"[site_crawl_task] Initializing SiteCrawler...")
        crawler = SiteCrawler()
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
                    select(WorkspaceQuota)
                    .where(WorkspaceQuota.workspace_id == workspace_id)
                    .with_for_update()
                )
                quota = quota_result.scalar_one_or_none()
                logger.info(f"[site_crawl_task] Quota: {quota.used_urls if quota else 'N/A'}/{quota.max_urls if quota else 'N/A'}")

                # Collect candidates, deduplicate by normalized URL
                seen_normalized_urls = set()
                candidates = []
                for page_result in results:
                    if not page_result.success:
                        continue
                    normalized = URLNormalizer.normalize(page_result.url)
                    if normalized in seen_normalized_urls:
                        continue
                    seen_normalized_urls.add(normalized)
                    candidates.append((page_result, normalized))

                # Fetch already-existing URLs in one query
                existing_normalized = set(
                    (await db.execute(
                        select(URLSource.normalized_url).where(URLSource.agent_id == agent_id)
                    )).scalars().all()
                )

                to_insert = [
                    (pr, norm) for pr, norm in candidates
                    if norm not in existing_normalized
                ]

                # Apply quota cap
                if quota:
                    remaining = max(0, quota.max_urls - quota.used_urls)
                    to_insert = to_insert[:remaining]

                # Insert only new rows
                inserted_sources = []
                for page_result, normalized in to_insert:
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
                    inserted_sources.append(url_source)

                if quota:
                    quota.used_urls += len(to_insert)

                await db.commit()
                logger.info(f"Site crawl completed for {url}: {len(to_insert)} pages added")

                # Auto-ingest into R2R so crawled content is immediately searchable
                r2r = R2RClient()
                for src in inserted_sources:
                    if src.content:
                        try:
                            doc = await r2r.ingest_text(
                                agent_id=agent_id,
                                text=src.content,
                                title=src.title or src.url,
                                metadata={
                                    "url": src.url,
                                    "title": src.title,
                                    "source_type": "url",
                                    "url_source_id": src.id,
                                },
                            )
                            r2r_doc_id = doc.get("id", doc.get("document_id", ""))
                            if r2r_doc_id:
                                src.r2r_document_id = str(r2r_doc_id)
                            src.is_indexed = True
                        except Exception as e:
                            src.is_indexed = False
                            logger.warning(f"R2R ingest failed for crawled URL {src.url}: {type(e).__name__}: {e}")
                await db.commit()

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

    # Unassign R2R documents from agent collection (docs may be shared, never delete globally)
    r2r = R2RClient()
    for url_source in url_sources:
        if url_source.r2r_document_id:
            try:
                await r2r.unassign_document(agent_id, url_source.r2r_document_id)
            except Exception as e:
                logger.warning(f"Failed to unassign R2R doc {url_source.r2r_document_id}: {e}")
    # Best-effort cleanup of pre-migration URL docs without stored r2r_document_id
    try:
        all_docs = await r2r.list_documents(agent_id)
        for doc in all_docs:
            meta = (doc.get("metadata") or {})
            if meta.get("source_type") == "url":
                doc_id = doc.get("id", doc.get("document_id", ""))
                if doc_id:
                    await r2r.unassign_document(agent_id, str(doc_id))
    except Exception as e:
        logger.warning(f"Best-effort R2R URL doc cleanup failed: {e}")

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

    return {
        "message": f"Successfully cleared {deleted_count} URLs",
        "deleted_count": deleted_count
    }
