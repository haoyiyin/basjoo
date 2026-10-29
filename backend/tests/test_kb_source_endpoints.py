"""KB-scoped knowledge-source routes (issue #16 / #17 / #18, plan §4).

The canonical surface is `/api/v1/knowledge-bases/{kb_id}/urls:*`, `files:*`,
`index:*` and `sources:summary`. A knowledge base is the only scoping key: an
unbound KB (no agent) must be able to ingest URLs and files, which is exactly
what these tests pin down.

The suite is hermetic: the fetch/embed seams and the scrapling HTTP layer are
stubbed, so nothing here touches a socket.
"""

from io import BytesIO

import pytest
from sqlalchemy import select

import database
from models import Agent, KbDocument, URLSource

# Imported at collection time on purpose: `services.scheduler` binds
# `from services.url_service import process_url_refetch` at import time, so if it
# is first imported from inside `hermetic_sources` (the app factory pulls it in)
# the scheduler keeps this module's stub for the whole session and
# `tests/test_scheduler_fetch_indexing.py` silently indexes nothing.
import services.scheduler  # noqa: E402,F401  isort:skip

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def hermetic_sources(monkeypatch):
    """Stub out every outbound seam these routes can reach."""
    from services import scrapling_client as scrapling_client_module
    from services import url_service as url_service_module
    from services.crawler import SiteCrawler
    from services.document_parser import DocumentParser
    from services.kb_document_processor import KbDocumentProcessor
    from services.scrapling_client import ScraplingClient
    from services import url_safety as url_safety_module
    import services.kb_document_processor as processor_module

    async def _noop(*args, **kwargs):
        return None

    async def _fake_fetch(self, url, *args, **kwargs):
        return {
            "success": True,
            "title": "Hermetic Page",
            "content": "Hermetic content for the KB-scoped source route tests.",
            "content_hash": "hermetic-hash",
            "metadata": {"status_code": 200, "final_url": url},
        }

    async def _fake_embed(self, texts, model, base_url, api_key=None):
        return [[0.01] * 8 for _ in texts]

    async def _fake_crawl_site(self, url, max_depth=1, max_pages=10):
        return []

    def _fake_resolve(hostname):
        return True, ""

    # Background entry points (patched where the router imports them from).
    monkeypatch.setattr(
        url_service_module, "process_url_refetch", _noop, raising=True
    )
    monkeypatch.setattr(
        url_service_module, "process_index_rebuild", _noop, raising=True
    )
    monkeypatch.setattr(url_service_module, "process_site_crawl", _noop, raising=True)

    # Document processing (background task that would embed + upsert to Qdrant).
    monkeypatch.setattr(
        KbDocumentProcessor, "process_document", _noop, raising=True
    )
    monkeypatch.setattr(
        processor_module, "KbDocumentProcessor", KbDocumentProcessor, raising=True
    )

    # Fetch + embed seams.
    monkeypatch.setattr(ScraplingClient, "fetch", _fake_fetch, raising=True)
    monkeypatch.setattr(DocumentParser, "embed_texts", _fake_embed, raising=True)
    monkeypatch.setattr(SiteCrawler, "crawl_site", _fake_crawl_site, raising=True)
    monkeypatch.setattr(scrapling_client_module, "_default_client", None)

    # DNS: keep `validate_url_safe` real but resolver-free.
    monkeypatch.setattr(url_safety_module, "_resolve_and_check", _fake_resolve)
    yield


async def _url_rows(kb_id: str) -> list[URLSource]:
    async with database.AsyncSessionLocal() as session:
        return list(
            (
                await session.execute(
                    select(URLSource)
                    .where(URLSource.kb_id == kb_id)
                    .order_by(URLSource.id)
                )
            )
            .scalars()
            .all()
        )


async def _release_lock(owner: str, job_id: str):
    from services.task_lock import task_lock

    await task_lock.release_task(owner, job_id)


