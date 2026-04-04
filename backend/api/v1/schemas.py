"""API v1 Pydantic schemas"""

from pydantic import BaseModel, Field, ConfigDict, field_validator
from typing import Optional, List, Dict, Any, Literal
from datetime import datetime
from urllib.parse import urlsplit
import re


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
    visitor_id: Optional[str] = Field(
        None, max_length=100, description="访客标识"
    )
    # 客户端传送的地理信息（用于无法从IP获取的情况）
    timezone: Optional[str] = Field(None, description="客户端时区")
    params: Optional[Dict[str, Any]] = Field(
        None, description="推理参数（temperature, max_tokens等）"
    )


class SourceItem(BaseModel):
    """来源项"""

    type: Literal["url", "qa"] = Field(..., description="来源类型")
    title: Optional[str] = Field(None, description="标题（URL类型）")
    url: Optional[str] = Field(None, description="URL（URL类型）")
    snippet: Optional[str] = Field(None, description="摘要片段")
    question: Optional[str] = Field(None, description="问题（Q&A类型）")
    id: Optional[str] = Field(None, description="Q&A ID（Q&A类型）")


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

    type: Literal["url", "qa"] = Field(..., description="类型")
    url: Optional[str] = Field(None, description="URL（URL类型）")
    title: Optional[str] = Field(None, description="标题（URL类型）")
    score: float = Field(..., ge=0, le=1, description="相似度分数")
    chunk_id: Optional[str] = Field(None, description="块ID（URL类型）")
    id: Optional[str] = Field(None, description="Q&A ID（Q&A类型）")


class ContextResponse(BaseModel):
    """检索上下文响应"""

    contexts: List[ContextItem] = Field(default_factory=list, description="检索结果")


# ========== URL Management Schemas ==========


class URLCreateRequest(BaseModel):
    """创建URL知识源请求"""

    urls: List[str] = Field(..., min_length=1, max_length=10, description="URL列表")

    @field_validator("urls")
    @classmethod
    def validate_urls(cls, urls: List[str]) -> List[str]:
        """Validate that all URLs are properly formatted"""
        url_pattern = re.compile(
            r"^https?://"  # http:// or https://
            r"(?:(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,6}\.?|"  # domain
            r"localhost|"  # localhost
            r"\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})"  # IP address
            r"(?::\d+)?"  # optional port
            r"(?:/?|[/?]\S+)$",
            re.IGNORECASE,
        )

        invalid_urls = []
        for url in urls:
            if not url_pattern.match(url):
                invalid_urls.append(url)

        if invalid_urls:
            raise ValueError(f"Invalid URL format: {', '.join(invalid_urls[:3])}")

        return urls


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
        None, description="要重抓的URL ID列表（不指定则全部重抓）"
    )
    force: bool = Field(False, description="是否强制重抓（忽略内容哈希）")


class URLRefetchResponse(BaseModel):
    """重新抓取响应"""

    job_id: str
    status: str
    message: str


class SiteCrawlRequest(BaseModel):
    """全站爬取请求"""

    url: str = Field(..., description="起始URL")
    max_depth: int = Field(2, ge=1, le=5, description="最大爬取深度")
    max_pages: int = Field(20, ge=1, le=50, description="最大页面数量")

    @field_validator("url")
    @classmethod
    def validate_url(cls, url: str) -> str:
        """Validate URL format"""
        url_pattern = re.compile(
            r"^https?://"
            r"(?:(?:[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?\.)+[A-Z]{2,6}\.?|"
            r"localhost|"
            r"\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})"
            r"(?::\d+)?"
            r"(?:/?|[/?]\S+)$",
            re.IGNORECASE,
        )
        if not url_pattern.match(url):
            raise ValueError(f"Invalid URL format: {url}")
        return url


class SiteCrawlResponse(BaseModel):
    """全站爬取响应"""

    job_id: str = Field(..., description="任务ID")
    status: str = Field(..., description="任务状态")
    discovered: int = Field(..., description="发现的页面数")
    created: int = Field(..., description="新增的URL数")
    message: str = Field(..., description="状态消息")


