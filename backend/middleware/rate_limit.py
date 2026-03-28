"""
API级速率限制中间件

支持两种模式：
1. Redis 分布式限流（生产环境）
2. 内存限流（开发/测试环境）
"""

from collections import defaultdict
import logging
import time
from typing import Dict, Optional, Tuple

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

from config import settings

logger = logging.getLogger(__name__)

PUBLIC_RATE_LIMIT_PATH_PREFIXES = (
    "/api/v1/chat",
    "/api/v1/contexts",
    "/api/v1/config:public",
)


def _append_vary_header(response: Response, value: str) -> None:
    """Append a value to the Vary header without duplicating it."""
    existing = response.headers.get("Vary")
    if not existing:
        response.headers["Vary"] = value
        return

    values = [item.strip() for item in existing.split(",") if item.strip()]
    if value not in values:
        response.headers["Vary"] = ", ".join([*values, value])


def apply_cors_headers(request: Request, response: Response) -> Response:
    """Apply CORS headers for early middleware responses that bypass CORSMiddleware."""
    origin = request.headers.get("origin", "")

    if origin == "null" or not origin:
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = settings.allowed_methods
        response.headers["Access-Control-Allow-Headers"] = settings.allowed_headers
        return response

    allowed_origins = settings.cors_origins_list
    if "*" in allowed_origins:
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Access-Control-Allow-Methods"] = settings.allowed_methods
        response.headers["Access-Control-Allow-Headers"] = settings.allowed_headers
        return response

    if origin in allowed_origins:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Methods"] = settings.allowed_methods
        response.headers["Access-Control-Allow-Headers"] = settings.allowed_headers
        _append_vary_header(response, "Origin")

    return response


def get_request_client_ip(request: Request) -> str:
    """Get the originating client IP, preferring the first forwarded IP."""
    forwarded = request.headers.get("X-Forwarded-For", "")
    if forwarded:
        for candidate in forwarded.split(","):
            candidate = candidate.strip()
            if candidate:
                return candidate

    real_ip = request.headers.get("X-Real-IP", "")
    if real_ip:
        return real_ip.strip()

    if request.client and request.client.host:
        return request.client.host

    return "unknown"


def should_apply_rate_limit(request: Request) -> bool:
    """Apply rate limiting only to public client-facing endpoints."""
    if request.method == "OPTIONS":
        return False

    path = request.url.path
    return path.startswith(PUBLIC_RATE_LIMIT_PATH_PREFIXES)


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    速率限制中间件

    支持 Redis 分布式限流和内存限流两种模式
    """

    def __init__(
        self,
        app,
        requests_per_minute: int = 60,
        burst_size: int = 10,
        use_redis: bool = True,
    ):
        """
        初始化速率限制中间件

        Args:
            app: FastAPI应用实例
            requests_per_minute: 每分钟允许的最大请求数
            burst_size: 短时间内允许的突发请求数
            use_redis: 是否使用 Redis（生产环境推荐）
        """
        super().__init__(app)
        self.requests_per_minute = requests_per_minute
        self.burst_size = burst_size
        self.use_redis = use_redis

        # 内存限流的备用存储
        self.request_history: Dict[str, list] = defaultdict(list)
        self.burst_counters: Dict[str, int] = defaultdict(int)
        self.last_burst_reset: float = time.time()

        # Redis 服务（延迟初始化，按事件循环隔离）
        self._redis_service = None
        self._redis_loop_id: Optional[int] = None

    async def _get_redis(self):
        """获取 Redis 服务（延迟初始化）"""
        if not self.use_redis:
            return None

        try:
            import asyncio
            from services.redis_service import get_redis

            loop_id = id(asyncio.get_running_loop())
            if self._redis_service is None or self._redis_loop_id != loop_id:
                self._redis_service = await get_redis()
                self._redis_loop_id = loop_id
        except Exception as e:
            logger.warning(f"Redis not available, falling back to memory: {e}")
            self.use_redis = False
            self._redis_service = None
            self._redis_loop_id = None

        return self._redis_service

    async def dispatch(self, request: Request, call_next):
        """处理每个请求"""
        if not should_apply_rate_limit(request):
            return await call_next(request)

        client_ip = self._get_client_ip(request)

        # 检查速率限制
        allowed, remaining = await self._check_rate_limit(client_ip)

        if not allowed:
            logger.warning(f"Rate limit exceeded for IP: {client_ip}")
            response = JSONResponse(
                status_code=429,
                content={
                    "detail": "请求过于频繁，请稍后再试",
                    "error": "rate_limit_exceeded",
                },
            )
            response.headers["X-RateLimit-Limit"] = str(self.requests_per_minute)
            response.headers["X-RateLimit-Remaining"] = "0"
            return apply_cors_headers(request, response)

        # 处理请求
        response = await call_next(request)

        # 添加速率限制头
        response.headers["X-RateLimit-Limit"] = str(self.requests_per_minute)
        response.headers["X-RateLimit-Remaining"] = str(remaining)

        return response

    def _get_client_ip(self, request: Request) -> str:
        """获取客户端IP地址"""
        return get_request_client_ip(request)

    async def _check_rate_limit(self, ip: str) -> Tuple[bool, int]:
        """
        检查是否超过速率限制

        Args:
            ip: 客户端IP地址

        Returns:
            (是否允许, 剩余请求数)
        """
        # 尝试使用 Redis
        redis = await self._get_redis()
        if redis:
            try:
                key = f"rate:ip:{ip}"
                allowed, remaining = await redis.check_rate_limit(
                    key,
                    max_requests=self.requests_per_minute,
                    window_seconds=60,
                )
                return allowed, remaining
            except Exception as e:
                logger.warning(f"Redis rate limit error, falling back to memory: {e}")

        # 使用内存限流
        return self._check_memory_rate_limit(ip)

    def _check_memory_rate_limit(self, ip: str) -> Tuple[bool, int]:
        """
        内存限流（备用方案）

        Args:
            ip: 客户端IP地址

        Returns:
            (是否允许, 剩余请求数)
        """
        current_time = time.time()

        # 清理旧记录（超过1分钟的）
        self.request_history[ip] = [
            (timestamp, count)
            for timestamp, count in self.request_history[ip]
            if current_time - timestamp < 60
        ]

        # 计算当前时间窗口内的总请求数
        total_requests = sum(count for _, count in self.request_history[ip])

        # 检查突发限制
        if current_time - self.last_burst_reset > 1:  # 每秒重置突发计数
            self.burst_counters.clear()
            self.last_burst_reset = current_time

        if self.burst_counters[ip] >= self.burst_size:
            logger.debug(f"Burst rate limit exceeded for IP: {ip}")
            return False, 0

        # 检查每分钟限制
        if total_requests >= self.requests_per_minute:
            logger.debug(f"Minute rate limit exceeded for IP: {ip}")
            return False, 0

        # 记录本次请求
        self.request_history[ip].append((current_time, 1))
        self.burst_counters[ip] += 1

        remaining = max(0, self.requests_per_minute - total_requests - 1)
        return True, remaining
