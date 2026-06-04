"""Tests proving Playground/chat retrieves from agent KB after URL/file indexing.

These tests verify that:
1. Chat endpoint includes KB context when agent has indexed content
2. Tenant mismatches return no KB context
3. The retrieved context is actually used in the system message
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from services.kb_retrieval_service import KbRetrievalService


@pytest.mark.asyncio
async def test_chat_calls_kb_retrieval_with_agent_threshold():
    """prepare_chat_request should call KbRetrievalService with agent's similarity_threshold."""
    from api.v1.endpoints import prepare_chat_request
    from api.v1.schemas import ChatRequest

    # Setup mock agent with kb_id and specific threshold
    mock_agent = MagicMock()
    mock_agent.id = "agent_123"
    mock_agent.workspace_id = "ws_123"
    mock_agent.kb_id = "kb_123"
    mock_agent.top_k = 5
    mock_agent.similarity_threshold = 0.03  # RRF-style threshold
    mock_agent.temperature = 0.7
    mock_agent.system_prompt = "You are a helpful assistant."
    mock_agent.enable_context = True
    mock_agent.api_key = "test_key"
    mock_agent.api_base = "https://api.test.com"
    mock_agent.model = "test-model"
    mock_agent.rate_limit_per_minute = 0
    mock_agent.restricted_reply = None

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = mock_agent
    mock_session.execute.return_value = mock_result

    # Mock quota check
    mock_quota = MagicMock()
    mock_quota.used_messages_today = 0
    mock_quota.max_messages_per_day = 100
    mock_quota.id = "quota_123"

    chat_request = ChatRequest(
        agent_id="agent_123",
        message="test query about unique content XYZ123TEST",
        session_id=None,
        params={},
    )

    mock_http_request = MagicMock()
    mock_http_request.headers.get.return_value = ""

    with patch("api.v1.endpoints.get_db") as mock_get_db:
        mock_get_db.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_get_db.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("api.v1.endpoints.check_quota", return_value=mock_quota):
            with patch("api.v1.endpoints.get_or_create_chat_session") as mock_session_fn:
                mock_chat_session = MagicMock()
                mock_chat_session.id = "session_123"
                mock_chat_session.status = "active"
                mock_session_fn.return_value = mock_chat_session

                with patch("api.v1.endpoints.KbRetrievalService") as mock_kb_svc_cls:
                    mock_kb_svc = MagicMock()
                    mock_kb_svc.retrieve = AsyncMock(return_value=[
                        {"text": "This contains XYZ123TEST unique phrase", "doc_id": "doc1", "chunk_index": 0, "score": 0.045, "filename": "test.txt"}
                    ])
                    mock_kb_svc_cls.return_value = mock_kb_svc

                    # Call prepare_chat_request
                    result = await prepare_chat_request(chat_request, mock_http_request, mock_session)

                    # Verify KbRetrievalService.retrieve was called with agent's threshold
                    mock_kb_svc.retrieve.assert_called_once()
                    call_kwargs = mock_kb_svc.retrieve.call_args[1]
                    assert call_kwargs["agent_id"] == "agent_123"
                    assert call_kwargs["top_k"] == 5
                    assert call_kwargs["threshold"] == 0.03


@pytest.mark.asyncio
async def test_chat_system_message_includes_kb_context():
    """System message should include KB context when retrieval returns results."""
    from api.v1.endpoints import prepare_chat_request
    from api.v1.schemas import ChatRequest

    mock_agent = MagicMock()
    mock_agent.id = "agent_123"
    mock_agent.workspace_id = "ws_123"
    mock_agent.kb_id = "kb_123"
    mock_agent.top_k = 5
    mock_agent.similarity_threshold = 0.05
    mock_agent.temperature = 0.7
    mock_agent.system_prompt = "You are a helpful assistant."
    mock_agent.enable_context = False  # Disable context to simplify
    mock_agent.api_key = "test_key"
    mock_agent.api_base = "https://api.test.com"
    mock_agent.model = "test-model"
    mock_agent.rate_limit_per_minute = 0
    mock_agent.restricted_reply = None

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = mock_agent
    mock_session.execute.return_value = mock_result

    mock_quota = MagicMock()
    mock_quota.used_messages_today = 0
    mock_quota.max_messages_per_day = 100
    mock_quota.id = "quota_123"

    chat_request = ChatRequest(
        agent_id="agent_123",
        message="what is the unique information?",
        session_id=None,
        params={},
    )

    mock_http_request = MagicMock()
    mock_http_request.headers.get.return_value = ""

    with patch("api.v1.endpoints.get_db") as mock_get_db:
        mock_get_db.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_get_db.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("api.v1.endpoints.check_quota", return_value=mock_quota):
            with patch("api.v1.endpoints.get_or_create_chat_session") as mock_session_fn:
                mock_chat_session = MagicMock()
                mock_chat_session.id = "session_123"
                mock_chat_session.status = "active"
                mock_session_fn.return_value = mock_chat_session

                with patch("api.v1.endpoints.KbRetrievalService") as mock_kb_svc_cls:
                    mock_kb_svc = MagicMock()
                    # Return KB results with a unique phrase
                    mock_kb_svc.retrieve = AsyncMock(return_value=[
                        {"text": "The BasjooKB2024TEST answer is 42", "doc_id": "doc1", "chunk_index": 0, "score": 0.045, "filename": "knowledge.txt"}
                    ])
                    mock_kb_svc_cls.return_value = mock_kb_svc

                    result = await prepare_chat_request(chat_request, mock_http_request, mock_session)

                    # Verify system message contains KB context
                    messages = result.get("messages", [])
                    system_msg = next((m for m in messages if m.get("role") == "system"), None)
                    assert system_msg is not None
                    system_content = system_msg.get("content", "")

                    # Should contain the KB context marker
                    assert "背景资料" in system_content or "relevant information" in system_content.lower()
                    # Should contain the retrieved text
                    assert "BasjooKB2024TEST" in system_content


