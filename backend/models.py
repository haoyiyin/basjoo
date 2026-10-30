import hashlib
import re
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column,
    String,
    DateTime,
    Integer,
    Text,
    Boolean,
    ForeignKey,
    JSON,
    Enum as SQLEnum,
    Index,
    Float,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base
from config import DEFAULT_AGENT_MAX_TOKENS, DEFAULT_AGENT_SIMILARITY_THRESHOLD
from constants import DEFAULT_WIDGET_COLOR


def normalize_url(url: str) -> str:
    """规范化URL（去重用）"""
    url = url.strip().lower()
    # 移除末尾斜杠
    if url.endswith("/"):
        url = url[:-1]
    # 移除www前缀
    if url.startswith("https://www."):
        url = url.replace("https://www.", "https://", 1)
    elif url.startswith("http://www."):
        url = url.replace("http://www.", "http://", 1)
    return url


def compute_content_hash(content: str) -> str:
    """计算内容哈希（用于去重）"""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()

_WHITESPACE_RUN = re.compile(r"\s+")

def normalise_page_text(content: str | None) -> str:
    """Normalise fetched page text before hashing it (#47, diffed refetch).

    Conservative on purpose: every run of whitespace becomes one space and the
    trailing newline is dropped, so a CMS that re-wraps or re-indents a page does
    not trigger a full re-embed. Nothing else is touched — no case folding, no
    punctuation stripping, no line reordering — because two pages that differ in
    real text must never collide on the same hash.
    """
    return _WHITESPACE_RUN.sub(" ", str(content or "")).strip()

def compute_item_hash(content: str | None) -> str:
    """Stable hash of *normalised* page text, stored as ``KbDocument.item_hash``."""
    return hashlib.sha256(normalise_page_text(content).encode("utf-8")).hexdigest()


