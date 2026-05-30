"""KB document upload processor: save, background process (parse→chunk→embed→Qdrant), delete, progress."""

import logging
import os
import uuid
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal
from models import KbChunk, KbDocument, KnowledgeBase
from services.document_parser import DocumentParser
from services.kb_service import KbService
from services.qdrant_service import QdrantKbService

logger = logging.getLogger(__name__)

UPLOAD_ROOT = Path("/app/data/kb_uploads")


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
        d = self._ensure_upload_dir(doc.tenant_id, doc.kb_id, doc.id)
        safe_name = "".join(c for c in doc.filename if c.isalnum() or c in "._-")[:200]
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
            if not doc or doc.status != "pending":
                return

            doc.status = "processing"
            await session.commit()

            try:
                # get KB config (tenant enforced inside kb_svc)
                kb = await self.kb_svc.get_knowledge_base(tenant_id, kb_id)
                if not kb:
                    raise ValueError("KB not found")

                # parse (with retry)
                text = self.parser.parse_with_retry(
                    doc.storage_path, doc.file_type or ""
                )
                if not text.strip():
                    raise ValueError("Empty text after parse")

                # chunk
                chunks = self.parser.chunk_text(text, kb.chunk_size, kb.chunk_overlap)
                if not chunks:
                    raise ValueError("No chunks generated")

                # embed (retry inside or simple)
                embeddings = await self.parser.embed_texts(
                    chunks, kb.embedding_model, kb.embedding_base_url
                )
                if len(embeddings) != len(chunks):
                    raise ValueError("Embedding count mismatch")

                # prepare Qdrant points (batch)
                points = []
                chunk_records = []
                for idx, (chunk_text, emb) in enumerate(zip(chunks, embeddings)):
                    point_id = str(uuid.uuid4())
                    payload = {
                        "tenant_id": tenant_id,
                        "kb_id": kb_id,
                        "doc_id": doc_id,
                        "chunk_index": idx,
                        "text": chunk_text[:2000],  # cap
                        "filename": doc.filename,
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
                doc.status = "ready"
                doc.chunk_count = len(chunks)
                await session.commit()
                logger.info(f"Doc {doc_id} indexed: {len(chunks)} chunks")

            except Exception as e:
                logger.exception(f"Processing failed for doc {doc_id}: {e}")
                doc.status = "error"
                doc.error_message = str(e)[:500]
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
            "status": doc.status,
            "chunk_count": doc.chunk_count,
            "error_message": doc.error_message,
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
        if doc and doc.storage_path and os.path.exists(doc.storage_path):
            try:
                os.remove(doc.storage_path)
            except Exception:
                pass
        if doc:
            await db.delete(doc)
        await db.commit()
