"""API keys: unlock higher quotas, webhooks, cancellation and admin endpoints. Only SHA-256 hashes are stored."""
from __future__ import annotations

import hashlib
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ApiKey, Review

KEY_PREFIX = "mra_"
PREFIX_LEN = 12  # shown in listings; identifies a key without revealing it


@dataclass(frozen=True)
class ApiKeyInfo:
    id: uuid.UUID
    name: str
    daily_quota: int
    is_admin: bool
    key_hash: str
    key_prefix: str | None = None  # labels admin actions taken with this key (Plan 23a)


def hash_key(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def mint_key(session: AsyncSession, name: str, *, daily_quota: int = 100,
                   is_admin: bool = False) -> tuple[str, ApiKey]:
    """Returns the raw key (shown once, never stored) and the stored row."""
    raw = KEY_PREFIX + secrets.token_urlsafe(32)
    row = ApiKey(key_hash=hash_key(raw), key_prefix=raw[:PREFIX_LEN], name=name, daily_quota=daily_quota,
                 is_admin=is_admin)
    session.add(row)
    await session.flush()
    return raw, row


async def resolve_key(session: AsyncSession, raw: str) -> ApiKeyInfo | None:
    row = (await session.execute(select(ApiKey).where(ApiKey.key_hash == hash_key(raw)))).scalar_one_or_none()
    if row is None or row.revoked_at is not None:
        return None
    return ApiKeyInfo(id=row.id, name=row.name, daily_quota=row.daily_quota, is_admin=bool(row.is_admin),
                      key_hash=row.key_hash, key_prefix=row.key_prefix)


async def revoke_key(session: AsyncSession, prefix: str) -> int:
    result = await session.execute(update(ApiKey).where(ApiKey.key_prefix == prefix, ApiKey.revoked_at.is_(None))
                                   .values(revoked_at=datetime.now(UTC)))
    return result.rowcount or 0


async def list_keys(session: AsyncSession) -> list[ApiKey]:
    return list((await session.execute(select(ApiKey).order_by(ApiKey.created_at))).scalars())


async def reviews_since(session: AsyncSession, key_id: uuid.UUID, since: datetime) -> int:
    stmt = select(func.count()).select_from(Review).where(Review.api_key_id == key_id, Review.created_at >= since)
    return int((await session.execute(stmt)).scalar_one())
