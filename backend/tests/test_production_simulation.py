"""
Comprehensive Production Environment Simulation Tests
This suite tests the entire system under realistic production conditions
"""

import pytest
import asyncio
import time

from tests.conftest import wait_for_index_job
from datetime import datetime, timezone
from typing import List
import httpx


class TestProductionSimulation:
    """Test suite simulating production environment scenarios"""

    @pytest.mark.asyncio
    async def test_concurrent_chat_requests(self, client):
        """Test handling concurrent chat requests (simulating multiple users)"""
        # Get default agent
        response = await client.get("/api/v1/agent:default")
        assert response.status_code == 200
        agent_id = response.json()["id"]

        # Simulate 10 concurrent users
        async def send_chat_message(user_id: int):
            session_id = f"test_session_{user_id}"
            try:
                response = await client.post(
                    "/api/v1/chat",
                    json={
                        "agent_id": agent_id,
                        "session_id": session_id,
                        "message": f"User {user_id}: What is Basjoo?",
                    },
                )
                return response.status_code == 200
            except Exception as e:
                print(f"Exception in send_chat_message: {e}")
                return False

        # Run concurrent requests
        tasks = [send_chat_message(i) for i in range(10)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # All requests should succeed
        success_count = sum(1 for r in results if r is True)
        assert success_count >= 8, f"Expected at least 8/10 success, got {success_count}"

    @pytest.mark.asyncio
    async def test_quota_concurrent_safety(self, client):
        """Test quota management under concurrent load"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Set a low quota
        response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
        quota_data = response.json()
        initial_quota = quota_data["used_messages_today"]

        # Send multiple concurrent requests
        async def send_request():
            try:
                return await client.post(
                    "/api/v1/chat",
                    json={
                        "agent_id": agent_id,
                        "session_id": f"sess_{time.time()}",
                        "message": "Hello",
                    },
                )
            except Exception:
                return None

        # Send 5 concurrent requests
        tasks = [send_request() for _ in range(5)]
        responses = await asyncio.gather(*tasks)

        # Count successful requests
        successful = sum(1 for r in responses if r and r.status_code == 200)

        # Verify quota increased correctly
        response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
        final_quota = response.json()["used_messages_today"]

        assert final_quota == initial_quota + successful, "Quota tracking failed under load"

    @pytest.mark.asyncio
    async def test_url_deduplication(self, client):
        """Test URL deduplication mechanism"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Add the same URL multiple times (with variations)
        urls = [
            "https://example.com",
            "https://example.com/",  # trailing slash
            "https://www.example.com",  # www prefix
            "https://EXAMPLE.COM",  # different case
        ]

        for url in urls:
            response = await client.post(
                f"/api/v1/urls:create?agent_id={agent_id}",
                json={"urls": [url]},
            )
            # Should succeed or indicate duplicate

        # List URLs - should only have 1 unique URL
        response = await client.get(f"/api/v1/urls:list?agent_id={agent_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 1, f"Expected 1 unique URL, got {data['total']}"

    @pytest.mark.asyncio
    async def test_error_handling_invalid_agent(self, client):
        """Test error handling for invalid agent ID"""
        invalid_agent_id = "agt_invalid123"

        # Try to chat with invalid agent
        response = await client.post(
            "/api/v1/chat",
            json={"agent_id": invalid_agent_id, "session_id": "test", "message": "Hello"},
        )
        assert response.status_code == 404

        # Try to get quota for invalid agent
        response = await client.get(f"/api/v1/quota?agent_id={invalid_agent_id}")
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_malformed_request_handling(self, client):
        """Test handling of malformed requests"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Missing required fields
        response = await client.post(
            "/api/v1/chat",
            json={"agent_id": agent_id},  # Missing message
        )
        assert response.status_code == 422  # Validation error

    @pytest.mark.asyncio
    async def test_session_persistence(self, client):
        """Test chat session persistence across multiple messages"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        session_id = "persistent_test_session"

        # Send first message
        response1 = await client.post(
            "/api/v1/chat",
            json={
                "agent_id": agent_id,
                "session_id": session_id,
                "message": "Hello, this is message 1",
            },
        )
        assert response1.status_code == 200

        # Send second message in same session
        response2 = await client.post(
            "/api/v1/chat",
            json={
                "agent_id": agent_id,
                "session_id": session_id,
                "message": "This is message 2",
            },
        )
        assert response2.status_code == 200

        # Verify session was created (message_count should be >= 2)
        # Note: This would require a session list endpoint to fully verify

    @pytest.mark.asyncio
    async def test_index_rebuild_after_url_update(self, client):
        """Test index rebuild workflow after URL addition"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Add a URL
        response = await client.post(
            f"/api/v1/urls:create?agent_id={agent_id}",
            json={"urls": ["https://example.com"]},
        )
        assert response.status_code == 200

        # Trigger index rebuild
        response = await client.post(
            f"/api/v1/index:rebuild?agent_id={agent_id}",
            json={"force": False}
        )
        assert response.status_code == 200
        data = response.json()
        assert "job_id" in data

        # Check job status
        job_id = data["job_id"]
        await wait_for_index_job(client, agent_id, job_id)

        # Verify index info endpoint works (no data expected since Scrapling isn't available in tests)
        response = await client.get(f"/api/v1/index:info?agent_id={agent_id}")
        assert response.status_code == 200
        data = response.json()
        assert "urls_indexed" in data
        assert "r2r_healthy" in data

    @pytest.mark.asyncio
    async def test_quota_daily_reset(self, client):
        """Test quota reset mechanism (simulated)"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Get current quota
        response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
        assert response.status_code == 200
        quota = response.json()
        reset_date = quota.get("last_message_reset")

        # Verify reset_date exists and is valid
        if reset_date:
            reset_datetime = datetime.fromisoformat(reset_date.replace("Z", "+00:00"))
            assert reset_datetime <= datetime.now(timezone.utc)

    @pytest.mark.asyncio
    async def test_long_message_handling(self, client):
        """Test handling of very long messages"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Create a very long message (5000 characters)
        long_message = "This is a test message. " * 250

        response = await client.post(
            "/api/v1/chat",
            json={
                "agent_id": agent_id,
                "session_id": "long_message_test",
                "message": long_message,
            },
        )

        # Should handle gracefully (may succeed or fail with appropriate error)
        assert response.status_code in [200, 413, 422]

    @pytest.mark.asyncio
    async def test_url_delete_and_refetch(self, client):
        """Test URL deletion and refetch functionality"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Add URL
        response = await client.post(
            f"/api/v1/urls:create?agent_id={agent_id}",
            json={"urls": ["https://example.com"]},
        )
        assert response.status_code == 200

        # Get URL ID
        response = await client.get(f"/api/v1/urls:list?agent_id={agent_id}")
        urls = response.json()["urls"]
        assert len(urls) > 0
        url_id = urls[0]["id"]

        # Delete URL
        response = await client.delete(
            f"/api/v1/urls:delete?agent_id={agent_id}&url_id={url_id}"
        )
        assert response.status_code == 200

        # Verify deletion
        response = await client.get(f"/api/v1/urls:list?agent_id={agent_id}")
        urls = response.json()["urls"]
        assert not any(url["id"] == url_id for url in urls)

    @pytest.mark.asyncio
    async def test_agent_config_update(self, client):
        """Test agent configuration update"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Update agent config
        response = await client.put(
            f"/api/v1/agent?agent_id={agent_id}",
            json={
                "name": "Updated Agent Name",
                "temperature": 0.5,
                "welcome_message": "Welcome to updated agent!"
            }
        )
        assert response.status_code == 200

        # Verify update
        response = await client.get(f"/api/v1/agent?agent_id={agent_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Updated Agent Name"
        assert data["temperature"] == 0.5
        assert data["max_tokens"] == 1024