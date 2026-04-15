import importlib
import importlib.util
import os
import sqlite3
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _load_module_from_path(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    assert spec is not None and spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _reload_config_module(monkeypatch, tmp_path, **overrides):
    secret_key_file = tmp_path / ".secret_key"

    env = {
        "SECRET_KEY": "",
        "SECRET_KEY_FILE": str(secret_key_file),
        "ALLOWED_ORIGINS": "",
        "ALLOWED_METHODS": "",
        "ALLOWED_HEADERS": "",
    }
    env.update(overrides)

    for key, value in env.items():
        monkeypatch.setenv(key, value)

    sys.modules.pop("config", None)
    config = importlib.import_module("config")
    return config, secret_key_file



def test_settings_generates_secret_key_file_when_env_missing(monkeypatch, tmp_path):
    config, secret_key_file = _reload_config_module(monkeypatch, tmp_path)

    settings = config.Settings()

    assert settings.secret_key
    assert secret_key_file.exists()
    assert secret_key_file.read_text(encoding="utf-8").strip() == settings.secret_key



def test_settings_reuses_existing_secret_key_file(monkeypatch, tmp_path):
    secret_key_file = tmp_path / ".secret_key"
    secret_key_file.write_text("persisted-secret", encoding="utf-8")

    config, _ = _reload_config_module(
        monkeypatch,
        tmp_path,
        SECRET_KEY="",
        SECRET_KEY_FILE=str(secret_key_file),
    )

    settings = config.Settings()

    assert settings.secret_key == "persisted-secret"



def test_settings_generates_agent_id_file_when_env_missing(monkeypatch, tmp_path):
    agent_id_file = tmp_path / ".agent_id"
    config, _ = _reload_config_module(
        monkeypatch,
        tmp_path,
        AGENT_ID_FILE=str(agent_id_file),
        DEFAULT_AGENT_ID="",
    )

    settings = config.Settings()

    assert settings.default_agent_id.startswith("agt_")
    assert len(settings.default_agent_id) == 16
    assert agent_id_file.exists()
    assert agent_id_file.read_text(encoding="utf-8").strip() == settings.default_agent_id



def test_settings_reuses_existing_agent_id_file(monkeypatch, tmp_path):
    agent_id_file = tmp_path / ".agent_id"
    agent_id_file.write_text("agt_abcdef123456", encoding="utf-8")

    config, _ = _reload_config_module(
        monkeypatch,
        tmp_path,
        AGENT_ID_FILE=str(agent_id_file),
        DEFAULT_AGENT_ID="",
    )

    settings = config.Settings()

    assert settings.default_agent_id == "agt_abcdef123456"



def test_settings_persists_default_agent_id_override(monkeypatch, tmp_path):
    agent_id_file = tmp_path / ".agent_id"
    config, _ = _reload_config_module(
        monkeypatch,
        tmp_path,
        AGENT_ID_FILE=str(agent_id_file),
        DEFAULT_AGENT_ID="agt_123456789abc",
    )

    settings = config.Settings()

    assert settings.default_agent_id == "agt_123456789abc"
    assert agent_id_file.read_text(encoding="utf-8").strip() == "agt_123456789abc"



def test_settings_ignores_invalid_default_agent_id(monkeypatch, tmp_path):
    agent_id_file = tmp_path / ".agent_id"
    agent_id_file.write_text("agt_abcdef123456", encoding="utf-8")

    config, _ = _reload_config_module(
        monkeypatch,
        tmp_path,
        AGENT_ID_FILE=str(agent_id_file),
        DEFAULT_AGENT_ID="invalid-agent-id",
    )

    settings = config.Settings()

    assert settings.default_agent_id == "agt_abcdef123456"



def test_settings_does_not_default_cors_to_wildcard_when_env_missing(monkeypatch, tmp_path):
    config, _ = _reload_config_module(monkeypatch, tmp_path)

    settings = config.Settings()

    assert settings.allowed_origins == ""
    assert settings.cors_origins_list == []
    assert settings.cors_methods_list == ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
    assert settings.cors_headers_list == ["Content-Type", "Authorization", "X-Requested-With", "Accept"]



def test_entrypoint_lenient_defaults_fill_missing_env(monkeypatch):
    docker_entrypoint = _load_module_from_path("docker_entrypoint_test", BACKEND_DIR / "docker-entrypoint.py")

    monkeypatch.delenv("ALLOWED_ORIGINS", raising=False)
    monkeypatch.delenv("ALLOWED_METHODS", raising=False)
    monkeypatch.delenv("ALLOWED_HEADERS", raising=False)
    monkeypatch.delenv("SECRET_KEY_FILE", raising=False)
    monkeypatch.delenv("ENCRYPTION_KEY_FILE", raising=False)

    docker_entrypoint.apply_lenient_defaults()

    assert os.environ["ALLOWED_ORIGINS"] == "*"
    assert os.environ["ALLOWED_METHODS"] == docker_entrypoint.DEFAULT_ALLOWED_METHODS
    assert os.environ["ALLOWED_HEADERS"] == docker_entrypoint.DEFAULT_ALLOWED_HEADERS
    assert os.environ["SECRET_KEY_FILE"] == docker_entrypoint.DEFAULT_SECRET_KEY_FILE
    assert os.environ["ENCRYPTION_KEY_FILE"] == docker_entrypoint.DEFAULT_ENCRYPTION_KEY_FILE



def test_entrypoint_generates_secret_key_when_missing(monkeypatch, tmp_path):
    docker_entrypoint = _load_module_from_path("docker_entrypoint_test", BACKEND_DIR / "docker-entrypoint.py")

    secret_key_file = tmp_path / ".secret_key"
    monkeypatch.setenv("SECRET_KEY", "")
    monkeypatch.setenv("SECRET_KEY_FILE", str(secret_key_file))

    secret_key = docker_entrypoint.ensure_secret_key()

    assert secret_key
    assert os.environ["SECRET_KEY"] == secret_key
    assert secret_key_file.read_text(encoding="utf-8").strip() == secret_key



def test_entrypoint_reuses_persisted_secret_key(monkeypatch, tmp_path):
    docker_entrypoint = _load_module_from_path("docker_entrypoint_test", BACKEND_DIR / "docker-entrypoint.py")

    secret_key_file = tmp_path / ".secret_key"
    secret_key_file.write_text("persisted-secret", encoding="utf-8")
    monkeypatch.setenv("SECRET_KEY", "")
    monkeypatch.setenv("SECRET_KEY_FILE", str(secret_key_file))

    secret_key = docker_entrypoint.ensure_secret_key()

    assert secret_key == "persisted-secret"
    assert os.environ["SECRET_KEY"] == "persisted-secret"


def test_env_bootstrap_creates_missing_env_file(tmp_path):
    env_bootstrap = _load_module_from_path("env_bootstrap_test", BACKEND_DIR / "env_bootstrap.py")
    project_root = tmp_path / "project"
    project_root.mkdir()

    env_path = env_bootstrap.ensure_project_env_file(project_root)
    env_text = env_path.read_text(encoding="utf-8")

    assert env_path.exists()
    assert "ALLOWED_ORIGINS=*" in env_text
    assert "SECRET_KEY=" in env_text
    assert "ENCRYPTION_KEY=" in env_text



def test_env_bootstrap_fills_missing_values_from_template(tmp_path):
    env_bootstrap = _load_module_from_path("env_bootstrap_test", BACKEND_DIR / "env_bootstrap.py")
    project_root = tmp_path / "project"
    project_root.mkdir()
    (project_root / ".env.example").write_text("SECRET_KEY=\nALLOWED_ORIGINS=\n", encoding="utf-8")

    env_path = env_bootstrap.ensure_project_env_file(project_root)
    env_text = env_path.read_text(encoding="utf-8")

    assert "ALLOWED_ORIGINS=*" in env_text
    assert "SECRET_KEY=" in env_text
    assert "SECRET_KEY=\n" not in env_text



def test_env_bootstrap_force_overrides_allowed_origins_from_template(tmp_path):
    env_bootstrap = _load_module_from_path("env_bootstrap_test", BACKEND_DIR / "env_bootstrap.py")
    project_root = tmp_path / "project"
    project_root.mkdir()
    (project_root / ".env.example").write_text(
        "ALLOWED_ORIGINS=http://localhost,http://localhost:3000\n"
        "ALLOWED_HEADERS=Content-Type,Authorization\n"
        "ALLOWED_METHODS=PATCH\n",
        encoding="utf-8",
    )

    env_path = env_bootstrap.ensure_project_env_file(project_root)
    env_text = env_path.read_text(encoding="utf-8")

    assert "ALLOWED_ORIGINS=*" in env_text
    assert "ALLOWED_ORIGINS=http://localhost,http://localhost:3000" not in env_text
    assert "ALLOWED_HEADERS=Content-Type,Authorization,X-Requested-With,Accept" in env_text
    assert "ALLOWED_METHODS=PATCH" in env_text
