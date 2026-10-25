"""KB document pipeline: parser basics, workspace-scoped upload paths, processing.

The processor reads its embedding config (model, base URL, key, dimension) from
the KB and writes `source_agent_id` provenance on every chunk payload. There is no
tenant anywhere in the path or the payload.
"""

import uuid
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

import database
from models import KnowledgeBase, KbChunk, KbDocument, Workspace, WorkspaceQuota
from services import kb_document_processor
from services.document_parser import DocumentParser
from services.kb_document_processor import (
    PROCESSING_ERROR_MESSAGE_MAX_LENGTH,
    KbDocumentProcessor,
    get_embedding_api_key,
)
from core.encryption import encrypt_api_key
from services.kb_service import KbService

DIMENSION = 6
KB_EMBEDDING_KEY = "pipeline-embedding-key"

_RANDOM_BINARY_BYTES = (
    b"\x00\xff\x10not-a-real-document\x00\x01\x02" + bytes(range(3, 32))
)

@pytest.fixture(autouse=True)
def fake_qdrant(monkeypatch):
    """Record Qdrant traffic instead of talking to a live instance."""
    from services.qdrant_service import QdrantKbService

    state: dict[str, list] = {"upserts": [], "deletes": []}

    async def ensure_collection(self, kb_id, dimension):
        return f"kb_{str(kb_id).replace('-', '')[:12]}"

    async def delete_collection(self, kb_id):
        return True

    async def batch_upsert_points(self, kb_id, points, batch_size=100):
        state["upserts"].append((kb_id, list(points)))
        return len(points)

    async def delete_points_by_doc_id(self, kb_id, doc_id):
        state["deletes"].append((kb_id, doc_id))
        return 1

    monkeypatch.setattr(QdrantKbService, "ensure_collection", ensure_collection)
    monkeypatch.setattr(QdrantKbService, "delete_collection", delete_collection)
    monkeypatch.setattr(
        QdrantKbService, "batch_upsert_points", batch_upsert_points
    )
    monkeypatch.setattr(
        QdrantKbService, "delete_points_by_doc_id", delete_points_by_doc_id
    )
    return state

async def _workspace(email: str = "pipeline@example.com") -> int:
    async with database.AsyncSessionLocal() as session:
        workspace = Workspace(name=f"Workspace {email}", owner_email=email)
        session.add(workspace)
        await session.flush()
        session.add(WorkspaceQuota(workspace_id=workspace.id))
        await session.commit()
        return workspace.id

async def _create_kb(
    workspace_id: int,
    name: str = "Pipeline KB",
    *,
    embedding_dimension: int = DIMENSION,
    embedding_model: str = "test-embedding-model",
    is_locked: bool = False,
) -> str:
    kb = await KbService().create_knowledge_base(
        workspace_id,
        name,
        embedding_provider="custom",
        embedding_model=embedding_model,
        embedding_base_url="https://embed.example.com/v1",
        embedding_api_key=encrypt_api_key(KB_EMBEDDING_KEY),
        embedding_dimension=embedding_dimension,
        embedding_batch_size=4,
    )
    if is_locked:
        async with database.AsyncSessionLocal() as session:
            row = await session.get(KnowledgeBase, kb.id)
            object.__setattr__(row, "is_locked", True)
            await session.commit()
    return kb.id

# ---- parser basics ---------------------------------------------------------

def test_document_parser_chunk_text():
    parser = DocumentParser()
    chunks = parser.chunk_text("a" * 600, 512, 64)
    assert len(chunks) > 1
    assert len(chunks[0]) == 512

def test_document_parser_chunk_small_text():
    parser = DocumentParser()
    chunks = parser.chunk_text("small text", 512, 64)
    assert chunks == ["small text"]

def test_document_parser_chunk_empty():
    assert DocumentParser().chunk_text("", 512, 64) == []

def test_document_parser_supported_exts():
    from constants import ALLOWED_EXTENSIONS

    for ext in ("txt", "md", "html", "pdf", "docx", "xlsx"):
        assert ext in ALLOWED_EXTENSIONS

