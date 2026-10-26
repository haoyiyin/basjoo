"""Built-in example content: one demo agent plus the knowledge base it reads from.

A freshly installed Basjoo ships exactly ONE example agent so that a new super
admin sees something useful immediately after creating the account:

* a knowledge base (``EXAMPLE_KB_NAME``) on the ``local`` embedding provider —
  the self-hosted TEI container, no API key involved;
* an agent (``EXAMPLE_AGENT_NAME``) bound to that KB;
* one pending URL source (``EXAMPLE_URL``) — the project home page, which is the
  KB's content.

Indexing IS scheduled here, but never inline: after the KB + agent + URL row are
committed, ``process_url_refetch`` is queued with ``asyncio.create_task`` so login
stays cheap and a slow/unreachable embedding provider cannot hold the request.
When the lock is already held (another refetch running for that KB) the row simply
stays ``pending``; the scheduler's never-fetched catch-all picks it up within the
hour. A failed fetch writes ``status="failed"`` and ``last_error`` — a fetched
row is never left silently ``pending`` with no error.

Failure policy — this runs inside the login and registration request paths:

* the embedding probe is wrapped in try/except and only logs; an unreachable TEI
  container must never turn into a failed login,
* everything is written in a single session and committed once; any error rolls
  back and is logged,
* the guards are "this workspace already has any agent" (soft-deleted included)
  and "this workspace already has a KB named ``EXAMPLE_KB_NAME``", so a partial
  failure is retried on the next login (self-healing) and a successful seed never
  runs twice.
"""

import asyncio
import logging
import uuid
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import database
from config import settings
from models import Agent, KnowledgeBase, URLSource, normalize_url
from services.document_parser import DocumentParser
from services.kb_service import KbService
from services.qdrant_service import QdrantKbService

logger = logging.getLogger(__name__)

EXAMPLE_AGENT_NAME = "Basjoo 助手"
EXAMPLE_KB_NAME = "Basjoo 项目知识库"
EXAMPLE_URL = "https://github.com/haoyiyin/basjoo"

# One short string is enough to measure the vector width of the local provider.
PROBE_TEXT = "basjoo-example-seed-probe"

EXAMPLE_AGENT_DESCRIPTION = (
    "示例智能体：已绑定 Basjoo 项目知识库，但出厂未配置 LLM 密钥，"
    "需先在 设置 → AI 配置 中配置密钥才能对话。"
)

EXAMPLE_SYSTEM_PROMPT = (
    "你是 Basjoo 助手，负责介绍并演示 Basjoo 这个开源 AI 智能客服平台。\n\n"
    "注意：这个示例智能体出厂时没有配置任何 LLM 密钥，在管理员到 "
    "设置 → AI 配置 配置好密钥之前，对话无法进行（接口会直接报错 "
    "API_KEY_MISSING）。请提醒对方先去配置密钥。\n\n"
    "Basjoo 的能力主要包括：\n"
    "1. RAG 知识库：把网页和文档抓取、切块、向量化后存入向量库，回答时先检索再生成；\n"
    "2. 多 provider 的智能体：可配置 OpenAI 兼容接口、Anthropic、DeepSeek、"
    "Gemini、通义、Kimi、硅基流动等模型服务商；\n"
    "3. 可嵌入的聊天组件：把客服窗口嵌入到任意网站，并支持来源展示、人工接管、会话管理。\n\n"
    "回答规则：\n"
    "- 只回答与 Basjoo 本项目相关的问题（功能、部署、配置、知识库、聊天组件、接口用法等）；\n"
    "- 优先依据绑定的知识库内容作答，知识库来源是项目主页 " + EXAMPLE_URL + "；\n"
    "- 知识库里查不到、或者你不确定的内容，直接说不知道，不要编造功能、"
    "版本号、价格或性能数字，并建议对方到项目主页查看或提 issue；\n"
    "- 与 Basjoo 无关的问题，礼貌说明你只了解 Basjoo 这个项目；\n"
    "- 用与提问者相同的语言回答，简洁清楚。"
)

