"""
Integration Testing Suite
This suite tests complete end-to-end workflows and multi-step operations
"""

import pytest
import asyncio
import json

from tests.conftest import wait_for_index_job


class TestIntegrationWorkflows:
    """Test suite for integration testing of complete workflows"""

    @pytest.mark.asyncio
    async def test_complete_rag_workflow(self, client):
        """Test complete RAG workflow: import → index → chat → verify"""
        # 1. Get agent
        response = await client.get("/api/v1/agent:default")
        assert response.status_code == 200
        agent_id = response.json()["id"]

        # 2. Import Q&A knowledge
        qa_content = json.dumps([
            {
                "question": "What is the refund policy?",
                "answer": "We offer 30-day full refund policy for all products."
            },
            {
                "question": "How long does shipping take?",
                "answer": "Standard shipping takes 3-5 business days. Express shipping takes 1-2 days."
            },
            {
                "question": "What payment methods do you accept?",
                "answer": "We accept credit cards, PayPal, and bank transfers."
            }
        ])

        response = await client.post(
            f"/api/v1/qa:batch_import?agent_id={agent_id}",
            json={"format": "json", "content": qa_content, "overwrite": False},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["imported"] == 3

        # 3. Build index
        response = await client.post(
            f"/api/v1/index:rebuild?agent_id={agent_id}",
            json={"force": False}
        )
        assert response.status_code == 200
        job_id = response.json()["job_id"]

        # 4. Wait for index rebuild to complete
        await wait_for_index_job(client, agent_id, job_id)

        # 5. Verify index was built
        response = await client.get(f"/api/v1/index:info?agent_id={agent_id}")
        assert response.status_code == 200
        index_info = response.json()
        assert index_info["index_exists"] or index_info["total_chunks"] > 0

        # 6. Chat and verify RAG is working
        response = await client.post(
            "/api/v1/chat",
            json={
                "agent_id": agent_id,
                "message": "What is your refund policy?",
            },
        )
        assert response.status_code == 200
        chat_response = response.json()
        assert "reply" in chat_response
        assert len(chat_response["reply"]) > 0

    @pytest.mark.asyncio
    async def test_url_to_chat_workflow(self, client):
        """Test complete workflow: add URL → fetch → index → chat"""
        # 1. Get agent
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # 2. Add URL
        response = await client.post(
            f"/api/v1/urls:create?agent_id={agent_id}",
            json={"urls": ["https://example.com"]},
        )
        assert response.status_code == 200

        # 3. Check URL status
        # URL fetching may still be in progress; endpoint should remain usable
        response = await client.get(f"/api/v1/urls:list?agent_id={agent_id}")
        assert response.status_code == 200
        urls = response.json()["urls"]
        assert len(urls) > 0

        # 5. Build index
        response = await client.post(
            f"/api/v1/index:rebuild?agent_id={agent_id}",
            json={"force": False}
        )
        assert response.status_code == 200

        # 6. Chat with the agent
        response = await client.post(
            "/api/v1/chat",
            json={
                "agent_id": agent_id,
                "message": "Tell me about the content",
            },
        )
        # Should succeed even if URL content isn't fully processed yet
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_multi_turn_conversation(self, client):
        """Test multi-turn conversation with context persistence"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Add some knowledge
        qa_content = json.dumps([{
            "question": "What is your name?",
            "answer": "I am Basjoo AI Assistant."
        }])
        await client.post(
            f"/api/v1/qa:batch_import?agent_id={agent_id}",
            json={"format": "json", "content": qa_content, "overwrite": False},
        )

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
    async def test_crud_workflow_for_qa(self, client):
        """Test complete CRUD workflow for Q&A items"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # CREATE: Import Q&A
        qa_content = json.dumps([
            {"question": "Original question 1", "answer": "Original answer 1"},
            {"question": "Original question 2", "answer": "Original answer 2"},
        ])
        response = await client.post(
            f"/api/v1/qa:batch_import?agent_id={agent_id}",
            json={"format": "json", "content": qa_content, "overwrite": False},
        )
        assert response.status_code == 200
        assert response.json()["imported"] == 2

        # READ: List Q&A items
        response = await client.get(f"/api/v1/qa:list?agent_id={agent_id}")
        assert response.status_code == 200
        items = response.json()["items"]
        assert len(items) >= 2

        # Get specific item to update
        qa_id = items[0]["id"]

        # UPDATE: Modify Q&A
        response = await client.put(
            f"/api/v1/qa:update?qa_id={qa_id}",
            json={
                "question": "Updated question",
                "answer": "Updated answer"
            }
        )
        assert response.status_code == 200

        # Verify update
        response = await client.get(f"/api/v1/qa:list?agent_id={agent_id}")
        updated_item = next(
            (item for item in response.json()["items"] if item["id"] == qa_id),
            None
        )
        assert updated_item is not None
        assert updated_item["question"] == "Updated question"

        # DELETE: Remove Q&A
        response = await client.delete(f"/api/v1/qa:delete?qa_id={qa_id}")
        assert response.status_code == 200

        # Verify deletion
        response = await client.get(f"/api/v1/qa:list?agent_id={agent_id}")
        items = response.json()["items"]
        assert not any(item["id"] == qa_id for item in items)

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
                "name": "Test Agent Updated",
                "temperature": 0.9,
                "max_tokens": 2048,
                "reasoning_effort": "high",
                "welcome_message": "Welcome to the updated agent!",
                "widget_color": "#FF5733"
            }
        )
        assert response.status_code == 200

        # Verify updates
        response = await client.get(f"/api/v1/agent?agent_id={agent_id}")
        updated_config = response.json()

        assert updated_config["name"] == "Test Agent Updated"
        assert updated_config["temperature"] == 0.9
        assert updated_config["max_tokens"] == 2048
        assert updated_config["reasoning_effort"] == "high"
        assert updated_config["welcome_message"] == "Welcome to the updated agent!"
        assert updated_config["widget_color"] == "#FF5733"

        # Restore original config
        restore_payload = {
            "name": original_config["name"],
            "temperature": original_config["temperature"],
            "max_tokens": original_config["max_tokens"],
            "reasoning_effort": original_config["reasoning_effort"],
            "welcome_message": original_config["welcome_message"],
            "widget_color": original_config["widget_color"],
        }

        await client.put(
            f"/api/v1/agent?agent_id={agent_id}",
            json=restore_payload,
        )

    @pytest.mark.asyncio
    async def test_quota_tracking_across_operations(self, client):
        """Test that quota is properly tracked across various operations"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Get initial quota
        response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
        initial_quota = response.json()
        initial_qa_count = initial_quota["used_qa_items"]

        # Import some Q&A items
        qa_content = json.dumps([
            {"question": f"Question {i}", "answer": f"Answer {i}"}
            for i in range(3)
        ])
        response = await client.post(
            f"/api/v1/qa:batch_import?agent_id={agent_id}",
            json={"format": "json", "content": qa_content, "overwrite": False},
        )
        assert response.status_code == 200

        # Check quota increased
        response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
        new_quota = response.json()
        assert new_quota["used_qa_items"] == initial_qa_count + 3

        # Send some chat messages
        for i in range(5):
            await client.post(
                "/api/v1/chat",
                json={
                    "agent_id": agent_id,
                    "message": f"Test message {i}",
                },
            )

        # Check message quota increased
        response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
        final_quota = response.json()
        assert final_quota["used_messages_today"] >= initial_quota["used_messages_today"] + 5

    @pytest.mark.asyncio
    async def test_overwrite_qa_items(self, client):
        """Test overwriting existing Q&A items"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Import initial Q&A
        qa_content = json.dumps([{
            "question": "Test question",
            "answer": "Initial answer"
        }])
        response = await client.post(
            f"/api/v1/qa:batch_import?agent_id={agent_id}",
            json={"format": "json", "content": qa_content, "overwrite": False},
        )
        assert response.status_code == 200
        assert response.json()["imported"] == 1

        # Try to import same question again (should fail without overwrite)
        response = await client.post(
            f"/api/v1/qa:batch_import?agent_id={agent_id}",
            json={"format": "json", "content": qa_content, "overwrite": False},
        )
        assert response.status_code == 200
        # Should skip duplicate
        assert response.json()["imported"] == 0

        # Now import with overwrite enabled
        qa_content_updated = json.dumps([{
            "question": "Test question",
            "answer": "Updated answer"
        }])
        response = await client.post(
            f"/api/v1/qa:batch_import?agent_id={agent_id}",
            json={"format": "json", "content": qa_content_updated, "overwrite": True},
        )
        assert response.status_code == 200
        # Should update existing item
        assert response.json()["imported"] == 1

        # Verify the update
        response = await client.get(f"/api/v1/qa:list?agent_id={agent_id}")
        items = response.json()["items"]
        updated_item = next(
            (item for item in items if item["question"] == "Test question"),
            None
        )
        assert updated_item is not None
        assert updated_item["answer"] == "Updated answer"

    @pytest.mark.asyncio
    async def test_index_operations_workflow(self, client):
        """Test complete index management workflow"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # 1. Add knowledge
        qa_content = json.dumps([
            {"question": "Q1", "answer": "A1"},
            {"question": "Q2", "answer": "A2"},
        ])
        await client.post(
            f"/api/v1/qa:batch_import?agent_id={agent_id}",
            json={"format": "json", "content": qa_content, "overwrite": False},
        )

        # 2. Check initial index state
        response = await client.get(f"/api/v1/index:info?agent_id={agent_id}")
        assert response.status_code == 200
        initial_info = response.json()

        # 3. Rebuild index
        response = await client.post(
            f"/api/v1/index:rebuild?agent_id={agent_id}",
            json={"force": False}
        )
        assert response.status_code == 200
        job_id = response.json()["job_id"]

        # 4. Monitor job status
        max_wait = 10
        job_completed = False
        for i in range(max_wait):
            response = await client.get(
                f"/api/v1/index:status?agent_id={agent_id}&job_id={job_id}"
            )
            job_data = response.json()
            if job_data.get("status") == "completed":
                job_completed = True
                break
            elif job_data.get("status") == "failed":
                break
            await asyncio.sleep(1)

        assert job_completed, "Index rebuild job did not complete"

        # 5. Verify index info remains queryable after rebuild
        response = await client.get(f"/api/v1/index:info?agent_id={agent_id}")
        final_info = response.json()
        assert "agent_id" in final_info
        assert "chunks_indexed" in final_info
        assert "total_documents" in final_info

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

    @pytest.mark.asyncio
    async def test_data_consistency_workflow(self, client):
        """Test data consistency across multiple operations"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Perform multiple operations
        operations = []

        # Import Q&A
        qa_content = json.dumps([
            {"question": f"Question {i}", "answer": f"Answer {i}"}
            for i in range(10)
        ])
        operations.append(
            client.post(
                f"/api/v1/qa:batch_import?agent_id={agent_id}",
                json={"format": "json", "content": qa_content, "overwrite": False},
            )
        )

        # Add URLs
        operations.append(
            client.post(
                f"/api/v1/urls:create?agent_id={agent_id}",
                json={"urls": ["https://example.com"]},
            )
        )

        # Send chat messages
        for i in range(5):
            operations.append(
                client.post(
                    "/api/v1/chat",
                    json={
                        "agent_id": agent_id,
                        "message": f"Message {i}",
                    },
                )
            )

        # Execute all operations
        results = await asyncio.gather(*operations, return_exceptions=True)

        # All should succeed
        successful = sum(
            1 for r in results
            if not isinstance(r, Exception) and r.status_code == 200
        )
        assert successful == len(operations)

        # Verify data consistency
        response = await client.get(f"/api/v1/qa:list?agent_id={agent_id}")
        assert response.json()["total"] >= 10

        response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
        quota = response.json()
        assert quota["used_qa_items"] >= 10
        assert quota["used_messages_today"] >= 5
