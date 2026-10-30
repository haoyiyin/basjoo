"""Issue #46 — signed visitor identity (HMAC-SHA256 over the visitor's email).

The four acceptance boxes, restated as the tests below prove them:

1. *A mismatched hash is rejected with 403 and the widget explains why.* —
   `test_mismatched_hash_is_rejected_with_403_and_a_machine_code` asserts the
   status, the `identity_mismatch` code on both HTTP and the SSE surface, and
   the readable sentence the stream carries.
2. *The same email on a second device resumes the same history.* —
   `test_same_email_on_a_second_device_resumes_the_same_history` computes the
   identity exactly as a host application would, then reads the first device's
   transcript with nothing but that identity.
3. *Delete removes messages, sessions and leads* — `test_visitor_deletion.py`.
4. *Agents without an identity secret behave exactly as today.* —
   `test_unsigned_visitor_is_unchanged_when_no_secret_is_configured`.

Plus the two guards the brief calls out explicitly:

* constant-time comparison: a wrong hash of the right length and a wrong-length
  hash must answer *identically* (a length oracle would defeat the point);
* the per-session ownership check stays as a second gate, so a correctly signed
  identity for somebody else's session is still a 404, not a 403.
"""

import hashlib
import hmac

import pytest
from sqlalchemy import select

import database
from core.encryption import encrypt_api_key
from models import Agent, ChatMessage, ChatSession
from services.visitor_identity import (
    DIGEST_HEX_LENGTH,
    build_visitor_identity,
    compute_identity_digest,
)

SECRET = "host-app-signing-secret-46"
EMAIL = "ada@example.com"
IDENTITY = f"{EMAIL}:{compute_identity_digest(SECRET, EMAIL)}"

async def _set_identity_secret(agent_id: str, secret: str | None) -> None:
    async with database.AsyncSessionLocal() as db:
        agent = await db.get(Agent, agent_id)
        assert agent is not None
        agent.identity_secret = encrypt_api_key(secret) if secret else None
        await db.commit()

async def _chat(public_client, agent_id: str, message: str, **extra):
    return await public_client.post(
        "/api/v1/chat",
        json={"agent_id": agent_id, "message": message, **extra},
    )

async def _sessions_for(visitor_id: str) -> list[ChatSession]:
    async with database.AsyncSessionLocal() as db:
        rows = await db.execute(
            select(ChatSession)
            .where(ChatSession.visitor_id == visitor_id)
            .order_by(ChatSession.created_at)
        )
        return list(rows.scalars().all())

# ------------------------------------------------ 1. mismatch is a 403 + code

@pytest.mark.asyncio
async def test_mismatched_hash_is_rejected_with_403_and_a_machine_code(
    public_client, default_agent_id
):
    """A forged digest is refused before anything is created or answered."""
    await _set_identity_secret(default_agent_id, SECRET)
    forged = f"{EMAIL}:{hashlib.sha256(b'not-the-secret').hexdigest()}"

    response = await _chat(public_client, default_agent_id, "hello", visitor_id=forged)

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "identity_mismatch"
    # Nothing was written for the rejected identity.
    assert await _sessions_for(forged) == []

@pytest.mark.asyncio
async def test_stream_rejection_carries_the_code_and_a_readable_sentence(
    public_client, default_agent_id
):
    """The widget's streaming path gets `code: identity_mismatch`, not a bare 403."""
    await _set_identity_secret(default_agent_id, SECRET)

    response = await public_client.post(
        "/api/v1/chat/stream",
        json={
            "agent_id": default_agent_id,
            "message": "hello",
            "visitor_id": f"{EMAIL}:{'0' * DIGEST_HEX_LENGTH}",
        },
    )

    # The SSE surface reports errors as an event, exactly like every other
    # rejected stream; the body must carry the machine code AND a sentence a
    # visitor can read.
    body = response.text
    assert '"code": "identity_mismatch"' in body, body
    assert "identity could not be verified" in body.lower(), body

