import os
import socket
from pathlib import Path
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from config import DEFAULT_AGENT_SIMILARITY_THRESHOLD

BACKEND_DIR = Path(__file__).resolve().parents[1]
TEST_DB_DIR = BACKEND_DIR / ".pytest_dbs"
TEST_UPLOAD_DIR = BACKEND_DIR / ".pytest_uploads"

os.environ["BASJOO_TEST_MODE"] = "1"
os.environ["KB_UPLOAD_ROOT"] = str(TEST_UPLOAD_DIR)


def _host_resolves(host: str) -> bool:
    try:
        socket.gethostbyname(host)
        return True
    except OSError:
        return False


os.environ.setdefault(
    "REDIS_URL",
    "redis://redis:6379/0" if _host_resolves("redis") else "redis://localhost:6379/0",
)
os.environ.setdefault("SECRET_KEY", "test-secret-key")
os.environ["SECRET_KEY_FILE"] = "/tmp/basjoo_test_secret.key"
os.environ["ENCRYPTION_KEY_FILE"] = "/tmp/basjoo_test_encryption.key"
os.environ["CREATE_DEFAULT_AGENT_ON_BOOTSTRAP"] = "true"

import database
from database import configure_database, init_db


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
            quota.used_total_text_mb = 0.0
        await session.commit()


async def ensure_test_admin_token() -> str:
    from models import AdminUser, Workspace, WorkspaceQuota
    from services.auth_service import AuthService

    async with database.AsyncSessionLocal() as session:
        # Ensure workspace exists
        workspace_result = await session.execute(
            select(Workspace).order_by(Workspace.id).limit(1)
        )
        workspace = workspace_result.scalar_one_or_none()
        if not workspace:
            workspace = Workspace(name="Test Workspace", owner_email="test@example.com")
            session.add(workspace)
            await session.flush()
            session.add(WorkspaceQuota(workspace_id=workspace.id))
            await session.commit()

        result = await session.execute(
            select(AdminUser).order_by(AdminUser.id).limit(1)
        )
        admin = result.scalar_one_or_none()
        auth_service = AuthService(session)

        if not admin:
            admin = await auth_service.create_admin(
                email="test@example.com",
                password="testpassword123",
                name="Test Admin",
                role="super_admin",
                workspace_id=workspace.id,
            )
        elif admin.workspace_id is None:
            admin.workspace_id = workspace.id
            await session.commit()

        return auth_service.create_access_token({"sub": str(admin.id)})


@pytest_asyncio.fixture(scope="session", loop_scope="session", autouse=True)
async def prepare_test_db_dir():
    TEST_DB_DIR.mkdir(exist_ok=True)
    yield


# Login attempts are rate-limited per client IP in a *shared* Redis, and every
# test client presents the same address, so the counter survives from one run
# (and one test) to the next. Without this, a suite run five logins deep starts
# returning 429 and `test_login` fails for a reason that has nothing to do with
# login. The limiter itself is covered by its own tests, which seed the key
# deliberately, so clearing before each test hides nothing.
@pytest.fixture(autouse=True)
def clear_login_rate_limit():
    """Drop the login limiter's sliding window before every test."""
    import redis as redis_lib

    url = os.environ.get("REDIS_URL", "")
    try:
        client = redis_lib.Redis.from_url(url, socket_connect_timeout=1)
        for prefix in ("login:ip:*", "login:acct:*"):
            for key in client.scan_iter(prefix):
                client.delete(key)
        client.close()
    except Exception:
        # No Redis in this environment: the in-memory fallback is already
        # per-process and cannot leak between runs.
        pass
    yield


TEST_KB_EMBEDDING_PROVIDER = "jina"
TEST_KB_EMBEDDING_MODEL = "jina-embeddings-v3"
TEST_KB_EMBEDDING_DIMENSION = 1024
TEST_KB_EMBEDDING_KEY = "test-kb-embedding-key"

