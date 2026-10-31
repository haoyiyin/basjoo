"""Login brute-force protection and account-enumeration guards.

Measured before the fix, against the live dev stack (`POST /api/admin/login`):

* rotating `X-Forwarded-For` per request never produced a 429 — the limiter keyed
  on a header the attacker writes;
* seven *correct* logins from one IP returned `[200,200,200,200,200,429,429]` —
  a successful login was charged to the brute-force budget;
* `nobody@example.com` answered `401 {"detail":"该邮箱未注册"}` while
  `qa1@example.com` answered `401 {"detail":"密码错误"}`, i.e. an
  account-existence oracle.

The tests below are the ones that fail on that code. They run entirely in memory
(`_login_attempt_history`, with Redis stubbed out or replaced by a local double),
so no shared Redis key is read or written by them.
"""

import hashlib

import pytest

from api.endpoints import auth as auth_module

EXISTING_PASSWORD = "testpassword123"  # conftest's test admin
WRONG_PASSWORD = "definitely-not-the-password"

class _FakeRedis:
    """Minimal sliding-window Redis double (only the calls the limiter makes)."""

    def __init__(self):
        self.zsets: dict[str, dict[str, float]] = {}
        self.client = self  # RedisService exposes the raw client at `.client`

    async def zremrangebyscore(self, key, minimum, maximum):
        entries = self.zsets.get(key, {})
        for member, score in list(entries.items()):
            if minimum <= score <= maximum:
                del entries[member]

    async def zcard(self, key):
        return len(self.zsets.get(key, {}))

    async def zadd(self, key, mapping):
        self.zsets.setdefault(key, {}).update(mapping)

    async def expire(self, key, seconds):
        return True

@pytest.fixture(autouse=True)
def _isolated_limiter(monkeypatch):
    """Keep the limiter local to this module: memory only, empty, no Redis.

    Every test below runs the in-memory path, so nothing is written to the shared
    Redis window. (The reverse — a window written by *another* module surviving
    into the next suite run — is a conftest problem, reported as a BLOCKER.)
    """
    from config import settings as cfg

    async def no_redis():
        return None

    monkeypatch.setattr("services.redis_service.get_redis", no_redis)
    monkeypatch.setattr(cfg, "login_rate_limit_max_attempts", 5)
    monkeypatch.setattr(cfg, "login_rate_limit_window_seconds", 300)
    auth_module._login_attempt_history.clear()
    yield
    auth_module._login_attempt_history.clear()
    _flush_redis_login_windows()

def _flush_redis_login_windows() -> None:
    """Drop both login windows from the shared Redis on the way out.

    This module writes nothing to Redis (it forces the memory path), but
    `test_api.py`'s `test_login_wrong_password` records a real account failure,
    and `conftest.py`'s autouse cleanup only scans `login:ip:*` — so the account
    window would still be inside its 300 s TTL when the *next* suite run asks for
    a 401 and gets a 429. Flushing here keeps a rerun clean. The proper fix is
    one line in `conftest.py`; it is outside this lane's file set, so it is
    reported as a BLOCKER instead.
    """
    import os

    import redis as redis_lib

    try:
        client = redis_lib.Redis.from_url(
            os.environ.get("REDIS_URL", ""), socket_connect_timeout=1
        )
        for prefix in ("login:ip:*", "login:acct:*"):
            for key in client.scan_iter(prefix):
                client.delete(key)
        client.close()
    except Exception:
        pass  # no Redis here: the in-memory fallback is already per-process

async def _admin_email():
    import database
    from models import AdminUser
    from sqlalchemy import select

    async with database.AsyncSessionLocal() as session:
        admin = (
            await session.execute(select(AdminUser).order_by(AdminUser.id).limit(1))
        ).scalars().first()
        assert admin is not None, "setup_test_db must create a test admin"
        return admin.email

async def _login(public_client, email, password, **headers):
    return await public_client.post(
        "/api/admin/login",
        json={"email": email, "password": password},
        headers=headers,
    )

# --- 1a: the limiter trusts only a configured proxy ------------------------

def _request_with(headers, peer="172.17.0.1"):
    from starlette.requests import Request

    return Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/admin/login",
            "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
            "client": (peer, 12345),
            "query_string": b"",
            "scheme": "http",
            "server": ("testserver", 80),
        }
    )

def test_forwarded_header_is_ignored_when_peer_is_not_a_trusted_proxy(monkeypatch):
    """The bug: the first X-Forwarded-For hop was believed unconditionally."""
    from middleware import rate_limit as rl
    from middleware.rate_limit import get_request_client_ip

    # Patch the module's own settings object: `test_deployment_fallbacks` pops
    # and re-imports `config`, so `config.settings` and `rate_limit.settings` can
    # be different objects by the time this runs.
    monkeypatch.setattr(rl.settings, "trusted_proxy_ips", "")
    request = _request_with(
        {"X-Forwarded-For": "203.0.113.10, 10.0.0.2", "X-Real-IP": "198.51.100.7"}
    )

    assert get_request_client_ip(request) == "172.17.0.1"

