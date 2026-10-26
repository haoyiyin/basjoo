"""Regression proof: a URL rescued by the scheduler must reach real ingestion.

Issue #17: `URLFetchScheduler.fetch_never_fetched_urls` / `fetch_agent_urls` used
to call a local `fetch_single_url` that only wrote ``URLSource.content`` /
``status="success"`` / ``last_fetch_at``. No ``KbDocument`` was created, nothing
was embedded, no Qdrant point was upserted and ``is_indexed`` stayed False — so a
URL rescued from ``pending`` was stored text with zero retrieval, and a later
``process_url_refetch(force=False)`` short-circuited on the identical
``content_hash``. The KB stayed empty of retrievable content, forever.

These tests drive the scheduler with the REAL ``process_url_refetch``; only the
three outer-world seams are faked (crawler HTTP, embedding provider, Qdrant).
"""

from datetime import datetime, timezone

import pytest
from sqlalchemy import select

import database
from models import KbDocument, URLSource

#: Enough readable text for the KB pipeline to parse and produce a chunk.
HERMETIC_PAGE_CONTENT = (
    "Hermetic scheduler ingestion page. This paragraph exists so the document "
    "parser has enough readable text to produce at least one chunk for the KB "
    "pipeline, which is the whole point of routing the scheduler through the "
    "real ingest path instead of writing URLSource.content inline."
)

#: Deterministic 8-dim embedding so no provider call is made. The KB pipeline
#: self-heals the stored dimension from the MEASURED width, so 8 is fine.
HERMETIC_EMBEDDING = [0.01] * 8


@pytest.fixture(autouse=True)
def hermetic_ingest_seams(monkeypatch):
    """Fake every outer-world seam the real ingest path would touch."""
    import services.scrapling_client as scrapling_client_module
    import services.url_safety as url_safety_module
    from services.document_parser import DocumentParser
    from services.qdrant_service import QdrantKbService
    from services.scrapling_client import ScraplingClient

    async def fake_fetch(self, url, *args, **kwargs):
        return {
            "success": True,
            "title": "Hermetic Scheduler Page",
            "content": HERMETIC_PAGE_CONTENT,
            "content_hash": "hermetic-scheduler-hash",
            "metadata": {"status_code": 200, "final_url": url},
        }

    async def fake_embed_texts(self, texts, model, base_url, api_key=None, **kwargs):
        return [list(HERMETIC_EMBEDDING) for _ in texts]

    async def fake_batch_upsert_points(self, kb_id, points, batch_size=100):
        return len(points)

    async def fake_delete_points_by_doc_id(self, kb_id, doc_id):
        return 1

    async def fake_ensure_collection(self, kb_id, dimension):
        return kb_id

    def fake_resolve(hostname):
        return True, ""

    monkeypatch.setattr(ScraplingClient, "fetch", fake_fetch, raising=True)
    monkeypatch.setattr(
        scrapling_client_module, "_default_client", None, raising=True
    )
    monkeypatch.setattr(DocumentParser, "embed_texts", fake_embed_texts, raising=True)
    monkeypatch.setattr(
        QdrantKbService, "batch_upsert_points", fake_batch_upsert_points, raising=True
    )
    monkeypatch.setattr(
        QdrantKbService, "delete_points_by_doc_id", fake_delete_points_by_doc_id,
        raising=True,
    )
    monkeypatch.setattr(
        QdrantKbService, "ensure_collection", fake_ensure_collection, raising=True
    )
    monkeypatch.setattr(
        url_safety_module, "_resolve_and_check", fake_resolve, raising=True
    )
    yield


async def _release_all_locks(kb_id: str) -> None:
    """Release every task still registered for ``kb_id`` (module-global state)."""
    from services.task_lock import task_lock

    for task_id in list(task_lock.get_active_tasks(kb_id).keys()):
        await task_lock.release_task(kb_id, task_id)


async def _add_pending_url(
    kb_id: str, url: str = "https://example.com/scheduler-rescued"
) -> int:
    async with database.AsyncSessionLocal() as session:
        url_source = URLSource(
            kb_id=kb_id,
            url=url,
            normalized_url=url,
            status="pending",
            last_fetch_at=None,
        )
        session.add(url_source)
        await session.commit()
        return url_source.id