def test_processor_imports():
    processor = KbDocumentProcessor()
    assert processor.parser is not None
    assert processor.qdrant is not None
    assert not hasattr(processor, "kb_svc"), "the processor must not need KbService"

# ---- upload paths ----------------------------------------------------------

def test_save_uploaded_file_uses_workspace_path(setup_test_db, tmp_path, monkeypatch):
    monkeypatch.setattr(kb_document_processor, "UPLOAD_ROOT", tmp_path)

    workspace_id = 7
    kb_id = "kb-path-test"
    doc = KbDocument(
        id="doc-path-test",
        kb_id=kb_id,
        filename="report.pdf",
        file_type="pdf",
        status="pending",
    )
    object.__setattr__(doc, "_workspace_id", workspace_id)

    processor = KbDocumentProcessor()
    path = processor.save_uploaded_file(doc, b"%PDF-1.4 fake", "pdf")

    expected_dir = tmp_path / str(workspace_id) / kb_id / "doc-path-test"
    assert Path(path) == expected_dir / "report.pdf"
    assert Path(path).exists()
    assert Path(path).read_bytes() == b"%PDF-1.4 fake"

def test_save_uploaded_file_rejects_a_record_built_by_hand():
    """Path building needs the workspace scope that only creation supplies."""
    doc = KbDocument(id="doc-no-scope", kb_id="kb-x", filename="a.txt")
    with pytest.raises(ValueError, match="workspace scope"):
        KbDocumentProcessor().save_uploaded_file(doc, b"data", "txt")

@pytest.mark.asyncio
async def test_create_document_record_writes_provenance(setup_test_db):
    workspace_id = await _workspace("provenance@example.com")
    kb_id = await _create_kb(workspace_id)

    async with database.AsyncSessionLocal() as session:
        doc = await KbDocumentProcessor().create_document_record(
            workspace_id,
            kb_id,
            "manual.txt",
            5,
            source_agent_id="agt_provenance",
            db=session,
        )
        await session.commit()
        doc_id = doc.id

    async with database.AsyncSessionLocal() as session:
        stored = await session.get(KbDocument, doc_id)
        assert stored.source_agent_id == "agt_provenance"
        assert stored.status == "pending"

def test_create_document_record_requires_workspace():
    import asyncio

    with pytest.raises(ValueError, match="workspace_id"):
        asyncio.run(
            KbDocumentProcessor().create_document_record(
                0, "kb", "a.txt", 1, source_agent_id=None, db=None
            )
        )

# ---- processing ------------------------------------------------------------

async def _seed_document(
    kb_id: str,
    tmp_path,
    filename: str = "doc.txt",
    content: bytes = b"Basjoo knowledge content for chunking.",
    file_type: str = "txt",
    source_agent_id: str | None = "agt_provenance",
) -> str:
    file_path = tmp_path / filename
    file_path.write_bytes(content)
    async with database.AsyncSessionLocal() as session:
        doc = KbDocument(
            kb_id=kb_id,
            filename=filename,
            file_type=file_type,
            file_size=len(content),
            storage_path=str(file_path),
            source_agent_id=source_agent_id,
            status="pending",
        )
        session.add(doc)
        await session.commit()
        return doc.id

async def _load_document(doc_id: str) -> KbDocument:
    async with database.AsyncSessionLocal() as session:
        return (
            await session.execute(select(KbDocument).where(KbDocument.id == doc_id))
        ).scalar_one()

