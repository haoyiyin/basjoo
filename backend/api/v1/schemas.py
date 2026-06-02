"""API v1 Pydantic schemas"""

from pydantic import AliasChoices, BaseModel, Field, ConfigDict, field_validator
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime
from urllib.parse import urlsplit

from services.url_safety import validate_url_safe


def normalize_widget_origin(origin: str) -> str:
    raw_origin = origin.strip()
    if not raw_origin:
        raise ValueError("Widget origin cannot be empty")

    parsed = urlsplit(raw_origin)
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Widget origins must start with http:// or https://")

    if parsed.username or parsed.password:
        raise ValueError("Widget origins cannot include credentials")

    return f"{parsed.scheme.lower()}://{parsed.netloc.lower()}"


# ========== Chat & Context Schemas ==========


class ChatRequest(BaseModel):
    """聊天请求"""

    agent_id: str = Field(..., description="Agent ID")
    message: str = Field(
        ...,
        min_length=1,
        max_length=1000,
        description="用户消息（限制1000字符防止内存耗尽攻击）",
    )
    locale: Optional[str] = Field(None, description="语言")
    session_id: Optional[str] = Field(
        None, max_length=200, description="会话ID（用于多轮对话）"
    )
    visitor_id: Optional[str] = Field(None, max_length=100, description="访客标识")
    # 客户端传送的地理信息（用于无法从IP获取的情况）
    timezone: Optional[str] = Field(None, description="客户端时区")
    params: Optional[Dict[str, Any]] = Field(
        None, description="推理参数（temperature, max_tokens等）"
    )


class SourceItem(BaseModel):
    """来源项"""

    type: Literal["url", "file"] = Field(..., description="来源类型")
    title: Optional[str] = Field(None, description="标题")
    url: Optional[str] = Field(None, description="URL（URL类型）")
    snippet: Optional[str] = Field(None, description="摘要片段")
    filename: Optional[str] = Field(None, description="文件名（文件类型）")


class UsageInfo(BaseModel):
    """Token使用信息"""

    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class ChatResponse(BaseModel):
    """聊天响应"""

    reply: str = Field(..., description="AI回复")
    sources: List[SourceItem] = Field(default_factory=list, description="引用来源")
    usage: Optional[UsageInfo] = Field(None, description="Token使用量")
    session_id: Optional[str] = Field(None, description="会话ID")
    message_id: Optional[int] = Field(None, description="消息ID")
    taken_over: bool = Field(False, description="会话是否已被人工接管")


class ContextRequest(BaseModel):
    """检索上下文请求"""

    agent_id: str = Field(..., description="Agent ID")
    query: str = Field(..., min_length=1, max_length=500, description="查询文本")
    top_k: Optional[int] = Field(5, ge=1, le=20, description="返回结果数")
    locale: Optional[str] = Field(None, description="语言代码")


class ContextItem(BaseModel):
    """上下文项"""

    type: Literal["url", "file"] = Field(..., description="类型")
    url: Optional[str] = Field(None, description="URL（URL类型）")
    title: Optional[str] = Field(None, description="标题")
    filename: Optional[str] = Field(None, description="文件名（文件类型）")
    score: float = Field(..., ge=0, le=1, description="相似度分数")


class ContextResponse(BaseModel):
    """检索上下文响应"""

    contexts: List[ContextItem] = Field(default_factory=list, description="检索结果")


# ========== URL Management Schemas ==========


def _validate_safe_ingest_url(url: str) -> str:
    normalized = (url or "").strip()
    if len(normalized) > 2048:
        raise ValueError("URL exceeds maximum length")
    safe, reason = validate_url_safe(normalized)
    if not safe:
        raise ValueError(f"Invalid URL: {normalized}")
    return normalized


class URLCreateRequest(BaseModel):
    """创建URL知识源请求"""

    urls: List[str] = Field(..., min_length=1, max_length=10, description="URL列表")

    @field_validator("urls")
    @classmethod
    def validate_urls(cls, urls: List[str]) -> List[str]:
        return [_validate_safe_ingest_url(url) for url in urls]


