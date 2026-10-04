import uuid

from app.db.repositories import ReviewRepository
from app.db.session import make_engine
from app.services.sse_slots import SseSlots


async def test_slots_cap_per_key_release_and_expire(redis):
    slots = SseSlots(redis, limit=2, ttl_seconds=60)
    assert await slots.acquire("ip1") and await slots.acquire("ip1")
    assert not await slots.acquire("ip1")  # third stream from the same client
    assert await slots.acquire("ip2")      # other clients are unaffected
    await slots.release("ip1")
    assert await slots.acquire("ip1")
    assert 0 < await redis.ttl("mra:sse:ip1") <= 60  # a crashed API process cannot hold slots forever


async def test_events_endpoint_answers_429_when_the_client_has_too_many_streams(client, app, redis, session_factory):
    async with session_factory() as s, s.begin():
        review = await ReviewRepository(s).create(topic="t", language="en", options={}, cache_key="k1")
        await ReviewRepository(s).update(review.id, status="done")
    settings = app.state.settings
    key = app.state.deps.service.sse_key("127.0.0.1")
    await redis.set(f"mra:sse:{key}", settings.sse_max_per_ip)
    busy = await client.get(f"/api/v1/reviews/{review.id}/events")
    assert busy.status_code == 429 and "retry-after" in busy.headers
    await redis.delete(f"mra:sse:{key}")
    ok = await client.get(f"/api/v1/reviews/{review.id}/events")  # finished review: replay, then the stream ends
    assert ok.status_code == 200
    assert int(await redis.get(f"mra:sse:{key}") or 0) == 0  # the slot was given back
    assert (await client.get(f"/api/v1/reviews/{uuid.uuid4()}/events")).status_code == 404


def test_engine_uses_the_configured_pool():
    engine = make_engine("postgresql+psycopg://u:p@localhost/db", pool_size=7, max_overflow=3)
    assert engine.pool.size() == 7 and engine.pool._max_overflow == 3


async def test_a_lease_is_released_exactly_once(redis):
    slots = SseSlots(redis, limit=5)
    assert await slots.acquire("c") and await slots.acquire("c")  # two streams from one client
    lease = slots.lease("c")
    await lease.release()
    await lease.release()  # the generator's finally and the response's background task both call it
    assert int(await redis.get("mra:sse:c")) == 1  # the other stream keeps its slot


async def test_a_finished_stream_leaves_other_streams_slots_alone(client, app, redis, session_factory):
    async with session_factory() as s, s.begin():
        review = await ReviewRepository(s).create(topic="t2", language="en", options={}, cache_key="k2")
        await ReviewRepository(s).update(review.id, status="done")
    key = app.state.deps.service.sse_key("127.0.0.1")
    await redis.set(f"mra:sse:{key}", 1)  # another stream from this client is open
    assert (await client.get(f"/api/v1/reviews/{review.id}/events")).status_code == 200
    assert int(await redis.get(f"mra:sse:{key}")) == 1
