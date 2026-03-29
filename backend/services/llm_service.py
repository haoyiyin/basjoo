"""
LLM 服务抽象层 - 支持多个 AI 提供商

支持的提供商：
- OpenAI Native (官方接口)
- OpenAI Compatible (兼容接口，如DeepSeek)
- Google (Gemini)
- Mock (用于测试)
"""

from abc import ABC, abstractmethod
from typing import AsyncGenerator, List, Dict, Optional
import logging
import html

logger = logging.getLogger(__name__)


class LLMError(Exception):
    """Base exception for classified LLM failures."""

    code = "PROVIDER_ERROR"


class APIKeyInvalidError(LLMError):
    code = "API_KEY_INVALID"


class APIKeyMissingError(LLMError):
    code = "API_KEY_MISSING"


class ProviderRateLimitedError(LLMError):
    code = "PROVIDER_RATE_LIMITED"


class ProviderUnavailableError(LLMError):
    code = "PROVIDER_UNAVAILABLE"


class ModelNotFoundError(LLMError):
    code = "MODEL_NOT_FOUND"


def classify_llm_error(error: Exception) -> LLMError:
    """Normalize provider-specific exceptions into stable error codes."""

    if isinstance(error, LLMError):
        return error

    status_code = getattr(error, "status_code", None)
    response = getattr(error, "response", None)
    if status_code is None and response is not None:
        status_code = getattr(response, "status_code", None)

    error_name = type(error).__name__.lower()
    message = str(error)
    lowered_message = message.lower()

    if (
        status_code == 401
        or "authenticationerror" in error_name
        or "invalid api key" in lowered_message
        or "incorrect api key" in lowered_message
        or "api key" in lowered_message and ("invalid" in lowered_message or "expired" in lowered_message)
    ):
        return APIKeyInvalidError(message)

    if (
        status_code == 404
        or "notfounderror" in error_name
        or "model not found" in lowered_message
        or "unknown model" in lowered_message
        or "does not exist" in lowered_message and "model" in lowered_message
    ):
        return ModelNotFoundError(message)

    if (
        status_code == 429
        or "ratelimiterror" in error_name
        or "rate limit" in lowered_message
        or "too many requests" in lowered_message
        or "quota" in lowered_message
    ):
        return ProviderRateLimitedError(message)

    if (
        "timeout" in lowered_message
        or "timed out" in lowered_message
        or "connection" in lowered_message
        or "unavailable" in lowered_message
        or "temporarily down" in lowered_message
        or "service unavailable" in lowered_message
        or "apiconnectionerror" in error_name
        or "apierror" in error_name
    ):
        return ProviderUnavailableError(message)

    return LLMError(message)


def supports_openai_reasoning_effort(model: str) -> bool:
    """判断 OpenAI 模型是否支持 reasoning_effort 参数"""
    return model.lower().startswith(("o1", "o3", "o4"))


# ========== 抽象基类 ==========


class BaseLLMService(ABC):
    """LLM 服务抽象基类"""

    def __init__(self, model: str, timeout: int = 30):
        """
        初始化 LLM 服务

        Args:
            model: 模型名称
            timeout: 请求超时时间（秒）
        """
        self.model = model
        self.timeout = timeout
        self.last_usage: Optional[Dict[str, int]] = None
        logger.info(
            f"初始化 {self.__class__.__name__}: model={model}, timeout={timeout}s"
        )

    def reset_last_usage(self) -> None:
        self.last_usage = None

    def set_last_usage(self, usage: Optional[object]) -> None:
        if not usage:
            logger.info("set_last_usage: usage is empty, clearing cached usage")
            self.last_usage = None
            return

        prompt_tokens = getattr(usage, "prompt_tokens", None)
        completion_tokens = getattr(usage, "completion_tokens", None)
        total_tokens = getattr(usage, "total_tokens", None)

        if isinstance(usage, dict):
            prompt_tokens = usage.get("prompt_tokens", prompt_tokens)
            completion_tokens = usage.get("completion_tokens", completion_tokens)
            total_tokens = usage.get("total_tokens", total_tokens)

        logger.info(
            "set_last_usage: type=%s prompt=%r completion=%r total=%r",
            type(usage).__name__,
            prompt_tokens,
            completion_tokens,
            total_tokens,
        )

        if all(isinstance(value, int) for value in (prompt_tokens, completion_tokens, total_tokens)):
            self.last_usage = {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
            }
            logger.info("set_last_usage: cached provider usage=%s", self.last_usage)
        else:
            logger.warning("set_last_usage: skipped because not all values are int")
            self.last_usage = None

    def get_last_usage(self) -> Optional[Dict[str, int]]:
        return self.last_usage

    @abstractmethod
    async def chat_completion(
        self,
        messages: List[Dict[str, str]],
        system_prompt: Optional[str] = None,
        stream: bool = True,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        reasoning_effort: Optional[str] = None,
    ) -> AsyncGenerator[str, None]:
        """
        聊天完成接口

        Args:
            messages: 消息列表 [{"role": "user", "content": "..."}]
            system_prompt: 系统提示词（可选）
            stream: 是否流式返回

        Yields:
            str: 消息片段（流式）或完整消息（非流式）
        """
        pass

    @abstractmethod
    async def test_connection(self) -> bool:
        """
        测试 API 连通性

        Returns:
            bool: 连接是否成功
        """
        pass


