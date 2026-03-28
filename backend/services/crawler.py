"""全站抓取服务 - 使用 URLScraper"""

import logging
from typing import List, Dict, Any, Optional
from dataclasses import dataclass

from .scraper import URLScraper

logger = logging.getLogger(__name__)


@dataclass
class CrawlPageResult:
    """单个页面爬取结果"""
    url: str
    title: str
    content: str
    content_hash: str
    depth: int
    success: bool
    error: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class SiteCrawler:
    """全站爬取器 - 使用 URLScraper 发现并抓取页面"""

    def __init__(
        self,
        timeout: int = 60,
        user_agent: str = "",
        jina_api_key: str = "",
    ):
        self.scraper = URLScraper(
            timeout=timeout,
            user_agent=user_agent,
            jina_api_key=jina_api_key,
        )

    def _build_page_result(
        self,
        url: str,
        fetch_result: Dict[str, Any],
        depth: int,
    ) -> CrawlPageResult:
        metadata = dict(fetch_result.get("metadata") or {})
        metadata["depth"] = depth

        final_url = metadata.get("final_url") or url
        success = bool(fetch_result.get("success"))

        return CrawlPageResult(
            url=final_url,
            title=fetch_result.get("title") or "",
            content=fetch_result.get("content") or "",
            content_hash=fetch_result.get("content_hash") or "",
            depth=depth,
            success=success,
            error=fetch_result.get("error"),
            metadata=metadata,
        )

    async def crawl_site(
        self,
        url: str,
        max_depth: int = 2,
        max_pages: int = 50,
        include_external: bool = False,
    ) -> List[CrawlPageResult]:
        """
        全站爬取，返回所有页面内容

        Args:
            url: 起始URL
            max_depth: 最大爬取深度
            max_pages: 最大页面数量（包含起始URL）
            include_external: 是否包含外部链接（当前未启用）

        Returns:
            爬取结果列表
        """
        logger.info(
            f"[SiteCrawler] crawl_site called with url={url}, depth={max_depth}, pages={max_pages}"
        )

        if include_external:
            logger.info("[SiteCrawler] include_external is ignored by URLScraper-based crawler")

        candidate_urls: List[tuple[str, int]] = [(url, 0)]

        if max_depth > 0 and max_pages > 1:
            try:
                discovered_urls = await self.scraper.discover_subpages(
                    url,
                    max_depth=max_depth,
                    max_pages=max_pages - 1,
                )
                existing_urls = {candidate_url for candidate_url, _ in candidate_urls}
                for discovered_url, discovered_depth in discovered_urls:
                    if discovered_url not in existing_urls:
                        candidate_urls.append((discovered_url, discovered_depth))
                        existing_urls.add(discovered_url)
                    if len(candidate_urls) >= max_pages:
                        break
            except Exception as e:
                logger.warning(f"[SiteCrawler] Failed to discover subpages for {url}: {e}")

        results: List[CrawlPageResult] = []

        for page_url, page_depth in candidate_urls[:max_pages]:
            fetch_result = await self.scraper.fetch(page_url)
            page_result = self._build_page_result(page_url, fetch_result, page_depth)
            results.append(page_result)

            if page_result.success:
                logger.info(
                    f"[SiteCrawler] Processed page: {page_result.url}, title={page_result.title[:50] if page_result.title else 'N/A'}, content_length={len(page_result.content)}"
                )
            else:
                logger.warning(
                    f"[SiteCrawler] Failed to process page {page_url}: {page_result.error}"
                )

        logger.info(
            f"[SiteCrawler] Site crawl completed: {len(results)} pages crawled from {url}"
        )
        return results

    async def crawl_single_page(self, url: str) -> CrawlPageResult:
        """
        爬取单个页面

        Args:
            url: 要爬取的URL

        Returns:
            页面爬取结果
        """
        fetch_result = await self.scraper.fetch(url)
        return self._build_page_result(url, fetch_result, depth=0)
