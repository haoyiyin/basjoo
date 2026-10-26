"""定时任务调度服务"""

import logging
import uuid
from typing import Optional
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from datetime import datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, delete, or_

from database import AsyncSessionLocal
from models import (
    Agent,
    AgentMember,
    ChatMessage,
    ChatSession,
    KnowledgeFile,
    URLSource,
    Workspace,
    WorkspaceQuota,
)
from services.task_lock import task_lock, TaskType
from services.url_service import process_url_refetch

logger = logging.getLogger(__name__)


def as_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if not dt:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


class URLFetchScheduler:
    """URL自动抓取调度器"""

    def __init__(self):
        self.scheduler = AsyncIOScheduler()
        self.running = False

    def start(self):
        """启动调度器"""
        if not self.running:
            self.scheduler.start()
            self.running = True
            logger.info("URL fetch scheduler started")

            # 添加定期检查任务
            self.scheduler.add_job(
                self.check_and_fetch_urls,
                trigger=IntervalTrigger(hours=1),  # 每小时检查一次
                id="check_url_fetches",
                name="Check and fetch URLs periodically",
                replace_existing=True,
            )
        else:
            logger.warning("Scheduler already running")

    def stop(self):
        """停止调度器"""
        if self.running:
            self.scheduler.shutdown()
            self.running = False
            logger.info("URL fetch scheduler stopped")

    async def check_and_fetch_urls(self):
        """
        检查并抓取需要更新的URL

        逻辑：
        1. 回收所有「从未抓取过、仍是 pending」的URL（与 enable_auto_fetch 无关）
        2. 获取所有启用了自动抓取的Agent（且已绑定KB）
        3. 对于每个Agent，检查其KB的URL源
        4. 如果URL的last_fetch_at超过设定的间隔天数，则重新抓取
        """
        try:
            logger.info("Checking URLs that need to be refetched...")

            async with AsyncSessionLocal() as db:
                await self.fetch_never_fetched_urls(db)

                # 获取所有启用了自动抓取的Agent
                result = await db.execute(
                    select(Agent).where(Agent.enable_auto_fetch == True)
                )
                agents = result.scalars().all()

                for agent in agents:
                    await self.fetch_agent_urls(db, agent)

        except Exception as e:
            logger.exception(f"Error in check_and_fetch_urls: {e}")

    async def fetch_never_fetched_urls(self, db: AsyncSession):
        """Catch-all: fetch every URL row that was never fetched.

        A row is ``pending`` with ``last_fetch_at IS NULL`` when it was created but
        no fetch ever ran — e.g. the example seed could not take the task lock, or
        the process died between the commit and the background task. Independent of
        ``enable_auto_fetch`` on purpose: leaving content unindexed forever is not a
        preference.

        ``failed`` rows are deliberately NOT retried here; the operator hits
        "重建索引" for those.
        """
        try:
            result = await db.execute(
                select(URLSource).where(
                    URLSource.status == "pending",
                    URLSource.last_fetch_at.is_(None),
                )
            )
            url_sources = result.scalars().all()

            if not url_sources:
                logger.debug("No never-fetched pending URLs")
                return

            logger.info(
                f"Catch-all: fetching {len(url_sources)} never-fetched pending URLs"
            )

            await self._refetch_grouped_by_kb(
                self._group_ids_by_kb(url_sources), context="catch-all"
            )

        except Exception as e:
            logger.exception(f"Error in fetch_never_fetched_urls: {e}")

    @staticmethod
    def _group_ids_by_kb(url_sources) -> dict[str, list[int]]:
        """Group URL row IDs by owning KB (one refetch job per KB, not per row)."""
        groups: dict[str, list[int]] = {}
        for url_source in url_sources:
            groups.setdefault(str(url_source.kb_id), []).append(url_source.id)
        return groups

    async def _refetch_grouped_by_kb(
        self, groups: dict[str, list[int]], context: str
    ) -> None:
        """Run the real ingest path once per KB, under that KB's task lock.

        ``process_url_refetch`` creates the KbDocument, chunks, embeds and upserts
        the Qdrant points — writing the fetched text alone (what this scheduler
        used to do) left the KB with zero retrievable content.
        """
        for kb_id, ids in groups.items():
            job_id = f"sched_refetch_{kb_id}_{uuid.uuid4().hex[:8]}"
            acquired, err = await task_lock.acquire_task(
                kb_id, TaskType.URL_REFETCH, job_id
            )
            if not acquired:
                logger.info(
                    f"{context}: lock held for KB {kb_id} ({err}), "
                    f"skipping this cycle"
                )
                continue
            await process_url_refetch(
                kb_id=kb_id,
                url_ids=ids,
                force=False,
                job_id=job_id,
                source_agent_id=None,
            )

    async def fetch_agent_urls(self, db: AsyncSession, agent: Agent):
        """抓取特定Agent绑定KB的URL，读取列表后不再持有会话执行 HTTP 请求"""
        try:
            if not agent.kb_id:
                logger.debug(f"Agent {agent.id} has no bound KB; skipping")
                return

            interval_days = agent.url_fetch_interval_days or 7
            threshold_date = datetime.now(timezone.utc) - timedelta(days=interval_days)

            result = await db.execute(
                select(URLSource).where(
                    and_(
                        URLSource.kb_id == agent.kb_id,
                        URLSource.status == "success",
                        (
                            (URLSource.last_fetch_at < threshold_date)
                            | (URLSource.last_fetch_at.is_(None))
                        ),
                    )
                )
            )
            url_sources = result.scalars().all()

            if not url_sources:
                logger.debug(f"No URLs need refetching for KB {agent.kb_id}")
                return

            logger.info(
                f"Found {len(url_sources)} URLs to refetch for KB {agent.kb_id} "
                f"(interval: {interval_days} days)"
            )

            await self._refetch_grouped_by_kb(
                self._group_ids_by_kb(url_sources),
                context=f"agent {agent.id}",
            )

        except Exception as e:
            logger.exception(f"Error in fetch_agent_urls for agent {agent.id}: {e}")

