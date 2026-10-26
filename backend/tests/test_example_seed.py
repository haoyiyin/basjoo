"""Tests for the built-in example seed (services.example_seed).

Hermetic on purpose: no TEI container, no Qdrant, no Redis. The embedding probe and
the Qdrant collection call are monkeypatched, so what is under test is the seed's own
contract:

* exactly one example agent per workspace, ever (idempotency — agents AND a KB
  named ``EXAMPLE_KB_NAME`` are both guards),
* the agent is bound to a `local`-provider KB whose dimension is the MEASURED width,
* one pending URLSource with the project home page, written with `kb_id=` and a
  fetch QUEUED through `asyncio.create_task` using the frozen keyword-only
  `process_url_refetch(kb_id=..., url_ids=[id], force=False, job_id=...)` signature,
* a failed probe / a failed write never raises and never leaves a half-seeded
  workspace behind — login must not be able to fail because of this code.

No live Scrapling fetch ever runs here: `process_url_refetch` and
`asyncio.create_task` are stubbed by the autouse `queued_fetches` fixture. The
queued coroutine is captured, not scheduled, so a test can await it itself and
inspect the exact keyword arguments the seed used.
"""

import asyncio
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from sqlalchemy import func, select

import database
from database import Base, configure_database
from models import Agent, KnowledgeBase, URLSource, Workspace, WorkspaceQuota
from models import normalize_url
from config import settings
from services.example_seed import (
    EXAMPLE_AGENT_NAME,
    EXAMPLE_KB_NAME,
    EXAMPLE_URL,
    ensure_example_agent,
)

# Captured before the `queued_fetches` fixture stubs the module attribute, so the
# seed test can validate the queued kwargs against the function actually shipped.
from services.url_service import process_url_refetch as real_process_url_refetch

BACKEND_DIR = Path(__file__).resolve().parents[1]
TEST_DB_DIR = BACKEND_DIR / ".pytest_dbs"

LOCAL_MODEL = "ibm-granite/granite-embedding-97m-multilingual-r2"
LOCAL_BASE_URL = "http://local-embed:80/v1"
MEASURED_DIMENSION = 384

def patch_local_embeddings(monkeypatch, *, dimension=MEASURED_DIMENSION, probe_error=None):
    """Replace the TEI round-trip with a deterministic (or failing) probe."""
    calls: list[dict] = []

    async def fake_embed_texts(self, texts, model, base_url, api_key=None, timeout=None):
        calls.append(
            {
                "count": len(texts),
                "model": model,
                "base_url": base_url,
                "api_key": api_key,
            }
        )
        if probe_error is not None:
            raise probe_error
        return [[0.01] * dimension for _ in texts]

    monkeypatch.setattr(
        "services.document_parser.DocumentParser.embed_texts", fake_embed_texts
    )
    return calls

def patch_qdrant(monkeypatch, *, fail=False):
    """Replace the vector-store side of KB creation; records collection widths."""
    collections: list[tuple] = []

    async def fake_ensure_collection(self, kb_id, dimension):
        if fail:
            raise RuntimeError("qdrant unreachable")
        collections.append((str(kb_id), int(dimension)))
        return f"kb_{str(kb_id).replace('-', '')[:12]}"

    async def fake_delete_collection(self, kb_id):
        return True

    monkeypatch.setattr(
        "services.qdrant_service.QdrantKbService.ensure_collection",
        fake_ensure_collection,
    )
    monkeypatch.setattr(
        "services.qdrant_service.QdrantKbService.delete_collection",
        fake_delete_collection,
    )
    return collections

class QueuedFetchRecorder:
    """Capture `asyncio.create_task` calls instead of scheduling them.

    The seed hands the coroutine to `create_task`; recording it (rather than
    letting the loop run it) keeps the unit test deterministic and lets the test
    await it explicitly to see which keywords the seed used.
    """

    def __init__(self):
        self.coros: list = []

    def __call__(self, coro, **kwargs):
        self.coros.append(coro)
        return self

    # Minimal asyncio.Task surface the seed might touch (it does not, but be safe).
    def done(self) -> bool:
        return True

    def cancel(self) -> None:
        return None

    def close_all(self) -> None:
        while self.coros:
            coro = self.coros.pop(0)
            try:
                coro.close()
            except Exception:
                pass

    async def await_all(self) -> None:
        while self.coros:
            coro = self.coros.pop(0)
            try:
                await coro
            except AssertionError:
                raise
            except Exception:
                pass

class _AsyncioShim:
    """`asyncio` with a recording `create_task`, everything else delegated.

    Patching the *real* `asyncio.create_task` would break SQLAlchemy, whose async
    engine calls it internally (`asyncio.shield` -> `_ensure_future`). Rebinding
    only `services.example_seed.asyncio` keeps the seed's own `create_task` call
    under observation while the rest of the process keeps the real module.
    """

    def __init__(self, recorder):
        self._recorder = recorder

    def create_task(self, coro, **kwargs):
        return self._recorder(coro, **kwargs)

    def __getattr__(self, name):
        return getattr(asyncio, name)

