"""
Scrapling-based web scraping service.
Uses curl_cffi for TLS-impersonated HTTP and readability-lxml for content extraction.
"""

import hashlib
import ipaddress
import logging
import re
import socket
from datetime import datetime, timezone
from typing import List, Optional
from urllib.parse import urljoin, urlparse, urlsplit

from bs4 import BeautifulSoup
import httpx
from curl_cffi import requests as curl_requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from readability import Document

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Scrapling Service", version="1.0.0")

# TLS-impersonated browser-like headers
DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7",
}


def _is_unsafe_ip(host: str) -> bool:
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False
    if addr in ipaddress.ip_network("198.18.0.0/15"):
        return False
    return (
        addr.is_loopback
        or addr.is_private
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_unspecified
    )


def _validate_fetch_url_safe(url: str):
    parsed = urlsplit(url)
    if parsed.scheme.lower() not in {"http", "https"}:
        raise ValueError("Unsafe redirect target scheme")
    if parsed.username or parsed.password:
        raise ValueError("Unsafe redirect target credentials")
    hostname = parsed.hostname
    if not hostname or hostname.lower() == "localhost":
        raise ValueError("Unsafe redirect target host")
    try:
        ipaddress.ip_address(hostname)
        raise ValueError("Unsafe redirect target IP literal")
    except ValueError as e:
        if "Unsafe" in str(e):
            raise
    for info in socket.getaddrinfo(hostname, None):
        if _is_unsafe_ip(info[4][0]):
            raise ValueError("Unsafe redirect target resolved IP")


def _curl_get(url: str, timeout: int):
    return curl_requests.get(
        url,
        headers=DEFAULT_HEADERS,
        timeout=timeout,
        impersonate="chrome120",
        allow_redirects=False,
    )


def _httpx_get(url: str, timeout: int):
    return httpx.get(
        url, headers=DEFAULT_HEADERS, timeout=timeout, follow_redirects=False
    )


def _fetch_following_safe_redirects(url: str, timeout: int, getter):
    current_url = url
    for _ in range(6):
        _validate_fetch_url_safe(current_url)
        resp = getter(current_url, timeout)
        status_code = resp.status_code
        if status_code not in {301, 302, 303, 307, 308}:
            return (
                resp.text,
                status_code,
                str(resp.url),
                resp.headers.get("content-type", ""),
            )
        location = resp.headers.get("location")
        if not location:
            return (
                resp.text,
                status_code,
                str(resp.url),
                resp.headers.get("content-type", ""),
            )
        current_url = urljoin(str(resp.url), location)
    raise ValueError("Too many redirects")


def _fetch_with_fallback(url: str, timeout: int = 30):
    try:
        return _fetch_following_safe_redirects(url, timeout, _curl_get)
    except Exception as e:
        logger.warning(f"curl_cffi failed for {url}: {e}, falling back to httpx")
        return _fetch_following_safe_redirects(url, timeout, _httpx_get)


class FetchRequest(BaseModel):
    url: str = Field(..., max_length=2048)
    timeout: int = Field(60, ge=1, le=60)


class FetchResponse(BaseModel):
    title: str
    content: str
    content_hash: str
    metadata: dict
    success: bool
    error: Optional[str] = None


class DiscoverRequest(BaseModel):
    url: str = Field(..., max_length=2048)
    max_depth: int = Field(1, ge=1, le=5)
    max_pages: int = Field(20, ge=1, le=500)


class DiscoverResponse(BaseModel):
    urls: List[dict]


@app.get("/health")
async def health():
    return {"status": "healthy"}


def _resolve_title(title: str, html: str, url: str) -> str:
    """Resolve a fallback title when the primary extractor returns empty."""
    if title and title != "[no-title]":
        return title
    soup = BeautifulSoup(html, "lxml")
    # Try <h1> tag
    if soup.h1:
        return soup.h1.get_text().strip()
    # Try first markdown heading in plain-text content
    text = soup.get_text()
    m = re.search(r"^\s*#\s+(.+)", text, re.MULTILINE)
    if m:
        return m.group(1).strip()
    # Last resort: filename from URL path
    path = urlparse(url).path.rstrip("/")
    if path:
        return path.split("/")[-1]
    return ""


# Keywords that indicate non-content regions (navigation, footer, sidebar, ads)
NEGATIVE_KEYWORDS = [
    'footer', 'sidebar', 'nav', 'navigation', 'menu', 'header',
    'advertisement', 'ad-', 'ads-', 'social', 'share', 'comment',
    'related', 'recommend', 'breadcrumb', 'pagination', 'pager',
    'copyright', 'legal', 'disclaimer', 'cookie', 'gdpr',
]

# Keywords that indicate main content regions
POSITIVE_KEYWORDS = [
    'article', 'content', 'post', 'entry', 'text', 'body',
    'main', 'story', 'blog', 'product', 'description', 'detail',
]


