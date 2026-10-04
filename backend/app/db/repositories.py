from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Review, ReviewEvent, ReviewStatus

ACTIVE_STATUSES = (ReviewStatus.queued.value, ReviewStatus.running.value)


class ReviewRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def create(
        self,
        *,
        topic: str,
        language: str,
        options: dict[str, Any],
        cache_key: str,
        ip_hash: str | None = None,
        callback_url: str | None = None,
        api_key_id: uuid.UUID | None = None,
    ) -> Review:
        review = Review(
            topic=topic,
            language=language,
            options=options,
            cache_key=cache_key,
            ip_hash=ip_hash,
            callback_url=callback_url,
            api_key_id=api_key_id,
        )
        self.session.add(review)
        await self.session.flush()
        return review

    async def get(self, review_id: uuid.UUID) -> Review | None:
        return await self.session.get(Review, review_id)

    async def find_reusable(self, cache_key: str, done_after: datetime) -> Review | None:
        stmt = (
            select(Review)
            .where(Review.cache_key == cache_key)
            .where(
                or_(
                    Review.status.in_(ACTIVE_STATUSES),
                    (Review.status == ReviewStatus.done.value) & (Review.finished_at >= done_after),
                )
            )
            .order_by(Review.created_at.desc())
            .limit(1)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def update(self, review_id: uuid.UUID, **fields: Any) -> None:
        await self.session.execute(update(Review).where(Review.id == review_id).values(**fields))

    async def list_recent(self, limit: int = 20) -> list[Review]:
        stmt = (
            select(Review)
            .where(Review.status == ReviewStatus.done.value, Review.is_listed.is_(True))
            .order_by(Review.finished_at.desc())
            .limit(limit)
        )
        return list((await self.session.execute(stmt)).scalars())

    async def list_stale_running(self, older_than: datetime) -> list[Review]:
        stmt = select(Review).where(
            Review.status == ReviewStatus.running.value, Review.started_at < older_than
        )
        return list((await self.session.execute(stmt)).scalars())


class EventRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def append(self, review_id: uuid.UUID, type: str, payload: dict[str, Any]) -> ReviewEvent:
        next_seq = (
            await self.session.execute(
                select(func.coalesce(func.max(ReviewEvent.seq), 0) + 1).where(
                    ReviewEvent.review_id == review_id
                )
            )
        ).scalar_one()
        event = ReviewEvent(review_id=review_id, seq=next_seq, type=type, payload=payload)
        self.session.add(event)
        await self.session.flush()
        return event

    async def list_since(self, review_id: uuid.UUID, after_seq: int = 0) -> list[ReviewEvent]:
        stmt = (
            select(ReviewEvent)
            .where(ReviewEvent.review_id == review_id, ReviewEvent.seq > after_seq)
            .order_by(ReviewEvent.seq)
        )
        return list((await self.session.execute(stmt)).scalars())
