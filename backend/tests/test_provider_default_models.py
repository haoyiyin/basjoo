"""get_llm_service 各 provider 分支的默认 model / base_url 回归测试。

这些用例只构造 provider 实例，不发送任何网络请求：
- model 读自 BaseLLMService.model
- base_url 读自 provider.client.base_url（openai SDK 的 AsyncOpenAI 客户端，
  构造时不会发起连接；httpx 会给 base_url 补上结尾斜杠，所以比较前 rstrip）。

覆盖 plan Lane B 的模型 ID 刷新表，并锁定真实缺陷：
前端会发送 "moonshot" / "aliyun_bailian"，历史上后端没有对应分支，
这两个 provider 会落到最后的 else 走 api.openai.com。
"""

import pytest

from services.llm_service import (
    GOOGLE_OPENAI_BASE_URL,
    BaseLLMService,
    MockLLMService,
    OpenAIProvider,
    OpenAINativeProvider,
    get_llm_service,
)

API_KEY = "test-key"
OPENAI_COMPAT_BASE_URL = "https://api.openai.com/v1"

# provider_type -> (默认 model, 默认 base_url)
EXPECTED_DEFAULTS = {
    "openai_native": ("gpt-6.1-sol", "https://api.openai.com/v1"),
    "google": ("gemini-3.8-flash", GOOGLE_OPENAI_BASE_URL),
    "anthropic": ("claude-sonnet-5-5", "https://api.anthropic.com/v1"),
    "xai": ("grok-4.7", "https://api.x.ai/v1"),
    "openrouter": ("openai/gpt-6.1-sol", "https://openrouter.ai/api/v1"),
    "zai": ("glm-5.3", "https://api.z.ai/v1"),
    "deepseek": ("deepseek-v4-flash", "https://api.deepseek.com/v1"),
    "volcengine": (
        "doubao-seed-2-1-pro-260628",
        "https://ark.cn-beijing.volces.com/api/v3",
    ),
    "tencentcloud": ("hy3", "https://api.hunyuan.cloud.tencent.com/v1"),
    "aliyun": ("qwen3.8-flash", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
    "aliyun_bailian": (
        "qwen3.8-flash",
        "https://dashscope.aliyuncs.com/compatible-mode/v1",
    ),
    "moonshot": ("kimi-k3", "https://api.moonshot.cn/v1"),
    "siliconflow": ("deepseek-ai/DeepSeek-V4-Flash", "https://api.siliconflow.cn/v1"),
    "openai": ("gpt-6.1-sol", OPENAI_COMPAT_BASE_URL),
}

# 旧模型 ID 不应再作为任何分支的默认值出现
RETIRED_MODELS = [
    "gpt-4o",
    "openai/gpt-4o",
    "gemini-pro",
    "gemini-2.5-flash",
    "claude-3-5-sonnet-20241022",
    "grok-2-latest",
    "z1-preview",
    "doubao-pro-32k",
    "hunyuan-pro",
    "qwen-plus",
    "deepseek-ai/DeepSeek-V3",
]


def build(provider_type: str, **overrides) -> BaseLLMService:
    """按被测 provider 构造 service 实例（model=None 逼出分支默认值）。"""
    kwargs = {"api_key": API_KEY, "model": None, "provider_type": provider_type}
    kwargs.update(overrides)
    return get_llm_service(**kwargs)


def base_url_of(service: BaseLLMService) -> str:
    """provider 实际使用的 base_url（httpx 会补尾斜杠，这里去掉）。"""
    return str(service.client.base_url).rstrip("/")


@pytest.mark.parametrize(
    ("provider_type", "expected_model", "expected_base_url"),
    [
        pytest.param(key, model, url, id=key)
        for key, (model, url) in EXPECTED_DEFAULTS.items()
    ],
)
def test_provider_default_model_and_base_url(provider_type, expected_model, expected_base_url):
    service = build(provider_type)

    assert isinstance(service, BaseLLMService)
    assert service.model == expected_model
    assert base_url_of(service) == expected_base_url


def test_deepseek_default_model_is_unchanged():
    """表中唯一“不变”的一行，单独钉住。"""
    service = build("deepseek")
    assert service.model == "deepseek-v4-flash"
    assert base_url_of(service) == "https://api.deepseek.com/v1"


def test_openai_native_uses_dedicated_provider_class():
    service = build("openai_native")

    assert isinstance(service, OpenAINativeProvider)
    assert service.model == "gpt-6.1-sol"
    assert base_url_of(service) == OpenAINativeProvider.OPENAI_BASE_URL


def test_google_uses_openai_compatible_surface_without_stream_options():
    service = build("google")

    assert isinstance(service, OpenAIProvider)
    assert service.send_stream_options is False
    assert base_url_of(service) == GOOGLE_OPENAI_BASE_URL
    assert service.model == "gemini-3.8-flash"


@pytest.mark.parametrize("provider_type", ["moonshot", "aliyun_bailian"])
def test_frontend_provider_types_no_longer_fall_through_to_openai(provider_type):
    """真实缺陷：前端发 moonshot / aliyun_bailian，过去落到 else 走 api.openai.com。"""
    service = build(provider_type)

    assert isinstance(service, OpenAIProvider)
    assert "api.openai.com" not in base_url_of(service)
    assert base_url_of(service) == EXPECTED_DEFAULTS[provider_type][1]
    assert service.model == EXPECTED_DEFAULTS[provider_type][0]


def test_aliyun_bailian_matches_legacy_aliyun_branch():
    """向后兼容：aliyun 与 aliyun_bailian 两个 key 必须解析出同一个 service。"""
    legacy = build("aliyun")
    frontend = build("aliyun_bailian")

    assert base_url_of(legacy) == base_url_of(frontend)
    assert legacy.model == frontend.model == "qwen3.8-flash"


def test_tencentcloud_branch_is_kept():
    service = build("tencentcloud")

    assert isinstance(service, OpenAIProvider)
    assert base_url_of(service) == "https://api.hunyuan.cloud.tencent.com/v1"
    assert service.model == "hy3"


@pytest.mark.parametrize("retired", RETIRED_MODELS)
def test_retired_model_ids_are_not_factory_defaults(retired):
    """刷新后的分支默认值里不应再出现旧模型 ID。"""
    defaults = [model for model, _ in EXPECTED_DEFAULTS.values()]
    assert retired not in defaults


def test_unknown_provider_type_still_falls_back_to_openai_compatible():
    """else 分支保持原样：未知 provider 仍走 OpenAI 兼容默认值。"""
    service = build("some_totally_unknown_provider")

    assert isinstance(service, OpenAIProvider)
    assert base_url_of(service) == OPENAI_COMPAT_BASE_URL
    assert service.model == "gpt-6.1-sol"


@pytest.mark.parametrize(
    "provider_type",
    sorted(set(EXPECTED_DEFAULTS) - {"openai_native"}),
)
def test_explicit_model_and_api_base_override_defaults(provider_type):
    """用户显式配置的 model / api_base 不受默认值刷新影响。"""
    service = build(
        provider_type,
        model="user-chosen-model",
        api_base="https://proxy.example.com/v1",
    )

    assert service.model == "user-chosen-model"
    assert base_url_of(service) == "https://proxy.example.com/v1"


def test_openai_native_pins_the_official_base_url():
    """openai_native 是固定 base_url 的 provider（既有设计），api_base 不生效。"""
    service = build(
        "openai_native",
        model="user-chosen-model",
        api_base="https://proxy.example.com/v1",
    )

    assert service.model == "user-chosen-model"
    assert base_url_of(service) == OpenAINativeProvider.OPENAI_BASE_URL


@pytest.mark.parametrize("provider_type", ["openai", "moonshot", "aliyun_bailian"])
def test_empty_model_string_falls_back_to_default(provider_type):
    """Agent 记录里 model 为 "" 时（示例种子就是这么存的）应使用分支默认值。"""
    service = build(provider_type, model="")

    assert service.model == EXPECTED_DEFAULTS[provider_type][0]


def test_missing_api_key_still_returns_mock_service():
    """没有 api key 时的 mock 兜底逻辑不应被本次改动破坏。"""
    service = get_llm_service(api_key="", model=None, provider_type="moonshot")

    assert isinstance(service, MockLLMService)


def test_every_provider_the_database_can_store_has_its_own_branch():
    """models.Agent.provider_type 的枚举值都不能意外落到 api.openai.com。"""
    from models import Agent

    stored_providers = Agent.provider_type.type.enums
    openai_compatible_keys = {"openai", "openai_native"}

    for provider_type in stored_providers:
        if provider_type in openai_compatible_keys:
            continue
        service = build(provider_type)
        assert base_url_of(service) != OPENAI_COMPAT_BASE_URL, (
            f"{provider_type} 落到了 else 分支（api.openai.com）"
        )
        assert provider_type in EXPECTED_DEFAULTS, f"{provider_type} 缺少默认值断言"