class Workspace(Base):
    """工作空间模型"""

    __tablename__ = "workspaces"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, default="Default Workspace")
    owner_email = Column(String(255), unique=True, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Built-in example content lifecycle: pending | seeded | declined
    # (see services/example_seed.py). Not derived from "does an agent exist".
    example_seed_state = Column(
        String(20), nullable=False, default="pending", server_default="pending"
    )

    # 关系
    agents = relationship(
        "Agent", back_populates="workspace", cascade="all, delete-orphan"
    )
    quotas = relationship("WorkspaceQuota", back_populates="workspace", uselist=False)
    admin_users = relationship("AdminUser", back_populates="workspace")


class Agent(Base):
    """Agent模型"""

    __tablename__ = "agents"

    id = Column(
        String(50), primary_key=True, default=lambda: f"agt_{uuid.uuid4().hex[:12]}"
    )
    workspace_id = Column(
        Integer, ForeignKey("workspaces.id"), nullable=False, index=True
    )

    # 基本信息
    name = Column(String(100), nullable=False, default="AI Agent")
    description = Column(Text, nullable=True)
    avatar = Column(String(500), nullable=True)

    # LLM配置
    system_prompt = Column(
        Text, nullable=False, default="You are a helpful customer service assistant."
    )
    model = Column(String(100), nullable=False, default="gpt-4o-mini")
    temperature = Column(Float, nullable=False, default=0.7)
    max_tokens = Column(Integer, nullable=False, default=DEFAULT_AGENT_MAX_TOKENS)

    # API配置
    api_key = Column(String(500), nullable=True)
    api_base = Column(String(500), nullable=True, default="https://api.openai.com/v1")

    # DEPRECATED: owned by KnowledgeBase since the KB-decoupling change.
    # Kept for one release; no code path reads or writes it.
    jina_api_key = Column(String(500), nullable=True)

    # DEPRECATED: owned by KnowledgeBase since the KB-decoupling change.
    # Kept for one release; no code path reads or writes it.
    siliconflow_api_key = Column(String(500), nullable=True)

    # AI服务商配置
    provider_type = Column(
        SQLEnum(
            "openai",
            "openai_native",
            "google",
            "anthropic",
            "xai",
            "openrouter",
            "zai",
            "deepseek",
            "volcengine",
            "moonshot",
            "aliyun_bailian",
            "siliconflow",
            "tencentcloud",
            name="llm_provider",
        ),
        nullable=True,
        default="openai",
    )

    # Azure OpenAI特定配置
    azure_endpoint = Column(String(500), nullable=True)
    azure_deployment_name = Column(String(100), nullable=True)
    azure_api_version = Column(String(20), nullable=True)

    # Anthropic特定配置
    anthropic_version = Column(String(20), nullable=True, default="2023-06-01")

    # Google特定配置
    google_project_id = Column(String(100), nullable=True)
    google_region = Column(String(50), nullable=True)

    # 通用提供商配置
    provider_config = Column(JSON, nullable=True)

    # DEPRECATED: owned by KnowledgeBase since the KB-decoupling change.
    # Kept for one release; no code path reads or writes it.
    embedding_provider = Column(String(20), nullable=False, default="jina")
    # DEPRECATED: owned by KnowledgeBase since the KB-decoupling change.
    embedding_api_base = Column(String(500), nullable=True)
    # DEPRECATED: owned by KnowledgeBase since the KB-decoupling change.
    embedding_model = Column(String(100), nullable=False, default="jina-embeddings-v3")
    # DEPRECATED: owned by KnowledgeBase since the KB-decoupling change.
    embedding_batch_size = Column(Integer, nullable=False, default=4)
    # DEPRECATED: the KB binding plus `KnowledgeBase.status` is the only source of
    # truth since the KB-decoupling change; this column is never read.
    kb_setup_completed = Column(Boolean, nullable=False, default=False)
    # URL抓取配置
    crawl_max_depth = Column(Integer, nullable=False, default=2)  # 全站爬取深度
    crawl_max_pages = Column(Integer, nullable=False, default=20)  # 全站爬取最大页面数
    url_fetch_interval_days = Column(
        Integer, nullable=False, default=7
    )  # URL自动抓取间隔（天）
    enable_auto_fetch = Column(
        Boolean, nullable=False, default=False
    )  # 是否启用自动抓取

    # 检索配置
    top_k = Column(Integer, nullable=False, default=8)
    similarity_threshold = Column(
        Float, nullable=False, default=DEFAULT_AGENT_SIMILARITY_THRESHOLD
    )
    enable_context = Column(Boolean, nullable=False, default=False)

    # AI对话限制配置
    rate_limit_per_minute = Column(
        Integer, nullable=False, default=20
    )  # 每分钟对话限制（0表示不限制）
    restricted_reply = Column(
        Text, nullable=True, default="抱歉，当前服务受限，请稍后再试。"
    )  # 自动回复（速率限制、AI 服务异常等场景）
    last_error_code = Column(String(50), nullable=True)
    last_error_message = Column(Text, nullable=True)
    last_error_at = Column(DateTime(timezone=True), nullable=True)
    allowed_widget_origins = Column(JSON, nullable=True, default=None)

    # 人设类型
    persona_type = Column(
        String(20), nullable=False, default="general"
    )  # general, customer-service, sales, custom

    # Widget 配置
    widget_title = Column(String(100), nullable=True, default="AI 客服")
    # One default, defined once in constants.py: the console accent
    # (hsl(48 96% 49%) == #F9CA02, frontend-nextjs/src/index.css).
    widget_color = Column(
        String(20), nullable=True, default=DEFAULT_WIDGET_COLOR
    )
    welcome_message = Column(
        Text, nullable=True, default="您好！我是Basjoo助手，有什么可以帮您的吗？"
    )
    history_days = Column(Integer, nullable=False, default=30)

    # --- Widget install surface (#40) --------------------------------------
    # Regular expressions matched against location.pathname; a match means the
    # widget renders nothing on that page.
    excluded_paths = Column(JSON, nullable=True, default=None)
    # bubble | inline | iframe
    display_mode = Column(String(20), nullable=False, default="bubble")
    # CSS selector the inline/iframe modes mount into. Null = the widget's own
    # default (`#basjoo-chat`).
    inline_container = Column(String(200), nullable=True, default=None)
    # [{"label", "action": "message"|"link", "value", "path"}]  — `path` is an
    # optional regex that scopes the starter to one page.
    starters = Column(JSON, nullable=True, default=None)
    # Home-screen cards: [{"heading", "text", "action": "chat"|"kb-search"|"link", "value"}]
    widget_cards = Column(JSON, nullable=True, default=None)
    # Percentage of visitors (0-100) that get the widget; sticky per visitor.
    traffic_percentage = Column(Integer, nullable=False, default=100)

    # --- Conversation policy (#43, #41) ------------------------------------
    # {"timezone": "Asia/Shanghai", "schedule": [{"day": 0, "start": 540, "end": 1080}]}
    # Absent = always online. Resolved with zoneinfo, never a fixed offset.
    business_hours = Column(JSON, nullable=True, default=None)
    away_message = Column(Text, nullable=True)
    # One line rendered in the widget's conversation chrome, verbatim (the text
    # is operator-authored and is never translated; only the label around it
    # is). Absent = nothing rendered.
    ai_disclosure = Column(Text, nullable=True)
    # "off" | "optional" | "required" (#41). Anything else reads as "off".
    prechat_mode = Column(String(20), nullable=False, default="off")

    # --- Answer control (#39) ---------------------------------------------
    # Operator-written facts that outrank retrieved chunks and are injected on
    # every message, capped at 6 passages.
    fixed_facts = Column(Text, nullable=True)

    # --- Scripted keyword fallback (#60) ----------------------------------
    # "off" | "keyword". Default "off" so an upgrade changes nothing. Anything
    # unrecognised (including the retired #44 values) reads as "off".
    fallback_mode = Column(String(20), nullable=False, default="off")

    # --- Signed visitor identity (#46) ------------------------------------
    # Fernet-encrypted HMAC secret. Absent = today's anonymous-only behaviour.
    identity_secret = Column(String(500), nullable=True)

    # --- Outbound webhooks (#47) ------------------------------------------
    # Where integration events are POSTed. Absent = nothing is ever queued.
    webhook_url = Column(String(1000), nullable=True)
    # Fernet-encrypted HMAC secret used for `X-Basjoo-Signature`; never returned.
    webhook_secret = Column(String(500), nullable=True)

    # 状态
    is_active = Column(Boolean, default=True)
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)
    purge_after = Column(DateTime(timezone=True), nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 知识库关联（一对一：一个 KB 最多绑定一个 agent）
    kb_id = Column(
        String(36),
        ForeignKey("knowledge_bases.id"),
        nullable=True,
        unique=True,
        index=True,
    )

    # 关系
    workspace = relationship("Workspace", back_populates="agents")
    knowledge_files = relationship(
        "KnowledgeFile", back_populates="agent", cascade="all, delete-orphan"
    )
    chat_sessions = relationship(
        "ChatSession", back_populates="agent", cascade="all, delete-orphan"
    )
    members = relationship(
        "AgentMember", back_populates="agent", cascade="all, delete-orphan"
    )
    knowledge_base = relationship("KnowledgeBase", back_populates="agent")


class URLSource(Base):
    """URL知识源模型"""

    __tablename__ = "url_sources"

    id = Column(Integer, primary_key=True, index=True)
    kb_id = Column(
        String(36), ForeignKey("knowledge_bases.id"), nullable=False, index=True
    )

    # URL信息
    url = Column(String(1000), nullable=False, index=True)
    normalized_url = Column(String(1000), nullable=False, index=True)  # 规范化后的URL

    # 抓取状态
    status = Column(
        SQLEnum("pending", "fetching", "success", "failed", name="url_status"),
        default="pending",
        index=True,
    )
    last_fetch_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)

    # 抓取内容
    title = Column(String(500), nullable=True)
    content = Column(Text, nullable=True)  # 清洗后的正文
    content_hash = Column(String(64), nullable=True)  # 用于去重

    # 元数据
    fetch_metadata = Column(
        JSON, nullable=True
    )  # etag, last_modified, content_length等
    is_indexed = Column(Boolean, nullable=False, default=False)  # 是否已训练
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关系
    knowledge_base = relationship("KnowledgeBase", back_populates="url_sources")

    # 索引和约束
    __table_args__ = (
        Index("ix_url_sources_kb_status", "kb_id", "status"),
        UniqueConstraint("kb_id", "normalized_url", name="uq_kb_normalized_url"),
    )


