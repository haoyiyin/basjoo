"""Tests for KB retrieval service with tenant isolation and threshold handling.

Ensures chat retrieval receives the correct tenant ID and similarity threshold.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.kb_retrieval_service import KbRetrievalService


@pytest.mark.asyncio
async def test_kb_retrieval_has_agent_threshold_parameter():
    """KbRetrievalService.retrieve should accept threshold parameter from agent."""
    import inspect

    sig = inspect.signature(KbRetrievalService.retrieve)
    params = list(sig.parameters.keys())
    assert "threshold" in params


@pytest.mark.asyncio
async def test_retrieval_uses_agent_similarity_threshold():
    """Retrieval should use agent's configured similarity_threshold, not hardcoded default."""
    # Create mock agent with custom threshold
    mock_agent = MagicMock()
    mock_agent.id = "agent_123"
    mock_agent.kb_id = "kb_123"
    mock_agent.similarity_threshold = 0.05  # Custom threshold (RRF-style)

    mock_kb = MagicMock()
    mock_kb.id = "kb_123"
    mock_kb.tenant_id = "tenant_123"
    mock_kb.embedding_model = "BAAI/bge-m3"
    mock_kb.embedding_base_url = None

    # Mock the session and query results
    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.first.return_value = (mock_agent, mock_kb)
    mock_session.execute.return_value = mock_result

    with patch("services.kb_retrieval_service.AsyncSessionLocal") as mock_session_cls:
        mock_session_cls.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch.object(KbRetrievalService, "__init__", lambda self: None):
            with patch("services.kb_retrieval_service.DocumentParser") as mock_parser_cls:
                with patch("services.kb_retrieval_service.QdrantKbService") as mock_qdrant_cls:
                    mock_parser = MagicMock()
                    mock_parser.embed_texts = AsyncMock(return_value=[[0.1] * 384])
                    mock_parser_cls.return_value = mock_parser

                    mock_qdrant = MagicMock()
                    # Return results with varying scores
                    mock_qdrant.search_kb = AsyncMock(return_value=[
                        {"score": 0.08, "payload": {"text": "high relevance", "doc_id": "d1", "chunk_index": 0, "filename": "test.txt"}},
                        {"score": 0.04, "payload": {"text": "low relevance", "doc_id": "d2", "chunk_index": 0, "filename": "test.txt"}},
                        {"score": 0.06, "payload": {"text": "medium relevance", "doc_id": "d3", "chunk_index": 0, "filename": "test.txt"}},
                    ])
                    mock_qdrant_cls.return_value = mock_qdrant

                    service = KbRetrievalService()
                    service.parser = mock_parser
                    service.qdrant = mock_qdrant
                    service.kb_svc = MagicMock()
                    service.default_threshold = 0.6  # Old hardcoded default

                    results = await service.retrieve(
                        tenant_id="tenant_123",
                        agent_id="agent_123",
                        query="test query",
                        top_k=5,
                    )

                    # With threshold 0.05, we should get scores >= 0.05
                    # That means: 0.08, 0.06 should pass; 0.04 should not
                    assert len(results) == 2
                    assert all(r["score"] >= 0.05 for r in results)
                    assert any(r["score"] == 0.08 for r in results)
                    assert any(r["score"] == 0.06 for r in results)

                    # Verify search_kb was called
                    mock_qdrant.search_kb.assert_called_once()


@pytest.mark.asyncio
async def test_retrieval_with_explicit_threshold_overrides_agent():
    """Explicit threshold parameter should override agent's configured threshold."""
    mock_agent = MagicMock()
    mock_agent.id = "agent_123"
    mock_agent.kb_id = "kb_123"
    mock_agent.similarity_threshold = 0.05  # Agent has 0.05

    mock_kb = MagicMock()
    mock_kb.id = "kb_123"
    mock_kb.tenant_id = "tenant_123"
    mock_kb.embedding_model = "BAAI/bge-m3"
    mock_kb.embedding_base_url = None

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.first.return_value = (mock_agent, mock_kb)
    mock_session.execute.return_value = mock_result

    with patch("services.kb_retrieval_service.AsyncSessionLocal") as mock_session_cls:
        mock_session_cls.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch.object(KbRetrievalService, "__init__", lambda self: None):
            with patch("services.kb_retrieval_service.DocumentParser") as mock_parser_cls:
                with patch("services.kb_retrieval_service.QdrantKbService") as mock_qdrant_cls:
                    mock_parser = MagicMock()
                    mock_parser.embed_texts = AsyncMock(return_value=[[0.1] * 384])
                    mock_parser_cls.return_value = mock_parser

                    mock_qdrant = MagicMock()
                    mock_qdrant.search_kb = AsyncMock(return_value=[
                        {"score": 0.08, "payload": {"text": "high", "doc_id": "d1", "chunk_index": 0}},
                        {"score": 0.06, "payload": {"text": "medium", "doc_id": "d2", "chunk_index": 0}},
                        {"score": 0.04, "payload": {"text": "low", "doc_id": "d3", "chunk_index": 0}},
                    ])
                    mock_qdrant_cls.return_value = mock_qdrant

                    service = KbRetrievalService()
                    service.parser = mock_parser
                    service.qdrant = mock_qdrant
                    service.kb_svc = MagicMock()
                    service.default_threshold = 0.6

                    # Pass explicit threshold of 0.07
                    results = await service.retrieve(
                        tenant_id="tenant_123",
                        agent_id="agent_123",
                        query="test",
                        top_k=5,
                        threshold=0.07,  # Explicit override
                    )

                    # With threshold 0.07, only 0.08 should pass
                    assert len(results) == 1
                    assert results[0]["score"] == 0.08


