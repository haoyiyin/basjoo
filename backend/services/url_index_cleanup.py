import asyncio
import logging

from fastapi import HTTPException, status

from models import URLSource
from services.r2r_client import R2RClient
from services.task_lock import TaskType, task_lock

logger = logging.getLogger(__name__)


async def acquire_url_mutation_task(agent_id: str, task_id: str):
    success, error = await task_lock.acquire_task(agent_id, TaskType.URL_FETCH, task_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=error)


async def cancel_url_tasks_for_agent(agent_id: str):
    task_ids = set(task_lock.get_active_tasks(agent_id)) | task_lock.get_registered_task_ids(agent_id)
    if any(task_id.startswith("rebuild_") for task_id in task_ids):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Index rebuild is running; retry deletion after it completes",
        )

    await task_lock.cancel_tasks(
        agent_id,
        {TaskType.URL_CRAWL, TaskType.URL_FETCH, TaskType.URL_REFETCH},
    )
    for _ in range(20):
        task_ids = set(task_lock.get_active_tasks(agent_id)) | task_lock.get_registered_task_ids(agent_id)
        active_url_tasks = [
            task_id
            for task_id in task_ids
            if task_id.startswith(("crawl_", "fetch_", "refetch_"))
        ]
        if not active_url_tasks:
            return
        await asyncio.sleep(0.05)

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="URL tasks are still stopping; retry deletion shortly",
    )


async def unassign_indexed_url_document(r2r: R2RClient, agent_id: str, document_id: str):
    try:
        unassigned = await r2r.unassign_document(agent_id, document_id)
    except Exception as e:
        logger.warning(f"Failed to unassign R2R doc {document_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to remove URL from search index",
        ) from e

    if not unassigned:
        logger.warning(f"R2R unassign returned false for doc {document_id}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to remove URL from search index",
        )


async def list_agent_documents(r2r: R2RClient, agent_id: str) -> list[dict]:
    try:
        return await r2r.list_documents(agent_id)
    except Exception as e:
        logger.warning(f"Failed to list R2R docs for agent {agent_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to inspect URL search index",
        ) from e


async def cleanup_url_index_documents(
    r2r: R2RClient,
    agent_id: str,
    url_source: URLSource,
    all_docs: list[dict] | None = None,
) -> list[dict] | None:
    needs_cleanup = bool(
        url_source.is_indexed
        or url_source.r2r_document_id
        or url_source.status == "success"
        or url_source.content
        or url_source.content_hash
    )
    if not needs_cleanup:
        return all_docs

    if all_docs is None:
        all_docs = await list_agent_documents(r2r, agent_id)

    known_doc_ids = {url_source.r2r_document_id} if url_source.r2r_document_id else set()
    legacy_doc_ids = []
    for doc in all_docs:
        doc_id = doc.get("id", doc.get("document_id", ""))
        if legacy_url_doc_matches(url_source, doc) and str(doc_id) not in known_doc_ids:
            if not doc_id:
                logger.warning(f"R2R doc missing ID for indexed legacy URL {url_source.id}")
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail="Failed to identify URL search index entry",
                )
            legacy_doc_ids.append(str(doc_id))

    if url_source.is_indexed and not url_source.r2r_document_id and not legacy_doc_ids:
        logger.warning(f"No R2R doc found for indexed legacy URL {url_source.id}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to identify URL search index entry",
        )

    if url_source.r2r_document_id:
        await unassign_indexed_url_document(r2r, agent_id, url_source.r2r_document_id)
    for doc_id in legacy_doc_ids:
        await unassign_indexed_url_document(r2r, agent_id, doc_id)
    return all_docs


def legacy_url_doc_matches(url_source: URLSource, doc: dict) -> bool:
    meta = doc.get("metadata") or {}
    if meta.get("source_type") != "url":
        return False

    meta_url_source_id = meta.get("url_source_id")
    if meta_url_source_id is not None and str(meta_url_source_id) == str(url_source.id):
        return True

    meta_url = meta.get("url")
    return meta_url in {url_source.url, url_source.normalized_url}