def make_test_kb(
    workspace_id: int,
    name: str,
    *,
    status: str = "active",
    embedding_provider: str = TEST_KB_EMBEDDING_PROVIDER,
    embedding_model: str = TEST_KB_EMBEDDING_MODEL,
    embedding_dimension: int = TEST_KB_EMBEDDING_DIMENSION,
):
    """Build an unsaved KnowledgeBase row for fixtures.

    Inserted directly (no Qdrant round-trip) so the DB fixtures stay hermetic; the
    API layer is the only thing under test here, not the vector store.
    """
    import uuid

    from core.encryption import encrypt_api_key
    from models import KnowledgeBase

    kb_id = str(uuid.uuid4())
    return KnowledgeBase(
        id=kb_id,
        workspace_id=workspace_id,
        name=name,
        embedding_provider=embedding_provider,
        embedding_model=embedding_model,
        embedding_base_url="https://api.jina.ai/v1",
        embedding_api_key=encrypt_api_key(TEST_KB_EMBEDDING_KEY),
        embedding_batch_size=4,
        embedding_dimension=embedding_dimension,
        qdrant_collection=f"kb_{kb_id.replace('-', '')[:12]}",
        chunk_size=512,
        chunk_overlap=64,
        status=status,
    )

@pytest_asyncio.fixture(loop_scope="function")
async def setup_test_db(prepare_test_db_dir):
    db_path = TEST_DB_DIR / f"test_{uuid4().hex}.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{db_path}"
    await configure_database(os.environ["DATABASE_URL"])
    await init_db()

    async with database.AsyncSessionLocal() as session:
        from core.encryption import encrypt_api_key
        from models import Agent, KnowledgeBase, Workspace, WorkspaceQuota

        workspace_result = await session.execute(
            select(Workspace).order_by(Workspace.id).limit(1)
        )
        workspace = workspace_result.scalar_one_or_none()
        if not workspace:
            workspace = Workspace(
                name="Test Workspace", owner_email="test@example.com"
            )
            session.add(workspace)
            await session.flush()
            session.add(WorkspaceQuota(workspace_id=workspace.id))
            await session.flush()

        result = await session.execute(
            select(Agent).where(Agent.is_active).order_by(Agent.created_at)
        )
        agent = result.scalars().first()
        if not agent:
            agent = Agent(
                workspace_id=workspace.id,
                name="Test Agent",
                description="Default test agent",
                model="deepseek-v4-flash",
                api_base="https://api.deepseek.com/v1",
                provider_type="deepseek",
            )
            session.add(agent)
            await session.flush()

        # Issue #19: production chat refuses a keyless agent. Chat-behaviour
        # tests still mock `get_llm_service` (see `mock_llm_service` above), so
        # a stored dummy key is enough to pass the gate without hitting a
        # provider. Tests that want the 400 path create their own keyless agent.
        if not agent.api_key:
            agent.api_key = encrypt_api_key("test-llm-key")

        # Every test agent starts with an active KB bound; embedding config lives
        # on the KB now, so no agent-side key is needed.
        if not agent.kb_id:
            bound_kb = make_test_kb(workspace.id, "Bound Test KB")
            session.add(bound_kb)
            await session.flush()
            agent.kb_id = bound_kb.id

        unbound_exists = await session.scalar(
            select(KnowledgeBase.id).where(KnowledgeBase.name == "Unbound Test KB")
        )
        if not unbound_exists:
            session.add(make_test_kb(workspace.id, "Unbound Test KB"))

        await session.commit()

    await reset_quota()
    yield

@pytest_asyncio.fixture(loop_scope="function")
async def bound_kb_id(setup_test_db):
    """The KB bound to the default test agent."""
    async with database.AsyncSessionLocal() as session:
        from models import Agent

        agent = (
            await session.execute(
                select(Agent).where(Agent.is_active).order_by(Agent.created_at)
            )
        ).scalars().first()
        assert agent is not None and agent.kb_id, "Default agent must have a KB bound"
        return agent.kb_id