@pytest.mark.asyncio
async def test_process_document_embeds_and_upserts_with_provenance(
    setup_test_db, tmp_path, monkeypatch, fake_qdrant
):
    workspace_id = await _workspace("process@example.com")
    kb_id = await _create_kb(workspace_id)
    doc_id = await _seed_document(kb_id, tmp_path)

    calls: list[dict] = []

    async def fake_embed_texts(self, texts, model, base_url, api_key=None):
        calls.append(
            {"texts": list(texts), "model": model, "base_url": base_url, "api_key": api_key}
        )
        return [[0.1] * DIMENSION for _ in texts]

    monkeypatch.setattr(
        "services.document_parser.DocumentParser.embed_texts", fake_embed_texts
    )

    await KbDocumentProcessor().process_document(doc_id, kb_id)

    doc = await _load_document(doc_id)
    assert doc.status == "ready", doc.error_message
    assert doc.chunk_count == 1

    # The KB's config drives the embedding call.
    assert calls[0]["model"] == "test-embedding-model"
    assert calls[0]["base_url"] == "https://embed.example.com/v1"
    assert calls[0]["api_key"] == KB_EMBEDDING_KEY

    kb_id_arg, points = fake_qdrant["upserts"][0]
    assert kb_id_arg == kb_id
    payload = points[0]["payload"]
    assert payload["kb_id"] == kb_id
    assert payload["doc_id"] == doc_id
    assert payload["source_agent_id"] == "agt_provenance"
    assert "tenant_id" not in payload

    async with database.AsyncSessionLocal() as session:
        chunks = (
            await session.execute(select(KbChunk).where(KbChunk.kb_id == kb_id))
        ).scalars().all()
    assert len(chunks) == 1
    assert chunks[0].tenant_id is None

@pytest.mark.asyncio
async def test_process_document_locks_the_kb_after_indexing(
    setup_test_db, tmp_path, monkeypatch
):
    workspace_id = await _workspace("lock@example.com")
    kb_id = await _create_kb(workspace_id)
    doc_id = await _seed_document(kb_id, tmp_path)

    async def fake_embed_texts(self, texts, model, base_url, api_key=None):
        return [[0.1] * DIMENSION for _ in texts]

    monkeypatch.setattr(
        "services.document_parser.DocumentParser.embed_texts", fake_embed_texts
    )

    await KbDocumentProcessor().process_document(doc_id, kb_id)

    async with database.AsyncSessionLocal() as session:
        kb = await session.get(KnowledgeBase, kb_id)
    assert kb.is_locked is True

@pytest.mark.asyncio
async def test_process_document_self_heals_the_measured_dimension(
    setup_test_db, tmp_path, monkeypatch
):
    workspace_id = await _workspace("heal@example.com")
    kb_id = await _create_kb(workspace_id, embedding_dimension=DIMENSION)

    async with database.AsyncSessionLocal() as session:
        kb = await session.get(KnowledgeBase, kb_id)
        kb.embedding_dimension = None
        await session.commit()

    doc_id = await _seed_document(kb_id, tmp_path)

    async def fake_embed_texts(self, texts, model, base_url, api_key=None):
        return [[0.1] * 96 for _ in texts]

    monkeypatch.setattr(
        "services.document_parser.DocumentParser.embed_texts", fake_embed_texts
    )

    await KbDocumentProcessor().process_document(doc_id, kb_id)

    async with database.AsyncSessionLocal() as session:
        assert (await session.get(KnowledgeBase, kb_id)).embedding_dimension == 96

@pytest.mark.asyncio
async def test_process_document_ignores_non_pending_documents(
    setup_test_db, tmp_path, monkeypatch
):
    workspace_id = await _workspace("skip@example.com")
    kb_id = await _create_kb(workspace_id)
    doc_id = await _seed_document(kb_id, tmp_path)

    async with database.AsyncSessionLocal() as session:
        doc = await session.get(KbDocument, doc_id)
        doc.status = "ready"
        await session.commit()

    calls: list = []

    async def fake_embed_texts(self, *args, **kwargs):
        calls.append(args)
        return []

    monkeypatch.setattr(
        "services.document_parser.DocumentParser.embed_texts", fake_embed_texts
    )

    await KbDocumentProcessor().process_document(doc_id, kb_id)

    assert calls == []

@pytest.mark.asyncio
async def test_process_document_fails_when_the_kb_is_missing(setup_test_db):
    processor = KbDocumentProcessor()
    await processor.process_document(str(uuid.uuid4()), "kb_not_there")
    # No document either: the early return must not raise.

