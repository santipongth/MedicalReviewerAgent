"""Admin API key management (Plan 23a): mint (the raw key is returned once), rename, change quota, revoke.
Each change writes its audit row in the same transaction; the raw key and its hash never reach the log."""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ApiKey, Review
from app.services.admin_auth import AdminPrincipal
from app.services.api_keys import mint_key, reviews_since
from app.services.audit import record
from app.services.review_service import Conflict, NotFound

DAY = timedelta(hours=24)


def _key_out(row: ApiKey, used: int) -> dict[str, Any]:
    return {"id": row.id, "key_prefix": row.key_prefix, "name": row.name, "daily_quota": row.daily_quota,
            "is_admin": bool(row.is_admin), "created_at": row.created_at, "revoked_at": row.revoked_at,
            "reviews_24h": used}


async def _used(session: AsyncSession, key_id: uuid.UUID) -> int:
    return await reviews_since(session, key_id, datetime.now(UTC) - DAY)


async def _get(session: AsyncSession, key_id: uuid.UUID) -> ApiKey:
    row = await session.get(ApiKey, key_id)
    if row is None:
        raise NotFound("key not found")
    return row


async def list_keys_with_usage(session: AsyncSession, *, now: datetime | None = None) -> list[dict[str, Any]]:
    since = (now or datetime.now(UTC)) - DAY
    counts = dict((await session.execute(
        select(Review.api_key_id, func.count()).where(Review.api_key_id.is_not(None), Review.created_at >= since)
        .group_by(Review.api_key_id))).all())
    rows = (await session.execute(select(ApiKey).order_by(ApiKey.created_at.desc(), ApiKey.id))).scalars()
    return [_key_out(r, counts.get(r.id, 0)) for r in rows]


async def mint(session: AsyncSession, actor: AdminPrincipal, *, name: str, daily_quota: int, is_admin: bool,
               ip_hash: str | None) -> tuple[str, dict[str, Any]]:
    raw, row = await mint_key(session, name, daily_quota=daily_quota, is_admin=is_admin)
    await session.refresh(row)  # created_at comes from the database default
    await record(session, actor, "key.mint", target_type="key", target_id=row.id,
                 after={"key_prefix": row.key_prefix, "name": name, "daily_quota": daily_quota, "is_admin": is_admin},
                 ip_hash=ip_hash)
    return raw, _key_out(row, 0)


async def update_key(session: AsyncSession, actor: AdminPrincipal, key_id: uuid.UUID, *, name: str | None = None,
                     daily_quota: int | None = None, ip_hash: str | None) -> dict[str, Any]:
    row = await _get(session, key_id)
    if row.revoked_at is not None:
        raise Conflict("key is revoked")
    before: dict[str, Any] = {}
    after: dict[str, Any] = {}
    for field, value in (("name", name), ("daily_quota", daily_quota)):
        if value is not None and value != getattr(row, field):
            before[field], after[field] = getattr(row, field), value
            setattr(row, field, value)
    if after:  # nothing changed: no write and no audit row
        await session.flush()
        await record(session, actor, "key.update", target_type="key", target_id=key_id, before=before, after=after,
                     ip_hash=ip_hash)
    return _key_out(row, await _used(session, key_id))


async def revoke(session: AsyncSession, actor: AdminPrincipal, key_id: uuid.UUID, *,
                 ip_hash: str | None) -> dict[str, Any]:
    row = await _get(session, key_id)
    if row.revoked_at is None:
        row.revoked_at = datetime.now(UTC)
        await session.flush()
        await record(session, actor, "key.revoke", target_type="key", target_id=key_id, before={"revoked": False},
                     after={"revoked": True}, ip_hash=ip_hash)
    return _key_out(row, await _used(session, key_id))
