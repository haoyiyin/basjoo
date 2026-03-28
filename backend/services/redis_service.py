"""Redis 服务

提供缓存、限流和任务队列功能
"""

import json
import logging
from typing import Any, Optional, Dict, List
from datetime import timedelta

from config import settings

logger = logging.getLogger(__name__)


class RedisService:
    """Redis 服务封装"""

    def __init__(self):
        """初始化 Redis 连接"""
        import redis.asyncio as redis

        self.redis_url = settings.redis_url
        self.cache_ttl = settings.redis_cache_ttl
        self.rate_limit_ttl = settings.redis_rate_limit_ttl

        # 创建 Redis 连接池
        self.pool = redis.ConnectionPool.from_url(
            self.redis_url,
            max_connections=20,
            decode_responses=True,
        )
        self.client = redis.Redis(connection_pool=self.pool)

        logger.info(f"Redis service initialized: {self.redis_url}")

    async def close(self):
        """关闭 Redis 连接"""
        await self.client.close()
        await self.pool.disconnect()

    # ========== 缓存功能 ==========

    async def get_cache(self, key: str) -> Optional[Any]:
        """
        获取缓存

        Args:
            key: 缓存键

        Returns:
            缓存值，不存在返回 None
        """
        try:
            value = await self.client.get(key)
            if value:
                return json.loads(value)
            return None
        except Exception as e:
            logger.error(f"Redis get error: {e}")
            return None

    async def set_cache(
        self,
        key: str,
        value: Any,
        ttl: Optional[int] = None,
    ) -> bool:
        """
        设置缓存

        Args:
            key: 缓存键
            value: 缓存值（会被 JSON 序列化）
            ttl: 过期时间（秒），默认使用配置的 cache_ttl

        Returns:
            是否设置成功
        """
        try:
            ttl = ttl or self.cache_ttl
            await self.client.setex(key, ttl, json.dumps(value, default=str))
            return True
        except Exception as e:
            logger.error(f"Redis set error: {e}")
            return False

    async def delete_cache(self, key: str) -> bool:
        """
        删除缓存

        Args:
            key: 缓存键

        Returns:
            是否删除成功
        """
        try:
            await self.client.delete(key)
            return True
        except Exception as e:
            logger.error(f"Redis delete error: {e}")
            return False

    async def delete_pattern(self, pattern: str) -> int:
        """
        删除匹配模式的所有缓存

        Args:
            pattern: 匹配模式（如 "agent:*"）

        Returns:
            删除的键数量
        """
        try:
            keys = []
            async for key in self.client.scan_iter(match=pattern):
                keys.append(key)
            if keys:
                await self.client.delete(*keys)
            return len(keys)
        except Exception as e:
            logger.error(f"Redis delete pattern error: {e}")
            return 0

    # ========== 限流功能 ==========

    async def check_rate_limit(
        self,
        key: str,
        max_requests: int,
        window_seconds: int = 60,
    ) -> tuple[bool, int]:
        """
        检查速率限制（滑动窗口算法）

        Args:
            key: 限流键（如 "rate:ip:192.168.1.1"）
            max_requests: 窗口内最大请求数
            window_seconds: 窗口大小（秒）

        Returns:
            (是否允许, 剩余请求数)
        """
        try:
            import time

            now = time.time()
            window_start = now - window_seconds

            # 使用 Redis 有序集合实现滑动窗口
            pipe = self.client.pipeline()

            # 移除窗口外的旧记录
            pipe.zremrangebyscore(key, 0, window_start)

            # 获取当前窗口内的请求数
            pipe.zcard(key)

            # 添加当前请求
            pipe.zadd(key, {str(now): now})

            # 设置过期时间
            pipe.expire(key, window_seconds)

            results = await pipe.execute()
            current_count = results[1]

            remaining = max(0, max_requests - current_count - 1)
            allowed = current_count < max_requests

            return allowed, remaining

        except Exception as e:
            logger.error(f"Redis rate limit error: {e}")
            # 出错时默认允许请求
            return True, max_requests

    async def get_rate_limit_info(
        self,
        key: str,
        window_seconds: int = 60,
    ) -> Dict[str, int]:
        """
        获取限流信息

        Args:
            key: 限流键
            window_seconds: 窗口大小（秒）

        Returns:
            限流信息字典
        """
        try:
            import time

            now = time.time()
            window_start = now - window_seconds

            # 清理并计数
            await self.client.zremrangebyscore(key, 0, window_start)
            count = await self.client.zcard(key)

            return {
                "current_count": count,
                "window_seconds": window_seconds,
            }
        except Exception as e:
            logger.error(f"Redis get rate limit info error: {e}")
            return {"current_count": 0, "window_seconds": window_seconds}

    # ========== 会话缓存 ==========

    async def cache_agent(self, agent_id: str, agent_data: Dict) -> bool:
        """缓存 Agent 配置"""
        key = f"agent:{agent_id}"
        return await self.set_cache(key, agent_data, ttl=300)  # 5分钟

    async def get_cached_agent(self, agent_id: str) -> Optional[Dict]:
        """获取缓存的 Agent 配置"""
        key = f"agent:{agent_id}"
        return await self.get_cache(key)

    async def invalidate_agent(self, agent_id: str) -> bool:
        """使 Agent 缓存失效"""
        key = f"agent:{agent_id}"
        return await self.delete_cache(key)

    async def cache_session(
        self,
        session_id: str,
        session_data: Dict,
        ttl: int = 3600,
    ) -> bool:
        """缓存会话数据"""
        key = f"session:{session_id}"
        return await self.set_cache(key, session_data, ttl=ttl)

    async def get_cached_session(self, session_id: str) -> Optional[Dict]:
        """获取缓存的会话数据"""
        key = f"session:{session_id}"
        return await self.get_cache(key)

    # ========== 任务队列 ==========

    async def enqueue_task(
        self,
        queue_name: str,
        task_data: Dict,
    ) -> bool:
        """
        将任务加入队列

        Args:
            queue_name: 队列名称
            task_data: 任务数据

        Returns:
            是否成功
        """
        try:
            await self.client.lpush(
                f"queue:{queue_name}",
                json.dumps(task_data, default=str),
            )
            return True
        except Exception as e:
            logger.error(f"Redis enqueue error: {e}")
            return False

    async def dequeue_task(
        self,
        queue_name: str,
        timeout: int = 0,
    ) -> Optional[Dict]:
        """
        从队列获取任务

        Args:
            queue_name: 队列名称
            timeout: 阻塞超时（秒），0 表示非阻塞

        Returns:
            任务数据
        """
        try:
            if timeout > 0:
                result = await self.client.brpop(
                    f"queue:{queue_name}",
                    timeout=timeout,
                )
                if result:
                    return json.loads(result[1])
            else:
                result = await self.client.rpop(f"queue:{queue_name}")
                if result:
                    return json.loads(result)
            return None
        except Exception as e:
            logger.error(f"Redis dequeue error: {e}")
            return None

    async def get_queue_length(self, queue_name: str) -> int:
        """获取队列长度"""
        try:
            return await self.client.llen(f"queue:{queue_name}")
        except Exception as e:
            logger.error(f"Redis queue length error: {e}")
            return 0

    # ========== Pub/Sub 功能 ==========

    async def publish(self, channel: str, message: dict) -> int:
        """发布消息到指定频道"""
        try:
            return await self.client.publish(
                channel,
                json.dumps(message, default=str),
            )
        except Exception as e:
            logger.error(f"Redis publish error: {e}")
            return 0

    def get_pubsub(self):
        """获取 Pub/Sub 对象（用于订阅）"""
        return self.client.pubsub()

    # ========== 健康检查 ==========

    async def health_check(self) -> bool:
        """
        健康检查

        Returns:
            Redis 是否可用
        """
        try:
            await self.client.ping()
            return True
        except Exception as e:
            logger.error(f"Redis health check failed: {e}")
            return False


# 全局 Redis 服务实例（按事件循环隔离）
_redis_services: Dict[int, RedisService] = {}


async def get_redis() -> RedisService:
    """获取 Redis 服务实例"""
    import asyncio

    loop_id = id(asyncio.get_running_loop())
    service = _redis_services.get(loop_id)
    if service is None:
        service = RedisService()
        _redis_services[loop_id] = service
    return service


async def close_redis():
    """关闭 Redis 连接"""
    services = list(_redis_services.values())
    _redis_services.clear()
    for service in services:
        await service.close()
