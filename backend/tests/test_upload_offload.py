"""Uploading a 20MB file does not block other requests (#47).

The acceptance sentence is "Uploading a 20MB file does not block other requests
(concurrent health check stays under 200ms)".

Two properties, both measured on the real ASGI app:

1. **The upload request does no ingest work.** ``KbDocumentProcessor.process_document``
   is replaced by a spy that would be immediately visible, so "off the request
   path" is not a claim about latency but a fact about which coroutine ran.
2. **A concurrent ``GET /health`` stays under 200 ms.** The health check is issued
   from another task while the 20 MB multipart body is still being transferred.
   If the endpoint parsed, chunked, embedded *or wrote the file with a blocking
   ``open()/write()``*, the event loop would be occupied and the health request
   would queue behind it. (The blocking write was a real defect this test caught:
   the upload endpoint used to hold the loop for ~330 ms per 20 MB.)

The document row is asserted to be ``processing`` / stage ``uploaded`` *before*
any processing happened — that is the persisted hand-off the scheduler drains, and
the reason an interrupted deploy no longer loses uploads held in an in-process
``BackgroundTasks`` list.
"""

import asyncio
import time

import pytest
from sqlalchemy import select

import database
from models import KbDocument

#: Exactly the per-file limit: the largest upload the API accepts.
TWENTY_MB = 20 * 1024 * 1024
#: The acceptance threshold from the issue.
HEALTH_BUDGET_SECONDS = 0.200

CONTENT = b"x" * TWENTY_MB

#: The multipart body is assembled ONCE, up front. Building 20 MB of multipart
#: inside the timed window would measure this test's own client-side encoding
#: rather than the server, which is the thing under test.
BOUNDARY = "----basjoo47uploadtest"
MULTIPART_BODY = (
    f"--{BOUNDARY}\r\n"
    'Content-Disposition: form-data; name="files"; filename="twenty-megabytes.txt"\r\n'
    "Content-Type: text/plain\r\n\r\n"
).encode("utf-8") + CONTENT + f"\r\n--{BOUNDARY}--\r\n".encode("utf-8")

MULTIPART_HEADERS = {
    "Content-Type": f"multipart/form-data; boundary={BOUNDARY}",
    # A fixed length lets the server read a plain body instead of chunk-decoding.
    "Content-Length": str(len(MULTIPART_BODY)),
}

@pytest.fixture(autouse=True)
def hermetic_ingest(monkeypatch):
    """Fake the provider and the vector store; spy on the eager ingest call."""
    from services.document_parser import DocumentParser
    from services.qdrant_service import QdrantKbService

    calls: list[str] = []

    async def fake_embed_texts(self, texts, model, base_url, api_key=None, **kwargs):
        return [[0.01] * 8 for _ in texts]

    async def fake_batch_upsert_points(self, kb_id, points, batch_size=100):
        return len(points)

    async def fake_delete_points_by_doc_id(self, kb_id, doc_id):
        return 1

    async def fake_ensure_collection(self, kb_id, dimension):
        return kb_id

    monkeypatch.setattr(DocumentParser, "embed_texts", fake_embed_texts, raising=True)
    monkeypatch.setattr(
        QdrantKbService, "batch_upsert_points", fake_batch_upsert_points, raising=True
    )
    monkeypatch.setattr(
        QdrantKbService,
        "delete_points_by_doc_id",
        fake_delete_points_by_doc_id,
        raising=True,
    )
    monkeypatch.setattr(
        QdrantKbService, "ensure_collection", fake_ensure_collection, raising=True
    )

    from services.kb_document_processor import KbDocumentProcessor

    real_process_document = KbDocumentProcessor.process_document
    state = {"eager_calls": [], "run_for_real": False}

    async def spy_process_document(self, doc_id, kb_id):
        if state["run_for_real"]:
            return await real_process_document(self, doc_id, kb_id)
        state["eager_calls"].append(doc_id)

    monkeypatch.setattr(
        KbDocumentProcessor, "process_document", spy_process_document, raising=True
    )
    return state

async def _upload_20mb(client, kb_id: str):
    return await client.post(
        f"/api/v1/knowledge-bases/{kb_id}/files:upload",
        content=MULTIPART_BODY,
        headers=MULTIPART_HEADERS,
    )

