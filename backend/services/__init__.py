"""服务模块"""

from .scraper import URLNormalizer, check_content_changed
from .crawler import SiteCrawler, CrawlPageResult
from .scrapling_client import ScraplingClient, get_scrapling_client
from .redis_service import RedisService, get_redis, close_redis
from .task_lock import TaskLock, TaskType, task_lock

__all__ = [
    "URLNormalizer",
    "check_content_changed",
    "SiteCrawler",
    "CrawlPageResult",
    "ScraplingClient",
    "get_scrapling_client",
    "RedisService",
    "get_redis",
    "close_redis",
    "TaskLock",
    "TaskType",
    "task_lock",
]