@pytest.mark.asyncio
async def test_missing_identity_is_rejected_when_the_agent_signs(
    public_client, default_agent_id
):
    """An agent with a secret accepts only signed identities — not the old random id."""
    await _set_identity_secret(default_agent_id, SECRET)

    response = await _chat(
        public_client, default_agent_id, "hello", visitor_id="visitor_abc_123"
    )

    assert response.status_code == 403, response.text
    assert response.json()["detail"] == "identity_mismatch"

# ------------------------------------- 2. same email, second device, same history

@pytest.mark.asyncio
async def test_same_email_on_a_second_device_resumes_the_same_history(
    public_client, default_agent_id
):
    """The signed identity *is* the visitor_id, so history follows the person.

    The host application computes the identity on the server after login, so
    this test plays the host's part: it derives the value from the secret and
    the email, then uses nothing else. A second "device" shares no localStorage
    — it only has the same email and the same host page.
    """
    await _set_identity_secret(default_agent_id, SECRET)

    first = await _chat(
        public_client,
        default_agent_id,
        "my order number is 4471",
        visitor_id=IDENTITY,
    )
    assert first.status_code == 200, first.text
    first_session = first.json()["session_id"]

    # A different device signs in with the same email and asks for its current
    # session — this is what the widget does on load.
    resolved = await public_client.get(
        "/api/v1/chat/session:current",
        params={"agent_id": default_agent_id, "visitor_id": IDENTITY},
    )
    assert resolved.status_code == 200, resolved.text
    assert resolved.json()["session_id"] == first_session

    # …and the transcript it reads is device 1's, byte for byte.
    history = await public_client.get(
        "/api/v1/chat/messages",
        params={"session_id": resolved.json()["session_id"], "visitor_id": IDENTITY},
    )
    assert history.status_code == 200, history.text
    contents = [message["content"] for message in history.json()]
    assert "my order number is 4471" in contents

    # One visitor, one thread: the row carries the signed identity, so an
    # operator filtering sessions by it finds the whole conversation.
    sessions = await _sessions_for(IDENTITY)
    assert [row.session_id for row in sessions] == [first_session]
    assert sessions[0].visitor_id == IDENTITY

@pytest.mark.asyncio
async def test_every_public_surface_rejects_a_forged_identity(
    public_client, default_agent_id
):
    """The gate is not just on the turn — every public route that trusts `visitor_id` has it.

    A visitor could otherwise learn a session id from a screenshot and use the
    *reading* routes with a guessed identity, so `/chat/messages`, `/chat/escalate`,
    `/chat/release` and `/chat/session:current` all verify before they act. All
    four answer the same 403 with the same machine code, which is what lets the
    widget show one sentence.
    """
    await _set_identity_secret(default_agent_id, SECRET)
    forged = f"{EMAIL}:{'b' * DIGEST_HEX_LENGTH}"

    async with database.AsyncSessionLocal() as db:
        victim = ChatSession(
            agent_id=default_agent_id,
            session_id="sess_gate_46",
            visitor_id=IDENTITY,
            status="active",
        )
        db.add(victim)
        await db.flush()
        db.add(ChatMessage(session_id=victim.id, role="user", content="private"))
        await db.commit()
        victim_public_id = victim.session_id

    reads = await public_client.get(
        "/api/v1/chat/messages",
        params={"session_id": victim_public_id, "visitor_id": forged},
    )
    assert reads.status_code == 403, reads.text
    assert reads.json()["detail"] == "identity_mismatch"

    escalate = await public_client.post(
        "/api/v1/chat/escalate",
        json={
            "agent_id": default_agent_id,
            "session_id": victim_public_id,
            "visitor_id": forged,
        },
    )
    assert escalate.status_code == 403, escalate.text
    assert escalate.json()["detail"] == "identity_mismatch"

    release = await public_client.post(
        "/api/v1/chat/release",
        json={
            "agent_id": default_agent_id,
            "session_id": victim_public_id,
            "visitor_id": forged,
        },
    )
    assert release.status_code == 403, release.text
    assert release.json()["detail"] == "identity_mismatch"

    current = await public_client.get(
        "/api/v1/chat/session:current",
        params={"agent_id": default_agent_id, "visitor_id": forged},
    )
    assert current.status_code == 403, current.text
    assert current.json()["detail"] == "identity_mismatch"

    # Nothing was mutated by any of the rejected calls.
    async with database.AsyncSessionLocal() as db:
        row = (
            await db.execute(
                select(ChatSession).where(ChatSession.session_id == victim_public_id)
            )
        ).scalars().one()
        assert row.status == "active"
        assert row.mode != "human"

