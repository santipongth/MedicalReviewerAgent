"""Regression tests for the Plan 1 final-review findings (Important #1-#5)."""
import asyncio
import uuid
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph
from sqlalchemy.exc import IntegrityError
from starlette.requests import Request

from app.api.ratelimit import client_ip
from app.config import Settings
from app.db.repositories import EventRepository, ReviewRepository
from app.graph.state import ReviewState
from app.main import AppDeps, create_app
from app.services.events import EventSink
from app.worker.runner import ReviewRunner


# --- #1 rate-limit key must not be spoofable via X-Forwarded-For -------------------------
def _request(xff: str | None, trust_proxy: bool) -> Request:
    headers = [(b"x-forwarded-for", xff.encode())] if xff else []
    app = type("A", (), {"state": type("S", (), {"settings": Settings(_env_file=None, trust_proxy=trust_proxy)})()})()
    return Request({"type": "http", "headers": headers, "client": ("203.0.113.7", 5000), "app": app})


def test_client_ip_ignores_forwarded_header_when_proxy_not_trusted():
    assert client_ip(_request("1.2.3.4", trust_proxy=False)) == "203.0.113.7"


def test_client_ip_uses_hop_appended_by_trusted_proxy_not_client_supplied_one():
    # Client sent "X-Forwarded-For: 1.2.3.4"; our proxy appended the real peer 198.51.100.9.
    assert client_ip(_request("1.2.3.4, 198.51.100.9", trust_proxy=True)) == "198.51.100.9"


# --- #2 a review whose enqueue failed must not become a permanent cache hit ---------------
class BrokenQueue:
    async def enqueue_review(self, review_id) -> bool:
        raise ConnectionError("redis down")


async def test_enqueue_failure_marks_review_error_and_does_not_poison_cache(
    session_factory, redis
):
    import app.api.ratelimit as rl

    rl.limiter.reset()
    sink = EventSink(session_factory, redis, 60)
    broken = create_app(
        Settings(_env_file=None), deps=AppDeps(session_factory, redis, BrokenQueue(), sink)
    )
    payload = {"topic": "colchicine pericarditis", "language": "en"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=broken), base_url="http://t") as c:
        resp = await c.post("/api/v1/reviews", json=payload)
    assert resp.status_code == 503
    review_id = uuid.UUID(resp.json()["review_id"])
    async with session_factory() as s:
        assert (await ReviewRepository(s).get(review_id)).status == "error"

    from tests.conftest import FakeJobQueue

    healthy = create_app(
        Settings(_env_file=None), deps=AppDeps(session_factory, redis, FakeJobQueue(), sink)
    )
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=healthy), base_url="http://t") as c:
        again = (await c.post("/api/v1/reviews", json=payload)).json()
    assert again["cached"] is False and again["review_id"] != str(review_id)


# --- #3/#4 interruption must leave the review resumable, and resume must not redo work ----
def _two_step_graph(calls: dict, entered_second: asyncio.Event):
    async def first(state: ReviewState) -> dict:
        calls["first"] += 1
        get_stream_writer()({"type": "planning"})
        return {"cost_usd": 1.0}

    async def second(state: ReviewState) -> dict:
        calls["second"] += 1
        if calls["second"] == 1:
            entered_second.set()
            await asyncio.Event().wait()  # hangs until the worker task is cancelled
        return {"result": {"summary": "ok"}}

    b = StateGraph(ReviewState)
    b.add_node("first", first)
    b.add_node("second", second)
    b.add_edge(START, "first")
    b.add_edge("first", "second")
    b.add_edge("second", END)
    return b.compile(checkpointer=InMemorySaver())