# ========== Q&A Management Schemas ==========


class QABatchImportRequest(BaseModel):
    """批量导入Q&A请求"""

    format: Literal["json", "csv"] = Field("json", description="导入格式")
    content: str = Field(..., description="JSON/CSV内容")
    overwrite: bool = Field(False, description="是否覆盖已存在的Q&A（根据question）")


class QAItem(BaseModel):
    """Q&A项"""

    model_config = ConfigDict(from_attributes=True)

    id: str
    question: str
    answer: str
    tags: Optional[List[str]] = None
    is_indexed: bool = False
    created_at: datetime
    updated_at: Optional[datetime] = None


class QAListResponse(BaseModel):
    """Q&A列表响应"""

    items: List[QAItem]
    total: int
    quota: Dict[str, int] = Field(..., description="配额信息（used, max）")


class QAUpdateRequest(BaseModel):
    """更新Q&A请求"""

    question: Optional[str] = Field(None, min_length=1, max_length=500)
    answer: Optional[str] = Field(None, min_length=1)
    tags: Optional[List[str]] = None


class QABatchImportResponse(BaseModel):
    """批量导入响应"""

    imported: int = Field(..., description="成功导入数量")
    failed: int = Field(..., description="失败数量")
    errors: List[str] = Field(default_factory=list, description="错误信息")


# ========== Agent Management Schemas ==========


