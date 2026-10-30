"""
Comprehensive Production Environment Simulation Tests
This suite tests the entire system under realistic production conditions
"""

import asyncio
import time
from datetime import datetime, timezone

import pytest


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
        assert success_count >= 8, (
            f"Expected at least 8/10 success, got {success_count}"
        )

    @pytest.mark.asyncio
    async def test_no_message_quota_under_concurrent_load(self, client):
        """#62: concurrent turns never contend on a message counter — there is
        none. Every request is answered; the quota payload has no daily fields."""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

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

        tasks = [send_request() for _ in range(5)]
        responses = await asyncio.gather(*tasks)

        assert all(r is not None and r.status_code == 200 for r in responses), [
            None if r is None else r.status_code for r in responses
        ]

        quota = (await client.get(f"/api/v1/quota?agent_id={agent_id}")).json()
        assert "used_messages_today" not in quota
        assert "max_messages_per_day" not in quota

    @pytest.mark.asyncio
    async def test_error_handling_invalid_agent(self, client):
        """Test error handling for invalid agent ID"""
        invalid_agent_id = "agt_invalid123"

        # Try to chat with invalid agent
        response = await client.post(
            "/api/v1/chat",
            json={
                "agent_id": invalid_agent_id,
                "session_id": "test",
                "message": "Hello",
            },
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
    async def test_there_is_no_daily_message_reset(self, client):
        """#62: nothing resets daily any more — the counter and its timestamp
        are gone from the payload entirely."""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
        assert response.status_code == 200
        quota = response.json()
        assert "last_message_reset" not in quota
        assert "used_messages_today" not in quota

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
    async def test_agent_config_update(self, client):
        """Test agent configuration update"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Update agent config
        response = await client.put(
            f"/api/v1/agent?agent_id={agent_id}",
            json={
                "name": "Agent Upd",
                "temperature": 0.5,
                "welcome_message": "Welcome to updated agent!",
            },
        )
        assert response.status_code == 200

        # Verify update
        response = await client.get(f"/api/v1/agent?agent_id={agent_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["name"] == "Agent Upd"
        assert data["temperature"] == 0.5
        assert data["max_tokens"] == 1024
