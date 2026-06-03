"""Tests for agent API key fallback to environment variable."""

from unittest.mock import MagicMock, patch

import pytest

from api.v1.endpoints import get_agent_plaintext_keys


class TestGetAgentPlaintextKeys:
    """Tests for get_agent_plaintext_keys function with env fallback."""

    @pytest.fixture
    def mock_agent(self):
        """Create a mock agent with configurable id and api_key."""
        agent = MagicMock()
        agent.id = "agt_test123456"
        agent.api_key = "enc:encrypted_key_value"
        return agent

    @pytest.fixture
    def default_agent_id(self):
        """Default agent ID from settings."""
        return "agt_default12345"

    @pytest.fixture
    def env_api_key(self):
        """Environment variable API key."""
        return "sk-env-api-key-from-env"

    def test_returns_decrypted_key_when_agent_has_valid_key(self, mock_agent):
        """Should return decrypted key when agent has a valid stored key."""
        with patch("api.v1.endpoints.decrypt_api_key") as mock_decrypt:
            mock_decrypt.return_value = "sk-valid-agent-key"

            result = get_agent_plaintext_keys(mock_agent)

            assert result == "sk-valid-agent-key"
            mock_decrypt.assert_called_once_with("enc:encrypted_key_value")

    def test_returns_none_for_non_default_agent_with_empty_key(self, mock_agent):
        """Should return None for non-default agent with empty/invalid key."""
        with (
            patch("api.v1.endpoints.decrypt_api_key") as mock_decrypt,
            patch("api.v1.endpoints.settings") as mock_settings,
        ):
            mock_decrypt.return_value = None
            mock_settings.default_agent_id = "agt_different_default"
            mock_settings.deepseek_api_key = "sk-env-key"

            result = get_agent_plaintext_keys(mock_agent)

            assert result is None

    def test_returns_env_key_for_default_agent_with_empty_stored_key(
        self, mock_agent, default_agent_id, env_api_key
    ):
        """Should return env key for default agent when stored key is empty/invalid."""
        mock_agent.id = default_agent_id

        with (
            patch("api.v1.endpoints.decrypt_api_key") as mock_decrypt,
            patch("api.v1.endpoints.settings") as mock_settings,
        ):
            mock_decrypt.return_value = None
            mock_settings.default_agent_id = default_agent_id
            mock_settings.deepseek_api_key = env_api_key

            result = get_agent_plaintext_keys(mock_agent)

            assert result == env_api_key

    def test_returns_stored_key_when_both_exist(self, mock_agent, default_agent_id):
        """Should prefer stored key over env key when both exist."""
        mock_agent.id = default_agent_id

        with (
            patch("api.v1.endpoints.decrypt_api_key") as mock_decrypt,
            patch("api.v1.endpoints.settings") as mock_settings,
        ):
            mock_decrypt.return_value = "sk-stored-key"
            mock_settings.default_agent_id = default_agent_id
            mock_settings.deepseek_api_key = "sk-env-key"

            result = get_agent_plaintext_keys(mock_agent)

            # Should return stored key, not env key
            assert result == "sk-stored-key"

    def test_returns_none_when_no_keys_available(self, mock_agent):
        """Should return None when no keys are available."""
        with (
            patch("api.v1.endpoints.decrypt_api_key") as mock_decrypt,
            patch("api.v1.endpoints.settings") as mock_settings,
        ):
            mock_decrypt.return_value = None
            mock_settings.default_agent_id = "agt_different"
            mock_settings.deepseek_api_key = ""

            result = get_agent_plaintext_keys(mock_agent)

            assert result is None
