"""KB document upload processor: save, background process (parse→chunk→embed→Qdrant), delete, progress.

The KB owns its embedding config (provider/model/base URL/encrypted key) since the
KB-decoupling change; nothing here reads agent-side embedding columns.
"""

import contextlib
import logging
import os
import uuid
from pathlib import Path
from typing import cast

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

import database
from core.encryption import decrypt_api_key
from models import KbChunk, KbDocument, KnowledgeBase
from services.document_parser import DocumentParser, INVALID_TEXT_EMPTY_MESSAGE
from services.qdrant_service import QdrantKbService

logger = logging.getLogger(__name__)

# Configurable upload root - defaults to /app/data/kb_uploads in production,
# can be overridden via environment variable for tests
UPLOAD_ROOT = Path(os.environ.get("KB_UPLOAD_ROOT", "/app/data/kb_uploads"))

PROCESSING_ERROR_MESSAGE_MAX_LENGTH = 500
PROCESSING_ERROR_MESSAGE_FALLBACK = "DOCUMENT_PROCESSING_FAILED"

MAX_UPLOAD_FILENAME_LENGTH = 200
WINDOWS_RESERVED_BASENAMES = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{i}" for i in range(1, 10)}
    | {f"LPT{i}" for i in range(1, 10)}
)

def sanitise_upload_filename(name: str) -> str:
    """Return the one filename that may reach the DB row and the filesystem.

    Strips control characters (NUL included), neutralises path separators,
    prefixes Windows device basenames (``CON``, ``COM1``, ...) with ``_``,
    collapses whitespace, keeps the extension and caps the whole name at
    ``MAX_UPLOAD_FILENAME_LENGTH``. Returns ``""`` when nothing usable is left,
    which the upload endpoint turns into a per-file ``errors[]`` entry.
    """
    cleaned = "".join(
        "_" if ch in "/\\" else ch for ch in str(name or "") if ch.isprintable()
    )
    cleaned = " ".join(cleaned.split())
    if not cleaned:
        return ""

    if "." in cleaned:
        stem, _, suffix = cleaned.rpartition(".")
        ext = f".{suffix}" if suffix else ""
    else:
        stem, ext = cleaned, ""

    if stem.strip(" .").upper() in WINDOWS_RESERVED_BASENAMES:
        stem = f"_{stem}"

    return f"{stem[: max(MAX_UPLOAD_FILENAME_LENGTH - len(ext), 0)]}{ext}"

def _format_processing_error_message(exc: Exception) -> str:
    """Return a bounded, non-localized technical cause for persistence."""
    raw_message = str(exc).strip() or type(exc).__name__
    safe_message = "".join(ch if ch.isprintable() else " " for ch in raw_message)
    safe_message = " ".join(safe_message.split())
    if not safe_message:
        safe_message = PROCESSING_ERROR_MESSAGE_FALLBACK
    return safe_message[:PROCESSING_ERROR_MESSAGE_MAX_LENGTH]

def get_embedding_api_key(kb: KnowledgeBase | None) -> str | None:
    """Resolve the decrypted embedding API key from the KB that owns it.

    This is the only key resolver in the codebase: the key travels with the KB, so
    there is no provider branching and no agent argument. Agents do not carry
    embedding credentials any more.
    """
    return decrypt_api_key(getattr(kb, "embedding_api_key", None)) or None

