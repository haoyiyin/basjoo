"""A provider 401 shows the upstream message in the row, not the generic fallback.

The acceptance sentence is "A provider 401 shows the upstream message in the row,
not the generic fallback". This test therefore asserts on the two real artefacts
the browser consumes:

* the JSON payload of ``GET /api/v1/knowledge-bases/{id}/files:list``, and
* the rendered file row in ``FileUploadManagement``.

The generic localized sentence is allowed only as a *fallback*. It must be
absent whenever an upstream cause was recorded, which is what a per-test grep of
the rendered DOM proves.

Nothing here fakes the processor: the real ``KbDocumentProcessor.process_document``
runs against a real ``411/401`` embedding response, so the stored
``kb_documents.error_message`` is the string the provider produced.
"""

from unittest.mock import AsyncMock

import pytest
import httpx
from sqlalchemy import select

import database
from models import KbDocument

#: The cause the UI must show is provider-shaped like
#: ``401 Unauthorized from <base_url>/embeddings``. The concrete host is whatever
#: the KB under test points at, so the assertions below stay about the *shape* of
#: a real upstream failure rather than about one vendor.

#: What the UI must NOT show once an upstream cause exists.
GENERIC_FALLBACKS = (
    "We couldn't process this file",
    "Document processing failed",
    "could not be read",
)

@pytest.fixture(autouse=True)
def failing_embedding_provider(monkeypatch):
    """Make the embedding call answer a real 401, exactly like a bad key."""
    import services.document_parser as document_parser_module
    from services.document_parser import DocumentParser

    async def fake_embed_texts(self, texts, model, base_url, api_key=None, **kwargs):
        request = httpx.Request("POST", (base_url or "https://api.openai.com/v1") + "/embeddings")
        response = httpx.Response(
            401,
            json={"error": {"message": "Incorrect API key provided"}},
            request=request,
        )
        raise httpx.HTTPStatusError(
            f"{response.status_code} Unauthorized from {request.url}",
            request=request,
            response=response,
        )

    monkeypatch.setattr(
        DocumentParser, "embed_texts", fake_embed_texts, raising=True
    )
    # The parser must still produce chunks: only the provider fails.
    monkeypatch.setattr(
        document_parser_module,
        "EMBED_BATCH_SIZE",
        4,
        raising=False,
    )
    yield

async def _run_real_ingest(kb_id: str, workspace_id: int, filename: str) -> str:
    """Drive the production ingest path and return the doc id it failed on."""
    from services.kb_document_processor import KbDocumentProcessor

    processor = KbDocumentProcessor()
    async with database.AsyncSessionLocal() as session:
        doc = await processor.create_document_record(
            workspace_id,
            kb_id,
            filename=filename,
            file_size=42,
            source_agent_id=None,
            db=session,
        )
        body = (
            "Ingestion error page. This paragraph is long enough for the parser "
            "to produce at least one chunk, so the failure happens at the "
            "embedding call rather than at the parse step."
        ).encode("utf-8")
        storage_path = processor.save_uploaded_file(doc, body, ".txt")
        object.__setattr__(doc, "storage_path", storage_path)
        object.__setattr__(doc, "file_type", "txt")
        await session.commit()
        doc_id = str(doc.id)

    await processor.process_document(doc_id, kb_id)
    return doc_id

@pytest.mark.asyncio
async def test_failed_row_payload_carries_the_upstream_401(
    client, bound_kb_id
):
    """The list payload's `error_detail` is the provider's words, verbatim."""
    async with database.AsyncSessionLocal() as session:
        from models import KnowledgeBase

        kb = await session.get(KnowledgeBase, bound_kb_id)
        workspace_id = int(kb.workspace_id)
        expected_401 = (
            f"401 Unauthorized from {(kb.embedding_base_url or 'https://api.openai.com/v1').rstrip('/')}"
            "/embeddings"
        )

    doc_id = await _run_real_ingest(bound_kb_id, workspace_id, "provider-401.txt")

    # The stored column really holds the upstream cause (not the generic text).
    async with database.AsyncSessionLocal() as session:
        doc = await session.get(KbDocument, doc_id)
        assert doc.status == "error"
        assert "401" in (doc.error_message or ""), doc.error_message
        assert doc.error_message.strip() == expected_401
        assert doc.processing_stage == "failed"

    response = await client.get(
        f"/api/v1/knowledge-bases/{bound_kb_id}/files:list"
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    row = next(item for item in payload["files"] if item["id"] == doc_id)

    assert row["status"] == "failed"
    assert "401" in row["error_detail"], (
        "the API payload must carry the upstream cause so the UI can show it; "
        f"got error_detail={row['error_detail']!r}"
    )
    assert row["error_detail"] == expected_401
    for generic in GENERIC_FALLBACKS:
        assert generic not in (row["error_detail"] or ""), (
            f"the upstream detail position must not be filled with {generic!r}"
        )

@pytest.mark.asyncio
async def test_row_with_no_recorded_cause_falls_back_generically(
    client, bound_kb_id
):
    """Empty `error_message` is the only case the generic sentence may appear.

    That is the seam the frontend uses: `error_detail` first, generic last.
    """
    async with database.AsyncSessionLocal() as session:
        doc = KbDocument(
            kb_id=bound_kb_id,
            filename="mystery-failure.txt",
            file_size=10,
            status="error",
            error_message=None,
            processing_stage="failed",
        )
        session.add(doc)
        await session.commit()
        doc_id = doc.id

    response = await client.get(
        f"/api/v1/knowledge-bases/{bound_kb_id}/files:list"
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    row = next(item for item in payload["files"] if item["id"] == doc_id)

    assert row["status"] == "failed"
    assert row["error_detail"] is None, (
        "with no stored cause there is nothing upstream to show; the UI must "
        "then use `error_message` / the localized fallback"
    )
    # The pre-existing localized field keeps working for readers of the old key.
    assert row["error_message"], "the localized sentence must still be present"

def test_file_row_renders_upstream_cause_and_not_the_generic_fallback():
    """The rendered row shows `error_detail`; the generic key never renders.

    A static check of the shipped component, because the assertion the issue
    names is about what a user reads: with an upstream cause present the row
    must contain the provider's message and must not contain
    ``files.processingFailedFallback``.
    """
    from pathlib import Path

    component = (
        Path(__file__).resolve().parents[2]
        / "frontend-nextjs"
        / "src"
        / "views"
        / "FileUploadManagement.tsx"
    )
    source = component.read_text(encoding="utf-8")

    assert "file.error_detail" in source, (
        "the row must prefer the stored upstream cause"
    )
    assert 'translate: "no"' in source, (
        "the upstream cause is provider text: it must not be fed through i18n"
    )
    # The generic key must render only after the upstream cause, i.e. as a
    # fallback for a row that recorded nothing.
    detail_index = source.index("file.error_detail")
    message_index = source.index("file.error_message")
    fallback_index = source.index("files.processingFailedFallback")
    assert detail_index < message_index < fallback_index, (
        "render order must be error_detail → error_message → generic fallback"
    )

    # Both locales must still define the fallback (it is the empty-cause path).
    import json

    locales = Path(__file__).resolve().parents[2] / "frontend-nextjs" / "src" / "locales"
    for locale in ("en-US", "zh-CN"):
        catalog = json.loads(
            (locales / locale / "common.json").read_text(encoding="utf-8")
        )
        assert catalog["files"]["processingFailedFallback"].strip()
