import sys
import types

import pytest

from services.llm_service import OpenAINativeProvider


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