class URLItem(BaseModel):
    """URL项"""

    model_config = ConfigDict(from_attributes=True)

    id: int
    url: str
    normalized_url: str
    status: Literal["pending", "fetching", "success", "failed"]
    title: Optional[str] = None
    last_fetch_at: Optional[datetime] = None
    is_indexed: bool = False
    created_at: datetime
    updated_at: Optional[datetime] = None


class URLListResponse(BaseModel):
    """URL列表响应"""

    urls: List[URLItem]
    total: int
    quota: Dict[str, int] = Field(..., description="配额信息（used, max）")


class URLRefetchRequest(BaseModel):
    """重新抓取URL请求"""

    url_ids: Optional[List[int]] = Field(
        None, max_length=500, description="要重抓的URL ID列表（不指定则全部重抓）"
    )
    force: bool = Field(False, description="是否强制重抓（忽略内容哈希）")


class URLRefetchResponse(BaseModel):
    """重新抓取响应"""

    job_id: str
    status: str
    message: str


class SiteCrawlRequest(BaseModel):
    """全站爬取请求"""

    url: str = Field(..., max_length=2048, description="起始URL")
    max_depth: int = Field(2, ge=1, le=5, description="最大爬取深度")
    max_pages: int = Field(20, ge=1, le=500, description="最大页面数量")

    @field_validator("url")
    @classmethod
    def validate_url(cls, url: str) -> str:
        return _validate_safe_ingest_url(url)


class SiteCrawlResponse(BaseModel):
    """全站爬取响应"""

    job_id: str = Field(..., description="任务ID")
    status: str = Field(..., description="任务状态")
    discovered: int = Field(..., description="发现的页面数")
    created: int = Field(..., description="新增的URL数")
    message: str = Field(..., description="状态消息")


# ========== File Upload Schemas ==========


class FileItem(BaseModel):
    """文件项"""

    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    file_size: Optional[int] = None
    file_type: Optional[str] = None
    status: Literal["uploading", "processing", "ready", "failed", "pending"] = (
        "uploading"
    )
    error_message: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None


class FileListResponse(BaseModel):
    """文件列表响应"""

    files: List[FileItem]
    total: int
    quota: Dict[str, int] = Field(..., description="配额信息（used, max）")


class FileUploadResponse(BaseModel):
    """文件上传响应"""

    uploaded: int = Field(..., description="成功上传数量")
    failed: int = Field(..., description="失败数量")
    files: List[FileItem] = Field(default_factory=list, description="上传的文件列表")
    errors: List[str] = Field(default_factory=list, description="错误信息")


# ========== KB Document Schemas ==========


class KbDocumentItem(BaseModel):
    """KB 文档项"""

    model_config = ConfigDict(from_attributes=True)

    id: str
    filename: str
    file_type: Optional[str] = None
    status: Literal["pending", "processing", "ready", "error"] = "pending"
    chunk_count: int = 0
    error_message: Optional[str] = None
    created_at: Optional[datetime] = None


class KbDocumentUploadResponse(BaseModel):
    """KB 文档上传响应"""

    uploaded: int = 0
    failed: int = 0
    documents: List[KbDocumentItem] = Field(default_factory=list)


class KbDocumentProgressResponse(BaseModel):
    """KB 文档索引进度响应"""

    status: str
    chunk_count: int = 0
    error_message: Optional[str] = None


# ========== KB Config/Reset Schemas ==========


class KbConfigResponse(BaseModel):
    """KB embedding configuration response"""

    id: str
    name: str
    embedding_model: str
    embedding_base_url: Optional[str] = None
    vector_backend: str
    chunk_size: int
    chunk_overlap: int
    is_locked: bool
    status: str


