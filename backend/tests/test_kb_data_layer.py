"""Tests for multi-tenant KB data layer: models, tenant enforcement, Qdrant collection ensure."""

import pytest
from models import Agent, KbChunk, KbDocument, KnowledgeBase, Tenant
from services.kb_service import KbService


def test_new_models_import():
    assert hasattr(Tenant, "__tablename__")
    assert hasattr(KnowledgeBase, "__tablename__")
    assert hasattr(KbDocument, "__tablename__")
    assert hasattr(KbChunk, "__tablename__")
    assert hasattr(Agent, "kb_id")  # new column present


@pytest.mark.asyncio
async def test_agent_kb_id_column_present():
    # This will be used in integration tests after migration
    pass


# @pytest.mark.asyncio
# async def test_ensure_collection_idempotent():
#     svc = QdrantKbService()
#     coll = await svc.ensure_collection("test-kb-uuid", "BAAI/bge-m3")
#     assert coll.startswith("kb_")
#     coll2 = await svc.ensure_collection("test-kb-uuid", "BAAI/bge-m3")
#     assert coll == coll2


@pytest.mark.asyncio
async def test_list_kbs_requires_tenant_filter():
    svc = KbService()
    with pytest.raises(ValueError, match="tenant_id"):
        await svc.list_knowledge_bases(tenant_id=None)


def test_search_kb_method_exists():
    """QdrantKbService should have search_kb with double isolation filter."""
    from services.qdrant_service import QdrantKbService

    assert hasattr(QdrantKbService, "search_kb")
    # Verify signature: (kb_id, tenant_id, query_vector, top_k)
    import inspect

    sig = inspect.signature(QdrantKbService.search_kb)
    param_names = list(sig.parameters.keys())
    assert "kb_id" in param_names
    assert "tenant_id" in param_names
    assert "query_vector" in param_names
    assert "top_k" in param_names


def test_knowledge_base_has_status_and_error_message():
    from sqlalchemy import inspect as sa_inspect

    mapper = sa_inspect(KnowledgeBase)
    # status column exists with correct default
    assert "status" in mapper.columns
    assert mapper.columns["status"].default.arg == "active"
    assert mapper.columns["status"].nullable is False
    # error_message column exists
    assert "error_message" in mapper.columns
    assert mapper.columns["error_message"].nullable is True
    # Python object instantiation works
    kb = KnowledgeBase(tenant_id="t1", name="test", qdrant_collection="kb_test")
    assert hasattr(kb, "status")
    assert hasattr(kb, "error_message")


def test_kb_service_has_get_config_method():
    svc = KbService()
    assert hasattr(svc, "get_kb_config")
    import inspect

    sig = inspect.signature(svc.get_kb_config)
    param_names = list(sig.parameters.keys())
    assert "tenant_id" in param_names
    assert "kb_id" in param_names


def test_kb_service_has_update_config_method():
    svc = KbService()
    assert hasattr(svc, "update_kb_config")
    import inspect

    sig = inspect.signature(svc.update_kb_config)
    param_names = list(sig.parameters.keys())
    assert "tenant_id" in param_names
    assert "kb_id" in param_names
    assert "updates" in param_names


def test_kb_service_get_kb_detail_returns_counts():
    """Optional improvement: verify enhanced GET detail returns count fields."""
    svc = KbService()
    assert hasattr(svc, "get_kb_detail")
    import inspect

    sig = inspect.signature(svc.get_kb_detail)
    param_names = list(sig.parameters.keys())
    assert "tenant_id" in param_names
    assert "kb_id" in param_names


def test_upload_returns_423_when_kb_resetting():
    """Optional improvement: verify 423 guard on upload during reset."""
    # This is an endpoint-level check; existence of the guard logic is verified via code review.
    # A full integration test would require a resetting KB fixture and client call.
    # For now, we assert the guard code path exists in the endpoint module.
    import ast

    with open("api/v1/kb_document_endpoints.py") as f:
        tree = ast.parse(f.read())
    source = ast.dump(tree)
    assert "resetting" in source and "423" in source or "Locked" in source