# ========== Mock LLM 服务 ==========


class MockLLMService(BaseLLMService):
    """Mock LLM 服务 - 用于测试和演示环境"""

    def __init__(self, model: str = "mock-model"):
        """初始化 Mock LLM"""
        super().__init__(model=model)
        logger.warning("使用Mock LLM服务 - 仅用于测试和演示环境")

    async def chat_completion(
        self,
        messages: List[Dict[str, str]],
        system_prompt: Optional[str] = None,
        stream: bool = True,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        reasoning_effort: Optional[str] = None,
    ) -> AsyncGenerator[str, None]:
        """
        Mock 聊天完成

        Args:
            messages: 消息列表
            system_prompt: 系统提示词
            stream: 是否流式返回

        Yields:
            str: 模拟的回复内容
        """
        # 获取最后一条用户消息
        user_message = ""
        for msg in reversed(messages):
            if msg.get("role") == "user":
                user_message = msg.get("content", "")
                break

        # 生成模拟回复
        mock_response = self._generate_mock_response(user_message, system_prompt)

        if stream:
            # 流式返回（模拟逐字输出）
            words = mock_response.split()
            for i, word in enumerate(words):
                if i > 0:
                    word = " " + word
                yield word
        else:
            # 非流式返回
            yield mock_response

    def _generate_mock_response(
        self, user_message: str, system_prompt: Optional[str] = None
    ) -> str:
        """生成模拟回复"""
        if not user_message:
            return "您好！有什么可以帮助您的吗？"

        # 根据系统提示词调整回复
        if system_prompt and "小唯" in system_prompt:
            prefix = "我是小唯，"
        else:
            prefix = "我是AI助手，"

        # 简单的关键词匹配回复
        if "你好" in user_message or "hello" in user_message.lower():
            return f"{prefix}您好！很高兴为您服务。"
        elif "测试" in user_message:
            return f"{prefix}这是一个测试环境的模拟回复。RAG检索功能正常工作，但LLM使用的是Mock服务。"
        elif "问题" in user_message:
            return f"{prefix}我收到了您的问题。在生产环境中，我会根据知识库内容为您提供详细答案。"
        elif "谢谢" in user_message or "感谢" in user_message:
            return f"{prefix}不客气！如果还有其他问题，请随时提问。"
        else:
            sanitized_message = html.escape(user_message)
            return f"{prefix}感谢您的提问！\n\n**注意**：当前使用的是Mock LLM服务。要启用真正的AI对话功能，请在.env文件中配置DEEPSEEK_API_KEY，或在系统设置页面配置Agent的API Key。\n\n您的问题是：{sanitized_message}"

    async def test_connection(self) -> bool:
        """测试连接（Mock版本总是返回True）"""
        return True


# ========== OpenAI Provider ==========


