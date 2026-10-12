import uuid
from datetime import UTC, datetime, timedelta
from typing import TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from sqlalchemy import func, select

from app.db.models import AdminAudit, Paper, Review, ReviewEvent, ReviewPaper
from app.db.repositories import EventRepository, ReviewRepository
from app.services.api_keys import mint_key
from app.services.events import stream_key
from app.worker.tasks import delete_checkpoint
from tests.admin_helpers import admin_headers

BASE = "/api/v1/admin/reviews"
T0 = datetime(2026, 10, 12, 8, 0, tzinfo=UTC)


async def make_review(session_factory, topic, status="done", *, created_at=None, listed=True, key_id=None,
                      options=None):
    async with session_factory() as s, s.begin():
        r = await ReviewRepository(s).create(topic=topic, language="th", options=options or {},
                                             cache_key=str(uuid.uuid4()), api_key_id=key_id)
        r.status, r.is_listed = status, listed
        if created_at is not None:
            r.created_at = created_at
        return r.id


async def audit_rows(session_factory, action):
    async with session_factory() as s:
        return list((await s.execute(select(AdminAudit).where(AdminAudit.action == action))).scalars())


async def test_list_filters_search_and_shapes_rows(client, session_factory):
    headers = await admin_headers(client, session_factory)
    async with session_factory() as s, s.begin():
        _, key = await mint_key(s, "lab")
    old = await make_review(session_factory, "Metformin and cancer", created_at=T0)
    new = await make_review(session_factory, "x" * 300, "error", created_at=T0 + timedelta(hours=1), key_id=key.id,
                            options={"review_type": "scoping"})
    hidden = await make_review(session_factory, "Statins 100% safe_ish", created_at=T0 + timedelta(hours=2),
                               listed=False)
    body = (await client.get(BASE, headers=headers)).json()
    assert [i["id"] for i in body["items"]] == [str(hidden), str(new), str(old)] and body["next"] is None
    row = body["items"][1]
    assert len(row["topic"]) == 200 and row["review_type"] == "scoping" and row["api_key_prefix"] == key.key_prefix
    assert body["items"][2]["review_type"] == "slr" and body["items"][2]["api_key_prefix"] is None
    ids = lambda r: [i["id"] for i in r.json()["items"]]
    assert ids(await client.get(BASE, params={"q": "METFORMIN"}, headers=headers)) == [str(old)]
    assert ids(await client.get(BASE, params={"status": "error"}, headers=headers)) == [str(new)]
    assert ids(await client.get(BASE, params={"listed": "false"}, headers=headers)) == [str(hidden)]
    assert ids(await client.get(BASE, params={"q": "100%"}, headers=headers)) == [str(hidden)]
    assert ids(await client.get(BASE, params={"q": "%"}, headers=headers)) == [str(hidden)]  # literal, not a wildcard
    assert ids(await client.get(BASE, params={"q": "t_n"}, headers=headers)) == []  # "_" is literal ("statins" has t?n)
    assert (await client.get(BASE, params={"status": "bogus"}, headers=headers)).status_code == 422
    assert (await client.get(BASE, params={"before": "garbage"}, headers=headers)).status_code == 422


async def test_paging_is_stable_when_reviews_share_a_timestamp(client, session_factory):
    headers = await admin_headers(client, session_factory)
    made = {str(await make_review(session_factory, f"topic {i}", created_at=T0)) for i in range(3)}
    first = (await client.get(BASE, params={"limit": 2}, headers=headers)).json()
    second = (await client.get(BASE, params={"limit": 2, "before": first["next"]}, headers=headers)).json()
    seen = [i["id"] for i in first["items"] + second["items"]]
    assert len(seen) == 3 and set(seen) == made and second["next"] is None


async def test_cancel_goes_through_the_service_and_is_audited(client, session_factory, queue):
    headers = await admin_headers(client, session_factory)
    rid = await make_review(session_factory, "running topic", "running")
    r = await client.post(f"{BASE}/{rid}/cancel", headers=headers)
    assert r.status_code == 200 and r.json() == {"id": str(rid), "status": "cancelled"}
    async with session_factory() as s:
        events = await EventRepository(s).list_since(rid, 0)
    assert events[-1].type == "cancelled" and events[-1].payload == {"by": "admin"} and queue.aborted == [str(rid)]
    [row] = await audit_rows(session_factory, "review.cancel")
    assert row.before == {"status": "running"} and row.after == {"status": "cancelled"} and row.actor_label == "owner"
    assert (await client.post(f"{BASE}/{rid}/cancel", headers=headers)).status_code == 409
    assert len(await audit_rows(session_factory, "review.cancel")) == 1


