"""Integration test: chat endpoint retrieves from KB after content indexing.

This test validates the full flow:
1. Agent has kb_id bound
2. KB has documents indexed in Qdrant
3. Chat query retrieves relevant content
4. Response includes KB-grounded context

Since the KB-decoupling change the scope of a retrieval is the KB id alone: there
is no `tenant_id` argument on `KbRetrievalService.retrieve` and no tenant column in
the Qdrant payload. The tests below pin that: the retrieval seam is checked by
recording `QdrantKbService.search_kb`, and the chat seam by inspecting what the
endpoint passes to `KbRetrievalService.retrieve`.
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

import database
from models import Agent, KbDocument, Workspace, WorkspaceQuota
from core.encryption import encrypt_api_key
from services.kb_retrieval_service import KbRetrievalService
from services.kb_service import KbService

DIMENSION = 4

def _agent_mock(agent_id: str, kb_id: str | None, threshold: float = 0.04) -> MagicMock:
    agent = MagicMock()
    agent.id = agent_id
    agent.workspace_id = "ws_123"
    agent.kb_id = kb_id
    agent.top_k = 3
    agent.similarity_threshold = threshold
    agent.temperature = 0.7
    agent.system_prompt = "You are Basjoo assistant."
    agent.enable_context = False  # Disable history for simpler tests
    agent.api_key = "test_key"
    agent.api_base = "https://api.test.com"
    agent.model = "test-model"
    agent.rate_limit_per_minute = 0
    agent.restricted_reply = None
    return agent

def _patched_chat_deps(agent: MagicMock):
    """Patch the chat endpoint's db/quota/session seams around *agent*."""
    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.scalar_one_or_none.return_value = agent
    mock_session.execute.return_value = mock_result

    mock_quota = MagicMock()
    mock_quota.used_messages_today = 0
    mock_quota.max_messages_per_day = 1000
    mock_quota.id = "quota_123"

    mock_chat_session = MagicMock()
    mock_chat_session.id = "session_123"
    mock_chat_session.status = "active"

    mock_get_db = patch("api.v1.endpoints.get_db")
    mock_check_quota = patch("api.v1.endpoints.check_quota", return_value=mock_quota)
    mock_session_fn = patch("api.v1.endpoints.get_or_create_chat_session")

    return mock_session, mock_get_db, mock_check_quota, mock_session_fn, mock_chat_session

@pytest.mark.asyncio
async def test_playground_chat_uses_kb_context_after_indexing():
    """E2E-style test: After KB documents are indexed, chat uses the content.

    This test mocks the Qdrant layer to simulate indexed content without
    needing actual embedding/Qdrant infrastructure.
    """
    from api.v1.endpoints import prepare_chat_request
    from api.v1.schemas import ChatRequest

    mock_agent = _agent_mock("agent_with_kb", "kb_456")

    chat_request = ChatRequest(
        agent_id="agent_with_kb",
        message="What is the BasjooPlaygroundTestPhrase?",
        session_id=None,
        params={},
    )

    mock_http_request = MagicMock()
    mock_http_request.headers.get.return_value = ""

    mock_session, get_db_p, quota_p, session_p, chat_session = _patched_chat_deps(
        mock_agent
    )

    with get_db_p as mock_get_db:
        mock_get_db.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_get_db.return_value.__aexit__ = AsyncMock(return_value=False)
        with quota_p, session_p as mock_session_fn:
            mock_session_fn.return_value = chat_session
            with patch("api.v1.endpoints.KbRetrievalService") as mock_kb_svc_cls:
                mock_kb_svc = MagicMock()
                # Simulate retrieval returning content from an indexed document
                mock_kb_svc.retrieve = AsyncMock(
                    return_value=[
                        {
                            "text": "The BasjooPlaygroundTestPhrase is 'knowledge-verified-2024' and proves KB retrieval works.",
                            "doc_id": "doc_indexed_001",
                            "chunk_index": 0,
                            "score": 0.042,
                            "filename": "verified_knowledge.txt",
                        }
                    ]
                )
                mock_kb_svc_cls.return_value = mock_kb_svc

                result = await prepare_chat_request(
                    chat_request, mock_http_request, mock_session
                )

                # Verify the retrieval was called with correct parameters
                mock_kb_svc.retrieve.assert_called_once()
                call_args = mock_kb_svc.retrieve.call_args[1]
                assert call_args["agent_id"] == "agent_with_kb"
                assert call_args["top_k"] == 3
                assert call_args["threshold"] == 0.04
                # The KB id is the whole scope: no tenant is threaded through.
                assert "tenant_id" not in call_args
                assert set(call_args) == {"agent_id", "query", "top_k", "threshold"}

                # Verify system message includes KB context
                messages = result.get("messages", [])
                assert len(messages) > 0
                system_msg = messages[0]
                assert system_msg["role"] == "system"
                system_content = system_msg["content"]

                # The unique test phrase should be in the system message
                assert "BasjooPlaygroundTestPhrase" in system_content
                assert "knowledge-verified-2024" in system_content
                assert "background" in system_content.lower() or "背景" in system_content

