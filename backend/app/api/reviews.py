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


@router.post("/reviews", response_model=ReviewCreated, status_code=202,
             responses={429: {"description": "rate limit exceeded (Retry-After header)"},
                        401: {"description": "invalid or revoked API key"},
                        403: {"description": "callback_url requires an API key"},
                        503: {"description": "queue unavailable"}})
async def create_review(body: CreateReviewRequest, request: Request, deps: AppDeps = Depends(get_deps),
                        identity: Identity = Depends(get_identity)):
    try:
        return await deps.service.create(body, identity=identity,
                                         human_token=request.headers.get("cf-turnstile-response"))
    except ServiceError as exc:
        return service_error_response(exc)


@router.get("/reviews", response_model=list[ReviewSummary])
async def list_recent_reviews(
    recent: int = Query(20, ge=1, le=50), deps: AppDeps = Depends(get_deps)
) -> list[ReviewSummary]:
    return [ReviewSummary.model_validate(r).model_copy(update={
        "verification_rate": ((r.result or {}).get("quality") or {}).get("verification_rate")})
        for r in await deps.service.list_recent(recent)]


@router.get("/reviews/{review_id}", response_model=ReviewOut)
async def get_review(review_id: uuid.UUID, deps: AppDeps = Depends(get_deps)) -> ReviewOut:
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
async def export_review(review_id: uuid.UUID, format: Literal["md", "csv", "json"] = "md",
                        deps: AppDeps = Depends(get_deps)) -> Response:
    """Markdown report, CSV of every extracted outcome (verified numbers only; blanked values stay empty) or the
    complete JSON result, as a file download."""
    review = await deps.service.get(review_id)
    if review is None:
        raise HTTPException(status_code=404, detail="review not found")
    if review.status != "done":
        raise HTTPException(status_code=409, detail=f"review is {review.status}; exports are available once done")
    if format == "md":
        body = render_markdown(review)
    elif format == "csv":
        body = render_csv(review.result)
    else:
        body = json.dumps({"review_id": str(review.id), "topic": review.topic, "language": review.language,
                           "created_at": review.created_at, "finished_at": review.finished_at,
                           "result": review.result}, ensure_ascii=False, default=str, indent=1)
    return Response(content=body, media_type=EXPORT_TYPES[format],
                    headers={"Content-Disposition": f'attachment; filename="review-{str(review.id)[:8]}.{format}"'})


@router.delete("/reviews/{review_id}", responses={401: {"description": "API key required"},
                                                  403: {"description": "not the owner key"},
                                                  404: {"description": "unknown review"},
                                                  409: {"description": "already finished"}})
async def cancel_review(review_id: uuid.UUID, deps: AppDeps = Depends(get_deps),
                        identity: Identity = Depends(require_key)):
    try:
        status = await deps.service.cancel(review_id, identity=identity)
    except ServiceError as exc:
        return service_error_response(exc)
    return {"review_id": str(review_id), "status": status}
