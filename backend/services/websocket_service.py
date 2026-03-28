"""WebSocket connection manager with Redis pub/sub for cross-worker broadcasting."""

import asyncio
import json
import logging
from typing import Dict, Set

from fastapi import WebSocket

logger = logging.getLogger(__name__)

ADMIN_CHANNEL = "admin_chat_updates"


class ConnectionManager:
    """Manages active admin WebSocket connections on this worker."""

    def __init__(self):
        self._connections: Set[WebSocket] = set()
        self._listener_task: asyncio.Task | None = None

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self._connections.add(websocket)
        logger.info(f"Admin WebSocket connected, total: {len(self._connections)}")

        if self._listener_task is None or self._listener_task.done():
            self._listener_task = asyncio.create_task(self._redis_listener())

    def disconnect(self, websocket: WebSocket):
        self._connections.discard(websocket)
        logger.info(f"Admin WebSocket disconnected, total: {len(self._connections)}")

    async def broadcast_local(self, message: dict):
        """Send a message to all connections on this worker."""
        dead: list[WebSocket] = []
        for ws in self._connections:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self._connections.discard(ws)

    async def publish(self, message: dict):
        """Publish a message via Redis so all workers receive it."""
        try:
            from services.redis_service import get_redis

            redis = await get_redis()
            await redis.publish(ADMIN_CHANNEL, message)
        except Exception as e:
            logger.error(f"WebSocket publish failed: {e}")
            await self.broadcast_local(message)

    async def _redis_listener(self):
        """Background task: subscribe to Redis and forward to local connections."""
        try:
            from services.redis_service import get_redis

            redis = await get_redis()
            pubsub = redis.get_pubsub()
            await pubsub.subscribe(ADMIN_CHANNEL)
            logger.info("Redis pub/sub listener started for admin WebSocket")

            while self._connections:
                try:
                    msg = await pubsub.get_message(
                        ignore_subscribe_messages=True, timeout=1.0
                    )
                    if msg and msg["type"] == "message":
                        data = json.loads(msg["data"])
                        await self.broadcast_local(data)
                except Exception as e:
                    logger.error(f"Redis listener error: {e}")
                    await asyncio.sleep(1)

            await pubsub.unsubscribe(ADMIN_CHANNEL)
            await pubsub.close()
            logger.info("Redis pub/sub listener stopped (no connections)")
        except Exception as e:
            logger.error(f"Redis listener fatal error: {e}")


manager = ConnectionManager()
