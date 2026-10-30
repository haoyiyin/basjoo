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
    KbDocument,
    KnowledgeFile,
    URLSource,
    Workspace,
    WorkspaceQuota,
)
from services.outcome_classifier import (
    CLASSIFY_QUIET_MINUTES,
    DEFAULT_CLASSIFIER,
    OUTCOMES as OUTCOME_VALUES,
    TOPIC_MAX_CHARS,
    classify_candidates_query,
    provider_configured,
    requires_provider,
    snapshot_from_rows,
)
from services.task_lock import task_lock, TaskType
from services.url_service import process_url_refetch
from services.webhook_service import (
    drain_pending_webhooks,
    enqueue_webhook_for_agent_id,
)

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
            # #47: report what the diff skipped, so a quiet refetch is
            # observable instead of looking like a no-op.
            unchanged = await self.report_unchanged_urls(kb_id)
            if unchanged:
                logger.info(
                    "%s: %s of %s URL(s) unchanged, no re-embed",
                    context,
                    len(unchanged),
                    len(ids),
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

    async def report_unchanged_urls(self, kb_id: str) -> list[int]:
        """URL rows this KB's last refetch found text-identical (no re-embed).

        Reads only the persisted state the refetch left behind: a `success` row
        whose document is `ready` and whose `item_hash` still matches the stored
        text *after normalisation*. Nothing here re-fetches or re-embeds, so it
        is safe to call from the same scheduler tick that just refetched.
        """
        from models import compute_item_hash
        from services.url_service import url_document_filename

        async with AsyncSessionLocal() as db:
            rows = list(
                (
                    await db.execute(
                        select(URLSource).where(
                            URLSource.kb_id == kb_id,
                            URLSource.status == "success",
                            URLSource.is_indexed == True,
                        )
                    )
                )
                .scalars()
                .all()
            )
            unchanged: list[int] = []
            for row in rows:
                doc = await db.scalar(
                    select(KbDocument).where(
                        KbDocument.kb_id == kb_id,
                        KbDocument.filename == url_document_filename(row.id),
                    )
                )
                if doc is None or getattr(doc, "status", None) != "ready":
                    continue
                if getattr(doc, "item_hash", None) == compute_item_hash(row.content):
                    unchanged.append(row.id)
            return unchanged

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
                        # #47: contract C5 still names `session.closed`, so the
                        # inactivity sweep queues it in the same transaction.
                        await enqueue_webhook_for_agent_id(
                            db,
                            session.agent_id,
                            "session.closed",
                            {
                                "session_id": session.session_id,
                                "reason": "inactivity_timeout",
                            },
                        )

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

class WebhookDeliveryScheduler:
    """Drains `webhook_deliveries` (#47).

    This is the other half of "a webhook failure must never delay or fail the
    chat request": the request only INSERTs a `pending` row, and every actual
    POST happens here, off the request path, in bounded batches.
    """

    def __init__(self):
        self.scheduler = AsyncIOScheduler()
        self.running = False

    def start(self):
        if self.running:
            return
        self.scheduler.start()
        self.running = True
        self.scheduler.add_job(
            self.deliver_pending_webhooks,
            trigger=IntervalTrigger(seconds=30),
            id="deliver_pending_webhooks",
            name="Deliver queued webhook deliveries",
            replace_existing=True,
        )
        logger.info("Webhook delivery scheduler started")

    def stop(self):
        if self.running:
            self.scheduler.shutdown()
            self.running = False
            logger.info("Webhook delivery scheduler stopped")

    async def deliver_pending_webhooks(self) -> dict[str, int]:
        """One bounded tick. Never raises: a dead subscriber is not an outage."""
        try:
            async with AsyncSessionLocal() as db:
                stats = await drain_pending_webhooks(db)
            if any(stats.values()):
                logger.info("Webhook tick: %s", stats)
            return stats
        except Exception as exc:
            logger.exception("Webhook delivery tick failed: %s", exc)
            return {"delivered": 0, "retrying": 0, "failed": 0, "skipped": 0}

webhook_delivery_scheduler = WebhookDeliveryScheduler()

class DocumentProcessingScheduler:
    """Drains uploaded `kb_documents` rows (#47, phase 2 of the two-phase upload).

    `files:upload` only persists bytes and the row; parse → chunk → embed →
    index runs here, so a 20 MB upload never occupies an API worker. Rows the
    previous process left in `processing` are picked up too — that is the whole
    point of persisting `processing_stage` instead of keeping the work in an
    in-memory `BackgroundTasks` queue that dies with the request.
    """

    def __init__(self):
        self.scheduler = AsyncIOScheduler()
        self.running = False
        #: Bounded so one huge backlog cannot monopolise a tick.
        self.batch_size = 10

    def start(self):
        if self.running:
            return
        self.scheduler.start()
        self.running = True
        self.scheduler.add_job(
            self.process_pending_documents,
            trigger=IntervalTrigger(seconds=15),
            id="process_pending_documents",
            name="Process uploaded KB documents",
            replace_existing=True,
        )
        logger.info("Document processing scheduler started")

    def stop(self):
        if self.running:
            self.scheduler.shutdown()
            self.running = False
            logger.info("Document processing scheduler stopped")

    async def process_pending_documents(self) -> int:
        """Process at most `batch_size` queued rows. Returns how many ran."""
        from services.kb_document_processor import KbDocumentProcessor

        try:
            async with AsyncSessionLocal() as db:
                rows = list(
                    (
                        await db.execute(
                            select(KbDocument.id, KbDocument.kb_id)
                            .where(
                                KbDocument.status.in_(["pending", "processing"]),
                                KbDocument.storage_path.isnot(None),
                                # `uploaded` is the queue marker the upload
                                # endpoint writes, and the only value that means
                                # "accepted, no worker owns this yet". Claiming
                                # it flips the row to `parsing` on the first line
                                # of `process_document`, so a row another path is
                                # already processing (a reset re-queue through
                                # `BackgroundTasks`, or the previous tick) is
                                # never picked up a second time.
                                KbDocument.processing_stage == "uploaded",
                            )
                            .order_by(KbDocument.created_at.asc())
                            .limit(self.batch_size)
                        )
                    ).all()
                )
        except Exception as exc:
            logger.exception("Could not list pending KB documents: %s", exc)
            return 0

        if not rows:
            return 0

        processor = KbDocumentProcessor()
        processed = 0
        for doc_id, kb_id in rows:
            try:
                await processor.process_document(str(doc_id), str(kb_id))
                processed += 1
            except Exception as exc:
                # `process_document` already persists its own failure; this is
                # the belt-and-braces case (e.g. the KB vanished mid-pass).
                logger.exception("Background ingest failed for doc %s: %s", doc_id, exc)
        if processed:
            logger.info("Processed %s queued KB document(s)", processed)
        return processed

document_processing_scheduler = DocumentProcessingScheduler()

class OutcomeClassifierScheduler:
    """"What did those conversations actually end up as?" (#45).

    The hard rule is the acceptance criterion: **a classifier failure must never
    affect live chat**. Three properties make that true, and all three are
    asserted by `tests/test_outcome_classifier.py`:

    1. It is not on the request path. Nothing in `api/` calls this class; it only
       runs from the scheduler, and it only ever *reads* `chat_sessions` rows
       whose status is `closed`/`resolved` and which have been quiet for
       `CLASSIFY_QUIET_MINUTES`.
    2. It owns its transaction. Each batch opens its own `AsyncSessionLocal` and
       commits at the end; an exception rolls that batch back as a unit, so a
       half-classified batch is impossible and no chat write is ever in scope.
    3. It swallows everything. `classify_pending` catches, logs, rolls back and
       returns a count; the tick the job runner sees always returns normally.
       There is no retry here and no retry inline — the next tick simply sees the
       still-`NULL` rows again.

    `classifier` is injected (a plain async callable), which is how a test makes
    one that raises without touching a real model. Tests never call an LLM: the
    shipped default is deterministic, and a model-backed classifier has to
    declare `requires_provider = True`, in which case an agent with no provider
    config is skipped with ONE log line rather than an exception per tick.
    """

    def __init__(self):
        self.scheduler = AsyncIOScheduler()
        self.running = False
        #: Bounded so one backlog cannot monopolise a tick or a transaction.
        self.batch_size = 50
        self.quiet_minutes = CLASSIFY_QUIET_MINUTES
        #: Set once per process when a provider-gated classifier was skipped, so
        #: a keyless install logs the reason once instead of every 5 minutes.
        self._provider_skip_logged = False

    def start(self):
        if self.running:
            return
        self.scheduler.start()
        self.running = True
        self.scheduler.add_job(
            self.classify_pending_sessions,
            trigger=IntervalTrigger(minutes=5),
            id="classify_pending_sessions",
            name="Classify finished chat sessions",
            replace_existing=True,
        )
        logger.info("Outcome classifier scheduler started")

    def stop(self):
        if self.running:
            self.scheduler.shutdown()
            self.running = False
            logger.info("Outcome classifier scheduler stopped")

    async def classify_pending_sessions(
        self, *, classifier: Optional[object] = None
    ) -> dict[str, int]:
        """One tick. Never raises: a broken classifier is not an outage.

        Returns per-outcome counts plus ``skipped`` (provider-gated classifier
        with no provider) and ``failed`` (the batch was rolled back), so a test
        can assert containment on a real artefact instead of asserting that
        nothing was thrown.
        """
        stats = {
            "classified": 0,
            "resolved": 0,
            "abandoned": 0,
            "escalated": 0,
            "no-answer": 0,
            "skipped": 0,
            "failed": 0,
        }
        active_classifier = classifier or DEFAULT_CLASSIFIER

        try:
            if requires_provider(active_classifier):
                if not await self._any_agent_has_provider():
                    stats["skipped"] = 1
                    if not self._provider_skip_logged:
                        self._provider_skip_logged = True
                        logger.info(
                            "Outcome classification skipped: no agent has an LLM "
                            "provider configured. Sessions keep outcome=NULL and "
                            "will be classified once a key exists."
                        )
                    return stats
            # Its OWN transaction, opened here and closed with the batch. If the
            # block raises, `AsyncSessionLocal` rolls back everything this batch
            # wrote and nothing else.
            async with AsyncSessionLocal() as db:
                stats.update(await self._classify_batch(db, active_classifier))
        except Exception as exc:  # containment is the whole contract
            stats["failed"] += 1
            logger.warning(
                "Outcome classification batch aborted and rolled back: %s", exc,
                exc_info=True,
            )
        return stats

    async def _any_agent_has_provider(self) -> bool:
        async with AsyncSessionLocal() as db:
            agents = list((await db.execute(select(Agent))).scalars().all())
        return any(provider_configured(agent) for agent in agents)

    async def _classify_batch(
        self, db: AsyncSession, classifier
    ) -> dict[str, int]:
        """Read a batch, call the classifier per row, write the verdicts, commit."""
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=self.quiet_minutes)
        rows = list(
            (
                await db.execute(
                    classify_candidates_query(cutoff, self.batch_size)
                )
            )
            .scalars()
            .all()
        )
        counts = {
            "classified": 0,
            "resolved": 0,
            "abandoned": 0,
            "escalated": 0,
            "no-answer": 0,
        }
        if not rows:
            return counts

        for row in rows:
            messages = list(
                (
                    await db.execute(
                        select(ChatMessage)
                        .where(ChatMessage.session_id == row.id)
                        .order_by(ChatMessage.id.asc())
                    )
                )
                .scalars()
                .all()
            )
            snapshot = snapshot_from_rows(row, messages)
            # The classifier is called OUTSIDE any write: if it raises, the batch
            # rolls back and no row was touched by this iteration either.
            verdict = await classifier(snapshot)
            if verdict is None:
                continue
            outcome = verdict.outcome
            if outcome not in OUTCOME_VALUES:
                logger.warning(
                    "Classifier returned an unknown outcome %r for session %s; "
                    "the row is left as it was",
                    outcome,
                    row.id,
                )
                continue
            row.outcome = outcome
            if verdict.topic:
                row.topic = verdict.topic[:TOPIC_MAX_CHARS]
            if verdict.sentiment:
                row.sentiment = verdict.sentiment
            counts["classified"] += 1
            counts[outcome] = counts.get(outcome, 0) + 1

        await db.commit()
        if counts["classified"]:
            logger.info(
                "Classified %s finished session(s): %s",
                counts["classified"],
                {k: v for k, v in counts.items() if k != "classified" and v},
            )
        return counts

outcome_classifier_scheduler = OutcomeClassifierScheduler()