async def test_interrupted_review_is_requeued_then_resumes_from_checkpoint(session_factory, redis):
    async with session_factory() as s, s.begin():
        review = await ReviewRepository(s).create(topic="t", language="en", options={}, cache_key="k")
    calls = {"first": 0, "second": 0}
    entered = asyncio.Event()
    graph = _two_step_graph(calls, entered)
    runner = ReviewRunner(session_factory, EventSink(session_factory, redis, 60), graph)

    task = asyncio.create_task(runner.run(review.id))  # what arq runs
    await asyncio.wait_for(entered.wait(), timeout=5)
    task.cancel()  # arq cancels in-flight jobs on SIGTERM / docker restart
    with pytest.raises(asyncio.CancelledError):
        await task
    async with session_factory() as s:
        after_interrupt = await ReviewRepository(s).get(review.id)
        types = [e.type for e in await EventRepository(s).list_since(review.id, 0)]
    assert after_interrupt.status == "queued"
    assert "cancelled" not in types

    assert await runner.run(review.id) == "done"  # arq re-runs the same run_review job
    async with session_factory() as s:
        final = await ReviewRepository(s).get(review.id)
    assert calls == {"first": 1, "second": 2}  # completed node was not re-executed
    assert final.cost_usd == 1.0  # reducer did not double-count
    assert final.result == {"summary": "ok"}


async def test_worker_settings_let_arq_rerun_interrupted_jobs():
    from app.worker.settings import WorkerSettings

    assert WorkerSettings.retry_jobs is True
    assert WorkerSettings.keep_result == 0  # a finished job never blocks re-enqueue of its id
    assert any(c.name == "sweep_stale" for c in WorkerSettings.cron_jobs)


class RecordingArq:
    def __init__(self) -> None:
        self.jobs: list[tuple[str, str, str]] = []

    async def enqueue_job(self, name, review_id, _job_id):
        self.jobs.append((name, review_id, _job_id))
        return object()


async def test_sweep_requeues_stale_queued_and_running_reviews_only(session_factory):
    from app.worker.sweep import sweep_stale

    now = datetime.now(UTC)
    async with session_factory() as s, s.begin():
        repo = ReviewRepository(s)
        fresh = await repo.create(topic="a", language="en", options={}, cache_key="a")
        stuck_q = await repo.create(topic="b", language="en", options={}, cache_key="b")
        stuck_r = await repo.create(topic="c", language="en", options={}, cache_key="c")
        await repo.update(stuck_q.id, created_at=now - timedelta(hours=1))
        await repo.update(stuck_r.id, status="running", started_at=now - timedelta(hours=1))
    arq = RecordingArq()
    ctx = {"redis": arq, "session_factory": session_factory, "settings": Settings(_env_file=None)}
    await sweep_stale(ctx)
    assert sorted(j[1] for j in arq.jobs) == sorted([str(stuck_q.id), str(stuck_r.id)])
    assert all(j[0] == "run_review" and j[2] == f"review:{j[1]}" for j in arq.jobs)
    assert str(fresh.id) not in {j[1] for j in arq.jobs}


# --- #5 concurrent identical POSTs must not create two active reviews ---------------------
async def test_db_rejects_two_active_reviews_with_same_cache_key(session_factory):
    async with session_factory() as s, s.begin():
        await ReviewRepository(s).create(topic="t", language="en", options={}, cache_key="dup")
    with pytest.raises(IntegrityError):
        async with session_factory() as s, s.begin():
            await ReviewRepository(s).create(topic="t", language="en", options={}, cache_key="dup")


async def test_route_returns_existing_review_when_it_loses_the_insert_race(
    client, queue, session_factory, monkeypatch
):
    payload = {"topic": "metoprolol heart failure", "language": "en"}
    first = (await client.post("/api/v1/reviews", json=payload)).json()

    async def lost_race(self, cache_key, done_after):  # the other replica inserted after our check
        return None

    original = ReviewRepository.find_reusable
    calls = {"n": 0}

    async def first_miss_then_real(self, cache_key, done_after):
        calls["n"] += 1
        if calls["n"] == 1:
            return await lost_race(self, cache_key, done_after)
        return await original(self, cache_key, done_after)

    monkeypatch.setattr(ReviewRepository, "find_reusable", first_miss_then_real)
    second = await client.post("/api/v1/reviews", json=payload)
    assert second.status_code == 202
    assert second.json() == {"review_id": first["review_id"], "status": "queued", "cached": True}
    assert len(queue.enqueued) == 1
