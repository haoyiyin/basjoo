"""Encryption utilities for sensitive data like API keys.

This module handles encryption/decryption of API keys with support for:
1. Environment variable ENCRYPTION_KEY
2. Auto-generated key stored in a file (preferred for production)
"""
import os
import base64
import logging
import stat
from functools import lru_cache
from pathlib import Path
from typing import Optional
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

logger = logging.getLogger(__name__)

# Marker to identify encrypted values
ENCRYPTION_MARKER = "enc:"

# Default path for auto-generated encryption key
DEFAULT_KEY_FILE = "/app/data/.encryption_key"


def _get_key_file_path() -> str:
    """Get the path to the encryption key file.

    Uses ENCRYPTION_KEY_FILE env var if set, otherwise uses default path.
    """
    return os.environ.get("ENCRYPTION_KEY_FILE", DEFAULT_KEY_FILE)


def _generate_and_save_key(key_file: str) -> str:
    """Generate a new encryption key and save it to a file.

    Args:
        key_file: Path to the key file.

    Returns:
        The generated key.
    """
    # Generate a new Fernet key
    key = Fernet.generate_key().decode()

    # Ensure directory exists
    key_path = Path(key_file)
    key_path.parent.mkdir(parents=True, exist_ok=True)

    # Write key to file with restricted permissions (owner read/write only)
    with open(key_file, 'w') as f:
        f.write(key)

    # Set file permissions to 600 (owner read/write only)
    os.chmod(key_file, stat.S_IRUSR | stat.S_IWUSR)

    logger.info(f"Generated new encryption key and saved to {key_file}")
    return key


def _load_key_from_file(key_file: str) -> Optional[str]:
    """Load encryption key from file.

    Args:
        key_file: Path to the key file.

    Returns:
        The key if file exists and is readable, None otherwise.
    """
    try:
        if os.path.exists(key_file):
            with open(key_file, 'r') as f:
                key = f.read().strip()
            logger.debug(f"Loaded encryption key from {key_file}")
            return key
    except Exception as e:
        logger.warning(f"Failed to load encryption key from {key_file}: {e}")

    return None


@lru_cache(maxsize=1)
def _get_or_create_encryption_key() -> Optional[str]:
    """Get encryption key from environment or file, creating one if needed.

    This function is cached to avoid repeated file reads.

    Priority:
    1. ENCRYPTION_KEY environment variable
    2. Existing key file
    3. Generate new key file (if writable)

    Returns:
        The encryption key, or None if encryption cannot be enabled.
    """
    # 1. Check environment variable first
    env_key = os.environ.get("ENCRYPTION_KEY")
    if env_key:
        logger.debug("Using encryption key from ENCRYPTION_KEY environment variable")
        return env_key

    # 2. Try to load from file
    key_file = _get_key_file_path()
    file_key = _load_key_from_file(key_file)
    if file_key:
        return file_key

    # 3. Try to generate and save a new key
    try:
        return _generate_and_save_key(key_file)
    except Exception as e:
        logger.warning(
            f"Could not create encryption key file at {key_file}: {e}. "
            "API keys will be stored in plaintext. "
            "Set ENCRYPTION_KEY environment variable or ensure the key file directory is writable."
        )
        return None


class ApiKeyEncryption:
    """Handles encryption and decryption of API keys."""

    def __init__(self, encryption_key: Optional[str] = None):
        """
        Initialize encryption with a key.

        Args:
            encryption_key: Base64-encoded encryption key or password.
                           If not provided, uses auto-detection logic.
        """
        # Use provided key, or auto-detect/generate
        key = encryption_key or _get_or_create_encryption_key()

        if not key:
            # No encryption available - will store in plaintext
            self._fernet: Optional[Fernet] = None
            return

        # If key is already a valid Fernet key (32 bytes base64-encoded, 44 chars)
        if len(key) == 44:
            try:
                # Validate it's valid base64
                base64.urlsafe_b64decode(key)
                self._fernet = Fernet(key.encode())
                return
            except Exception:
                pass

        # Derive key from password using PBKDF2
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b"basjoo_fixed_salt_v1",  # Fixed salt for deterministic encryption
            iterations=100000,
        )
        derived_key = base64.urlsafe_b64encode(kdf.derive(key.encode()))
        self._fernet = Fernet(derived_key)

    def encrypt(self, plaintext: Optional[str]) -> Optional[str]:
        """
        Encrypt a plaintext string.

        Args:
            plaintext: The string to encrypt.

        Returns:
            Encrypted string with marker prefix, or original if encryption not available.
        """
        if not plaintext:
            return plaintext

        # Already encrypted
        if plaintext.startswith(ENCRYPTION_MARKER):
            return plaintext

        if self._fernet is None:
            # Encryption not available, store as-is (backwards compatible)
            return plaintext

        try:
            encrypted = self._fernet.encrypt(plaintext.encode())
            return f"{ENCRYPTION_MARKER}{encrypted.decode()}"
        except Exception as e:
            logger.error(f"Encryption failed: {e}")
            # Fall back to plaintext rather than lose data
            return plaintext

    def decrypt(self, ciphertext: Optional[str]) -> Optional[str]:
        """
        Decrypt an encrypted string.

        Args:
            ciphertext: The string to decrypt (may or may not have marker).

        Returns:
            Decrypted string, or original if not encrypted or decryption fails.
        """
        if not ciphertext:
            return ciphertext

        # Not encrypted (no marker)
        if not ciphertext.startswith(ENCRYPTION_MARKER):
            return ciphertext

        if self._fernet is None:
            logger.warning(
                "Cannot decrypt API key - encryption key not available. "
                "Set ENCRYPTION_KEY environment variable or ensure key file exists."
            )
            # Return ciphertext without marker so caller knows it's encrypted
            return ciphertext[len(ENCRYPTION_MARKER):]

        try:
            encrypted_data = ciphertext[len(ENCRYPTION_MARKER):].encode()
            decrypted = self._fernet.decrypt(encrypted_data)
            return decrypted.decode()
        except Exception as e:
            logger.error(f"Decryption failed: {e}")
            # Return ciphertext without marker on failure
            return ciphertext[len(ENCRYPTION_MARKER):]

    def is_encrypted(self, value: Optional[str]) -> bool:
        """Check if a value is encrypted."""
        return bool(value and value.startswith(ENCRYPTION_MARKER))


# Global encryption instance
_encryption_instance: Optional[ApiKeyEncryption] = None


def get_encryption() -> ApiKeyEncryption:
    """Get the global encryption instance."""
    global _encryption_instance
    if _encryption_instance is None:
        _encryption_instance = ApiKeyEncryption()
    return _encryption_instance


def encrypt_api_key(plaintext: Optional[str]) -> Optional[str]:
    """Encrypt an API key."""
    return get_encryption().encrypt(plaintext)


def decrypt_api_key(ciphertext: Optional[str]) -> Optional[str]:
    """Decrypt an API key."""
    return get_encryption().decrypt(ciphertext)


def is_api_key_encrypted(value: Optional[str]) -> bool:
    """Check if an API key is encrypted."""
    return get_encryption().is_encrypted(value)


def generate_encryption_key() -> str:
    """Generate a new encryption key."""
    return Fernet.generate_key().decode()
