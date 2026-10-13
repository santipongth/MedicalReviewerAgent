from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sse_starlette.sse import EventSourceResponse
from starlette.background import BackgroundTask

from app.api.deps import get_deps, get_settings_dep
from app.api.ratelimit import client_ip
from app.config import Settings
from app.db.models import TERMINAL_STATUSES
from app.db.repositories import EventRepository, ReviewRepository
from app.runtime import AppDeps
from app.services.events import TERMINAL_EVENT_TYPES, read_live
from app.services.sse_slots import SseSlots

router = APIRouter()


def parse_since(value: str | None) -> int:
    if not value:
        return 0
    try:
        return max(int(value), 0)
    except ValueError:
        return 0


@router.get("/reviews/{review_id}/events", summary="Live progress (Server-Sent Events)",
            responses={200: {"content": {"text/event-stream": {}},
                             "description": "id: <seq>, event: <type>, data: <JSON>; closes after done, error, "
                                            "rejected or cancelled"},
                       404: {"description": "unknown review"},
                       429: {"description": "too many open streams from this client (Retry-After: 30)"}})
async def review_events(
    review_id: uuid.UUID,
    request: Request,
    deps: AppDeps = Depends(get_deps),
    settings: Settings = Depends(get_settings_dep),
) -> EventSourceResponse:
    """Replays past events, then streams new ones. Resume with the Last-Event-ID header or ?since=<seq>. A client
    may keep a limited number of streams open at once (see /status)."""
    after_seq = parse_since(
        request.headers.get("last-event-id") or request.query_params.get("since")
    )

    async with deps.session_factory() as session:
        review = await ReviewRepository(session).get(review_id)
        if review is None:
            raise HTTPException(status_code=404, detail="review not found")
        replay = await EventRepository(session).list_since(review_id, after_seq)
    review_status = review.status

    # Each client may hold a bounded number of open streams (shared across API processes through Redis).
    live = await deps.service.effective()  # Plan 23c: the limit in force
    slots = SseSlots(deps.redis, limit=live.sse_max_per_ip)
    client = deps.service.sse_key(client_ip(request))
    if not await slots.acquire(client):
        return JSONResponse(status_code=429, headers={"Retry-After": "30"},
                            content={"detail": f"too many open event streams (max {live.sse_max_per_ip} "
                                               "per client); close one or poll GET /reviews/{id}"})

    lease = slots.lease(client)

    async def generate() -> AsyncIterator[dict]:
        try:
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
                await slots.refresh(client)
                if ev is None:
                    continue
                yield {
                    "id": str(ev["seq"]),
                    "event": ev["type"],
                    "data": json.dumps(ev["payload"], default=str),
                }
                if ev["type"] in TERMINAL_EVENT_TYPES:
                    return
        finally:
            await lease.release()

    return EventSourceResponse(generate(), ping=settings.sse_ping_seconds, background=BackgroundTask(lease.release))
