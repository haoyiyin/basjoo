import sys
import types

import pytest

from services.llm_service import (
    GOOGLE_OPENAI_BASE_URL,
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