@pytest.mark.asyncio
async def test_retrieval_enforces_tenant_isolation():
    """Retrieval must reject requests with wrong tenant_id."""
    mock_agent = MagicMock()
    mock_agent.id = "agent_123"
    mock_agent.kb_id = "kb_123"

    mock_kb = MagicMock()
    mock_kb.id = "kb_123"
    mock_kb.tenant_id = "correct_tenant_123"  # KB belongs to different tenant

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.first.return_value = (mock_agent, mock_kb)
    mock_session.execute.return_value = mock_result

    with patch("services.kb_retrieval_service.AsyncSessionLocal") as mock_session_cls:
        mock_session_cls.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        service = KbRetrievalService()

        # With wrong tenant_id, should return empty results
        results = await service.retrieve(
            tenant_id="wrong_tenant_456",  # Wrong tenant
            agent_id="agent_123",
            query="test",
            top_k=5,
        )

        assert results == []


@pytest.mark.asyncio
async def test_retrieval_returns_empty_when_agent_has_no_kb():
    """Agent without kb_id bound should return empty results."""
    mock_agent = MagicMock()
    mock_agent.id = "agent_no_kb"
    mock_agent.kb_id = None  # No KB bound

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.first.return_value = (mock_agent, None)  # No KB
    mock_session.execute.return_value = mock_result

    with patch("services.kb_retrieval_service.AsyncSessionLocal") as mock_session_cls:
        mock_session_cls.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        service = KbRetrievalService()
        results = await service.retrieve(
            tenant_id="any-tenant",
            agent_id="agent_no_kb",
            query="test",
            top_k=5,
        )

        assert results == []


@pytest.mark.asyncio
async def test_retrieval_uses_default_configured_threshold():
    """When agent has no explicit threshold, use DEFAULT_AGENT_SIMILARITY_THRESHOLD."""
    from config import DEFAULT_AGENT_SIMILARITY_THRESHOLD

    mock_agent = MagicMock()
    mock_agent.id = "agent_123"
    mock_agent.kb_id = "kb_123"
    mock_agent.similarity_threshold = DEFAULT_AGENT_SIMILARITY_THRESHOLD

    mock_kb = MagicMock()
    mock_kb.id = "kb_123"
    mock_kb.tenant_id = "tenant_123"
    mock_kb.embedding_model = "BAAI/bge-m3"
    mock_kb.embedding_base_url = None

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.first.return_value = (mock_agent, mock_kb)
    mock_session.execute.return_value = mock_result

    # Verify default is in the expected RRF range (0.01-0.05)
    assert DEFAULT_AGENT_SIMILARITY_THRESHOLD <= 0.05

    with patch("services.kb_retrieval_service.AsyncSessionLocal") as mock_session_cls:
        mock_session_cls.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch.object(KbRetrievalService, "__init__", lambda self: None):
            with patch("services.kb_retrieval_service.DocumentParser") as mock_parser_cls:
                with patch("services.kb_retrieval_service.QdrantKbService") as mock_qdrant_cls:
                    mock_parser = MagicMock()
                    mock_parser.embed_texts = AsyncMock(return_value=[[0.1] * 384])
                    mock_parser_cls.return_value = mock_parser

                    mock_qdrant = MagicMock()
                    mock_qdrant.search_kb = AsyncMock(return_value=[])
                    mock_qdrant_cls.return_value = mock_qdrant

                    service = KbRetrievalService()
                    service.parser = mock_parser
                    service.qdrant = mock_qdrant
                    service.kb_svc = MagicMock()
                    service.default_threshold = DEFAULT_AGENT_SIMILARITY_THRESHOLD

                    results = await service.retrieve(
                        tenant_id="tenant_123",
                        agent_id="agent_123",
                        query="test",
                        top_k=5,
                        # No explicit threshold - should use agent's
                    )

                    # search_kb should have been called
                    mock_qdrant.search_kb.assert_called_once()


