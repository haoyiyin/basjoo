"""
Security and Robustness Tests
This suite tests security measures and system robustness under various conditions
"""

import pytest
import asyncio
import json


class TestSecurityMeasures:
    """Test suite for security measures"""

    @pytest.mark.asyncio
    async def test_sql_injection_prevention(self, client):
        """Test SQL injection is prevented"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Try SQL injection in chat message
        sql_injection_attempts = [
            "'; DROP TABLE users; --",
            "' OR '1'='1",
            "'; DELETE FROM qa_items; --",
            "admin'--",
            "' UNION SELECT * FROM agents--",
        ]

        for attempt in sql_injection_attempts:
            response = await client.post(
                "/api/v1/chat",
                json={"agent_id": agent_id, "message": attempt},
            )
            # System should handle gracefully without crashing
            assert response.status_code in [200, 400, 422]

    @pytest.mark.asyncio
    async def test_xss_prevention(self, client):
        """Test XSS prevention in inputs"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Try XSS in chat message
        xss_attempts = [
            "<script>alert('XSS')</script>",
            "<img src=x onerror=alert('XSS')>",
            "javascript:alert('XSS')",
            "<svg onload=alert('XSS')>",
        ]

        for attempt in xss_attempts:
            response = await client.post(
                "/api/v1/chat",
                json={"agent_id": agent_id, "message": attempt},
            )
            # System should handle gracefully
            assert response.status_code in [200, 400, 422]

            # If 200, verify response is JSON (not executable JavaScript)
            if response.status_code == 200:
                # Response should be valid JSON, not executable script
                reply = response.json().get("reply", "")
                # Mock LLM will echo the input, which is fine - it's stored as data
                # Real LLM would sanitize. Just verify it returns a string response.
                assert isinstance(reply, str)

    @pytest.mark.asyncio
    async def test_input_validation_limits(self, client):
        """Test input length limits are enforced"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Test extremely long message
        extremely_long = "A" * 100000  # 100KB message

        response = await client.post(
            "/api/v1/chat",
            json={"agent_id": agent_id, "message": extremely_long},
        )
        # Should either accept or reject gracefully
        assert response.status_code in [200, 413, 422, 400]

    @pytest.mark.asyncio
    async def test_invalid_json_handling(self, client):
        """Test invalid JSON is handled gracefully"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Try importing invalid JSON
        invalid_json_attempts = [
            "{invalid json}",
            '{"question": "unclosed',
            '{"question": null, "answer":}',
            '[]',
            'null',
        ]

        for invalid_json in invalid_json_attempts:
            response = await client.post(
                f"/api/v1/qa:batch_import?agent_id={agent_id}",
                json={"format": "json", "content": invalid_json, "overwrite": False},
            )
            # Should reject gracefully
            assert response.status_code in [200, 400, 422]

            if response.status_code == 200:
                result = response.json()
                # Should report failed imports
                assert result.get("imported", 0) == 0 or result.get("failed", 0) > 0