@pytest.fixture(autouse=True)
def queued_fetches(monkeypatch):
    """Stub the seed's background fetch seam for every test in this file.

    Returns the recorder. `services.url_service.process_url_refetch` is patched
    where `_queue_example_fetch` imports it from, so nothing can reach Scrapling.
    """
    recorder = QueuedFetchRecorder()
    refetch = AsyncMock(return_value=None)

    monkeypatch.setattr("services.url_service.process_url_refetch", refetch)
    monkeypatch.setattr(
        "services.example_seed.asyncio", _AsyncioShim(recorder), raising=True
    )
    recorder.refetch = refetch
    yield recorder
    # Close any coroutine a test did not await, so an un-run background job never
    # leaks a "coroutine was never awaited" warning into an unrelated test.
    recorder.close_all()

@pytest_asyncio.fixture(loop_scope="function")
async def clean_workspace():
    """A workspace with a quota row and NOT a single agent — a fresh install."""
    TEST_DB_DIR.mkdir(exist_ok=True)
    db_path = TEST_DB_DIR / f"seed_{uuid.uuid4().hex}.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    await configure_database(os.environ["DATABASE_URL"])

    async with database.engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with database.AsyncSessionLocal() as session:
        workspace = Workspace(name="Seed Workspace", owner_email="seed@example.com")
        session.add(workspace)
        await session.flush()
        session.add(WorkspaceQuota(workspace_id=workspace.id))
        await session.commit()
        workspace_id = workspace.id

    yield workspace_id

async def _counts(workspace_id: int) -> dict[str, int]:
    async with database.AsyncSessionLocal() as session:
        agents = await session.scalar(
            select(func.count(Agent.id)).where(Agent.workspace_id == workspace_id)
        )
        kbs = await session.scalar(
            select(func.count(KnowledgeBase.id)).where(
                KnowledgeBase.workspace_id == workspace_id
            )
        )
        urls = await session.scalar(select(func.count(URLSource.id)))
    return {"agents": agents or 0, "kbs": kbs or 0, "url_sources": urls or 0}

@pytest.mark.asyncio
async def test_seed_creates_one_example_agent_bound_to_a_local_kb(
    clean_workspace, monkeypatch, queued_fetches
):
    probe_calls = patch_local_embeddings(monkeypatch)
    collections = patch_qdrant(monkeypatch)

    await ensure_example_agent(clean_workspace)

    counts = await _counts(clean_workspace)
    assert counts == {"agents": 1, "kbs": 1, "url_sources": 1}, counts

    # (a) exactly one agent, and it is the example one.
    async with database.AsyncSessionLocal() as session:
        agent = (
            await session.execute(
                select(Agent).where(Agent.workspace_id == clean_workspace)
            )
        ).scalars().one()

        assert agent.name == EXAMPLE_AGENT_NAME
        assert agent.deleted_at is None
        assert agent.is_active is True
        assert agent.provider_type == "openai"
        assert agent.model == ""
        assert agent.api_key == ""
        assert agent.api_base == ""
        assert agent.kb_id, "the example agent ships with a bound KB"
        # A customer-service persona that describes Basjoo and admits ignorance.
        assert "Basjoo" in agent.system_prompt
        assert agent.system_prompt.strip()

        # (b) the bound KB is the local provider, at the MEASURED width, keyless.
        kb = await session.get(KnowledgeBase, agent.kb_id)
        assert kb is not None
        assert kb.name == EXAMPLE_KB_NAME
        assert kb.embedding_provider == "local"
        assert kb.embedding_model == LOCAL_MODEL
        assert kb.embedding_base_url == LOCAL_BASE_URL
        assert kb.embedding_api_key is None
        assert kb.embedding_dimension == MEASURED_DIMENSION
        assert str(kb.status) == "active"

        # (c) one pending URL row pointing at the project home page, owned by the
        # KB (URLSource has no agent column any more).
        source = (
            await session.execute(
                select(URLSource).where(URLSource.kb_id == agent.kb_id)
            )
        ).scalars().one()
        assert source.url == EXAMPLE_URL
        assert source.normalized_url == normalize_url(EXAMPLE_URL)
        assert source.status == "pending"
        assert source.is_indexed is False
        source_id = source.id

    # The seed takes its provider coordinates from config, not from hard-coded
    # literals: the local defaults are the TEI container and the granite model.
    assert settings.local_embedding_model == LOCAL_MODEL
    assert settings.local_embedding_base_url == LOCAL_BASE_URL

    # The probe asks the local provider, with no credentials.
    assert len(probe_calls) == 1, probe_calls
    assert probe_calls[0]["model"] == LOCAL_MODEL
    assert probe_calls[0]["base_url"] == LOCAL_BASE_URL
    assert probe_calls[0]["api_key"] is None

    # The collection is created at the measured width, not a name-derived guess.
    assert collections == [(kb.id, MEASURED_DIMENSION)]

    # (d) INVERTED from the old "no job scheduled" contract: the seed queues
    # exactly one background fetch, through the frozen keyword-only signature,
    # keyed by kb_id (never agent_id), non-blocking.
    assert len(queued_fetches.coros) == 1, "the seed must queue exactly one fetch"
    await queued_fetches.await_all()

    queued_fetches.refetch.assert_awaited_once()
    call_kwargs = queued_fetches.refetch.await_args.kwargs
    assert set(call_kwargs) >= {"kb_id", "url_ids", "force", "job_id"}
    assert call_kwargs["kb_id"] == kb.id
    assert call_kwargs["kb_id"] != agent.id
    assert call_kwargs["url_ids"] == [source_id]
    assert call_kwargs["force"] is False
    assert isinstance(call_kwargs["job_id"], str) and call_kwargs["job_id"]
    assert "agent_id" not in call_kwargs, (
        "process_url_refetch is kb-scoped now; the seed must not pass agent_id"
    )
    # Provenance for the derived KbDocument: KB-page ingest has no agent behind it.
    assert call_kwargs.get("source_agent_id") is None

    # And the queued kwargs must be accepted by the REAL function, not just by the
    # AsyncMock: reintroducing `agent_id` as a required keyword (or dropping
    # `kb_id`) makes this fail by name.
    import inspect

    inspect.signature(real_process_url_refetch).bind(**call_kwargs)