# 全局实例
url_fetch_scheduler = URLFetchScheduler()


class HistoryCleanupScheduler:
    """历史记录清理调度器"""

    def __init__(self):
        self.scheduler = AsyncIOScheduler()
        self.running = False

    def start(self):
        """启动调度器"""
        if not self.running:
            self.scheduler.start()
            # 添加每日清理任务（凌晨3点执行）
            self.scheduler.add_job(
                self.cleanup_expired_sessions,
                trigger="cron",
                hour=3,
                minute=0,
                id="cleanup_expired_sessions",
                name="Cleanup expired chat sessions daily",
                replace_existing=True,
            )
            self.running = True
            logger.info("History cleanup scheduler started")
        else:
            logger.warning("History cleanup scheduler already running")

    def stop(self):
        """停止调度器"""
        if self.running:
            self.scheduler.shutdown()
            self.running = False
            logger.info("History cleanup scheduler stopped")

    async def cleanup_expired_sessions(self):
        """
        清理过期的聊天会话

        根据 Agent 的 history_days 设置删除过期会话
        """
        from models import ChatSession, ChatMessage

        try:
            logger.info("Starting cleanup of expired chat sessions...")

            async with AsyncSessionLocal() as db:
                # 获取所有 Agent 及其 history_days 设置
                result = await db.execute(select(Agent))
                agents = result.scalars().all()

                total_deleted = 0

                for agent in agents:
                    if agent.history_days <= 0:
                        continue  # 跳过不清理的 Agent

                    cutoff_date = datetime.now(timezone.utc) - timedelta(
                        days=agent.history_days
                    )

                    # 查找过期会话（使用 updated_at，更精确判断活跃会话）
                    expired_result = await db.execute(
                        select(ChatSession).where(
                            and_(
                                ChatSession.agent_id == agent.id,
                                or_(
                                    ChatSession.updated_at < cutoff_date,
                                    and_(
                                        ChatSession.updated_at.is_(None),
                                        ChatSession.created_at < cutoff_date,
                                    ),
                                ),
                            )
                        )
                    )
                    expired_sessions = expired_result.scalars().all()

                    for session in expired_sessions:
                        # 删除会话（关联消息会级联删除）
                        await db.delete(session)
                        total_deleted += 1

                await db.commit()
                logger.info(
                    f"Cleanup completed. Deleted {total_deleted} expired sessions."
                )

        except Exception as e:
            logger.exception(f"Error in cleanup_expired_sessions: {e}")


# 全局实例
history_cleanup_scheduler = HistoryCleanupScheduler()


