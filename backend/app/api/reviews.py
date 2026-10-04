from __future__ import annotations

import json
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response

from app.api.auth import get_identity, require_key
from app.api.deps import get_deps
from app.runtime import AppDeps
from app.schemas.review import CreateReviewRequest, ReviewCreated, ReviewOut, ReviewSummary
from app.services.report import render_csv, render_markdown
from app.services.review_service import (
    Identity,
    QueueUnavailable,
    RateLimited,
    ServiceError,
    Unavailable,
)

router = APIRouter()


def service_error_response(exc: ServiceError) -> JSONResponse:
    content: dict = {"detail": exc.detail}
    headers: dict[str, str] = {}
    if isinstance(exc, RateLimited | Unavailable):
        headers["Retry-After"] = str(exc.retry_after)
    if isinstance(exc, Unavailable):
        content["reason"] = exc.reason
    if isinstance(exc, QueueUnavailable):
        content["review_id"] = str(exc.review_id)
    return JSONResponse(status_code=exc.status_code, content=content, headers=headers)


@router.post("/reviews", response_model=ReviewCreated, status_code=202, summary="Start a review",
             responses={
                 401: {"description": "invalid or revoked API key"},
                 403: {"description": "callback_url without an API key, or the Turnstile check failed "
                                      "(anonymous web submissions when the deployment enables Turnstile)"},
                 422: {"description": "invalid body, or callback_url is not https on a public host"},
                 429: {"description": "hourly rate limit, or the API key daily quota (Retry-After header)"},
                 503: {"description": "not accepting reviews right now: body {detail, reason} with reason "
                                      "queue_full | daily_reviews | daily_budget | verification_unavailable and a "
                                      "Retry-After header; or {detail, review_id} when the job could not be queued"}})
async def create_review(body: CreateReviewRequest, request: Request, deps: AppDeps = Depends(get_deps),
                        identity: Identity = Depends(get_identity)):
    """Queue a literature review. The same topic, language and options within 24 hours (or still running) return
    that review with cached=true, free of every limit. Order of checks: body, callback_url needs a key, cache,
    Turnstile (anonymous only, when enabled; header cf-turnstile-response), callback_url safety, key quota,
    capacity, hourly rate. Follow progress with GET /reviews/{id}/events."""
    try:
        return await deps.service.create(body, identity=identity,
                                         human_token=request.headers.get("cf-turnstile-response"))
    except ServiceError as exc:
        return service_error_response(exc)


@router.get("/reviews", response_model=list[ReviewSummary], summary="Recent finished reviews")
async def list_recent_reviews(
    recent: int = Query(20, ge=1, le=50), deps: AppDeps = Depends(get_deps)
) -> list[ReviewSummary]:
    """The most recently finished public reviews (newest first)."""
    return [ReviewSummary.model_validate(r).model_copy(update={
        "verification_rate": ((r.result or {}).get("quality") or {}).get("verification_rate")})
        for r in await deps.service.list_recent(recent)]


@router.get("/reviews/{review_id}", response_model=ReviewOut, summary="Review status and result",
            responses={404: {"description": "unknown review"}})
async def get_review(review_id: uuid.UUID, deps: AppDeps = Depends(get_deps)) -> ReviewOut:
    """Status (queued, running, done, error, rejected, cancelled), the result once done, the error otherwise, and
    queue_position while queued (1 = next to start)."""
    review = await deps.service.get(review_id)
    if review is None:
        raise HTTPException(status_code=404, detail="review not found")
    return ReviewOut.model_validate(review).model_copy(
        update={"queue_position": await deps.service.queue_position(review)})


EXPORT_TYPES = {"md": "text/markdown; charset=utf-8", "csv": "text/csv; charset=utf-8",
                "json": "application/json"}


@router.get("/reviews/{review_id}/export", summary="Download a finished review",
            responses={200: {"content": {t.split(";")[0]: {} for t in EXPORT_TYPES.values()},
                             "description": "Markdown report, CSV (one row per paper × outcome) or the full JSON"},
                       404: {"description": "unknown review"}, 409: {"description": "review not finished"}})
async def export_review(review_id: uuid.UUID,
                        fmt: Literal["md", "csv", "json"] = Query("md", alias="format"),
                        deps: AppDeps = Depends(get_deps)) -> Response:
    """Markdown report, CSV of every extracted outcome (verified numbers only; blanked values stay empty) or the
    complete JSON result, as a file download."""
    review = await deps.service.get(review_id)
    if review is None:
        raise HTTPException(status_code=404, detail="review not found")
    if review.status != "done":
        raise HTTPException(status_code=409, detail=f"review is {review.status}; exports are available once done")
    if fmt == "md":
        body = render_markdown(review)
    elif fmt == "csv":
        body = render_csv(review.result)
    else:
        body = json.dumps({"review_id": str(review.id), "topic": review.topic, "language": review.language,
                           "created_at": review.created_at, "finished_at": review.finished_at,
                           "result": review.result}, ensure_ascii=False, default=str, indent=1)
    return Response(content=body, media_type=EXPORT_TYPES[fmt],
                    headers={"Content-Disposition": f'attachment; filename="review-{str(review.id)[:8]}.{fmt}"'})


@router.delete("/reviews/{review_id}", summary="Cancel a queued or running review",
               responses={401: {"description": "API key required"},
                          403: {"description": "not the key that created it, and not an admin key"},
                          404: {"description": "unknown review"},
                          409: {"description": "already finished"}})
async def cancel_review(review_id: uuid.UUID, deps: AppDeps = Depends(get_deps),
                        identity: Identity = Depends(require_key)):
    """Only the API key that created the review (or an admin key) can cancel it. Returns {review_id, status}."""
    try:
        status = await deps.service.cancel(review_id, identity=identity)
    except ServiceError as exc:
        return service_error_response(exc)
    return {"review_id": str(review_id), "status": status}