class RecordingParser:
    def __init__(self):
        self.calls: list[dict] = []

    async def embed_texts(self, texts, model, base_url, api_key=None):
        self.calls.append(
            {
                "texts": list(texts),
                "model": model,
                "base_url": base_url,
                "api_key": api_key,
            }
        )
        return [[0.1] * DIMENSION for _ in texts]

class RecordingQdrant:
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
        embedding_api_key=encrypt_api_key("integration-key"),
        embedding_dimension=DIMENSION,
    )
    return kb.id

async def _agent(
    workspace_id: int, name: str, kb_id: str | None = None, threshold: float | None = None
) -> str:
    async with database.AsyncSessionLocal() as session:
        agent = Agent(
            workspace_id=workspace_id,
            name=name,
            model="deepseek-v4-flash",
            api_base="https://api.deepseek.com/v1",
            provider_type="deepseek",
            similarity_threshold=threshold,
            kb_id=kb_id,
        )
        session.add(agent)
        await session.commit()
        return agent.id

@pytest.mark.asyncio
async def test_chat_kb_context_needs_no_tenant(setup_test_db):
    """Retrieval reaches the right KB with no tenant identity anywhere.

    Replaces `test_chat_kb_context_with_tenant_isolation`, which pinned the
    deleted contract: it asserted a retrieve(tenant_id="tenant_b") call against a
    KB owned by "tenant_a" returned [], and that the same call with the matching
    tenant succeeded. Both halves are now meaningless — `tenant_id` is not a
    parameter any more. What still matters is that a KB is reachable purely by
    the agent's binding, and that the vector store is asked for that KB and no
    other scope.
    """
    workspace_id = await _workspace("chat-integration@example.com")
    kb_id = await _kb(workspace_id, "Integration KB")
    agent_id = await _agent(workspace_id, "Integration Agent", kb_id=kb_id)

    parser = RecordingParser()
    qdrant = RecordingQdrant(
        [
            {
                "score": 0.055,
                "payload": {
                    "text": "result",
                    "doc_id": "d1",
                    "chunk_index": 0,
                    "filename": "notes.txt",
                },
            }
        ]
    )
    service = KbRetrievalService()
    service.parser = parser
    service.qdrant = qdrant

    results = await service.retrieve(agent_id=agent_id, query="test", top_k=5)

    assert len(results) == 1
    assert results[0]["doc_id"] == "d1"
    assert [call["kb_id"] for call in qdrant.calls] == [kb_id]
    assert all("tenant_id" not in call for call in qdrant.calls)

@pytest.mark.asyncio
async def test_chat_threshold_filtering_uses_agent_config(setup_test_db):
    """Similarity threshold from agent config should filter results appropriately.

    With RRF-style scores (0.01-0.05 range), a threshold of 0.6 would filter everything.
    This test ensures agent threshold (e.g., 0.03) is used instead of hardcoded 0.6.
    """
    workspace_id = await _workspace("chat-threshold@example.com")
    kb_id = await _kb(workspace_id, "Threshold KB")
    agent_id = await _agent(
        workspace_id, "Threshold Agent", kb_id=kb_id, threshold=0.03
    )

    qdrant = RecordingQdrant(
        [
            {
                "score": 0.045,
                "payload": {"text": "high relevance", "doc_id": "d1", "chunk_index": 0},
            },
            {
                "score": 0.035,
                "payload": {"text": "medium relevance", "doc_id": "d2", "chunk_index": 0},
            },
            {
                "score": 0.025,
                "payload": {"text": "low relevance", "doc_id": "d3", "chunk_index": 0},
            },
            {
                "score": 0.015,
                "payload": {"text": "very low", "doc_id": "d4", "chunk_index": 0},
            },
        ]
    )
    service = KbRetrievalService()
    service.parser = RecordingParser()
    service.qdrant = qdrant

    results = await service.retrieve(agent_id=agent_id, query="test", top_k=5)

    # With threshold 0.03, should get 0.045, 0.035 (2 results)
    assert len(results) == 2
    scores = [r["score"] for r in results]
    assert all(s >= 0.03 for s in scores)

