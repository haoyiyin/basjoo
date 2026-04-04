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
import hashlib
import uuid


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


class Workspace(Base):
    """工作空间模型（MVP: 单用户单工作空间）"""

    __tablename__ = "workspaces"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), nullable=False, default="Default Workspace")
    owner_email = Column(String(255), unique=True, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # 关系
    agents = relationship(
        "Agent", back_populates="workspace", cascade="all, delete-orphan"
    )
    quotas = relationship("WorkspaceQuota", back_populates="workspace", uselist=False)


class Agent(Base):
    """Agent模型（MVP: 每工作空间1个Agent）"""

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

    # Jina Embedding API Key
    jina_api_key = Column(String(500), nullable=True)

    # AI服务商配置
    provider_type = Column(
        SQLEnum("openai", "openai_native", "google", "anthropic", "xai", "openrouter", "zai", "deepseek", "volcengine", "moonshot", "aliyun_bailian", name="llm_provider"),
        nullable=True,
        default="openai"
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

    # 嵌入配置
    embedding_model = Column(
        String(100), nullable=False, default="jina-embeddings-v3"
    )

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
    top_k = Column(Integer, nullable=False, default=5)
    similarity_threshold = Column(Float, nullable=False, default=DEFAULT_AGENT_SIMILARITY_THRESHOLD)
    enable_context = Column(Boolean, nullable=False, default=False)

    # AI对话限制配置
    rate_limit_per_hour = Column(
        Integer, nullable=False, default=100
    )  # 每小时对话限制（0表示不限制）
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
    widget_title_i18n = Column(JSON, nullable=True)
    widget_color = Column(String(20), nullable=True, default="#06B6D4")
    welcome_message = Column(
        Text, nullable=True, default="您好！我是Basjoo助手，有什么可以帮您的吗？"
    )
    welcome_message_i18n = Column(JSON, nullable=True)
    restricted_reply_i18n = Column(JSON, nullable=True)
    history_days = Column(Integer, nullable=False, default=30)

    # 状态
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关系
    workspace = relationship("Workspace", back_populates="agents")
    url_sources = relationship(
        "URLSource", back_populates="agent", cascade="all, delete-orphan"
    )
    qa_items = relationship(
        "QAItem", back_populates="agent", cascade="all, delete-orphan"
    )
    chat_sessions = relationship(
        "ChatSession", back_populates="agent", cascade="all, delete-orphan"
    )


class URLSource(Base):
    """URL知识源模型"""

    __tablename__ = "url_sources"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(String(50), ForeignKey("agents.id"), nullable=False, index=True)

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
    agent = relationship("Agent", back_populates="url_sources")
    chunks = relationship(
        "DocumentChunk", back_populates="url_source", cascade="all, delete-orphan"
    )

    # 索引和约束
    __table_args__ = (
        Index("ix_url_sources_agent_status", "agent_id", "status"),
        UniqueConstraint("agent_id", "normalized_url", name="uq_agent_normalized_url"),
    )


class QAItem(Base):
    """Q&A知识条目模型"""

    __tablename__ = "qa_items"

    id = Column(
        String(50), primary_key=True, default=lambda: f"qa_{uuid.uuid4().hex[:12]}"
    )
    agent_id = Column(String(50), ForeignKey("agents.id"), nullable=False, index=True)

    # Q&A内容
    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)  # 支持Markdown

    # 元数据
    tags = Column(JSON, nullable=True)  # 标签列表
    is_indexed = Column(Boolean, nullable=False, default=False)  # 是否已训练
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关系
    agent = relationship("Agent", back_populates="qa_items")

    # 索引
    __table_args__ = (Index("ix_qa_items_agent", "agent_id"),)


class DocumentChunk(Base):
    """文档分块模型（用于向量索引）"""

    __tablename__ = "document_chunks"

    id = Column(Integer, primary_key=True, index=True)
    agent_id = Column(String(50), ForeignKey("agents.id"), nullable=False, index=True)
    url_source_id = Column(
        Integer, ForeignKey("url_sources.id"), nullable=True, index=True
    )

    # 分块内容
    content = Column(Text, nullable=False)
    chunk_index = Column(Integer, nullable=False)  # 在文档中的序号

    # 元数据
    doc_metadata = Column(JSON, nullable=True)  # 标题、URL、片段位置等
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # 关系
    url_source = relationship("URLSource", back_populates="chunks")

    # 索引
    __table_args__ = (
        Index("ix_chunks_url", "url_source_id", "chunk_index"),
    )


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
    visitor_id = Column(String(100), nullable=True, index=True)  # 访客标识
    visitor_ip = Column(String(50), nullable=True)  # 访客 IP
    visitor_user_agent = Column(String(500), nullable=True)  # 访客浏览器信息
    visitor_country = Column(String(50), nullable=True)  # 访客国家
    visitor_region = Column(String(50), nullable=True)  # 访客省份/地区
    visitor_city = Column(String(50), nullable=True)  # 访客城市

    # 会话状态: active-活跃, taken_over-已接管, closed-已关闭
    status = Column(String(20), nullable=False, default="active", index=True)

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
    sender_id = Column(String(50), nullable=True)    # 管理员ID（人工发送时）

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

    # 配额限制（MVP限制）
    max_agents = Column(Integer, default=1)
    max_urls = Column(Integer, default=50)
    max_qa_items = Column(Integer, default=500)
    max_messages_per_day = Column(Integer, default=1500)
    max_total_text_mb = Column(Integer, default=20)  # 最大文本量MB

    # 当前使用量
    used_urls = Column(Integer, default=0)
    used_qa_items = Column(Integer, default=0)
    used_messages_today = Column(Integer, default=0)
    used_total_text_mb = Column(Float, default=0.0)

    # 重置时间
    last_message_reset = Column(DateTime(timezone=True), nullable=True)

    # 时间
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # 关系
    workspace = relationship("Workspace", back_populates="quotas")


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
    created_at = Column(DateTime(timezone=True), server_default=func.now())
