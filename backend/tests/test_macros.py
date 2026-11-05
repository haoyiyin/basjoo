"""#74 — operator reply macros: CRUD, the two caps, workspace scope, auth.

The contract these tests defend:

* A macro survives the round trip: create answers 201 with the row, the list
  carries it, a patch writes only what was sent, a delete answers
  ``{"success": true}`` and the row is gone.
* ``name <= 200`` and ``body <= 2500`` are the **schema's** caps, not the
  route's, so both create and patch reject an over-long value with a 422 that
  points at ``body.<field>`` — a cap that only held on create would let the
  console grow a macro past what its editor can render.
* Workspace scope has no existence oracle: a macro from another workspace
  answers the *same* 404 body as an id that never existed, on patch and on
  delete alike.
* Every route is admin-guarded.
"""

import pytest
from sqlalchemy import select

import database


def _caps() -> tuple[int, int]:
    """The frozen schema caps, imported lazily.

    ``api.v1.schemas`` cannot be the first module a test file imports: it pulls
    ``services`` -> ``file_service`` -> ``api.v1.schemas`` again and the
    partially-initialised module has no ``FileItem`` yet. Every other test file
    reads it after the app is up, so these do too.
    """
    from api.v1.schemas import MACRO_BODY_MAX_LENGTH, MACRO_NAME_MAX_LENGTH

    return MACRO_NAME_MAX_LENGTH, MACRO_BODY_MAX_LENGTH


async def _admin_id(email: str) -> int:
    from models import AdminUser

    async with database.AsyncSessionLocal() as session:
        admin = await session.scalar(select(AdminUser).where(AdminUser.email == email))
        assert admin is not None
        return admin.id


async def _macro_count() -> int:
    from models import ReplyMacro

    async with database.AsyncSessionLocal() as session:
        rows = (await session.execute(select(ReplyMacro))).scalars().all()
        return len(rows)


def _field_error_fields(response) -> set:
    """The set of ``body.<field>`` names the 422 points at."""
    return {tuple(item["loc"]) for item in response.json()["detail"]}


def _macro_body(**overrides) -> dict:
    body = {
        "name": "Refund policy",
        "body": "We refund within 30 days of purchase. {{visitor.name}} — reply with the order id.",
    }
    body.update(overrides)
    return body