@pytest_asyncio.fixture(loop_scope="function")
async def unbound_kb_id(setup_test_db):
    """A second, active KB that no agent is bound to."""
    async with database.AsyncSessionLocal() as session:
        from models import KnowledgeBase

        kb_id = await session.scalar(
            select(KnowledgeBase.id).where(KnowledgeBase.name == "Unbound Test KB")
        )
        assert kb_id, "setup_test_db must seed the unbound KB"
        return kb_id

@pytest_asyncio.fixture(loop_scope="function")
async def default_agent_id(setup_test_db):
    async with database.AsyncSessionLocal() as session:
        from models import Agent

        result = await session.execute(
            select(Agent)
            .where(Agent.is_active == True)
            .order_by(Agent.created_at)
            .limit(1)
        )
        agent = result.scalar_one_or_none()
        assert agent is not None
        return agent.id


@pytest_asyncio.fixture(loop_scope="function")
async def public_client(setup_test_db):
    from main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport, base_url="http://test", timeout=30.0
    ) as ac:
        yield ac


async def _ensure_test_admin_with_role(
    role: str, workspace_id: int | None = None
) -> str:
    """Create an admin with a specific role and return a valid JWT token."""
    from models import AdminUser, Workspace, WorkspaceQuota
    from services.auth_service import AuthService

    async with database.AsyncSessionLocal() as session:
        # Ensure workspace exists if not provided
        if workspace_id is None:
            workspace_result = await session.execute(
                select(Workspace).order_by(Workspace.id).limit(1)
            )
            workspace = workspace_result.scalar_one_or_none()
            if not workspace:
                workspace = Workspace(
                    name="Test Workspace", owner_email="test@example.com"
                )
                session.add(workspace)
                await session.flush()
                session.add(WorkspaceQuota(workspace_id=workspace.id))
                await session.commit()
            workspace_id = workspace.id

        auth_service = AuthService(session)
        result = await session.execute(
            select(AdminUser).where(AdminUser.email == f"test_{role}@example.com")
        )
        admin = result.scalar_one_or_none()

        if not admin:
            admin = await auth_service.create_admin(
                email=f"test_{role}@example.com",
                password="testpassword123",
                name=f"Test {role.replace('_', ' ').title()}",
                role=role,
                workspace_id=workspace_id,
            )
        elif admin.workspace_id is None:
            admin.workspace_id = workspace_id
            await session.commit()

        return auth_service.create_access_token({"sub": str(admin.id)})


@pytest_asyncio.fixture(loop_scope="function")
async def client(setup_test_db):
    from main import app

    token = await ensure_test_admin_token()
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport, base_url="http://test", timeout=30.0
    ) as ac:
        ac.headers.update({"Authorization": f"Bearer {token}"})
        yield ac


@pytest_asyncio.fixture(loop_scope="function")
async def support_client(setup_test_db):
    from main import app

    token = await _ensure_test_admin_with_role("support")
    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport, base_url="http://test", timeout=30.0
    ) as ac:
        ac.headers.update({"Authorization": f"Bearer {token}"})
        yield ac


@pytest_asyncio.fixture(loop_scope="function")
async def readonly_client(setup_test_db):
    """Client using a legacy readonly token — should be denied on protected routes."""
    from main import app
    from models import AdminUser
    from services.auth_service import AuthService

    # Create the user directly with readonly role (bypassing validate_admin_role)
    async with database.AsyncSessionLocal() as session:
        auth_service = AuthService(session)
        result = await session.execute(
            select(AdminUser).where(AdminUser.email == "test_readonly@example.com")
        )
        admin = result.scalar_one_or_none()
        if not admin:
            admin = await auth_service.create_admin(
                email="test_readonly@example.com",
                password="testpassword123",
                name="Test Readonly",
                role="readonly",
            )

        token = auth_service.create_access_token({"sub": str(admin.id)})

    transport = ASGITransport(app=app)
    async with AsyncClient(
        transport=transport, base_url="http://test", timeout=30.0
    ) as ac:
        ac.headers.update({"Authorization": f"Bearer {token}"})
        yield ac
