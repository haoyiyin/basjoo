import pytest
from services.auth_service import AuthService


def test_hash_password():
    password = "testpassword123"
    hashed = AuthService.hash_password(password)

    assert hashed != password
    assert hashed.startswith("$2b$")


def test_verify_password():
    password = "testpassword123"
    hashed = AuthService.hash_password(password)

    assert AuthService.verify_password(password, hashed) is True
    assert AuthService.verify_password("wrongpassword", hashed) is False


def test_hash_password_truncation():
    long_password = "a" * 100
    hashed = AuthService.hash_password(long_password)

    assert AuthService.verify_password(long_password, hashed) is True


def test_password_with_unicode():
    password = "密码测试123"
    hashed = AuthService.hash_password(password)

    assert AuthService.verify_password(password, hashed) is True
