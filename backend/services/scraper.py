"""URL抓取和内容提取服务 - 使用 Scrapling 微服务"""

import hashlib
from typing import Dict, Any, List, Tuple
import logging

from services.url_safety import validate_url_safe
from services.scrapling_client import get_scrapling_client

logger = logging.getLogger(__name__)


class URLScraper:
    """URL抓取器 - 通过 Scrapling 微服务抓取"""

    def __init__(self, timeout: int = 60):
        self.timeout = timeout
        self._scrapling_client = None

    def _get_client(self):
        """延迟获取 Scrapling 客户端"""
        if self._scrapling_client is None:
            self._scrapling_client = get_scrapling_client()
        return self._scrapling_client

    async def fetch(self, url: str) -> Dict[str, Any]:
        """
        抓取URL并提取主要内容

        Args:
            url: 要抓取的URL

        Returns:
            包含title, content, content_hash, metadata的字典
        """
        # SSRF 安全检查
        safe, reason = validate_url_safe(url)
        if not safe:
            logger.warning(f"Blocked unsafe fetch of {url}: {reason}")
            return {
                "success": False,
                "error": f"Unsafe URL: {reason}",
                "title": None,
                "content": None,
                "content_hash": None,
                "metadata": None,
            }

        try:
            client = self._get_client()
            result = await client.fetch(url)

            if result.get("success"):
                logger.info(
                    f"Successfully fetched {url} via Scrapling: {len(result.get('content', ''))} chars"
                )
            else:
                logger.warning(
                    f"Scrapling fetch failed for {url}: {result.get('error')}"
                )

            return result

        except Exception as e:
            logger.error(f"Error fetching {url}: {e}")
            return {
                "success": False,
                "error": str(e),
                "title": None,
                "content": None,
                "content_hash": None,
                "metadata": None,
            }

    async def discover_subpages(
        self, url: str, max_depth: int = 1, max_pages: int = 20
    ) -> List[Tuple[str, int]]:
        """
        发现URL的子页面

        Args:
            url: 起始URL
            max_depth: 最大爬取深度
            max_pages: 最大页面数量

        Returns:
            发现的子页面URL和深度列表
        """
        # SSRF 安全检查
        safe, reason = validate_url_safe(url)
        if not safe:
            logger.warning(f"Blocked unsafe crawl seed URL {url}: {reason}")
            return []

        try:
            client = self._get_client()
            discovered = await client.discover_subpages(
                url, max_depth=max_depth, max_pages=max_pages
            )
            logger.info(f"Discovered {len(discovered)} subpages from {url}")
            return discovered

        except Exception as e:
            logger.error(f"Error discovering subpages from {url}: {e}")
            return []


class URLNormalizer:
    """URL规范化工具"""

    @staticmethod
    def normalize(url: str) -> str:
        """
        规范化URL（用于去重）

        Args:
            url: 原始URL

        Returns:
            规范化后的URL
        """
        url = url.strip().lower()

        if url.endswith("/"):
            url = url[:-1]

        if url.startswith("https://www."):
            url = url.replace("https://www.", "https://", 1)
        elif url.startswith("http://www."):
            url = url.replace("http://www.", "http://", 1)

        from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse

        parsed = urlparse(url)
        query_params = parse_qsl(parsed.query, keep_blank_values=True)

        tracking_params = {
            "utm_source",
            "utm_medium",
            "utm_campaign",
            "utm_term",
            "utm_content",
            "fbclid",
            "gclid",
            "msclkid",
            "_ga",
            "_gid",
        }

        filtered_params = [(k, v) for k, v in query_params if k not in tracking_params]

        if filtered_params:
            query_string = urlencode(filtered_params, doseq=True)
            new_parsed = parsed._replace(query=query_string)
        else:
            new_parsed = parsed._replace(query="")

        return urlunparse(new_parsed)


def check_content_changed(old_hash: str, new_content: str) -> bool:
    """检查内容是否发生变化"""
    new_hash = hashlib.sha256(new_content.encode("utf-8")).hexdigest()
    return old_hash != new_hash
