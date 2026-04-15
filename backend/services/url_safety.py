"""URL safety validation to prevent SSRF attacks."""

from functools import lru_cache
import ipaddress
import logging
import socket
from urllib.parse import urlsplit

logger = logging.getLogger(__name__)

_ALLOWED_SCHEMES = frozenset({"http", "https"})


def _is_unsafe_ip(host: str) -> bool:
    """Check if a resolved IP or literal IP falls in unsafe ranges."""
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return False

    if addr.is_loopback or addr.is_private or addr.is_reserved:
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

    Returns (is_safe, reason).
    Blocks localhost, private IPs, cloud metadata, and credentials in URLs.
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

    if hostname_lower in ("localhost", ""):
        return False, "localhost is not allowed"

    # Reject direct IP literals
    try:
        ipaddress.ip_address(hostname_lower)
        return False, "Direct IP literals are not allowed"
    except ValueError:
        pass

    # Resolve hostname and check resolved IPs
    return _resolve_and_check(hostname_lower)
