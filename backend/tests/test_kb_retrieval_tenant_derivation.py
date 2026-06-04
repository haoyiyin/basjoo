"""Tests for KB retrieval tenant derivation.

Ensures KbRetrievalService.retrieve handles tenant_id=None by deriving it from
the KB's tenant, while still rejecting explicit wrong tenant IDs.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.kb_retrieval_service import KbRetrievalService


@pytest.mark.asyncio
async def test_retrieval_with_tenant_id_none_derives_from_kb():
    """Retrieve with tenant_id=None should derive effective tenant from KB.

    This is the core bug: chat calls retrieval with tenant_id=None, but the
    current code compares kb.tenant_id != tenant_id (None) before deriving,
    causing the retrieval to fail even for valid KBs.

    Expected behavior: when tenant_id is None, load KB first, then use
    kb.tenant_id as the effective tenant for isolation checks.
    """
    # Create mock agent with KB bound
    mock_agent = MagicMock()
    mock_agent.id = "agent_123"
    mock_agent.kb_id = "kb_123"
    mock_agent.similarity_threshold = 0.05

    # Create mock KB with specific tenant
    mock_kb = MagicMock()
    mock_kb.id = "kb_123"
    mock_kb.tenant_id = "correct_tenant_456"  # This is the KB's actual tenant
    mock_kb.embedding_model = "BAAI/bge-m3"
    mock_kb.embedding_base_url = None

    # Mock session and query results
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
                    # Return valid results
                    mock_qdrant.search_kb = AsyncMock(return_value=[
                        {"score": 0.08, "payload": {"text": "relevant", "doc_id": "d1", "chunk_index": 0, "filename": "test.txt"}},
                    ])
                    mock_qdrant_cls.return_value = mock_qdrant

                    service = KbRetrievalService()
                    service.parser = mock_parser
                    service.qdrant = mock_qdrant
                    service.kb_svc = MagicMock()
                    service.default_threshold = 0.6

                    # Call retrieve with tenant_id=None (chat path)
                    results = await service.retrieve(
                        tenant_id=None,  # Key: caller doesn't know the tenant
                        agent_id="agent_123",
                        query="test query",
                        top_k=5,
                    )

                    # Should NOT return empty results - should succeed
                    assert len(results) > 0, (
                        "retrieve with tenant_id=None should derive tenant from KB "
                        "and return results, not empty list"
                    )

                    # Verify search_kb was called with the correct derived tenant
                    call_kwargs = mock_qdrant.search_kb.call_args[1]
                    assert call_kwargs.get("tenant_id") == "correct_tenant_456", (
                        f"search_kb should be called with KB's tenant_id, "
                        f"got {call_kwargs.get('tenant_id')}"
                    )


@pytest.mark.asyncio
async def test_retrieval_with_explicit_wrong_tenant_rejects():
    """Retrieve with explicit wrong tenant_id should still reject.

    Security requirement: if caller explicitly passes a wrong tenant_id,
    the retrieval should fail even though we could derive from KB.
    """
    mock_agent = MagicMock()
    mock_agent.id = "agent_123"
    mock_agent.kb_id = "kb_123"
    mock_agent.similarity_threshold = 0.05

    mock_kb = MagicMock()
    mock_kb.id = "kb_123"
    mock_kb.tenant_id = "correct_tenant_456"  # KB belongs to this tenant

    mock_session = AsyncMock()
    mock_result = MagicMock()
    mock_result.first.return_value = (mock_agent, mock_kb)
    mock_session.execute.return_value = mock_result

    with patch("services.kb_retrieval_service.AsyncSessionLocal") as mock_session_cls:
        mock_session_cls.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        service = KbRetrievalService()

        # Call with explicit WRONG tenant
        results = await service.retrieve(
            tenant_id="wrong_tenant_789",  # Explicit wrong tenant
            agent_id="agent_123",
            query="test query",
            top_k=5,
        )

        # Should return empty results - security rejection
        assert results == [], (
            "retrieve with explicit wrong tenant_id should reject and return []"
        )


@pytest.mark.asyncio
async def test_retrieval_with_correct_tenant_preserves_behavior():
    """Retrieve with correct explicit tenant_id should work normally."""
    mock_agent = MagicMock()
    mock_agent.id = "agent_123"
    mock_agent.kb_id = "kb_123"
    mock_agent.similarity_threshold = 0.05

    mock_kb = MagicMock()
    mock_kb.id = "kb_123"
    mock_kb.tenant_id = "correct_tenant_456"
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
                        {"score": 0.08, "payload": {"text": "relevant", "doc_id": "d1", "chunk_index": 0}},
                    ])
                    mock_qdrant_cls.return_value = mock_qdrant

                    service = KbRetrievalService()
                    service.parser = mock_parser
                    service.qdrant = mock_qdrant
                    service.kb_svc = MagicMock()
                    service.default_threshold = 0.6

                    # Call with CORRECT tenant
                    results = await service.retrieve(
                        tenant_id="correct_tenant_456",  # Correct tenant
                        agent_id="agent_123",
                        query="test query",
                        top_k=5,
                    )

                    # Should return results
                    assert len(results) > 0, "retrieve with correct tenant should work"

                    # Verify search_kb was called with correct tenant
                    call_kwargs = mock_qdrant.search_kb.call_args[1]
                    assert call_kwargs.get("tenant_id") == "correct_tenant_456"


@pytest.mark.asyncio
async def test_retrieval_effective_tenant_used_for_qdrant_filter():
    """The effective tenant (derived or explicit) must be passed to Qdrant search."""
    mock_agent = MagicMock()
    mock_agent.id = "agent_123"
    mock_agent.kb_id = "kb_123"
    mock_agent.similarity_threshold = 0.05

    mock_kb = MagicMock()
    mock_kb.id = "kb_123"
    mock_kb.tenant_id = "kb_tenant_789"
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

                    # Test case 1: tenant_id=None should derive from KB
                    await service.retrieve(
                        tenant_id=None,
                        agent_id="agent_123",
                        query="test",
                        top_k=5,
                    )

                    call_kwargs = mock_qdrant.search_kb.call_args[1]
                    assert call_kwargs.get("tenant_id") == "kb_tenant_789", (
                        "When tenant_id=None, Qdrant should receive KB's tenant_id"
                    )