def _clean_template_content(content: str, min_unique_ratio: float = 0.3) -> str:
    """Remove repetitive template content that appears across multiple pages.

    Some websites have footer/contact sections that repeat on every page.
    This function detects and removes such template content.

    Args:
        content: The extracted text content
        min_unique_ratio: Minimum ratio of unique lines to total lines (default 0.3)

    Returns:
        Cleaned content with template sections removed
    """
    if not content or len(content) < 100:
        return content

    lines = content.split('\n')
    if len(lines) < 3:
        return content

    # Detect repetitive lines (likely template content)
    line_counts = {}
    for line in lines:
        stripped = line.strip()
        if len(stripped) < 10:  # Skip short lines
            continue
        line_counts[stripped] = line_counts.get(stripped, 0) + 1

    # Find lines that appear multiple times (template content)
    template_lines = set()
    for line, count in line_counts.items():
        if count >= 2 and len(line) > 20:  # Repetitive long lines
            template_lines.add(line)

    # If more than 50% of significant lines are templates, filter them
    if len(template_lines) > 0:
        total_significant = sum(1 for l in lines if len(l.strip()) > 20)
        template_ratio = len(template_lines) / max(total_significant, 1)

        if template_ratio > 0.5:  # High template content ratio
            # Keep only unique content
            cleaned_lines = []
            for line in lines:
                stripped = line.strip()
                if stripped not in template_lines:
                    cleaned_lines.append(line)

            cleaned_content = '\n'.join(cleaned_lines)
            if len(cleaned_content.strip()) >= 50:  # Ensure we still have content
                return cleaned_content

    return content


def _extract_content(html: str, url: str) -> tuple:
    """Extract title and main content from HTML using readability-lxml."""
    try:
        # Optimized readability configuration
        doc = Document(
            html,
            url=url,  # Help resolve relative URLs
            min_text_length=50,  # Filter short text blocks (default 25)
            retry_length=300,    # More aggressive retry threshold (default 250)
            positive_keywords=POSITIVE_KEYWORDS,
            negative_keywords=NEGATIVE_KEYWORDS,
        )
        title = doc.title() or ""
        content_html = doc.summary()
        soup = BeautifulSoup(content_html, "lxml")
        content = soup.get_text(separator="\n", strip=True)

        # Clean template content
        content = _clean_template_content(content)

        title = _resolve_title(title, html, url)
        return title, content
    except Exception:
        # Enhanced BeautifulSoup fallback
        soup = BeautifulSoup(html, "lxml")
        title = ""
        if soup.title and soup.title.string:
            title = soup.title.string.strip()
        elif soup.h1:
            title = soup.h1.get_text().strip()

        # Remove non-content elements (expanded list)
        for tag in soup(
            ["script", "style", "nav", "header", "footer", "aside", "iframe",
             "noscript", "form", "button", "input", "select", "textarea"]
        ):
            tag.decompose()

        # Also remove elements with common non-content class names
        for class_pattern in ['nav', 'menu', 'sidebar', 'footer', 'header', 'ad', 'social', 'share', 'comment', 'related']:
            for tag in soup.find_all(class_=lambda c: c and class_pattern in str(c).lower()):
                tag.decompose()

        # Try to find main content area with priority order
        main = (
            soup.find("main")
            or soup.find("article")
            or soup.find("div", class_=lambda c: c and 'content' in str(c).lower())
            or soup.find("div", id=lambda i: i and 'content' in str(i).lower())
            or soup.find("div", class_=lambda c: c and 'main' in str(c).lower())
            or soup.find("body")
        )
        content = (
            main.get_text(separator="\n", strip=True)
            if main
            else soup.get_text(separator="\n", strip=True)
        )

        # Clean template content
        content = _clean_template_content(content)

        title = _resolve_title(title, html, url)
        return title, content


