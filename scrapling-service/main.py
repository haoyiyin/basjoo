"""
Scrapling-based web scraping service.
Uses curl_cffi for TLS-impersonated HTTP and readability-lxml for content extraction.
"""

import hashlib
import logging
from datetime import datetime, timezone
from typing import List, Optional
from urllib.parse import urljoin, urlparse

from bs4 import BeautifulSoup
from curl_cffi import requests as curl_requests
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
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


class FetchRequest(BaseModel):
    url: str
    timeout: int = 60


class FetchResponse(BaseModel):
    title: str
    content: str
    content_hash: str
    metadata: dict
    success: bool
    error: Optional[str] = None


class DiscoverRequest(BaseModel):
    url: str
    max_depth: int = 1
    max_pages: int = 20


class DiscoverResponse(BaseModel):
    urls: List[dict]


@app.get("/health")
async def health():
    return {"status": "healthy"}


def _extract_content(html: str, url: str) -> tuple:
    """Extract title and main content from HTML using readability-lxml."""
    try:
        doc = Document(html)
        title = doc.title() or ""
        content_html = doc.summary()
        soup = BeautifulSoup(content_html, "lxml")
        content = soup.get_text(separator="\n", strip=True)
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
        return title, content


@app.post("/fetch", response_model=FetchResponse)
async def fetch_url(request: FetchRequest):
    try:
        logger.info(f"Fetching URL: {request.url}")

        # Use curl_cffi for TLS-impersonated HTTP (impersonates Chrome 120)
        resp = curl_requests.get(
            request.url,
            headers=DEFAULT_HEADERS,
            timeout=request.timeout,
            impersonate="chrome120",
            allow_redirects=True,
        )

        if resp.status_code >= 400:
            return FetchResponse(
                title="",
                content="",
                content_hash="",
                metadata={"url": request.url, "status_code": resp.status_code, "fetcher": "scrapling"},
                success=False,
                error=f"HTTP {resp.status_code}"
            )

        content_type = resp.headers.get("content-type", "")
        if "text/html" not in content_type.lower() and "text/plain" not in content_type.lower():
            return FetchResponse(
                title="",
                content="",
                content_hash="",
                metadata={"url": request.url, "content_type": content_type, "fetcher": "scrapling"},
                success=False,
                error=f"Unsupported content type: {content_type}"
            )

        html = resp.text
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
            "final_url": resp.url or request.url,
            "status_code": resp.status_code,
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

        resp = curl_requests.get(
            request.url,
            headers=DEFAULT_HEADERS,
            timeout=30,
            impersonate="chrome120",
            allow_redirects=True,
        )

        if resp.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"HTTP {resp.status_code}")

        soup = BeautifulSoup(resp.text, "lxml")
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