class OpenAIProvider(BaseLLMService):
    """OpenAI API 提供商（兼容接口，如DeepSeek）"""

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.openai.com/v1",
        model: str = "gpt-3.5-turbo",
        timeout: int = 30,
    ):
        """
        初始化 OpenAI 客户端

        Args:
            api_key: API 密钥
            base_url: API 基础 URL
            model: 模型名称
            timeout: 请求超时时间（秒）
        """
        super().__init__(model=model, timeout=timeout)
        from openai import AsyncOpenAI

        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url,
            timeout=timeout,
        )

    async def chat_completion(
        self,
        messages: List[Dict[str, str]],
        system_prompt: Optional[str] = None,
        stream: bool = True,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        reasoning_effort: Optional[str] = None,
    ) -> AsyncGenerator[str, None]:
        """
        OpenAI 聊天完成

        Args:
            messages: 消息列表
            system_prompt: 系统提示词
            stream: 是否流式返回

        Yields:
            str: 消息片段
        """
        try:
            # 添加系统提示词
            if system_prompt:
                messages = [{"role": "system", "content": system_prompt}] + messages

            self.reset_last_usage()

            request_params = {
                "model": self.model,
                "messages": messages,
                "stream": stream,
                "temperature": 0.7 if temperature is None else temperature,
                "max_tokens": 2000 if max_tokens is None else max_tokens,
            }
            if stream:
                request_params["stream_options"] = {"include_usage": True}

            logger.info(
                "openai-compatible chat request model=%s stream=%s temperature=%r max_tokens=%r",
                self.model,
                stream,
                request_params["temperature"],
                request_params["max_tokens"],
            )

            # 兼容接口默认忽略 reasoning_effort，仅保留参数签名兼容上层调用
            response = await self.client.chat.completions.create(**request_params)

            if stream:
                # 流式返回
                async for chunk in response:
                    if getattr(chunk, "usage", None):
                        self.set_last_usage(chunk.usage)
                    if chunk.choices and chunk.choices[0].delta.content:
                        yield chunk.choices[0].delta.content
            else:
                # 非流式返回
                self.set_last_usage(getattr(response, "usage", None))
                if response.choices:
                    yield response.choices[0].message.content

        except Exception as e:
            logger.error(f"OpenAI API 调用失败: {str(e)}")
            raise classify_llm_error(e) from e

    async def test_connection(self) -> bool:
        """测试 OpenAI API 连通性"""
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": "Hello"}],
                max_tokens=5,
            )
            return True
        except Exception as e:
            classified = classify_llm_error(e)
            logger.error(f"OpenAI API 连接测试失败 [{classified.code}]: {str(e)}")
            return False


# ========== OpenAI Native Provider ==========


class OpenAINativeProvider(BaseLLMService):
    """OpenAI 官方 API 提供商（固定 base_url）"""

    OPENAI_BASE_URL = "https://api.openai.com/v1"

    def __init__(
        self,
        api_key: str,
        model: str = "gpt-4o",
        timeout: int = 30,
    ):
        """
        初始化 OpenAI Native 客户端

        Args:
            api_key: API 密钥
            model: 模型名称
            timeout: 请求超时时间（秒）
        """
        super().__init__(model=model, timeout=timeout)
        from openai import AsyncOpenAI

        self.api_key = api_key
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url=self.OPENAI_BASE_URL,
            timeout=timeout,
        )

    async def chat_completion(
        self,
        messages: List[Dict[str, str]],
        system_prompt: Optional[str] = None,
        stream: bool = True,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        reasoning_effort: Optional[str] = None,
    ) -> AsyncGenerator[str, None]:
        """
        OpenAI 聊天完成

        Args:
            messages: 消息列表
            system_prompt: 系统提示词
            stream: 是否流式返回

        Yields:
            str: 消息片段
        """
        try:
            # 添加系统提示词
            if system_prompt:
                messages = [{"role": "system", "content": system_prompt}] + messages

            self.reset_last_usage()

            request_params = {
                "model": self.model,
                "messages": messages,
                "stream": stream,
                "max_tokens": 2000 if max_tokens is None else max_tokens,
            }
            if stream:
                request_params["stream_options"] = {"include_usage": True}
            if not supports_openai_reasoning_effort(self.model):
                request_params["temperature"] = 0.7 if temperature is None else temperature

            if reasoning_effort and supports_openai_reasoning_effort(self.model):
                request_params["reasoning_effort"] = reasoning_effort

            # 调用 API
            response = await self.client.chat.completions.create(**request_params)

            if stream:
                # 流式返回
                async for chunk in response:
                    if getattr(chunk, "usage", None):
                        self.set_last_usage(chunk.usage)
                    if chunk.choices and chunk.choices[0].delta.content:
                        yield chunk.choices[0].delta.content
            else:
                # 非流式返回
                self.set_last_usage(getattr(response, "usage", None))
                if response.choices:
                    yield response.choices[0].message.content

        except Exception as e:
            logger.error(f"OpenAI Native API 调用失败: {str(e)}")
            raise classify_llm_error(e) from e

    async def test_connection(self) -> bool:
        """测试 OpenAI API 连通性"""
        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": "Hello"}],
                max_tokens=5,
            )
            return True
        except Exception as e:
            classified = classify_llm_error(e)
            logger.error(f"OpenAI Native API 连接测试失败 [{classified.code}]: {str(e)}")
            return False

    @staticmethod
    async def list_models(api_key: str) -> List[str]:
        """获取可用模型列表"""
        from openai import AsyncOpenAI

        client = AsyncOpenAI(
            api_key=api_key,
            base_url="https://api.openai.com/v1",
        )
        models = await client.models.list()
        # 过滤出聊天模型
        chat_models = [
            m.id for m in models.data
            if m.id.startswith(("gpt-", "o1", "o3", "o4", "chatgpt-"))
        ]
        return sorted(chat_models, reverse=True)