class KbConfigUpdate(BaseModel):
    """KB config update request (embedding fields blocked when locked)"""

    name: Optional[str] = None
    chunk_size: Optional[int] = None
    chunk_overlap: Optional[int] = None
    embedding_model: Optional[str] = None
    embedding_base_url: Optional[str] = None


class KbResetRequest(BaseModel):
    """KB reset request (change embedding model + reindex)"""

    new_embedding_model: str
    new_embedding_base_url: Optional[str] = None


class KbDetailResponse(KbConfigResponse):
    """KB detail with document/chunk counts"""

    document_count: int = 0
    ready_document_count: int = 0
    total_chunks: int = 0


class KbDeleteResponse(BaseModel):
    """KB delete response"""

    deleted: bool = True
    message: Optional[str] = None


# ========== Agent Management Schemas ==========


class AgentConfig(BaseModel):
    """Agent配置"""

    id: str
    workspace_id: Optional[int] = None
    name: str
    description: Optional[str] = None
    agent_type: str = Field(default="website_support")
    channel_mode: str = Field(default="web_widget")
    avatar: Optional[str] = None
    system_prompt: str
    model: str
    temperature: float = Field(..., ge=0, le=2)
    max_tokens: int = Field(..., ge=1, le=4096)
    api_key_set: bool = Field(
        default=False, description="Whether API key is configured"
    )
    api_key_masked: Optional[str] = Field(
        None, description="Masked API key (sk-***...abc)"
    )
    api_base: Optional[str] = None
    jina_api_key_set: bool = Field(
        default=False, description="Whether Jina API key is configured"
    )
    jina_api_key_masked: Optional[str] = Field(None, description="Masked Jina API key")
    siliconflow_api_key_set: bool = Field(
        default=False, description="Whether SiliconFlow embedding API key is configured"
    )
    siliconflow_api_key_masked: Optional[str] = Field(
        None, description="Masked SiliconFlow embedding API key"
    )
    provider_type: Optional[
        Literal[
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
        ]
    ] = Field("openai", description="AI provider type")
    azure_endpoint: Optional[str] = Field(None, description="Azure OpenAI endpoint URL")
    azure_deployment_name: Optional[str] = Field(
        None, description="Azure deployment name"
    )
    azure_api_version: Optional[str] = Field(
        "2023-12-01-preview", description="Azure API version"
    )
    anthropic_version: Optional[str] = Field(
        "2023-06-01", description="Anthropic API version"
    )
    google_project_id: Optional[str] = Field(None, description="Google project ID")
    google_region: Optional[str] = Field(None, description="Google region")
    provider_config: Optional[Dict[str, Any]] = Field(
        None, description="Provider-specific configuration"
    )
    embedding_provider: Literal["jina", "siliconflow", "custom"] = Field(
        "jina",
        description="Embedding provider: jina, siliconflow, or custom",
    )
    embedding_api_base: Optional[str] = Field(
        None, description="Embedding API base URL"
    )
    embedding_api_key_set: bool = Field(
        default=False,
        description="Whether the selected embedding provider has an effective API key configured",
    )
    embedding_model: str
    configuration_error: Optional[str] = Field(
        None,
        description="Non-fatal configuration problem (e.g. invalid custom embedding base); present only when the backend degraded gracefully so the admin can fix it",
    )
    crawl_max_depth: int = Field(
        default=2, ge=0, le=5, description="Crawl depth for site crawling"
    )
    crawl_max_pages: int = Field(
        default=20, ge=1, le=500, description="Max pages for site crawling"
    )
    top_k: int = Field(..., ge=1, le=20)
    similarity_threshold: float = Field(..., ge=0, le=1)
    enable_context: bool = Field(
        default=False, description="Enable conversation context"
    )
    enable_auto_fetch: bool = Field(
        default=False, description="Enable automatic URL fetching"
    )
    url_fetch_interval_days: int = Field(
        default=7, ge=1, le=30, description="URL fetch interval in days"
    )
    rate_limit_per_minute: int = Field(
        default=20, ge=0, description="Rate limit per minute (0 = unlimited)"
    )
    restricted_reply: Optional[str] = Field(
        default="抱歉，当前服务受限，请稍后再试。",
        description="Fallback reply when service is restricted (rate limit, AI failure, etc.)",
    )
    last_error_code: Optional[str] = None
    last_error_message: Optional[str] = None
    last_error_at: Optional[str] = None
    persona_type: Optional[str] = Field(
        default="general",
        description="Persona type: general, customer-service, sales, custom",
    )
    widget_title: Optional[str] = Field(default="AI 客服", description="Widget title")
    widget_color: Optional[str] = Field(
        default="#06B6D4", description="Widget theme color"
    )
    allowed_widget_origins: List[str] = Field(
        default_factory=list, description="Allowed widget embed origins"
    )
    welcome_message: Optional[str] = Field(None, description="Widget welcome message")
    history_days: int = Field(default=30, description="Chat history retention days")
    embedding_batch_size: int = Field(
        default=4, ge=1, le=64, description="Embedding batch size"
    )
    kb_setup_completed: bool = Field(
        default=False, description="Whether the knowledge base setup has been completed"
    )
    is_active: bool
    deleted_at: Optional[datetime] = None
    purge_after: Optional[datetime] = None
    status: Optional[str] = None
    url_count: int = 0
    file_count: int = 0
    active_session_count: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None
    kb_id: Optional[str] = Field(None, description="Bound knowledge base ID (optional)")

    model_config = ConfigDict(from_attributes=True)


