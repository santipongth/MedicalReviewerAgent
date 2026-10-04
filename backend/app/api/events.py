from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request
from sse_starlette.sse import EventSourceResponse

from app.api.deps import get_deps, get_settings_dep
from app.config import Settings
from app.db.models import TERMINAL_STATUSES
from app.db.repositories import EventRepository, ReviewRepository
from app.runtime import AppDeps
from app.services.events import TERMINAL_EVENT_TYPES, read_live

router = APIRouter()


def parse_since(value: str | None) -> int:
    if not value:
        return 0
    try:
        return max(int(value), 0)
    except ValueError:
        return 0


@router.get("/reviews/{review_id}/events")
async def review_events(
    review_id: uuid.UUID,
    request: Request,
    deps: AppDeps = Depends(get_deps),
    settings: Settings = Depends(get_settings_dep),
) -> EventSourceResponse:
    after_seq = parse_since(
        request.headers.get("last-event-id") or request.query_params.get("since")
    )

    async with deps.session_factory() as session:
        review = await ReviewRepository(session).get(review_id)
        if review is None:
            raise HTTPException(status_code=404, detail="review not found")
        replay = await EventRepository(session).list_since(review_id, after_seq)
    review_status = review.status

    async def generate() -> AsyncIterator[dict]:
        last = after_seq
        for ev in replay:
            last = ev.seq
            yield {"id": str(ev.seq), "event": ev.type, "data": json.dumps(ev.payload, default=str)}
            if ev.type in TERMINAL_EVENT_TYPES:
                return
        if review_status in TERMINAL_STATUSES:
            return
        async for ev in read_live(deps.redis, review_id, after_seq=last, block_ms=5000):
            if await request.is_disconnected():
                return
            if ev is None:
                continue
            yield {
                "id": str(ev["seq"]),
                "event": ev["type"],
                "data": json.dumps(ev["payload"], default=str),
            }
            if ev["type"] in TERMINAL_EVENT_TYPES:
                return

    return EventSourceResponse(generate(), ping=settings.sse_ping_seconds)
