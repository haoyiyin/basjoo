import sys
import types

import pytest

from services.llm_service import (
    GOOGLE_OPENAI_BASE_URL,
    BaseLLMService,
    MockLLMService,
    OpenAINativeProvider,
    OpenAIProvider,
    get_llm_service,
)


class _FakeStreamResponse:
    def __aiter__(self):
        return self

    async def __anext__(self):
        raise StopAsyncIteration


class _FakeChatCompletions:
    def __init__(self):
        self.calls = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        return _FakeStreamResponse()


class _FakeAsyncOpenAI:
    def __init__(self, *args, **kwargs):
        self.chat = types.SimpleNamespace(completions=_FakeChatCompletions())


class _FakeOpenAIDelta:
    def __init__(self, content=None, reasoning_content=None):
        self.content = content
        self.reasoning_content = reasoning_content


class _FakeOpenAIChoice:
    def __init__(self, delta):
        self.delta = delta


class _FakeOpenAIChunk:
    def __init__(self, *, content=None, reasoning_content=None, usage=None):
        self.choices = [_FakeOpenAIChoice(_FakeOpenAIDelta(content=content, reasoning_content=reasoning_content))]
        self.usage = usage


class _FakeAsyncStream:
    def __init__(self, chunks):
        self._chunks = iter(chunks)

    def __aiter__(self):
        return self

    async def __anext__(self):
        try:
            return next(self._chunks)
        except StopIteration as exc:
            raise StopAsyncIteration from exc


class _FakeOpenAICompletionsWithChunks:
    def __init__(self, chunks):
        self._chunks = chunks
        self.calls = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        return _FakeAsyncStream(self._chunks)


@pytest.mark.asyncio
async def test_openai_native_reasoning_models_skip_temperature(monkeypatch):
    fake_openai_module = types.SimpleNamespace(AsyncOpenAI=_FakeAsyncOpenAI)
    monkeypatch.setitem(sys.modules, "openai", fake_openai_module)

    provider = OpenAINativeProvider(api_key="test-key", model="o3-mini")

    chunks = []
    async for chunk in provider.chat_completion(
        messages=[{"role": "user", "content": "Hello"}],
        temperature=0.2,
        max_tokens=128,
    ):
        chunks.append(chunk)

    assert chunks == []
    request = provider.client.chat.completions.calls[0]
    assert request["model"] == "o3-mini"
    assert request["max_tokens"] == 128
    assert "temperature" not in request


@pytest.mark.asyncio
async def test_openai_native_standard_models_keep_temperature(monkeypatch):
    fake_openai_module = types.SimpleNamespace(AsyncOpenAI=_FakeAsyncOpenAI)
    monkeypatch.setitem(sys.modules, "openai", fake_openai_module)

    provider = OpenAINativeProvider(api_key="test-key", model="gpt-4o")

    async for _ in provider.chat_completion(
        messages=[{"role": "user", "content": "Hello"}],
        temperature=0.2,
        max_tokens=128,
    ):
        pass

    request = provider.client.chat.completions.calls[0]
    assert request["temperature"] == 0.2
    assert request["max_tokens"] == 128


@pytest.mark.asyncio
async def test_openai_compatible_ignores_reasoning_content(monkeypatch):
    fake_client = types.SimpleNamespace(
        chat=types.SimpleNamespace(
            completions=_FakeOpenAICompletionsWithChunks(
                [
                    _FakeOpenAIChunk(reasoning_content="internal thought "),
                    _FakeOpenAIChunk(content="final answer"),
                ]
            )
        )
    )

    provider = OpenAIProvider(api_key="test-key", model="deepseek-reasoner")
    provider.client = fake_client

    chunks = []
    async for chunk in provider.chat_completion(
        messages=[{"role": "user", "content": "Hello"}],
    ):
        chunks.append(chunk)

    assert chunks == ["final answer"]

@pytest.mark.asyncio
async def test_google_provider_uses_openai_compatible_endpoint():
    provider = get_llm_service(
        provider_type="google",
        api_key="k",
        model="gemini-2.5-flash",
    )

    assert isinstance(provider, OpenAIProvider)
    assert str(provider.client.base_url).rstrip("/").endswith("/v1beta/openai")
    assert provider.model == "gemini-2.5-flash"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "api_base",
    [
        "https://generativelanguage.googleapis.com/v1beta",
        "https://generativelanguage.googleapis.com/v1beta/",
        "https://generativelanguage.googleapis.com/v1beta/openai",
        "https://generativelanguage.googleapis.com/v1beta/openai/",
        None,
        "",
    ],
)
async def test_google_provider_normalises_user_supplied_api_base(api_base):
    provider = get_llm_service(
        provider_type="google",
        api_key="k",
        model="gemini-2.5-flash",
        api_base=api_base,
    )

    assert isinstance(provider, OpenAIProvider)
    assert str(provider.client.base_url).rstrip("/") == GOOGLE_OPENAI_BASE_URL


