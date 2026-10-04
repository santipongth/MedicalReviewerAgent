"""Review use cases shared by the REST API and the MCP server."""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.exc import IntegrityError

from app.config import Settings
from app.db.models import Review
from app.db.repositories import ReviewRepository
from app.logging import get_logger
from app.schemas.review import CreateReviewRequest, ReviewCreated, compute_cache_key, hash_ip
from app.services.api_keys import ApiKeyInfo, reviews_since
from app.services.ratelimits import RateLimits

log = get_logger(__name__)


@dataclass(frozen=True)
class Identity:
    ip: str
    api_key: ApiKeyInfo | None = None

    @property
    def rate_key(self) -> str:
        return f"key:{self.api_key.id}" if self.api_key else f"ip:{self.ip}"


class ServiceError(Exception):
    status_code = 400

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


class RateLimited(ServiceError):
    status_code = 429

    def __init__(self, retry_after: int, detail: str = "rate limit exceeded") -> None:
        super().__init__(detail)
        self.retry_after = retry_after


class QueueUnavailable(ServiceError):
    status_code = 503

    def __init__(self, review_id: uuid.UUID) -> None:
        super().__init__("queue unavailable, try again")
        self.review_id = review_id


class Forbidden(ServiceError):
    status_code = 403


class ReviewService:
    def __init__(self, session_factory, queue, event_sink, settings: Settings, limits: RateLimits) -> None:
        self.session_factory = session_factory
        self.queue = queue
        self.event_sink = event_sink
        self.settings = settings
        self.limits = limits

    async def _reuse(self, cache_key: str) -> ReviewCreated | None:
        done_after = datetime.now(UTC) - timedelta(seconds=self.settings.result_cache_ttl_seconds)
        async with self.session_factory() as session:
            existing = await ReviewRepository(session).find_reusable(cache_key, done_after)
        if existing is None:
            return None
        return ReviewCreated(review_id=existing.id, status=existing.status, cached=True)

    async def create(self, req: CreateReviewRequest, *, identity: Identity) -> ReviewCreated:
        options = req.options.model_dump()
        cache_key = compute_cache_key(req.topic, req.language, options)
        if (cached := await self._reuse(cache_key)) is not None:  # cache hits are free
            return cached
        if req.callback_url and identity.api_key is None:
            raise Forbidden("callback_url requires an API key")
        if identity.api_key is not None:
            async with self.session_factory() as session:
                used = await reviews_since(session, identity.api_key.id, datetime.now(UTC) - timedelta(days=1))
            if used >= identity.api_key.daily_quota:
                raise RateLimited(3600, f"daily quota of {identity.api_key.daily_quota} reviews exhausted")
        rate = self.settings.api_key_rate_limit if identity.api_key else self.settings.review_rate_limit
        decision = await self.limits.hit("review", identity.rate_key, rate)
        if not decision.allowed:
            raise RateLimited(decision.retry_after)
        try:
            async with self.session_factory() as session, session.begin():
                review = await ReviewRepository(session).create(
                    topic=req.topic, language=req.language, options=options, cache_key=cache_key,
                    ip_hash=hash_ip(identity.ip, self.settings.ip_hash_salt),
                    callback_url=str(req.callback_url) if req.callback_url else None,
                    api_key_id=identity.api_key.id if identity.api_key else None,
                )
                review_id = review.id
        except IntegrityError:
            # Another request/replica inserted the active review for this cache key first.
            if (cached := await self._reuse(cache_key)) is not None:
                return cached
            raise
        try:
            await self.event_sink.emit(review_id, "queued", {"topic": req.topic})
            await self.queue.enqueue_review(review_id)
        except Exception as exc:
            log.exception("enqueue_failed", review_id=str(review_id))
            # Leave no active row behind: an un-enqueued "queued" review would be served as a cache hit forever.
            async with self.session_factory() as session, session.begin():
                await ReviewRepository(session).update(review_id, status="error",
                                                       error=f"enqueue failed: {type(exc).__name__}",
                                                       finished_at=datetime.now(UTC))
            raise QueueUnavailable(review_id) from exc
        return ReviewCreated(review_id=review_id, status="queued", cached=False)

    async def get(self, review_id: uuid.UUID) -> Review | None:
        async with self.session_factory() as session:
            return await ReviewRepository(session).get(review_id)

    async def list_recent(self, limit: int = 20) -> list[Review]:
        async with self.session_factory() as session:
            return await ReviewRepository(session).list_recent(limit=limit)
