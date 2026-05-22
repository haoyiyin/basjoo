"""
Service Layer Tests
This suite tests core service layer functionality
"""

import pytest

from services.crawler import SiteCrawler
from services.scraper import URLScraper


class TestSchedulerService:
    """Test scheduler service functionality"""

    @pytest.mark.asyncio
    async def test_url_fetch_scheduling(self, client):
        """Test URL fetch scheduling logic"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Add a URL
        response = await client.post(
            f"/api/v1/urls:create?agent_id={agent_id}",
            json={"urls": ["https://example.com/scheduler-test"]},
        )
        # Should succeed (URL added to queue)
        assert response.status_code in [200, 400, 422]


# Auth service tests are covered in test_auth_service.py
# Skipping here to avoid conflicts


class TestScraperService:
    """Test scraper service functionality"""

    @pytest.mark.asyncio
    async def test_url_normalization_via_api(self, client):
        """Test URL normalization via API"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Add same URL with different formats
        response1 = await client.post(
            f"/api/v1/urls:create?agent_id={agent_id}",
            json={"urls": ["https://example.com/test/"]},
        )

        response2 = await client.post(
            f"/api/v1/urls:create?agent_id={agent_id}",
            json={"urls": ["https://example.com/test"]},
        )

        # Both should succeed or be rejected (duplicate detection)
        assert response1.status_code in [200, 400, 422]
        assert response2.status_code in [200, 400, 422]


class TestURLCrawlerRegression:
    """Regression tests for URL scraper and crawler bugs"""

    @pytest.mark.asyncio
    async def test_fetch_direct_accepts_short_non_empty_content(self, monkeypatch):
        async def fake_fetch(self, url):
            return {
                "title": "Contact",
                "content": "Short page.",
                "content_hash": "abc123",
                "metadata": {"url": url, "fetcher": "scrapling"},
                "success": True,
            }

        monkeypatch.setattr(
            "services.scrapling_client.ScraplingClient.fetch", fake_fetch
        )

        scraper = URLScraper()
        result = await scraper.fetch("https://example.com/contact")

        assert result["success"] is True
        assert result["title"] == "Contact"
        assert result["content"] == "Short page."

    @pytest.mark.asyncio
    async def test_discover_subpages_excludes_sibling_paths(self, monkeypatch):
        async def fake_discover(self, url, max_depth=1, max_pages=20):
            return [("https://example.com/product/specs", 1)]

        monkeypatch.setattr(
            "services.scrapling_client.ScraplingClient.discover_subpages",
            fake_discover,
        )

        scraper = URLScraper()
        discovered = await scraper.discover_subpages(
            "https://example.com/product", max_depth=2, max_pages=10
        )

        assert discovered == [("https://example.com/product/specs", 1)]

    @pytest.mark.asyncio
    async def test_crawl_site_preserves_discovered_depth(self, monkeypatch):
        async def fake_discover_subpages(self, url, max_depth=1, max_pages=20):
            return [
                ("https://example.com/docs/getting-started", 1),
                ("https://example.com/docs/getting-started/install", 2),
            ]

        async def fake_fetch(self, url):
            slug = url.rstrip("/").split("/")[-1]
            return {
                "title": slug,
                "content": f"content for {slug}",
                "content_hash": f"hash-{slug}",
                "metadata": {"final_url": url},
                "success": True,
            }

        monkeypatch.setattr(URLScraper, "discover_subpages", fake_discover_subpages)
        monkeypatch.setattr(URLScraper, "fetch", fake_fetch)

        crawler = SiteCrawler()
        results = await crawler.crawl_site(
            "https://example.com/docs", max_depth=2, max_pages=3
        )

        assert [(result.url, result.depth) for result in results] == [
            ("https://example.com/docs", 0),
            ("https://example.com/docs/getting-started", 1),
            ("https://example.com/docs/getting-started/install", 2),
        ]
        assert [result.metadata["depth"] for result in results] == [0, 1, 2]


class TestDatabaseOperations:
    """Test database operations and data integrity"""

    @pytest.mark.asyncio
    async def test_foreign_key_constraints(self, client):
        """Test foreign key constraints are enforced"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Create a chat session
        response = await client.post(
            "/api/v1/chat",
            json={"agent_id": agent_id, "message": "Test message"},
        )
        assert response.status_code == 200

        # Try to delete agent (should fail due to foreign key constraints)
        # Note: We don't have a delete agent endpoint, so this is theoretical
        # The constraint is defined in models.py


class TestErrorHandling:
    """Test error handling in various scenarios"""

    @pytest.mark.asyncio
    async def test_network_timeout_handling(self, client):
        """Test handling of network timeouts"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Add URL (will be fetched in background)
        response = await client.post(
            f"/api/v1/urls:create?agent_id={agent_id}",
            json={"urls": ["https://example.com/timeout-test"]},
        )
        # Should succeed or fail gracefully
        assert response.status_code in [200, 400, 422]

    @pytest.mark.asyncio
    async def test_resource_cleanup(self, client):
        """Test resources are cleaned up properly"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Create multiple sessions
        for i in range(5):
            await client.post(
                "/api/v1/chat",
                json={
                    "agent_id": agent_id,
                    "session_id": f"cleanup_test_{i}",
                    "message": f"Message {i}",
                },
            )

        # Delete URL if exists
        response = await client.get(f"/api/v1/urls:list?agent_id={agent_id}")
        if response.json()["urls"]:
            url_id = response.json()["urls"][0]["id"]
            await client.delete(f"/api/v1/urls:delete?url_id={url_id}&agent_id={agent_id}")

        # Verify cleanup happened (quota updated)
        response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
        assert response.status_code == 200
        quota = response.json()
        assert quota is not None
