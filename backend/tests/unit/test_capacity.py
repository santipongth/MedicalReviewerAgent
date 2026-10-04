import uuid
from datetime import UTC, datetime

from app.config import Settings
from app.db.repositories import ReviewRepository
from app.services.capacity import Capacity, seconds_until_utc_midnight


def settings(**kw):
    return Settings(_env_file=None, **kw)


async def test_queue_cap_daily_reviews_and_daily_budget(redis):
    cap = Capacity(redis, settings(max_queued_reviews=3, max_reviews_per_day=2, max_usd_per_day=1.0))
    assert await cap.check(queued=0) is None
    full = await cap.check(queued=3)
    assert full.reason == "queue_full" and full.retry_after == 60
    await cap.note_review()
    await cap.note_review()
    daily = await cap.check(queued=0)
    assert daily.reason == "daily_reviews" and 0 < daily.retry_after <= 86400
    cap2 = Capacity(redis, settings(max_reviews_per_day=100, max_usd_per_day=1.0))
    await cap2.note_cost(0.6)
    await cap2.note_cost(0.5)  # workers report what each finished review cost
    assert round(await cap2.usd_today(), 2) == 1.1
    assert (await cap2.check(queued=0)).reason == "daily_budget"


async def test_day_keys_expire():
    import fakeredis.aioredis
    r = fakeredis.aioredis.FakeRedis(decode_responses=True)
    cap = Capacity(r, settings())
    await cap.note_review()
    await cap.note_cost(0.1)
    keys = await r.keys("mra:capacity:*")
    ttls = [await r.ttl(k) for k in keys]
    assert keys and all(0 < t <= 48 * 3600 for t in ttls)


def test_seconds_until_midnight():
    assert seconds_until_utc_midnight(datetime(2026, 10, 5, 23, 59, 0, tzinfo=UTC)) == 60


async def test_full_queue_is_a_503_with_retry_after_but_cache_hits_still_work(client, app, session_factory):
    payload = {"topic": "statins and dementia risk", "language": "en"}
    first = (await client.post("/api/v1/reviews", json=payload)).json()
    app.state.deps.service.settings.max_queued_reviews = 1  # the first review is now queued: queue is full
    busy = await client.post("/api/v1/reviews", json={"topic": "aspirin and colorectal adenoma", "language": "en"})
    assert busy.status_code == 503 and busy.headers["retry-after"] == "60"
    assert busy.json()["reason"] == "queue_full"
    again = await client.post("/api/v1/reviews", json=payload)  # same topic: cache hit, always free
    assert again.status_code == 202 and again.json()["review_id"] == first["review_id"]


async def test_status_reports_limits_and_queue(client, app):
    await client.post("/api/v1/reviews", json={"topic": "metformin colorectal cancer", "language": "en"})
    s = (await client.get("/api/v1/status")).json()
    assert s["accepting"] is True and s["queue_depth"] == 1 and s["reviews_today"] == 1
    assert s["limits"]["max_papers"] == {"min": 5, "max": 30, "default": 30}
    assert s["limits"]["review_rate_limit"] == "5/hour" and "max_usd_per_day" not in str(s)


async def test_queue_position(client, session_factory):
    ids = [(await client.post("/api/v1/reviews", json={"topic": f"topic number {i} about statins",
                                                         "language": "en"})).json()["review_id"] for i in range(3)]
    positions = [(await client.get(f"/api/v1/reviews/{i}")).json()["queue_position"] for i in ids]
    assert positions == [1, 2, 3]
    async with session_factory() as s, s.begin():
        await ReviewRepository(s).update(uuid.UUID(ids[0]), status="running", started_at=datetime.now(UTC))
    assert (await client.get(f"/api/v1/reviews/{ids[0]}")).json()["queue_position"] is None
    assert (await client.get(f"/api/v1/reviews/{ids[2]}")).json()["queue_position"] == 2


async def test_concurrent_submissions_cannot_overfill_the_queue(client, app):
    import asyncio
    app.state.deps.service.settings.max_queued_reviews = 3
    app.state.deps.service.settings.review_rate_limit = "1000/hour"
    answers = await asyncio.gather(*(client.post("/api/v1/reviews", json={"topic": f"burst topic {i} statins",
                                                                          "language": "en"}) for i in range(10)))
    codes = sorted(a.status_code for a in answers)
    assert codes == [202] * 3 + [503] * 7  # check-then-insert is atomic across concurrent requests