@pytest.mark.asyncio
async def test_upload_20mb_is_async_and_health_stays_under_200ms(
    client, unbound_kb_id, hermetic_ingest
):
    """20 MB upload + concurrent health check: health answers in < 200 ms."""
    # Warm the route first. The *first* request through a fresh ASGI app pays
    # one-off costs that have nothing to do with ingest (middleware chain,
    # dependency wiring, the client's connection setup). Measuring inside that
    # window would report the framework's cold start as backpressure, so the
    # budget below is applied to steady-state latency — with ingest work, every
    # sample would be slow, not just the first.
    warmup = await client.get("/health")
    assert warmup.status_code == 200

    upload_task = asyncio.create_task(_upload_20mb(client, unbound_kb_id))

    latencies: list[float] = []
    while not upload_task.done():
        started = time.perf_counter()
        health = await client.get("/health")
        latencies.append(time.perf_counter() - started)
        assert health.status_code == 200, health.text
        assert health.json() == {"status": "healthy"}
        await asyncio.sleep(0.005)

    response = await upload_task
    assert response.status_code == 200, response.text[:2000]

    assert latencies, (
        "no health check ran while the upload was in flight; the test would be "
        "vacuous"
    )
    slowest = max(latencies)
    assert slowest < HEALTH_BUDGET_SECONDS, (
        f"a concurrent health check took {slowest * 1000:.1f} ms during a 20 MB "
        f"upload (budget {HEALTH_BUDGET_SECONDS * 1000:.0f} ms); samples (ms): "
        f"{[round(value * 1000, 1) for value in latencies]} — the request path is "
        "doing ingest work"
    )

@pytest.mark.asyncio
async def test_upload_leaves_a_processing_row_and_does_not_process_it(
    client, unbound_kb_id, hermetic_ingest
):
    """The accepted row is persisted as `processing`/`uploaded`, not processed."""
    response = await _upload_20mb(client, unbound_kb_id)
    assert response.status_code == 200, response.text[:2000]

    body = response.json()
    assert body["uploaded"] == 1, body
    assert body["failed"] == 0, body
    uploaded = body["files"][0]
    assert uploaded["status"] == "processing", (
        "the row is queued, not finished: the response must not claim `ready`"
    )
    assert uploaded["processing_stage"] == "uploaded"

    doc_id = uploaded["id"]
    async with database.AsyncSessionLocal() as session:
        doc = await session.get(KbDocument, doc_id)
        assert doc is not None
        assert doc.status == "processing", doc.status
        assert doc.processing_stage == "uploaded", doc.processing_stage
        assert doc.storage_path, "the bytes are on disk before the response is sent"
        assert doc.file_size == TWENTY_MB

    assert hermetic_ingest["eager_calls"] == [], (
        "the upload endpoint must not await `process_document`; it was called for "
        f"{hermetic_ingest['eager_calls']}"
    )

    # The list endpoint reports the same queued state a page reload would see.
    listing = await client.get(
        f"/api/v1/knowledge-bases/{unbound_kb_id}/files:list"
    )
    assert listing.status_code == 200, listing.text
    row = next(item for item in listing.json()["files"] if item["id"] == doc_id)
    assert row["status"] == "processing"
    assert row["processing_stage"] == "uploaded"

@pytest.mark.asyncio
async def test_scheduler_drains_the_queued_upload(
    client, unbound_kb_id, hermetic_ingest, monkeypatch
):
    """Phase 2: the scheduler picks the row up and finishes the ingest."""
    monkeypatch.setattr(
        "services.scheduler.AsyncSessionLocal", database.AsyncSessionLocal
    )

    from services.scheduler import DocumentProcessingScheduler

    # A small queued row is enough: the scheduler's job is "drain whatever is
    # queued", and a 20 MB text parse would only test the parser.
    body = (
        "Scheduler drain page. This paragraph is long enough for the parser to "
        "produce at least one chunk so the row can reach `ready`."
    ).encode("utf-8")
    response = await client.post(
        f"/api/v1/knowledge-bases/{unbound_kb_id}/files:upload",
        files={"files": ("drained-by-scheduler.txt", body, "text/plain")},
    )
    assert response.status_code == 200, response.text[:2000]
    doc_id = response.json()["files"][0]["id"]
    assert hermetic_ingest["eager_calls"] == []

    # From here on the spy delegates to the production implementation: the
    # scheduler, not the request, is what runs the ingest.
    hermetic_ingest["run_for_real"] = True

    scheduler = DocumentProcessingScheduler()
    processed = await scheduler.process_pending_documents()
    assert processed >= 1, "the queued upload must be picked up by the scheduler"

    async with database.AsyncSessionLocal() as session:
        doc = (
            await session.execute(
                select(KbDocument)
                .where(KbDocument.id == doc_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        assert doc.status == "ready", (
            f"the scheduler must finish the ingest; status={doc.status} "
            f"error={doc.error_message!r}"
        )
        assert doc.processing_stage == "done", doc.processing_stage
        assert doc.error_message is None
