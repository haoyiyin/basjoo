"""定时任务调度服务"""

import logging
from typing import Optional
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from datetime import datetime, timedelta, timezone
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_

from database import AsyncSessionLocal
from models import Agent, URLSource
from services.crawler import SiteCrawler

logger = logging.getLogger(__name__)


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
                id='check_url_fetches',
                name='Check and fetch URLs periodically',
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
        1. 获取所有启用了自动抓取的Agent
        2. 对于每个Agent，检查其URL源
        3. 如果URL的last_fetch_at超过设定的间隔天数，则重新抓取
        """
        try:
            logger.info("Checking URLs that need to be refetched...")

            async with AsyncSessionLocal() as db:
                # 获取所有启用了自动抓取的Agent
                result = await db.execute(
                    select(Agent).where(Agent.enable_auto_fetch == True)
                )
                agents = result.scalars().all()

                for agent in agents:
                    await self.fetch_agent_urls(db, agent)

        except Exception as e:
            logger.exception(f"Error in check_and_fetch_urls: {e}")

    async def fetch_agent_urls(self, db: AsyncSession, agent: Agent):
        """抓取特定Agent的URL，读取列表后不再持有会话执行 HTTP 请求"""
        try:
            interval_days = agent.url_fetch_interval_days or 7
            threshold_date = datetime.now(timezone.utc) - timedelta(days=interval_days)

            result = await db.execute(
                select(URLSource).where(
                    and_(
                        URLSource.agent_id == agent.id,
                        URLSource.status == 'success',
                        (
                            (URLSource.last_fetch_at < threshold_date) |
                            (URLSource.last_fetch_at.is_(None))
                        )
                    )
                )
            )
            url_sources = result.scalars().all()

            if not url_sources:
                logger.debug(f"No URLs need refetching for agent {agent.id}")
                return

            logger.info(
                f"Found {len(url_sources)} URLs to refetch for agent {agent.id} "
                f"(interval: {interval_days} days)"
            )

            crawler = SiteCrawler(jina_api_key=agent.jina_api_key or "")

            for url_source in url_sources:
                await self.fetch_single_url(crawler, url_source.id, str(agent.id))

        except Exception as e:
            logger.exception(f"Error in fetch_agent_urls for agent {agent.id}: {e}")

    async def fetch_single_url(
        self,
        crawler: SiteCrawler,
        url_source_id: int,
        agent_id: str,
    ):
        """抓取单个URL，使用短生命周期数据库会话"""
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(URLSource).where(URLSource.id == url_source_id))
                url_source = result.scalar_one_or_none()
                if not url_source:
                    return
                logger.info(f"Refetching URL {url_source.url} (ID: {url_source.id})")
                url = url_source.url
                old_hash = url_source.content_hash
                url_source.status = "fetching"
                await db.commit()

            page_result = await crawler.crawl_single_page(url)

            async with AsyncSessionLocal() as db:
                result = await db.execute(select(URLSource).where(URLSource.id == url_source_id))
                url_source = result.scalar_one_or_none()
                if not url_source:
                    return

                if page_result.success:
                    new_hash = page_result.content_hash
                    if old_hash != new_hash:
                        url_source.status = "success"
                        url_source.title = page_result.title
                        url_source.content = page_result.content
                        url_source.content_hash = new_hash
                        url_source.last_fetch_at = datetime.now(timezone.utc)
                        url_source.fetch_metadata = page_result.metadata
                        logger.info(
                            f"URL {url_source.url} content changed, updated. "
                            f"Old hash: {old_hash[:8] if old_hash else 'None'}..., New hash: {new_hash[:8]}..."
                        )
                    else:
                        url_source.status = "success"
                        url_source.last_fetch_at = datetime.now(timezone.utc)
                        logger.info(f"URL {url_source.url} content unchanged, only updated timestamp")

                    await db.commit()

                    if old_hash != new_hash:
                        logger.info(f"URL content changed, triggering index rebuild for agent {agent_id}")
                        await self.trigger_index_rebuild(agent_id)
                else:
                    url_source.status = "failed"
                    url_source.last_error = page_result.error or "Unknown error"
                    await db.commit()
                    logger.error(
                        f"Failed to refetch URL {url_source.url}: "
                        f"{page_result.error}"
                    )

        except Exception as e:
            logger.exception(f"Error in fetch_single_url for URL ID {url_source_id}: {e}")
            try:
                async with AsyncSessionLocal() as db:
                    result = await db.execute(select(URLSource).where(URLSource.id == url_source_id))
                    url_source = result.scalar_one_or_none()
                    if url_source:
                        url_source.status = "failed"
                        url_source.last_error = str(e)
                        await db.commit()
            except Exception:
                logger.exception("Failed to persist fetch_single_url error state")

    async def trigger_index_rebuild(self, agent_id: str):
        """
        触发索引重建任务

        Args:
            agent_id: Agent ID
        """
        try:
            from api.v1.index_endpoints import rebuild_index_task

            # 创建索引重建任务
            job_id = f"index_rebuild_{agent_id}_{int(datetime.now(timezone.utc).timestamp())}"
            await rebuild_index_task(agent_id, job_id)

            logger.info(f"Triggered index rebuild for agent {agent_id} (job_id: {job_id})")

        except Exception as e:
            logger.exception(f"Failed to trigger index rebuild for agent {agent_id}: {e}")


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
            self.running = True
            # 添加每日清理任务（凌晨3点执行）
            self.scheduler.add_job(
                self.cleanup_expired_sessions,
                trigger='cron',
                hour=3,
                minute=0,
                id='cleanup_expired_sessions',
                name='Cleanup expired chat sessions daily',
                replace_existing=True,
            )
            logger.info("History cleanup scheduler started")
        else:
            logger.warning("History cleanup scheduler already running")

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

                    cutoff_date = datetime.now(timezone.utc) - timedelta(days=agent.history_days)

                    # 查找过期会话（使用 updated_at，更精确判断活跃会话）
                    expired_result = await db.execute(
                        select(ChatSession).where(
                            and_(
                                ChatSession.agent_id == agent.id,
                                or_(
                                    ChatSession.updated_at < cutoff_date,
                                    and_(
                                        ChatSession.updated_at.is_(None),
                                        ChatSession.created_at < cutoff_date
                                    )
                                )
                            )
                        )
                    )
                    expired_sessions = expired_result.scalars().all()

                    for session in expired_sessions:
                        # 删除会话（关联消息会级联删除）
                        await db.delete(session)
                        total_deleted += 1

                await db.commit()
                logger.info(f"Cleanup completed. Deleted {total_deleted} expired sessions.")

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
            self.running = True
            self.scheduler.add_job(
                self.close_inactive_sessions,
                trigger='interval',
                minutes=5,
                id='close_inactive_sessions',
                name='Close inactive sessions',
                replace_existing=True,
            )
            logger.info("Session auto-close scheduler started")

    async def close_inactive_sessions(self):
        """关闭长时间无活动的会话"""
        from models import ChatSession, ChatMessage

        try:
            async with AsyncSessionLocal() as db:
                cutoff = datetime.now(timezone.utc) - timedelta(minutes=self.inactivity_timeout_minutes)

                result = await db.execute(
                    select(ChatSession).where(ChatSession.status.in_(["active", "taken_over"]))
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