async def _agent_bound_to(kb_id: str) -> Agent | None:
    async with database.AsyncSessionLocal() as session:
        return (
            await session.execute(select(Agent).where(Agent.kb_id == kb_id))
        ).scalars().first()


# ── unbound KB: the load-bearing case ────────────────────────────────────────


async def test_unbound_kb_can_ingest_a_url(client, unbound_kb_id):
    """POST .../urls:create works with no agent bound and stores `kb_id`."""
    assert await _agent_bound_to(unbound_kb_id) is None, "fixture must be unbound"

    response = await client.post(
        f"/api/v1/knowledge-bases/{unbound_kb_id}/urls:create",
        json={"urls": ["https://example.com/unbound-page"]},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    assert body["urls"][0]["url"] == "https://example.com/unbound-page"
    assert body["urls"][0]["status"] == "pending"

    rows = await _url_rows(unbound_kb_id)
    assert len(rows) == 1
    assert rows[0].kb_id == unbound_kb_id
    assert await _agent_bound_to(unbound_kb_id) is None, "no agent was involved"

    if body.get("job_id"):
        await _release_lock(unbound_kb_id, body["job_id"])


async def test_unbound_kb_can_upload_a_file(client, unbound_kb_id):
    """POST .../files:upload works with no agent bound."""
    response = await client.post(
        f"/api/v1/knowledge-bases/{unbound_kb_id}/files:upload",
        files={
            "files": (
                "unbound.txt",
                BytesIO(b"Content for an unbound KB upload."),
                "text/plain",
            )
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["uploaded"] == 1
    assert body["failed"] == 0

    async with database.AsyncSessionLocal() as session:
        docs = list(
            (
                await session.execute(
                    select(KbDocument).where(KbDocument.kb_id == unbound_kb_id)
                )
            )
            .scalars()
            .all()
        )
    assert len(docs) == 1
    assert docs[0].filename == "unbound.txt"
    # KB-page ingests have no agent provenance.
    assert docs[0].source_agent_id is None


# ── URL lifecycle on the canonical routes ────────────────────────────────────


async def test_kb_url_list_create_refetch_delete_roundtrip(client, bound_kb_id):
    created = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/urls:create",
        json={"urls": ["https://example.com/one", "https://example.com/two"]},
    )
    assert created.status_code == 200, created.text
    created_body = created.json()
    assert created_body["total"] == 2
    if created_body.get("job_id"):
        await _release_lock(bound_kb_id, created_body["job_id"])

    listed = await client.get(f"/api/v1/knowledge-bases/{bound_kb_id}/urls:list")
    assert listed.status_code == 200
    listed_body = listed.json()
    assert listed_body["total"] == 2
    assert {
        item["url"] for item in listed_body["urls"]
    } == {"https://example.com/one", "https://example.com/two"}
    assert all("indexing_status" in item for item in listed_body["urls"])

    rows = await _url_rows(bound_kb_id)
    target_id = rows[0].id

    refetched = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/urls:refetch",
        json={"url_ids": [target_id], "force": True},
    )
    assert refetched.status_code == 200, refetched.text
    refetch_body = refetched.json()
    assert refetch_body["status"] == "queued"
    await _release_lock(bound_kb_id, refetch_body["job_id"])

    deleted = await client.delete(
        f"/api/v1/knowledge-bases/{bound_kb_id}/urls:delete?url_id={target_id}"
    )
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["success"] is True
    assert [row.id for row in await _url_rows(bound_kb_id)] != [target_id]

    cleared = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/urls:clear_all"
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["deleted_url_count"] >= 1
    assert await _url_rows(bound_kb_id) == []


async def test_clear_all_counts_url_rows_not_derived_documents(client, bound_kb_id):
    """B2: `deleted_count` means "items cleared on this surface" (URL rows).

    A URL that was never indexed has no derived `KbDocument`, so reporting
    `counters["docs"]` answered `deleted_count: 0` while the list visibly
    emptied.
    """
    created = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/urls:create",
        json={"urls": ["https://example.com/never-indexed"]},
    )
    assert created.status_code == 200, created.text
    if created.json().get("job_id"):
        await _release_lock(bound_kb_id, created.json()["job_id"])
    assert len(await _url_rows(bound_kb_id)) == 1

    cleared = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/urls:clear_all"
    )

    assert cleared.status_code == 200, cleared.text
    body = cleared.json()
    assert body["deleted_doc_count"] == 0, body
    assert body["deleted_url_count"] == 1, body
    assert body["deleted_count"] == 1, body
    assert await _url_rows(bound_kb_id) == []

