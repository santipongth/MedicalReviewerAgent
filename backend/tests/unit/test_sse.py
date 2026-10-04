import json
import uuid

import pytest

from app.api.events import parse_since
from app.db.repositories import ReviewRepository


def _parse_sse(text: str) -> list[dict]:
    events, current = [], {}
    for line in text.splitlines():
        if not line.strip():
            if current:
                events.append(current)
                current = {}
            continue
        if line.startswith(":"):
            continue
        field, _, value = line.partition(":")
        current[field] = value.strip()
    if current:
        events.append(current)
    return events


@pytest.mark.parametrize("raw,expected", [(None, 0), ("", 0), ("7", 7), ("abc", 0), ("-5", 0)])
def test_parse_since(raw, expected):
    assert parse_since(raw) == expected


async def test_events_404_for_unknown_review(client):
    resp = await client.get(f"/api/v1/reviews/{uuid.uuid4()}/events")
    assert resp.status_code == 404
    assert resp.json()["detail"] == "review not found"


async def test_replays_from_db_and_stops_at_terminal(client, session_factory, app):
    async with session_factory() as s, s.begin():
        review = await ReviewRepository(s).create(topic="t", language="en", options={}, cache_key="k")
    sink = app.state.deps.event_sink
    await sink.emit(review.id, "queued", {})
    await sink.emit(review.id, "planning", {"queries": 3})
    await sink.emit(review.id, "done", {"cost_usd": 0.2})

    async with client.stream("GET", f"/api/v1/reviews/{review.id}/events") as resp:
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("text/event-stream")
        body = await resp.aread()
    events = _parse_sse(body.decode())
    assert [e["event"] for e in events] == ["queued", "planning", "done"]
    assert [e["id"] for e in events] == ["1", "2", "3"]
    assert json.loads(events[1]["data"]) == {"queries": 3}


async def test_last_event_id_resumes_without_duplicates(client, session_factory, app):
    async with session_factory() as s, s.begin():
        review = await ReviewRepository(s).create(topic="t", language="en", options={}, cache_key="k")
    sink = app.state.deps.event_sink
    for t in ["queued", "planning", "searching", "done"]:
        await sink.emit(review.id, t, {})

    async with client.stream(
        "GET", f"/api/v1/reviews/{review.id}/events", headers={"Last-Event-ID": "2"}
    ) as resp:
        body = await resp.aread()
    assert [e["event"] for e in _parse_sse(body.decode())] == ["searching", "done"]


async def test_non_numeric_last_event_id_is_treated_as_zero(client, session_factory, app):
    async with session_factory() as s, s.begin():
        review = await ReviewRepository(s).create(topic="t", language="en", options={}, cache_key="k")
    await app.state.deps.event_sink.emit(review.id, "error", {"message": "boom"})
    async with client.stream(
        "GET", f"/api/v1/reviews/{review.id}/events", headers={"Last-Event-ID": "abc"}
    ) as resp:
        body = await resp.aread()
    assert [e["event"] for e in _parse_sse(body.decode())] == ["error"]


async def test_terminal_review_with_no_events_closes_immediately(client, session_factory):
    async with session_factory() as s, s.begin():
        repo = ReviewRepository(s)
        review = await repo.create(topic="t", language="en", options={}, cache_key="k")
        await repo.update(review.id, status="done")
    async with client.stream("GET", f"/api/v1/reviews/{review.id}/events") as resp:
        body = await resp.aread()
    assert _parse_sse(body.decode()) == []


async def test_live_events_arrive_after_replay(client, session_factory, app):
    import asyncio

    async with session_factory() as s, s.begin():
        review = await ReviewRepository(s).create(topic="t", language="en", options={}, cache_key="k")
    sink = app.state.deps.event_sink
    await sink.emit(review.id, "queued", {})

    async def produce_later():
        await asyncio.sleep(0.3)
        await sink.emit(review.id, "planning", {})
        await sink.emit(review.id, "done", {})

    producer = asyncio.create_task(produce_later())
    async with client.stream("GET", f"/api/v1/reviews/{review.id}/events") as resp:
        body = await asyncio.wait_for(resp.aread(), timeout=10)
    await producer
    assert [e["event"] for e in _parse_sse(body.decode())] == ["queued", "planning", "done"]
