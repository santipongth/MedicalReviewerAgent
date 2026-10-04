"""Review use cases shared by the REST API and the MCP server."""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy.exc import IntegrityError

from app.config import Settings
from app.db.models import TERMINAL_STATUSES, Review
from app.db.repositories import ReviewRepository
from app.logging import get_logger
from app.schemas.review import CreateReviewRequest, ReviewCreated, compute_cache_key, hash_ip
from app.services.api_keys import ApiKeyInfo, reviews_since
from app.services.ratelimits import RateLimits
from app.services.urlsafety import is_public_http_url
from app.services.webhook import callback_url_problem

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


class Unavailable(ServiceError):
    """503: the service is not accepting new reviews right now (queue full, daily capacity, captcha provider down)."""
    status_code = 503

    def __init__(self, detail: str, retry_after: int, reason: str) -> None:
        super().__init__(detail)
        self.retry_after = retry_after
        self.reason = reason


class Forbidden(ServiceError):
    status_code = 403


class Unprocessable(ServiceError):
    status_code = 422


class NotFound(ServiceError):
    status_code = 404


class Conflict(ServiceError):
    status_code = 409


class ReviewService:
    def __init__(self, session_factory, queue, event_sink, settings: Settings, limits: RateLimits,
                 url_check=is_public_http_url, capacity=None) -> None:
        self.url_check = url_check
        self.capacity = capacity  # app.services.capacity.Capacity; None → no admission control (unit tests)
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
        cache_key = compute_cache_key(req.topic, req.language, options, self.settings.prompt_version)
        if req.callback_url and identity.api_key is None:
            raise Forbidden("callback_url requires an API key")
        if (cached := await self._reuse(cache_key)) is not None:  # cache hits are free; no webhook for them
            return cached
        if req.callback_url and (problem := await callback_url_problem(
                str(req.callback_url), allow_http=self.settings.webhook_allow_http, url_check=self.url_check)):
            raise Unprocessable(problem)
        if identity.api_key is not None:
            async with self.session_factory() as session:
                used = await reviews_since(session, identity.api_key.id, datetime.now(UTC) - timedelta(days=1))
            if used >= identity.api_key.daily_quota:
                raise RateLimited(3600, f"daily quota of {identity.api_key.daily_quota} reviews exhausted")
        if self.capacity is not None:  # after the cache: cache hits are free even when the service is full
            async with self.session_factory() as session:
                queued = await ReviewRepository(session).count_by_status("queued")
            if (refusal := await self.capacity.check(queued=queued)) is not None:
                raise Unavailable(refusal.detail, refusal.retry_after, refusal.reason)
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
        if self.capacity is not None:
            try:
                await self.capacity.note_review()
            except Exception:  # noqa: BLE001 - a counter hiccup must not fail an accepted review
                log.warning("capacity_count_failed", review_id=str(review_id))
        return ReviewCreated(review_id=review_id, status="queued", cached=False,
                             callback_scheduled=bool(req.callback_url))

    async def status(self) -> dict:
        """Public service status: whether new reviews are accepted and the limits callers must respect."""
        from app.schemas.review import ReviewOptions
        async with self.session_factory() as session:
            repo = ReviewRepository(session)
            queued, running = await repo.count_by_status("queued"), await repo.count_by_status("running")
        refusal = await self.capacity.check(queued=queued) if self.capacity is not None else None
        fields = ReviewOptions.model_fields

        def bounds(name: str) -> dict:
            meta = fields[name].metadata
            return {"min": next(m.ge for m in meta if getattr(m, "ge", None) is not None),
                    "max": next(m.le for m in meta if getattr(m, "le", None) is not None),
                    "default": fields[name].default}
        s = self.settings
        return {
            "accepting": refusal is None, "reason": refusal.reason if refusal else None,
            "retry_after": refusal.retry_after if refusal else None,
            "queue_depth": queued, "running": running,
            "reviews_today": await self.capacity.reviews_today() if self.capacity is not None else None,
            "limits": {"review_rate_limit": s.review_rate_limit, "api_key_rate_limit": s.api_key_rate_limit,
                       "paper_search_rate_limit": s.paper_search_rate_limit,
                       "max_papers": bounds("max_papers"), "candidate_limit": bounds("candidate_limit"),
                       "max_queued_reviews": s.max_queued_reviews},
        }

    def sse_key(self, ip: str) -> str:
        return hash_ip(ip, self.settings.ip_hash_salt)  # raw addresses never reach Redis

    async def queue_position(self, review) -> int | None:
        async with self.session_factory() as session:
            return await ReviewRepository(session).queue_position(review)

    async def cancel(self, review_id: uuid.UUID, *, identity: Identity) -> str:
        """Owner key (or an admin key) cancels a queued/running review; the worker job is aborted."""
        key = identity.api_key
        if key is None:
            raise Forbidden("an API key is required")
        review = await self.get(review_id)
        if review is None:
            raise NotFound("review not found")
        if not key.is_admin and review.api_key_id != key.id:
            raise Forbidden("only the API key that created this review (or an admin key) can cancel it")
        by = "owner" if review.api_key_id == key.id else "admin"  # key names stay private
        async with self.session_factory() as session, session.begin():
            changed = await ReviewRepository(session).update_unless(
                review_id, TERMINAL_STATUSES, status="cancelled", finished_at=datetime.now(UTC),
                error=f"cancelled by the {by}")
        if not changed:
            raise Conflict(f"review is already {review.status}")
        await self.event_sink.emit(review_id, "cancelled", {"by": by})
        if review.callback_url and hasattr(self.queue, "enqueue_webhook"):
            await self.queue.enqueue_webhook(review_id)
        try:
            await self.queue.abort_review(review_id)
        except Exception:  # noqa: BLE001 - status is authoritative; the runner checks it
            log.warning("abort_failed", review_id=str(review_id))
        return "cancelled"

    async def get(self, review_id: uuid.UUID) -> Review | None:
        async with self.session_factory() as session:
            return await ReviewRepository(session).get(review_id)

    async def list_recent(self, limit: int = 20) -> list[Review]:
        async with self.session_factory() as session:
            return await ReviewRepository(session).list_recent(limit=limit)
