"""Tests for KB document pipeline: model fields, parser, processor, endpoints."""

from models import KnowledgeBase, KbDocument


def test_knowledge_base_has_chunk_params():
    kb = KnowledgeBase(tenant_id="t1", name="Test", qdrant_collection="kb_test")
    assert hasattr(kb, "chunk_size")
    assert hasattr(kb, "chunk_overlap")


def test_kb_document_has_error_message():
    doc = KbDocument(kb_id="kb1", tenant_id="t1", filename="a.txt")
    assert hasattr(doc, "error_message")
    assert hasattr(doc, "file_size")
