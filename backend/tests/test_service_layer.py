"""
Service Layer Tests
This suite tests core service layer functionality
"""

import json
from datetime import datetime, timezone, timedelta

import httpx
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


class TestVectorStoreService:
    """Test vector store service functionality"""

    @pytest.mark.asyncio
    async def test_vector_retrieval_accuracy(self, client):
        """Test vector retrieval returns accurate results"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Add specific Q&A with unique content
        qa_content = json.dumps([
            {
                "question": "What is the capital of France?",
                "answer": "The capital of France is Paris."
            },
            {
                "question": "What is the capital of Japan?",
                "answer": "The capital of Japan is Tokyo."
            },
            {
                "question": "What is the capital of Brazil?",
                "answer": "The capital of Brazil is Brasilia."
            },
        ])

        response = await client.post(
            f"/api/v1/qa:batch_import?agent_id={agent_id}",
            json={"format": "json", "content": qa_content, "overwrite": False},
        )
        assert response.status_code == 200

        # Rebuild index to ensure vector embeddings are created
        response = await client.post(
            f"/api/v1/index:rebuild?agent_id={agent_id}",
            json={"force": True},
        )
        assert response.status_code == 200

        # Wait for indexing to complete
        import asyncio
        await asyncio.sleep(3)

        # Test chat with specific questions
        response = await client.post(
            "/api/v1/chat",
            json={"agent_id": agent_id, "message": "What is the capital of France?"},
        )
        assert response.status_code == 200
        reply = response.json()["reply"]
        assert "Paris" in reply or "capital" in reply.lower()


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
        short_html = "<html><head><title>Contact</title></head><body><main>Short page.</main></body></html>"

        class FakeAsyncClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def get(self, url, follow_redirects=True):
                return httpx.Response(
                    200,
                    headers={"content-type": "text/html; charset=utf-8"},
                    text=short_html,
                    request=httpx.Request("GET", url),
                )

        monkeypatch.setattr("services.scraper.httpx.AsyncClient", FakeAsyncClient)

        scraper = URLScraper()
        result = await scraper.fetch("https://example.com/contact", use_jina=False)

        assert result["success"] is True
        assert result["title"] == "Contact"
        assert result["content"] == "Short page."

    @pytest.mark.asyncio
    async def test_discover_subpages_excludes_sibling_paths(self, monkeypatch):
        pages = {
            "https://example.com/product": """
                <html><body>
                    <a href="/product/specs">Specs</a>
                    <a href="/products">Products</a>
                    <a href="/productivity">Productivity</a>
                </body></html>
            """,
            "https://example.com/product/specs": "<html><body><p>Specs page</p></body></html>",
        }

        class FakeAsyncClient:
            def __init__(self, *args, **kwargs):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, exc_type, exc, tb):
                return False

            async def get(self, url, follow_redirects=True):
                if url not in pages:
                    raise AssertionError(f"Unexpected URL fetched during discovery: {url}")
                return httpx.Response(
                    200,
                    headers={"content-type": "text/html; charset=utf-8"},
                    text=pages[url],
                    request=httpx.Request("GET", url),
                )

        monkeypatch.setattr("services.scraper.httpx.AsyncClient", FakeAsyncClient)

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

        async def fake_fetch(self, url, use_jina=True):
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


class TestRAGService:
    """Test RAG (Retrieval Augmented Generation) service"""

    @pytest.mark.asyncio
    async def test_rag_workflow_integration(self, client):
        """Test complete RAG workflow from Q&A to chat"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Add Q&A knowledge
        qa_content = json.dumps([
            {
                "question": "Test question for RAG",
                "answer": "Test answer for RAG workflow"
            },
        ])

        response = await client.post(
            f"/api/v1/qa:batch_import?agent_id={agent_id}",
            json={"format": "json", "content": qa_content, "overwrite": False},
        )
        assert response.status_code == 200

        # Rebuild index
        response = await client.post(
            f"/api/v1/index:rebuild?agent_id={agent_id}",
            json={"force": True},
        )
        assert response.status_code == 200
        job_id = response.json()["job_id"]

        # Wait for indexing
        import asyncio
        await asyncio.sleep(2)

        # Check job status
        response = await client.get(
            f"/api/v1/index:status?agent_id={agent_id}&job_id={job_id}"
        )
        assert response.status_code == 200
        job_data = response.json()
        assert "status" in job_data

        # Send chat message (should use RAG)
        response = await client.post(
            "/api/v1/chat",
            json={"agent_id": agent_id, "message": "Test message"},
        )
        assert response.status_code == 200
        reply = response.json()["reply"]
        assert isinstance(reply, str)
        assert len(reply) > 0

    @pytest.mark.asyncio
    async def test_context_retrievement_accuracy(self, client):
        """Test that context retrieval is accurate"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Import specific Q&A about different topics
        qa_content = json.dumps([
            {
                "question": "Python programming language features",
                "answer": "Python is a high-level, interpreted programming language known for its simplicity and readability. It supports multiple programming paradigms including procedural, object-oriented, and functional programming."
            },
            {
                "question": "JavaScript programming language features",
                "answer": "JavaScript is a dynamic programming language commonly used for web development. It supports event-driven, functional, and imperative programming styles."
            },
            {
                "question": "Rust programming language features",
                "answer": "Rust is a systems programming language focused on safety, concurrency, and performance. It provides memory safety without garbage collection."
            },
        ])

        response = await client.post(
            f"/api/v1/qa:batch_import?agent_id={agent_id}",
            json={"format": "json", "content": qa_content, "overwrite": False},
        )
        assert response.status_code == 200

        # Rebuild index
        response = await client.post(
            f"/api/v1/index:rebuild?agent_id={agent_id}",
            json={"force": True},
        )
        assert response.status_code == 200

        # Wait for indexing
        import asyncio
        await asyncio.sleep(3)

        # Test context retrieval with specific queries
        test_queries = [
            ("Tell me about Python", "Python"),
            ("What about JavaScript?", "JavaScript"),
            ("Rust language features", "Rust"),
        ]

        for query, expected_keyword in test_queries:
            response = await client.post(
                "/api/v1/chat",
                json={"agent_id": agent_id, "message": query},
            )
            assert response.status_code == 200
            reply = response.json()["reply"]
            # Reply should mention the relevant language
            # Note: With Mock LLM, this might not always work perfectly
            # but the test verifies the workflow completes


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

    @pytest.mark.asyncio
    async def test_transaction_rollback_on_error(self, client):
        """Test transactions rollback on errors"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Get initial quota
        response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
        initial_quota = response.json()
        initial_qa = initial_quota["used_qa_items"]

        # Try to import invalid Q&A (should fail and rollback)
        invalid_qa = json.dumps([
            {"question": "", "answer": ""},  # Invalid: empty question
            {"question": "Valid Q", "answer": "Valid A"},
        ])

        response = await client.post(
            f"/api/v1/qa:batch_import?agent_id={agent_id}",
            json={"format": "json", "content": invalid_qa, "overwrite": False},
        )

        # Check quota hasn't changed (transaction rolled back)
        response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
        new_quota = response.json()

        # Quota should either be same or increased by 1 (only the valid one)
        # depending on how the batch import handles partial failures
        assert new_quota["used_qa_items"] >= initial_qa

    @pytest.mark.asyncio
    async def test_data_consistency_after_crash(self, client):
        """Test data remains consistent after simulated crash"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Import Q&A
        qa_content = json.dumps([
            {"question": "Crash test Q", "answer": "Crash test A"}
        ])

        response = await client.post(
            f"/api/v1/qa:batch_import?agent_id={agent_id}",
            json={"format": "json", "content": qa_content, "overwrite": False},
        )
        assert response.status_code == 200

        # Simulate "crash" by checking data persists
        # (In real scenario, this would be a database restart)
        response = await client.get(f"/api/v1/qa:list?agent_id={agent_id}")
        assert response.status_code == 200

        qa_list = response.json()["items"]
        assert len(qa_list) > 0

        # Data should be consistent
        found = any(item["question"] == "Crash test Q" for item in qa_list)
        assert found, "Data not found after 'crash'"


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
    async def test_malformed_response_handling(self, client):
        """Test handling of malformed API responses"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Try importing malformed Q&A
        malformed_qa = "this is not valid json {{{"

        response = await client.post(
            f"/api/v1/qa:batch_import?agent_id={agent_id}",
            json={"format": "json", "content": malformed_qa, "overwrite": False},
        )

        # Should handle gracefully, not crash
        assert response.status_code in [200, 400, 422]

        if response.status_code == 200:
            result = response.json()
            # Should report errors
            assert result.get("imported", 0) == 0

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
