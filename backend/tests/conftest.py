import os
import socket
from pathlib import Path
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

BACKEND_DIR = Path(__file__).resolve().parents[1]
TEST_DB_DIR = BACKEND_DIR / ".pytest_dbs"

os.environ["BASJOO_TEST_MODE"] = "1"


def _host_resolves(host: str) -> bool:
    try:
        socket.gethostbyname(host)
        return True
    except OSError:
        return False


os.environ.setdefault("QDRANT_HOST", "qdrant" if _host_resolves("qdrant") else "localhost")
os.environ.setdefault("QDRANT_PORT", "6333")
os.environ.setdefault("REDIS_URL", "redis://redis:6379/0" if _host_resolves("redis") else "redis://localhost:6379/0")
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ["SECRET_KEY_FILE"] = "/tmp/basjoo_test_secret.key"
os.environ["ENCRYPTION_KEY_FILE"] = "/tmp/basjoo_test_encryption.key"

import database
from database import configure_database, init_db


@pytest.fixture(autouse=True)
def mock_jina_embeddings(monkeypatch):
    from services.qdrant_store import JinaEmbeddingClient

    def _mock_embed(self, texts):
        return [[float((index % 8) + 1) for index in range(1024)] for _ in texts]

    monkeypatch.setattr(JinaEmbeddingClient, "embed", _mock_embed)


@pytest.fixture(autouse=True)
def mock_qdrant_store(monkeypatch, request):
    integration_fixtures = {"client", "public_client", "default_agent_id"}
    if not integration_fixtures.intersection(set(request.fixturenames)):
        return

    store_data = {}

    class FakeQdrantVectorStore:
        def __init__(self, jina_api_key: str, embedding_model: str = "jina-embeddings-v3", collection_prefix: str = "basjoo"):
            self.embedding_model = embedding_model
            self.collection_prefix = collection_prefix

        def add_documents(self, agent_id: str, chunks):
            store_data[agent_id] = list(chunks)
            return len(chunks)

        def search(self, agent_id: str, query: str, top_k: int = 5, threshold: float = 0.5, source_type=None):
            chunks = store_data.get(agent_id, [])
            results = []
            query_lower = query.lower()
            for chunk in chunks:
                content = chunk.get("content", "")
                metadata = chunk.get("metadata", {})
                haystacks = [content.lower(), str(metadata.get("question", "")).lower(), str(metadata.get("title", "")).lower()]
                if any(query_lower in hay for hay in haystacks):
                    results.append({
                        "content": content,
                        "score": 0.95,
                        "metadata": metadata,
                    })
            return results[:top_k]

        def clear_collection(self, agent_id: str):
            store_data[agent_id] = []
            return True

        def delete_collection(self, agent_id: str):
            store_data.pop(agent_id, None)
            return True

        def get_collection_info(self, agent_id: str):
            chunks = store_data.get(agent_id, [])
            return {
                "name": f"basjoo_{agent_id}",
                "vectors_count": len(chunks),
                "points_count": len(chunks),
                "status": "green" if chunks else "not_found",
            }

    monkeypatch.setattr("services.QdrantVectorStore", FakeQdrantVectorStore)
    monkeypatch.setattr("services.qdrant_store.QdrantVectorStore", FakeQdrantVectorStore)
    monkeypatch.setattr("services.rag_qdrant.QdrantVectorStore", FakeQdrantVectorStore)
    monkeypatch.setattr("api.v1.endpoints.QdrantVectorStore", FakeQdrantVectorStore)
    monkeypatch.setattr("api.v1.index_endpoints.QdrantVectorStore", FakeQdrantVectorStore)


@pytest.fixture(autouse=True)
def mock_llm_service(monkeypatch, request):
    integration_fixtures = {"client", "public_client", "default_agent_id"}
    if not integration_fixtures.intersection(set(request.fixturenames)):
        return

    from services.llm_service import MockLLMService

    def _mock_get_llm_service(*args, **kwargs):
        model = kwargs.get("model") or "mock-model"
        return MockLLMService(model=model)

    monkeypatch.setattr("services.llm_service.get_llm_service", _mock_get_llm_service)
    monkeypatch.setattr("api.v1.endpoints.get_llm_service", _mock_get_llm_service)


async def reset_quota():
    async with database.AsyncSessionLocal() as session:
        from datetime import datetime, timezone
        from models import WorkspaceQuota

        result = await session.execute(select(WorkspaceQuota))
        quotas = result.scalars().all()
        for quota in quotas:
            quota.used_urls = 0
            quota.used_qa_items = 0
            quota.used_messages_today = 0
            quota.used_total_text_mb = 0.0
            quota.last_message_reset = datetime.now(timezone.utc)
        await session.commit()


async def ensure_test_admin_token() -> str:
    from models import AdminUser
    from services.auth_service import AuthService

    async with database.AsyncSessionLocal() as session:
        result = await session.execute(select(AdminUser).order_by(AdminUser.id).limit(1))
        admin = result.scalar_one_or_none()
        auth_service = AuthService(session)

        if not admin:
            admin = await auth_service.create_admin(
                email="test@example.com",
                password="testpassword123",
                name="Test Admin",
            )

        return auth_service.create_access_token({"sub": str(admin.id)})


async def wait_for_index_job(client: AsyncClient, agent_id: str, job_id: str, timeout_seconds: int = 20):
    import asyncio
    import time

    deadline = time.time() + timeout_seconds
    while time.time() < deadline:
        response = await client.get(f"/api/v1/index:status?agent_id={agent_id}&job_id={job_id}")
        response.raise_for_status()
        data = response.json()
        if data.get("status") in {"completed", "failed"}:
            return data
        await asyncio.sleep(0.2)
    raise AssertionError(f"Index job {job_id} did not finish within {timeout_seconds}s")


@pytest_asyncio.fixture(scope="session", loop_scope="session", autouse=True)
async def prepare_test_db_dir():
    TEST_DB_DIR.mkdir(exist_ok=True)
    yield


@pytest_asyncio.fixture(loop_scope="function")
async def setup_test_db(prepare_test_db_dir):
    db_path = TEST_DB_DIR / f"test_{uuid4().hex}.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    await configure_database(os.environ["DATABASE_URL"])
    await init_db()

    async with database.AsyncSessionLocal() as session:
        from models import Agent
        result = await session.execute(select(Agent).where(Agent.is_active))
        agent = result.scalar_one_or_none()
        if agent and not agent.jina_api_key:
            agent.jina_api_key = "test_jina_key"
            await session.commit()

    await reset_quota()
    yield


@pytest_asyncio.fixture(loop_scope="function")
async def default_agent_id(setup_test_db):
    async with database.AsyncSessionLocal() as session:
        from models import Agent
        result = await session.execute(
            select(Agent).where(Agent.is_active == True).order_by(Agent.created_at).limit(1)
        )
        agent = result.scalar_one_or_none()
        assert agent is not None
        return agent.id


@pytest_asyncio.fixture(loop_scope="function")
async def public_client(setup_test_db):
    from main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", timeout=30.0) as ac:
        yield ac


@pytest_asyncio.fixture(loop_scope="function")
async def client(setup_test_db):
    from main import app

    token = await ensure_test_admin_token()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test", timeout=30.0) as ac:
        ac.headers.update({"Authorization": f"Bearer {token}"})
        yield ac
