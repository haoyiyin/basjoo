# Scrapling is licensed under BSD-3-Clause (Copyright (c) 2024, Karim Shoair)
# See LICENSE file for the full license text.

import hashlib
import logging
from datetime import datetime, timezone
from typing import List, Optional
from urllib.parse import urljoin, urlparse

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from scrapling import Fetcher

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Scrapling Service", version="1.0.0")


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


@app.post("/fetch", response_model=FetchResponse)
async def fetch_url(request: FetchRequest):
    try:
        logger.info(f"Fetching URL: {request.url}")

        # Use Scrapling Fetcher for HTTP request with TLS impersonation
        page = Fetcher().get(request.url, timeout=request.timeout)

        # Extract title
        title = ""
        if page.css("title"):
            title = page.css("title")[0].text.strip()
        elif page.css("h1"):
            title = page.css("h1")[0].text.strip()

        # Extract main content as text
        # Try to find main content areas
        main_content = None
        for selector in ["main", "article", "div.content", "div.main", "body"]:
            elements = page.css(selector)
            if elements:
                main_content = elements[0].text
                break

        if not main_content:
            main_content = page.text

        # Clean up content
        content_text = main_content.strip()
        if not content_text or len(content_text) < 10:
            return FetchResponse(
                title=title or "",
                content="",
                content_hash="",
                metadata={},
                success=False,
                error="Extracted content is too short or empty"
            )

        # Compute content hash
        content_hash = hashlib.sha256(content_text.encode("utf-8")).hexdigest()

        # Build metadata
        metadata = {
            "url": request.url,
            "final_url": str(page.url) if hasattr(page, 'url') else request.url,
            "status_code": getattr(page, 'status', 200),
            "content_type": "text/html",
            "content_length": len(content_text),
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
            error=None
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

        # Use Scrapling Fetcher to get the page
        page = Fetcher().get(request.url, timeout=30)

        discovered = []
        seen_urls = set()

        # Extract all links
        links = page.css("a[href]")
        for link in links:
            href = link.attrib.get("href", "")
            if not href:
                continue

            # Skip anchors, javascript, mailto, tel
            if href.startswith("#") or href.startswith("javascript:"):
                continue
            if href.startswith("mailto:") or href.startswith("tel:"):
                continue

            # Resolve relative URLs
            full_url = urljoin(request.url, href)
            parsed = urlparse(full_url)

            # Only same domain
            if parsed.netloc != base_domain:
                continue

            # Normalize path
            normalized_path = parsed.path or "/"
            normalized = f"{parsed.scheme}://{parsed.netloc}{normalized_path}"
            if normalized.endswith("/") and normalized != f"{parsed.scheme}://{parsed.netloc}/":
                normalized = normalized[:-1]
                normalized_path = normalized_path[:-1]

            # Check if subpath
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

    except Exception as e:
        logger.error(f"Error discovering links from {request.url}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