@pytest.mark.asyncio
async def test_ensure_example_agent_is_idempotent(clean_workspace, monkeypatch):
    probe_calls = patch_local_embeddings(monkeypatch)
    patch_qdrant(monkeypatch)

    await ensure_example_agent(clean_workspace)
    await ensure_example_agent(clean_workspace)

    # Acceptance: calling it twice still yields exactly ONE agent (and one KB/URL).
    counts = await _counts(clean_workspace)
    assert counts == {"agents": 1, "kbs": 1, "url_sources": 1}, counts

    # The second call short-circuits on the agent guard — it does not even probe.
    assert len(probe_calls) == 1, probe_calls

@pytest.mark.asyncio
async def test_seed_respects_a_soft_deleted_agent(clean_workspace, monkeypatch):
    """A removed example must not come back on the next login."""
    patch_local_embeddings(monkeypatch)
    patch_qdrant(monkeypatch)

    async with database.AsyncSessionLocal() as session:
        session.add(
            Agent(
                workspace_id=clean_workspace,
                name="Gone Agent",
                system_prompt="deleted by the operator",
                model="",
                api_key="",
                api_base="",
                deleted_at=datetime.now(timezone.utc),
                is_active=False,
            )
        )
        await session.commit()

    await ensure_example_agent(clean_workspace)

    counts = await _counts(clean_workspace)
    assert counts == {"agents": 1, "kbs": 0, "url_sources": 0}, counts

@pytest.mark.asyncio
async def test_unreachable_embedding_provider_never_raises(clean_workspace, monkeypatch):
    """No TEI container (typical test/startup state) → skip quietly, seed nothing."""
    patch_local_embeddings(monkeypatch, probe_error=RuntimeError("connection refused"))
    patch_qdrant(monkeypatch)

    await ensure_example_agent(clean_workspace)  # must not raise

    counts = await _counts(clean_workspace)
    assert counts == {"agents": 0, "kbs": 0, "url_sources": 0}, counts

@pytest.mark.asyncio
async def test_empty_probe_result_skips_the_seed(clean_workspace, monkeypatch):
    patch_local_embeddings(monkeypatch, dimension=0)
    patch_qdrant(monkeypatch)

    await ensure_example_agent(clean_workspace)

    counts = await _counts(clean_workspace)
    assert counts == {"agents": 0, "kbs": 0, "url_sources": 0}, counts

@pytest.mark.asyncio
async def test_vector_store_failure_leaves_no_half_seeded_workspace(
    clean_workspace, monkeypatch
):
    """A crash mid-seed rolls back and still must not break the caller (login)."""
    patch_local_embeddings(monkeypatch)
    patch_qdrant(monkeypatch, fail=True)

    await ensure_example_agent(clean_workspace)  # swallows the Qdrant error

    counts = await _counts(clean_workspace)
    assert counts == {"agents": 0, "kbs": 0, "url_sources": 0}, counts

@pytest.mark.asyncio
async def test_seed_without_workspace_is_a_noop(monkeypatch):
    probe_calls = patch_local_embeddings(monkeypatch)
    patch_qdrant(monkeypatch)

    await ensure_example_agent(None)
    await ensure_example_agent(0)

    assert probe_calls == []
