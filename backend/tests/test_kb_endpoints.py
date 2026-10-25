"""Contract tests for the workspace-scoped `/api/v1/knowledge-bases` surface.

Covered here:
- create → list → detail, and that a failed provider probe leaves NO KB row behind
- PATCH name/chunk sizing works, PATCH embedding config is refused once locked
- reset probes the provider and recreates the Qdrant collection at the MEASURED width
- `/knowledge-bases/test-embedding` returns the probed dimension / 400s on failure
- DELETE is blocked (409) while bound, allowed after unbind, and removes contents
- every mutation is `super_admin` only (403 for admin/support)
- a KB from another workspace is indistinguishable from a missing one (404)
"""

import pytest
from sqlalchemy import func, select

import database
from models import Agent, KbChunk, KbDocument, KnowledgeBase


def _create_payload(**overrides) -> dict:
    payload = {
        "name": "Probe KB",
        "embedding_provider": "jina",
        "embedding_model": "jina-embeddings-v3",
        "embedding_base_url": "https://api.jina.ai/v1",
        "embedding_api_key": "test-jina-key",
        "embedding_batch_size": 4,
        "chunk_size": 512,
        "chunk_overlap": 64,
    }
    payload.update(overrides)
    return payload


def _patch_probe(monkeypatch, dimension: int, record: list | None = None):
    """Replace the provider probe with a deterministic vector width."""

    async def fake_embed_texts(self, texts, model, base_url, api_key=None):
        if record is not None:
            record.append(
                {
                    "texts": list(texts),
                    "model": model,
                    "base_url": base_url,
                    "api_key": api_key,
                }
            )
        return [[0.01] * dimension for _ in texts]

    monkeypatch.setattr(
        "services.document_parser.DocumentParser.embed_texts", fake_embed_texts
    )


@pytest.mark.asyncio
async def test_create_list_and_detail(client, monkeypatch):
    probe_calls: list[dict] = []
    _patch_probe(monkeypatch, 1024, probe_calls)

    create_response = await client.post(
        "/api/v1/knowledge-bases", json=_create_payload(name="Primary KB")
    )
    assert create_response.status_code == 201, create_response.text
    created = create_response.json()

    assert created["name"] == "Primary KB"
    assert created["embedding_provider"] == "jina"
    assert created["embedding_model"] == "jina-embeddings-v3"
    # The dimension must come from the probed vectors, not from the model name.
    assert created["embedding_dimension"] == 1024
    assert created["status"] == "active"
    assert created["bound_agent"] is None
    assert created["document_count"] == 0
    assert created["total_chunks"] == 0
    assert probe_calls and probe_calls[0]["api_key"] == "test-jina-key"

    list_response = await client.get("/api/v1/knowledge-bases")
    assert list_response.status_code == 200
    listed = list_response.json()
    assert listed["total"] >= 2
    names = {item["name"] for item in listed["knowledge_bases"]}
    assert "Primary KB" in names
    bound_items = [i for i in listed["knowledge_bases"] if i["bound_agent"]]
    assert bound_items, "The fixture's bound KB should report its agent"

    detail_response = await client.get(f"/api/v1/knowledge-bases/{created['id']}")
    assert detail_response.status_code == 200
    assert detail_response.json()["id"] == created["id"]


@pytest.mark.asyncio
async def test_create_with_failing_provider_leaves_no_kb_row(client, monkeypatch):
    async def exploding_embed_texts(self, texts, model, base_url, api_key=None):
        raise RuntimeError("401 Unauthorized: invalid api key")

    monkeypatch.setattr(
        "services.document_parser.DocumentParser.embed_texts", exploding_embed_texts
    )

    response = await client.post(
        "/api/v1/knowledge-bases", json=_create_payload(name="Never Created")
    )

    assert response.status_code == 400
    assert "invalid api key" in response.json()["detail"].lower()

    async with database.AsyncSessionLocal() as session:
        row_count = await session.scalar(
            select(func.count(KnowledgeBase.id)).where(
                KnowledgeBase.name == "Never Created"
            )
        )
    assert row_count == 0, "A failed provider probe must not persist a KB row"


@pytest.mark.asyncio
async def test_patch_name_and_chunk_sizing(client, bound_kb_id):
    response = await client.patch(
        f"/api/v1/knowledge-bases/{bound_kb_id}",
        json={"name": "Renamed KB", "chunk_size": 1024, "chunk_overlap": 128},
    )

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["name"] == "Renamed KB"
    assert data["chunk_size"] == 1024
    assert data["chunk_overlap"] == 128


