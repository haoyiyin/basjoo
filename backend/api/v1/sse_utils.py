"""SSE helpers for streaming endpoints."""

import json
from typing import Any


def sse_event(event: str, data: dict[str, Any]) -> str:
    """Format a Server-Sent Events payload."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
