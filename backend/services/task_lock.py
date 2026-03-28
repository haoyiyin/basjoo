"""任务互斥锁服务 - 防止抓取和索引重建并发冲突"""

import asyncio
import logging
from typing import Dict, Optional, Set
from datetime import datetime, timezone
from enum import Enum

logger = logging.getLogger(__name__)


class TaskType(str, Enum):
    """任务类型"""
    INDEX_REBUILD = "index_rebuild"
    URL_CRAWL = "url_crawl"
    URL_FETCH = "url_fetch"
    URL_REFETCH = "url_refetch"


class TaskLock:
    """任务互斥锁管理器

    防止以下冲突：
    - 索引重建期间不允许启动新的抓取任务
    - 抓取任务进行中不允许启动索引重建
    - 同一Agent只能有一个索引重建任务
    """

    def __init__(self):
        self._locks: Dict[str, asyncio.Lock] = {}
        self._active_tasks: Dict[str, Dict[str, datetime]] = {}
        self._pending_rebuild: Set[str] = set()
        self._lock_creation_lock = asyncio.Lock()  # 用于保护锁的创建

    def _get_lock(self, agent_id: str) -> asyncio.Lock:
        """获取Agent专属锁（线程安全）"""
        # 先尝试获取已存在的锁（无阻塞）
        if agent_id in self._locks:
            return self._locks[agent_id]
        # 如果锁不存在，需要创建（这个操作本身需要加锁）
        # 注意：这里需要外部调用者确保在适当的上下文中调用
        lock = asyncio.Lock()
        self._locks[agent_id] = lock
        return lock

    async def _get_or_create_lock(self, agent_id: str) -> asyncio.Lock:
        """线程安全地获取或创建Agent专属锁"""
        if agent_id in self._locks:
            return self._locks[agent_id]
        async with self._lock_creation_lock:
            # 双重检查，防止在获取锁期间其他协程已创建
            if agent_id not in self._locks:
                self._locks[agent_id] = asyncio.Lock()
            return self._locks[agent_id]
    
    async def acquire_task(
        self,
        agent_id: str,
        task_type: TaskType,
        task_id: str
    ) -> tuple[bool, Optional[str]]:
        """尝试获取任务锁

        Args:
            agent_id: Agent ID
            task_type: 任务类型
            task_id: 任务唯一ID

        Returns:
            (success, error_message) - 成功返回(True, None)，失败返回(False, 错误信息)
        """
        lock = await self._get_or_create_lock(agent_id)
        async with lock:
            if agent_id not in self._active_tasks:
                self._active_tasks[agent_id] = {}

            active = self._active_tasks[agent_id]

            # 检查冲突
            if task_type == TaskType.INDEX_REBUILD:
                # 索引重建时，检查是否有正在进行的抓取任务
                crawl_tasks = [t for t in active.keys() if t.startswith(("crawl_", "fetch_", "refetch_"))]
                if crawl_tasks:
                    return False, f"有正在进行的抓取任务: {crawl_tasks[0]}，请等待完成后再重建索引"

                # 检查是否已有索引重建任务
                rebuild_tasks = [t for t in active.keys() if t.startswith("rebuild_")]
                if rebuild_tasks:
                    return False, f"索引重建任务已在进行中: {rebuild_tasks[0]}"

            elif task_type in (TaskType.URL_CRAWL, TaskType.URL_FETCH, TaskType.URL_REFETCH):
                # 抓取任务时，检查是否有正在进行的索引重建
                rebuild_tasks = [t for t in active.keys() if t.startswith("rebuild_")]
                if rebuild_tasks:
                    return False, f"索引重建任务正在进行中: {rebuild_tasks[0]}，请等待完成后再开始抓取"

            # 注册任务
            active[task_id] = datetime.now(timezone.utc)
            logger.info(f"Task acquired: {task_id} for agent {agent_id}")
            return True, None

    async def release_task(self, agent_id: str, task_id: str):
        """释放任务锁

        Args:
            agent_id: Agent ID
            task_id: 任务唯一ID
        """
        lock = await self._get_or_create_lock(agent_id)
        async with lock:
            if agent_id in self._active_tasks:
                if task_id in self._active_tasks[agent_id]:
                    del self._active_tasks[agent_id][task_id]
                    logger.info(f"Task released: {task_id} for agent {agent_id}")

                    # 检查是否需要触发待处理的索引重建
                    if agent_id in self._pending_rebuild and not self._active_tasks[agent_id]:
                        self._pending_rebuild.discard(agent_id)
                        return True  # 表示需要触发重建
        return False

    async def schedule_rebuild_after_tasks(self, agent_id: str):
        """在当前任务完成后调度索引重建

        Args:
            agent_id: Agent ID
        """
        lock = await self._get_or_create_lock(agent_id)
        async with lock:
            self._pending_rebuild.add(agent_id)
            logger.info(f"Scheduled index rebuild after current tasks for agent {agent_id}")
    
    def has_pending_rebuild(self, agent_id: str) -> bool:
        """检查是否有待处理的索引重建"""
        return agent_id in self._pending_rebuild
    
    def get_active_tasks(self, agent_id: str) -> Dict[str, datetime]:
        """获取Agent的活动任务列表"""
        return self._active_tasks.get(agent_id, {}).copy()
    
    def is_task_running(self, agent_id: str, task_type: TaskType) -> bool:
        """检查特定类型的任务是否正在运行"""
        if agent_id not in self._active_tasks:
            return False
        
        prefix_map = {
            TaskType.INDEX_REBUILD: "rebuild_",
            TaskType.URL_CRAWL: "crawl_",
            TaskType.URL_FETCH: "fetch_",
            TaskType.URL_REFETCH: "refetch_",
        }
        prefix = prefix_map.get(task_type, "")
        return any(t.startswith(prefix) for t in self._active_tasks[agent_id])
    
    def has_any_active_task(self, agent_id: str) -> bool:
        """检查是否有任何活动任务"""
        return bool(self._active_tasks.get(agent_id))


# 全局任务锁实例
task_lock = TaskLock()