class KnowledgeFile(Base):
    """知识文件模型"""

    __tablename__ = "knowledge_files"

    id = Column(
        String(50), primary_key=True, default=lambda: f"kf_{uuid.uuid4().hex[:12]}"
    )
    agent_id = Column(String(50), ForeignKey("agents.id"), nullable=False, index=True)

    # 文件信息
    filename = Column(String(500), nullable=False)
    file_size = Column(Integer, nullable=True)  # bytes
    file_type = Column(String(50), nullable=True)  # pdf, txt, csv, etc.

    # 状态
    status = Column(
        SQLEnum(
            "uploading", "processing", "ready", "failed", "pending", name="file_status"
        ),
        default="uploading",
        index=True,
    )
    error_message = Column(Text, nullable=True)

    # 元数据
    metadata_json = Column(JSON, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关系
    agent = relationship("Agent", back_populates="knowledge_files")

    # 索引
    __table_args__ = (Index("ix_knowledge_files_agent", "agent_id"),)


class ChatSession(Base):
    """聊天会话模型"""

    __tablename__ = "chat_sessions"

    id = Column(
        String(50), primary_key=True, default=lambda: f"sess_{uuid.uuid4().hex[:12]}"
    )
    agent_id = Column(String(50), ForeignKey("agents.id"), nullable=False, index=True)

    # 会话标识
    session_id = Column(
        String(100), nullable=False, index=True
    )  # 客户端提供的session_id
    locale = Column(String(10), nullable=True, default="zh-CN")

    # 访客信息
    # #46: a signed identity is `<email>:<hmac hex>` (254 + ':' + 64 <= 319), so
    # the column has to hold an address as well as the old anonymous random id.
    visitor_id = Column(String(320), nullable=True, index=True)  # 访客标识
    visitor_ip = Column(String(50), nullable=True)  # 访客 IP
    visitor_user_agent = Column(String(500), nullable=True)  # 访客浏览器信息
    visitor_country = Column(String(50), nullable=True)  # 访客国家
    visitor_region = Column(String(50), nullable=True)  # 访客省份/地区
    visitor_city = Column(String(50), nullable=True)  # 访客城市

    # 会话状态: active-活跃, taken_over-已接管, resolved-已解决, closed-已关闭, paused-已暂停(垃圾消息)
    status = Column(String(20), nullable=False, default="active", index=True)
    # Who is expected to answer: "ai" or "human". A single operator reply sets
    # mode="human" without touching `status`, so "human answered, bot still
    # available" is representable (#43).
    mode = Column(String(10), nullable=False, default="ai")
    # First human message time; NULL means the bot has answered everything.
    human_replied_at = Column(DateTime(timezone=True), nullable=True)
    # Set when a lead form was submitted from this session (#41). These are
    # operator metadata captured by the widget's prechat/offline form and are
    # NEVER part of the prompt handed to the model (asserted by
    # tests/test_prechat_isolation.py on the assembled message array).
    contact_email = Column(String(255), nullable=True)
    contact_name = Column(String(100), nullable=True)
    # Idempotency guard for the closing transcript email (#41).
    transcript_sent_at = Column(DateTime(timezone=True), nullable=True)
    # Active procedure + step pointer (#39).
    active_procedure_id = Column(String(36), nullable=True)
    procedure_step = Column(Integer, default=0)
    # Async classification (#45): filled ~30 min after the session goes quiet.
    topic = Column(String(100), nullable=True)
    sentiment = Column(String(20), nullable=True)
    outcome = Column(String(20), nullable=True)
    # Number of messages in this session that got an AI answer (spam-check
    # sampling counts turns, #44).
    ai_turn_count = Column(Integer, default=0)

    # 统计
    message_count = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)

    # 时间
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关系
    agent = relationship("Agent", back_populates="chat_sessions")
    messages = relationship(
        "ChatMessage", back_populates="session", cascade="all, delete-orphan"
    )

    # 索引
    __table_args__ = (
        Index(
            "uq_chat_sessions_active_session",
            "agent_id",
            "session_id",
            unique=True,
            sqlite_where=text("status != 'closed'"),
        ),
        Index("ix_chat_sessions_agent_session", "agent_id", "session_id"),
        Index("ix_chat_sessions_updated", "updated_at"),
    )


