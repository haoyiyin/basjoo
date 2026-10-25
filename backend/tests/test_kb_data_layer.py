"""KB data layer: model shape, workspace scope, service contract, Qdrant isolation.

These are structural assertions over the models and service signatures; behaviour
lives in `test_kb_workspace_scope.py`, `test_kb_document_pipeline.py` and
`test_kb_retrieval.py`.
"""

import inspect

import pytest
from sqlalchemy import inspect as sa_inspect

from models import Agent, KbChunk, KbDocument, KnowledgeBase, Tenant
from services.kb_document_processor import get_embedding_api_key
from services.kb_retrieval_service import KbRetrievalService
from services.kb_service import KbService
from services.qdrant_service import QdrantKbService

def test_models_are_importable():
    assert hasattr(Tenant, "__tablename__")
    assert hasattr(KnowledgeBase, "__tablename__")
    assert hasattr(KbDocument, "__tablename__")
    assert hasattr(KbChunk, "__tablename__")
    assert hasattr(Agent, "kb_id")

def test_kb_ownership_columns():
    """A KB is workspace-scoped and owns its embedding config."""
    columns = sa_inspect(KnowledgeBase).columns

    assert "workspace_id" in columns
    assert columns["workspace_id"].nullable is False
    assert columns["workspace_id"].index is True

    assert "embedding_provider" in columns
    assert columns["embedding_provider"].nullable is False
    assert columns["embedding_provider"].default.arg == "jina"
    assert "embedding_api_key" in columns
    assert columns["embedding_api_key"].nullable is True
    assert "embedding_batch_size" in columns
    assert columns["embedding_batch_size"].default.arg == 4
    assert "embedding_dimension" in columns
    assert columns["embedding_dimension"].nullable is True

    # `tenant_id` is legacy: nullable, still present, no longer authoritative.
    assert "tenant_id" in columns
    assert columns["tenant_id"].nullable is True

def test_kb_status_and_error_message_columns():
    columns = sa_inspect(KnowledgeBase).columns
    assert columns["status"].default.arg == "active"
    assert columns["status"].nullable is False
    assert columns["error_message"].nullable is True

def test_agent_kb_binding_is_unique_and_one_to_one():
    """Strictly one-to-one: the column is unique and the relationship is scalar."""
    columns = sa_inspect(Agent).columns
    assert "kb_id" in columns
    assert columns["kb_id"].nullable is True
    assert columns["kb_id"].unique is True

    relationship = sa_inspect(Agent).relationships["knowledge_base"]
    assert relationship.uselist is False
    assert relationship.back_populates == "agent"

    kb_relationship = sa_inspect(KnowledgeBase).relationships["agent"]
    assert kb_relationship.uselist is False
    assert kb_relationship.back_populates == "knowledge_base"

def test_document_provenance_column():
    columns = sa_inspect(KbDocument).columns
    assert "source_agent_id" in columns
    assert columns["source_agent_id"].nullable is True
    assert columns["source_agent_id"].index is True
    # Legacy tenant scope stays but is nullable.
    assert columns["tenant_id"].nullable is True
    assert sa_inspect(KbChunk).columns["tenant_id"].nullable is True

def test_agent_embedding_columns_are_retained_but_deprecated():
    """They stay for one release (no data loss) and are never read any more."""
    columns = sa_inspect(Agent).columns
    for name in (
        "embedding_provider",
        "embedding_api_base",
        "embedding_model",
        "embedding_batch_size",
        "jina_api_key",
        "siliconflow_api_key",
        "kb_setup_completed",
    ):
        assert name in columns, f"{name} must stay in the schema for one release"

def test_relationship_back_populates_is_consistent():
    """Both sides of Agent ⇄ KnowledgeBase agree on the attribute names."""
    agent_rels = sa_inspect(Agent).relationships
    kb_rels = sa_inspect(KnowledgeBase).relationships
    assert agent_rels["knowledge_base"].back_populates in kb_rels
    assert kb_rels["agent"].back_populates in agent_rels

# ---- KbService public API --------------------------------------------------

def test_kb_service_has_no_tenant_parameters():
    """No tenant in any public signature: workspace is the only scope."""
    for name, member in inspect.getmembers(KbService, inspect.isfunction):
        if name.startswith("_"):
            continue
        parameters = inspect.signature(member).parameters
        assert "tenant_id" not in parameters, f"{name} still takes tenant_id"

@pytest.mark.parametrize(
    "method_name, expected",
    [
        (
            "list_knowledge_bases",
            ["self", "workspace_id"],
        ),
        (
            "get_knowledge_base",
            ["self", "kb_id", "workspace_id"],
        ),
        (
            "update_kb_config",
            ["self", "kb_id", "workspace_id", "updates"],
        ),
        (
            "get_kb_detail",
            ["self", "kb_id", "workspace_id"],
        ),
        (
            "delete_knowledge_base",
            ["self", "kb_id", "workspace_id"],
        ),
        (
            "bind_agent",
            ["self", "agent_id", "workspace_id", "kb_id"],
        ),
        (
            "unbind_kb_from_agents",
            ["self", "kb_id"],
        ),
    ],
)
def test_kb_service_signatures(method_name, expected):
    signature = inspect.signature(getattr(KbService, method_name))
    assert list(signature.parameters) == expected

def test_create_knowledge_base_signature():
    parameters = inspect.signature(KbService.create_knowledge_base).parameters
    assert list(parameters)[:3] == ["self", "workspace_id", "name"]
    for name in (
        "embedding_provider",
        "embedding_model",
        "embedding_base_url",
        "embedding_api_key",
        "embedding_dimension",
        "embedding_batch_size",
        "chunk_size",
        "chunk_overlap",
    ):
        assert name in parameters, f"missing keyword {name}"

def test_reset_knowledge_base_signature_is_keyword_only():
    parameters = inspect.signature(KbService.reset_knowledge_base).parameters
    assert list(parameters)[:3] == ["self", "kb_id", "workspace_id"]
    for name in (
        "embedding_provider",
        "embedding_model",
        "embedding_base_url",
        "embedding_api_key",
        "embedding_dimension",
        "embedding_batch_size",
    ):
        assert parameters[name].kind is inspect.Parameter.KEYWORD_ONLY

def test_list_knowledge_bases_requires_a_workspace():
    svc = KbService()
    with pytest.raises(ValueError, match="workspace_id"):
        import asyncio

        asyncio.run(svc.list_knowledge_bases(None))

def test_auto_create_helpers_are_gone():
    assert not hasattr(KbService, "get_or_create_agent_kb")
    assert not hasattr(KbService, "_get_or_create_agent_kb_with_session")

# ---- Qdrant isolation ------------------------------------------------------

def test_search_kb_signature_has_no_tenant():
    parameters = list(inspect.signature(QdrantKbService.search_kb).parameters)
    assert parameters == ["self", "kb_id", "query_vector", "top_k"]

def test_ensure_collection_takes_a_dimension_not_a_model():
    parameters = list(inspect.signature(QdrantKbService.ensure_collection).parameters)
    assert parameters == ["self", "kb_id", "dimension"]

def test_retrieve_signature_has_no_tenant():
    parameters = list(inspect.signature(KbRetrievalService.retrieve).parameters)
    assert parameters == ["self", "agent_id", "query", "top_k", "threshold"]

# ---- Key resolver ----------------------------------------------------------

def test_get_embedding_api_key_only_takes_a_kb():
    parameters = list(inspect.signature(get_embedding_api_key).parameters)
    assert parameters == ["kb"]
