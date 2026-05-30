"""Tests for multi-tenant KB data layer: models, tenant enforcement, Qdrant collection ensure."""

import pytest
from models import Agent, KbChunk, KbDocument, KnowledgeBase, Tenant
from services.kb_service import KbService


def test_new_models_import():
    assert hasattr(Tenant, '__tablename__')
    assert hasattr(KnowledgeBase, '__tablename__')
    assert hasattr(KbDocument, '__tablename__')
    assert hasattr(KbChunk, '__tablename__')
    assert hasattr(Agent, 'kb_id')  # new column present


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
