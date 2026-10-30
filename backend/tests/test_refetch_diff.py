"""Refetching an unchanged page performs zero embedding calls (#47).

The acceptance sentence is "Refetching an unchanged page performs zero embedding
calls (assert call count)". `mock.call_count` is therefore the assertion — not a
helper's return value, not a log line.

The test runs the REAL ``process_url_refetch`` twice against the same mocked
page. Only the three outer-world seams are faked (crawler HTTP, embedding
provider, Qdrant), so the pass that decides "unchanged" is the production one:
``compute_item_hash`` over the normalised text, compared with the ``item_hash``
the first pass stamped on the ``kb_documents`` row.

The stored key is a hash of the **normalised** text (collapsed whitespace runs,
trailing newline ignored) because the same page served twice rarely has identical
bytes: a CMS footer counter, a trailing newline, a re-wrapped paragraph. Those
differences must not re-embed a 300-page site.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import select

import database
from models import KbDocument, URLSource, compute_item_hash, normalise_page_text

#: Long enough for the parser to produce at least one chunk.
PAGE_TEXT = (
    "Diff refetch page. This paragraph exists so the parser produces at least "
    "one chunk, which is what makes the embedding call countable. The point of "
    "the test is that the second refetch never reaches this code path again."
)

#: Deterministic vector: the KB self-heals its stored dimension from the width.
EMBEDDING = [0.01] * 8


class _CountingEmbedder:
    """Counts every ``embed_texts`` call so the assertion is a call count."""

    def __init__(self):
        self.call_count = 0
        self.chunks_embedded = 0

    async def __call__(self, texts, model, base_url, api_key=None, **kwargs):
        self.call_count += 1
        self.chunks_embedded += len(texts)
        return [list(EMBEDDING) for _ in texts]


@pytest.fixture(autouse=True)
def hermetic_refetch_seams(monkeypatch):
    """Fake the crawler, the embedding provider and Qdrant. Nothing else."""
    import services.url_safety as url_safety_module
    from services.crawler import SiteCrawler
    from services.document_parser import DocumentParser
    from services.qdrant_service import QdrantKbService

    #: Mutable per-test page body, so "changed page" is a one-line swap.
    page = {"content": PAGE_TEXT, "title": "Diff Refetch Page"}

    async def fake_crawl_single_page(self, url, *args, **kwargs):
        result = MagicMock()
        result.error = None
        result.url = url
        result.title = page["title"]
        result.content = page["content"]
        result.metadata = {"status_code": 200}
        return result

    async def fake_batch_upsert_points(self, kb_id, points, batch_size=100):
        return len(points)

    async def fake_delete_points_by_doc_id(self, kb_id, doc_id):
        return 1

    async def fake_ensure_collection(self, kb_id, dimension):
        return kb_id

    def fake_resolve(hostname):
        return True, ""

    monkeypatch.setattr(
        SiteCrawler, "crawl_single_page", fake_crawl_single_page, raising=True
    )
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
    monkeypatch.setattr(
        url_safety_module, "_resolve_and_check", fake_resolve, raising=True
    )

    counter = _CountingEmbedder()
    monkeypatch.setattr(DocumentParser, "embed_texts", counter, raising=True)
    yield {"page": page, "embedder": counter}


async def _add_url(kb_id: str, url: str) -> int:
    async with database.AsyncSessionLocal() as session:
        row = URLSource(
            kb_id=kb_id,
            url=url,
            normalized_url=url,
            status="pending",
        )
        session.add(row)
        await session.commit()
        return row.id


async def _release_locks(kb_id: str) -> None:
    from services.task_lock import task_lock

    for task_id in list(task_lock.get_active_tasks(kb_id).keys()):
        await task_lock.release_task(kb_id, task_id)


async def _refetch(kb_id: str, url_id: int, job_id: str) -> None:
    from services.url_service import process_url_refetch

    await process_url_refetch(
        kb_id=kb_id,
        url_ids=[url_id],
        force=False,
        job_id=job_id,
        release_lock=False,
    )


@pytest.mark.asyncio
async def test_unchanged_page_skips_embedding_entirely(
    bound_kb_id, hermetic_refetch_seams
):
    """Second refetch of identical content: `embed_texts` call_count stays 1.

    That single call is the first pass. The second pass must find the same
    normalised text, bump ``last_fetched_at`` and stop — no parse, no chunk, no
    embed, no Qdrant upsert.
    """
    embedder = hermetic_refetch_seams["embedder"]
    url_id = await _add_url(bound_kb_id, "https://example.com/unchanged-page")

    try:
        await _refetch(bound_kb_id, url_id, "job-first")
        first_pass_calls = embedder.call_count
        assert first_pass_calls >= 1, (
            "the first refetch must embed: the page was never indexed"
        )

        async with database.AsyncSessionLocal() as session:
            first_doc = (
                await session.execute(
                    select(KbDocument).where(
                        KbDocument.kb_id == bound_kb_id,
                        KbDocument.filename == f"url_{url_id}.txt",
                    )
                )
            ).scalar_one()
            first_doc_id = first_doc.id
            first_hash = first_doc.item_hash
            first_fetch_at = (
                await session.execute(
                    select(URLSource.last_fetch_at).where(URLSource.id == url_id)
                )
            ).scalar_one()

        assert first_hash == compute_item_hash(PAGE_TEXT), (
            "the diff key must be the hash of the normalised indexed text"
        )

        await _refetch(bound_kb_id, url_id, "job-second")

        assert embedder.call_count == first_pass_calls, (
            "refetching identical content must perform ZERO additional embedding "
            f"calls; got {embedder.call_count - first_pass_calls}"
        )

        async with database.AsyncSessionLocal() as session:
            # Same document row: an unchanged page is not re-created either.
            docs = list(
                (
                    await session.execute(
                        select(KbDocument).where(
                            KbDocument.kb_id == bound_kb_id,
                            KbDocument.filename == f"url_{url_id}.txt",
                        )
                    )
                )
                .scalars()
                .all()
            )
            assert [doc.id for doc in docs] == [first_doc_id], (
                "an unchanged refetch must not create a second document row"
            )
            assert docs[0].item_hash == first_hash

            source = (
                await session.execute(select(URLSource).where(URLSource.id == url_id))
            ).scalar_one()
            assert source.status == "success"
            assert source.is_indexed is True
            assert source.last_fetch_at is not None
            assert source.last_fetch_at >= first_fetch_at, (
                "the unchanged path must still bump last_fetch_at"
            )
    finally:
        await _release_locks(bound_kb_id)


@pytest.mark.asyncio
async def test_changed_page_re_embeds(bound_kb_id, hermetic_refetch_seams):
    """The diff must not swallow real changes: new text → a new embedding call."""
    embedder = hermetic_refetch_seams["embedder"]
    url_id = await _add_url(bound_kb_id, "https://example.com/changing-page")

    try:
        await _refetch(bound_kb_id, url_id, "job-changed-1")
        calls_after_first = embedder.call_count
        assert calls_after_first >= 1

        hermetic_refetch_seams["page"]["content"] = (
            PAGE_TEXT + " A new paragraph was appended, so the page really changed."
        )
        await _refetch(bound_kb_id, url_id, "job-changed-2")

        assert embedder.call_count > calls_after_first, (
            "a changed page must be re-embedded; the diff key ignored the change"
        )

        async with database.AsyncSessionLocal() as session:
            source = (
                await session.execute(select(URLSource).where(URLSource.id == url_id))
            ).scalar_one()
            assert source.status == "success"
            assert source.is_indexed is True
    finally:
        await _release_locks(bound_kb_id)


@pytest.mark.asyncio
async def test_force_refetch_still_re_embeds_even_when_unchanged(
    bound_kb_id, hermetic_refetch_seams
):
    """"Refetch now" is an operator instruction, not a diff opportunity."""
    embedder = hermetic_refetch_seams["embedder"]
    url_id = await _add_url(bound_kb_id, "https://example.com/forced-page")

    try:
        await _refetch(bound_kb_id, url_id, "job-force-1")
        calls_after_first = embedder.call_count

        from services.url_service import process_url_refetch

        await process_url_refetch(
            kb_id=bound_kb_id,
            url_ids=[url_id],
            force=True,
            job_id="job-force-2",
            release_lock=False,
        )

        assert embedder.call_count > calls_after_first, (
            "force=True must bypass the diff and re-index the page"
        )
    finally:
        await _release_locks(bound_kb_id)


def test_item_hash_ignores_whitespace_noise_but_not_content():
    """The key is conservative: layout noise is equal, real text is not."""
    base = "Alpha beta gamma.\nDelta epsilon zeta."
    assert compute_item_hash(base) == compute_item_hash(
        "Alpha   beta\ngamma.\n\n  Delta epsilon zeta.\n"
    ), (
        "whitespace runs and a trailing newline describe the same page; "
        "hashing raw bytes would re-embed a site every time its CMS reformats"
    )
    assert compute_item_hash(base) != compute_item_hash(
        "Alpha beta gamma. Delta epsilon zeta!"
    ), "a punctuation change is a content change"

    assert normalise_page_text("  a \n\n b  ") == "a b"


@pytest.mark.asyncio
async def test_scheduler_reports_unchanged_page(
    bound_kb_id, default_agent_id, hermetic_refetch_seams, monkeypatch
):
    """`URLFetchScheduler.report_unchanged_urls` names the skipped rows."""
    from services.scheduler import URLFetchScheduler

    monkeypatch.setattr(
        "services.scheduler.AsyncSessionLocal", database.AsyncSessionLocal
    )

    url_id = await _add_url(bound_kb_id, "https://example.com/report-unchanged")
    try:
        await _refetch(bound_kb_id, url_id, "job-report")

        scheduler = URLFetchScheduler()
        unchanged = await scheduler.report_unchanged_urls(bound_kb_id)
        assert url_id in unchanged, (
            "the scheduler must be able to report an unchanged refetch without "
            f"re-embedding; got {unchanged}"
        )
    finally:
        await _release_locks(bound_kb_id)
