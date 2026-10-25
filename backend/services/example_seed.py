"""Built-in example content: one demo agent plus the knowledge base it reads from.

A freshly installed Basjoo ships exactly ONE example agent so that a new super
admin sees something useful immediately after creating the account:

* a knowledge base (``EXAMPLE_KB_NAME``) on the ``local`` embedding provider —
  the self-hosted TEI container, no API key involved;
* an agent (``EXAMPLE_AGENT_NAME``) bound to that KB;
* one pending URL source (``EXAMPLE_URL``) — the project home page, which is the
  KB's content.

Indexing is deliberately NOT scheduled here. The URL row is written as
``status="pending"`` and nothing else: this module adds no background job and no
scheduler entry. The operator triggers the actual fetch + embedding from the URL
management page ("重建索引") once they decide to keep the example. That keeps the
first login cheap and lets a deployment that never wants the example simply skip
indexing it.

Failure policy — this runs inside the login and registration request paths:

* the embedding probe is wrapped in try/except and only logs; an unreachable TEI
  container must never turn into a failed login,
* everything is written in a single session and committed once; any error rolls
  back and is logged,
* the guard is "does this workspace already have any agent", so a partial failure
  is retried on the next login (self-healing) and a successful seed never runs
  twice.
"""

import logging
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

EXAMPLE_AGENT_DESCRIPTION = "示例智能体：绑定 Basjoo 项目知识库，可直接对话体验 RAG 检索效果。"

EXAMPLE_SYSTEM_PROMPT = (
    "你是 Basjoo 助手，负责介绍并演示 Basjoo 这个开源 AI 智能客服平台。\n\n"
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

    Without this the workspace would keep an unbound KB and the next login would
    create yet another one (the seed's guard looks at agents, not at KBs).
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

async def ensure_example_agent(workspace_id: Optional[int]) -> None:
    """Create the example KB + agent + pending URL source for one workspace.

    Idempotent (at most one example per workspace, and only ever when the
    workspace has no agent at all) and exception-safe (it must never break the
    request that calls it).
    """
    if not workspace_id:
        return

    created_kb_id: Optional[str] = None
    try:
        async with database.AsyncSessionLocal() as session:
            if await _workspace_has_agent(session, workspace_id):
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

            session.add(
                URLSource(
                    agent_id=agent.id,
                    url=EXAMPLE_URL,
                    normalized_url=normalize_url(EXAMPLE_URL),
                    status="pending",
                )
            )
            await session.commit()

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