class AgentUpdateRequest(BaseModel):
    """更新Agent配置请求"""

    name: Optional[str] = Field(None, min_length=1, max_length=10)

    @field_validator("name", mode="before")
    @classmethod
    def validate_name(cls, value: Any) -> Any:
        return _validate_agent_name(value)

    description: Optional[str] = Field(None, max_length=200)
    agent_type: Optional[
        Literal["website_support", "ai_clone", "sales_outreach", "custom"]
    ] = None
    channel_mode: Optional[Literal["web_widget", "whatsapp", "email", "custom"]] = None
    avatar: Optional[str] = Field(None, max_length=500)
    system_prompt: Optional[str] = Field(None, min_length=1)
    model: Optional[str] = Field(None, min_length=1)
    temperature: Optional[float] = Field(None, ge=0, le=2)
    api_key: Optional[str] = Field(None, min_length=0)
    api_base: Optional[str] = Field(None, min_length=1)
    jina_api_key: Optional[str] = Field(None, min_length=0)
    siliconflow_api_key: Optional[str] = Field(None, min_length=0)
    provider_type: Optional[
        Literal[
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
        ]
    ] = Field(None, description="AI provider type")
    azure_endpoint: Optional[str] = Field(None, description="Azure OpenAI endpoint URL")
    azure_deployment_name: Optional[str] = Field(
        None, description="Azure deployment name"
    )
    azure_api_version: Optional[str] = Field(None, description="Azure API version")
    anthropic_version: Optional[str] = Field(None, description="Anthropic API version")
    google_project_id: Optional[str] = Field(None, description="Google project ID")
    google_region: Optional[str] = Field(None, description="Google region")
    provider_config: Optional[Dict[str, Any]] = Field(
        None, description="Provider-specific configuration"
    )
    embedding_provider: Optional[Literal["jina", "siliconflow", "custom"]] = Field(
        None, description="Embedding provider: jina, siliconflow, or custom"
    )
    embedding_api_base: Optional[str] = Field(
        None, description="Embedding API base URL"
    )
    embedding_model: Optional[str] = Field(None, min_length=1)
    crawl_max_depth: Optional[int] = Field(
        None, ge=0, le=5, description="Crawl depth for site crawling"
    )
    crawl_max_pages: Optional[int] = Field(
        None, ge=1, le=500, description="Max pages for site crawling"
    )
    top_k: Optional[int] = Field(None, ge=1, le=20)
    similarity_threshold: Optional[float] = Field(
        None, ge=0, le=1, description="Minimum similarity score for retrieval results"
    )
    enable_context: Optional[bool] = Field(
        None, description="Enable conversation context"
    )
    enable_auto_fetch: Optional[bool] = Field(
        None, description="Enable automatic URL fetching"
    )
    url_fetch_interval_days: Optional[int] = Field(
        None, ge=1, le=30, description="URL fetch interval in days"
    )
    rate_limit_per_minute: Optional[int] = Field(
        None,
        ge=0,
        description="Rate limit per minute (0 = unlimited)",
        validation_alias=AliasChoices("rate_limit_per_minute", "rate_limit_per_hour"),
    )
    restricted_reply: Optional[str] = Field(
        None, description="Fallback reply when service is restricted"
    )
    persona_type: Optional[str] = Field(
        None, description="Persona type: general, customer-service, sales, custom"
    )
    widget_title: Optional[str] = Field(
        None, max_length=100, description="Widget title"
    )
    widget_color: Optional[str] = Field(
        None, max_length=20, description="Widget theme color"
    )
    allowed_widget_origins: Optional[List[str]] = Field(
        None, description="Allowed widget embed origins"
    )
    welcome_message: Optional[str] = Field(None, description="Widget welcome message")
    history_days: Optional[int] = Field(
        None, ge=1, le=365, description="Chat history retention days"
    )
    embedding_batch_size: Optional[int] = Field(
        None, ge=1, le=64, description="Embedding batch size"
    )

    @field_validator("allowed_widget_origins")
    @classmethod
    def validate_allowed_widget_origins(
        cls, origins: Optional[List[str]]
    ) -> Optional[List[str]]:
        if origins is None:
            return None

        normalized_origins: List[str] = []
        seen_origins = set()
        for origin in origins:
            normalized_origin = normalize_widget_origin(origin)
            if normalized_origin in seen_origins:
                continue
            seen_origins.add(normalized_origin)
            normalized_origins.append(normalized_origin)

        return normalized_origins


