"""URL knowledge source service (extracted from endpoints.py per AGENTS.md).

Everything in this module is keyed by ``kb_id``: a URL source belongs to a
knowledge base, and a KB exists with or without an agent bound to it. Agents are
only *provenance* here (``source_agent_id`` on the derived ``KbDocument``), never
the scoping key.
"""

import asyncio
import logging
from typing import Dict, Any, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from sqlalchemy.exc import IntegrityError
from models import URLSource, normalize_url
from api.v1.schemas import URLCreateRequest, URLItem, URLListResponse
import database

logger = logging.getLogger(__name__)

async def list_urls(
    db: AsyncSession, kb_id: str, skip: int = 0, limit: int = 100
) -> URLListResponse:
    stmt = (
        select(URLSource)
        .where(URLSource.kb_id == kb_id)
        .order_by(URLSource.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(stmt)
    url_sources = result.scalars().all()

    total = (
        await db.execute(
            select(func.count(URLSource.id)).where(URLSource.kb_id == kb_id)
        )
    ).scalar() or 0

    quota: dict[str, int] = {
        "used": total,
        "max": 500,
    }  # TODO: pull from WorkspaceQuota
    items = [URLItem.model_validate(u) for u in url_sources]
    return URLListResponse(urls=items, total=total, quota=quota)

async def create_urls(
    db: AsyncSession, kb_id: str, payload: URLCreateRequest
) -> URLListResponse:
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
        us = URLSource(
            kb_id=kb_id, url=url_str, normalized_url=normalized, status="pending"
        )
        db.add(us)
    await db.commit()
    return await list_urls(db, kb_id, 0, 100)

async def delete_url(db: AsyncSession, kb_id: str, url_id: int) -> dict[str, bool]:
    us = await db.get(URLSource, url_id)
    if us is None or us.kb_id != kb_id:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="URL not found")
    await db.delete(us)
    await db.commit()
    return {"success": True}

async def clear_all_urls(db: AsyncSession, kb_id: str) -> dict[str, bool]:
    await db.execute(delete(URLSource).where(URLSource.kb_id == kb_id))
    await db.commit()
    return {"success": True}

# ========== Diffed refetch helpers (#47) ==========

def url_document_filename(url_id: int) -> str:
    """The one name a URL-derived document ever gets for a given URL row."""
    return f"url_{url_id}.txt"

async def _url_document(session, kb_id: str, url_id: int):
    """Most recent document produced by this URL row (None when never indexed)."""
    from models import KbDocument

    return (
        await session.execute(
            select(KbDocument)
            .where(
                KbDocument.kb_id == kb_id,
                KbDocument.filename == url_document_filename(url_id),
            )
            .order_by(KbDocument.created_at.desc(), KbDocument.id.desc())
            .limit(1)
            .execution_options(populate_existing=True)
        )
    ).scalar_one_or_none()

async def _drop_stale_url_documents(
    session, kb_id: str, url_id: int, *, keep_doc_id: str
) -> int:
    """Delete every older document (chunks + vectors) for this URL row.

    A changed page "replaces its chunks" rather than accumulating a new copy on
    every refetch: without this, a daily refetch of a 300-page site left one
    full duplicate per page per day in the collection.
    """
    from models import KbChunk, KbDocument
    from services.qdrant_service import QdrantKbService

    stale = list(
        (
            await session.execute(
                select(KbDocument).where(
                    KbDocument.kb_id == kb_id,
                    KbDocument.filename == url_document_filename(url_id),
                    KbDocument.id != keep_doc_id,
                )
            )
        )
        .scalars()
        .all()
    )
    if not stale:
        return 0

    qdrant = QdrantKbService()
    for doc in stale:
        try:
            await qdrant.delete_points_by_doc_id(kb_id, str(doc.id))
        except Exception as exc:  # the row must still go; log, never raise
            logger.warning(
                "[URL Refetch] Could not delete vectors for stale doc %s: %s",
                doc.id,
                exc,
            )
        await session.execute(delete(KbChunk).where(KbChunk.doc_id == doc.id))
        await session.delete(doc)
    return len(stale)

# ========== Background Processing Functions ==========

async def process_url_refetch(
    *,
    kb_id: str,
    url_ids: Optional[List[int]],
    force: bool,
    job_id: str,
    source_agent_id: Optional[str] = None,
    release_lock: bool = True,
    parent_job_id: Optional[str] = None,
) -> None:
    """Background task: refetch URLs and index them into the KB.

    Args:
        kb_id: Knowledge base that owns the URL rows (and the task lock).
        url_ids: List of URL IDs to refetch, None/empty for all.
        force: Force refetch even if the content hash hasn't changed.
        job_id: Task ID for tracking/releasing the lock.
        source_agent_id: Optional provenance of the ingest, threaded to
            ``KbDocument.source_agent_id``. ``None`` for KB-page ingests that
            have no agent behind them.
        release_lock: Whether to release the task lock on completion. Set to
            False when called inline from another background task.
        parent_job_id: Parent job ID to check for cancellation when called
            from another background task (e.g., from ``process_site_crawl``).
    """
    from services.task_lock import task_lock
    from services.crawler import SiteCrawler
    from services.kb_document_processor import KbDocumentProcessor
    from services.url_safety import validate_url_safe

    logger.info(f"[URL Refetch] Starting job {job_id} for KB {kb_id}")

    def _is_cancelled() -> bool:
        """Check if either this job or parent job is cancelled."""
        if task_lock.is_cancelled(kb_id, job_id):
            return True
        if parent_job_id and task_lock.is_cancelled(kb_id, parent_job_id):
            return True
        return False

    try:
        # Check cancellation before starting
        if _is_cancelled():
            logger.info(f"[URL Refetch] Job {job_id} cancelled before starting")
            return

        async with database.AsyncSessionLocal() as session:
            from models import KnowledgeBase

            kb_result = await session.execute(
                select(KnowledgeBase).where(KnowledgeBase.id == kb_id)
            )
            kb = kb_result.scalar_one_or_none()
            if not kb:
                logger.error(f"[URL Refetch] KB {kb_id} not found")
                return

            workspace_id = int(kb.workspace_id)

            # Build query for URLs to process
            query = select(URLSource).where(
                URLSource.kb_id == kb_id,
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
                # Check cancellation at the start of each iteration
                if _is_cancelled():
                    logger.info(f"[URL Refetch] Job {job_id} cancelled, stopping")
                    return

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
                from datetime import datetime, timezone
                from models import KbDocument, compute_item_hash

                try:
                    # Written INSIDE the try on purpose: a failure here used to
                    # escape to the outer handler and leave the row stuck in
                    # "fetching" with last_error NULL, which neither the catch-all
                    # nor the recurring pass retries.
                    url_source.status = "fetching"
                    url_source.last_fetch_at = datetime.now(timezone.utc)
                    await session.commit()

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

                    # #47 diffed refetch: key on the *normalised* text that was
                    # actually indexed, not on the payload the fetcher returned.
                    # An unchanged page bumps `last_fetched_at` and nothing else —
                    # zero parse, zero chunk, zero embedding calls.
                    from models import compute_content_hash

                    content_hash = compute_content_hash(page_result.content or "")
                    item_hash = compute_item_hash(page_result.content or "")
                    previous_doc = await _url_document(session, kb_id, url_id)
                    unchanged = (
                        not force
                        and previous_doc is not None
                        and getattr(previous_doc, "status", None) == "ready"
                        and getattr(previous_doc, "item_hash", None) == item_hash
                    )
                    if unchanged:
                        logger.info(
                            f"[URL Refetch] Content unchanged for {url}, skipping embed"
                        )
                        url_source.status = "success"
                        url_source.last_fetch_at = datetime.now(timezone.utc)
                        url_source.is_indexed = True
                        url_source.last_error = None
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

                    # Check cancellation before indexing
                    if _is_cancelled():
                        logger.info(f"[URL Refetch] Job {job_id} cancelled before indexing {url}")
                        return

                    # Index to KB: Create a virtual document for the URL content
                    # This uses the existing document processing pipeline
                    doc = await processor.create_document_record(
                        workspace_id,
                        kb_id,
                        filename=url_document_filename(url_id),
                        file_size=len(page_result.content or ""),
                        source_agent_id=source_agent_id,
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
                    # Store URL metadata for retrieval display
                    object.__setattr__(doc, "metadata_json", {
                        "source_type": "url",
                        "source_url": url,
                        "source_title": page_result.title,
                    })
                    await session.commit()

                    # Stamp the diff key before indexing so a crash mid-embed
                    # cannot leave "text stored, hash NULL" and re-embed forever.
                    object.__setattr__(doc, "item_hash", item_hash)
                    await session.commit()

                    # Process the document (chunk, embed, upsert to Qdrant)
                    await processor.process_document(str(doc.id), kb_id)

                    # Critical: Commit/expire session to see changes from process_document's
                    # separate session. Without this, the re-query below returns stale data
                    # due to SQLAlchemy's identity map caching.
                    await session.commit()

                    # Re-fetch document to check actual processing status
                    # (process_document catches exceptions internally and sets status="error").
                    # `populate_existing` is REQUIRED: the session is built with
                    # expire_on_commit=False, so the identity map would otherwise hand back
                    # the row as it was BEFORE process_document's own session wrote to it —
                    # which read as status="pending" and left every URL is_indexed=False.
                    doc_result = await session.execute(
                        select(KbDocument)
                        .where(KbDocument.id == doc.id, KbDocument.kb_id == kb_id)
                        .execution_options(populate_existing=True)
                    )
                    updated_doc = doc_result.scalar_one_or_none()

                    # Only mark as indexed if document processing succeeded
                    if updated_doc and getattr(updated_doc, "status", None) == "ready":
                        url_source.is_indexed = True
                        # A changed page replaces its chunks: the old vector
                        # points are gone before the new ones land, so retrieval
                        # never mixes two versions of the same page.
                        await _drop_stale_url_documents(
                            session, kb_id, url_id, keep_doc_id=str(doc.id)
                        )
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

    except asyncio.CancelledError:
        logger.info(f"[URL Refetch] Job {job_id} was cancelled by asyncio")
        raise
    except Exception as e:
        logger.exception(f"[URL Refetch] Job {job_id} failed: {e}")
    finally:
        if release_lock:
            await task_lock.release_task(kb_id, job_id)

async def _store_crawl_error(
    session,
    kb_id: str,
    start_url: str,
    error_msg: str,
) -> None:
    """Store a crawl error as a URLSource record so the frontend can display it.

    Uses upsert semantics: if a URLSource with the same normalized URL already
    exists for this KB (e.g. from a previous failed crawl), update its error
    message. Otherwise create a new record.
    """
    import sqlalchemy as sa

    normalized = normalize_url(start_url)
    existing = (
        await session.execute(
            sa.select(URLSource).where(
                URLSource.kb_id == kb_id,
                URLSource.normalized_url == normalized,
            )
        )
    ).scalar_one_or_none()

    if existing:
        existing.status = "failed"
        existing.last_error = error_msg
    else:
        url_source = URLSource(
            kb_id=kb_id,
            url=start_url,
            normalized_url=normalized,
            status="failed",
            last_error=error_msg,
        )
        session.add(url_source)

async def process_site_crawl(
    kb_id: str,
    start_url: str,
    max_depth: int,
    max_pages: int,
    job_id: str,
    source_agent_id: Optional[str] = None,
):
    """Background task: crawl site and index pages into one KB.

    Args:
        kb_id: Knowledge base that owns the crawl (and the task lock).
        start_url: Starting URL for crawl.
        max_depth: Maximum crawl depth.
        max_pages: Maximum pages to crawl.
        job_id: Task ID for tracking.
        source_agent_id: Optional provenance threaded to the derived documents.
    """
    from services.task_lock import task_lock
    from services.crawler import SiteCrawler
    from services.url_safety import validate_url_safe

    logger.info(
        f"[Site Crawl] Starting job {job_id} for KB {kb_id}, url={start_url}"
    )

    try:
        # Check cancellation before starting
        if task_lock.is_cancelled(kb_id, job_id):
            logger.info(f"[Site Crawl] Job {job_id} cancelled before starting")
            return

        # Validate start URL
        safe, reason = validate_url_safe(start_url)
        if not safe:
            logger.error(f"[Site Crawl] Unsafe start URL: {start_url} - {reason}")
            async with database.AsyncSessionLocal() as session:
                await _store_crawl_error(
                    session, kb_id, start_url,
                    f"URL safety check failed: {reason}",
                )
                await session.commit()
            return

        # Check cancellation before crawling
        if task_lock.is_cancelled(kb_id, job_id):
            logger.info(f"[Site Crawl] Job {job_id} cancelled before crawling")
            return

        crawler = SiteCrawler()
        results = await crawler.crawl_site(
            start_url,
            max_depth=max_depth,
            max_pages=max_pages,
            should_cancel=lambda: task_lock.is_cancelled(kb_id, job_id),
        )

        # Check cancellation after crawling
        if task_lock.is_cancelled(kb_id, job_id):
            logger.info(f"[Site Crawl] Job {job_id} cancelled after crawling")
            return

        logger.info(f"[Site Crawl] Discovered {len(results)} pages from {start_url}")

        # Filter to pages with actual content
        valid_pages = [p for p in results if not p.error and p.url]

        # Deduplicate by normalized URL to prevent UNIQUE constraint violations.
        # Required because autoflush=False means pending inserts aren't visible
        # to SELECTs, so check-then-insert fails for within-batch duplicates.
        seen_norms: set[str] = set()
        deduped_pages = []
        for page in valid_pages:
            norm = normalize_url(page.url)
            if norm not in seen_norms:
                seen_norms.add(norm)
                deduped_pages.append(page)
        valid_pages = deduped_pages

        # Create URLSource records for discovered pages
        async with database.AsyncSessionLocal() as session:
            created_count = 0
            for page in valid_pages:
                # Check cancellation during URL record creation
                if task_lock.is_cancelled(kb_id, job_id):
                    logger.info(f"[Site Crawl] Job {job_id} cancelled during URL creation")
                    # Commit any records created so far
                    try:
                        await session.commit()
                    except IntegrityError:
                        await session.rollback()
                    return

                normalized = normalize_url(page.url)
                exists = await session.scalar(
                    select(URLSource).where(
                        URLSource.kb_id == kb_id,
                        URLSource.normalized_url == normalized,
                    )
                )
                if exists:
                    continue

                url_source = URLSource(
                    kb_id=kb_id,
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
                await _store_crawl_error(session, kb_id, start_url, error_msg)

            # Commit with IntegrityError safety net (defensive against race conditions)
            try:
                await session.commit()
            except IntegrityError as e:
                await session.rollback()
                logger.warning(
                    f"[Site Crawl] IntegrityError during commit "
                    f"(duplicate URLs detected, non-fatal): {e}"
                )
                # Duplicates are skipped — the crawl is still successful
            logger.info(f"[Site Crawl] Created {created_count} URL records")

        # Check cancellation before indexing
        if task_lock.is_cancelled(kb_id, job_id):
            logger.info(f"[Site Crawl] Job {job_id} cancelled before indexing")
            return

        # Trigger refetch to index all discovered URLs (only if we found pages)
        if valid_pages:
            await process_url_refetch(
                kb_id=kb_id,
                url_ids=None,
                force=False,
                job_id=f"{job_id}_refetch",
                source_agent_id=source_agent_id,
                release_lock=False,
                parent_job_id=job_id,
            )

        logger.info(f"[Site Crawl] Job {job_id} completed")

    except asyncio.CancelledError:
        logger.info(f"[Site Crawl] Job {job_id} was cancelled by asyncio")
        raise
    except Exception as e:
        logger.exception(f"[Site Crawl] Job {job_id} failed: {e}")
        try:
            async with database.AsyncSessionLocal() as session:
                await _store_crawl_error(
                    session, kb_id, start_url,
                    f"Site crawl failed: {str(e)[:500]}",
                )
                await session.commit()
        except Exception:
            logger.exception(f"[Site Crawl] Failed to store error for job {job_id}")
    finally:
        await task_lock.release_task(kb_id, job_id)

async def process_index_rebuild(
    kb_id: str,
    force: bool,
    job_id: str,
    source_agent_id: Optional[str] = None,
):
    """Background task: rebuild the index of one KB.

    Args:
        kb_id: Knowledge base to rebuild.
        force: Force rebuild (clear existing index).
        job_id: Task ID for tracking.
        source_agent_id: Optional provenance threaded to the derived documents.
    """
    from services.task_lock import task_lock
    from services.qdrant_service import QdrantKbService, get_embedding_dimension

    logger.info(f"[Index Rebuild] Starting job {job_id} for KB {kb_id}")

    try:
        async with database.AsyncSessionLocal() as session:
            from models import KnowledgeBase

            kb_row = (
                await session.execute(
                    select(KnowledgeBase).where(KnowledgeBase.id == kb_id)
                )
            ).scalar_one_or_none()
            if kb_row is None:
                logger.error(f"[Index Rebuild] KB {kb_id} not found")
                return

            # If force=True, clear existing Qdrant data
            if force:
                logger.info(f"[Index Rebuild] Clearing existing index for KB {kb_id}")
                dimension = (
                    int(kb_row.embedding_dimension)
                    if getattr(kb_row, "embedding_dimension", None)
                    else get_embedding_dimension(
                        str(getattr(kb_row, "embedding_model", "") or "")
                    )
                )
                qdrant = QdrantKbService()
                await qdrant.delete_collection(kb_id)
                await qdrant.ensure_collection(kb_id, dimension)

                # Reset is_indexed flag for all URLs
                result = await session.execute(
                    select(URLSource).where(URLSource.kb_id == kb_id)
                )
                for url_source in result.scalars():
                    url_source.is_indexed = False
                await session.commit()

        # Trigger refetch to reindex all URLs
        await process_url_refetch(
            kb_id=kb_id,
            url_ids=None,
            force=True,
            job_id=f"{job_id}_refetch",
            source_agent_id=source_agent_id,
            release_lock=False,
        )

        logger.info(f"[Index Rebuild] Job {job_id} completed")

    except Exception as e:
        logger.exception(f"[Index Rebuild] Job {job_id} failed: {e}")
    finally:
        await task_lock.release_task(kb_id, job_id)

async def repair_url_indexed_status(kb_id: str) -> dict:
    """Repair is_indexed status for URLs by checking the matching KbDocument.

    This fixes the issue where URLs have status="success" but is_indexed=False
    due to a session isolation bug in process_url_refetch.

    For each URL with status="success" and is_indexed=False, it finds the
    corresponding KbDocument (filename=url_{url_id}.txt in the same KB) and sets
    is_indexed=True if the document status is "ready".

    Args:
        kb_id: The knowledge base whose URL rows are repaired

    Returns:
        Dict with repair stats: {"fixed": int, "already_correct": int, "errors": int}
    """
    from models import KbDocument

    async with database.AsyncSessionLocal() as session:
        # Get all URLs for this KB with status="success" but is_indexed=False
        stmt = select(URLSource).where(
            URLSource.kb_id == kb_id,
            URLSource.status == "success",
            URLSource.is_indexed == False,
        )
        result = await session.execute(stmt)
        urls_to_fix = result.scalars().all()

        fixed = 0
        errors = 0
        already_correct = 0

        for url_source in urls_to_fix:
            try:
                # Find the corresponding KbDocument (filename=url_{url_id}.txt)
                doc_filename = f"url_{url_source.id}.txt"
                doc_stmt = select(KbDocument).where(
                    KbDocument.filename == doc_filename,
                    KbDocument.kb_id == kb_id,
                )
                doc_result = await session.execute(doc_stmt)
                doc = doc_result.scalar_one_or_none()

                if doc and getattr(doc, "status", None) == "ready":
                    url_source.is_indexed = True
                    fixed += 1
                    logger.info(f"[Repair] Fixed URL {url_source.id} is_indexed=True")
                elif doc and getattr(doc, "status", None) == "error":
                    # Document processing failed, keep is_indexed=False
                    errors += 1
                    logger.warning(
                        f"[Repair] URL {url_source.id} has doc with error status, "
                        f"keeping is_indexed=False"
                    )
                elif not doc:
                    # No document found - this shouldn't happen for success URLs
                    errors += 1
                    logger.warning(
                        f"[Repair] No KbDocument found for URL {url_source.id} "
                        f"(filename={doc_filename})"
                    )
                else:
                    # Document exists but not ready yet (processing)
                    logger.info(
                        f"[Repair] URL {url_source.id} has doc status={doc.status}, "
                        f"keeping is_indexed=False"
                    )

            except Exception as e:
                errors += 1
                logger.exception(f"[Repair] Error fixing URL {url_source.id}: {e}")

        await session.commit()

        # Also check URLs that are already correctly marked as indexed
        correct_stmt = select(URLSource).where(
            URLSource.kb_id == kb_id,
            URLSource.status == "success",
            URLSource.is_indexed == True,
        )
        correct_result = await session.execute(correct_stmt)
        already_correct = len(list(correct_result.scalars().all()))

        logger.info(
            f"[Repair] KB {kb_id}: fixed={fixed}, already_correct={already_correct}, "
            f"errors={errors}"
        )

        return {
            "fixed": fixed,
            "already_correct": already_correct,
            "errors": errors,
        }