@pytest.mark.asyncio
async def test_patch_chunk_overlap_must_be_smaller_than_chunk_size(client, bound_kb_id):
    response = await client.patch(
        f"/api/v1/knowledge-bases/{bound_kb_id}",
        json={"chunk_size": 128, "chunk_overlap": 256},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_patch_embedding_when_locked_returns_409(client, bound_kb_id):
    async with database.AsyncSessionLocal() as session:
        kb = await session.get(KnowledgeBase, bound_kb_id)
        kb.is_locked = True
        await session.commit()

    response = await client.patch(
        f"/api/v1/knowledge-bases/{bound_kb_id}",
        json={"embedding_model": "jina-embeddings-v2-base-en"},
    )

    assert response.status_code == 409
    assert "reset" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_reset_probes_provider_and_recreates_collection(
    client, bound_kb_id, monkeypatch
):
    _patch_probe(monkeypatch, 768)

    calls: list[tuple] = []

    async def fake_delete_collection(self, kb_id):
        calls.append(("delete", kb_id))
        return True

    async def fake_ensure_collection(self, kb_id, dimension):
        calls.append(("ensure", kb_id, dimension))
        return f"kb_{kb_id[:12]}"

    monkeypatch.setattr(
        "services.qdrant_service.QdrantKbService.delete_collection",
        fake_delete_collection,
    )
    monkeypatch.setattr(
        "services.qdrant_service.QdrantKbService.ensure_collection",
        fake_ensure_collection,
    )

    response = await client.post(
        f"/api/v1/knowledge-bases/{bound_kb_id}/reset",
        json={
            "embedding_provider": "jina",
            "embedding_model": "jina-embeddings-v2-base-en",
            "embedding_base_url": "https://api.jina.ai/v1",
            "embedding_api_key": "test-jina-key-rotated",
        },
    )

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["status"] == "active"
    assert data["kb_id"] == bound_kb_id
    assert data["requeued_documents"] == len(data["doc_ids"])

    # The collection must be dropped before it is recreated at the new width.
    assert calls[0][0] == "delete", calls
    ensure_calls = [c for c in calls if c[0] == "ensure"]
    assert ensure_calls, "reset must recreate the Qdrant collection"
    assert ensure_calls[0][2] == 768, "ensure_collection must get the MEASURED width"

    async with database.AsyncSessionLocal() as session:
        kb = await session.get(KnowledgeBase, bound_kb_id)
        assert kb.embedding_model == "jina-embeddings-v2-base-en"
        assert kb.embedding_dimension == 768


@pytest.mark.asyncio
async def test_test_embedding_returns_probed_dimension(client, monkeypatch):
    _patch_probe(monkeypatch, 1536)

    response = await client.post(
        "/api/v1/knowledge-bases/test-embedding",
        json={
            "embedding_provider": "siliconflow",
            "embedding_model": "BAAI/bge-m3",
            "embedding_base_url": "https://api.siliconflow.cn/v1",
            "embedding_api_key": "test-siliconflow-key",
        },
    )

    assert response.status_code == 200, response.text
    data = response.json()
    assert data["success"] is True
    assert data["dimension"] == 1536


@pytest.mark.asyncio
async def test_test_embedding_failure_returns_400(client, monkeypatch):
    async def exploding_embed_texts(self, texts, model, base_url, api_key=None):
        raise RuntimeError("connection refused")

    monkeypatch.setattr(
        "services.document_parser.DocumentParser.embed_texts", exploding_embed_texts
    )

    response = await client.post(
        "/api/v1/knowledge-bases/test-embedding",
        json={
            "embedding_provider": "jina",
            "embedding_model": "jina-embeddings-v3",
            "embedding_api_key": "test-jina-key",
        },
    )

    assert response.status_code == 400
    assert "connection refused" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_delete_bound_kb_conflicts_then_succeeds_after_unbind(
    client, default_agent_id, monkeypatch
):
    async def fake_delete_collection(self, kb_id):
        return True

    async def fake_delete_points(self, kb_id, doc_id):
        return 1

    monkeypatch.setattr(
        "services.qdrant_service.QdrantKbService.delete_collection",
        fake_delete_collection,
    )
    monkeypatch.setattr(
        "services.qdrant_service.QdrantKbService.delete_points_by_doc_id",
        fake_delete_points,
    )

    agent_response = await client.get(f"/api/v1/agent?agent_id={default_agent_id}")
    kb_id = agent_response.json()["kb_id"]
    assert kb_id

    async with database.AsyncSessionLocal() as session:
        session.add(
            KbDocument(
                kb_id=kb_id,
                filename="manual.txt",
                file_type="txt",
                status="ready",
                chunk_count=1,
                storage_path="/tmp/does-not-exist.txt",
            )
        )
        await session.flush()
        doc = (
            await session.execute(select(KbDocument).where(KbDocument.kb_id == kb_id))
        ).scalars().first()
        session.add(
            KbChunk(kb_id=kb_id, doc_id=doc.id, vector_id="vec-1", chunk_index=0)
        )
        await session.commit()

    blocked = await client.delete(f"/api/v1/knowledge-bases/{kb_id}")
    assert blocked.status_code == 409
    assert "unbind" in blocked.json()["detail"].lower()

    unbind = await client.put(
        f"/api/v1/agents/{default_agent_id}/knowledge-base", json={"kb_id": None}
    )
    assert unbind.status_code == 200

    deleted = await client.delete(f"/api/v1/knowledge-bases/{kb_id}")
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["deleted"] is True

    async with database.AsyncSessionLocal() as session:
        assert await session.get(KnowledgeBase, kb_id) is None
        assert (
            await session.scalar(
                select(func.count(KbDocument.id)).where(KbDocument.kb_id == kb_id)
            )
        ) == 0
        assert (
            await session.scalar(
                select(func.count(KbChunk.id)).where(KbChunk.kb_id == kb_id)
            )
        ) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("method", "suffix", "payload"),
    [
        ("post", "", _create_payload()),
        ("patch", "/{kb_id}", {"name": "Nope"}),
        ("post", "/{kb_id}/reset", {"embedding_provider": "jina", "embedding_model": "m"}),
        ("post", "/test-embedding", {"embedding_provider": "jina", "embedding_model": "m", "embedding_api_key": "k"}),
        ("delete", "/{kb_id}", None),
    ],
)
async def test_mutations_are_super_admin_only(
    support_client, readonly_client, default_agent_id, bound_kb_id, method, suffix, payload
):
    path = "/api/v1/knowledge-bases" + suffix.format(kb_id=bound_kb_id)

    support_response = await support_client.request(method.upper(), path, json=payload)
    assert support_response.status_code == 403, (
        f"{method.upper()} {path} must be denied for support: "
        f"{support_response.status_code} {support_response.text}"
    )

    readonly_response = await readonly_client.request(method.upper(), path, json=payload)
    assert readonly_response.status_code == 403


