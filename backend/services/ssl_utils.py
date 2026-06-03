"""SSL context utilities for external HTTPS calls."""

import ssl
import logging

logger = logging.getLogger(__name__)


def create_ssl_context() -> ssl.SSLContext:
    """Create a default SSL context that tolerates improper TLS closure."""
    context = ssl.create_default_context()
    try:
        context.options |= ssl.OP_IGNORE_UNEXPECTED_EOF
    except AttributeError:
        logger.debug("ssl.OP_IGNORE_UNEXPECTED_EOF not available")
    return context
