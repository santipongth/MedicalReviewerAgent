import uuid
from datetime import UTC, datetime, timedelta

from app.db.models import ReviewStatus
from app.db.repositories import EventRepository, ReviewRepository


async def _create(session_factory, **kw):
    async with session_factory() as s, s.begin():
        review = await ReviewRepository(s).create(
            topic=kw.get("topic", "metformin"),
            language=kw.get("language", "th"),
            options=kw.get("options", {"max_papers": 10}),
            cache_key=kw.get("cache_key", "k1"),
            ip_hash="h",
        )
    return review


async def test_create_and_get_roundtrip(session_factory):
    created = await _create(session_factory)
    async with session_factory() as s:
        got = await ReviewRepository(s).get(created.id)
    assert got is not None
    assert got.topic == "metformin"
    assert got.status == ReviewStatus.queued.value
    assert got.options == {"max_papers": 10}


async def test_get_unknown_returns_none(session_factory):
    async with session_factory() as s:
        assert await ReviewRepository(s).get(uuid.uuid4()) is None


async def test_find_reusable_prefers_active_then_recent_done(session_factory):
    now = datetime.now(UTC)
    old_done = await _create(session_factory, cache_key="k")
    async with session_factory() as s, s.begin():
        await ReviewRepository(s).update(
            old_done.id, status="done", finished_at=now - timedelta(days=2)
        )
    async with session_factory() as s:
        assert await ReviewRepository(s).find_reusable("k", now - timedelta(days=1)) is None

    running = await _create(session_factory, cache_key="k")
    async with session_factory() as s, s.begin():
        await ReviewRepository(s).update(running.id, status="running")
    async with session_factory() as s:
        found = await ReviewRepository(s).find_reusable("k", now - timedelta(days=1))
    assert found is not None and found.id == running.id


async def test_list_recent_only_done_and_listed(session_factory):
    a = await _create(session_factory, cache_key="a")
    b = await _create(session_factory, cache_key="b")
    async with session_factory() as s, s.begin():
        repo = ReviewRepository(s)
        await repo.update(a.id, status="done", finished_at=datetime.now(UTC))
        await repo.update(b.id, status="done", finished_at=datetime.now(UTC), is_listed=False)
    async with session_factory() as s:
        recent = await ReviewRepository(s).list_recent(limit=10)
    assert [r.id for r in recent] == [a.id]


async def test_events_seq_is_monotonic_per_review(session_factory):
    r1 = await _create(session_factory, cache_key="x")
    r2 = await _create(session_factory, cache_key="y")
    async with session_factory() as s, s.begin():
        repo = EventRepository(s)
        e1 = await repo.append(r1.id, "queued", {})
        e2 = await repo.append(r1.id, "planning", {"n": 1})
        e3 = await repo.append(r2.id, "queued", {})
    assert (e1.seq, e2.seq, e3.seq) == (1, 2, 1)
    async with session_factory() as s:
        later = await EventRepository(s).list_since(r1.id, after_seq=1)
    assert [e.type for e in later] == ["planning"]
    assert later[0].payload == {"n": 1}


async def test_list_stale_running(session_factory):
    r = await _create(session_factory, cache_key="s")
    async with session_factory() as s, s.begin():
        await ReviewRepository(s).update(
            r.id, status="running", started_at=datetime.now(UTC) - timedelta(hours=2)
        )
    async with session_factory() as s:
        stale = await ReviewRepository(s).list_stale_running(
            older_than=datetime.now(UTC) - timedelta(minutes=30)
        )
    assert [x.id for x in stale] == [r.id]