async def test_kb_url_delete_rejects_a_url_from_another_kb(
    client, bound_kb_id, unbound_kb_id
):
    async with database.AsyncSessionLocal() as session:
        foreign = URLSource(
            kb_id=unbound_kb_id,
            url="https://example.com/foreign",
            normalized_url="https://example.com/foreign",
            status="pending",
        )
        session.add(foreign)
        await session.commit()
        foreign_id = foreign.id

    response = await client.delete(
        f"/api/v1/knowledge-bases/{bound_kb_id}/urls:delete?url_id={foreign_id}"
    )

    assert response.status_code == 404
    assert [row.id for row in await _url_rows(unbound_kb_id)] == [foreign_id]


async def test_kb_url_cancel_and_discover(client, bound_kb_id):
    cancelled = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/urls:cancel"
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["cancelled"] == 0

    discovered = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/urls:discover"
        "?url=https%3A%2F%2Fexample.com&max_depth=1&max_pages=5"
    )
    assert discovered.status_code == 200, discovered.text
    assert discovered.json()["discovered"] == 0


async def test_kb_url_crawl_site_queues_a_job(client, bound_kb_id):
    response = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/urls:crawl_site",
        json={"url": "https://example.com", "max_depth": 1, "max_pages": 5},
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "queued"
    await _release_lock(bound_kb_id, body["job_id"])


# ── files lifecycle on the canonical routes ──────────────────────────────────


async def test_kb_file_list_upload_delete_clear(client, bound_kb_id):
    upload = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/files:upload",
        files={
            "files": ("notes.txt", BytesIO(b"Notes for the KB file route."), "text/plain")
        },
    )
    assert upload.status_code == 200, upload.text
    upload_body = upload.json()
    assert upload_body["uploaded"] == 1
    file_id = upload_body["files"][0]["id"]

    listed = await client.get(f"/api/v1/knowledge-bases/{bound_kb_id}/files:list")
    assert listed.status_code == 200, listed.text
    listed_body = listed.json()
    assert listed_body["total"] == 1
    assert listed_body["files"][0]["filename"] == "notes.txt"

    deleted = await client.delete(
        f"/api/v1/knowledge-bases/{bound_kb_id}/files:delete?file_id={file_id}"
    )
    assert deleted.status_code == 200, deleted.text
    assert (await client.get(
        f"/api/v1/knowledge-bases/{bound_kb_id}/files:list"
    )).json()["total"] == 0

    await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/files:upload",
        files={"files": ("again.txt", BytesIO(b"Second upload."), "text/plain")},
    )
    cleared = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/files:clear_all"
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["deleted_count"] == 1


# ── index + summary ──────────────────────────────────────────────────────────


async def test_kb_index_rebuild_and_status(client, bound_kb_id):
    rebuild = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/index:rebuild",
        json={"force": False},
    )
    assert rebuild.status_code == 200, rebuild.text
    assert rebuild.json()["status"] == "queued"
    await _release_lock(bound_kb_id, rebuild.json()["job_id"])

    status_response = await client.get(
        f"/api/v1/knowledge-bases/{bound_kb_id}/index:status"
    )
    assert status_response.status_code == 200, status_response.text
    status_body = status_response.json()
    assert status_body["kb_id"] == bound_kb_id
    assert status_body["status"] == "idle"