class ChatMessage(Base):
    """聊天消息模型"""

    __tablename__ = "chat_messages"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(
        String(50), ForeignKey("chat_sessions.id"), nullable=False, index=True
    )

    # 消息内容
    role = Column(
        SQLEnum("user", "assistant", "system", name="message_role"), nullable=False
    )
    content = Column(Text, nullable=False)

    # 发送者信息（用于区分人工和 Agent）
    sender_type = Column(String(20), nullable=True)  # 'agent', 'human'
    sender_id = Column(String(50), nullable=True)  # 管理员ID（人工发送时）

    # Answer quality (#42). Both nullable/defaulted so existing rows need no
    # backfill: confidence 0..1 from the retrieval score, is_unanswered set when
    # the answer was the fallback or nothing was retrieved for a real question.
    confidence = Column(Float, nullable=True)
    is_unanswered = Column(Boolean, nullable=False, default=False)
    # Thumbs vote (#41): -1 / 0 / +1, where 0 retracts. Stored on the visitor's
    # own message so the vote renders in the transcript's own context.
    rating = Column(Integer, nullable=True)
    # #60: how this answer was produced. `ai` for every model answer (today's
    # only value), `scripted` for a keyword-matched curated pair. Distinct from
    # `ChatSession.mode`, which says who is *expected* to answer.
    mode = Column(String(20), nullable=False, default="ai")
    # #60: what matched a `scripted` answer: `keyword`, or NULL for a miss / for
    # every `ai` turn. The transcript needs it to tell an FAQ hit from the
    # operator's apology — both are `mode="scripted"` and only one is an answer.
    matched_by = Column(String(20), nullable=True)

    # 引用来源
    sources = Column(
        JSON, nullable=True
    )  # [{"type": "url", "title": "...", "url": "...", "snippet": "..."}]

    # Token使用
    prompt_tokens = Column(Integer, nullable=True)
    completion_tokens = Column(Integer, nullable=True)

    # 时间
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # 关系
    session = relationship("ChatSession", back_populates="messages")

    # 索引
    __table_args__ = (
        Index("ix_chat_messages_session_created", "session_id", "created_at"),
    )


