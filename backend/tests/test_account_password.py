"""Tests for the self-service password change (`POST /api/admin/me/password`).

Covers the account-settings flow end to end on the API surface:

* wrong current password → 400 "Current password is incorrect", hash untouched;
* new password shorter than 8 → 400 "Password too short", hash untouched;
* happy path → 204, and the new password really authenticates (old one does not);
* the endpoint is authenticated (no token → 401).

The admin-management `PATCH /users/{admin_id}` password path is exercised by the
pre-existing auth tests and is deliberately not touched here.
"""

import pytest
from sqlalchemy import select

import database
from api.endpoints import auth as auth_module
from models import AdminUser
from services.auth_service import AuthService

EXISTING_PASSWORD = "testpassword123"  # conftest's test admin
NEW_PASSWORD = "brandnew-password-456"

@pytest.fixture(autouse=True)
def _no_login_rate_limit_between_tests(monkeypatch):
    """Keep the login limiter from starving the rest of the suite.

    The limiter is process-global AND counted in Redis per client IP, so the two
    real logins in this module would otherwise eat the shared 5-per-window budget
    and turn an unrelated later test's 401 into a 429. The limiter's own behaviour
    is covered elsewhere; here it only needs to not interfere.
    """
    from config import settings as cfg

    monkeypatch.setattr(cfg, "login_rate_limit_max_attempts", 10_000)
    auth_module._login_attempt_history.clear()
    yield
    auth_module._login_attempt_history.clear()

async def _first_admin():
    async with database.AsyncSessionLocal() as session:
        admin = (
            await session.execute(select(AdminUser).order_by(AdminUser.id).limit(1))
        ).scalars().first()
        assert admin is not None, "setup_test_db must create a test admin"
        return admin.email, admin.hashed_password

async def _login(public_client, email: str, password: str):
    return await public_client.post(
        "/api/admin/login", json={"email": email, "password": password}
    )

@pytest.mark.asyncio
async def test_wrong_current_password_is_rejected(client):
    _, original_hash = await _first_admin()

    response = await client.post(
        "/api/admin/me/password",
        json={"current_password": "totally-wrong-123", "new_password": NEW_PASSWORD},
    )

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Current password is incorrect"

    _, stored_hash = await _first_admin()
    assert stored_hash == original_hash

@pytest.mark.asyncio
async def test_new_password_shorter_than_eight_is_rejected(client):
    _, original_hash = await _first_admin()

    response = await client.post(
        "/api/admin/me/password",
        json={"current_password": EXISTING_PASSWORD, "new_password": "shortie"},
    )

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Password too short"

    _, stored_hash = await _first_admin()
    assert stored_hash == original_hash

@pytest.mark.asyncio
async def test_password_change_returns_204_and_new_password_logs_in(
    client, public_client
):
    email, original_hash = await _first_admin()

    response = await client.post(
        "/api/admin/me/password",
        json={"current_password": EXISTING_PASSWORD, "new_password": NEW_PASSWORD},
    )
    assert response.status_code == 204, response.text
    assert response.content == b""

    _, stored_hash = await _first_admin()
    assert stored_hash != original_hash
    assert AuthService.verify_password(NEW_PASSWORD, stored_hash) is True

    old_login = await _login(public_client, email, EXISTING_PASSWORD)
    assert old_login.status_code == 401

    new_login = await _login(public_client, email, NEW_PASSWORD)
    assert new_login.status_code == 200, new_login.text
    assert new_login.json()["access_token"]

@pytest.mark.asyncio
async def test_password_change_requires_authentication(public_client):
    response = await public_client.post(
        "/api/admin/me/password",
        json={"current_password": EXISTING_PASSWORD, "new_password": NEW_PASSWORD},
    )
    assert response.status_code == 401