async def test_kb_index_status_survives_a_running_task(
    client, bound_kb_id, default_agent_id
):
    """B1: `index:status` polls while a task runs, so it must answer 200.

    `acquire_task` used to store a bare `datetime`, and `kb_task_status` called
    `task_info.get("type")` on it -> `AttributeError: 'datetime' object has no
    attribute 'get'` -> 500 exactly during indexing.
    """
    from services.task_lock import TaskType, task_lock

    job_id = f"rebuild_{bound_kb_id}_b1"
    acquired, error = await task_lock.acquire_task(
        bound_kb_id, TaskType.INDEX_REBUILD, job_id
    )
    assert acquired, error
    try:
        response = await client.get(
            f"/api/v1/knowledge-bases/{bound_kb_id}/index:status"
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["status"] == "rebuilding"
        assert body["job_id"] == job_id

        legacy = await client.get(
            f"/api/v1/index:status?agent_id={default_agent_id}"
        )
        assert legacy.status_code == 200, legacy.text
        assert legacy.json()["job_id"] == job_id

        active = task_lock.get_active_tasks(bound_kb_id)
        # The contract `kb_task_status` relies on.
        assert active[job_id]["type"] == TaskType.INDEX_REBUILD.value
        assert "started_at" in active[job_id]
        # Legacy `.keys()` callers (api/v1/endpoints.py tasks:status) still work.
        assert job_id in active.keys()
    finally:
        await task_lock.release_task(bound_kb_id, job_id)

async def test_kb_sources_summary_counts_kb_rows(client, bound_kb_id):
    async with database.AsyncSessionLocal() as session:
        session.add_all(
            [
                URLSource(
                    kb_id=bound_kb_id,
                    url="https://example.com/indexed",
                    normalized_url="https://example.com/indexed",
                    status="success",
                    is_indexed=True,
                    content="x" * 2048,
                ),
                URLSource(
                    kb_id=bound_kb_id,
                    url="https://example.com/pending",
                    normalized_url="https://example.com/pending",
                    status="pending",
                ),
                KbDocument(
                    kb_id=bound_kb_id,
                    filename="ready.txt",
                    status="ready",
                    file_size=1024,
                ),
                KbDocument(
                    kb_id=bound_kb_id,
                    filename="processing.txt",
                    status="processing",
                    file_size=1024,
                ),
                # URL-derived documents are listed by `urls:*`, never by `files:*`,
                # so they must not inflate the file counters.
                KbDocument(
                    kb_id=bound_kb_id,
                    filename="url_1.txt",
                    status="ready",
                    file_size=4096,
                ),
            ]
        )
        await session.commit()

    response = await client.get(
        f"/api/v1/knowledge-bases/{bound_kb_id}/sources:summary"
    )

    assert response.status_code == 200, response.text
    body = response.json()
    # Every URL row counts towards `total`; only `is_indexed` rows are indexed.
    assert body["urls"]["total"] == 2
    assert body["urls"]["pending"] == 1
    assert body["urls"]["indexed"] == 1
    assert body["files"]["total"] == 2
    assert body["files"]["ready"] == 1
    assert body["files"]["processing"] == 1
    assert body["has_pending"] is True


# ── workspace scoping ────────────────────────────────────────────────────────


async def test_unknown_kb_is_404_on_every_source_route(client):
    missing = "00000000-0000-0000-0000-000000000000"

    responses = [
        await client.get(f"/api/v1/knowledge-bases/{missing}/urls:list"),
        await client.post(
            f"/api/v1/knowledge-bases/{missing}/urls:create",
            json={"urls": ["https://example.com/x"]},
        ),
        await client.post(f"/api/v1/knowledge-bases/{missing}/urls:clear_all"),
        await client.get(f"/api/v1/knowledge-bases/{missing}/files:list"),
        await client.get(f"/api/v1/knowledge-bases/{missing}/index:status"),
        await client.get(f"/api/v1/knowledge-bases/{missing}/sources:summary"),
    ]

    assert [r.status_code for r in responses] == [404] * len(responses)


async def test_cross_workspace_kb_is_404(
    client, monkeypatch, unbound_kb_id
):
    from models import Workspace
    from tests.conftest import make_test_kb

    async with database.AsyncSessionLocal() as session:
        other_workspace = Workspace(
            name="Other Source Workspace", owner_email="other-sources@example.com"
        )
        session.add(other_workspace)
        await session.flush()
        foreign_kb = make_test_kb(other_workspace.id, "Foreign Source KB")
        session.add(foreign_kb)
        await session.commit()
        foreign_kb_id = foreign_kb.id

    response = await client.post(
        f"/api/v1/knowledge-bases/{foreign_kb_id}/urls:create",
        json={"urls": ["https://example.com/hijack"]},
    )

    assert response.status_code == 404
    assert await _url_rows(foreign_kb_id) == []


# ── legacy agent-scoped aliases keep working, and delegate ───────────────────


async def test_legacy_url_create_alias_still_delegates(
    client, default_agent_id, bound_kb_id
):
    response = await client.post(
        f"/api/v1/urls:create?agent_id={default_agent_id}",
        json={"urls": ["https://example.com/legacy-alias"]},
    )

    assert response.status_code == 200, response.text
    rows = await _url_rows(bound_kb_id)
    assert [row.url for row in rows] == ["https://example.com/legacy-alias"]
    if response.json().get("job_id"):
        await _release_lock(bound_kb_id, response.json()["job_id"])


async def test_legacy_alias_409_when_the_agent_has_no_kb(client):
    from models import Workspace

    async with database.AsyncSessionLocal() as session:
        workspace = (
            await session.execute(select(Workspace).limit(1))
        ).scalar_one()
        agent = Agent(
            workspace_id=workspace.id,
            name="Unbound Alias Agent",
            model="deepseek-v4-flash",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
        )
        session.add(agent)
        await session.commit()
        agent_id = agent.id

    response = await client.post(
        f"/api/v1/urls:create?agent_id={agent_id}",
        json={"urls": ["https://example.com/no-kb"]},
    )

    assert response.status_code == 409
    assert "knowledge base" in response.json()["detail"].lower()


async def test_every_legacy_alias_409_when_the_agent_has_no_kb(client):
    """All five `files:*` / `sources:summary` aliases share one 409 gate.

    They used to answer 200 with an empty/zero payload for an unbound agent,
    which is exactly the kind of silent lie #17 removes.
    """
    from models import Workspace

    async with database.AsyncSessionLocal() as session:
        workspace = (
            await session.execute(select(Workspace).limit(1))
        ).scalar_one()
        agent = Agent(
            workspace_id=workspace.id,
            name="Unbound Files Alias Agent",
            model="deepseek-v4-flash",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
        )
        session.add(agent)
        await session.commit()
        agent_id = agent.id

    responses = [
        await client.get(f"/api/v1/files:list?agent_id={agent_id}"),
        await client.post(
            f"/api/v1/files:upload?agent_id={agent_id}",
            files={"files": ("x.txt", BytesIO(b"x"), "text/plain")},
        ),
        await client.delete(
            f"/api/v1/files:delete?agent_id={agent_id}&file_id=missing"
        ),
        await client.post(f"/api/v1/files:clear_all?agent_id={agent_id}"),
        await client.get(f"/api/v1/sources:summary?agent_id={agent_id}"),
    ]

    assert [r.status_code for r in responses] == [409] * len(responses), [
        (r.status_code, r.text) for r in responses
    ]
    for response in responses:
        assert "knowledge base" in response.json()["detail"].lower()