@pytest.mark.asyncio
async def test_bind_endpoint_is_super_admin_only(
    support_client, default_agent_id, unbound_kb_id
):
    response = await support_client.put(
        f"/api/v1/agents/{default_agent_id}/knowledge-base",
        json={"kb_id": unbound_kb_id},
    )
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_cross_workspace_kb_is_404(client, monkeypatch):
    from models import Workspace

    _patch_probe(monkeypatch, 1024)

    async with database.AsyncSessionLocal() as session:
        other_workspace = Workspace(
            name="Other Workspace", owner_email="other@example.com"
        )
        session.add(other_workspace)
        await session.flush()

        from tests.conftest import make_test_kb

        foreign_kb = make_test_kb(other_workspace.id, "Foreign KB")
        session.add(foreign_kb)
        await session.commit()
        foreign_kb_id = foreign_kb.id

    detail = await client.get(f"/api/v1/knowledge-bases/{foreign_kb_id}")
    assert detail.status_code == 404

    patch_response = await client.patch(
        f"/api/v1/knowledge-bases/{foreign_kb_id}", json={"name": "Hijacked"}
    )
    assert patch_response.status_code == 404

    delete_response = await client.delete(f"/api/v1/knowledge-bases/{foreign_kb_id}")
    assert delete_response.status_code == 404

    async with database.AsyncSessionLocal() as session:
        survivor = await session.get(KnowledgeBase, foreign_kb_id)
        assert survivor is not None, "cross-workspace delete must be a no-op"
        assert survivor.name == "Foreign KB"

    listed = await client.get("/api/v1/knowledge-bases")
    assert foreign_kb_id not in {
        item["id"] for item in listed.json()["knowledge_bases"]
    }


@pytest.mark.asyncio
async def test_reads_require_admin_role(support_client, bound_kb_id):
    """Reads are `admin`-level; `support` is still refused (role gate intact)."""
    listing = await support_client.get("/api/v1/knowledge-bases")
    assert listing.status_code == 403

    detail = await support_client.get(f"/api/v1/knowledge-bases/{bound_kb_id}")
    assert detail.status_code == 403
