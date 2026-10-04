from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from app.api.deps import get_deps, get_settings_dep
from app.api.ratelimit import client_ip, limiter
from app.config import Settings, get_settings
from app.db.repositories import ReviewRepository
from app.runtime import AppDeps
from app.schemas.review import (
    CreateReviewRequest,
    ReviewCreated,
    ReviewOut,
    ReviewSummary,
    compute_cache_key,
    hash_ip,
)

router = APIRouter()


@router.post("/reviews", response_model=ReviewCreated, status_code=202)
@limiter.limit(lambda: get_settings().review_rate_limit)  # slowapi re-evaluates per request
async def create_review(
    request: Request,
    response: Response,
    body: CreateReviewRequest,
    deps: AppDeps = Depends(get_deps),
    settings: Settings = Depends(get_settings_dep),
) -> ReviewCreated:
    options = body.options.model_dump()
    cache_key = compute_cache_key(body.topic, body.language, options)
    done_after = datetime.now(UTC) - timedelta(seconds=settings.result_cache_ttl_seconds)

    async with deps.session_factory() as session, session.begin():
        repo = ReviewRepository(session)
        existing = await repo.find_reusable(cache_key, done_after)
        if existing is not None:
            return ReviewCreated(review_id=existing.id, status=existing.status, cached=True)
        review = await repo.create(
            topic=body.topic,
            language=body.language,
            options=options,
            cache_key=cache_key,
            ip_hash=hash_ip(client_ip(request), settings.ip_hash_salt),
            callback_url=str(body.callback_url) if body.callback_url else None,
        )
        review_id = review.id

    await deps.event_sink.emit(review_id, "queued", {"topic": body.topic})
    await deps.queue.enqueue_review(review_id)
    return ReviewCreated(review_id=review_id, status="queued", cached=False)


@router.get("/reviews", response_model=list[ReviewSummary])
async def list_recent_reviews(
    recent: int = Query(20, ge=1, le=50), deps: AppDeps = Depends(get_deps)
) -> list[ReviewSummary]:
    async with deps.session_factory() as session:
        rows = await ReviewRepository(session).list_recent(limit=recent)
    return [ReviewSummary.model_validate(r) for r in rows]


@router.get("/reviews/{review_id}", response_model=ReviewOut)
async def get_review(review_id: uuid.UUID, deps: AppDeps = Depends(get_deps)) -> ReviewOut:
    async with deps.session_factory() as session:
        review = await ReviewRepository(session).get(review_id)
    if review is None:
        raise HTTPException(status_code=404, detail="review not found")
    return ReviewOut.model_validate(review)