class KbDocumentProcessor:
    def __init__(self):
        self.parser = DocumentParser()
        self.qdrant = QdrantKbService()

    def _ensure_upload_dir(self, workspace_id: int | str, kb_id: str, doc_id: str) -> Path:
        d = UPLOAD_ROOT / str(workspace_id) / kb_id / doc_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    async def create_document_record(
        self,
        workspace_id: int,
        kb_id: str,
        filename: str,
        file_size: int,
        *,
        source_agent_id: str | None,
        db: AsyncSession,
    ) -> KbDocument:
        """Create pending record (called from endpoint before background).

        Also tags the row with the ingestion source agent so per-agent scoping
        (URL clear-all, `files:list?source=own`) stays possible on a shared KB.
        """
        if not workspace_id:
            raise ValueError("workspace_id required")
        doc = KbDocument(
            kb_id=kb_id,
            filename=filename,
            file_size=file_size,
            source_agent_id=source_agent_id,
            status="pending",
        )
        db.add(doc)
        await db.flush()
        # Transient (non-column) hint so `save_uploaded_file` can build the
        # workspace-scoped path without another round-trip.
        object.__setattr__(doc, "_workspace_id", workspace_id)
        return doc

    def save_uploaded_file(self, doc: KbDocument, content: bytes, ext: str) -> str:
        """Save bytes to ``UPLOAD_ROOT/<workspace_id>/<kb_id>/<doc_id>/<filename>``."""
        workspace_id = getattr(doc, "_workspace_id", None)
        if workspace_id is None:
            raise ValueError(
                "document record is missing its workspace scope; "
                "create it through create_document_record"
            )
        kb_id = str(getattr(doc, "kb_id", ""))
        doc_id = str(getattr(doc, "id", ""))
        filename = str(getattr(doc, "filename", ""))
        d = self._ensure_upload_dir(workspace_id, kb_id, doc_id)
        # One implementation only: the endpoint already sanitised the row, so this
        # is a defensive re-run for rows created another way.
        safe_name = sanitise_upload_filename(filename) or "unnamed"
        path = d / safe_name
        with open(path, "wb") as f:
            f.write(content)
        return str(path)

    async def process_document(self, doc_id: str, kb_id: str):
        """Background task entrypoint. Updates status, parses, chunks, embeds, upserts."""
        async with database.AsyncSessionLocal() as session:
            stmt = select(KbDocument).where(
                KbDocument.id == doc_id, KbDocument.kb_id == kb_id
            )
            res = await session.execute(stmt)
            doc = res.scalar_one_or_none()
            if not doc or getattr(doc, "status", None) != "pending":
                return

            object.__setattr__(doc, "status", "processing")
            await session.commit()

            try:
                # The KB owns everything we need: chunking and embedding config.
                kb = await session.scalar(
                    select(KnowledgeBase).where(KnowledgeBase.id == kb_id)
                )
                if not kb:
                    raise ValueError("KB not found")

                # parse (with retry)
                storage_path = str(getattr(doc, "storage_path", ""))
                file_type = str(getattr(doc, "file_type", "") or "")
                text = self.parser.parse_with_retry(storage_path, file_type)
                if not text.strip():
                    raise RuntimeError(INVALID_TEXT_EMPTY_MESSAGE)

                # chunk (use getattr + cast to satisfy static type checker on SA models)
                chunk_size = cast(int, getattr(kb, "chunk_size", 512))
                chunk_overlap = cast(int, getattr(kb, "chunk_overlap", 64))
                chunks = self.parser.chunk_text(text, chunk_size, chunk_overlap)
                if not chunks:
                    raise ValueError("No chunks generated")

                model = cast(str, getattr(kb, "embedding_model", "BAAI/bge-m3"))
                base_url = cast(str | None, getattr(kb, "embedding_base_url", None))
                api_key = get_embedding_api_key(kb)

                embeddings = await self.parser.embed_texts(
                    chunks, model, base_url, api_key=api_key
                )
                if len(embeddings) != len(chunks):
                    raise ValueError("Embedding count mismatch")

                # Legacy KB rows may predate the column: self-heal with the
                # MEASURED width instead of trusting the model name.
                measured_dimension = len(embeddings[0]) if embeddings else 0
                if measured_dimension and getattr(kb, "embedding_dimension", None) != measured_dimension:
                    object.__setattr__(kb, "embedding_dimension", measured_dimension)

                # prepare Qdrant points (batch)
                points = []
                chunk_records = []
                # Get metadata for source info (URL for crawled pages)
                doc_metadata = getattr(doc, "metadata_json", None) or {}
                source_agent_id = getattr(doc, "source_agent_id", None)

                for idx, (chunk_text, emb) in enumerate(
                    zip(chunks, embeddings, strict=True)
                ):
                    point_id = str(uuid.uuid4())
                    payload = {
                        "kb_id": kb_id,
                        "doc_id": doc_id,
                        "chunk_index": idx,
                        "text": chunk_text[:2000],  # cap
                        "filename": getattr(doc, "filename", ""),
                        # Include source metadata for retrieval display
                        "source_type": doc_metadata.get("source_type", "file"),
                        "source_url": doc_metadata.get("source_url", ""),
                        "source_title": doc_metadata.get("source_title", ""),
                        "source_agent_id": source_agent_id,
                    }
                    points.append({"id": point_id, "vector": emb, "payload": payload})

                    ch = KbChunk(
                        kb_id=kb_id,
                        doc_id=doc_id,
                        vector_id=point_id,
                        chunk_index=idx,
                    )
                    chunk_records.append(ch)

                # batch upsert (≤100)
                await self.qdrant.batch_upsert_points(kb_id, points, batch_size=100)

                # insert chunks
                session.add_all(chunk_records)
                object.__setattr__(doc, "status", "ready")
                object.__setattr__(doc, "chunk_count", len(chunks))
                # Lock KB embedding config after first successful index
                if not bool(getattr(kb, "is_locked", False)):
                    object.__setattr__(kb, "is_locked", True)
                await session.commit()
                logger.info(f"Doc {doc_id} indexed: {len(chunks)} chunks")

            except Exception as e:
                # Intentionally catch all exceptions and set error status.
                # Caller must check doc.status to determine success/failure.
                logger.error(f"Processing failed for doc {doc_id}: {e}", exc_info=True)
                object.__setattr__(doc, "status", "error")
                object.__setattr__(
                    doc, "error_message", _format_processing_error_message(e)
                )
                await session.commit()

    async def get_document_progress(self, doc_id: str, db: AsyncSession) -> dict:
        stmt = select(KbDocument).where(KbDocument.id == doc_id)
        res = await db.execute(stmt)
        doc = res.scalar_one_or_none()
        if not doc:
            return {"status": "not_found"}
        return {
            "status": getattr(doc, "status", None),
            "chunk_count": getattr(doc, "chunk_count", 0),
            "error_message": getattr(doc, "error_message", None),
        }

    async def delete_document(self, kb_id: str, doc_id: str, db: AsyncSession):
        """Full delete: Qdrant points → chunks → doc → file."""
        # 1. Qdrant
        await self.qdrant.delete_points_by_doc_id(kb_id, doc_id)

        # 2. chunks
        await db.execute(delete(KbChunk).where(KbChunk.doc_id == doc_id))

        # 3. doc
        stmt = select(KbDocument).where(
            KbDocument.id == doc_id, KbDocument.kb_id == kb_id
        )
        res = await db.execute(stmt)
        doc = res.scalar_one_or_none()
        storage_path = str(getattr(doc, "storage_path", "")) if doc else ""
        if doc and storage_path and os.path.exists(storage_path):
            with contextlib.suppress(Exception):
                os.remove(storage_path)
        if doc:
            await db.delete(doc)
        await db.commit()
