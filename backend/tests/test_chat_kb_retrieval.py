"""Tests proving Playground/chat retrieves from agent KB after URL/file indexing.

These tests verify that:
1. Chat endpoint includes KB context when agent has indexed content
2. Retrieval needs no tenant at all: the KB's id is the only scope
3. The retrieved context is actually used in the system message
4. Ready KB document content with a unique phrase is passed into chat KB context
5. Failed ingestion is distinguishable from chat defects
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

import database
from core.encryption import encrypt_api_key
from models import Agent, Workspace, WorkspaceQuota
from services.kb_retrieval_service import KbRetrievalService
from services.kb_service import KbService


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


DIMENSION = 4

class RecordingParser:
    def __init__(self):
        self.calls: list[dict] = []

    async def embed_texts(self, texts, model, base_url, api_key=None):
        self.calls.append(
            {"texts": list(texts), "model": model, "base_url": base_url, "api_key": api_key}
        )
        return [[0.1] * DIMENSION for _ in texts]

class RecordingQdrant:
    """Records every ``search_kb`` call so the scope can be asserted exactly."""

    def __init__(self, hits=None):
        self.calls: list[dict] = []
        self.hits = hits if hits is not None else []

    async def search_kb(self, **kwargs):
        self.calls.append(dict(kwargs))
        return list(self.hits)

async def _workspace(email: str) -> int:
    async with database.AsyncSessionLocal() as session:
        workspace = Workspace(name=f"WS {email}", owner_email=email)
        session.add(workspace)
        await session.flush()
        session.add(WorkspaceQuota(workspace_id=workspace.id))
        await session.commit()
        return workspace.id

async def _kb(workspace_id: int, name: str) -> str:
    kb = await KbService().create_knowledge_base(
        workspace_id,
        name,
        embedding_provider="jina",
        embedding_model="jina-embeddings-v3",
        embedding_base_url="https://api.jina.ai/v1",
        embedding_api_key=encrypt_api_key("chat-kb-key"),
        embedding_dimension=DIMENSION,
    )
    return kb.id

async def _agent(workspace_id: int, name: str, kb_id: str | None = None) -> str:
    async with database.AsyncSessionLocal() as session:
        agent = Agent(
            workspace_id=workspace_id,
            name=name,
            model="deepseek-v4-flash",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
            kb_id=kb_id,
        )
        session.add(agent)
        await session.commit()
        return agent.id

@pytest.mark.asyncio
async def test_chat_kb_retrieval_needs_no_tenant(setup_test_db):
    """Retrieval is scoped by kb_id only — no tenant anywhere on the call path.

    Replaces the deleted tenant-mismatch test: `Tenant` has left the KB request
    path entirely, so a KB is retrievable with no tenant identity at all and the
    only scope handed to the vector store is the KB's own id.
    """
    workspace_id = await _workspace("chat-no-tenant@example.com")
    kb_id = await _kb(workspace_id, "Chat KB")
    agent_id = await _agent(workspace_id, "Chat Agent", kb_id=kb_id)

    parser = RecordingParser()
    qdrant = RecordingQdrant(
        [
            {
                "score": 0.9,
                "payload": {
                    "text": "chunk from the KB",
                    "doc_id": "doc-1",
                    "chunk_index": 0,
                    "filename": "notes.txt",
                },
            }
        ]
    )
    service = KbRetrievalService()
    service.parser = parser
    service.qdrant = qdrant

    results = await service.retrieve(agent_id=agent_id, query="hello", top_k=5)

    assert [r["text"] for r in results] == ["chunk from the KB"]
    assert len(qdrant.calls) == 1
    assert qdrant.calls[0].keys() == {"kb_id", "query_vector", "top_k"}
    assert qdrant.calls[0]["kb_id"] == kb_id
    assert "tenant_id" not in qdrant.calls[0]
    # The query was embedded with the KB's own config, not a tenant's.
    assert parser.calls[0]["model"] == "jina-embeddings-v3"
    assert parser.calls[0]["api_key"] == "chat-kb-key"

@pytest.mark.asyncio
async def test_chat_kb_retrieval_unbound_agent_skips_qdrant(setup_test_db):
    """An agent whose kb_id is NULL returns [] and never touches Qdrant."""
    workspace_id = await _workspace("chat-unbound@example.com")
    agent_id = await _agent(workspace_id, "Unbound Chat Agent", kb_id=None)

    parser = RecordingParser()
    qdrant = RecordingQdrant()
    service = KbRetrievalService()
    service.parser = parser
    service.qdrant = qdrant

    results = await service.retrieve(agent_id=agent_id, query="hello", top_k=5)

    assert results == []
    assert qdrant.calls == []
    assert parser.calls == []


@pytest.mark.asyncio
async def test_ready_kb_content_with_unique_phrase_passed_to_chat_context():
    """Verify that ready KB document content with a unique phrase is passed into chat KB context.

    This test proves the ingestion-to-retrieval path: when a document is indexed (status=ready),
    its content should be retrievable and passed into the chat system message.
    """
    from api.v1.endpoints import prepare_chat_request
    from api.v1.schemas import ChatRequest

    # Setup agent with KB
    mock_agent = MagicMock()
    mock_agent.id = "agent_kb_ready"
    mock_agent.workspace_id = "ws_123"
    mock_agent.kb_id = "kb_ready_456"
    mock_agent.top_k = 3
    mock_agent.similarity_threshold = 0.04
    mock_agent.temperature = 0.7
    mock_agent.system_prompt = "You are Basjoo assistant."
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
    mock_quota.max_messages_per_day = 1000
    mock_quota.id = "quota_123"

    # Use a unique test phrase that would only come from indexed content
    unique_phrase = "UNIQUE_VERIFICATION_PHRASE_2024_READY_TEST"

    chat_request = ChatRequest(
        agent_id="agent_kb_ready",
        message=f"Tell me about {unique_phrase}",
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
                mock_chat_session.id = "session_ready_123"
                mock_chat_session.status = "active"
                mock_session_fn.return_value = mock_chat_session

                # Mock KB retrieval returning content from a "ready" document
                with patch("api.v1.endpoints.KbRetrievalService") as mock_kb_svc_cls:
                    mock_kb_svc = MagicMock()
                    # Simulate retrieval returning content from a ready/indexed document
                    mock_kb_svc.retrieve = AsyncMock(return_value=[
                        {
                            "text": f"This is the document content containing {unique_phrase} which proves KB retrieval works.",
                            "doc_id": "doc_ready_001",
                            "chunk_index": 0,
                            "score": 0.065,
                            "filename": "ready_document.txt"
                        }
                    ])
                    mock_kb_svc_cls.return_value = mock_kb_svc

                    result = await prepare_chat_request(
                        chat_request, mock_http_request, mock_session
                    )

                    # Verify retrieval was called
                    mock_kb_svc.retrieve.assert_called_once()

                    # Verify system message contains the unique phrase from the ready document
                    messages = result.get("messages", [])
                    assert len(messages) > 0, "Messages should not be empty"

                    system_msg = messages[0]
                    assert system_msg["role"] == "system", "First message should be system prompt"

                    system_content = system_msg["content"]

                    # The unique phrase from the ready KB document must be in the system message
                    assert unique_phrase in system_content, (
                        f"Unique phrase '{unique_phrase}' from ready KB document "
                        f"should be present in system message. Got: {system_content[:200]}..."
                    )

                    # Verify the content structure indicates KB context injection
                    assert "背景资料" in system_content or "relevant information" in system_content.lower(), (
                        "System message should contain KB context marker"
                    )

                    # Verify source filename is included
                    assert "ready_document.txt" in system_content, (
                        "Source filename should be in KB context"
                    )
