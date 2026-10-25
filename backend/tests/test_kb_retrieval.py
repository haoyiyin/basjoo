"""KB retrieval: agent → KB resolution, KB-owned embedding config, isolation.

Retrieval is scoped by the KB (one Qdrant collection per KB), so there is no
tenant argument and no payload-level tenant filter. Threshold precedence is
explicit argument > agent config > service default.
"""

import pytest
from sqlalchemy import select

import database
from models import Agent, KnowledgeBase, Workspace, WorkspaceQuota
from services.kb_retrieval_service import KbRetrievalService
from services.kb_service import KbService

DIMENSION = 4

class RecordingParser:
    def __init__(self, embeddings=None):
        self.calls: list[dict] = []
        self.embeddings = embeddings

    async def embed_texts(self, texts, model, base_url, api_key=None):
        self.calls.append(
            {"texts": list(texts), "model": model, "base_url": base_url, "api_key": api_key}
        )
        if self.embeddings is not None:
            return self.embeddings
        return [[0.1] * DIMENSION for _ in texts]

class RecordingQdrant:
    def __init__(self, hits=None):
        self.calls: list[dict] = []
        self.hits = hits if hits is not None else []

    async def search_kb(self, kb_id, query_vector, top_k=5):
        self.calls.append({"kb_id": kb_id, "top_k": top_k, "vector": query_vector})
        return list(self.hits)

class BoomParser:
    async def embed_texts(self, texts, model, base_url, api_key=None):
        raise RuntimeError("provider down")

def _service(parser=None, qdrant=None) -> KbRetrievalService:
    service = KbRetrievalService()
    service.parser = parser or RecordingParser()
    service.qdrant = qdrant or RecordingQdrant()
    return service

def _hit(score, text, doc_id="doc-1", **payload):
    return {
        "score": score,
        "payload": {
            "text": text,
            "doc_id": doc_id,
            "chunk_index": 0,
            "filename": "notes.txt",
            **payload,
        },
    }

async def _workspace(email: str) -> int:
    async with database.AsyncSessionLocal() as session:
        workspace = Workspace(name=f"WS {email}", owner_email=email)
        session.add(workspace)
        await session.flush()
        session.add(WorkspaceQuota(workspace_id=workspace.id))
        await session.commit()
        return workspace.id

async def _kb(
    workspace_id: int,
    name: str,
    *,
    provider: str = "jina",
    model: str = "jina-embeddings-v3",
    base_url: str = "https://api.jina.ai/v1",
    api_key: str = "enc:kb-key",
) -> str:
    kb = await KbService().create_knowledge_base(
        workspace_id,
        name,
        embedding_provider=provider,
        embedding_model=model,
        embedding_base_url=base_url,
        embedding_api_key=api_key,
        embedding_dimension=DIMENSION,
    )
    return kb.id

async def _agent(
    workspace_id: int, name: str, kb_id: str | None = None, threshold: float | None = None
) -> str:
    async with database.AsyncSessionLocal() as session:
        agent = Agent(
            workspace_id=workspace_id,
            name=name,
            model="deepseek-v4-flash",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
            similarity_threshold=threshold,
            kb_id=kb_id,
        )
        session.add(agent)
        await session.commit()
        return agent.id

# ---- signatures ------------------------------------------------------------

def test_retrieve_takes_no_tenant_id():
    import inspect

    parameters = list(inspect.signature(KbRetrievalService.retrieve).parameters)
    assert parameters == ["self", "agent_id", "query", "top_k", "threshold"]

# ---- KB-owned embedding config --------------------------------------------

@pytest.mark.asyncio
async def test_retrieval_uses_the_kbs_embedding_config(setup_test_db):
    workspace_id = await _workspace("retrieval-config@example.com")
    kb_id = await _kb(
        workspace_id,
        "Config KB",
        provider="custom",
        model="BAAI/bge-m3",
        base_url="https://embed.example.com/v1",
        api_key="enc:custom-key",
    )
    agent_id = await _agent(workspace_id, "Config Agent", kb_id=kb_id)

    parser = RecordingParser()
    qdrant = RecordingQdrant([_hit(0.9, "chunk text")])
    results = await _service(parser, qdrant).retrieve(
        agent_id=agent_id, query="hello", top_k=5
    )

    assert parser.calls[0]["model"] == "BAAI/bge-m3"
    assert parser.calls[0]["base_url"] == "https://embed.example.com/v1"
    assert qdrant.calls[0]["kb_id"] == kb_id
    assert results[0]["text"] == "chunk text"

@pytest.mark.asyncio
async def test_retrieval_embeds_the_query_once(setup_test_db):
    workspace_id = await _workspace("retrieval-once@example.com")
    kb_id = await _kb(workspace_id, "Once KB")
    agent_id = await _agent(workspace_id, "Once Agent", kb_id=kb_id)

    parser = RecordingParser()
    await _service(parser, RecordingQdrant()).retrieve(
        agent_id=agent_id, query="one query", top_k=3
    )

    assert len(parser.calls) == 1
    assert parser.calls[0]["texts"] == ["one query"]

