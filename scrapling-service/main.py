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
    return addr.is_loopback or addr.is_private or addr.is_link_local or addr.is_multicast or addr.is_unspecified


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
    return httpx.get(url, headers=DEFAULT_HEADERS, timeout=timeout, follow_redirects=False)


def _fetch_following_safe_redirects(url: str, timeout: int, getter):
    current_url = url
    for _ in range(6):
        _validate_fetch_url_safe(current_url)
        resp = getter(current_url, timeout)
        status_code = resp.status_code
        if status_code not in {301, 302, 303, 307, 308}:
            return resp.text, status_code, str(resp.url), resp.headers.get("content-type", "")
        location = resp.headers.get("location")
        if not location:
            return resp.text, status_code, str(resp.url), resp.headers.get("content-type", "")
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
    m = re.search(r'^\s*#\s+(.+)', text, re.MULTILINE)
    if m:
        return m.group(1).strip()
    # Last resort: filename from URL path
    path = urlparse(url).path.rstrip("/")
    if path:
        return path.split("/")[-1]
    return ""


def _extract_content(html: str, url: str) -> tuple:
    """Extract title and main content from HTML using readability-lxml."""
    try:
        doc = Document(html)
        title = doc.title() or ""
        content_html = doc.summary()
        soup = BeautifulSoup(content_html, "lxml")
        content = soup.get_text(separator="\n", strip=True)
        title = _resolve_title(title, html, url)
        return title, content
    except Exception:
        # Fallback to BeautifulSoup
        soup = BeautifulSoup(html, "lxml")
        title = ""
        if soup.title and soup.title.string:
            title = soup.title.string.strip()
        elif soup.h1:
            title = soup.h1.get_text().strip()
        # Remove non-content elements
        for tag in soup(["script", "style", "nav", "header", "footer", "aside", "iframe"]):
            tag.decompose()
        main = soup.find("main") or soup.find("article") or soup.find("body")
        content = main.get_text(separator="\n", strip=True) if main else soup.get_text(separator="\n", strip=True)
        title = _resolve_title(title, html, url)
        return title, content


@app.post("/fetch", response_model=FetchResponse)
async def fetch_url(request: FetchRequest):
    try:
        logger.info(f"Fetching URL: {request.url}")

        html, status_code, final_url, content_type = _fetch_with_fallback(request.url, request.timeout)

        if status_code >= 400:
            return FetchResponse(
                title="",
                content="",
                content_hash="",
                metadata={"url": request.url, "status_code": status_code, "fetcher": "scrapling"},
                success=False,
                error=f"HTTP {status_code}"
            )

        if "text/html" not in content_type.lower() and "text/plain" not in content_type.lower():
            return FetchResponse(
                title="",
                content="",
                content_hash="",
                metadata={"url": request.url, "content_type": content_type, "fetcher": "scrapling"},
                success=False,
                error=f"Unsupported content type: {content_type}"
            )

        title, content_text = _extract_content(html, request.url)

        if not content_text or len(content_text.strip()) < 10:
            return FetchResponse(
                title=title or "",
                content="",
                content_hash="",
                metadata={"url": request.url, "fetcher": "scrapling"},
                success=False,
                error="Extracted content is too short or empty"
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
        return FetchResponse(
            title="",
            content="",
            content_hash="",
            metadata={"url": request.url, "fetcher": "scrapling"},
            success=False,
            error=str(e)
        )


@app.post("/discover", response_model=DiscoverResponse)
async def discover_links(request: DiscoverRequest):
    try:
        logger.info(f"Discovering links from: {request.url}")

        parsed_base = urlparse(request.url)
        base_domain = parsed_base.netloc
        base_path = parsed_base.path or "/"
        if base_path != "/" and base_path.endswith("/"):
            base_path = base_path[:-1]
        base_path_with_slash = "/" if base_path == "/" else f"{base_path}/"

        html, status_code, _, _ = _fetch_with_fallback(request.url, 30)

        if status_code >= 400:
            raise HTTPException(status_code=502, detail=f"HTTP {status_code}")

        soup = BeautifulSoup(html, "lxml")
        discovered = []
        seen_urls = set()

        for link in soup.find_all("a", href=True):
            href = link["href"]
            if href.startswith("#") or href.startswith("javascript:"):
                continue
            if href.startswith("mailto:") or href.startswith("tel:"):
                continue

            full_url = urljoin(request.url, href)
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

            if normalized not in seen_urls:
                seen_urls.add(normalized)
                discovered.append({"url": normalized, "depth": 1})

            if len(discovered) >= request.max_pages:
                break

        logger.info(f"Discovered {len(discovered)} links from {request.url}")
        return DiscoverResponse(urls=discovered[:request.max_pages])

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error discovering links from {request.url}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
