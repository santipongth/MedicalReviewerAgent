"""Admin console: reviews (Plan 23a). Thin adapters over app.services.admin_reviews and ReviewService.cancel."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel

from app.api.auth import ip_hash_of, require_admin
from app.api.deps import get_deps
from app.api.reviews import service_error_response
from app.runtime import AppDeps
from app.services.admin_reviews import (
    STATUSES,
    decode_cursor,
    delete_review,
    forget_review,
    list_reviews,
    set_listed,
)
from app.services.audit import record
from app.services.review_service import Identity, ServiceError

router = APIRouter()


class ListedBody(BaseModel):
    is_listed: bool


@router.get("/admin/reviews")
async def admin_list_reviews(q: str | None = Query(None, max_length=200), status: str | None = None,
                             listed: bool | None = None, before: str | None = Query(None, max_length=100),
                             limit: int = Query(50, ge=1, le=100), deps: AppDeps = Depends(get_deps),
                             _: Identity = Depends(require_admin)) -> dict:
    if status is not None and status not in STATUSES:
        raise HTTPException(status_code=422, detail=f"unknown status {status}")
    try:
        cursor = decode_cursor(before) if before else None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="invalid cursor") from exc
    async with deps.session_factory() as session:
        items, nxt = await list_reviews(session, q=q, status=status, listed=listed, before=cursor, limit=limit)
    return {"items": items, "next": nxt}


@router.post("/admin/reviews/{review_id}/cancel")
async def admin_cancel_review(review_id: uuid.UUID, deps: AppDeps = Depends(get_deps),
                              identity: Identity = Depends(require_admin)):
    ip_hash = ip_hash_of(identity, deps)

    async def audit(session, review) -> None:
        await record(session, identity.admin, "review.cancel", target_type="review", target_id=review_id,
                     before={"status": review.status}, after={"status": "cancelled"}, ip_hash=ip_hash)

    try:
        status = await deps.service.cancel(review_id, identity=identity, audit=audit)
    except ServiceError as exc:
        return service_error_response(exc)
    return {"id": review_id, "status": status}


@router.patch("/admin/reviews/{review_id}")
async def admin_set_listed(review_id: uuid.UUID, body: ListedBody, deps: AppDeps = Depends(get_deps),
                           identity: Identity = Depends(require_admin)):
    try:
        async with deps.session_factory() as session, session.begin():
            return await set_listed(session, identity.admin, review_id, body.is_listed,
                                    ip_hash=ip_hash_of(identity, deps))
    except ServiceError as exc:
        return service_error_response(exc)


@router.delete("/admin/reviews/{review_id}", status_code=204)
async def admin_delete_review(review_id: uuid.UUID, deps: AppDeps = Depends(get_deps),
                              identity: Identity = Depends(require_admin)):
    try:
        async with deps.session_factory() as session, session.begin():
            await delete_review(session, identity.admin, review_id, ip_hash=ip_hash_of(identity, deps))
    except ServiceError as exc:
        return service_error_response(exc)
    await forget_review(deps.redis, deps.queue, review_id)
    return Response(status_code=204)