class WorkspaceQuota(Base):
    """工作空间配额模型"""

    __tablename__ = "workspace_quotas"

    id = Column(Integer, primary_key=True, index=True)
    workspace_id = Column(
        Integer, ForeignKey("workspaces.id"), nullable=False, unique=True, index=True
    )

    # 配额限制（存储/滥用保护，不是计费）
    max_agents = Column(Integer, default=10)
    max_urls = Column(Integer, default=500)
    max_qa_items = Column(Integer, default=100)
    max_total_text_mb = Column(Integer, default=20)  # 最大文本量MB

    # 当前使用量
    used_urls = Column(Integer, default=0)
    used_qa_items = Column(Integer, default=0)
    used_total_text_mb = Column(Float, default=0.0)

    # 时间
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关系
    workspace = relationship("Workspace", back_populates="quotas")


class AgentMember(Base):
    """Per-agent admin membership."""

    __tablename__ = "agent_members"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(String(50), ForeignKey("agents.id"), nullable=False, index=True)
    admin_user_id = Column(
        Integer, ForeignKey("admin_users.id"), nullable=False, index=True
    )
    role = Column(String(50), default="admin", nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    agent = relationship("Agent", back_populates="members")
    admin_user = relationship("AdminUser", back_populates="agent_members")

    __table_args__ = (
        UniqueConstraint("agent_id", "admin_user_id", name="uq_agent_member_admin"),
    )


class IndexJob(Base):
    """索引构建任务模型"""

    __tablename__ = "index_jobs"

    id = Column(
        String(50), primary_key=True, default=lambda: f"job_{uuid.uuid4().hex[:12]}"
    )
    agent_id = Column(String(50), ForeignKey("agents.id"), nullable=False, index=True)

    # 任务信息
    job_type = Column(
        SQLEnum("full", "incremental", "url_refetch", name="job_type"), nullable=False
    )
    status = Column(
        SQLEnum("queued", "running", "completed", "failed", name="job_status"),
        default="queued",
        index=True,
    )

    # 任务参数
    params = Column(JSON, nullable=True)  # {"url_ids": [...], "force": true}

    # 执行结果
    result = Column(JSON, nullable=True)  # {"chunks_indexed": 100, "errors": []}
    error_message = Column(Text, nullable=True)

    # 时间
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # 索引
    __table_args__ = (
        Index("ix_jobs_agent_status", "agent_id", "status"),
        Index("ix_jobs_created", "created_at"),
    )


class AdminUser(Base):
    """管理员用户模型（用于管理后台登录）"""

    __tablename__ = "admin_users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    name = Column(String(100), nullable=False)
    is_active = Column(Boolean, default=True)
    role = Column(String(50), default="admin", nullable=False)
    workspace_id = Column(
        Integer, ForeignKey("workspaces.id"), nullable=True, index=True
    )
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    workspace = relationship("Workspace", back_populates="admin_users")
    agent_members = relationship(
        "AgentMember", back_populates="admin_user", cascade="all, delete-orphan"
    )


class Tenant(Base):
    """租户表（多租户顶层）"""

    __tablename__ = "tenants"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(100), nullable=False)
    slug = Column(String(50), unique=True, nullable=False, index=True)
    plan = Column(String(20), nullable=False, default="free")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    knowledge_bases = relationship(
        "KnowledgeBase", back_populates="tenant", cascade="all, delete-orphan"
    )