@pytest.mark.asyncio
async def test_session_current_is_scoped_to_the_identity_and_agent(
    public_client, default_agent_id
):
    """The resume lookup never confirms another visitor's session exists."""
    await _set_identity_secret(default_agent_id, SECRET)
    other = build_visitor_identity(SECRET, "grace@example.com")

    created = await _chat(
        public_client, default_agent_id, "grace was here", visitor_id=other
    )
    assert created.status_code == 200, created.text

    anonymous = await public_client.get(
        "/api/v1/chat/session:current",
        params={"agent_id": default_agent_id, "visitor_id": "visitor_nope"},
    )
    assert anonymous.status_code == 403, anonymous.text
    assert anonymous.json()["detail"] == "identity_mismatch"

    # A second, different but correctly signed identity simply has no session.
    mine = await public_client.get(
        "/api/v1/chat/session:current",
        params={"agent_id": default_agent_id, "visitor_id": IDENTITY},
    )
    assert mine.status_code == 200, mine.text
    assert mine.json()["session_id"] is None

# ------------------------------------------------------- 3. no length oracle

@pytest.mark.asyncio
async def test_wrong_length_hash_and_wrong_value_hash_answer_identically(
    public_client, default_agent_id
):
    """A wrong hash of the right length and a short one must not be distinguishable.

    `hmac.compare_digest` alone returns early on a length mismatch, so both
    sides are hashed to a fixed width before the comparison; this asserts the
    observable half — identical status and identical body — because that is all
    a remote attacker can measure.
    """
    await _set_identity_secret(default_agent_id, SECRET)
    right_length_wrong_value = f"{EMAIL}:{'a' * DIGEST_HEX_LENGTH}"
    wrong_length = f"{EMAIL}:{'a' * (DIGEST_HEX_LENGTH - 1)}"

    first = await _chat(
        public_client, default_agent_id, "x", visitor_id=right_length_wrong_value
    )
    second = await _chat(public_client, default_agent_id, "x", visitor_id=wrong_length)

    assert first.status_code == second.status_code == 403
    assert first.json() == second.json() == {"detail": "identity_mismatch"}

@pytest.mark.asyncio
async def test_digest_matches_a_locally_computed_hmac(default_agent_id):
    """The format is the contract the host application implements, so pin it."""
    expected = hmac.new(
        SECRET.encode(), EMAIL.encode(), hashlib.sha256
    ).hexdigest()

    assert compute_identity_digest(SECRET, EMAIL) == expected
    assert build_visitor_identity(SECRET, " Ada@Example.COM ") == f"{EMAIL}:{expected}"

# --------------------------------------------- 4. unconfigured agents unchanged

