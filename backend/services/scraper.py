"""URL抓取和内容提取服务 - 使用 Jina Reader API"""

import httpx
from bs4 import BeautifulSoup
import hashlib
from typing import Optional, Dict, Any, List, Set, Tuple
from urllib.parse import urlparse, urljoin
import logging
from datetime import datetime, timezone
import re

logger = logging.getLogger(__name__)

JINA_READER_BASE = "https://r.jina.ai/"


class URLScraper:
    """URL抓取器 - 使用 Jina Reader API 进行网页抓取"""

    def __init__(self, timeout: int = 60, user_agent: str = "", jina_api_key: str = ""):
        self.timeout = timeout
        self.user_agent = user_agent or (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
        self.jina_api_key = jina_api_key
        self.headers = {
            "User-Agent": self.user_agent,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        }

    async def fetch(self, url: str, use_jina: bool = True) -> Dict[str, Any]:
        """
        抓取URL并提取主要内容

        Args:
            url: 要抓取的URL
            use_jina: 是否使用 Jina Reader API（默认启用）

        Returns:
            包含title, content, metadata的字典
        """
        if use_jina:
            # 先尝试无key的Jina API，失败则尝试有key的
            return await self._fetch_with_jina_fallback(url)
        return await self._fetch_direct(url)

    async def _fetch_with_jina_fallback(self, url: str) -> Dict[str, Any]:
        """
        使用 Jina Reader API 抓取（支持fallback）

        策略：
        1. 先尝试无key的Jina API
        2. 如果失败且有key，再尝试有key的Jina API
        3. 如果都失败，降级到直接抓取
        """
        # 尝试无key的Jina API
        result = await self._fetch_with_jina(url, use_api_key=False)
        if result.get("success"):
            return result

        # 如果失败且有key，尝试有key的Jina API
        if self.jina_api_key:
            logger.info(f"Retrying {url} with Jina API key")
            result = await self._fetch_with_jina(url, use_api_key=True)
            if result.get("success"):
                return result

        # 都失败，降级到直接抓取
        logger.info(f"Falling back to direct fetch for {url}")
        return await self._fetch_direct(url)

    async def _fetch_with_jina(self, url: str, use_api_key: bool = False) -> Dict[str, Any]:
        """使用 Jina Reader API 抓取"""
        try:
            jina_url = f"{JINA_READER_BASE}{url}"
            logger.info(f"Fetching URL via Jina ({'with' if use_api_key else 'without'} API key): {url}")

            headers = {
                "Accept": "text/plain",
                "X-Return-Format": "text",
            }

            # 如果使用API key，添加Authorization header
            if use_api_key and self.jina_api_key:
                headers["Authorization"] = f"Bearer {self.jina_api_key}"

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(
                    jina_url,
                    headers=headers,
                    follow_redirects=True,
                )
                response.raise_for_status()

            content_text = response.text.strip()

            title_match = re.match(
                r"^Title:\s*(.+?)(?:\n|$)", content_text, re.MULTILINE
            )
            title = (
                title_match.group(1).strip()
                if title_match
                else self._extract_title_from_url(url)
            )

            content_hash = hashlib.sha256(content_text.encode("utf-8")).hexdigest()

            metadata = {
                "url": url,
                "final_url": url,
                "status_code": response.status_code,
                "content_type": "text/markdown",
                "content_length": len(content_text),
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "fetcher": "jina_reader",
                "used_api_key": use_api_key,
            }

            result = {
                "title": title,
                "content": content_text,
                "content_hash": content_hash,
                "metadata": metadata,
                "success": True,
            }

            logger.info(
                f"Successfully fetched {url} via Jina ({'with' if use_api_key else 'without'} API key): {len(content_text)} chars"
            )
            return result

        except httpx.TimeoutException:
            logger.error(f"Timeout fetching {url} via Jina ({self.timeout}s)")
            return {"success": False, "error": "Timeout", "retry_with_key": True}
        except httpx.HTTPStatusError as e:
            logger.warning(
                f"Jina failed for {url} (status {e.response.status_code})"
            )
            # 429 Too Many Requests 或 403 Forbidden 可能需要API key
            if e.response.status_code in [429, 403] and not use_api_key:
                return {"success": False, "error": f"HTTP {e.response.status_code}", "retry_with_key": True}
            return {"success": False, "error": f"HTTP {e.response.status_code}", "retry_with_key": False}
        except Exception as e:
            logger.warning(f"Jina failed for {url}: {e}")
            return {"success": False, "error": str(e), "retry_with_key": True}

    async def _fetch_direct(self, url: str) -> Dict[str, Any]:
        """直接抓取（降级方案）"""
        try:
            logger.info(f"Fetching URL directly: {url}")

            async with httpx.AsyncClient(
                timeout=30, headers=self.headers, follow_redirects=True
            ) as client:
                response = await client.get(url)
                response.raise_for_status()

            content_type = response.headers.get("content-type", "")
            if "text/html" not in content_type.lower():
                raise ValueError(f"Unsupported content type: {content_type}")

            soup = BeautifulSoup(response.text, "html.parser")

            title = None
            if soup.title:
                title = soup.title.string.strip() if soup.title.string else None
            if not title and soup.h1:
                title = soup.h1.get_text().strip()

            for tag in soup(
                ["script", "style", "nav", "header", "footer", "aside", "iframe"]
            ):
                tag.decompose()

            main_content = (
                soup.find("main") or soup.find("article") or soup.find("body")
            )

            if main_content:
                content_text = main_content.get_text(separator="\n", strip=True)
            else:
                content_text = soup.get_text(separator="\n", strip=True)

            content_text = self._clean_content(content_text)

            if not content_text or len(content_text.strip()) < 10:
                raise ValueError("Extracted content is too short or empty")

            content_hash = hashlib.sha256(content_text.encode("utf-8")).hexdigest()

            metadata = {
                "url": url,
                "final_url": str(response.url),
                "status_code": response.status_code,
                "content_type": content_type,
                "content_length": len(response.content),
                "etag": response.headers.get("etag"),
                "last_modified": response.headers.get("last-modified"),
                "fetched_at": datetime.now(timezone.utc).isoformat(),
                "fetcher": "direct",
            }

            result = {
                "title": title or self._extract_title_from_url(url),
                "content": content_text,
                "content_hash": content_hash,
                "metadata": metadata,
                "success": True,
            }

            logger.info(
                f"Successfully fetched {url} directly: {len(content_text)} chars"
            )
            return result

        except httpx.TimeoutException:
            logger.error(f"Timeout fetching {url} after 30 seconds")
            return {
                "success": False,
                "error": f"Timeout after 30 seconds",
                "title": None,
                "content": None,
                "content_hash": None,
                "metadata": None,
            }
        except httpx.RequestError as e:
            logger.error(f"Request error fetching {url}: {e}")
            return {
                "success": False,
                "error": str(e),
                "title": None,
                "content": None,
                "content_hash": None,
                "metadata": None,
            }
        except ValueError as e:
            logger.warning(f"Content validation error for {url}: {e}")
            return {
                "success": False,
                "error": str(e),
                "title": None,
                "content": None,
                "content_hash": None,
                "metadata": None,
            }
        except Exception as e:
            logger.error(f"Unexpected error fetching {url}: {e}")
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
        discovered: List[Tuple[str, int]] = []
        discovered_urls: Set[str] = set()
        to_visit: List[Tuple[str, int]] = [(url, 0)]
        queued: Set[str] = {url}
        visited: Set[str] = set()

        parsed_base = urlparse(url)
        base_domain = parsed_base.netloc
        base_path = parsed_base.path or "/"
        if base_path != "/" and base_path.endswith("/"):
            base_path = base_path[:-1]
        base_path_with_slash = "/" if base_path == "/" else f"{base_path}/"

        while to_visit and len(discovered) < max_pages:
            current_url, depth = to_visit.pop(0)

            if current_url in visited:
                continue
            visited.add(current_url)

            if depth > 0:
                discovered.append((current_url, depth))
                discovered_urls.add(current_url)

            if depth >= max_depth:
                continue

            try:
                async with httpx.AsyncClient(
                    timeout=30, headers=self.headers
                ) as client:
                    response = await client.get(current_url, follow_redirects=True)

                    if "text/html" not in response.headers.get("content-type", ""):
                        continue

                    soup = BeautifulSoup(response.text, "html.parser")

                    for link in soup.find_all("a", href=True):
                        href = link["href"]

                        if href.startswith("#") or href.startswith("javascript:"):
                            continue
                        if href.startswith("mailto:") or href.startswith("tel:"):
                            continue

                        full_url = urljoin(current_url, href)
                        parsed = urlparse(full_url)

                        if parsed.netloc != base_domain:
                            continue

                        normalized_path = parsed.path or "/"
                        normalized = f"{parsed.scheme}://{parsed.netloc}{normalized_path}"
                        if normalized.endswith("/") and normalized != f"{parsed.scheme}://{parsed.netloc}/":
                            normalized = normalized[:-1]
                            normalized_path = normalized_path[:-1]

                        is_subpath = (
                            normalized_path == base_path
                            or normalized_path.startswith(base_path_with_slash)
                        )
                        if not is_subpath:
                            continue

                        if (
                            normalized not in visited
                            and normalized not in discovered_urls
                            and normalized not in queued
                        ):
                            to_visit.append((normalized, depth + 1))
                            queued.add(normalized)

            except Exception as e:
                logger.warning(f"Error discovering links from {current_url}: {e}")
                continue

        logger.info(f"Discovered {len(discovered)} subpages from {url}")
        return discovered[:max_pages]

    def _clean_content(self, text: str) -> str:
        """清理文本内容"""
        lines = [line.strip() for line in text.split("\n") if line.strip()]
        cleaned_lines = []
        prev_empty = False
        for line in lines:
            if line:
                cleaned_lines.append(line)
                prev_empty = False
            elif not prev_empty:
                cleaned_lines.append("")
                prev_empty = True

        return "\n".join(cleaned_lines)

    def _extract_title_from_url(self, url: str) -> str:
        """从URL提取标题"""
        try:
            parsed = urlparse(url)
            path_parts = [p for p in parsed.path.split("/") if p]
            if path_parts:
                return path_parts[-1].replace("-", " ").replace("_", " ").title()
            return parsed.netloc
        except Exception:
            return "Untitled"


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

        from urllib.parse import urlparse, parse_qs, urlunparse

        parsed = urlparse(url)
        query_params = parse_qs(parsed.query)

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

        filtered_params = {
            k: v for k, v in query_params.items() if k not in tracking_params
        }

        if filtered_params:
            query_string = "&".join(
                f"{k}={'&'.join(v)}" for k, v in filtered_params.items()
            )
            new_parsed = parsed._replace(query=query_string)
        else:
            new_parsed = parsed._replace(query="")

        return urlunparse(new_parsed)


def check_content_changed(old_hash: str, new_content: str) -> bool:
    """检查内容是否发生变化"""
    new_hash = hashlib.sha256(new_content.encode("utf-8")).hexdigest()
    return old_hash != new_hash