AGENT_NAME_MAX_DISPLAY_WIDTH = 10


def _agent_name_display_width(value: str) -> int:
    import unicodedata

    return sum(
        2 if unicodedata.east_asian_width(char) in {"W", "F"} else 1 for char in value
    )


def _validate_agent_name(value: Any) -> Any:
    if value is None or not isinstance(value, str):
        return value
    stripped = value.strip()
    if not stripped:
        raise ValueError("Agent name cannot be empty")
    width = _agent_name_display_width(stripped)
    if width > AGENT_NAME_MAX_DISPLAY_WIDTH:
        raise ValueError(
            f"Agent name must be at most {AGENT_NAME_MAX_DISPLAY_WIDTH} display units "
            "(10 ASCII characters or 5 Chinese characters)"
        )
    return stripped


class AgentCreateRequest(BaseModel):
    """创建Agent请求"""

    name: str = Field(..., min_length=1, max_length=10)
    description: str | None = Field(None, max_length=200)
    agent_type: Literal["website_support", "ai_clone", "sales_outreach", "custom"] = (
        "website_support"
    )
    channel_mode: Literal["web_widget", "whatsapp", "email", "custom"] = "web_widget"

    @field_validator("name", mode="before")
    @classmethod
    def validate_name(cls, value: Any) -> Any:
        return _validate_agent_name(value)

    system_prompt: str | None = Field(None, min_length=1)
    persona_type: str | None = "general"
    widget_title: str | None = Field(None, max_length=100)
    welcome_message: str | None = None


class AgentListResponse(BaseModel):
    """Agent列表响应"""

    agents: list[AgentConfig]
    total: int


class AgentMemberCreateRequest(BaseModel):
    """添加智能体成员请求"""

    email: str
    name: str | None = None
    password: str | None = None
    role: Literal["admin", "support"] = "support"


