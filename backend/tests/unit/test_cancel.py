import asyncio
import uuid

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph

from app.db.repositories import EventRepository, ReviewRepository
from app.graph.state import ReviewState
from app.services.admin_auth import AdminPrincipal
from app.services.api_keys import mint_key
from app.services.events import EventSink
from app.services.review_service import Conflict, Forbidden, Identity
from app.worker.runner import ReviewRunner


async def mint(session_factory, **kw):
    async with session_factory() as s, s.begin():
        raw, _ = await mint_key(s, kw.pop("name", "lab"), **kw)
        return raw


async def create(client, raw, topic="metformin and colorectal cancer"):
    r = await client.post("/api/v1/reviews", json={"topic": topic}, headers={"X-API-Key": raw})
    assert r.status_code == 202
    return r.json()["review_id"]


async def test_owner_cancels_a_running_review(client, session_factory, queue):
    raw = await mint(session_factory)
    rid = await create(client, raw)
    r = await client.delete(f"/api/v1/reviews/{rid}", headers={"X-API-Key": raw})
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    async with session_factory() as s:
        review = await ReviewRepository(s).get(uuid.UUID(rid))
        events = await EventRepository(s).list_since(uuid.UUID(rid), 0)
    assert review.status == "cancelled" and review.finished_at is not None
    assert events[-1].type == "cancelled" and queue.aborted == [rid]


async def test_cancel_permissions_and_conflicts(client, session_factory):
    owner = await mint(session_factory, name="owner")
    other = await mint(session_factory, name="other")
    admin = await mint(session_factory, name="admin", is_admin=True)
    rid = await create(client, owner)
    assert (await client.delete(f"/api/v1/reviews/{rid}")).status_code == 401
    assert (await client.delete(f"/api/v1/reviews/{rid}", headers={"X-API-Key": other})).status_code == 403
    assert (await client.delete(f"/api/v1/reviews/{uuid.uuid4()}", headers={"X-API-Key": owner})).status_code == 404
    assert (await client.delete(f"/api/v1/reviews/{rid}", headers={"X-API-Key": admin})).status_code == 200
    assert (await client.delete(f"/api/v1/reviews/{rid}", headers={"X-API-Key": owner})).status_code == 409


async def test_anonymous_review_can_only_be_cancelled_by_admin(client, session_factory):
    r = await client.post("/api/v1/reviews", json={"topic": "anonymous topic about statins"})
    rid = r.json()["review_id"]
    plain = await mint(session_factory)
    assert (await client.delete(f"/api/v1/reviews/{rid}", headers={"X-API-Key": plain})).status_code == 403


async def test_signed_in_admin_without_a_key_cancels_and_the_audit_runs_in_the_transaction(
        app, client, session_factory):
    owner = await mint(session_factory, name="owner")
    rid = uuid.UUID(await create(client, owner))
    service = app.state.deps.service
    admin = Identity(ip="203.0.113.7", admin=AdminPrincipal(kind="user", id=uuid.uuid4(), label="ops"))
    seen: list[uuid.UUID] = []

    async def audit(session, review):
        seen.append(review.id)

    assert await service.cancel(rid, identity=admin, audit=audit) == "cancelled"
    assert seen == [rid]
    async with session_factory() as s:
        review = await ReviewRepository(s).get(rid)
    assert review.status == "cancelled" and review.error == "cancelled by the admin"
    with pytest.raises(Conflict):  # already terminal: the status did not change, so no second audit row
        await service.cancel(rid, identity=admin, audit=audit)
    assert seen == [rid]


async def test_a_failing_audit_rolls_the_cancel_back(app, client, session_factory):
    owner = await mint(session_factory, name="owner")
    rid = uuid.UUID(await create(client, owner))
    service = app.state.deps.service
    admin = Identity(ip="203.0.113.7", admin=AdminPrincipal(kind="user", id=uuid.uuid4(), label="ops"))

    async def broken(session, review):
        raise RuntimeError("audit write failed")

    with pytest.raises(RuntimeError):
        await service.cancel(rid, identity=admin, audit=broken)
    async with session_factory() as s:
        assert (await ReviewRepository(s).get(rid)).status == "queued"


async def test_an_identity_with_neither_key_nor_admin_cannot_cancel(app, client, session_factory):
    rid = uuid.UUID(await create(client, await mint(session_factory)))
    with pytest.raises(Forbidden):
        await app.state.deps.service.cancel(rid, identity=Identity(ip="203.0.113.7"))


async def _queued(session_factory):
    async with session_factory() as s, s.begin():
        return (await ReviewRepository(s).create(topic="t", language="en", options={}, cache_key="k")).id


async def test_runner_does_not_requeue_a_cancelled_review(session_factory, redis):
    review_id = await _queued(session_factory)
    entered = asyncio.Event()

    async def hang(state: ReviewState) -> dict:
        entered.set()
        await asyncio.Event().wait()
        return {}

    b = StateGraph(ReviewState)
    b.add_node("hang", hang)
    b.add_edge(START, "hang")
    b.add_edge("hang", END)
    runner = ReviewRunner(session_factory, EventSink(session_factory, redis, 60), b.compile(checkpointer=InMemorySaver()))
    task = asyncio.create_task(runner.run(review_id))
    await asyncio.wait_for(entered.wait(), 5)
    async with session_factory() as s, s.begin():
        await ReviewRepository(s).update(review_id, status="cancelled")
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    async with session_factory() as s:
        assert (await ReviewRepository(s).get(review_id)).status == "cancelled"
        types = [e.type for e in await EventRepository(s).list_since(review_id, 0)]
    assert "interrupted" not in types


async def test_review_cancelled_while_finishing_stays_cancelled(session_factory, redis):
    review_id = await _queued(session_factory)

    async def finish(state: ReviewState) -> dict:
        async with session_factory() as s, s.begin():  # a DELETE lands just before the runner records done
            await ReviewRepository(s).update(review_id, status="cancelled")
        return {"result": {"summary": "s"}}

    b = StateGraph(ReviewState)
    b.add_node("finish", finish)
    b.add_edge(START, "finish")
    b.add_edge("finish", END)
    runner = ReviewRunner(session_factory, EventSink(session_factory, redis, 60), b.compile(checkpointer=InMemorySaver()))
    assert await runner.run(review_id) == "cancelled"
    async with session_factory() as s:
        got = await ReviewRepository(s).get(review_id)
        types = [e.type for e in await EventRepository(s).list_since(review_id, 0)]
    assert got.status == "cancelled" and got.result is None and "done" not in types