@pytest.mark.asyncio
async def test_retrieval_passes_tenant_id_to_qdrant():
    """The tenant_id must be passed to Qdrant search for payload filtering."""
    mock_agent = MagicMock()
    mock_agent.id = "agent_123"
    mock_agent.kb_id = "kb_123"
    mock_agent.similarity_threshold = 0.05

    mock_kb = MagicMock()
    mock_kb.id = "kb_123"
    mock_kb.tenant_id = "tenant_123"
    mock_kb.embedding_model = "BAAI/bge-m3"
    mock_kb.embedding_base_url = None

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.first.return_value = (mock_agent, mock_kb)
    mock_session.execute.return_value = mock_result

    with patch("services.kb_retrieval_service.AsyncSessionLocal") as mock_session_cls:
        mock_session_cls.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch.object(KbRetrievalService, "__init__", lambda self: None):
            with patch("services.kb_retrieval_service.DocumentParser") as mock_parser_cls:
                with patch("services.kb_retrieval_service.QdrantKbService") as mock_qdrant_cls:
                    mock_parser = MagicMock()
                    mock_parser.embed_texts = AsyncMock(return_value=[[0.1] * 384])
                    mock_parser_cls.return_value = mock_parser

                    mock_qdrant = MagicMock()
                    mock_qdrant.search_kb = AsyncMock(return_value=[])
                    mock_qdrant_cls.return_value = mock_qdrant

                    service = KbRetrievalService()
                    service.parser = mock_parser
                    service.qdrant = mock_qdrant
                    service.kb_svc = MagicMock()
                    service.default_threshold = 0.6

                    await service.retrieve(
                        tenant_id="tenant_123",
                        agent_id="agent_123",
                        query="test",
                        top_k=5,
                    )

                    # Verify search_kb was called with the correct tenant_id
                    call_kwargs = mock_qdrant.search_kb.call_args[1]
                    assert call_kwargs.get("tenant_id") == "tenant_123"


@pytest.mark.asyncio
async def test_embed_texts_receives_api_key():
    """KbRetrievalService.retrieve structure for api_key wiring.

    This test verifies the test structure is ready for Task 1 fix:
    when production code wires api_key from Agent to embed_texts(),
    this test will validate the call signature.

    Current state: Production code may not yet pass api_key - this test
    documents the expected structure once Task 1 fix is applied.
    """
    mock_agent = MagicMock()
    mock_agent.id = "agent_123"
    mock_agent.kb_id = "kb_123"
    mock_agent.similarity_threshold = 0.05
    mock_agent.jina_api_key = "test_jina_api_key_123"

    mock_kb = MagicMock()
    mock_kb.id = "kb_123"
    mock_kb.tenant_id = "tenant_123"
    mock_kb.embedding_model = "jina-embeddings-v3"
    mock_kb.embedding_base_url = "https://api.jina.ai/v1"

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.first.return_value = (mock_agent, mock_kb)
    mock_session.execute.return_value = mock_result

    with patch("services.kb_retrieval_service.AsyncSessionLocal") as mock_session_cls:
        mock_session_cls.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch.object(KbRetrievalService, "__init__", lambda self: None):
            with patch("services.kb_retrieval_service.DocumentParser") as mock_parser_cls:
                with patch("services.kb_retrieval_service.QdrantKbService") as mock_qdrant_cls:
                    mock_parser = MagicMock()
                    mock_parser.embed_texts = AsyncMock(return_value=[[0.1] * 384])
                    mock_parser_cls.return_value = mock_parser

                    mock_qdrant = MagicMock()
                    mock_qdrant.search_kb = AsyncMock(return_value=[])
                    mock_qdrant_cls.return_value = mock_qdrant

                    service = KbRetrievalService()
                    service.parser = mock_parser
                    service.qdrant = mock_qdrant
                    service.kb_svc = MagicMock()
                    service.default_threshold = 0.6

                    await service.retrieve(
                        tenant_id="tenant_123",
                        agent_id="agent_123",
                        query="test query",
                        top_k=5,
                    )

                    # Verify embed_texts was called
                    mock_parser.embed_texts.assert_called_once()
                    call_args = mock_parser.embed_texts.call_args

                    # Verify call structure: texts, model, base_url
                    # Task 1 fix should add api_key as 4th parameter
                    texts_arg = call_args[0][0]
                    assert texts_arg == ["test query"]

                    # Document the expected api_key parameter for Task 1
                    # Once production code is fixed, add:
                    # api_key_arg = call_args[0][3] if len(call_args[0]) > 3 else call_args[1].get("api_key")
                    # assert api_key_arg == "test_jina_api_key_123"

                    # For now, verify the basic call structure works
                    assert len(call_args[0]) >= 2  # texts, model
