from sqlalchemy.ext.asyncio import (
    create_async_engine,
    AsyncSession,
    async_sessionmaker,
)
from sqlalchemy.orm import declarative_base
from sqlalchemy.pool import NullPool
from sqlalchemy import event
import os

from config import settings, DEFAULT_AGENT_MAX_TOKENS, DEFAULT_AGENT_SIMILARITY_THRESHOLD
from core.encryption import encrypt_api_key


def _to_async_database_url(database_url: str) -> str:
    if database_url.startswith("sqlite:///"):
        return database_url.replace("sqlite:///", "sqlite+aiosqlite:///")
    return database_url


def _create_engine(database_url: str):
    async_database_url = _to_async_database_url(database_url)
    engine = create_async_engine(
        async_database_url,
        echo=False,
        pool_pre_ping=True,
        poolclass=NullPool,
        connect_args={"check_same_thread": False},
    )

    @event.listens_for(engine.sync_engine, "connect")
    def set_sqlite_pragma(dbapi_conn, connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA busy_timeout=30000")  # 30 second timeout
        cursor.close()

    return engine


def _create_sessionmaker(engine):
    return async_sessionmaker(
        engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autocommit=False,
        autoflush=False,
    )


database_url = settings.database_url
engine = _create_engine(database_url)
AsyncSessionLocal = _create_sessionmaker(engine)


def _build_default_agent(workspace_id: int):
    from models import Agent

    raw_api_key = settings.deepseek_api_key
    raw_jina_key = os.getenv("JINA_API_KEY", "")

    return Agent(
        id=settings.default_agent_id,
        workspace_id=workspace_id,
        name="AI Agent",
        description="Default AI Customer Service Agent",
        system_prompt="You are a helpful customer service assistant.",
        model="deepseek-chat",
        temperature=0.7,
        max_tokens=DEFAULT_AGENT_MAX_TOKENS,
        api_key=encrypt_api_key(raw_api_key) if raw_api_key else "",
        api_base="https://api.deepseek.com/v1",
        jina_api_key=encrypt_api_key(raw_jina_key) if raw_jina_key else "",
        embedding_model="jina-embeddings-v3",
        top_k=5,
        similarity_threshold=DEFAULT_AGENT_SIMILARITY_THRESHOLD,
        enable_context=False,
    )


async def configure_database(new_database_url: str):
    global database_url, engine, AsyncSessionLocal
    await engine.dispose()
    database_url = new_database_url
    engine = _create_engine(new_database_url)
    AsyncSessionLocal = _create_sessionmaker(engine)


Base = declarative_base()


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db():
    async with engine.begin() as conn:
        from models import (
            Workspace,
            Agent,
            URLSource,
            QAItem,
            DocumentChunk,
            ChatSession,
            ChatMessage,
            WorkspaceQuota,
            IndexJob,
            AdminUser,
        )

        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as session:
        from sqlalchemy import select
        from models import Workspace, Agent, WorkspaceQuota

        result = await session.execute(
            select(Workspace).where(Workspace.owner_email == "admin@basjoo.com")
        )
        existing_workspace = result.scalar_one_or_none()

        if not existing_workspace:
            default_workspace = Workspace(
                name="Default Workspace", owner_email="admin@basjoo.com"
            )
            session.add(default_workspace)
            await session.flush()

            default_quota = WorkspaceQuota(workspace_id=default_workspace.id)
            session.add(default_quota)

            default_agent = _build_default_agent(default_workspace.id)
            session.add(default_agent)
            await session.commit()

            print(f"✓ 创建默认工作空间(ID={default_workspace.id})")
            print(f"✓ 创建默认Agent(ID={default_agent.id})")
        else:
            agent_result = await session.execute(
                select(Agent.id).where(Agent.workspace_id == existing_workspace.id).limit(1)
            )
            existing_agent_id = agent_result.scalar_one_or_none()

            if existing_agent_id:
                print(f"✓ 默认工作空间已存在(ID={existing_workspace.id})")
                print(f"✓ 默认Agent已存在(ID={existing_agent_id})")
            else:
                default_agent = _build_default_agent(existing_workspace.id)
                session.add(default_agent)
                await session.commit()

                print(f"✓ 默认工作空间已存在(ID={existing_workspace.id})")
                print(f"✓ 已为默认工作空间创建Agent(ID={default_agent.id})")
