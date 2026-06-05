"""URL knowledge source service (extracted from endpoints.py per AGENTS.md)."""

import logging
from typing import Dict, Any, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from models import URLSource, normalize_url, Agent
from api.v1.schemas import URLCreateRequest, URLItem, URLListResponse
from database import AsyncSessionLocal

logger = logging.getLogger(__name__)


async def list_urls(
    db: AsyncSession, agent_id: str, skip: int = 0, limit: int = 100
) -> URLListResponse:
    stmt = (
        select(URLSource)
        .where(URLSource.agent_id == agent_id)
        .order_by(URLSource.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(stmt)
    url_sources = result.scalars().all()

    total = (
        await db.execute(
            select(func.count(URLSource.id)).where(URLSource.agent_id == agent_id)
        )
    ).scalar() or 0

    quota: dict[str, int] = {
        "used": total,
        "max": 500,
    }  # TODO: pull from WorkspaceQuota
    items = [URLItem.model_validate(u) for u in url_sources]
    return URLListResponse(urls=items, total=total, quota=quota)


async def create_urls(
    db: AsyncSession, agent_id: str, payload: URLCreateRequest
) -> URLListResponse:
    for url_str in payload.urls:
        normalized = normalize_url(url_str)
        exists = (
            await db.execute(
                select(URLSource).where(
                    URLSource.agent_id == agent_id,
                    URLSource.normalized_url == normalized,
                )
            )
        ).scalar_one_or_none()
        if exists:
            continue
        us = URLSource(
            agent_id=agent_id, url=url_str, normalized_url=normalized, status="pending"
        )
        db.add(us)
    await db.commit()
    return await list_urls(db, agent_id, 0, 100)


async def delete_url(db: AsyncSession, agent_id: str, url_id: int) -> dict[str, bool]:
    us = await db.get(URLSource, url_id)
    if us is None or us.agent_id != agent_id:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="URL not found")
    await db.delete(us)
    await db.commit()
    return {"success": True}


async def clear_all_urls(db: AsyncSession, agent_id: str) -> dict[str, bool]:
    await db.execute(delete(URLSource).where(URLSource.agent_id == agent_id))
    await db.commit()
    return {"success": True}


# ========== Background Processing Functions ==========


async def process_url_refetch(
    agent_id: str,
    url_ids: Optional[List[int]],
    force: bool,
    job_id: str,
):
    """Background task: refetch URLs and index to KB.

    Args:
        agent_id: Agent ID
        url_ids: List of URL IDs to refetch, None for all
        force: Force refetch even if content hasn't changed
        job_id: Task ID for tracking
    """
    from services.task_lock import TaskType, task_lock
    from services.crawler import SiteCrawler
    from services.kb_service import KbService
    from services.kb_document_processor import KbDocumentProcessor
    from services.url_safety import validate_url_safe

    logger.info(f"[URL Refetch] Starting job {job_id} for agent {agent_id}")

    try:
        async with AsyncSessionLocal() as session:
            # Get agent and KB
            result = await session.execute(select(Agent).where(Agent.id == agent_id))
            agent = result.scalar_one_or_none()
            if not agent:
                logger.error(f"[URL Refetch] Agent {agent_id} not found")
                return

            if not agent.kb_id:
                logger.error(f"[URL Refetch] Agent {agent_id} has no KB bound")
                return

            kb_id = agent.kb_id
            tenant_id = None

            # Get tenant from KB
            from models import KnowledgeBase

            kb_result = await session.execute(
                select(KnowledgeBase).where(KnowledgeBase.id == kb_id)
            )
            kb = kb_result.scalar_one_or_none()
            if kb:
                tenant_id = kb.tenant_id

            if not tenant_id:
                logger.error(f"[URL Refetch] Could not determine tenant for KB {kb_id}")
                return

            # Build query for URLs to process
            query = select(URLSource).where(
                URLSource.agent_id == agent_id,
                URLSource.status.in_(["pending", "success", "failed"]),
            )
            if url_ids:
                query = query.where(URLSource.id.in_(url_ids))

            result = await session.execute(query)
            urls_to_process = result.scalars().all()

            logger.info(f"[URL Refetch] Processing {len(urls_to_process)} URLs")

            crawler = SiteCrawler()
            processor = KbDocumentProcessor()

            for url_source in urls_to_process:
                url = url_source.url
                url_id = url_source.id

                # Validate URL safety
                safe, reason = validate_url_safe(url)
                if not safe:
                    logger.warning(
                        f"[URL Refetch] Unsafe URL skipped: {url} - {reason}"
                    )
                    url_source.status = "failed"
                    url_source.last_error = f"URL safety check failed: {reason}"
                    await session.commit()
                    continue

                # Update status to fetching
                url_source.status = "fetching"
                from datetime import datetime, timezone

                url_source.last_fetch_at = datetime.now(timezone.utc)
                await session.commit()

                try:
                    # Fetch URL content
                    page_result = await crawler.crawl_single_page(url)

                    if page_result.error:
                        logger.warning(
                            f"[URL Refetch] Failed to fetch {url}: {page_result.error}"
                        )
                        url_source.status = "failed"
                        url_source.last_error = page_result.error
                        url_source.is_indexed = False
                        await session.commit()
                        continue

                    # Check content hash for duplicates (unless force=True)
                    from models import compute_content_hash

                    content_hash = compute_content_hash(page_result.content or "")
                    if not force and url_source.content_hash == content_hash:
                        logger.info(
                            f"[URL Refetch] Content unchanged for {url}, skipping"
                        )
                        url_source.status = "success"
                        url_source.last_fetch_at = datetime.now(timezone.utc)
                        await session.commit()
                        continue

                    # Update URL source with fetched content
                    url_source.title = page_result.title
                    url_source.content = page_result.content
                    url_source.content_hash = content_hash
                    url_source.status = "success"
                    url_source.fetch_metadata = {
                        "status_code": (page_result.metadata or {}).get("status_code"),
                        "final_url": page_result.url,
                    }
                    await session.commit()

                    # Index to KB: Create a virtual document for the URL content
                    # This uses the existing document processing pipeline
                    doc = await processor.create_document_record(
                        tenant_id=tenant_id,
                        kb_id=kb_id,
                        filename=f"url_{url_id}.txt",
                        file_size=len(page_result.content or ""),
                        db=session,
                    )
                    # Store content as a file for processing
                    doc_content = page_result.content or ""
                    doc_content_bytes = doc_content.encode("utf-8")
                    storage_path = processor.save_uploaded_file(
                        doc, doc_content_bytes, ".txt"
                    )
                    object.__setattr__(doc, "storage_path", storage_path)
                    object.__setattr__(doc, "file_type", "txt")
                    await session.commit()

                    # Process the document (chunk, embed, upsert to Qdrant)
                    await processor.process_document(str(doc.id), tenant_id, kb_id)

                    # Re-fetch document to check actual processing status
                    # (process_document catches exceptions internally and sets status="error")
                    from models import KbDocument

                    doc_result = await session.execute(
                        select(KbDocument).where(
                            KbDocument.id == doc.id, KbDocument.tenant_id == tenant_id
                        )
                    )
                    updated_doc = doc_result.scalar_one_or_none()

                    # Only mark as indexed if document processing succeeded
                    if updated_doc and getattr(updated_doc, "status", None) == "ready":
                        url_source.is_indexed = True
                    else:
                        url_source.is_indexed = False
                        logger.warning(
                            f"[URL Refetch] Document processing did not complete successfully "
                            f"for {url}, doc_status={getattr(updated_doc, 'status', 'N/A') if updated_doc else 'not_found'}"
                        )
                    await session.commit()

                    logger.info(f"[URL Refetch] Indexed URL {url} with doc {doc.id}")

                except Exception as e:
                    logger.exception(f"[URL Refetch] Error processing {url}: {e}")
                    url_source.status = "failed"
                    url_source.last_error = str(e)[:500]
                    url_source.is_indexed = False
                    await session.commit()

            logger.info(f"[URL Refetch] Job {job_id} completed")

    except Exception as e:
        logger.exception(f"[URL Refetch] Job {job_id} failed: {e}")
    finally:
        await task_lock.release_task(agent_id, job_id)


async def _store_crawl_error(
    session,
    agent_id: str,
    start_url: str,
    error_msg: str,
) -> None:
    """Store a crawl error as a URLSource record so the frontend can display it.

    Uses upsert semantics: if a URLSource with the same normalized URL already
    exists for this agent (e.g. from a previous failed crawl), update its error
    message. Otherwise create a new record.
    """
    import sqlalchemy as sa

    normalized = normalize_url(start_url)
    existing = (await session.execute(
        sa.select(URLSource).where(
            URLSource.agent_id == agent_id,
            URLSource.normalized_url == normalized,
        )
    )).scalar_one_or_none()

    if existing:
        existing.status = "failed"
        existing.last_error = error_msg
    else:
        url_source = URLSource(
            agent_id=agent_id,
            url=start_url,
            normalized_url=normalized,
            status="failed",
            last_error=error_msg,
        )
        session.add(url_source)


async def process_site_crawl(
    agent_id: str,
    start_url: str,
    max_depth: int,
    max_pages: int,
    job_id: str,
):
    """Background task: crawl site and index pages.

    Args:
        agent_id: Agent ID
        start_url: Starting URL for crawl
        max_depth: Maximum crawl depth
        max_pages: Maximum pages to crawl
        job_id: Task ID for tracking
    """
    from services.task_lock import TaskType, task_lock
    from services.crawler import SiteCrawler
    from services.url_safety import validate_url_safe

    logger.info(
        f"[Site Crawl] Starting job {job_id} for agent {agent_id}, url={start_url}"
    )

    try:
        # Validate start URL
        safe, reason = validate_url_safe(start_url)
        if not safe:
            logger.error(f"[Site Crawl] Unsafe start URL: {start_url} - {reason}")
            async with AsyncSessionLocal() as session:
                await _store_crawl_error(
                    session, agent_id, start_url,
                    f"URL safety check failed: {reason}",
                )
                await session.commit()
            return

        crawler = SiteCrawler()
        results = await crawler.crawl_site(
            start_url, max_depth=max_depth, max_pages=max_pages
        )

        logger.info(f"[Site Crawl] Discovered {len(results)} pages from {start_url}")

        # Filter to pages with actual content
        valid_pages = [p for p in results if not p.error and p.url]

        # Create URLSource records for discovered pages
        async with AsyncSessionLocal() as session:
            created_count = 0
            for page in valid_pages:
                normalized = normalize_url(page.url)
                exists = await session.scalar(
                    select(URLSource).where(
                        URLSource.agent_id == agent_id,
                        URLSource.normalized_url == normalized,
                    )
                )
                if exists:
                    continue

                url_source = URLSource(
                    agent_id=agent_id,
                    url=page.url,
                    normalized_url=normalized,
                    status="pending",
                    title=page.title,
                )
                session.add(url_source)
                created_count += 1

            # If no pages were discovered, store an error so the frontend can display it
            if created_count == 0:
                error_msg = (
                    f"No pages discovered from {start_url}. "
                    f"Crawl returned {len(results)} results "
                    f"({len(valid_pages)} valid). "
                    f"The site may have no sub-links or the start page may be unreachable."
                )
                await _store_crawl_error(session, agent_id, start_url, error_msg)

            await session.commit()
            logger.info(f"[Site Crawl] Created {created_count} URL records")

        # Trigger refetch to index all discovered URLs (only if we found pages)
        if valid_pages:
            await process_url_refetch(agent_id, None, False, f"{job_id}_refetch")

        logger.info(f"[Site Crawl] Job {job_id} completed")

    except Exception as e:
        logger.exception(f"[Site Crawl] Job {job_id} failed: {e}")
        try:
            async with AsyncSessionLocal() as session:
                await _store_crawl_error(
                    session, agent_id, start_url,
                    f"Site crawl failed: {str(e)[:500]}",
                )
                await session.commit()
        except Exception:
            logger.exception(f"[Site Crawl] Failed to store error for job {job_id}")
    finally:
        await task_lock.release_task(agent_id, job_id)


async def process_index_rebuild(
    agent_id: str,
    force: bool,
    job_id: str,
):
    """Background task: rebuild index for all URLs.

    Args:
        agent_id: Agent ID
        force: Force rebuild (clear existing index)
        job_id: Task ID for tracking
    """
    from services.task_lock import TaskType, task_lock
    from services.qdrant_service import QdrantKbService

    logger.info(f"[Index Rebuild] Starting job {job_id} for agent {agent_id}")

    try:
        async with AsyncSessionLocal() as session:
            # Get agent and KB
            result = await session.execute(select(Agent).where(Agent.id == agent_id))
            agent = result.scalar_one_or_none()
            if not agent or not agent.kb_id:
                logger.error(f"[Index Rebuild] Agent {agent_id} has no KB")
                return

            kb_id = agent.kb_id

            # If force=True, clear existing Qdrant data
            if force:
                logger.info(f"[Index Rebuild] Clearing existing index for KB {kb_id}")
                qdrant = QdrantKbService()
                await qdrant.delete_collection(kb_id)
                await qdrant.ensure_collection(
                    kb_id, agent.embedding_model or "BAAI/bge-m3"
                )

                # Reset is_indexed flag for all URLs
                result = await session.execute(
                    select(URLSource).where(URLSource.agent_id == agent_id)
                )
                for url_source in result.scalars():
                    url_source.is_indexed = False
                await session.commit()

        # Trigger refetch to reindex all URLs
        await process_url_refetch(agent_id, None, True, f"{job_id}_refetch")

        logger.info(f"[Index Rebuild] Job {job_id} completed")

    except Exception as e:
        logger.exception(f"[Index Rebuild] Job {job_id} failed: {e}")
    finally:
        await task_lock.release_task(agent_id, job_id)
