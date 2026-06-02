"""Tests for KB document pipeline: model fields, parser, processor, endpoints."""

from models import KbDocument, KnowledgeBase
from services.document_parser import DocumentParser
from services.kb_document_processor import KbDocumentProcessor


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
