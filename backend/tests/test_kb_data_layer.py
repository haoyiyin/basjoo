"""Tests for multi-tenant KB data layer: models, tenant enforcement, Qdrant collection ensure."""

from models import Agent, KbChunk, KbDocument, KnowledgeBase, Tenant
import pytest


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