@pytest.mark.asyncio
async def test_retrieval_fetches_extra_candidates_for_filtering(setup_test_db):
    workspace_id = await _workspace("retrieval-overfetch@example.com")
    kb_id = await _kb(workspace_id, "Overfetch KB")
    agent_id = await _agent(workspace_id, "Overfetch Agent", kb_id=kb_id)

    qdrant = RecordingQdrant()
    await _service(RecordingParser(), qdrant).retrieve(
        agent_id=agent_id, query="q", top_k=4
    )

    assert qdrant.calls[0]["top_k"] == 8

# ---- unbound / missing / failure paths ------------------------------------

@pytest.mark.asyncio
async def test_unbound_agent_returns_empty(setup_test_db):
    workspace_id = await _workspace("retrieval-unbound@example.com")
    agent_id = await _agent(workspace_id, "Unbound Agent")

    parser = RecordingParser()
    qdrant = RecordingQdrant([_hit(0.99, "must not appear")])
    results = await _service(parser, qdrant).retrieve(agent_id=agent_id, query="q")

    assert results == []
    assert parser.calls == []
    assert qdrant.calls == []

@pytest.mark.asyncio
async def test_unknown_agent_returns_empty(setup_test_db):
    results = await _service().retrieve(agent_id="agt_missing", query="q")
    assert results == []

@pytest.mark.asyncio
async def test_empty_agent_id_returns_empty(setup_test_db):
    results = await _service().retrieve(agent_id="", query="q")
    assert results == []

@pytest.mark.asyncio
async def test_embed_failure_returns_empty(setup_test_db):
    workspace_id = await _workspace("retrieval-embed-fail@example.com")
    kb_id = await _kb(workspace_id, "Fail KB")
    agent_id = await _agent(workspace_id, "Fail Agent", kb_id=kb_id)

    qdrant = RecordingQdrant([_hit(0.99, "must not appear")])
    results = await _service(BoomParser(), qdrant).retrieve(
        agent_id=agent_id, query="q"
    )

    assert results == []
    assert qdrant.calls == []

@pytest.mark.asyncio
async def test_empty_embeddings_return_empty(setup_test_db):
    workspace_id = await _workspace("retrieval-empty-embed@example.com")
    kb_id = await _kb(workspace_id, "Empty Embed KB")
    agent_id = await _agent(workspace_id, "Empty Embed Agent", kb_id=kb_id)

    qdrant = RecordingQdrant()
    results = await _service(RecordingParser(embeddings=[]), qdrant).retrieve(
        agent_id=agent_id, query="q"
    )

    assert results == []
    assert qdrant.calls == []

# ---- threshold handling ----------------------------------------------------

@pytest.mark.asyncio
async def test_explicit_threshold_overrides_agent_threshold(setup_test_db):
    workspace_id = await _workspace("retrieval-explicit@example.com")
    kb_id = await _kb(workspace_id, "Explicit KB")
    agent_id = await _agent(
        workspace_id, "Explicit Agent", kb_id=kb_id, threshold=0.05
    )

    qdrant = RecordingQdrant(
        [
            _hit(0.08, "high", doc_id="d1"),
            _hit(0.06, "medium", doc_id="d2"),
            _hit(0.04, "low", doc_id="d3"),
        ]
    )
    results = await _service(qdrant=qdrant).retrieve(
        agent_id=agent_id, query="q", top_k=5, threshold=0.07
    )

    assert [r["text"] for r in results] == ["high"]

@pytest.mark.asyncio
async def test_agent_threshold_is_used_when_no_argument_is_given(setup_test_db):
    workspace_id = await _workspace("retrieval-agent-threshold@example.com")
    kb_id = await _kb(workspace_id, "Agent Threshold KB")
    agent_id = await _agent(
        workspace_id, "Agent Threshold Agent", kb_id=kb_id, threshold=0.05
    )

    qdrant = RecordingQdrant(
        [
            _hit(0.08, "high", doc_id="d1"),
            _hit(0.06, "medium", doc_id="d2"),
            _hit(0.04, "low", doc_id="d3"),
        ]
    )
    results = await _service(qdrant=qdrant).retrieve(
        agent_id=agent_id, query="q", top_k=5
    )

    assert [r["text"] for r in results] == ["high", "medium"]

