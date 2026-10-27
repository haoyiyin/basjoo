"""URL safety validation.

SSRF protection is OFF by default: an installation behind a proxy resolver
(sing-box / clash fake-ip, corporate split-horizon DNS) hands out addresses in
private and ULA ranges for ordinary public sites, so the resolved-IP check
rejects every real fetch. Enable it with `SSRF_PROTECTION_ENABLED=true` when
the deployment is reachable by untrusted users and its own network is worth
protecting (cloud metadata, internal admin surfaces).

Scheme, credential and empty-host checks always run — they are input hygiene,
not SSRF: they cost no DNS lookup and keep `file://` out of the fetcher.
"""

from functools import lru_cache
import ipaddress
import logging
import socket
from urllib.parse import urlsplit

from config import settings

logger = logging.getLogger(__name__)

_ALLOWED_SCHEMES = frozenset({"http", "https"})


def _is_unsafe_ip(host: str) -> bool:
    """Check if a resolved IP or literal IP falls in unsafe ranges."""
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False

    # 198.18.0.0/15 is IANA benchmarking range (RFC 2544).
    # Some hosting providers assign real public websites from this range,
    # and Python's ipaddress classifies it as is_private incorrectly.
    if addr in ipaddress.ip_network("198.18.0.0/15"):
        return False

    if addr.is_loopback or addr.is_private:
        return True
    if addr.is_link_local or addr.is_multicast or addr.is_unspecified:
        return True
    return False


@lru_cache(maxsize=512)
def _resolve_and_check(hostname: str) -> tuple[bool, str]:
    """Resolve hostname and check all resolved IPs for safety."""
    try:
        infos = socket.getaddrinfo(hostname, None)
    except OSError as e:
        return False, f"DNS resolution failed: {e}"

    seen_ips = set()
    for family, _, _, _, sockaddr in infos:
        ip_str = sockaddr[0]
        if ip_str in seen_ips:
            continue
        seen_ips.add(ip_str)
        if _is_unsafe_ip(ip_str):
            return False, f"Resolved to blocked IP {ip_str}"
    return True, ""


def validate_url_safe(url: str) -> tuple[bool, str]:
    """Validate that a URL is safe to fetch.

    Returns (is_safe, reason). Scheme, credential, empty-host, `localhost` and
    direct-IP-literal checks always run. With SSRF protection enabled the
    validator also resolves the hostname and rejects private/special-use IPs
    (loopback, RFC1918, link-local, cloud metadata); with it disabled only the
    no-DNS checks apply.
    """
    if not url:
        return False, "URL is empty"

    try:
        parsed = urlsplit(url)
    except ValueError as e:
        return False, f"Invalid URL: {e}"

    scheme = parsed.scheme.lower()
    if scheme not in _ALLOWED_SCHEMES:
        return False, f"Scheme '{scheme}' is not allowed"

    if parsed.username or parsed.password:
        return False, "URLs with embedded credentials are not allowed"

    hostname = parsed.hostname
    if not hostname:
        return False, "URL has no hostname"

    hostname_lower = hostname.lower()

    if hostname_lower == "localhost":
        return False, "localhost is not allowed"

    # Reject direct IP literals
    try:
        ipaddress.ip_address(hostname_lower)
        return False, "Direct IP literals are not allowed"
    except ValueError:
        pass

    # Only the DNS-range half is gated: it is the check that misfires behind a
    # fake-ip / ULA resolver. The literal checks above need no lookup, so they
    # stay on and keep `scrapling-service` (which enforces the same pair
    # unconditionally) from accepting URLs the backend would have rejected.
    if not settings.ssrf_protection_enabled:
        return True, ""

    # Resolve hostname and check resolved IPs
    return _resolve_and_check(hostname_lower)
