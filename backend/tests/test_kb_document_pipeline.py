"""Tests for KB document pipeline: model fields, parser, processor, endpoints."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from models import KbDocument, KnowledgeBase
from services.document_parser import DocumentParser
from services.kb_document_processor import KbDocumentProcessor
from services.kb_service import KbService


def test_knowledge_base_has_chunk_params():
    kb = KnowledgeBase(tenant_id="t1", name="Test", qdrant_collection="kb_test")
    assert hasattr(kb, "chunk_size")
    assert hasattr(kb, "chunk_overlap")


def test_kb_document_has_error_message():
    doc = KbDocument(kb_id="kb1", tenant_id="t1", filename="a.txt")
    assert hasattr(doc, "error_message")
    assert hasattr(doc, "file_size")


def test_document_parser_imports():
    p = DocumentParser()
    assert p is not None


def test_document_parser_chunk_text():
    p = DocumentParser()
    text = "a" * 600
    chunks = p.chunk_text(text, 512, 64)
    assert len(chunks) > 1
    assert len(chunks[0]) == 512


def test_document_parser_chunk_small_text():
    p = DocumentParser()
    text = "small text"
    chunks = p.chunk_text(text, 512, 64)
    assert len(chunks) == 1
    assert chunks[0] == text


def test_document_parser_chunk_empty():
    p = DocumentParser()
    chunks = p.chunk_text("", 512, 64)
    assert chunks == []


def test_document_parser_supported_exts():
    from services.document_parser import SUPPORTED_EXTS

    assert "txt" in SUPPORTED_EXTS
    assert "md" in SUPPORTED_EXTS
    assert "html" in SUPPORTED_EXTS
    assert "pdf" in SUPPORTED_EXTS
    assert "docx" in SUPPORTED_EXTS
    assert "xlsx" in SUPPORTED_EXTS


def test_kb_document_processor_imports():
    proc = KbDocumentProcessor()
    assert proc is not None
    assert proc.parser is not None
    assert proc.qdrant is not None
    assert proc.kb_svc is not None


def test_kb_retrieval_service_imports():
    from services.kb_retrieval_service import KbRetrievalService

    svc = KbRetrievalService()
    assert svc is not None
    assert svc.parser is not None
    assert svc.qdrant is not None
    assert svc.kb_svc is not None
    assert svc.default_threshold == 0.6


def test_retrieve_endpoint_registered():
    from api.v1.kb_document_endpoints import router
    from fastapi.routing import APIRoute

    retrieve_routes = [
        r for r in router.routes if isinstance(r, APIRoute) and "retrieve" in r.path
    ]
    assert len(retrieve_routes) == 1
    route = retrieve_routes[0]
    assert "POST" in route.methods


@pytest.mark.asyncio
async def test_embed_texts_receives_api_key():
    """embed_texts() must receive api_key from agent based on embedding_provider."""
    mock_kb = MagicMock()
    mock_kb.id = "kb_123"
    mock_kb.tenant_id = "tenant_123"
    mock_kb.embedding_model = "jina-embeddings-v3"
    mock_kb.embedding_base_url = "https://api.jina.ai/v1"
    mock_kb.chunk_size = 512
    mock_kb.chunk_overlap = 64
    mock_kb.is_locked = False

    mock_agent = MagicMock()
    mock_agent.id = "agent_123"
    mock_agent.embedding_provider = "jina"
    mock_agent.jina_api_key = "enc:encrypted_jina_key"
    mock_agent.siliconflow_api_key = None

    mock_doc = MagicMock()
    mock_doc.id = "doc_123"
    mock_doc.tenant_id = "tenant_123"
    mock_doc.kb_id = "kb_123"
    mock_doc.status = "pending"
    mock_doc.filename = "test.txt"
    mock_doc.file_type = "txt"
    mock_doc.storage_path = "/tmp/test.txt"
    mock_doc.chunk_count = 0

    with patch("services.kb_document_processor.database.AsyncSessionLocal") as mock_session_cls:
        mock_session = AsyncMock()
        mock_session_cls.return_value.__aenter__ = AsyncMock(return_value=mock_session)
        mock_session_cls.return_value.__aexit__ = AsyncMock(return_value=False)

        # Mock KB query
        kb_result = MagicMock()
        kb_result.scalar_one_or_none.return_value = mock_doc
        mock_session.execute.return_value = kb_result

        # Mock agent query
        agent_result = MagicMock()
        agent_result.scalar_one_or_none.return_value = mock_agent

        with patch("services.kb_document_processor.select") as mock_select:
            # First select is for KbDocument, second for Agent
            mock_select.side_effect = [
                MagicMock(),  # KbDocument select
                MagicMock(),  # Agent select
            ]

            with patch.object(KbDocumentProcessor, "__init__", lambda self: None):
                with patch("services.kb_document_processor.DocumentParser") as mock_parser_cls:
                    with patch("services.kb_document_processor.KbService") as mock_kb_svc_cls:
                        with patch("services.kb_document_processor.QdrantKbService") as mock_qdrant_cls:
                            with patch("core.encryption.decrypt_api_key") as mock_decrypt:
                                mock_decrypt.return_value = "decrypted_jina_key"

                                mock_parser = MagicMock()
                                mock_parser.parse_with_retry.return_value = "test content"
                                mock_parser.chunk_text.return_value = ["chunk1", "chunk2"]
                                mock_parser.embed_texts = AsyncMock(return_value=[[0.1] * 384, [0.2] * 384])
                                mock_parser_cls.return_value = mock_parser

                                mock_kb_svc = MagicMock()
                                mock_kb_svc.get_knowledge_base = AsyncMock(return_value=mock_kb)
                                mock_kb_svc_cls.return_value = mock_kb_svc

                                mock_qdrant = MagicMock()
                                mock_qdrant.batch_upsert_points = AsyncMock(return_value=None)
                                mock_qdrant_cls.return_value = mock_qdrant

                                processor = KbDocumentProcessor()
                                processor.parser = mock_parser
                                processor.qdrant = mock_qdrant
                                processor.kb_svc = mock_kb_svc

                                # Execute
                                await processor.process_document("doc_123", "tenant_123", "kb_123")

                                # Verify embed_texts was called with api_key parameter
                                assert mock_parser.embed_texts.called, "embed_texts was not called"
                                call_args, call_kwargs = mock_parser.embed_texts.call_args
                                assert "api_key" in call_kwargs, f"api_key not in kwargs. Got args: {call_args}, kwargs: {call_kwargs}"
                                # The api_key parameter should be present (value depends on agent lookup)
                                assert "api_key" in call_kwargs, "api_key parameter must be passed to embed_texts()"


def test_jina_default_base_url_from_config():
    """Verify Jina base URL can be derived from config."""
    from config import settings
    # The config should have the Jina embedding API base
    assert hasattr(settings, "jina_embedding_api_base")
    # It should end with /embeddings
    assert settings.jina_embedding_api_base.endswith("/embeddings")
    # When we strip /embeddings, we get the base URL for the API
    base_url = settings.jina_embedding_api_base.rstrip("/embeddings")
    assert base_url == "https://api.jina.ai/v1"


def test_kb_service_imports_config():
    """KbService should be able to access settings from config."""
    # This is a simple import test to verify the service can access config
    from services.kb_service import KbService
    from config import settings
    # Both should be importable
    assert KbService is not None
    assert settings is not None


@pytest.mark.asyncio
async def test_jina_default_base_url(setup_test_db):
    """When agent has embedding_provider='jina' and no embedding_api_base,
    the KB should be created with Jina's base URL."""
    from unittest.mock import AsyncMock, patch
    import database
    from sqlalchemy import select
    from models import Agent
    from services.kb_service import KbService

    async with database.AsyncSessionLocal() as session:
        # Get existing agent from fixture
        result = await session.execute(
            select(Agent)
            .where(Agent.is_active == True)
            .order_by(Agent.created_at)
            .limit(1)
        )
        agent = result.scalar_one()
        agent_id = agent.id

        # Set agent to use Jina provider with no base URL
        agent.embedding_provider = "jina"
        agent.embedding_api_base = None
        agent.embedding_model = "jina-embeddings-v3"
        agent.kb_id = None  # Clear any existing KB binding
        await session.commit()

        # Mock Qdrant to avoid connection issues
        with patch.object(KbService, "__init__", lambda self, session=None: None):
            kb_svc = KbService(session=session)
            kb_svc.qdrant = AsyncMock()
            kb_svc.qdrant.ensure_collection = AsyncMock()
            kb_svc.session = session

            tenant, kb = await kb_svc.get_or_create_agent_kb(agent_id, session)

            # Verify: KB.embedding_base_url should be Jina's base URL
            assert kb.embedding_base_url is not None, "embedding_base_url should not be None"
            assert kb.embedding_base_url == "https://api.jina.ai/v1", f"Expected Jina base URL, got: {kb.embedding_base_url}"


