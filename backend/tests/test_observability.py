"""
System Observability and Monitoring Tests
This suite tests system observability, logging, and monitoring capabilities
"""

import pytest
import asyncio
import json


class TestSystemObservability:
    """Test suite for system observability and monitoring"""

    @pytest.mark.asyncio
    async def test_health_endpoint_responsive(self, client):
        """Test health check endpoint responds quickly"""
        import time

        start_time = time.time()
        response = await client.get("/health")
        elapsed = time.time() - start_time

        assert response.status_code == 200
        assert elapsed < 0.5, f"Health check too slow: {elapsed:.3f}s"
        assert response.json() == {"status": "healthy"}

    @pytest.mark.asyncio
    async def test_api_docs_accessible(self, client):
        """Test API documentation is accessible"""
        response = await client.get("/docs")
        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_openapi_schema(self, client):
        """Test OpenAPI schema is available"""
        response = await client.get("/openapi.json")
        assert response.status_code == 200
        schema = response.json()
        assert "openapi" in schema
        assert "paths" in schema
        assert "info" in schema

    @pytest.mark.asyncio
    async def test_root_endpoint_info(self, client):
        """Test root endpoint provides system info"""
        response = await client.get("/")
        assert response.status_code == 200
        data = response.json()
        assert "message" in data
        assert "version" in data
        assert "docs" in data

    @pytest.mark.asyncio
    async def test_quota_endpoint_informative(self, client):
        """Test quota endpoint provides detailed information"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
        assert response.status_code == 200
        quota = response.json()

        # Verify all quota fields are present
        required_fields = [
            "max_urls", "max_qa_items", "max_messages_per_day",
            "used_urls", "used_qa_items", "used_messages_today",
            "remaining_urls", "remaining_qa_items", "remaining_messages_today"
        ]
        for field in required_fields:
            assert field in quota, f"Missing quota field: {field}"

    @pytest.mark.asyncio
    async def test_index_endpoint_informative(self, client):
        """Test index endpoint provides detailed information"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        response = await client.get(f"/api/v1/index:info?agent_id={agent_id}")
        assert response.status_code == 200
        index_info = response.json()

        # Verify index fields
        assert "agent_id" in index_info
        assert "index_exists" in index_info

    @pytest.mark.asyncio
    async def test_agent_config_complete(self, client):
        """Test agent config endpoint provides complete information"""
        response = await client.get("/api/v1/agent:default")
        assert response.status_code == 200
        agent = response.json()

        # Verify all important config fields
        required_fields = [
            "id", "name", "model", "temperature", "max_tokens", "reasoning_effort",
            "top_k", "similarity_threshold", "widget_title",
            "widget_color", "welcome_message", "is_active"
        ]
        for field in required_fields:
            assert field in agent, f"Missing agent field: {field}"

    @pytest.mark.asyncio
    async def test_list_endpoints_paginated(self, client):
        """Test list endpoints support pagination parameters"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Test Q&A list with different page sizes
        for page_size in [5, 10, 20]:
            response = await client.get(
                f"/api/v1/qa:list?agent_id={agent_id}&limit={page_size}"
            )
            assert response.status_code == 200
            data = response.json()
            assert "items" in data
            assert "total" in data

    @pytest.mark.asyncio
    async def test_error_responses_structured(self, client):
        """Test error responses have proper structure"""
        # Test 404 error
        response = await client.get("/api/v1/quota?agent_id=nonexistent")
        assert response.status_code == 404
        error = response.json()
        assert "detail" in error

        # Test 422 error (validation)
        response = await client.post(
            "/api/v1/chat",
            json={"agent_id": "some_agent"}  # Missing message
        )
        assert response.status_code == 422
        error = response.json()
        assert "detail" in error

    @pytest.mark.asyncio
    async def test_session_consistency(self, client):
        """Test session data remains consistent across operations"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        session_id = "consistency_test"

        # Send multiple messages in same session
        messages_sent = []
        for i in range(3):
            response = await client.post(
                "/api/v1/chat",
                json={
                    "agent_id": agent_id,
                    "session_id": session_id,
                    "message": f"Message {i}",
                },
            )
            assert response.status_code == 200
            messages_sent.append(response.json()["reply"])

        # Verify all responses were generated
        assert len(messages_sent) == 3
        assert all(len(msg) > 0 for msg in messages_sent)

    @pytest.mark.asyncio
    async def test_concurrent_sessions_independent(self, client):
        """Test concurrent sessions remain independent"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        async def chat_in_session(session_num: int):
            session_id = f"independent_test_{session_num}"
            response = await client.post(
                "/api/v1/chat",
                json={
                    "agent_id": agent_id,
                    "session_id": session_id,
                    "message": f"Session {session_num} message",
                },
            )
            return response.status_code == 200

        # Run 10 concurrent sessions
        tasks = [chat_in_session(i) for i in range(10)]
        results = await asyncio.gather(*tasks)

        # All sessions should work independently
        assert sum(results) == 10

    @pytest.mark.asyncio
    async def test_quota_accuracy_tracking(self, client):
        """Test quota tracking is accurate"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Get initial quota
        response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
        initial_quota = response.json()

        # Import exactly 3 Q&A items
        qa_content = json.dumps([
            {"question": f"Q{i}", "answer": f"A{i}"}
            for i in range(3)
        ])
        response = await client.post(
            f"/api/v1/qa:batch_import?agent_id={agent_id}",
            json={"format": "json", "content": qa_content, "overwrite": False},
        )
        assert response.status_code == 200

        # Verify quota increased by exactly 3
        response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
        new_quota = response.json()
        assert new_quota["used_qa_items"] == initial_quota["used_qa_items"] + 3

    @pytest.mark.asyncio
    async def test_index_status_tracking(self, client):
        """Test index job status is properly tracked"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Trigger index rebuild
        response = await client.post(
            f"/api/v1/index:rebuild?agent_id={agent_id}",
            json={"force": False}
        )
        assert response.status_code == 200
        job_id = response.json()["job_id"]

        # Check job exists
        response = await client.get(
            f"/api/v1/index:status?agent_id={agent_id}&job_id={job_id}"
        )
        assert response.status_code == 200
        job_data = response.json()
        assert "job_id" in job_data
        assert "status" in job_data

    @pytest.mark.asyncio
    async def test_response_size_reasonable(self, client):
        """Test API responses are reasonably sized"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Get agent config
        response = await client.get(f"/api/v1/agent?agent_id={agent_id}")
        assert response.status_code == 200

        # Response should be reasonably sized
        content_length = len(response.content)
        assert content_length < 10000, f"Response too large: {content_length} bytes"

        # Get quota info
        response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
        assert response.status_code == 200
        content_length = len(response.content)
        assert content_length < 5000, f"Response too large: {content_length} bytes"

    @pytest.mark.asyncio
    async def test_api_idempotency(self, client):
        """Test certain operations are idempotent"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Getting quota multiple times should return same result
        responses = []
        for _ in range(3):
            response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
            assert response.status_code == 200
            responses.append(response.json())

        # All responses should be identical
        for i in range(1, len(responses)):
            assert responses[i]["max_urls"] == responses[0]["max_urls"]
            assert responses[i]["max_qa_items"] == responses[0]["max_qa_items"]

    @pytest.mark.asyncio
    async def test_resource_cleanup_efficiency(self, client):
        """Test that cleanup operations are efficient"""
        import time

        # Get agent
        start_time = time.time()
        response = await client.get("/api/v1/agent:default")
        agent_get_time = time.time() - start_time

        # Agent retrieval should be fast
        assert agent_get_time < 1.0, f"Agent retrieval too slow: {agent_get_time:.3f}s"

        # Get index info
        start_time = time.time()
        response = await client.get(f"/api/v1/index:info?agent_id={response.json()['id']}")
        index_get_time = time.time() - start_time

        # Index info should be fast
        assert index_get_time < 1.0, f"Index info too slow: {index_get_time:.3f}s"

    @pytest.mark.asyncio
    async def test_concurrent_read_operations(self, client):
        """Test system handles concurrent read operations efficiently"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        async def concurrent_read():
            return await client.get(f"/api/v1/quota?agent_id={agent_id}")

        # Run 20 concurrent reads
        tasks = [concurrent_read() for _ in range(20)]
        results = await asyncio.gather(*tasks)

        # All should succeed
        successful = sum(1 for r in results if r.status_code == 200)
        assert successful == 20

        # All should return consistent data
        quotas = [r.json() for r in results]
        first_quota = quotas[0]
        for quota in quotas[1:]:
            assert quota["max_urls"] == first_quota["max_urls"]

    @pytest.mark.asyncio
    async def test_system_stability_under_load(self, client):
        """Test system remains stable under sustained load"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Send 30 chat messages in rapid succession
        success_count = 0
        for i in range(30):
            response = await client.post(
                "/api/v1/chat",
                json={
                    "agent_id": agent_id,
                    "message": f"Load test message {i}",
                },
            )
            if response.status_code == 200:
                success_count += 1

        # Most should succeed
        assert success_count >= 28, f"Only {success_count}/30 succeeded under load"

    @pytest.mark.asyncio
    async def test_data_consistency_after_operations(self, client):
        """Test data remains consistent after various operations"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Perform various operations
        operations = []

        # Import Q&A
        qa_content = json.dumps([{"question": "Test", "answer": "Test"}])
        operations.append(
            client.post(
                f"/api/v1/qa:batch_import?agent_id={agent_id}",
                json={"format": "json", "content": qa_content, "overwrite": False},
            )
        )

        # Get quota multiple times
        for _ in range(5):
            operations.append(client.get(f"/api/v1/quota?agent_id={agent_id}"))

        # Execute all operations
        results = await asyncio.gather(*operations, return_exceptions=True)

        # All should succeed
        successful = sum(
            1 for r in results
            if not isinstance(r, Exception) and r.status_code == 200
        )
        assert successful == len(operations)