@pytest.mark.asyncio(loop_scope="function")
async def test_crud_round_trip(client):
    """create → list → patch → delete, with the row shape the console reads."""
    created = await client.post("/api/v1/admin/macros", json=_macro_body())
    assert created.status_code == 201, created.text
    macro = created.json()
    macro_id = macro["id"]
    assert macro["name"] == "Refund policy"
    assert macro["body"].startswith("We refund within 30 days")
    assert macro["workspace_id"] is not None
    assert macro["created_at"]
    # `created_by` is the authenticated admin, never something the body asked for.
    assert macro["created_by"] == await _admin_id("test@example.com")

    listed = await client.get("/api/v1/admin/macros")
    assert listed.status_code == 200, listed.text
    payload = listed.json()
    assert payload["total"] == 1
    assert [row["id"] for row in payload["items"]] == [macro_id]

    patched = await client.patch(
        f"/api/v1/admin/macros/{macro_id}", json={"body": "Updated refund copy."}
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["body"] == "Updated refund copy."
    # A partial patch leaves the untouched field alone.
    assert patched.json()["name"] == "Refund policy"

    deleted = await client.delete(f"/api/v1/admin/macros/{macro_id}")
    assert deleted.status_code == 200, deleted.text
    assert deleted.json() == {"success": True}

    after = await client.get("/api/v1/admin/macros")
    assert after.json()["total"] == 0
    assert await _macro_count() == 0


@pytest.mark.asyncio(loop_scope="function")
async def test_create_caps_are_422(client):
    """name > 200 and body > 2500 are field-level 422s, and nothing is written."""
    name_cap, body_cap = _caps()
    too_long_name = await client.post(
        "/api/v1/admin/macros", json=_macro_body(name="n" * (name_cap + 1))
    )
    assert too_long_name.status_code == 422, too_long_name.text
    assert ("body", "name") in _field_error_fields(too_long_name)

    too_long_body = await client.post(
        "/api/v1/admin/macros", json=_macro_body(body="x" * (body_cap + 1))
    )
    assert too_long_body.status_code == 422, too_long_body.text
    assert ("body", "body") in _field_error_fields(too_long_body)

    assert await _macro_count() == 0


@pytest.mark.asyncio(loop_scope="function")
async def test_create_accepts_the_exact_caps(client):
    """The boundary is inclusive: 200/2500 fit, 201/2501 do not."""
    name_cap, body_cap = _caps()
    response = await client.post(
        "/api/v1/admin/macros",
        json=_macro_body(name="n" * name_cap, body="x" * body_cap),
    )
    assert response.status_code == 201, response.text
    assert len(response.json()["name"]) == name_cap
    assert len(response.json()["body"]) == body_cap


@pytest.mark.asyncio(loop_scope="function")
async def test_patch_caps_are_422(client):
    """The same caps hold on patch — the editor can grow a macro past them."""
    name_cap, body_cap = _caps()
    macro_id = (
        await client.post("/api/v1/admin/macros", json=_macro_body())
    ).json()["id"]

    too_long_name = await client.patch(
        f"/api/v1/admin/macros/{macro_id}",
        json={"name": "n" * (name_cap + 1)},
    )
    assert too_long_name.status_code == 422, too_long_name.text
    assert ("body", "name") in _field_error_fields(too_long_name)

    too_long_body = await client.patch(
        f"/api/v1/admin/macros/{macro_id}",
        json={"body": "x" * (body_cap + 1)},
    )
    assert too_long_body.status_code == 422, too_long_body.text
    assert ("body", "body") in _field_error_fields(too_long_body)

    # The rejected patches did not half-apply.
    unchanged = await client.get("/api/v1/admin/macros")
    row = unchanged.json()["items"][0]
    assert row["id"] == macro_id
    assert row["name"] == "Refund policy"


@pytest.mark.asyncio(loop_scope="function")
async def test_blank_name_and_body_are_422(client):
    """`"   "` clears min_length but is not a macro an operator can pick."""
    blank_name = await client.post(
        "/api/v1/admin/macros", json=_macro_body(name="   ")
    )
    assert blank_name.status_code == 422, blank_name.text
    assert ("body", "name") in _field_error_fields(blank_name)

    blank_body = await client.post(
        "/api/v1/admin/macros", json=_macro_body(body="  \n ")
    )
    assert blank_body.status_code == 422, blank_body.text
    assert ("body", "body") in _field_error_fields(blank_body)


@pytest.mark.asyncio(loop_scope="function")
async def test_foreign_workspace_macro_is_404_like_a_missing_one(client):
    """No existence leak: another workspace's macro answers exactly like a ghost id.

    The foreign row is built directly against the DB (the API could not create
    it for a workspace the caller does not belong to), then patch and delete are
    compared against a genuinely absent id — status *and* body must match.
    """
    from models import ReplyMacro, Workspace, WorkspaceQuota

    async with database.AsyncSessionLocal() as db:
        other = Workspace(name="Other Workspace", owner_email="other@example.com")
        db.add(other)
        await db.flush()
        db.add(WorkspaceQuota(workspace_id=other.id))
        foreign = ReplyMacro(
            workspace_id=other.id,
            name="Foreign macro",
            body="Belongs to somebody else.",
        )
        db.add(foreign)
        await db.commit()
        foreign_id = foreign.id

    missing_id = "00000000-0000-0000-0000-000000000000"

    for method, path in (
        ("patch", f"/api/v1/admin/macros/{{}}"),
        ("delete", f"/api/v1/admin/macros/{{}}"),
    ):
        kwargs = {"json": {"name": "n", "body": "b"}} if method == "patch" else {}
        foreign_response = await getattr(client, method)(
            path.format(foreign_id), **kwargs
        )
        missing_response = await getattr(client, method)(
            path.format(missing_id), **kwargs
        )
        assert foreign_response.status_code == 404, foreign_response.text
        assert missing_response.status_code == 404, missing_response.text
        # Identical, not merely both 404: a different detail is an oracle.
        assert foreign_response.json() == missing_response.json()

    # The foreign row is untouched by the failed writes, and invisible to list.
    listed = await client.get("/api/v1/admin/macros")
    assert listed.json()["total"] == 0

    from models import ReplyMacro as Macro

    async with database.AsyncSessionLocal() as db:
        assert await db.scalar(select(Macro).where(Macro.id == foreign_id)) is not None


@pytest.mark.asyncio(loop_scope="function")
async def test_routes_require_auth(public_client):
    """Every macro route refuses an unauthenticated caller."""
    created = await public_client.get("/api/v1/admin/macros")
    assert created.status_code in (401, 403), created.text

    posted = await public_client.post("/api/v1/admin/macros", json=_macro_body())
    assert posted.status_code in (401, 403), posted.text

    patched = await public_client.patch(
        "/api/v1/admin/macros/whatever", json={"name": "n"}
    )
    assert patched.status_code in (401, 403), patched.text

    deleted = await public_client.delete("/api/v1/admin/macros/whatever")
    assert deleted.status_code in (401, 403), deleted.text

    assert await _macro_count() == 0


@pytest.mark.asyncio(loop_scope="function")
async def test_readonly_role_is_refused(client, readonly_client):
    """`require_chat_operator` is what guards this router, so a legacy readonly
    role answers 403 rather than reading the workspace's macros."""
    response = await readonly_client.get("/api/v1/admin/macros")
    assert response.status_code == 403, response.text


@pytest.mark.asyncio(loop_scope="function")
async def test_support_operator_can_use_macros(support_client):
    """Support staff reply to customers, so they own the macros too."""
    created = await support_client.post("/api/v1/admin/macros", json=_macro_body())
    assert created.status_code == 201, created.text

    listed = await support_client.get("/api/v1/admin/macros")
    assert listed.status_code == 200, listed.text
    assert listed.json()["total"] == 1
