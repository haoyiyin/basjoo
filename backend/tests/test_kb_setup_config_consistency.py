"""Tests for kb_setup config/DB consistency and rollback behavior."""

import pytest
from unittest.mock import patch
import tempfile
from pathlib import Path

import database
from models import Agent


@pytest.fixture
def temp_r2r_config_dir(monkeypatch):
    """Create a temporary directory for R2R config during test."""
    temp_dir = tempfile.mkdtemp()
    yield Path(temp_dir)
    # Cleanup
    import shutil
    shutil.rmtree(temp_dir, ignore_errors=True)


@pytest.fixture
def patched_r2r_config_paths(temp_r2r_config_dir, monkeypatch):
    """Patch _r2r_config_paths to use temp directory without reloading global config."""
    def fake_paths():
        return temp_r2r_config_dir / "user_configs" / "r2r.toml", temp_r2r_config_dir / "r2r.env"

    monkeypatch.setattr(
        "services.r2r_config_generator._r2r_config_paths",
        fake_paths,
    )
    return temp_r2r_config_dir


@pytest.mark.asyncio
async def test_kb_setup_restores_r2r_config_when_db_commit_fails(
    client,
    default_agent_id,
    patched_r2r_config_paths,
):
    """Config should be restored to original state if DB commit fails."""
    temp_dir = patched_r2r_config_paths
    toml_path = temp_dir / "user_configs" / "r2r.toml"
    env_path = temp_dir / "r2r.env"
    toml_path.parent.mkdir(parents=True, exist_ok=True)
    original_toml = "# original config\n"
    original_env = "SOME_OTHER_KEY=value\n"
    toml_path.write_text(original_toml)
    env_path.write_text(original_env)

    # Get agent and verify kb_setup_completed is False
    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, default_agent_id)
        assert agent.kb_setup_completed is False

    # Patch DB commit to fail
    async def failing_commit(self):
        raise RuntimeError("DB commit simulated failure")

    with patch.object(database.AsyncSession, "commit", failing_commit):
        response = await client.post(
            f"/api/v1/agent:kb-setup?agent_id={default_agent_id}",
            json={
                "embedding_provider": "jina",
                "embedding_model": "jina-embeddings-v3",
                "embedding_batch_size": 16,
                "jina_api_key": "test-key-123",
            },
        )

    assert response.status_code == 500
    assert "Failed to save knowledge base setup" in response.json()["detail"]

    # Config files should be restored
    assert toml_path.read_text() == original_toml
    assert env_path.read_text() == original_env

    # DB should still have kb_setup_completed = False
    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, default_agent_id)
        assert agent.kb_setup_completed is False


@pytest.mark.asyncio
async def test_kb_setup_returns_500_when_config_write_fails(
    client,
    default_agent_id,
    patched_r2r_config_paths,
):
    """If write_r2r_config fails, endpoint should return 500 without DB changes."""
    from services import r2r_config_generator

    def failing_write(*args, **kwargs):
        raise RuntimeError("Config write failure")

    with patch.object(r2r_config_generator, "write_r2r_config", failing_write):
        response = await client.post(
            f"/api/v1/agent:kb-setup?agent_id={default_agent_id}",
            json={
                "embedding_provider": "jina",
                "embedding_model": "jina-embeddings-v3",
                "jina_api_key": "test-key-456",
            },
        )

    assert response.status_code == 500
    assert "Failed to write R2R configuration" in response.json()["detail"]

    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, default_agent_id)
        assert agent.kb_setup_completed is False


@pytest.mark.asyncio
async def test_kb_setup_success_writes_config_and_commits(
    client,
    default_agent_id,
    patched_r2r_config_paths,
):
    """Happy path: config written and DB updated."""
    temp_dir = patched_r2r_config_paths
    toml_path = temp_dir / "user_configs" / "r2r.toml"
    env_path = temp_dir / "r2r.env"

    response = await client.post(
        f"/api/v1/agent:kb-setup?agent_id={default_agent_id}",
        json={
            "embedding_provider": "jina",
            "embedding_model": "jina-embeddings-v3",
            "embedding_batch_size": 32,
            "jina_api_key": "test-key-success",
        },
    )

    assert response.status_code == 200
    data = response.json()
    assert data.get("r2r_restart_needed") is True
    assert data.get("kb_setup_completed") is True

    # Config toml should exist and contain expected content
    assert toml_path.exists()
    toml_content = toml_path.read_text()
    assert "jina_ai/jina-embeddings-v3" in toml_content
    assert "batch_size = 32" in toml_content

    # Config env should exist and contain JINA_API_KEY
    assert env_path.exists()
    env_content = env_path.read_text()
    assert "JINA_API_KEY" in env_content

    # DB should reflect setup completed
    async with database.AsyncSessionLocal() as session:
        agent = await session.get(Agent, default_agent_id)
        assert agent.kb_setup_completed is True
        assert agent.embedding_provider == "jina"
        assert agent.embedding_batch_size == 32


@pytest.mark.asyncio
async def test_kb_setup_already_completed_returns_409(
    client,
    default_agent_id,
    patched_r2r_config_paths,
):
    """Attempting setup when already completed should return conflict."""
    # First, complete setup
    await client.post(
        f"/api/v1/agent:kb-setup?agent_id={default_agent_id}",
        json={
            "embedding_provider": "jina",
            "jina_api_key": "test-key-first",
        },
    )

    # Second attempt should fail
    response = await client.post(
        f"/api/v1/agent:kb-setup?agent_id={default_agent_id}",
        json={
            "embedding_provider": "jina",
            "jina_api_key": "test-key-second",
        },
    )

    assert response.status_code == 409
    assert "already completed" in response.json()["detail"].lower()