"""Admin review management (Plan 23a): search, hide or show, delete. Each change writes its audit row in the same
transaction; deleting also drops the live event stream and (through a worker job) the LangGraph checkpoint."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import TERMINAL_STATUSES, ApiKey, Review, ReviewEvent, ReviewPaper, ReviewStatus
from app.logging import get_logger
from app.services.admin_auth import AdminPrincipal
from app.services.audit import record
from app.services.events import stream_key
from app.services.review_service import Conflict, NotFound

log = get_logger(__name__)

STATUSES = frozenset(s.value for s in ReviewStatus)
TOPIC_PREVIEW = 200
_COLUMNS = (Review.id, Review.topic, Review.status, Review.options, Review.created_at, Review.finished_at,
            Review.cost_usd, Review.is_listed, Review.prompt_version, Review.error, ApiKey.key_prefix)


def encode_cursor(created_at: datetime, review_id: uuid.UUID) -> str:
    return f"{created_at.isoformat()}|{review_id}"


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    stamp, sep, rid = cursor.rpartition("|")
    if not sep:
        raise ValueError("invalid cursor")
    return datetime.fromisoformat(stamp), uuid.UUID(rid)


def _contains(q: str) -> str:
    """A LIKE pattern that matches q literally: %, _ and the escape character itself are escaped."""
    escaped = q.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _row_out(row) -> dict[str, Any]:
    return {"id": row.id, "topic": row.topic[:TOPIC_PREVIEW], "status": row.status,
            "review_type": (row.options or {}).get("review_type") or "slr", "created_at": row.created_at,
            "finished_at": row.finished_at, "cost_usd": row.cost_usd, "is_listed": row.is_listed,
            "api_key_prefix": row.key_prefix, "prompt_version": row.prompt_version, "error": row.error}


async def list_reviews(session: AsyncSession, *, q: str | None = None, status: str | None = None,
                       listed: bool | None = None, before: tuple[datetime, uuid.UUID] | None = None,
                       limit: int = 50) -> tuple[list[dict[str, Any]], str | None]:
    """Newest first, keyset-paged on (created_at, id) so reviews created in the same instant are never skipped."""
    stmt = select(*_COLUMNS).outerjoin(ApiKey, Review.api_key_id == ApiKey.id)
    if q and q.strip():
        stmt = stmt.where(func.lower(Review.topic).like(_contains(q.strip()), escape="\\"))
    if status:
        stmt = stmt.where(Review.status == status)
    if listed is not None:
        stmt = stmt.where(Review.is_listed.is_(listed))
    if before is not None:
        created, rid = before
        stmt = stmt.where(or_(Review.created_at < created, and_(Review.created_at == created, Review.id < rid)))
    stmt = stmt.order_by(Review.created_at.desc(), Review.id.desc()).limit(limit + 1)
    rows = (await session.execute(stmt)).all()
    cursor = encode_cursor(rows[limit - 1].created_at, rows[limit - 1].id) if len(rows) > limit else None
    return [_row_out(r) for r in rows[:limit]], cursor


async def set_listed(session: AsyncSession, actor: AdminPrincipal, review_id: uuid.UUID, listed: bool, *,
                     ip_hash: str | None) -> dict[str, Any]:
    review = await session.get(Review, review_id)
    if review is None:
        raise NotFound("review not found")
    before = review.is_listed
    review.is_listed = listed
    await record(session, actor, "review.show" if listed else "review.hide", target_type="review",
                 target_id=review_id, before={"is_listed": before}, after={"is_listed": listed}, ip_hash=ip_hash)
    return {"id": review_id, "is_listed": listed}


async def delete_review(session: AsyncSession, actor: AdminPrincipal, review_id: uuid.UUID, *,
                        ip_hash: str | None) -> None:
    """Only a finished review. Its events and paper links go with it (deleted explicitly: sqlite does not enforce
    cascades); the shared `papers` rows stay, other reviews use them."""
    review = await session.get(Review, review_id)
    if review is None:
        raise NotFound("review not found")
    if review.status not in TERMINAL_STATUSES:
        raise Conflict(f"review is {review.status}; cancel it before deleting")
    before = {"topic": review.topic[:TOPIC_PREVIEW], "status": review.status, "created_at": review.created_at,
              "cost_usd": review.cost_usd, "prompt_version": review.prompt_version}
    await session.execute(delete(ReviewEvent).where(ReviewEvent.review_id == review_id))
    await session.execute(delete(ReviewPaper).where(ReviewPaper.review_id == review_id))
    await session.delete(review)
    await session.flush()
    await record(session, actor, "review.delete", target_type="review", target_id=review_id, before=before,
                 ip_hash=ip_hash)


async def forget_review(redis, queue, review_id: uuid.UUID) -> None:
    """After the delete commits: drop the live event stream and ask a worker to drop the LangGraph checkpoint.
    Best-effort: the review is already gone, so a failure here is only logged."""
    try:
        await redis.delete(stream_key(review_id))
    except Exception:  # noqa: BLE001 - the stream expires by itself (event_stream_ttl_seconds)
        log.warning("admin_delete_stream_failed", review_id=str(review_id))
    try:
        await queue.enqueue_checkpoint_delete(review_id)
    except Exception:  # noqa: BLE001 - an orphaned checkpoint is harmless and small
        log.warning("admin_delete_checkpoint_enqueue_failed", review_id=str(review_id))
