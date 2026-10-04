from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.db.repositories import EventRepository

TERMINAL_EVENT_TYPES = {"done", "error", "rejected", "cancelled"}
STREAM_MAXLEN = 1000


def stream_key(review_id: uuid.UUID | str) -> str:
    return f"review:{review_id}:events"


class EventSink:
    """The only writer of review progress: review_events (durable) + Redis Stream (live)."""

    def __init__(self, session_factory: async_sessionmaker, redis: Redis, ttl_seconds: int) -> None:
        self.session_factory = session_factory
        self.redis = redis
        self.ttl_seconds = ttl_seconds

    async def emit(
        self, review_id: uuid.UUID, type: str, payload: dict[str, Any] | None = None
    ) -> int:
        payload = payload or {}
        async with self.session_factory() as session, session.begin():
            event = await EventRepository(session).append(review_id, type, payload)
            seq = event.seq
        key = stream_key(review_id)
        await self.redis.xadd(
            key,
            {"seq": str(seq), "type": type, "payload": json.dumps(payload, default=str)},
            maxlen=STREAM_MAXLEN,
            approximate=True,
        )
        await self.redis.expire(key, self.ttl_seconds)
        return seq


async def read_live(
    redis: Redis, review_id: uuid.UUID | str, *, after_seq: int, block_ms: int = 15000
) -> AsyncIterator[dict[str, Any] | None]:
    """Tail the review's Redis Stream from the beginning, dropping seq <= after_seq.

    Reading from '0-0' (not '$') closes the gap between a DB replay and subscribing: every
    event still in the stream is re-read and de-duplicated by seq. Yields None on idle
    timeout so the caller can check for client disconnects.
    """
    key = stream_key(review_id)
    last_id = "0-0"
    while True:
        response = await redis.xread({key: last_id}, block=block_ms, count=100)
        if not response:
            yield None
            continue
        for _, entries in response:
            for entry_id, fields in entries:
                last_id = entry_id
                seq = int(fields["seq"])
                if seq <= after_seq:
                    continue
                after_seq = seq
                yield {"seq": seq, "type": fields["type"], "payload": json.loads(fields["payload"])}