# ========== Google Provider ==========


class GoogleProvider(BaseLLMService):
    """Google Gemini API 提供商"""

    def __init__(
        self,
        api_key: str,
        model: str = "gemini-pro",
        timeout: int = 30,
    ):
        """
        初始化 Google 客户端

        Args:
            api_key: API 密钥
            model: 模型名称
            timeout: 请求超时时间（秒）
        """
        super().__init__(model=model, timeout=timeout)
        try:
            import google.generativeai as genai

            self.api_key = api_key
            genai.configure(api_key=api_key)
            self.client = genai.GenerativeModel(model)
        except ImportError:
            raise ImportError(
                "Google Generative AI SDK 未安装。请运行: pip install google-generativeai"
            )

    async def chat_completion(
        self,
        messages: List[Dict[str, str]],
        system_prompt: Optional[str] = None,
        stream: bool = True,
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        reasoning_effort: Optional[str] = None,
    ) -> AsyncGenerator[str, None]:
        """
        Google Gemini 聊天完成

        Args:
            messages: 消息列表
            system_prompt: 系统提示词
            stream: 是否流式返回

        Yields:
            str: 消息片段
        """
        try:
            # Google Gemini API 格式
            # 将消息转换为 Gemini 格式
            prompt_parts = []

            if system_prompt:
                prompt_parts.append(f"System: {system_prompt}")

            for msg in messages:
                role = msg.get("role", "user")
                content = msg.get("content", "")

                if role == "system":
                    prompt_parts.append(f"System: {content}")
                elif role == "user":
                    prompt_parts.append(f"User: {content}")
                elif role == "assistant":
                    prompt_parts.append(f"Assistant: {content}")

            full_prompt = "\n\n".join(prompt_parts)

            generation_config = {
                "temperature": 0.7 if temperature is None else temperature,
                "max_output_tokens": 2000 if max_tokens is None else max_tokens,
            }

            # 调用 API
            if stream:
                response = await self.client.generate_content_async(
                    full_prompt,
                    stream=True,
                    generation_config=generation_config,
                )

                async for chunk in response:
                    if chunk.text:
                        yield chunk.text
            else:
                response = await self.client.generate_content_async(
                    full_prompt,
                    generation_config=generation_config,
                )
                yield response.text

        except Exception as e:
            logger.error(f"Google API 调用失败: {str(e)}")
            raise classify_llm_error(e) from e

    async def test_connection(self) -> bool:
        """测试 Google API 连通性"""
        try:
            response = await self.client.generate_content_async(
                "Hello", generation_config={"max_output_tokens": 5}
            )
            return True
        except Exception as e:
            classified = classify_llm_error(e)
            logger.error(f"Google API 连接测试失败 [{classified.code}]: {str(e)}")
            return False

    @staticmethod
    async def list_models(api_key: str) -> List[str]:
        """获取可用模型列表"""
        import google.generativeai as genai

        genai.configure(api_key=api_key)
        models = []
        for m in genai.list_models():
            if "generateContent" in m.supported_generation_methods:
                # 提取模型名称
                model_name = m.name.replace("models/", "")
                if model_name.startswith("gemini"):
                    models.append(model_name)
        return sorted(models, reverse=True)


# ========== 工厂函数 ==========