@pytest.mark.asyncio
async def test_catch_all_dispatches_one_job_per_kb(
    bound_kb_id, unbound_kb_id, monkeypatch
):
    """Rows are grouped by KB: one refetch job per KB, never one job per row."""
    from services.scheduler import URLFetchScheduler
    from services.task_lock import task_lock

    monkeypatch.setattr(
        "services.scheduler.AsyncSessionLocal", database.AsyncSessionLocal
    )

    async def _acquired(agent_id, task_type, task_id):
        return True, None

    async def _released(agent_id, task_id):
        return False

    monkeypatch.setattr(task_lock, "acquire_task", _acquired)
    monkeypatch.setattr(task_lock, "release_task", _released)

    bound_first = await _add_pending_url(bound_kb_id, "https://example.com/group-a")
    bound_second = await _add_pending_url(bound_kb_id, "https://example.com/group-b")
    unbound_first = await _add_pending_url(unbound_kb_id, "https://example.com/group-c")

    calls: list[dict] = []

    async def _record(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr("services.scheduler.process_url_refetch", _record)

    scheduler = URLFetchScheduler()
    async with database.AsyncSessionLocal() as db:
        await scheduler.fetch_never_fetched_urls(db)

    assert len(calls) == 2, (
        f"three pending rows across two KBs must become two jobs, not three; got {calls}"
    )
    by_kb = {call["kb_id"]: sorted(call["url_ids"]) for call in calls}
    assert by_kb == {
        bound_kb_id: sorted([bound_first, bound_second]),
        unbound_kb_id: [unbound_first],
    }, by_kb
    assert len({call["job_id"] for call in calls}) == 2, calls


@pytest.mark.asyncio
async def test_scheduler_catch_all_indexes_url_document(
    default_agent_id, bound_kb_id, monkeypatch
):
    """The catch-all must produce a KbDocument, not just URLSource.content.

    Auto-fetch is OFF for the fixture agent on purpose: the catch-all ignores
    ``enable_auto_fetch``. Only the crawler / embedding / Qdrant seams are faked,
    so ``process_url_refetch`` really runs (create doc, parse, chunk, embed,
    upsert, mark ``is_indexed``).
    """
    from services.scheduler import URLFetchScheduler

    # `services.scheduler` binds the sessionmaker at import time.
    monkeypatch.setattr(
        "services.scheduler.AsyncSessionLocal", database.AsyncSessionLocal
    )

    async with database.AsyncSessionLocal() as session:
        from models import Agent

        agent = await session.get(Agent, default_agent_id)
        assert agent.enable_auto_fetch is False, "fixture agent must not auto-fetch"

    url_id = await _add_pending_url(bound_kb_id)

    try:
        scheduler = URLFetchScheduler()
        async with database.AsyncSessionLocal() as db:
            await scheduler.fetch_never_fetched_urls(db)
    finally:
        await _release_all_locks(bound_kb_id)

    async with database.AsyncSessionLocal() as session:
        doc = await session.scalar(
            select(KbDocument).where(
                KbDocument.kb_id == bound_kb_id,
                KbDocument.filename == f"url_{url_id}.txt",
            )
        )
        assert doc is not None, (
            "the scheduler must route through process_url_refetch, which creates "
            f"KbDocument url_{url_id}.txt; no such document exists for KB "
            f"{bound_kb_id}"
        )
        assert doc.status == "ready", (
            f"the URL document must be chunked+embedded+upserted (status=ready); "
            f"got status={doc.status!r} error={doc.error_message!r}"
        )

        url_source = await session.get(URLSource, url_id)
        assert url_source.status == "success", url_source.status
        assert url_source.is_indexed is True, (
            "is_indexed must be True once the document reached ready"
        )

        from api.v1.kb_endpoints import build_kb_sources_summary

        summary = await build_kb_sources_summary(session, bound_kb_id)
        assert summary.urls.total >= 1, summary


@pytest.mark.asyncio
async def test_scheduler_skips_when_lock_is_held(bound_kb_id, monkeypatch):
    """A held lock means "skip this cycle": no raise, no row touched."""
    from services.scheduler import URLFetchScheduler
    from services.task_lock import task_lock

    monkeypatch.setattr(
        "services.scheduler.AsyncSessionLocal", database.AsyncSessionLocal
    )

    async def _denied(agent_id, task_type, task_id):
        return False, "already running"

    # Recorded, not raised: the scheduler swallows task exceptions, so a raise
    # here would look exactly like "skipped" and hide the bug.
    calls: list[dict] = []

    async def _must_not_run(**kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(task_lock, "acquire_task", _denied)
    monkeypatch.setattr("services.scheduler.process_url_refetch", _must_not_run)

    url_id = await _add_pending_url(bound_kb_id)

    scheduler = URLFetchScheduler()
    async with database.AsyncSessionLocal() as db:
        await scheduler.fetch_never_fetched_urls(db)

    assert calls == [], (
        "a KB whose lock is held must not be handed to process_url_refetch "
        f"this cycle; got {calls}"
    )

    async with database.AsyncSessionLocal() as session:
        url_source = await session.get(URLSource, url_id)
        assert url_source.status == "pending", (
            f"a skipped cycle must leave the row untouched; got {url_source.status!r}"
        )
        assert url_source.last_fetch_at is None, url_source.last_fetch_at


def _install_fetching_write_breaker(monkeypatch):
    """Proxy `database.AsyncSessionLocal` so the ``status="fetching"`` commit explodes.

    url_service writes ``status = "fetching"`` and commits it BEFORE the inner
    ``try``. When that commit raises, the outer handler used to swallow it and the
    row stayed ``fetching`` with ``last_error IS NULL`` — a state neither the
    catch-all nor the recurring pass ever retries.
    """
    real_sessionmaker = database.AsyncSessionLocal
    state = {"raised": False}

    class _Breaker:
        def __init__(self, inner):
            object.__setattr__(self, "_inner", inner)

        async def __aenter__(self):
            await self._inner.__aenter__()
            return self

        async def __aexit__(self, *exc_info):
            return await self._inner.__aexit__(*exc_info)

        def __getattr__(self, name):
            return getattr(object.__getattribute__(self, "_inner"), name)

        def _writing_fetching(self) -> bool:
            inner = object.__getattribute__(self, "_inner")
            candidates = list(inner.dirty) + list(inner.identity_map.values())
            return any(
                isinstance(obj, URLSource) and getattr(obj, "status", None) == "fetching"
                for obj in candidates
            )

        async def commit(self):
            inner = object.__getattribute__(self, "_inner")
            writing_fetching = self._writing_fetching()
            # Persist first, then explode: a real commit failure can leave the
            # row written (WAL flushed) while the caller never learns about it,
            # which is exactly the stuck-`fetching` shape being guarded here.
            await inner.commit()
            if writing_fetching and not state["raised"]:
                state["raised"] = True
                raise RuntimeError("simulated failure writing status='fetching'")

    def _factory():
        return _Breaker(real_sessionmaker())

    monkeypatch.setattr(database, "AsyncSessionLocal", _factory)
    return state


@pytest.mark.asyncio
async def test_refetch_records_failure_when_the_fetching_write_breaks(bound_kb_id, monkeypatch):
    """A failure while persisting ``fetching`` must land on ``failed`` + last_error."""
    from services.task_lock import TaskType, task_lock
    from services.url_service import process_url_refetch

    state = _install_fetching_write_breaker(monkeypatch)

    url_id = await _add_pending_url(bound_kb_id)

    job_id = "t1"
    acquired, err = await task_lock.acquire_task(
        bound_kb_id, TaskType.URL_REFETCH, job_id
    )
    assert acquired is True, err
    try:
        await process_url_refetch(
            kb_id=bound_kb_id, url_ids=[url_id], force=False, job_id=job_id
        )
    finally:
        await _release_all_locks(bound_kb_id)

    assert state["raised"] is True, (
        "the test mechanism never fired: the status='fetching' commit was not "
        "intercepted, so this regression is not being exercised"
    )

    async with database.AsyncSessionLocal() as session:
        url_source = await session.get(URLSource, url_id)
        assert url_source.status == "failed", (
            f"a failure while writing the 'fetching' state must be recorded as "
            f"failed; row is stuck at {url_source.status!r}"
        )
        assert url_source.last_error, (
            "last_error must explain the failure; got "
            f"{url_source.last_error!r}"
        )
