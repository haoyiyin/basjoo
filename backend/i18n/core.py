"""
国际化(i18n)核心功能
"""
import gettext
import os
from typing import Optional
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from pathlib import Path

# 支持的语言列表
SUPPORTED_LOCALES = ['zh-CN', 'en-US']
DEFAULT_LOCALE = 'zh-CN'

# 翻译文件路径
LOCALES_DIR = Path(__file__).parent / 'locales'

# 翻译缓存
_translations = {}


def get_translation(locale: str = DEFAULT_LOCALE):
    """获取指定语言的翻译函数"""
    normalized_locale = locale.replace('-', '_')

    if normalized_locale not in [l.replace('-', '_') for l in SUPPORTED_LOCALES]:
        normalized_locale = DEFAULT_LOCALE.replace('-', '_')

    if normalized_locale in _translations:
        return _translations[normalized_locale]

    locale_dir = LOCALES_DIR / normalized_locale / 'LC_MESSAGES'

    try:
        translator = gettext.translation(
            'messages',
            localedir=str(locale_dir.parent.parent),
            languages=[normalized_locale]
        )
        translator.install()
        _translations[normalized_locale] = translator.gettext
        return translator.gettext
    except FileNotFoundError:
        _translations[normalized_locale] = lambda x: x
        return lambda x: x


def _(message: str, locale: str = DEFAULT_LOCALE) -> str:
    """翻译函数"""
    translator = get_translation(locale)
    return translator(message)


def get_locale_from_request(request: Request) -> str:
    """从请求中提取 locale 参数"""
    # 1. 首先检查中间件是否已设置 locale (在 scope 中)
    if hasattr(request.state, 'locale'):
        return request.state.locale

    # 2. 检查查询参数
    locale = request.query_params.get('locale')
    if locale and locale in SUPPORTED_LOCALES:
        return locale

    # 3. 检查请求头
    accept_language = request.headers.get('accept-language', '')
    if accept_language:
        for lang in accept_language.split(','):
            lang_code = lang.split(';')[0].strip()
            if lang_code in SUPPORTED_LOCALES:
                return lang_code

    # 4. 返回默认值
    return DEFAULT_LOCALE


class I18nMiddleware(BaseHTTPMiddleware):
    """国际化中间件 - 使用Starlette BaseHTTPMiddleware"""

    async def dispatch(self, request: Request, call_next):
        # Extract locale from request
        locale = get_locale_from_request(request)

        # Store in request.state for later access
        request.state.locale = locale

        # Continue processing
        response = await call_next(request)
        return response