class AgentConfig(BaseModel):
    """Agent配置"""

    id: str
    name: str
    description: Optional[str] = None
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
    jina_api_key_masked: Optional[str] = Field(
        None, description="Masked Jina API key"
    )
    provider_type: Optional[
        Literal["openai", "openai_native", "google", "anthropic", "xai", "openrouter", "zai", "deepseek", "volcengine", "moonshot", "aliyun_bailian"]
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
    embedding_model: str
    crawl_max_depth: int = Field(default=2, ge=0, le=5, description="Crawl depth for site crawling")
    crawl_max_pages: int = Field(default=20, ge=1, le=100, description="Max pages for site crawling")
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
    rate_limit_per_hour: int = Field(
        default=100, ge=0, description="Rate limit per hour (0 = unlimited)"
    )
    restricted_reply: Optional[str] = Field(
        default="抱歉，当前服务受限，请稍后再试。",
        description="Fallback reply when service is restricted (rate limit, AI failure, etc.)",
    )
    last_error_code: Optional[str] = None
    last_error_message: Optional[str] = None
    last_error_at: Optional[str] = None
    persona_type: Optional[str] = Field(
        default="general", description="Persona type: general, customer-service, sales, custom"
    )
    widget_title: Optional[str] = Field(default="AI 客服", description="Widget title")
    widget_title_i18n: Optional[Dict[str, str]] = Field(
        default=None, description="Localized widget titles"
    )
    widget_color: Optional[str] = Field(
        default="#06B6D4", description="Widget theme color"
    )
    allowed_widget_origins: List[str] = Field(
        default_factory=list, description="Allowed widget embed origins"
    )
    welcome_message: Optional[str] = Field(None, description="Widget welcome message")
    welcome_message_i18n: Optional[Dict[str, str]] = Field(
        default=None, description="Localized widget welcome messages"
    )
    restricted_reply_i18n: Optional[Dict[str, str]] = Field(
        default=None, description="Localized fallback replies when service is restricted"
    )
    history_days: int = Field(default=30, description="Chat history retention days")
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class AgentUpdateRequest(BaseModel):
    """更新Agent配置请求"""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    description: Optional[str] = None
    system_prompt: Optional[str] = Field(None, min_length=1)
    model: Optional[str] = Field(None, min_length=1)
    temperature: Optional[float] = Field(None, ge=0, le=2)
    api_key: Optional[str] = Field(None, min_length=0)
    api_base: Optional[str] = Field(None, min_length=1)
    jina_api_key: Optional[str] = Field(None, min_length=0)
    provider_type: Optional[
        Literal["openai", "openai_native", "google", "anthropic", "xai", "openrouter", "zai", "deepseek", "volcengine", "moonshot", "aliyun_bailian"]
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
    embedding_model: Optional[str] = Field(None, min_length=1)
    crawl_max_depth: Optional[int] = Field(None, ge=0, le=5, description="Crawl depth for site crawling")
    crawl_max_pages: Optional[int] = Field(None, ge=1, le=100, description="Max pages for site crawling")
    top_k: Optional[int] = Field(None, ge=1, le=20)
    enable_context: Optional[bool] = Field(
        None, description="Enable conversation context"
    )
    enable_auto_fetch: Optional[bool] = Field(
        None, description="Enable automatic URL fetching"
    )
    url_fetch_interval_days: Optional[int] = Field(
        None, ge=1, le=30, description="URL fetch interval in days"
    )
    rate_limit_per_hour: Optional[int] = Field(
        None, ge=0, description="Rate limit per hour (0 = unlimited)"
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
    widget_title_i18n: Optional[Dict[str, str]] = Field(
        None, description="Localized widget titles"
    )
    widget_color: Optional[str] = Field(
        None, max_length=20, description="Widget theme color"
    )
    allowed_widget_origins: Optional[List[str]] = Field(
        None, description="Allowed widget embed origins"
    )
    welcome_message: Optional[str] = Field(None, description="Widget welcome message")
    welcome_message_i18n: Optional[Dict[str, str]] = Field(
        None, description="Localized widget welcome messages"
    )
    restricted_reply_i18n: Optional[Dict[str, str]] = Field(
        None, description="Localized fallback replies when service is restricted"
    )
    history_days: Optional[int] = Field(
        None, ge=1, le=365, description="Chat history retention days"
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
    max_qa_items: int
    max_messages_per_day: int
    max_total_text_mb: int
    used_agents: int
    used_urls: int
    used_qa_items: int
    used_messages_today: int
    used_total_text_mb: float
    remaining_urls: int
    remaining_qa_items: int
    remaining_messages_today: int


# ========== Session Schemas ==========


class SessionListItem(BaseModel):
    """会话列表项"""

    id: str
    session_id: str
    visitor_id: Optional[str] = None
    visitor_country: Optional[str] = None
    visitor_city: Optional[str] = None
    status: str = "active"
    message_count: int = 0
    created_at: datetime
    updated_at: Optional[datetime] = None
    last_message: Optional[str] = None


class SessionListResponse(BaseModel):
    """会话列表响应"""

    items: List[SessionListItem]
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

    provider_type: Literal["openai_native", "google"] = Field(
        ..., description="AI provider type"
    )
    api_key: Optional[str] = Field(None, description="API key (if not using saved key)")
    agent_id: Optional[str] = Field(None, description="Agent ID (to use saved API key)")


class ModelsListResponse(BaseModel):
    """获取可用模型列表响应"""

    models: List[str] = Field(default_factory=list, description="Available models")


# ========== Sources Summary Schemas ==========


class SourcesURLSummary(BaseModel):
    """URL知识源统计"""
    total: int = Field(..., description="URL总数")
    indexed: int = Field(..., description="已训练数量")
    pending: int = Field(..., description="待训练数量")
    total_size_kb: float = Field(..., description="总大小(KB)")


class SourcesQASummary(BaseModel):
    """QA知识源统计"""
    total: int = Field(..., description="QA总数")
    indexed: int = Field(..., description="已训练数量")
    pending: int = Field(..., description="待训练数量")
    total_size_kb: float = Field(..., description="总大小(KB)")


class SourcesSummaryResponse(BaseModel):
    """知识源统计响应"""
    urls: SourcesURLSummary
    qa: SourcesQASummary
    has_pending: bool = Field(..., description="是否有待训练内容")