class KnowledgeBase(Base):
    """知识库表（每 agent 独立 KB）"""

    __tablename__ = "knowledge_bases"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    # Legacy tenant scope. `workspace_id` is authoritative since the KB-decoupling
    # change; no code path filters or writes `tenant_id` any more.
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=True, index=True)
    workspace_id = Column(
        Integer, ForeignKey("workspaces.id"), nullable=False, index=True
    )
    name = Column(String(100), nullable=False)
    # Embedding config travels with the KB. The API key is stored
    # Fernet-encrypted via `core.encryption`.
    embedding_provider = Column(String(20), nullable=False, default="jina")
    embedding_api_key = Column(String(500), nullable=True)
    embedding_batch_size = Column(Integer, nullable=False, default=4)
    # Measured from the provider, never guessed from the model name.
    embedding_dimension = Column(Integer, nullable=True)
    embedding_model = Column(String(100), nullable=False, default="BAAI/bge-m3")
    embedding_base_url = Column(String(500), nullable=True)
    vector_backend = Column(String(20), nullable=False, default="qdrant")
    qdrant_collection = Column(String(50), unique=True, nullable=False, index=True)
    is_locked = Column(
        Boolean, nullable=False, default=False
    )  # 有 chunk 后锁定 embedding 配置
    chunk_size = Column(Integer, nullable=False, default=512)
    chunk_overlap = Column(Integer, nullable=False, default=64)
    status = Column(
        SQLEnum(
            "active",
            "resetting",
            "processing",
            "error",
            name="kb_status",
        ),
        default="active",
        nullable=False,
        index=True,
    )
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    tenant = relationship("Tenant", back_populates="knowledge_bases")
    documents = relationship(
        "KbDocument", back_populates="knowledge_base", cascade="all, delete-orphan"
    )
    url_sources = relationship(
        "URLSource", back_populates="knowledge_base", cascade="all, delete-orphan"
    )
    agent = relationship("Agent", back_populates="knowledge_base", uselist=False)