async def _workspace_has_agent(session: AsyncSession, workspace_id: int) -> bool:
    """Idempotency guard: ANY agent row counts, soft-deleted ones included.

    A deleted example agent means "the operator already had their one example and
    removed it"; recreating it on the next login would be hostile, so `deleted_at`
    is deliberately not filtered here.
    """
    agent_id = await session.scalar(
        select(Agent.id).where(Agent.workspace_id == workspace_id).limit(1)
    )
    return agent_id is not None

async def _workspace_has_example_kb(session: AsyncSession, workspace_id: int) -> bool:
    """Second idempotency guard: one KB named ``EXAMPLE_KB_NAME`` per workspace.

    Covers the case where the KB commit succeeded but the agent write did not (or
    an operator rebound/deleted the agent): the next login must not mint a second
    example KB in the same workspace.
    """
    kb_id = await session.scalar(
        select(KnowledgeBase.id)
        .where(
            KnowledgeBase.workspace_id == workspace_id,
            KnowledgeBase.name == EXAMPLE_KB_NAME,
        )
        .limit(1)
    )
    return kb_id is not None

async def _probe_local_dimension() -> Optional[int]:
    """Measure the local provider's vector width, or None when it is unreachable.

    Never raises: during startup or on a machine without the TEI container the
    probe fails, and the caller must simply skip the seed (login still works, and
    the next login retries once the model container is up).
    """
    try:
        vectors = await DocumentParser().embed_texts(
            [PROBE_TEXT],
            model=settings.local_embedding_model,
            base_url=settings.local_embedding_base_url,
            timeout=3.0,
        )
    except Exception as exc:
        logger.warning(
            "Local embedding provider unavailable (%s: %s); example seed skipped for now",
            type(exc).__name__,
            exc,
        )
        return None

    if not vectors or not vectors[0]:
        logger.warning("Local embedding probe returned no vectors; example seed skipped")
        return None
    return len(vectors[0])

async def _discard_orphan_kb(kb_id: str) -> None:
    """Best-effort cleanup when the KB was committed but the agent was not.

    The agent guard is still unsatisfied, so without this the retry would hit the
    KB guard on a half-seeded KB with no agent and leave it orphaned for good.
    """
    try:
        async with database.AsyncSessionLocal() as session:
            kb = await session.get(KnowledgeBase, kb_id)
            if kb is not None:
                await session.delete(kb)
                await session.commit()
        await QdrantKbService().delete_collection(kb_id)
    except Exception as exc:
        logger.warning("Could not discard orphan KB %s: %s", kb_id, exc)

