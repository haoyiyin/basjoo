import logging
from typing import Optional

import httpx

from config import settings

logger = logging.getLogger(__name__)

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


async def verify_turnstile_token(
    token: str,
    remote_ip: Optional[str] = None,
    secret_key: Optional[str] = None
) -> bool:
    """Validate a Cloudflare Turnstile token."""
    # Use provided secret key, fallback to global settings
    effective_secret = secret_key or settings.turnstile_secret_key
    if not effective_secret:
        return True

    if not token:
        return False

    data = {
        "secret": effective_secret,
        "response": token,
    }
    if remote_ip:
        data["remoteip"] = remote_ip

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(TURNSTILE_VERIFY_URL, data=data)
            response.raise_for_status()
    except Exception as exc:
        logger.warning("Turnstile verification request failed: %s", exc)
        return False

    try:
        payload = response.json()
    except ValueError:
        logger.warning("Turnstile verification returned invalid JSON")
        return False

    success = bool(payload.get("success"))
    if not success:
        logger.info(
            "Turnstile verification failed: %s",
            payload.get("error-codes", []),
        )
    return success
