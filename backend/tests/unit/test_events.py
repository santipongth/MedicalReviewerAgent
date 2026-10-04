import asyncio
import uuid

from app.db.repositories import EventRepository, ReviewRepository
from app.services.events import EventSink, read_live, stream_key


async def _review(session_factory):
    async with session_factory() as s, s.begin():
        return await ReviewRepository(s).create(
            topic="t", language="en", options={}, cache_key="c"
        )


async def test_emit_persists_and_publishes(session_factory, redis):
    review = await _review(session_factory)
    sink = EventSink(session_factory, redis, ttl_seconds=60)
    seq1 = await sink.emit(review.id, "queued", {})
    seq2 = await sink.emit(review.id, "searching", {"found": 42})
    assert (seq1, seq2) == (1, 2)

    async with session_factory() as s:
        rows = await EventRepository(s).list_since(review.id, 0)
    assert [(r.seq, r.type) for r in rows] == [(1, "queued"), (2, "searching")]

    entries = await redis.xrange(stream_key(review.id))
    assert [e[1]["type"] for e in entries] == ["queued", "searching"]
    assert await redis.ttl(stream_key(review.id)) > 0


async def test_read_live_skips_already_seen_and_stops_at_terminal(session_factory, redis):
    review = await _review(session_factory)
    sink = EventSink(session_factory, redis, ttl_seconds=60)
    await sink.emit(review.id, "queued", {})
    await sink.emit(review.id, "planning", {})
    await sink.emit(review.id, "done", {"cost_usd": 0.1})

    seen = []
    async for ev in read_live(redis, review.id, after_seq=1, block_ms=100):
        if ev is None:
            continue
        seen.append(ev)
        if ev["type"] == "done":
            break
    assert [e["seq"] for e in seen] == [2, 3]
    assert seen[-1]["payload"] == {"cost_usd": 0.1}


async def test_read_live_yields_none_when_idle(redis):
    gen = read_live(redis, uuid.uuid4(), after_seq=0, block_ms=50)
    first = await asyncio.wait_for(gen.__anext__(), timeout=2)
    assert first is None
    await gen.aclose()