async def _queue_example_fetch(kb_id: str, url_id: int) -> None:
    """Queue the first fetch of the example URL without blocking the request.

    The task lock is keyed by ``kb_id`` (see ``task_lock.py``). Two outcomes are
    both acceptable and neither is an error:

    * lock acquired → ``process_url_refetch`` runs in a detached task and moves
      the row to ``success``/``failed`` (with ``last_error`` on the latter),
    * lock already held → we leave the row ``pending``; the scheduler's
      never-fetched catch-all picks it up later.

    Imported defensively so a seed never fails because a background module could
    not be imported.
    """
    try:
        from services.task_lock import TaskType, task_lock
        from services.url_service import process_url_refetch
    except Exception as exc:  # pragma: no cover - import-time only
        logger.warning("Example fetch not queued (%s: %s)", type(exc).__name__, exc)
        return

    job_id = f"refetch_{kb_id}_{uuid.uuid4().hex[:8]}"
    acquired, error = await task_lock.acquire_task(
        kb_id, TaskType.URL_REFETCH, job_id
    )
    if not acquired:
        logger.info(
            "Example fetch for KB %s left pending (lock held: %s); "
            "the scheduler catch-all will pick it up",
            kb_id,
            error,
        )
        return

    async def _run() -> None:
        try:
            await process_url_refetch(
                kb_id=kb_id,
                url_ids=[url_id],
                force=False,
                job_id=job_id,
                source_agent_id=None,
            )
        except Exception as exc:  # never surface into the request path
            logger.warning(
                "Example fetch task failed for KB %s (%s: %s)",
                kb_id,
                type(exc).__name__,
                exc,
            )
            try:
                async with database.AsyncSessionLocal() as session:
                    row = await session.get(URLSource, url_id)
                    if row is not None and row.status in ("pending", "fetching"):
                        row.status = "failed"
                        row.last_error = str(exc)[:500]
                        await session.commit()
            except Exception:
                logger.exception("Could not persist example fetch failure")

    try:
        asyncio.create_task(_run())
    except Exception as exc:  # pragma: no cover - no running loop
        logger.warning("Example fetch task not created (%s: %s)", type(exc).__name__, exc)
        await task_lock.release_task(kb_id, job_id)
        async with database.AsyncSessionLocal() as session:
            row = await session.get(URLSource, url_id)
            if row is not None and row.status == "pending":
                row.status = "failed"
                row.last_error = str(exc)[:500]
                await session.commit()

async def ensure_example_agent(workspace_id: Optional[int]) -> None:
    """Create the example KB + agent + pending URL source for one workspace.

    Idempotent (at most one example per workspace, and only ever when the
    workspace has no agent at all) and exception-safe (it must never break the
    request that calls it). The first fetch is queued as a detached task after the
    commit, so login is never blocked on the network.
    """
    if not workspace_id:
        return

    created_kb_id: Optional[str] = None
    try:
        async with database.AsyncSessionLocal() as session:
            if await _workspace_has_agent(session, workspace_id):
                return

            if await _workspace_has_example_kb(session, workspace_id):
                logger.info(
                    "Workspace %s already owns a %s; example seed skipped",
                    workspace_id,
                    EXAMPLE_KB_NAME,
                )
                return

            dimension = await _probe_local_dimension()
            if dimension is None:
                return

            kb = await KbService(session=session).create_knowledge_base(
                workspace_id,
                EXAMPLE_KB_NAME,
                embedding_provider="local",
                embedding_model=settings.local_embedding_model,
                embedding_base_url=settings.local_embedding_base_url,
                embedding_api_key=None,
                embedding_dimension=dimension,
            )
            created_kb_id = str(kb.id)

            agent = Agent(
                workspace_id=workspace_id,
                name=EXAMPLE_AGENT_NAME,
                description=EXAMPLE_AGENT_DESCRIPTION,
                system_prompt=EXAMPLE_SYSTEM_PROMPT,
                model="",
                provider_type="openai",
                api_key="",
                api_base="",
                kb_id=created_kb_id,
            )
            session.add(agent)
            await session.flush()  # assigns the generated agent id

            url_source = URLSource(
                kb_id=created_kb_id,
                url=EXAMPLE_URL,
                normalized_url=normalize_url(EXAMPLE_URL),
                status="pending",
            )
            session.add(url_source)
            await session.commit()
            url_id = url_source.id

            logger.info(
                "Seeded example agent %s (KB %s, %d-dim local embeddings) in workspace %s",
                agent.id,
                created_kb_id,
                dimension,
                workspace_id,
            )
    except Exception as exc:
        logger.warning(
            "Example seed failed for workspace %s (%s: %s); login is unaffected",
            workspace_id,
            type(exc).__name__,
            exc,
        )
        if created_kb_id:
            await _discard_orphan_kb(created_kb_id)
        return

    # Queued AFTER the commit, and outside the try/except above: the rows exist, so
    # a queueing failure must never roll them back. `_queue_example_fetch` is
    # itself exception-safe.
    if created_kb_id and url_id is not None:
        await _queue_example_fetch(created_kb_id, url_id)