@pytest.mark.asyncio
async def test_default_threshold_is_used_when_the_agent_row_has_none(setup_test_db):
    """Legacy rows may predate the column; the service default then applies."""
    from types import SimpleNamespace

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc_info):
            return False

        async def execute(self, stmt):
            agent = SimpleNamespace(id="agt_legacy", kb_id="kb-legacy", similarity_threshold=None)
            kb = SimpleNamespace(
                id="kb-legacy",
                embedding_model="jina-embeddings-v3",
                embedding_base_url=None,
                embedding_api_key=None,
            )
            return SimpleNamespace(first=lambda: (agent, kb))

    monkeypatch_target = "services.kb_retrieval_service.database.AsyncSessionLocal"
    import services.kb_retrieval_service as retrieval_module

    original = retrieval_module.database.AsyncSessionLocal
    retrieval_module.database.AsyncSessionLocal = lambda: FakeSession()
    try:
        service = _service(
            qdrant=RecordingQdrant(
                [
                    _hit(0.7, "above default", doc_id="d1"),
                    _hit(0.5, "below default", doc_id="d2"),
                ]
            )
        )
        service.default_threshold = 0.6
        results = await service.retrieve(agent_id="agt_legacy", query="q", top_k=5)
    finally:
        retrieval_module.database.AsyncSessionLocal = original

    assert monkeypatch_target  # documents the patched seam
    assert [r["text"] for r in results] == ["above default"]

def test_service_default_threshold_is_a_usable_fallback():
    """Only reached for rows that predate the agent threshold column."""
    service = KbRetrievalService()
    assert isinstance(service.default_threshold, float)
    assert 0.0 <= service.default_threshold <= 1.0

@pytest.mark.asyncio
async def test_results_are_capped_at_top_k(setup_test_db):
    workspace_id = await _workspace("retrieval-cap@example.com")
    kb_id = await _kb(workspace_id, "Cap KB")
    agent_id = await _agent(workspace_id, "Cap Agent", kb_id=kb_id)

    qdrant = RecordingQdrant(
        [_hit(0.9, f"chunk {i}", doc_id=f"d{i}") for i in range(10)]
    )
    results = await _service(qdrant=qdrant).retrieve(
        agent_id=agent_id, query="q", top_k=2, threshold=0.1
    )

    assert len(results) == 2
    assert [r["text"] for r in results] == ["chunk 0", "chunk 1"]

# ---- result shape and isolation -------------------------------------------

@pytest.mark.asyncio
async def test_results_carry_display_metadata(setup_test_db):
    workspace_id = await _workspace("retrieval-shape@example.com")
    kb_id = await _kb(workspace_id, "Shape KB")
    agent_id = await _agent(workspace_id, "Shape Agent", kb_id=kb_id)

    qdrant = RecordingQdrant(
        [
            _hit(
                0.91,
                "body",
                doc_id="doc-9",
                filename="guide.md",
                source_type="url",
                source_url="https://example.com/a",
                source_title="Guide",
                source_agent_id="agt_enrichment",
            )
        ]
    )
    results = await _service(qdrant=qdrant).retrieve(
        agent_id=agent_id, query="q", threshold=0.1
    )

    hit = results[0]
    assert hit["doc_id"] == "doc-9"
    assert hit["chunk_index"] == 0
    assert hit["filename"] == "guide.md"
    assert hit["source_type"] == "url"
    assert hit["source_url"] == "https://example.com/a"
    assert hit["source_title"] == "Guide"
    assert isinstance(hit["score"], float)

@pytest.mark.asyncio
async def test_each_agent_searches_only_its_own_kbs_collection(setup_test_db):
    """Two workspaces, two KBs, two agents: no cross-KB hit is possible."""
    ws_a = await _workspace("retrieval-iso-a@example.com")
    ws_b = await _workspace("retrieval-iso-b@example.com")
    kb_a = await _kb(ws_a, "ISO KB A")
    kb_b = await _kb(ws_b, "ISO KB B")
    agent_a = await _agent(ws_a, "ISO Agent A", kb_id=kb_a)
    agent_b = await _agent(ws_b, "ISO Agent B", kb_id=kb_b)

    qdrant = RecordingQdrant([_hit(0.9, "shared text")])
    service = _service(qdrant=qdrant)
    await service.retrieve(agent_id=agent_a, query="q", threshold=0.1)
    await service.retrieve(agent_id=agent_b, query="q", threshold=0.1)

    searched = [call["kb_id"] for call in qdrant.calls]
    assert searched == [kb_a, kb_b]
    assert kb_a != kb_b

@pytest.mark.asyncio
async def test_retrieval_ignores_a_deleted_kbs_row(setup_test_db):
    """A dangling agent.kb_id must degrade to empty, not crash."""
    workspace_id = await _workspace("retrieval-dangling@example.com")
    kb_id = await _kb(workspace_id, "Dangling KB")
    agent_id = await _agent(workspace_id, "Dangling Agent", kb_id=kb_id)

    async with database.AsyncSessionLocal() as session:
        kb = await session.get(KnowledgeBase, kb_id)
        await session.delete(kb)
        await session.commit()
        assert (
            await session.scalar(select(Agent.kb_id).where(Agent.id == agent_id))
        ) is None

    results = await _service().retrieve(agent_id=agent_id, query="q")
    assert results == []