@pytest.mark.asyncio
@pytest.mark.parametrize("ext", ["txt", "md", "html"])
async def test_processor_persists_stable_error_for_binary_renamed_text_files(
    setup_test_db, tmp_path, ext
):
    workspace_id = await _workspace(f"binary-{ext}@example.com")
    kb_id = await _create_kb(workspace_id)
    doc_id = await _seed_document(
        kb_id, tmp_path, filename=f"random_binary.{ext}", content=_RANDOM_BINARY_BYTES, file_type=ext
    )

    await KbDocumentProcessor().process_document(doc_id, kb_id)

    doc = await _load_document(doc_id)
    assert doc.status == "error"
    assert doc.chunk_count in (0, None)
    assert doc.error_message == (
        "INVALID_TEXT_BINARY: file appears to be binary or unreadable text"
    )

@pytest.mark.asyncio
@pytest.mark.parametrize("ext", ["pdf", "docx", "xlsx"])
async def test_processor_marks_random_binary_parser_failures_as_error(
    setup_test_db, tmp_path, ext
):
    workspace_id = await _workspace(f"binfmt-{ext}@example.com")
    kb_id = await _create_kb(workspace_id)
    doc_id = await _seed_document(
        kb_id, tmp_path, filename=f"random_binary.{ext}", content=_RANDOM_BINARY_BYTES, file_type=ext
    )

    await KbDocumentProcessor().process_document(doc_id, kb_id)

    doc = await _load_document(doc_id)
    assert doc.status == "error"
    assert doc.chunk_count in (0, None)
    assert doc.error_message
    assert len(doc.error_message) <= PROCESSING_ERROR_MESSAGE_MAX_LENGTH

# ---- deletion --------------------------------------------------------------

@pytest.mark.asyncio
async def test_delete_document_clears_qdrant_chunks_and_row(
    setup_test_db, tmp_path, monkeypatch, fake_qdrant
):
    workspace_id = await _workspace("delete@example.com")
    kb_id = await _create_kb(workspace_id)
    doc_id = await _seed_document(kb_id, tmp_path)

    async def fake_embed_texts(self, texts, model, base_url, api_key=None):
        return [[0.1] * DIMENSION for _ in texts]

    monkeypatch.setattr(
        "services.document_parser.DocumentParser.embed_texts", fake_embed_texts
    )
    processor = KbDocumentProcessor()
    await processor.process_document(doc_id, kb_id)

    async with database.AsyncSessionLocal() as session:
        await processor.delete_document(kb_id, doc_id, session)

    assert (kb_id, doc_id) in fake_qdrant["deletes"]

    async with database.AsyncSessionLocal() as session:
        assert await session.get(KbDocument, doc_id) is None
        assert (
            await session.scalar(select(KbChunk.id).where(KbChunk.doc_id == doc_id))
        ) is None

@pytest.mark.asyncio
async def test_delete_document_requires_the_matching_kb(setup_test_db, tmp_path, fake_qdrant):
    workspace_id = await _workspace("delete-mismatch@example.com")
    kb_id = await _create_kb(workspace_id)
    other_kb = await _create_kb(workspace_id, "Other KB")
    doc_id = await _seed_document(kb_id, tmp_path)

    async with database.AsyncSessionLocal() as session:
        await KbDocumentProcessor().delete_document(other_kb, doc_id, session)

    async with database.AsyncSessionLocal() as session:
        assert await session.get(KbDocument, doc_id) is not None

# ---- key resolution / retrieval wiring -------------------------------------

def test_get_embedding_api_key_reads_the_kb(tmp_path):
    kb = KnowledgeBase(
        workspace_id=1,
        name="Key KB",
        embedding_api_key=None,
        qdrant_collection=f"kb_{uuid.uuid4().hex[:12]}",
    )
    assert get_embedding_api_key(kb) is None
    assert get_embedding_api_key(None) is None

def test_retrieval_service_imports():
    from services.kb_retrieval_service import KbRetrievalService

    service = KbRetrievalService()
    assert service.parser is not None
    assert service.qdrant is not None
    assert service.default_threshold == 0.6

def test_jina_default_base_url_from_config():
    from config import settings

    assert settings.jina_embedding_api_base.endswith("/embeddings")
    assert settings.jina_embedding_api_base.rstrip("/embeddings") == (
        "https://api.jina.ai/v1"
    )
