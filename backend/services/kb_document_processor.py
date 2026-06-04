"""KB document upload processor: save, background process (parse→chunk→embed→Qdrant), delete, progress."""

import contextlib
import logging
import os
import uuid
from pathlib import Path
from typing import cast

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal
from models import KbChunk, KbDocument
from services.document_parser import DocumentParser
from services.kb_service import KbService
from services.qdrant_service import QdrantKbService

logger = logging.getLogger(__name__)

# Configurable upload root - defaults to /app/data/kb_uploads in production,
# can be overridden via environment variable for tests
import os

UPLOAD_ROOT = Path(os.environ.get("KB_UPLOAD_ROOT", "/app/data/kb_uploads"))


class KbDocumentProcessor:
    def __init__(self):
        self.parser = DocumentParser()
        self.qdrant = QdrantKbService()
        self.kb_svc = KbService()

    def _ensure_upload_dir(self, tenant_id: str, kb_id: str, doc_id: str) -> Path:
        d = UPLOAD_ROOT / tenant_id / kb_id / doc_id
        d.mkdir(parents=True, exist_ok=True)
        return d

    async def create_document_record(
        self,
        tenant_id: str,
        kb_id: str,
        filename: str,
        file_size: int,
        db: AsyncSession,
    ) -> KbDocument:
        """Create pending record (called from endpoint before background)."""
        if not tenant_id:
            raise ValueError("tenant_id required")
        doc = KbDocument(
            kb_id=kb_id,
            tenant_id=tenant_id,
            filename=filename,
            file_size=file_size,
            status="pending",
        )
        db.add(doc)
        await db.flush()
        return doc

    def save_uploaded_file(self, doc: KbDocument, content: bytes, ext: str) -> str:
        """Save bytes to disk, return storage_path."""
        tenant_id = str(getattr(doc, "tenant_id", ""))
        kb_id = str(getattr(doc, "kb_id", ""))
        doc_id = str(getattr(doc, "id", ""))
        filename = str(getattr(doc, "filename", ""))
        d = self._ensure_upload_dir(tenant_id, kb_id, doc_id)
        safe_name = "".join(c for c in filename if c.isalnum() or c in "._-")[:200]
        path = d / safe_name
        with open(path, "wb") as f:
            f.write(content)
        return str(path)

    async def process_document(self, doc_id: str, tenant_id: str, kb_id: str):
        """Background task entrypoint. Updates status, parses, chunks, embeds, upserts."""
        async with AsyncSessionLocal() as session:
            # fetch with tenant filter
            stmt = select(KbDocument).where(
                KbDocument.id == doc_id, KbDocument.tenant_id == tenant_id
            )
            res = await session.execute(stmt)
            doc = res.scalar_one_or_none()
            if not doc or getattr(doc, "status", None) != "pending":
                return

            object.__setattr__(doc, "status", "processing")
            await session.commit()

            try:
                # get KB config (tenant enforced inside kb_svc)
                kb = await self.kb_svc.get_knowledge_base(tenant_id, kb_id)
                if not kb:
                    raise ValueError("KB not found")

                # parse (with retry)
                storage_path = str(getattr(doc, "storage_path", ""))
                file_type = str(getattr(doc, "file_type", "") or "")
                text = self.parser.parse_with_retry(storage_path, file_type)
                if not text.strip():
                    raise ValueError("Empty text after parse")

                # chunk (use getattr + cast to satisfy static type checker on SA models)
                chunk_size = cast(int, getattr(kb, "chunk_size", 512))
                chunk_overlap = cast(int, getattr(kb, "chunk_overlap", 64))
                chunks = self.parser.chunk_text(text, chunk_size, chunk_overlap)
                if not chunks:
                    raise ValueError("No chunks generated")

                # embed (retry inside or simple)
                model = cast(str, getattr(kb, "embedding_model", "BAAI/bge-m3"))
                base_url = cast(str | None, getattr(kb, "embedding_base_url", None))
                embeddings = await self.parser.embed_texts(chunks, model, base_url)
                if len(embeddings) != len(chunks):
                    raise ValueError("Embedding count mismatch")

                # prepare Qdrant points (batch)
                points = []
                chunk_records = []
                for idx, (chunk_text, emb) in enumerate(
                    zip(chunks, embeddings, strict=True)
                ):
                    point_id = str(uuid.uuid4())
                    payload = {
                        "tenant_id": tenant_id,
                        "kb_id": kb_id,
                        "doc_id": doc_id,
                        "chunk_index": idx,
                        "text": chunk_text[:2000],  # cap
                        "filename": getattr(doc, "filename", ""),
                    }
                    points.append({"id": point_id, "vector": emb, "payload": payload})

                    ch = KbChunk(
                        kb_id=kb_id,
                        doc_id=doc_id,
                        tenant_id=tenant_id,
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
                logger.exception(f"Processing failed for doc {doc_id}: {e}")
                object.__setattr__(doc, "status", "error")
                object.__setattr__(doc, "error_message", str(e)[:500])
                await session.commit()

    async def get_document_progress(
        self, tenant_id: str, doc_id: str, db: AsyncSession
    ) -> dict:
        stmt = select(KbDocument).where(
            KbDocument.id == doc_id, KbDocument.tenant_id == tenant_id
        )
        res = await db.execute(stmt)
        doc = res.scalar_one_or_none()
        if not doc:
            return {"status": "not_found"}
        return {
            "status": getattr(doc, "status", None),
            "chunk_count": getattr(doc, "chunk_count", 0),
            "error_message": getattr(doc, "error_message", None),
        }

    async def delete_document(
        self, tenant_id: str, kb_id: str, doc_id: str, db: AsyncSession
    ):
        """Full delete: Qdrant points → chunks → doc → file."""
        # 1. Qdrant
        await self.qdrant.delete_points_by_doc_id(kb_id, doc_id)

        # 2. chunks (tenant filter)
        await db.execute(
            delete(KbChunk).where(
                KbChunk.doc_id == doc_id, KbChunk.tenant_id == tenant_id
            )
        )

        # 3. doc
        stmt = select(KbDocument).where(
            KbDocument.id == doc_id, KbDocument.tenant_id == tenant_id
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