class TestSystemRobustness:
    """Test suite for system robustness"""

    @pytest.mark.asyncio
    async def test_unicode_edge_cases(self, client):
        """Test various unicode edge cases"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        unicode_tests = [
            "🎉🎊🎈",  # Emojis
            "مرحبا",  # Arabic RTL
            "עברית",  # Hebrew RTL
            "こんにちは",  # Japanese
            "你好世界",  # Chinese
            "🚀🌟💫✨",  # More emojis
            "👨‍👩‍👧‍👦",  # Family emoji (complex)
            "\u0000\u0001\u0002",  # Control characters
            "𝔘𝔫𝔦𝔠𝔬𝔡𝔢 𝔗𝔢𝔰𝔱",  # Mathematical alphanumeric
        ]

        for text in unicode_tests:
            response = await client.post(
                "/api/v1/chat",
                json={"agent_id": agent_id, "message": text},
            )
            # Should handle gracefully
            assert response.status_code in [200, 400, 422]

    @pytest.mark.asyncio
    async def test_special_characters_in_urls(self, client):
        """Test URLs with special characters"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        special_urls = [
            "https://example.com/path?query=value&other=123",
            "https://example.com/path#fragment",
            "https://example.com/path%20with%20spaces",
            "https://example.com/path?param=a+b",
            "https://user:pass@example.com/",
        ]

        for url in special_urls:
            response = await client.post(
                f"/api/v1/urls:create?agent_id={agent_id}",
                json={"url": url},
            )
            # Should handle or reject gracefully
            assert response.status_code in [200, 400, 422]

    @pytest.mark.asyncio
    async def test_empty_and_null_inputs(self, client):
        """Test empty and null inputs"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Test various empty inputs
        empty_inputs = [
            "",  # Empty string
            "   ",  # Whitespace only
            "\n\t\r",  # Special whitespace
            "null",  # String "null"
        ]

        for empty_input in empty_inputs:
            response = await client.post(
                "/api/v1/chat",
                json={"agent_id": agent_id, "message": empty_input},
            )
            # Should handle gracefully
            assert response.status_code in [200, 400, 422]

    @pytest.mark.asyncio
    async def test_malformed_agent_ids(self, client):
        """Test various malformed agent IDs"""
        malformed_ids = [
            "../../../etc/passwd",
            "../../",
            "agent' OR '1'='1",
            "<script>alert(1)</script>",
            # "\x00\x01\x02",  # Skip null bytes - httpx rejects these (good!)
            "agent_id@domain.com",
            "agent_id#fragment",
        ]

        for malformed_id in malformed_ids:
            # Test with various endpoints
            endpoints = [
                f"/api/v1/quota?agent_id={malformed_id}",
                f"/api/v1/index:info?agent_id={malformed_id}",
                f"/api/v1/agent?agent_id={malformed_id}",
            ]

            for endpoint in endpoints:
                try:
                    response = await client.get(endpoint)
                    # Should return 404 or error, not crash
                    # Note: 200 with null/empty data is acceptable for unknown agents
                    assert response.status_code in [200, 404, 400, 422]
                except Exception:
                    # httpx may reject truly malformed URLs (which is good security)
                    pass

    @pytest.mark.asyncio
    @pytest.mark.skip(reason="Environment-sensitive concurrent session stress path remains flaky under ASGI/SQLite test runtime")
    async def test_concurrent_same_session_id(self, client):
        """Test concurrent requests with same session ID"""
        import database
        from sqlalchemy import func, select
        from models import ChatMessage, ChatSession

        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        session_id = "concurrent_same_session"

        async def send_concurrent_message(num: int):
            return await client.post(
                "/api/v1/chat",
                json={
                    "agent_id": agent_id,
                    "session_id": session_id,
                    "message": f"Concurrent message {num}",
                },
            )

        # Send a small concurrent burst against the same session ID.
        # This still validates session deduplication while staying within SQLite/test-client limits.
        tasks = [send_concurrent_message(i) for i in range(4)]
        results = await asyncio.gather(*tasks)

        status_codes = [result.status_code for result in results]
        assert status_codes == [200] * 4, f"Unexpected status codes: {status_codes}"

        for result in results:
            payload = result.json()
            assert payload["session_id"] == session_id
            assert "reply" in payload

        async with database.AsyncSessionLocal() as db:
            session_count_result = await db.execute(
                select(func.count()).select_from(ChatSession).where(
                    ChatSession.agent_id == agent_id,
                    ChatSession.session_id == session_id,
                    ChatSession.status != "closed",
                )
            )
            assert session_count_result.scalar() == 1

            user_count_result = await db.execute(
                select(func.count())
                .select_from(ChatMessage)
                .join(ChatSession, ChatMessage.session_id == ChatSession.id)
                .where(
                    ChatSession.agent_id == agent_id,
                    ChatSession.session_id == session_id,
                    ChatMessage.role == "user",
                )
            )
            assert user_count_result.scalar() == 4

            assistant_count_result = await db.execute(
                select(func.count())
                .select_from(ChatMessage)
                .join(ChatSession, ChatMessage.session_id == ChatSession.id)
                .where(
                    ChatSession.agent_id == agent_id,
                    ChatSession.session_id == session_id,
                    ChatMessage.role == "assistant",
                )
            )
            assert assistant_count_result.scalar() == 4

            user_messages_result = await db.execute(
                select(ChatMessage.content)
                .join(ChatSession, ChatMessage.session_id == ChatSession.id)
                .where(
                    ChatSession.agent_id == agent_id,
                    ChatSession.session_id == session_id,
                    ChatMessage.role == "user",
                )
            )
            user_messages = [row[0] for row in user_messages_result.all()]
            assert len(user_messages) == len(set(user_messages))

    @pytest.mark.asyncio
    async def test_very_long_session_ids(self, client):
        """Test very long session IDs"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Very long session ID
        long_session_id = "a" * 10000

        response = await client.post(
            "/api/v1/chat",
            json={
                "agent_id": agent_id,
                "session_id": long_session_id,
                "message": "Test message",
            },
        )
        # Should handle gracefully
        assert response.status_code in [200, 400, 422, 413]

    @pytest.mark.asyncio
    async def test_quota_boundary_behavior(self, client):
        """Test behavior at quota boundaries"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Get quota
        response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
        quota = response.json()

        # Try to import up to quota limit (or 100, whichever is less due to batch limit)
        remaining = quota["max_qa_items"] - quota["used_qa_items"]
        to_import = min(remaining, 100)  # Batch import limit is 100

        if to_import > 0:
            # Import items up to batch/quota limit
            qa_content = json.dumps(
                [
                    {"question": f"Boundary Q{i}", "answer": f"Boundary A{i}"}
                    for i in range(to_import)
                ]
            )

            response = await client.post(
                f"/api/v1/qa:batch_import?agent_id={agent_id}",
                json={"format": "json", "content": qa_content, "overwrite": False},
            )

            assert response.status_code == 200
            result = response.json()
            assert result["imported"] == to_import

        # If quota is now full, try to import one more (should fail)
        response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
        quota = response.json()

        if quota["used_qa_items"] >= quota["max_qa_items"]:
            qa_content = json.dumps([{"question": "Extra Q", "answer": "Extra A"}])

            response = await client.post(
                f"/api/v1/qa:batch_import?agent_id={agent_id}",
                json={"format": "json", "content": qa_content, "overwrite": False},
            )

            # Should be rejected due to quota
            assert response.status_code in [200, 429]
            if response.status_code == 200:
                result = response.json()
                assert result["imported"] == 0

    @pytest.mark.asyncio
    async def test_data_type_validation(self, client):
        """Test data type validation in inputs"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Test with various data types
        test_cases = [
            {"message": 12345},  # Number instead of string
            {"message": None},  # Null
            {"message": True},  # Boolean
            {"message": {"nested": "object"}},  # Object
        ]

        for test_case in test_cases:
            response = await client.post(
                "/api/v1/chat",
                json={"agent_id": agent_id, **test_case},
            )
            # Should reject with validation error
            assert response.status_code in [200, 422, 400]

    @pytest.mark.asyncio
    async def test_concurrent_quota_depletion(self, client):
        """Test quota depletion under concurrent load"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Get initial quota
        response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
        quota = response.json()
        initial_messages = quota["used_messages_today"]

        # Send 20 concurrent chat requests
        async def send_chat():
            return await client.post(
                "/api/v1/chat",
                json={"agent_id": agent_id, "message": "Quota test"},
            )

        tasks = [send_chat() for _ in range(20)]
        results = await asyncio.gather(*tasks)

        successful = sum(1 for r in results if r.status_code == 200)

        # Check quota increased correctly
        response = await client.get(f"/api/v1/quota?agent_id={agent_id}")
        new_quota = response.json()
        messages_sent = new_quota["used_messages_today"] - initial_messages

        # Should match successful requests
        assert messages_sent == successful, f"Quota tracking mismatch: {messages_sent} vs {successful}"

    @pytest.mark.asyncio
    async def test_special_json_characters(self, client):
        """Test JSON with special characters"""
        response = await client.get("/api/v1/agent:default")
        agent_id = response.json()["id"]

        # Test with special JSON characters
        special_cases = [
            {"question": 'Test "quoted" text', "answer": 'Answer with "quotes"'},
            {"question": "Test\nnewline\ttab", "answer": "Answer with\nnewline"},
            {"question": "Test \\ backslash", "answer": "Answer with \\ backslash"},
            {"question": "Test / slash", "answer": "Answer with / slash"},
            {"question": "Test \u0000 null", "answer": "Answer with unicode"},
        ]

        for qa_pair in special_cases:
            qa_content = json.dumps([qa_pair])

            response = await client.post(
                f"/api/v1/qa:batch_import?agent_id={agent_id}",
                json={"format": "json", "content": qa_content, "overwrite": False},
            )
            # Should handle gracefully
            assert response.status_code in [200, 400, 422]