class SessionAutoCloseScheduler:
    """会话自动关闭调度器"""

    def __init__(self):
        self.scheduler = AsyncIOScheduler()
        self.running = False
        self.inactivity_timeout_minutes = 30  # 30分钟无活动自动关闭

    def start(self):
        if not self.running:
            self.scheduler.start()
            self.scheduler.add_job(
                self.close_inactive_sessions,
                trigger="interval",
                minutes=5,
                id="close_inactive_sessions",
                name="Close inactive sessions",
                replace_existing=True,
            )
            self.running = True
            logger.info("Session auto-close scheduler started")

    def stop(self):
        if self.running:
            self.scheduler.shutdown()
            self.running = False
            logger.info("Session auto-close scheduler stopped")

    async def close_inactive_sessions(self):
        """关闭长时间无活动的会话"""
        from models import ChatSession, ChatMessage

        try:
            async with AsyncSessionLocal() as db:
                cutoff = datetime.now(timezone.utc) - timedelta(
                    minutes=self.inactivity_timeout_minutes
                )

                result = await db.execute(
                    select(ChatSession).where(
                        ChatSession.status.in_(["active", "taken_over"])
                    )
                )
                sessions = result.scalars().all()

                closed = 0
                for session in sessions:
                    last_msg = await db.execute(
                        select(ChatMessage.created_at)
                        .where(ChatMessage.session_id == session.id)
                        .order_by(ChatMessage.created_at.desc())
                        .limit(1)
                    )
                    last_time = last_msg.scalar_one_or_none()

                    if last_time and last_time.tzinfo is None:
                        last_time = last_time.replace(tzinfo=timezone.utc)

                    if last_time:
                        should_close = last_time < cutoff
                    elif session.created_at:
                        created = session.created_at
                        if created.tzinfo is None:
                            created = created.replace(tzinfo=timezone.utc)
                        should_close = created < cutoff
                    else:
                        should_close = True

                    if should_close:
                        session.status = "closed"
                        closed += 1

                await db.commit()
                if closed > 0:
                    logger.info(f"Auto-closed {closed} inactive sessions")
        except Exception as e:
            logger.exception(f"Error in close_inactive_sessions: {e}")


session_auto_close_scheduler = SessionAutoCloseScheduler()


class AgentPurgeScheduler:
    """Permanently deletes agents after their restore window expires."""

    def __init__(self):
        self.scheduler = AsyncIOScheduler()
        self.running = False

    def start(self):
        if self.running:
            return
        self.scheduler.start()
        self.running = True
        self.scheduler.add_job(
            self.purge_expired_agents,
            trigger=IntervalTrigger(hours=24),
            id="purge_expired_agents",
            name="Purge expired soft-deleted agents",
            replace_existing=True,
        )

    def stop(self):
        if self.running:
            self.scheduler.shutdown()
            self.running = False

    async def purge_expired_agents(self):
        now = datetime.now(timezone.utc)
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Agent).where(Agent.purge_after.is_not(None))
            )
            agents = [
                agent
                for agent in result.scalars().all()
                if as_utc(agent.purge_after) and as_utc(agent.purge_after) <= now
            ]
            for agent in agents:
                await self._purge_agent(db, agent)
            await db.commit()

    async def _purge_agent(self, db: AsyncSession, agent: Agent):
        session_ids = await db.execute(
            select(ChatSession.id).where(ChatSession.agent_id == agent.id)
        )
        ids = [row[0] for row in session_ids.all()]
        if ids:
            await db.execute(delete(ChatMessage).where(ChatMessage.session_id.in_(ids)))
        await db.execute(delete(ChatSession).where(ChatSession.agent_id == agent.id))
        # URL sources belong to the KB. Soft-delete already cleared `agent.kb_id`,
        # so this row has no pointer left; even if it did, the KB (and its URLs)
        # must outlive the agent. KnowledgeFile is still agent-keyed (dead table).
        await db.execute(
            delete(KnowledgeFile).where(KnowledgeFile.agent_id == agent.id)
        )
        await db.execute(delete(AgentMember).where(AgentMember.agent_id == agent.id))
        workspace_id = agent.workspace_id
        await db.delete(agent)
        await db.execute(
            delete(WorkspaceQuota).where(WorkspaceQuota.workspace_id == workspace_id)
        )
        await db.execute(delete(Workspace).where(Workspace.id == workspace_id))


agent_purge_scheduler = AgentPurgeScheduler()