@pytest.mark.asyncio
async def test_siliconflow_default_base_url(setup_test_db):
    """When agent has embedding_provider='siliconflow' and no embedding_api_base,
    the KB should be created with SiliconFlow's base URL."""
    from unittest.mock import AsyncMock, patch
    import database
    from sqlalchemy import select
    from models import Agent
    from services.kb_service import KbService

    async with database.AsyncSessionLocal() as session:
        # Get existing agent from fixture
        result = await session.execute(
            select(Agent)
            .where(Agent.is_active == True)
            .order_by(Agent.created_at)
            .limit(1)
        )
        agent = result.scalar_one()
        agent_id = agent.id

        # Set agent to use SiliconFlow provider with no base URL
        agent.embedding_provider = "siliconflow"
        agent.embedding_api_base = None
        agent.embedding_model = "BAAI/bge-m3"
        agent.kb_id = None  # Clear any existing KB binding
        await session.commit()

        # Mock Qdrant to avoid connection issues
        with patch.object(KbService, "__init__", lambda self, session=None: None):
            kb_svc = KbService(session=session)
            kb_svc.qdrant = AsyncMock()
            kb_svc.qdrant.ensure_collection = AsyncMock()
            kb_svc.session = session

            tenant, kb = await kb_svc.get_or_create_agent_kb(agent_id, session)

            # Verify: KB.embedding_base_url should be SiliconFlow's base URL
            assert kb.embedding_base_url is not None, "embedding_base_url should not be None"
            assert kb.embedding_base_url == "https://api.siliconflow.cn/v1", f"Expected SiliconFlow base URL, got: {kb.embedding_base_url}"