@app.post("/fetch", response_model=FetchResponse)
async def fetch_url(request: FetchRequest):
    try:
        logger.info(f"Fetching URL: {request.url}")

        html, status_code, final_url, content_type = _fetch_with_fallback(
            request.url, request.timeout
        )

        if status_code >= 400:
            return FetchResponse(
                title="",
                content="",
                content_hash="",
                metadata={
                    "url": request.url,
                    "status_code": status_code,
                    "fetcher": "scrapling",
                },
                success=False,
                error=f"HTTP {status_code}",
            )

        if (
            "text/html" not in content_type.lower()
            and "text/plain" not in content_type.lower()
        ):
            return FetchResponse(
                title="",
                content="",
                content_hash="",
                metadata={
                    "url": request.url,
                    "content_type": content_type,
                    "fetcher": "scrapling",
                },
                success=False,
                error=f"Unsupported content type: {content_type}",
            )

        title, content_text = _extract_content(html, request.url)

        if not content_text or len(content_text.strip()) < 10:
            return FetchResponse(
                title=title or "",
                content="",
                content_hash="",
                metadata={"url": request.url, "fetcher": "scrapling"},
                success=False,
                error="Extracted content is too short or empty",
            )

        content_hash = hashlib.sha256(content_text.encode("utf-8")).hexdigest()

        metadata = {
            "url": request.url,
            "final_url": final_url or request.url,
            "status_code": status_code,
            "content_type": content_type,
            "content_length": len(html),
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "fetcher": "scrapling",
        }

        logger.info(f"Successfully fetched {request.url}: {len(content_text)} chars")
        return FetchResponse(
            title=title or "",
            content=content_text,
            content_hash=content_hash,
            metadata=metadata,
            success=True,
        )

    except Exception as e:
        logger.error(f"Error fetching {request.url}: {e}")
        error_str = str(e)

        # Provide user-friendly error messages for common SSL/TLS issues
        friendly_error = error_str
        if "SSL" in error_str or "TLS" in error_str or "UNEXPECTED_EOF" in error_str:
            friendly_error = "SSL/TLS connection error: The website has a security certificate problem or an unstable connection. Please try again later or use a different URL."
        elif "timeout" in error_str.lower() or "timed out" in error_str.lower():
            friendly_error = "Connection timeout: The website took too long to respond. Please try again later."
        elif "connection refused" in error_str.lower() or "connect error" in error_str.lower():
            friendly_error = "Connection refused: The website is not accessible or blocking requests."
        elif "403" in error_str or "Forbidden" in error_str:
            friendly_error = "Access denied (HTTP 403): The website is blocking automated access."
        elif "404" in error_str or "Not Found" in error_str:
            friendly_error = "Page not found (HTTP 404): The URL does not exist."
        elif "chunked" in error_str.lower():
            friendly_error = "Data transfer error: The website's response was incomplete or corrupted. This may be a temporary issue."

        return FetchResponse(
            title="",
            content="",
            content_hash="",
            metadata={"url": request.url, "fetcher": "scrapling", "raw_error": error_str},
            success=False,
            error=friendly_error,
        )


def _extract_links_from_html(
    html: str, base_url: str, base_domain: str, base_path: str
) -> List[str]:
    """Extract valid links from HTML that match the base domain and path."""
    base_path_with_slash = "/" if base_path == "/" else f"{base_path}/"
    soup = BeautifulSoup(html, "lxml")
    links = []

    for link in soup.find_all("a", href=True):
        href = link["href"]
        if href.startswith("#") or href.startswith("javascript:"):
            continue
        if href.startswith("mailto:") or href.startswith("tel:"):
            continue

        full_url = urljoin(base_url, href)
        parsed = urlparse(full_url)

        if parsed.netloc != base_domain:
            continue

        normalized_path = parsed.path or "/"
        normalized = f"{parsed.scheme}://{parsed.netloc}{normalized_path}"
        if (
            normalized.endswith("/")
            and normalized != f"{parsed.scheme}://{parsed.netloc}/"
        ):
            normalized = normalized[:-1]
            normalized_path = normalized_path[:-1]

        is_subpath = normalized_path == base_path or normalized_path.startswith(
            base_path_with_slash
        )
        if not is_subpath:
            continue

        links.append(normalized)

    return links


@app.post("/discover", response_model=DiscoverResponse)
async def discover_links(request: DiscoverRequest):
    try:
        logger.info(
            f"Discovering links from: {request.url} with max_depth={request.max_depth}, max_pages={request.max_pages}"
        )

        # Parse the seed URL
        parsed_base = urlparse(request.url)
        base_domain = parsed_base.netloc
        base_path = parsed_base.path or "/"
        if base_path != "/" and base_path.endswith("/"):
            base_path = base_path[:-1]

        # Normalize the seed URL
        seed_url = f"{parsed_base.scheme}://{parsed_base.netloc}{base_path}"
        if (
            seed_url.endswith("/")
            and seed_url != f"{parsed_base.scheme}://{parsed_base.netloc}/"
        ):
            seed_url = seed_url[:-1]

        # BFS queue: list of (url, depth)
        from collections import deque

        queue = deque([(seed_url, 0)])
        seen_urls = {seed_url}
        discovered = [{"url": seed_url, "depth": 0}]

        logger.info(f"Starting BFS crawl from seed: {seed_url}")

        while queue and len(discovered) < request.max_pages:
            current_url, current_depth = queue.popleft()

            # Stop if we've reached max_depth
            if current_depth >= request.max_depth:
                continue

            logger.debug(f"Fetching {current_url} at depth {current_depth}")

            try:
                html, status_code, _, _ = _fetch_with_fallback(current_url, 30)

                if status_code >= 400:
                    logger.warning(f"HTTP {status_code} for {current_url}")
                    continue

                # Extract links from the page
                links = _extract_links_from_html(
                    html, current_url, base_domain, base_path
                )

                for link in links:
                    if link in seen_urls:
                        continue

                    seen_urls.add(link)
                    next_depth = current_depth + 1
                    discovered.append({"url": link, "depth": next_depth})

                    # Queue for next depth level if within bounds
                    if (
                        next_depth < request.max_depth
                        and len(discovered) < request.max_pages
                    ):
                        queue.append((link, next_depth))

                    if len(discovered) >= request.max_pages:
                        break

            except Exception as e:
                logger.warning(f"Error fetching {current_url}: {e}")
                continue

        logger.info(f"Discovered {len(discovered)} links from {request.url}")
        return DiscoverResponse(urls=discovered[: request.max_pages])

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error discovering links from {request.url}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8001)
