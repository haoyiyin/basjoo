"""URL knowledge source service (extracted from endpoints.py per AGENTS.md)."""

from typing import Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from models import URLSource, normalize_url
from api.v1.schemas import URLCreateRequest, URLItem, URLListResponse


async def list_urls(
    db: AsyncSession, agent_id: str, skip: int = 0, limit: int = 100
) -> URLListResponse:
    stmt = (
        select(URLSource)
        .where(URLSource.agent_id == agent_id)
        .order_by(URLSource.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(stmt)
    url_sources = result.scalars().all()

    total = (
        await db.execute(
            select(func.count(URLSource.id)).where(URLSource.agent_id == agent_id)
        )
    ).scalar() or 0

    quota: dict[str, int] = {
        "used": total,
        "max": 500,
    }  # TODO: pull from WorkspaceQuota
    items = [URLItem.model_validate(u) for u in url_sources]
    return URLListResponse(urls=items, total=total, quota=quota)


async def create_urls(
    db: AsyncSession, agent_id: str, payload: URLCreateRequest
) -> URLListResponse:
    for url_str in payload.urls:
        normalized = normalize_url(url_str)
        exists = (
            await db.execute(
                select(URLSource).where(
                    URLSource.agent_id == agent_id,
                    URLSource.normalized_url == normalized,
                )
            )
        ).scalar_one_or_none()
        if exists:
            continue
        us = URLSource(
            agent_id=agent_id, url=url_str, normalized_url=normalized, status="pending"
        )
        db.add(us)
    await db.commit()
    return await list_urls(db, agent_id, 0, 100)


async def delete_url(db: AsyncSession, agent_id: str, url_id: int) -> dict[str, bool]:
    us = await db.get(URLSource, url_id)
    if us is None or us.agent_id != agent_id:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="URL not found")
    await db.delete(us)
    await db.commit()
    return {"success": True}


async def clear_all_urls(db: AsyncSession, agent_id: str) -> dict[str, bool]:
    await db.execute(delete(URLSource).where(URLSource.agent_id == agent_id))
    await db.commit()
    return {"success": True}