class AgentMemberItem(BaseModel):
    id: int
    email: str
    name: str
    is_active: bool
    role: str
    member_role: str


class AgentMemberListResponse(BaseModel):
    members: list[AgentMemberItem]
    total: int


# ========== Index Management Schemas ==========


class IndexRebuildRequest(BaseModel):
    """重建索引请求"""

    force: bool = Field(False, description="是否强制重建")


class IndexRebuildResponse(BaseModel):
    """重建索引响应"""

    job_id: str
    status: str
    message: str


# ========== Quota Schemas ==========


class QuotaInfo(BaseModel):
    """配额信息"""

    max_agents: int
    max_urls: int
    max_files: int
    max_messages_per_day: int
    max_total_text_mb: int
    used_agents: int
    used_urls: int
    used_files: int
    used_messages_today: int
    used_total_text_mb: float
    remaining_urls: int
    remaining_files: int
    remaining_messages_today: int


# ========== Session Schemas ==========


class SessionListItem(BaseModel):
    """会话列表项"""

    id: str
    session_id: str
    visitor_id: str | None = None
    visitor_country: str | None = None
    visitor_city: str | None = None
    status: str = "active"
    message_count: int = 0
    created_at: datetime
    updated_at: datetime | None = None
    last_message: str | None = None


class SessionListResponse(BaseModel):
    """会话列表响应"""

    items: list[SessionListItem]
    total: int


# ========== Auth Schemas ==========


class AdminRegisterRequest(BaseModel):
    """管理员注册请求"""

    email: str = Field(..., min_length=1, max_length=255)
    password: str = Field(..., min_length=8, max_length=100)
    name: str = Field(..., min_length=1, max_length=100)


class AdminLoginRequest(BaseModel):
    """管理员登录请求"""

    email: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class AdminResponse(BaseModel):
    """管理员信息响应"""

    id: int
    email: str
    name: str
    is_active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TokenResponse(BaseModel):
    """Token响应"""

    access_token: str
    token_type: str = "bearer"


# ========== Models List Schemas ==========


class ModelsListRequest(BaseModel):
    """获取可用模型列表请求"""

    provider_type: Literal["openai_native", "google", "deepseek"] = Field(
        ..., description="AI provider type"
    )
    api_key: str | None = Field(None, description="API key (if not using saved key)")
    agent_id: str | None = Field(None, description="Agent ID (to use saved API key)")


class ModelsListResponse(BaseModel):
    """获取可用模型列表响应"""

    models: list[str] = Field(default_factory=list, description="Available models")


# ========== Sources Summary Schemas ==========


class SourcesURLSummary(BaseModel):
    """URL知识源统计"""

    total: int = Field(..., description="URL总数")
    indexed: int = Field(..., description="已训练数量")
    pending: int = Field(..., description="待训练数量")
    total_size_kb: float = Field(..., description="总大小(KB)")


class SourcesFileSummary(BaseModel):
    """文件知识源统计"""

    total: int = Field(..., description="文件总数")
    ready: int = Field(..., description="就绪数量")
    processing: int = Field(..., description="处理中数量")
    total_size_kb: float = Field(..., description="总大小(KB)")


class SourcesSummaryResponse(BaseModel):
    """知识源统计响应"""

    urls: SourcesURLSummary
    files: SourcesFileSummary
    has_pending: bool = Field(..., description="是否有待处理内容")


# ========== KB Retrieval Schemas ==========


class RetrieveRequest(BaseModel):
    """Retrieval request body"""

    query: str = Field(..., min_length=1, max_length=1000)
    top_k: int = Field(5, ge=1, le=20)


class RetrieveChunk(BaseModel):
    """Single retrieval result (no vector_id or collection exposed)"""

    text: str
    doc_id: str
    chunk_index: int
    score: float
    filename: Optional[str] = None


class RetrieveResponse(BaseModel):
    """Wrapper for consistency"""

    results: List[RetrieveChunk] = []