@pytest.mark.asyncio
async def test_google_provider_stream_ignores_reasoning_content():
    fake_client = types.SimpleNamespace(
        chat=types.SimpleNamespace(
            completions=_FakeOpenAICompletionsWithChunks(
                [
                    _FakeOpenAIChunk(reasoning_content="internal thought "),
                    _FakeOpenAIChunk(content="final answer"),
                ]
            )
        )
    )

    provider = get_llm_service(
        provider_type="google",
        api_key="k",
        model="gemini-2.5-flash",
    )
    provider.client = fake_client

    chunks = []
    async for chunk in provider.chat_completion(
        messages=[{"role": "user", "content": "Hello"}],
    ):
        chunks.append(chunk)

    assert chunks == ["final answer"]


@pytest.mark.asyncio
async def test_google_branch_omits_stream_options_but_openai_sends_them():
    google_provider = get_llm_service(
        provider_type="google",
        api_key="k",
        model="gemini-2.5-flash",
    )
    google_completions = _FakeOpenAICompletionsWithChunks([])
    google_provider.client = types.SimpleNamespace(
        chat=types.SimpleNamespace(completions=google_completions)
    )

    async for _ in google_provider.chat_completion(
        messages=[{"role": "user", "content": "Hello"}],
        stream=True,
    ):
        pass

    assert "stream_options" not in google_completions.calls[0]

    openai_provider = get_llm_service(
        provider_type="openai",
        api_key="k",
        model="gpt-4o",
    )
    openai_completions = _FakeOpenAICompletionsWithChunks([])
    openai_provider.client = types.SimpleNamespace(
        chat=types.SimpleNamespace(completions=openai_completions)
    )

    async for _ in openai_provider.chat_completion(
        messages=[{"role": "user", "content": "Hello"}],
        stream=True,
    ):
        pass

    assert openai_completions.calls[0]["stream_options"] == {"include_usage": True}

# ===== get_llm_service: Mock 只能在 use_mock=True 时出现（issue #19） =====

class _AgentStub:
    """生产路径传入的 agent 对象最小替身（只带工厂函数会读取的属性）。"""

    def __init__(self, api_key=None, api_base=None, model=None, provider_type="openai"):
        self.api_key = api_key
        self.api_base = api_base
        self.model = model
        self.provider_type = provider_type

@pytest.mark.parametrize(
    "kwargs",
    [
        {},
        {"api_key": None},
        {"api_key": ""},
        {"agent": _AgentStub(api_key=None)},
        {"agent": _AgentStub(api_key="")},
    ],
    ids=["no-args", "api-key-none", "api-key-empty", "agent-none-key", "agent-empty-key"],
)
def test_use_mock_true_returns_mock_service_even_without_api_key(kwargs):
    """use_mock=True 必须无条件返回 Mock（测试/演示路径，行为保持不变）。"""
    service = get_llm_service(use_mock=True, **kwargs)

    assert isinstance(service, MockLLMService)
    assert service.model

@pytest.mark.parametrize(
    "kwargs",
    [
        {"api_key": ""},
        {"api_key": None},
        {"agent": _AgentStub(api_key="")},
        {"agent": _AgentStub(api_key=None)},
        {"agent": None},
    ],
    ids=["api-key-empty", "api-key-none", "agent-empty-key", "agent-none-key", "agent-none"],
)
def test_missing_api_key_without_use_mock_raises_value_error(kwargs):
    """生产路径缺 API Key 必须 raise，绝不静默降级成 Mock。"""
    with pytest.raises(ValueError) as excinfo:
        get_llm_service(use_mock=False, **kwargs)

    assert "api_key required" in str(excinfo.value)

def test_real_api_key_returns_real_provider_without_network(monkeypatch):
    """use_mock=False + 有 key 时返回真实 provider，且构造过程不做网络 I/O。"""
    constructed = []

    class _RecordingAsyncOpenAI:
        def __init__(self, *args, **kwargs):
            constructed.append(kwargs)
            self.requests = []
            self.chat = types.SimpleNamespace(completions=_FakeChatCompletions())

        async def _never(self, *args, **kwargs):  # pragma: no cover - 不应被调用
            self.requests.append((args, kwargs))
            raise AssertionError("构造 provider 时不应发起网络请求")

    monkeypatch.setitem(
        sys.modules, "openai", types.SimpleNamespace(AsyncOpenAI=_RecordingAsyncOpenAI)
    )

    service = get_llm_service(use_mock=False, api_key="sk-test-not-a-real-key")

    assert isinstance(service, BaseLLMService)
    assert not isinstance(service, MockLLMService)
    assert isinstance(service, OpenAIProvider)
    # 构造期只创建了 client，没有发出任何请求
    assert len(constructed) == 1
    assert service.client.requests == []
    assert service.client.chat.completions.calls == []

def test_agent_with_real_api_key_returns_real_provider_without_network(monkeypatch):
    """生产实际传的是 agent 对象：有 key 时同样走真实 provider（无网络）。"""
    monkeypatch.setitem(
        sys.modules,
        "openai",
        types.SimpleNamespace(AsyncOpenAI=_FakeAsyncOpenAI),
    )

    agent = _AgentStub(api_key="sk-agent-key", provider_type="moonshot", model="")
    service = get_llm_service(agent, use_mock=False)

    assert isinstance(service, OpenAIProvider)
    assert not isinstance(service, MockLLMService)
    assert service.model == "kimi-k3"