class KbDocument(Base):
    """文档表"""

    __tablename__ = "kb_documents"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    kb_id = Column(
        String(36), ForeignKey("knowledge_bases.id"), nullable=False, index=True
    )
    tenant_id = Column(
        String(36), ForeignKey("tenants.id"), nullable=True, index=True
    )
    # Provenance: which agent ingested this document (NULL = unknown / legacy).
    source_agent_id = Column(String(50), nullable=True, index=True)
    filename = Column(String(500), nullable=False)
    file_type = Column(String(20), nullable=True)
    status = Column(
        SQLEnum("pending", "processing", "ready", "error", name="kb_doc_status"),
        default="pending",
        index=True,
    )
    chunk_count = Column(Integer, default=0)
    error_message = Column(Text, nullable=True)
    # --- Ingestion bookkeeping (#47) --------------------------------------
    # sha256 of the *normalised* source text. A refetch that produces the same
    # hash re-uses the indexed chunks instead of re-embedding them.
    item_hash = Column(String(64), nullable=True)
    # Human-readable ingest phase shown to the operator while a two-phase upload
    # is still being worked on (`uploaded` -> `parsing` -> `chunking` ->
    # `embedding` -> `indexing` -> `done`/`failed`). Null on legacy rows.
    processing_stage = Column(String(20), nullable=True)
    file_size = Column(Integer, nullable=True)
    storage_path = Column(String(1000), nullable=True)
    # Metadata for document source info (e.g., URL for crawled pages)
    metadata_json = Column(JSON, nullable=True, default=None)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    knowledge_base = relationship("KnowledgeBase", back_populates="documents")
    chunks = relationship(
        "KbChunk", back_populates="document", cascade="all, delete-orphan"
    )


class KbChunk(Base):
    """Chunk 元数据表"""

    __tablename__ = "kb_chunks"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    kb_id = Column(
        String(36), ForeignKey("knowledge_bases.id"), nullable=False, index=True
    )
    doc_id = Column(
        String(36), ForeignKey("kb_documents.id"), nullable=False, index=True
    )
    # Legacy tenant scope; unused since the KB-decoupling change.
    tenant_id = Column(String(36), ForeignKey("tenants.id"), nullable=True, index=True)
    vector_id = Column(String(100), nullable=True, index=True)  # Qdrant point id
    chunk_index = Column(Integer, nullable=False)
    content_hash = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    document = relationship("KbDocument", back_populates="chunks")