@pytest.mark.asyncio
async def test_chat_kb_retrieval_without_kb_id_returns_no_context():
    """Agent without kb_id should not trigger KB retrieval and system message should indicate no KB."""
    from api.v1.endpoints import prepare_chat_request
    from api.v1.schemas import ChatRequest

    mock_agent = MagicMock()
    mock_agent.id = "agent_no_kb"
    mock_agent.workspace_id = "ws_123"
    mock_agent.kb_id = None  # No KB bound
    mock_agent.top_k = 5
    mock_agent.similarity_threshold = 0.05
    mock_agent.temperature = 0.7
    mock_agent.system_prompt = "You are a helpful assistant."
    mock_agent.enable_context = False
    mock_agent.api_key = "test_key"
    mock_agent.api_base = "https://api.test.com"
    mock_agent.model = "test-model"
    mock_agent.rate_limit_per_minute = 0
    mock_agent.restricted_reply = None

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = mock_agent
    mock_session.execute.return_value = mock_result

    mock_quota = MagicMock()
    mock_quota.used_messages_today = 0
    mock_quota.max_messages_per_day = 100
    mock_quota.id = "quota_123"

    chat_request = ChatRequest(
        agent_id="agent_no_kb",
        message="test query",
        session_id=None,
        params={},
    )

    mock_http_request = MagicMock()
    mock_http_request.headers.get.return_value = ""

    kb_retrieval_called = False

    with patch("api.v1.endpoints.get_db") as mock_get_db:
        mock_get_db.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_get_db.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch("api.v1.endpoints.check_quota", return_value=mock_quota):
            with patch("api.v1.endpoints.get_or_create_chat_session") as mock_session_fn:
                mock_chat_session = MagicMock()
                mock_chat_session.id = "session_123"
                mock_chat_session.status = "active"
                mock_session_fn.return_value = mock_chat_session

                with patch("api.v1.endpoints.KbRetrievalService") as mock_kb_svc_cls:
                    mock_kb_svc = MagicMock()
                    mock_kb_svc.retrieve = AsyncMock(return_value=[])
                    mock_kb_svc_cls.return_value = mock_kb_svc

                    result = await prepare_chat_request(chat_request, mock_http_request, mock_session)

                    # KB retrieval should not be called when agent has no kb_id
                    # (based on current implementation: if getattr(agent, "kb_id", None): ...)
                    mock_kb_svc.retrieve.assert_not_called()

                    # System message should indicate no KB
                    messages = result.get("messages", [])
                    system_msg = next((m for m in messages if m.get("role") == "system"), None)
                    assert system_msg is not None
                    system_content = system_msg.get("content", "")
                    assert "No relevant information" in system_content or "no relevant information" in system_content.lower()


@pytest.mark.asyncio
async def test_kb_retrieval_service_tenant_mismatch_returns_empty():
    """KbRetrievalService returns empty when tenant doesn't match KB owner."""
    service = KbRetrievalService()

    # This is already tested in test_kb_retrieval.py, but verify at chat layer
    # by mocking the service behavior
    with patch("services.kb_retrieval_service.AsyncSessionLocal") as mock_session_cls:
        mock_session = AsyncMock()
        mock_result = MagicMock()

        mock_agent = MagicMock()
        mock_agent.id = "agent_123"
        mock_agent.kb_id = "kb_123"

        mock_kb = MagicMock()
        mock_kb.id = "kb_123"
        mock_kb.tenant_id = "tenant_a"  # Different from request

        mock_result.first.return_value = (mock_agent, mock_kb)
        mock_session.execute.return_value = mock_result
        mock_session_cls.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        results = await service.retrieve(
            tenant_id="tenant_b",  # Wrong tenant
            agent_id="agent_123",
            query="test",
            top_k=5,
        )

        assert results == []