@pytest.mark.asyncio
async def test_unsigned_visitor_is_unchanged_when_no_secret_is_configured(
    public_client, default_agent_id
):
    """Regression guard: no secret means today's anonymous path, exactly.

    An existing embed sends `visitor_<ts>_<rand>` and must keep working with no
    403 anywhere — on the turn, on the transcript, on escalation and release.
    """
    await _set_identity_secret(default_agent_id, None)
    unsigned = "visitor_mlk2x9_abcdefgh"

    created = await _chat(
        public_client, default_agent_id, "no identity here", visitor_id=unsigned
    )
    assert created.status_code == 200, created.text
    session_id = created.json()["session_id"]

    history = await public_client.get(
        "/api/v1/chat/messages",
        params={"session_id": session_id, "visitor_id": unsigned},
    )
    assert history.status_code == 200, history.text
    assert any("no identity here" in m["content"] for m in history.json())

    escalate = await public_client.post(
        "/api/v1/chat/escalate",
        json={
            "agent_id": default_agent_id,
            "session_id": session_id,
            "visitor_id": unsigned,
        },
    )
    assert escalate.status_code == 200, escalate.text

    release = await public_client.post(
        "/api/v1/chat/release",
        json={
            "agent_id": default_agent_id,
            "session_id": session_id,
            "visitor_id": unsigned,
        },
    )
    assert release.status_code == 200, release.text

    # The resume lookup is a no-op for an anonymous agent: there is nothing to
    # verify, and minting a signed lookup for it would be a behaviour change.
    current = await public_client.get(
        "/api/v1/chat/session:current",
        params={"agent_id": default_agent_id, "visitor_id": unsigned},
    )
    assert current.status_code == 200, current.text
    assert current.json()["session_id"] == session_id

@pytest.mark.asyncio
async def test_config_public_advertises_whether_identity_is_required(
    public_client, default_agent_id
):
    """C2 `identity_required`: the widget learns this before it sends anything."""
    await _set_identity_secret(default_agent_id, None)
    plain = await public_client.get(f"/api/v1/config:public?agent_id={default_agent_id}")
    assert plain.status_code == 200, plain.text
    assert plain.json()["identity_required"] is False

    await _set_identity_secret(default_agent_id, SECRET)
    signed = await public_client.get(f"/api/v1/config:public?agent_id={default_agent_id}")
    assert signed.status_code == 200, signed.text
    assert signed.json()["identity_required"] is True

# ------------------------------------------- the second gate is still in place

@pytest.mark.asyncio
async def test_valid_signature_does_not_open_someone_elses_transcript(
    public_client, default_agent_id
):
    """A *correctly signed* identity for another visitor is still a 404.

    The signature proves who is asking; it must not prove ownership. Removing
    the per-session `visitor_id` comparison would turn this into a 200, which is
    exactly the enumeration hole #46 must not reopen.
    """
    await _set_identity_secret(default_agent_id, SECRET)
    grace = build_visitor_identity(SECRET, "grace@example.com")

    created = await _chat(public_client, default_agent_id, "grace private note", visitor_id=grace)
    assert created.status_code == 200, created.text
    grace_session = created.json()["session_id"]

    # Ada signs correctly, then asks for Grace's session.
    response = await public_client.get(
        "/api/v1/chat/messages",
        params={"session_id": grace_session, "visitor_id": IDENTITY},
    )
    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "Session not found"

@pytest.mark.asyncio
async def test_signed_identity_is_stored_and_round_trips_through_the_agent_payload(
    client, default_agent_id
):
    """The secret is write-only; the payload only says whether one is stored."""
    response = await client.put(
        f"/api/v1/agent?agent_id={default_agent_id}",
        json={"identity_secret": SECRET},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["identity_secret_set"] is True
    assert SECRET not in response.text

    # Stored encrypted, never in the clear.
    async with database.AsyncSessionLocal() as db:
        agent = await db.get(Agent, default_agent_id)
        assert agent is not None
        assert agent.identity_secret
        assert agent.identity_secret.startswith("enc:")
        assert SECRET not in agent.identity_secret

    # Clearing it restores the anonymous behaviour.
    cleared = await client.put(
        f"/api/v1/agent?agent_id={default_agent_id}",
        json={"identity_secret": ""},
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["identity_secret_set"] is False