class QaItem(Base):
    """A curated question/answer pair, embedded into a per-KB Q&A index.

    Deliberately not a `KbDocument`: a pair is retrieved against the raw visitor
    phrasing in its own collection, so a near-miss is not diluted by the rest of
    the site's chunks (#39).
    """

    __tablename__ = "qa_items"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    kb_id = Column(
        String(36), ForeignKey("knowledge_bases.id"), nullable=False, index=True
    )
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)
    enabled = Column(Boolean, nullable=False, default=True)
    hits = Column(Integer, nullable=False, default=0)
    last_hit_at = Column(DateTime(timezone=True), nullable=True)
    # #60 — operator-curated trigger words for the LLM-free keyword matcher.
    # Already normalised at write time; absent/empty means the pair is never
    # served by the keyword path (the semantic path still sees it).
    keywords = Column(JSON, nullable=True, default=None)
    # manual | revise | unanswered — provenance, so the UI can show how a pair
    # got here. Not an enum: a new provenance value must not need a migration.
    source = Column(String(20), nullable=False, default="manual")
    # ChatMessage.id this pair was written back from. No FK on purpose: deleting
    # a session must not cascade-delete a curated answer.
    source_message_id = Column(Integer, nullable=True)
    # sha256 of the embedded text; an unchanged pair is not re-embedded.
    embedding_hash = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("kb_id", "question", name="uq_qa_items_kb_question"),
    )


class Procedure(Base):
    """An ordered, human-written list of steps the bot follows, one per turn."""

    __tablename__ = "procedures"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id = Column(String(50), ForeignKey("agents.id"), nullable=False, index=True)
    name = Column(String(200), nullable=False)
    # [{"text": "...", "requires_action": "link" | "form" | null}]
    steps = Column(JSON, nullable=False, default=list)
    enabled = Column(Boolean, nullable=False, default=True)
    # Microsecond precision on purpose: "the first enabled procedure" is ordered
    # by `created_at`, and SQLite's CURRENT_TIMESTAMP only resolves to the second,
    # so two procedures written in the same second would tie. The server default
    # still covers raw-SQL inserts (migrations, fixtures).
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        server_default=func.now(),
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=func.now(),
    )


class Lead(Base):
    """A captured visitor, from an offline form, a prechat form or a trigger."""

    __tablename__ = "leads"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id = Column(String(50), ForeignKey("agents.id"), nullable=False, index=True)
    workspace_id = Column(Integer, ForeignKey("workspaces.id"), nullable=True, index=True)
    session_id = Column(String(50), nullable=True, index=True)
    name = Column(String(100), nullable=True)
    email = Column(String(255), nullable=True, index=True)
    phone = Column(String(50), nullable=True)
    message = Column(Text, nullable=True)
    # offline-form | prechat | trigger | manual
    source = Column(String(20), nullable=False, default="offline-form")
    # The page the visitor submitted from (#41). Visitor-supplied and therefore
    # bounded, never fetched.
    page_url = Column(String(1000), nullable=True)
    # Operator triage: "contacted" is a manual checkbox, not a workflow (#41).
    contacted = Column(Boolean, nullable=False, default=False)
    contacted_at = Column(DateTime(timezone=True), nullable=True)
    # A second submit from the same session updates this row instead of
    # creating one, so the timestamp tracks the latest edit.
    updated_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Webhook(Base):
    """A best-effort outbound webhook. One attempt, 5s timeout, logged only."""

    __tablename__ = "webhooks"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id = Column(String(50), ForeignKey("agents.id"), nullable=False, index=True)
    url = Column(String(1000), nullable=False)
    # Exact event names from SPEC.md C5.
    events = Column(JSON, nullable=False, default=list)
    enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class WebhookDelivery(Base):
    """One queued outbound webhook, written in the domain's own transaction (#47).

    The chat request (or the lead write, or the indexing commit) only ever
    INSERTs here; the scheduler drains the queue. `payload` holds the serialised
    body verbatim so every retry signs byte-identical JSON.
    """

    __tablename__ = "webhook_deliveries"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    agent_id = Column(String(50), ForeignKey("agents.id"), nullable=False, index=True)
    event = Column(String(50), nullable=False, index=True)
    payload = Column(Text, nullable=False)
    # pending | delivered | failed
    status = Column(String(20), nullable=False, default="pending", index=True)
    attempts = Column(Integer, nullable=False, default=0)
    last_error = Column(Text, nullable=True)
    next_attempt_at = Column(DateTime(timezone=True), nullable=True)
    delivered_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_webhook_deliveries_status_created", "status", "created_at"),
    )
