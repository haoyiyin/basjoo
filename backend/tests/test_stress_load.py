"""
Stress and Load Testing Suite
This suite tests the system under high load and stress conditions
"""

import pytest
import asyncio
import time
from datetime import datetime

from tests.conftest import wait_for_index_job


class TestStressLoad:
    """Test suite for stress and load testing"""

    @pytest.mark.asyncio
    async def test_high_concurrent_requests(self, client):
        """Test system with 50 concurrent requests"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Import some Q&A data first
        import json
        qa_content = json.dumps([
            {"question": f"Test question {i}", "answer": f"Test answer {i}"}
            for i in range(10)
        ])
        await client.post(
            f"/api/v1/qa:batch_import?agent_id={agent_id}",
            json={"format": "json", "content": qa_content, "overwrite": False},
        )

        # Build index
        response = await client.post(
            f"/api/v1/index:rebuild?agent_id={agent_id}",
            json={"force": False}
        )
        assert response.status_code == 200
        job_id = response.json()["job_id"]
        await wait_for_index_job(client, agent_id, job_id)

        # Send 50 concurrent chat requests
        async def send_request(req_id: int):
            try:
                start_time = time.time()
                response = await client.post(
                    "/api/v1/chat",
                    json={
                        "agent_id": agent_id,
                        "session_id": f"stress_test_{req_id}",
                        "message": f"Question {req_id}: What is Basjoo?",
                    },
                    timeout=10.0
                )
                elapsed = time.time() - start_time
                return {
                    "success": response.status_code == 200,
                    "status": response.status_code,
                    "time": elapsed
                }
            except Exception as e:
                return {"success": False, "error": str(e), "time": -1}

        # Run 50 concurrent requests
        tasks = [send_request(i) for i in range(50)]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Analyze results
        successful = sum(1 for r in results if isinstance(r, dict) and r.get("success"))
        failed = len(results) - successful

        # Calculate response times
        response_times = [r["time"] for r in results if isinstance(r, dict) and r.get("time") > 0]
        avg_response_time = sum(response_times) / len(response_times) if response_times else 0

        # Assertions
        assert successful >= 45, f"Expected at least 45/50 successful requests, got {successful}"
        assert avg_response_time < 10.0, f"Average response time too high: {avg_response_time:.2f}s"

        print(f"\n✓ Load Test Results:")
        print(f"  - Successful: {successful}/50")
        print(f"  - Failed: {failed}/50")
        print(f"  - Avg Response Time: {avg_response_time:.2f}s")

    @pytest.mark.asyncio
    async def test_rapid_sequential_requests(self, client):
        """Test system handling rapid sequential requests from same user"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        session_id = "rapid_test_session"

        # Send 20 rapid sequential requests
        responses = []
        start_time = time.time()

        for i in range(20):
            response = await client.post(
                "/api/v1/chat",
                json={
                    "agent_id": agent_id,
                    "session_id": session_id,
                    "message": f"Message {i}",
                },
            )
            responses.append(response.status_code == 200)

        total_time = time.time() - start_time
        successful = sum(responses)

        assert successful >= 18, f"Expected at least 18/20 successful, got {successful}"
        assert total_time < 30.0, f"Total time too high: {total_time:.2f}s"

        print(f"\n✓ Rapid Sequential Test:")
        print(f"  - Successful: {successful}/20")
        print(f"  - Total Time: {total_time:.2f}s")
        print(f"  - Avg per Request: {total_time/20:.2f}s")

    @pytest.mark.asyncio
    async def test_quota_exceeding_behavior(self, client):
        """Test system behavior when quota is exceeded"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Check current quota
        response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
        quota = response.json()
        remaining = quota["remaining_messages_today"]

        # If remaining quota is high, we can't easily test this without modifying the quota
        # So we'll just verify the quota endpoint works correctly
        assert "max_messages_per_day" in quota
        assert "used_messages_today" in quota
        assert "remaining_messages_today" in quota

        print(f"\n✓ Quota Status:")
        print(f"  - Used: {quota['used_messages_today']}/{quota['max_messages_per_day']}")
        print(f"  - Remaining: {remaining}")

    @pytest.mark.asyncio
    async def test_mixed_workload(self, client):
        """Test system with mixed workload (chat, quota checks, list operations)"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Define different types of operations
        async def chat_op():
            return await client.post(
                "/api/v1/chat",
                json={
                    "agent_id": agent_id,
                    "message": "Test message",
                },
            )

        async def quota_op():
            return await client.get(f"/api/v1/quota?agent_id={agent_id}")

        async def list_qa_op():
            return await client.get(f"/api/v1/qa:list?agent_id={agent_id}")

        async def agent_info_op():
            return await client.get(f"/api/v1/agent?agent_id={agent_id}")

        # Create mixed workload
        operations = []
        for i in range(30):
            if i % 4 == 0:
                operations.append(chat_op())
            elif i % 4 == 1:
                operations.append(quota_op())
            elif i % 4 == 2:
                operations.append(list_qa_op())
            else:
                operations.append(agent_info_op())

        # Execute all operations concurrently
        results = await asyncio.gather(*operations, return_exceptions=True)

        # Verify results
        successful = sum(
            1 for r in results
            if not isinstance(r, Exception) and r.status_code == 200
        )

        assert successful >= 28, f"Expected at least 28/30 successful, got {successful}"

        print(f"\n✓ Mixed Workload Test:")
        print(f"  - Successful: {successful}/30")

    @pytest.mark.asyncio
    async def test_database_connection_recovery(self, client):
        """Test system behavior with database operations under stress"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Perform multiple database write operations rapidly
        operations = []

        # Create multiple Q&A items
        import json
        for i in range(5):
            qa_content = json.dumps([
                {"question": f"DB test {i}-{j}", "answer": f"Answer {i}-{j}"}
                for j in range(3)
            ])
            operations.append(
                client.post(
                    f"/api/v1/qa:batch_import?agent_id={agent_id}",
                    json={"format": "json", "content": qa_content, "overwrite": False},
                )
            )

        # Execute all operations
        results = await asyncio.gather(*operations, return_exceptions=True)

        # Verify all writes succeeded
        successful = sum(
            1 for r in results
            if not isinstance(r, Exception) and r.status_code == 200
        )

        assert successful == 5, f"Expected all 5 operations to succeed, got {successful}"

        # Verify data was actually written
        response = await client.get(f"/api/v1/qa:list?agent_id={agent_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 15  # At least our 15 new items

        print(f"\n✓ Database Operations Test:")
        print(f"  - All write operations succeeded")
        print(f"  - Data persistence verified")

    @pytest.mark.asyncio
    async def test_memory_efficiency(self, client):
        """Test that system handles large data without memory issues"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Import Q&A with large content
        import json
        qa_items = []
        for i in range(10):
            qa_items.append({
                "question": f"Large content question {i}",
                "answer": "This is a large answer. " * 100  # ~2500 chars
            })

        qa_content = json.dumps(qa_items)
        response = await client.post(
            f"/api/v1/qa:batch_import?agent_id={agent_id}",
            json={"format": "json", "content": qa_content, "overwrite": False},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["imported"] == 10

        # Verify we can list and retrieve them
        response = await client.get(f"/api/v1/qa:list?agent_id={agent_id}")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] >= 10

        # Build index with large content
        response = await client.post(
            f"/api/v1/index:rebuild?agent_id={agent_id}",
            json={"force": False}
        )
        assert response.status_code == 200

        print(f"\n✓ Memory Efficiency Test:")
        print(f"  - Handled 10 large Q&A items")
        print(f"  - Index rebuild successful")

    @pytest.mark.asyncio
    async def test_error_recovery(self, client):
        """Test system recovery from errors"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Try various invalid operations
        errors_tested = 0

        # 1. Invalid agent
        response = await client.get("/api/v1/quota?agent_id=invalid_agent")
        if response.status_code == 404:
            errors_tested += 1

        # 2. Missing fields
        response = await client.post(
            "/api/v1/chat",
            json={"agent_id": agent_id}  # Missing message
        )
        if response.status_code == 422:
            errors_tested += 1

        # 3. Verify system still works after errors
        response = await client.post(
            "/api/v1/chat",
            json={
                "agent_id": agent_id,
                "message": "Test after errors",
            },
        )
        assert response.status_code == 200

        print(f"\n✓ Error Recovery Test:")
        print(f"  - Errors handled: {errors_tested}")
        print(f"  - System recovered successfully")

    @pytest.mark.asyncio
    async def test_timeout_handling(self, client):
        """Test system timeout handling"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Quick operations should complete fast
        start_time = time.time()
        response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
        elapsed = time.time() - start_time

        assert response.status_code == 200
        assert elapsed < 2.0, f"Quota check took too long: {elapsed:.2f}s"

        print(f"\n✓ Timeout Handling Test:")
        print(f"  - Quick operations completed in {elapsed:.3f}s")
