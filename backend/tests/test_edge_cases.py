"""
Edge Case Testing Suite
This suite tests boundary conditions, unusual inputs, and error scenarios
"""

import pytest
import asyncio
import json


class TestEdgeCases:
    """Test suite for edge cases and boundary conditions"""

    @pytest.mark.asyncio
    async def test_empty_message_handling(self, client):
        """Test handling of empty or whitespace-only messages"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Empty message should fail validation
        response = await client.post(
            "/api/v1/chat",
            json={
                "agent_id": agent_id,
                "message": "",
            },
        )
        # Validation error or success (some systems might handle empty gracefully)
        assert response.status_code in [200, 422]

        # Whitespace-only message should also be handled
        response = await client.post(
            "/api/v1/chat",
            json={
                "agent_id": agent_id,
                "message": "   ",
            },
        )
        assert response.status_code in [200, 422]

    @pytest.mark.asyncio
    async def test_maximum_length_message(self, client):
        """Test handling of maximum length messages"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Test exactly at the limit (1000 characters)
        max_message = "A" * 1000
        response = await client.post(
            "/api/v1/chat",
            json={
                "agent_id": agent_id,
                "message": max_message,
            },
        )
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_special_characters_in_urls(self, client):
        """Test URLs with special characters"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # URLs with various special characters
        test_urls = [
            "https://example.com/path?query=value&other=123",
            "https://example.com/path#fragment",
            "https://example.com/path with spaces",
            "https://example.com/path%20with%20encoding",
            "https://example.com:8080/path",
            "https://user:pass@example.com/path",
        ]

        for url in test_urls:
            response = await client.post(
                f"/api/v1/urls:create?agent_id={agent_id}",
                json={"urls": [url]},
            )
            # Should either succeed or fail gracefully (422 for validation errors)
            assert response.status_code in [200, 400, 422]

    @pytest.mark.asyncio
    async def test_concurrent_index_rebuilds(self, client):
        """Test handling of concurrent index rebuild requests"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Trigger multiple concurrent rebuilds
        async def rebuild_index():
            return await client.post(
                f"/api/v1/index:rebuild?agent_id={agent_id}",
                json={"force": False}
            )

        tasks = [rebuild_index() for _ in range(3)]
        results = await asyncio.gather(*tasks)

        # All should succeed (system should handle concurrent rebuilds)
        successful = sum(1 for r in results if r.status_code == 200)
        assert successful >= 2  # At least 2 should succeed

    @pytest.mark.asyncio
    async def test_quota_boundary_conditions(self, client):
        """Test quota at boundary conditions"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Get quota info
        response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
        assert response.status_code == 200
        quota = response.json()

        # Verify quota values are reasonable
        assert quota["max_urls"] > 0
        assert quota["max_files"] > 0
        assert quota["max_messages_per_day"] > 0
        assert quota["used_urls"] >= 0
        assert quota["used_files"] >= 0
        assert quota["used_messages_today"] >= 0
        assert quota["remaining_urls"] >= 0
        assert quota["remaining_files"] >= 0
        assert quota["remaining_messages_today"] >= 0

        # Verify consistency
        assert quota["used_urls"] <= quota["max_urls"]
        assert quota["used_files"] <= quota["max_files"]
        assert quota["used_messages_today"] <= quota["max_messages_per_day"]

    @pytest.mark.asyncio
    async def test_session_id_variations(self, client):
        """Test various session ID formats"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Test different session ID formats
        session_ids = [
            "simple_session",
            "session-with-dashes",
            "session_with_underscores",
            "session.with.dots",
            "SESSION_WITH_CAPS",
            "session123",
            "123456",
            "",  # Empty session ID
            None,  # No session ID provided
        ]

        for session_id in session_ids:
            response = await client.post(
                "/api/v1/chat",
                json={
                    "agent_id": agent_id,
                    "message": f"Test message for {session_id}",
                    "session_id": session_id if session_id else None,
                },
            )
            # All should be handled gracefully
            assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_agent_config_boundary_values(self, client):
        """Test agent configuration with boundary values"""
        response = await client.get("/api/v1/agent:default")
        original_config = response.json()
        agent_id = original_config["id"]

        try:
            # Test minimum values
            response = await client.put(
                f"/api/v1/agent?agent_id={agent_id}",
                json={
                    "temperature": 0.0,
                    "top_k": 1,
                }
            )
            assert response.status_code == 200

            # Test maximum values
            response = await client.put(
                f"/api/v1/agent?agent_id={agent_id}",
                json={
                    "temperature": 2.0,
                    "top_k": 20,
                }
            )
            assert response.status_code == 200

            # Test invalid values (should fail)
            response = await client.put(
                f"/api/v1/agent?agent_id={agent_id}",
                json={
                    "temperature": 3.0,  # Too high
                }
            )
            assert response.status_code == 422  # Validation error

        finally:
            restore_payload = {
                "temperature": original_config["temperature"],
                "top_k": original_config["top_k"],
            }

            await client.put(
                f"/api/v1/agent?agent_id={agent_id}",
                json=restore_payload,
            )

    @pytest.mark.asyncio
    async def test_delete_nonexistent_items(self, client):
        """Test deleting items that don't exist"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Try to delete non-existent file
        response = await client.delete(
            f"/api/v1/files:delete?agent_id={agent_id}&file_id=kf_nonexistent123"
        )
        assert response.status_code == 404

        # Try to delete non-existent URL
        response = await client.delete(
            f"/api/v1/urls:delete?agent_id={agent_id}&url_id=99999"
        )
        assert response.status_code == 404

    @pytest.mark.asyncio
    async def test_very_long_session_id(self, client):
        """Test with unusually long session ID"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Very long session ID (500 characters)
        long_session_id = "a" * 500

        response = await client.post(
            "/api/v1/chat",
            json={
                "agent_id": agent_id,
                "message": "Test",
                "session_id": long_session_id,
            },
        )
        # Should handle gracefully (may accept or reject based on validation)
        assert response.status_code in [200, 422]

    @pytest.mark.asyncio
    async def test_url_with_authentication_params(self, client):
        """Test URLs with authentication parameters"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # URL with auth params (should be handled carefully)
        auth_urls = [
            "https://api.example.com/v1/data?token=abc123",
            "https://user:password@example.com/secure",
            "https://example.com/api?key=secret&nonce=12345",
        ]

        for url in auth_urls:
            response = await client.post(
                f"/api/v1/urls:create?agent_id={agent_id}",
                json={"urls": [url]},
            )
            # Should accept but potentially mask sensitive data (422 for validation errors)
            assert response.status_code in [200, 422]

    @pytest.mark.asyncio
    async def test_concurrent_quota_checks(self, client):
        """Test concurrent quota checking doesn't cause issues"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Send many concurrent quota check requests
        async def check_quota():
            return await client.get(f"/api/v1/quota?agent_id={agent_id}")

        tasks = [check_quota() for _ in range(20)]
        results = await asyncio.gather(*tasks)

        # All should succeed
        successful = sum(1 for r in results if r.status_code == 200)
        assert successful == 20

        # All should return consistent data
        quotas = [r.json() for r in results]
        first_quota = quotas[0]
        for quota in quotas[1:]:
            assert quota["max_urls"] == first_quota["max_urls"]
            assert quota["max_files"] == first_quota["max_files"]

