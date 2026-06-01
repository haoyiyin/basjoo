"""
Integration Testing Suite
This suite tests complete end-to-end workflows and multi-step operations
"""

import pytest


class TestIntegrationWorkflows:
    """Test suite for integration testing of complete workflows"""

    @pytest.mark.asyncio
    async def test_multi_turn_conversation(self, client):
        """Test multi-turn conversation with context persistence"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        session_id = "multi_turn_test"

        # Turn 1: Introduce yourself
        response = await client.post(
            "/api/v1/chat",
            json={
                "agent_id": agent_id,
                "session_id": session_id,
                "message": "What is your name?",
            },
        )
        assert response.status_code == 200
        reply1 = response.json()["reply"]

        # Turn 2: Follow-up question
        response = await client.post(
            "/api/v1/chat",
            json={
                "agent_id": agent_id,
                "session_id": session_id,
                "message": "Can you help me with a question?",
            },
        )
        assert response.status_code == 200
        reply2 = response.json()["reply"]

        # Turn 3: Another follow-up
        response = await client.post(
            "/api/v1/chat",
            json={
                "agent_id": agent_id,
                "session_id": session_id,
                "message": "Thank you",
            },
        )
        assert response.status_code == 200
        reply3 = response.json()["reply"]

        # All turns should produce responses
        assert len(reply1) > 0
        assert len(reply2) > 0
        assert len(reply3) > 0

    @pytest.mark.asyncio
    async def test_agent_configuration_workflow(self, client):
        """Test agent configuration update workflow"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Get original config
        response = await client.get(f"/api/v1/agent?agent_id={agent_id}")
        assert response.status_code == 200
        original_config = response.json()

        # Update configuration
        response = await client.put(
            f"/api/v1/agent?agent_id={agent_id}",
            json={
                "name": "Agent Upd",
                "temperature": 0.9,
                "welcome_message": "Welcome to the updated agent!",
                "widget_color": "#FF5733",
            },
        )
        assert response.status_code == 200

        # Verify updates
        response = await client.get(f"/api/v1/agent?agent_id={agent_id}")
        updated_config = response.json()

        assert updated_config["name"] == "Agent Upd"
        assert updated_config["temperature"] == 0.9
        assert updated_config["welcome_message"] == "Welcome to the updated agent!"
        assert updated_config["widget_color"] == "#FF5733"

        # Restore original config
        restore_payload = {
            "name": original_config["name"],
            "temperature": original_config["temperature"],
            "welcome_message": original_config["welcome_message"],
            "widget_color": original_config["widget_color"],
        }

        await client.put(
            f"/api/v1/agent?agent_id={agent_id}",
            json=restore_payload,
        )

    @pytest.mark.asyncio
    async def test_error_recovery_workflow(self, client):
        """Test system recovery after various errors"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # 1. Trigger validation error
        response = await client.post(
            "/api/v1/chat",
            json={
                "agent_id": agent_id,
                "message": "",  # Empty message
            },
        )
        assert response.status_code == 422

        # 2. System should still work after error
        response = await client.post(
            "/api/v1/chat",
            json={
                "agent_id": agent_id,
                "message": "Valid message",
            },
        )
        assert response.status_code == 200

        # 3. Try to access non-existent resource
        response = await client.get("/api/v1/quota?agent_id=invalid_agent")
        assert response.status_code == 404

        # 4. System should still work
        response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
        assert response.status_code == 200