async def test_hide_and_show_change_the_public_list_and_are_audited(client, session_factory):
    headers = await admin_headers(client, session_factory)
    rid = await make_review(session_factory, "public topic")
    async with session_factory() as s, s.begin():
        await ReviewRepository(s).update(rid, finished_at=T0)
    assert (await client.patch(f"{BASE}/{rid}", json={"is_listed": False}, headers=headers)).json() == {
        "id": str(rid), "is_listed": False}
    assert (await client.get("/api/v1/reviews?recent=10")).json() == []
    await client.patch(f"{BASE}/{rid}", json={"is_listed": True}, headers=headers)
    assert [r["id"] for r in (await client.get("/api/v1/reviews?recent=10")).json()] == [str(rid)]
    assert [(r.before, r.after) for r in await audit_rows(session_factory, "review.hide")] == [
        ({"is_listed": True}, {"is_listed": False})]
    assert len(await audit_rows(session_factory, "review.show")) == 1
    assert (await client.patch(f"{BASE}/{uuid.uuid4()}", json={"is_listed": True}, headers=headers)).status_code == 404


async def test_delete_removes_the_review_its_rows_and_its_stream(app, client, session_factory, redis, queue):
    headers = await admin_headers(client, session_factory)
    rid = await make_review(session_factory, "finished topic")
    await app.state.deps.event_sink.emit(rid, "queued", {})
    async with session_factory() as s, s.begin():
        paper = Paper(title="A trial")
        s.add(paper)
        await s.flush()
        s.add(ReviewPaper(review_id=rid, paper_id=paper.id, included=True))
    assert await redis.exists(stream_key(rid))
    assert (await client.delete(f"{BASE}/{rid}", headers=headers)).status_code == 204
    async with session_factory() as s:
        assert await s.get(Review, rid) is None
        for model in (ReviewEvent, ReviewPaper):
            assert await s.scalar(select(func.count()).select_from(model).where(model.review_id == rid)) == 0
        assert await s.scalar(select(func.count()).select_from(Paper)) == 1  # shared paper cache stays
    assert not await redis.exists(stream_key(rid)) and queue.checkpoint_deletes == [str(rid)]
    [row] = await audit_rows(session_factory, "review.delete")
    assert row.before["topic"] == "finished topic" and row.before["status"] == "done" and row.after is None


async def test_delete_refuses_active_and_unknown_reviews(client, session_factory):
    headers = await admin_headers(client, session_factory)
    rid = await make_review(session_factory, "queued topic", "queued")
    r = await client.delete(f"{BASE}/{rid}", headers=headers)
    assert r.status_code == 409 and "cancel" in r.json()["detail"]
    assert (await client.delete(f"{BASE}/{uuid.uuid4()}", headers=headers)).status_code == 404
    assert await audit_rows(session_factory, "review.delete") == []


async def test_delete_succeeds_even_when_cleanup_fails(client, session_factory, queue, monkeypatch):
    headers = await admin_headers(client, session_factory)
    rid = await make_review(session_factory, "finished topic")

    async def broken(_):
        raise ConnectionError("redis down")

    monkeypatch.setattr(queue, "enqueue_checkpoint_delete", broken)
    assert (await client.delete(f"{BASE}/{rid}", headers=headers)).status_code == 204


async def test_admin_key_lists_and_plain_key_is_refused(client, session_factory):
    async with session_factory() as s, s.begin():
        admin, _ = await mint_key(s, "ops", is_admin=True)
        plain, _ = await mint_key(s, "lab")
    assert (await client.get(BASE, headers={"X-API-Key": admin})).status_code == 200
    assert (await client.get(BASE, headers={"X-API-Key": plain})).status_code == 403


class _S(TypedDict):
    n: int


async def test_delete_checkpoint_job_drops_the_thread():
    b = StateGraph(_S)
    b.add_node("inc", lambda s: {"n": s["n"] + 1})
    b.add_edge(START, "inc")
    b.add_edge("inc", END)
    graph = b.compile(checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": "r1"}}
    await graph.ainvoke({"n": 1}, config)
    assert (await graph.aget_state(config)).values
    assert await delete_checkpoint({"graph": graph}, "r1") == {"deleted": True}
    assert not (await graph.aget_state(config)).values
    assert await delete_checkpoint({"graph": object()}, "r1") == {"deleted": False}
