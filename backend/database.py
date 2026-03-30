from sqlalchemy.ext.asyncio import (
    create_async_engine,
    AsyncSession,
    async_sessionmaker,
)
from sqlalchemy.orm import declarative_base
from sqlalchemy.pool import NullPool
from sqlalchemy import event
import os

from config import settings


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

            default_agent = Agent(
                workspace_id=default_workspace.id,
                name="AI Agent",
                description="Default AI Customer Service Agent",
                system_prompt="You are a helpful customer service assistant.",
                model="deepseek-chat",
                temperature=0.7,
                max_tokens=1024,
                api_key=os.getenv("DEEPSEEK_API_KEY", ""),
                api_base="https://api.deepseek.com/v1",
                jina_api_key=os.getenv("JINA_API_KEY", ""),
                embedding_model="jina-embeddings-v3",
                top_k=5,
                similarity_threshold=0.5,
                enable_context=False,
                widget_title_i18n={"zh-CN": "AI 客服", "en-US": "AI Assistant"},
                welcome_message_i18n={
                    "zh-CN": "您好！我是Basjoo助手，有什么可以帮您的吗？",
                    "en-US": "Hello! I'm the Basjoo assistant. How can I help you?",
                },
                restricted_reply_i18n={
                    "zh-CN": "抱歉，当前服务受限，请稍后再试。",
                    "en-US": "Sorry, the service is currently limited. Please try again later.",
                },
            )
            session.add(default_agent)
            await session.commit()

            print(f"✓ 创建默认工作空间(ID={default_workspace.id})")
            print(f"✓ 创建默认Agent(ID={default_agent.id})")
        else:
            print(f"✓ 默认工作空间已存在(ID={existing_workspace.id})")
