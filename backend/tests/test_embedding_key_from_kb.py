"""Issue #11 regression: the embedding API key comes from the KB, never the agent.

Before the KB-decoupling change the key resolver took an `Agent` and branched on
`agent.embedding_provider`; an agent configured as `custom` with no
`jina_api_key`/`siliconflow_api_key` therefore passed `api_key=None` to the
provider and ingestion/retrieval failed silently.

`get_embedding_api_key(kb)` is now the only resolver, and it reads the KB's own
encrypted `embedding_api_key`.
"""

from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

import database
from core.encryption import encrypt_api_key
from models import Agent, KbDocument, KnowledgeBase, Workspace, WorkspaceQuota
from services.kb_document_processor import KbDocumentProcessor, get_embedding_api_key

PLAINTEXT_KEY = "kb-owned-embedding-key"
ENCRYPTED_KEY = encrypt_api_key(PLAINTEXT_KEY)
DIMENSION = 8

@pytest.fixture(autouse=True)
def fake_qdrant(monkeypatch):
    from services.qdrant_service import QdrantKbService

    async def ensure_collection(self, kb_id, dimension):
        return f"kb_{str(kb_id).replace('-', '')[:12]}"

    async def delete_collection(self, kb_id):
        return True

    async def batch_upsert_points(self, kb_id, points, batch_size=100):
        return len(points)

    monkeypatch.setattr(QdrantKbService, "ensure_collection", ensure_collection)
    monkeypatch.setattr(QdrantKbService, "delete_collection", delete_collection)
    monkeypatch.setattr(QdrantKbService, "batch_upsert_points", batch_upsert_points)

# ---- the resolver itself ---------------------------------------------------

def test_get_embedding_api_key_round_trips_the_encrypted_key():
    kb = KnowledgeBase(
        workspace_id=1,
        name="Key KB",
        embedding_api_key=ENCRYPTED_KEY,
        qdrant_collection="kb_key_test",
    )

    assert ENCRYPTED_KEY.startswith("enc:")
    assert get_embedding_api_key(kb) == PLAINTEXT_KEY

def test_get_embedding_api_key_returns_none_for_missing_values():
    assert get_embedding_api_key(None) is None

    empty_kb = KnowledgeBase(
        workspace_id=1, name="Empty KB", qdrant_collection="kb_empty_test"
    )
    assert get_embedding_api_key(empty_kb) is None

    blank_kb = KnowledgeBase(
        workspace_id=1,
        name="Blank KB",
        embedding_api_key="",
        qdrant_collection="kb_blank_test",
    )
    assert get_embedding_api_key(blank_kb) is None

def test_get_embedding_api_key_takes_only_a_kb():
    """The only resolver must not accept an agent (that is what caused #11)."""
    import inspect

    parameters = list(inspect.signature(get_embedding_api_key).parameters)
    assert parameters == ["kb"]

def test_get_embedding_api_key_ignores_agent_side_columns():
    """A `custom` provider agent with no legacy keys is irrelevant to the resolver."""
    agent = Agent(
        id="agt_custom_provider",
        workspace_id=1,
        name="Custom Agent",
        embedding_provider="custom",
        jina_api_key=None,
        siliconflow_api_key=None,
    )
    kb = KnowledgeBase(
        workspace_id=1,
        name="Key KB",
        embedding_provider="custom",
        embedding_model="text-embedding-v4",
        embedding_api_key=ENCRYPTED_KEY,
        qdrant_collection="kb_custom_test",
    )

    assert get_embedding_api_key(kb) == PLAINTEXT_KEY
    assert agent.jina_api_key is None  # untouched, and never consulted

# ---- issue #11 regression, end to end --------------------------------------

async def _seed_custom_provider_agent_and_kb(tmp_path) -> tuple[str, str, str]:
    """Create a custom-provider agent (no legacy keys) with a keyed KB + doc."""
    async with database.AsyncSessionLocal() as session:
        workspace = Workspace(
            name="Key Workspace", owner_email="kb-key@example.com"
        )
        session.add(workspace)
        await session.flush()
        session.add(WorkspaceQuota(workspace_id=workspace.id))

        agent = Agent(
            workspace_id=workspace.id,
            name="Custom Provider Agent",
            model="deepseek-v4-flash",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
            embedding_provider="custom",
            embedding_model="text-embedding-v4",
            jina_api_key=None,
            siliconflow_api_key=None,
        )
        session.add(agent)
        await session.flush()

        kb = KnowledgeBase(
            workspace_id=workspace.id,
            name="Custom KB",
            embedding_provider="custom",
            embedding_model="text-embedding-v4",
            embedding_base_url="https://embed.example.com/v1",
            embedding_api_key=ENCRYPTED_KEY,
            embedding_dimension=DIMENSION,
            qdrant_collection="kb_custom_regression",
        )
        session.add(kb)
        await session.flush()

        agent.kb_id = kb.id

        file_path = tmp_path / "custom.txt"
        file_path.write_text("Basjoo custom provider regression content.", encoding="utf-8")
        doc = KbDocument(
            kb_id=kb.id,
            filename="custom.txt",
            file_type="txt",
            file_size=file_path.stat().st_size,
            storage_path=str(file_path),
            source_agent_id=agent.id,
            status="pending",
        )
        session.add(doc)
        await session.commit()
        return agent.id, kb.id, doc.id