def test_forwarded_header_is_used_when_peer_is_a_trusted_proxy(monkeypatch):
    """The deployed nginx path must keep working once it is declared trusted."""
    from middleware import rate_limit as rl
    from middleware.rate_limit import get_request_client_ip

    monkeypatch.setattr(rl.settings, "trusted_proxy_ips", "172.17.0.1, 10.0.0.2")
    # Right-most non-proxy hop wins: the client can prepend arbitrary values.
    request = _request_with(
        {"X-Forwarded-For": "1.2.3.4, 203.0.113.10, 10.0.0.2"},
        peer="172.17.0.1",
    )

    assert get_request_client_ip(request) == "203.0.113.10"

def test_rotating_forwarded_header_cannot_reset_the_ip_budget(monkeypatch):
    """Measured bug: a fresh X-Forwarded-For per request never hit the 429."""
    from middleware import rate_limit as rl
    from middleware.rate_limit import get_request_client_ip

    monkeypatch.setattr(rl.settings, "trusted_proxy_ips", "")
    seen = {
        get_request_client_ip(_request_with({"X-Forwarded-For": f"203.0.113.{i}"}))
        for i in range(10)
    }

    assert seen == {"172.17.0.1"}

# --- 1a: failures only, and both keys -------------------------------------

@pytest.mark.asyncio
async def test_successful_logins_do_not_consume_the_brute_force_budget(client, public_client):
    """Measured bug: 7 correct logins returned [200 x5, 429, 429]."""
    email = await _admin_email()

    statuses = [
        (await _login(public_client, email, EXISTING_PASSWORD)).status_code
        for _ in range(7)
    ]

    assert statuses == [200] * 7, statuses

@pytest.mark.asyncio
async def test_failed_logins_still_rate_limit(client, public_client):
    email = await _admin_email()

    statuses = [
        (await _login(public_client, email, WRONG_PASSWORD)).status_code
        for _ in range(7)
    ]

    assert statuses[:5] == [401] * 5, statuses
    assert statuses[5:] == [429, 429], statuses

@pytest.mark.asyncio
async def test_rotating_ip_cannot_grind_one_account(client, public_client):
    """The account key is what makes a rotating IP useless."""
    email = await _admin_email()

    statuses = [
        (
            await _login(
                public_client,
                email,
                WRONG_PASSWORD,
                **{"X-Forwarded-For": f"203.0.113.{i}"},
            )
        ).status_code
        for i in range(7)
    ]

    assert statuses[:5] == [401] * 5, statuses
    assert statuses[5:] == [429, 429], statuses

@pytest.mark.asyncio
async def test_redis_records_are_read_without_being_written_by_the_check(monkeypatch):
    """A pre-check must not spend the budget it is checking."""
    fake = _FakeRedis()

    async def fake_redis():
        return fake

    monkeypatch.setattr("services.redis_service.get_redis", fake_redis)
    key = f"{auth_module.LOGIN_IP_KEY_PREFIX}10.0.0.9"

    for _ in range(5):
        allowed, _ = await auth_module._login_keys_over_limit([key], 5, 300)
        assert allowed is True
        assert await fake.zcard(key) == 0

    await auth_module._record_login_failure_everywhere([key], 300)
    # The record must have landed in Redis, not silently in the memory fallback.
    assert await fake.zcard(key) == 1

    allowed, retry_after = await auth_module._login_keys_over_limit([key], 1, 300)

    assert allowed is False
    assert retry_after == 300

# --- 1b: one generic 401 for both wrong inputs ----------------------------

@pytest.mark.asyncio
async def test_unknown_email_and_wrong_password_are_indistinguishable(client, public_client):
    """Measured bug: 该邮箱未注册 vs 密码错误 — an account-existence oracle."""
    email = await _admin_email()

    unknown = await _login(public_client, "nobody@example.com", WRONG_PASSWORD)
    wrong = await _login(public_client, email, WRONG_PASSWORD)

    assert unknown.status_code == wrong.status_code == 401
    assert unknown.json() == wrong.json()
    assert unknown.content == wrong.content
    assert unknown.json()["detail"] == "邮箱或密码不正确"

@pytest.mark.asyncio
async def test_generic_message_is_localized(public_client):
    response = await _login(
        public_client,
        "nobody@example.com",
        WRONG_PASSWORD,
        **{"Accept-Language": "en-US"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password"

def test_account_key_does_not_leak_the_address():
    key = auth_module.login_account_key("Someone@Example.com")

    assert key.startswith(auth_module.LOGIN_ACCOUNT_KEY_PREFIX)
    assert "someone" not in key
    assert key.endswith(
        hashlib.sha256(b"someone@example.com").hexdigest()
    )