@pytest.mark.asyncio
async def test_kb_ingestion_to_retrieval_regression_path():
    """Verify the full ingestion-to-retrieval regression path is intact.

    This test proves that:
    1. Ready KB document content with a unique phrase is passed into chat KB context
    2. Failed ingestion is distinguishable from chat defects (no context injected for failed docs)
    3. Playground query proves the retrieval path was used by checking response content
    """
    from api.v1.endpoints import prepare_chat_request
    from api.v1.schemas import ChatRequest

    # Use a unique phrase that would only appear from successfully indexed content
    unique_test_phrase = "KB_INGESTION_VERIFICATION_2024_UNIQUE_PHRASE"

    mock_agent = _agent_mock("agent_ingestion_regression", "kb_regression_789", 0.04)
    mock_agent.top_k = 5

    # Query that would require knowledge from the KB
    chat_request = ChatRequest(
        agent_id="agent_ingestion_regression",
        message=f"What is the {unique_test_phrase}?",
        session_id=None,
        params={},
    )

    mock_http_request = MagicMock()
    mock_http_request.headers.get.return_value = ""

    mock_session, get_db_p, quota_p, session_p, chat_session = _patched_chat_deps(
        mock_agent
    )

    with get_db_p as mock_get_db:
        mock_get_db.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_get_db.return_value.__aexit__ = AsyncMock(return_value=False)
        with quota_p, session_p as mock_session_fn:
            mock_session_fn.return_value = chat_session
            # Simulate KB retrieval returning content from a "ready" indexed document
            with patch("api.v1.endpoints.KbRetrievalService") as mock_kb_svc_cls:
                mock_kb_svc = MagicMock()
                mock_kb_svc.retrieve = AsyncMock(
                    return_value=[
                        {
                            "text": f"The {unique_test_phrase} is 'verification_successful' and proves the KB retrieval pipeline is working correctly.",
                            "doc_id": "doc_ready_789",
                            "chunk_index": 0,
                            "score": 0.065,
                            "filename": "indexed_document.txt",
                        }
                    ]
                )
                mock_kb_svc_cls.return_value = mock_kb_svc

                result = await prepare_chat_request(
                    chat_request, mock_http_request, mock_session
                )

                # Verify the retrieval was called with correct parameters
                mock_kb_svc.retrieve.assert_called_once()
                call_args = mock_kb_svc.retrieve.call_args[1]
                assert call_args["agent_id"] == "agent_ingestion_regression"
                # The scope is the KB binding; no tenant is threaded through.
                assert "tenant_id" not in call_args
                assert call_args["threshold"] == 0.04

                # Verify system message includes KB context
                messages = result.get("messages", [])
                assert len(messages) > 0

                system_msg = messages[0]
                assert system_msg["role"] == "system"
                system_content = system_msg["content"]

                # KEY ASSERTION: The unique test phrase from the ready document
                # must be present in the system message, proving the retrieval
                # path was used and the content was injected
                assert unique_test_phrase in system_content, (
                    f"CRITICAL: Unique test phrase '{unique_test_phrase}' from ready KB "
                    f"document is NOT in system message. This indicates the ingestion-to-"
                    f"retrieval path is BROKEN. System content: {system_content[:300]}..."
                )

                # Verify the content includes KB context markers
                assert "背景资料" in system_content or "background" in system_content.lower(), (
                    "System message should contain KB context marker (背景资料 or background)"
                )

                # Verify source metadata is preserved
                assert "indexed_document.txt" in system_content, (
                    "Source filename should be preserved in KB context"
                )

@pytest.mark.asyncio
async def test_chat_context_ignores_a_document_that_failed_ingestion():
    """A document that failed ingestion contributes no context.

    Pins the second half of the old regression test: with nothing ready in the KB
    (the failed document never produced vectors), the retrieval seam returns [] and
    the system message says so instead of inventing content.
    """
    from api.v1.endpoints import prepare_chat_request
    from api.v1.schemas import ChatRequest

    mock_agent = _agent_mock("agent_failed_ingestion", "kb_failed_789", 0.04)

    chat_request = ChatRequest(
        agent_id="agent_failed_ingestion",
        message="What does the failed document say?",
        session_id=None,
        params={},
    )

    mock_http_request = MagicMock()
    mock_http_request.headers.get.return_value = ""

    mock_session, get_db_p, quota_p, session_p, chat_session = _patched_chat_deps(
        mock_agent
    )

    with get_db_p as mock_get_db:
        mock_get_db.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_get_db.return_value.__aexit__ = AsyncMock(return_value=False)
        with quota_p, session_p as mock_session_fn:
            mock_session_fn.return_value = chat_session
            with patch("api.v1.endpoints.KbRetrievalService") as mock_kb_svc_cls:
                mock_kb_svc = MagicMock()
                mock_kb_svc.retrieve = AsyncMock(return_value=[])
                mock_kb_svc_cls.return_value = mock_kb_svc

                result = await prepare_chat_request(
                    chat_request, mock_http_request, mock_session
                )

                mock_kb_svc.retrieve.assert_called_once()
                system_content = result["messages"][0]["content"]
                assert (
                    "No relevant information" in system_content
                    or "no relevant information" in system_content.lower()
                )