def get_llm_service(
    agent=None,
    use_mock: bool = False,
    *,
    api_key: Optional[str] = None,
    api_base: Optional[str] = None,
    model: Optional[str] = None,
    provider_type: Optional[str] = None,
) -> BaseLLMService:
    """
    获取 LLM 服务实例（工厂函数）

    根据Agent的服务商类型返回相应的服务实例

    Args:
        agent: Agent 模型实例（可选）
        use_mock: 是否使用Mock服务（用于测试）
        api_key: 显式传入的 API Key
        api_base: 显式传入的 API Base
        model: 显式传入的模型名
        provider_type: 显式传入的服务商类型

    Returns:
        BaseLLMService: LLM 服务实例
    """
    resolved_api_key = api_key if api_key is not None else getattr(agent, "api_key", None)
    resolved_api_base = api_base if api_base is not None else getattr(agent, "api_base", None)
    resolved_model = model if model is not None else getattr(agent, "model", None)
    resolved_provider_type = provider_type if provider_type is not None else getattr(agent, "provider_type", "openai")
    resolved_provider_type = resolved_provider_type or "openai"

    # 如果没有API key或显式要求使用Mock
    if use_mock or not resolved_api_key:
        logger.warning("Agent没有配置API Key，使用Mock LLM服务")
        return MockLLMService(model=resolved_model or "mock-model")

    # 根据服务商类型创建相应的服务
    if resolved_provider_type == "openai_native":
        logger.info("使用 OpenAI Native Provider")
        return OpenAINativeProvider(
            api_key=resolved_api_key,
            model=resolved_model or "gpt-4o",
        )

    elif resolved_provider_type == "google":
        logger.info("使用 Google Provider")
        return GoogleProvider(
            api_key=resolved_api_key,
            model=resolved_model or "gemini-pro",
        )

    elif resolved_provider_type == "anthropic":
        logger.info("使用 Anthropic Provider (OpenAI Compatible)")
        return OpenAIProvider(
            api_key=resolved_api_key,
            base_url=resolved_api_base or "https://api.anthropic.com/v1",
            model=resolved_model or "claude-3-5-sonnet-20241022",
        )

    elif resolved_provider_type == "xai":
        logger.info("使用 xAI Provider (OpenAI Compatible)")
        return OpenAIProvider(
            api_key=resolved_api_key,
            base_url=resolved_api_base or "https://api.x.ai/v1",
            model=resolved_model or "grok-2-latest",
        )

    elif resolved_provider_type == "openrouter":
        logger.info("使用 OpenRouter Provider (OpenAI Compatible)")
        return OpenAIProvider(
            api_key=resolved_api_key,
            base_url=resolved_api_base or "https://openrouter.ai/api/v1",
            model=resolved_model or "openai/gpt-4o",
        )

    elif resolved_provider_type == "zai":
        logger.info("使用 z.ai Provider (OpenAI Compatible)")
        return OpenAIProvider(
            api_key=resolved_api_key,
            base_url=resolved_api_base or "https://api.z.ai/v1",
            model=resolved_model or "z1-preview",
        )

    elif resolved_provider_type == "deepseek":
        logger.info("使用 DeepSeek Provider (OpenAI Compatible)")
        return OpenAIProvider(
            api_key=resolved_api_key,
            base_url=resolved_api_base or "https://api.deepseek.com/v1",
            model=resolved_model or "deepseek-chat",
        )

    elif resolved_provider_type == "volcengine":
        logger.info("使用 火山引擎 Provider (OpenAI Compatible)")
        return OpenAIProvider(
            api_key=resolved_api_key,
            base_url=resolved_api_base or "https://ark.cn-beijing.volces.com/api/v3",
            model=resolved_model or "doubao-pro-32k",
        )

    elif resolved_provider_type == "aliyun":
        logger.info("使用 阿里云 Provider (OpenAI Compatible)")
        return OpenAIProvider(
            api_key=resolved_api_key,
            base_url=resolved_api_base or "https://dashscope.aliyuncs.com/compatible-mode/v1",
            model=resolved_model or "qwen-plus",
        )

    elif resolved_provider_type == "tencentcloud":
        logger.info("使用 腾讯云 Provider (OpenAI Compatible)")
        return OpenAIProvider(
            api_key=resolved_api_key,
            base_url=resolved_api_base or "https://api.hunyuan.cloud.tencent.com/v1",
            model=resolved_model or "hunyuan-pro",
        )

    elif resolved_provider_type == "siliconflow":
        logger.info("使用 硅基流动 Provider (OpenAI Compatible)")
        return OpenAIProvider(
            api_key=resolved_api_key,
            base_url=resolved_api_base or "https://api.siliconflow.cn/v1",
            model=resolved_model or "deepseek-ai/DeepSeek-V3",
        )

    elif resolved_provider_type == "openai":
        logger.info("使用 OpenAI Compatible Provider")
        return OpenAIProvider(
            api_key=resolved_api_key,
            base_url=resolved_api_base or "https://api.openai.com/v1",
            model=resolved_model or "gpt-4o",
        )

    else:
        # 默认使用 OpenAI 兼容接口
        logger.info(f"未知的服务商类型 '{resolved_provider_type}'，使用 OpenAI 兼容接口")
        return OpenAIProvider(
            api_key=resolved_api_key,
            base_url=resolved_api_base or "https://api.openai.com/v1",
            model=resolved_model or "gpt-4o",
        )
