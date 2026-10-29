"""i18n catalog integrity + localized account-password errors.

* every msgid in a tracked `.po` must be in the corresponding tracked `.mo`
  (catches a stale/binary-out-of-date catalog, which is easy to produce because
  there is no `msgfmt` on the build hosts — `scripts/compile_mo.py` is the
  replacement and is exercised here for the round trip);
* `POST /api/admin/me/password` must localize its two validation errors, and
  still answer the historical English text when the client declares no locale.
"""

import gettext
import importlib.util
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
LOCALES_DIR = BACKEND_DIR / "i18n" / "locales"
LOCALES = ("en_US", "zh_CN")

EXISTING_PASSWORD = "testpassword123"  # conftest's test admin
NEW_PASSWORD = "brandnew-password-456"


def _load_compile_mo():
    spec = importlib.util.spec_from_file_location(
        "compile_mo", BACKEND_DIR / "scripts" / "compile_mo.py"
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


compile_mo = _load_compile_mo()


def _po_path(locale: str) -> Path:
    return LOCALES_DIR / locale / "LC_MESSAGES" / "messages.po"


def _mo_catalog(locale: str) -> dict:
    mo_path = _po_path(locale).with_suffix(".mo")
    assert mo_path.exists(), f"missing tracked catalog {mo_path}"
    translation = gettext.translation(
        "messages",
        localedir=str(mo_path.parent.parent.parent),
        languages=[locale],
    )
    return translation._catalog  # noqa: SLF001 - the only public-enough view of the .mo


@pytest.mark.parametrize("locale", LOCALES)
def test_every_po_msgid_is_present_and_translated_in_the_mo(locale: str) -> None:
    messages = compile_mo.parse_po(_po_path(locale).read_text(encoding="utf-8"))
    catalog = _mo_catalog(locale)

    assert messages, f"{locale}: empty catalog"
    for msgid, msgstr in messages.items():
        if not msgid:
            continue  # header block
        assert msgid in catalog, f"{locale}: {msgid!r} missing from messages.mo (stale .mo)"
        assert catalog[msgid] == msgstr, f"{locale}: {msgid!r} is stale in messages.mo"


@pytest.mark.parametrize("locale", LOCALES)
def test_compile_mo_round_trips_through_gettext(locale: str) -> None:
    """The stdlib compiler output is readable by gettext (in-memory proof)."""
    messages = compile_mo.parse_po(_po_path(locale).read_text(encoding="utf-8"))
    blob = compile_mo.compile_mo(messages)
    assert blob[:4] == b"\xde\x12\x04\x95", "little-endian .mo magic"

    # Same content the tracked file carries, byte for byte: a hand-edited .mo
    # that drifts from the .po is caught by the assertion above, this one proves
    # the generator itself did not change shape.
    assert blob == _po_path(locale).with_suffix(".mo").read_bytes()


@pytest.mark.asyncio
async def test_wrong_password_is_chinese_for_zh_cn(client):
    response = await client.post(
        "/api/admin/me/password",
        json={"current_password": "totally-wrong-123", "new_password": NEW_PASSWORD},
        headers={"Accept-Language": "zh-CN"},
    )

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "当前密码不正确"


@pytest.mark.asyncio
async def test_wrong_password_locale_query_param_wins_over_header(client):
    response = await client.post(
        "/api/admin/me/password?locale=zh-CN",
        json={"current_password": "totally-wrong-123", "new_password": NEW_PASSWORD},
        headers={"Accept-Language": "en-US"},
    )

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "当前密码不正确"


@pytest.mark.asyncio
async def test_wrong_password_is_english_for_en_us(client):
    response = await client.post(
        "/api/admin/me/password",
        json={"current_password": "totally-wrong-123", "new_password": NEW_PASSWORD},
        headers={"Accept-Language": "en-US"},
    )

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Current password is incorrect"


@pytest.mark.asyncio
async def test_short_password_is_chinese_for_zh_cn(client):
    response = await client.post(
        "/api/admin/me/password",
        json={"current_password": EXISTING_PASSWORD, "new_password": "shortie"},
        headers={"Accept-Language": "zh-CN"},
    )

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "密码长度至少为8个字符"


@pytest.mark.asyncio
async def test_no_declared_locale_keeps_the_english_contract(client):
    """Locale-less API clients keep the pre-i18n text (test_account_password pins it)."""
    response = await client.post(
        "/api/admin/me/password",
        json={"current_password": "totally-wrong-123", "new_password": NEW_PASSWORD},
    )

    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "Current password is incorrect"
