"""SSRF protection is a switch, and it is OFF by default.

Why this file exists: a host whose resolver answers with fake-ip / ULA
addresses (sing-box, clash, split-horizon corporate DNS) hands out private
addresses for ordinary public sites. With the resolved-IP check unconditionally
on, every real fetch is rejected as "Resolved to blocked IP" — measured on a Mac
whose `utun6` resolver answered `github.com -> 198.0.0.34, fd27:712::c600:22`,
where the ULA address made the whole site unfetchable while `curl` inside the
same container returned 200.

Both halves are pinned here:
* default (no env var) => a hostname resolving into ULA/private space is accepted,
* `SSRF_PROTECTION_ENABLED=true` => the same hostname is rejected.

The input-hygiene checks (scheme, credentials, empty host) must hold in BOTH
modes; they involve no DNS lookup, so disabling SSRF must not disable them.
"""

import pytest

import services.url_safety as url_safety


def _settings_with(monkeypatch, enabled: bool):
    """Point the module's settings at the requested flag value.

    Patch the very object `url_safety` imported, not `config.settings`: other
    suites reload `config`, which rebinds `config.settings` to a fresh instance
    while this module keeps the old reference.
    """
    monkeypatch.setattr(
        url_safety.settings, "ssrf_protection_enabled", enabled, raising=True
    )
    return url_safety.settings


def test_default_is_disabled():
    """Shipping default must be off, not merely overridable."""
    from config import Settings

    assert Settings().ssrf_protection_enabled is False


def test_disabled_accepts_host_resolving_into_private_space(monkeypatch):
    """The reported bug: a public site resolving to a ULA address is fetchable."""
    _settings_with(monkeypatch, False)
    monkeypatch.setattr(
        url_safety,
        "_resolve_and_check",
        lambda hostname: (False, "Resolved to blocked IP fd27:712::c600:22"),
        raising=True,
    )

    safe, reason = url_safety.validate_url_safe("https://github.com/haoyiyin/basjoo")

    assert safe is True, reason


def test_enabled_still_rejects_private_resolution(monkeypatch):
    """The flip side: turning the switch on restores the real guard."""
    _settings_with(monkeypatch, True)
    monkeypatch.setattr(
        url_safety,
        "_resolve_and_check",
        lambda hostname: (False, "Resolved to blocked IP fd27:712::c600:22"),
        raising=True,
    )

    safe, reason = url_safety.validate_url_safe("https://github.com/haoyiyin/basjoo")

    assert safe is False
    assert "fd27:712::c600:22" in reason


def test_direct_ip_literal_rejected_in_both_modes(monkeypatch):
    """Literal checks need no DNS, so they stay on with the switch off."""
    for enabled in (False, True):
        _settings_with(monkeypatch, enabled)
        safe, reason = url_safety.validate_url_safe("http://93.184.216.34/")
        assert safe is False, f"accepted IP literal with ssrf={enabled}"
        assert "Direct IP literals" in reason


def test_localhost_rejected_in_both_modes(monkeypatch):
    for enabled in (False, True):
        _settings_with(monkeypatch, enabled)
        safe, reason = url_safety.validate_url_safe("http://localhost:6379/")
        assert safe is False, f"accepted localhost with ssrf={enabled}"
        assert "localhost" in reason


@pytest.mark.parametrize(
    "url,expected_fragment",
    [
        ("ftp://example.com/file", "Scheme"),
        ("https://user:pw@example.com/", "credentials"),
        ("", "empty"),
    ],
)
def test_input_hygiene_holds_in_both_modes(monkeypatch, url, expected_fragment):
    """Disabling SSRF must not turn the validator into a no-op."""
    for enabled in (False, True):
        _settings_with(monkeypatch, enabled)
        safe, reason = url_safety.validate_url_safe(url)
        assert safe is False, f"accepted {url!r} with ssrf={enabled}"
        assert expected_fragment.lower() in reason.lower(), (url, enabled, reason)