@pytest.mark.asyncio
async def test_process_document_passes_the_kb_key_to_embed_texts(
    setup_test_db, tmp_path, monkeypatch
):
    """Custom provider + no agent keys: the KB's key must reach embed_texts."""
    agent_id, kb_id, doc_id = await _seed_custom_provider_agent_and_kb(tmp_path)

    recorded: list[dict] = []

    async def fake_embed_texts(self, texts, model, base_url, api_key=None):
        recorded.append(
            {"texts": list(texts), "model": model, "base_url": base_url, "api_key": api_key}
        )
        return [[0.1] * DIMENSION for _ in texts]

    monkeypatch.setattr(
        "services.document_parser.DocumentParser.embed_texts", fake_embed_texts
    )

    await KbDocumentProcessor().process_document(doc_id, kb_id)

    assert recorded, "embed_texts must have been called"
    assert recorded[0]["api_key"] == PLAINTEXT_KEY
    assert recorded[0]["model"] == "text-embedding-v4"
    assert recorded[0]["base_url"] == "https://embed.example.com/v1"

    async with database.AsyncSessionLocal() as session:
        doc = (
            await session.execute(select(KbDocument).where(KbDocument.id == doc_id))
        ).scalar_one()
        assert doc.status == "ready", doc.error_message
        assert doc.chunk_count == 1

        # The agent's legacy key columns stay empty: nothing wrote them.
        agent = (
            await session.execute(select(Agent).where(Agent.id == agent_id))
        ).scalar_one()
        assert agent.jina_api_key is None
        assert agent.siliconflow_api_key is None

@pytest.mark.asyncio
async def test_retrieve_passes_the_kb_key_to_embed_texts(
    setup_test_db, tmp_path, monkeypatch
):
    """Retrieval resolves the query-embedding key from the KB as well."""
    from services.kb_retrieval_service import KbRetrievalService

    agent_id, kb_id, _ = await _seed_custom_provider_agent_and_kb(tmp_path)

    recorded: list[dict] = []

    async def fake_embed_texts(self, texts, model, base_url, api_key=None):
        recorded.append({"texts": list(texts), "api_key": api_key})
        return [[0.2] * DIMENSION for _ in texts]

    monkeypatch.setattr(
        "services.document_parser.DocumentParser.embed_texts", fake_embed_texts
    )

    from services.qdrant_service import QdrantKbService

    async def fake_search_kb(self, kb_id, query_vector, top_k=5):
        return [
            {
                "score": 0.5,
                "payload": {
                    "text": "custom provider chunk",
                    "doc_id": "doc-1",
                    "chunk_index": 0,
                    "filename": "custom.txt",
                },
            }
        ]

    monkeypatch.setattr(QdrantKbService, "search_kb", fake_search_kb)

    results = await KbRetrievalService().retrieve(
        agent_id=agent_id, query="custom query", top_k=5, threshold=0.1
    )

    assert recorded, "embed_texts must have been called for the query"
    assert recorded[-1]["api_key"] == PLAINTEXT_KEY
    assert results and results[0]["text"] == "custom provider chunk"

@pytest.mark.asyncio
async def test_process_document_self_heals_a_null_dimension(
    setup_test_db, tmp_path, monkeypatch
):
    """Legacy rows with no measured width get the real width written back."""
    agent_id, kb_id, doc_id = await _seed_custom_provider_agent_and_kb(tmp_path)

    async with database.AsyncSessionLocal() as session:
        kb = (
            await session.execute(
                select(KnowledgeBase).where(KnowledgeBase.id == kb_id)
            )
        ).scalar_one()
        kb.embedding_dimension = None
        await session.commit()

    async def fake_embed_texts(self, texts, model, base_url, api_key=None):
        return [[0.3] * 12 for _ in texts]

    monkeypatch.setattr(
        "services.document_parser.DocumentParser.embed_texts", fake_embed_texts
    )

    await KbDocumentProcessor().process_document(doc_id, kb_id)

    async with database.AsyncSessionLocal() as session:
        kb = (
            await session.execute(
                select(KnowledgeBase).where(KnowledgeBase.id == kb_id)
            )
        ).scalar_one()
    assert kb.embedding_dimension == 12

@pytest.mark.asyncio
async def test_chunk_payload_carries_provenance_and_no_secrets(
    setup_test_db, tmp_path, monkeypatch
):
    """Qdrant payload = kb_id + provenance; the API key never leaves the DB."""
    agent_id, kb_id, doc_id = await _seed_custom_provider_agent_and_kb(tmp_path)

    async def fake_embed_texts(self, texts, model, base_url, api_key=None):
        return [[0.4] * DIMENSION for _ in texts]

    monkeypatch.setattr(
        "services.document_parser.DocumentParser.embed_texts", fake_embed_texts
    )

    captured: list[list[dict]] = []
    from services.qdrant_service import QdrantKbService

    async def capture_upsert(self, kb_id, points, batch_size=100):
        captured.append(list(points))
        return len(points)

    monkeypatch.setattr(QdrantKbService, "batch_upsert_points", capture_upsert)

    await KbDocumentProcessor().process_document(doc_id, kb_id)

    assert captured, "documents must be upserted to Qdrant"
    payload = captured[0][0]["payload"]
    assert payload["kb_id"] == kb_id
    assert payload["doc_id"] == doc_id
    assert payload["source_agent_id"] == agent_id
    assert "tenant_id" not in payload
    flat_payload = str(payload)
    assert PLAINTEXT_KEY not in flat_payload
    assert ENCRYPTED_KEY not in flat_payload
