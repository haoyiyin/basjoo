"""File-specific R2R cleanup helpers to ensure fail-closed behavior."""

import logging

from fastapi import HTTPException, status

from models import KnowledgeFile
from services.r2r_client import R2RClient

logger = logging.getLogger(__name__)


async def unassign_indexed_file_document(r2r: R2RClient, agent_id: str, document_id: str):
    """Unassign a file R2R document from agent collection, failing closed on errors."""
    try:
        unassigned = await r2r.unassign_document(agent_id, document_id)
    except Exception as e:
        logger.warning(f"Failed to unassign R2R file doc {document_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to remove file from search index",
        ) from e

    if not unassigned:
        logger.warning(f"R2R unassign returned false for file doc {document_id}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to remove file from search index",
        )


async def list_agent_documents_for_files(r2r: R2RClient, agent_id: str) -> list[dict]:
    """List agent R2R documents for file cleanup, failing closed on errors."""
    try:
        return await r2r.list_documents(agent_id)
    except Exception as e:
        logger.warning(f"Failed to list R2R docs for agent {agent_id} during file cleanup: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to inspect file search index",
        ) from e


def legacy_file_doc_matches(knowledge_file: KnowledgeFile, doc: dict) -> bool:
    """Check if an R2R document matches a legacy file without r2r_document_id.

    Priority:
    1. Strong match: metadata.knowledge_file_id == knowledge_file.id
    2. Conservative fallback: filename and file_type match (only safe if unique)
    """
    meta = doc.get("metadata") or {}
    if meta.get("source_type") != "file":
        return False

    # Strong match by knowledge_file_id
    meta_kf_id = meta.get("knowledge_file_id")
    if meta_kf_id is not None and str(meta_kf_id) == str(knowledge_file.id):
        return True

    # Fallback by filename and file_type
    if meta.get("filename") == knowledge_file.filename:
        if knowledge_file.file_type and meta.get("file_type") != knowledge_file.file_type:
            return False
        return True

    return False


async def cleanup_file_index_documents(
    r2r: R2RClient,
    agent_id: str,
    knowledge_file: KnowledgeFile,
    all_docs: list[dict] | None = None,
) -> list[dict] | None:
    """Clean up R2R documents for a file before SQLite deletion.

    - If r2r_document_id exists, unassign it.
    - Also search for legacy duplicate docs that may share metadata.
    - If status is ready/processing/pending without r2r_document_id, search legacy docs.
    - If status is failed/uploading without r2r_document_id, allow deletion without R2R listing.
    - Fails closed when legacy doc cannot be identified or match is ambiguous.
    """
    # Determine if R2R cleanup is needed
    needs_r2r_cleanup = bool(
        knowledge_file.r2r_document_id
        or knowledge_file.status in ("ready", "processing", "pending")
    )

    if not needs_r2r_cleanup:
        # Failed or uploading files without R2R doc id may never have been indexed
        return all_docs

    # List documents if we need to find legacy matches (even when we have a known doc)
    # This mirrors URL cleanup behavior which also checks for duplicates
    if all_docs is None:
        all_docs = await list_agent_documents_for_files(r2r, agent_id)

    known_doc_ids = {knowledge_file.r2r_document_id} if knowledge_file.r2r_document_id else set()
    legacy_doc_ids = []
    ambiguous_matches = 0

    if all_docs:
        for doc in all_docs:
            doc_id = doc.get("id", doc.get("document_id", ""))
            if legacy_file_doc_matches(knowledge_file, doc) and str(doc_id) not in known_doc_ids:
                if not doc_id:
                    logger.warning(f"R2R doc missing ID for legacy file {knowledge_file.id}")
                    raise HTTPException(
                        status_code=status.HTTP_502_BAD_GATEWAY,
                        detail="Failed to identify file search index entry",
                    )
                # Check for ambiguous filename/type fallback matches
                meta = doc.get("metadata") or {}
                if not meta.get("knowledge_file_id"):
                    ambiguous_matches += 1
                legacy_doc_ids.append(str(doc_id))

    # If we found multiple ambiguous matches, fail closed to avoid deleting wrong docs
    if ambiguous_matches > 1:
        logger.warning(
            f"Multiple ambiguous R2R docs match file {knowledge_file.id} by filename/type; "
            f"cannot safely determine which to unassign"
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to uniquely identify file search index entry",
        )

    # For ready files without any doc id, fail closed if we can't find a match
    if (
        knowledge_file.status == "ready"
        and not knowledge_file.r2r_document_id
        and not legacy_doc_ids
    ):
        logger.warning(f"No R2R doc found for ready legacy file {knowledge_file.id}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Failed to identify file search index entry",
        )

    # Unassign known document
    if knowledge_file.r2r_document_id:
        await unassign_indexed_file_document(r2r, agent_id, knowledge_file.r2r_document_id)

    # Unassign legacy documents
    for doc_id in legacy_doc_ids:
        await unassign_indexed_file_document(r2r, agent_id, doc_id)

    return all_docs