import uuid
from datetime import UTC, datetime, timedelta

from app.db.repositories import EventRepository, ReviewRepository
from app.schemas.review import compute_cache_key


def test_cache_key_normalizes_whitespace_and_case():
    a = compute_cache_key("  Metformin   AND  Cancer ", "th", {"max_papers": 10})
    b = compute_cache_key("metformin and cancer", "th", {"max_papers": 10})
    c = compute_cache_key("metformin and cancer", "en", {"max_papers": 10})
    assert a == b and a != c and len(a) == 64


async def test_create_review_enqueues_and_emits_queued(client, queue, session_factory):
    resp = await client.post(
        "/api/v1/reviews", json={"topic": "metformin colorectal cancer", "language": "th"}
    )
    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["status"] == "queued" and body["cached"] is False
    review_id = uuid.UUID(body["review_id"])
    assert queue.enqueued == [str(review_id)]

    got = await client.get(f"/api/v1/reviews/{review_id}")
    assert got.status_code == 200
    assert got.json()["topic"] == "metformin colorectal cancer"
    assert got.json()["options"]["max_papers"] == 30  # abstract-only: 120 candidates -> up to 30 analysed
    assert got.json()["options"]["candidate_limit"] == 120

    async with session_factory() as s:
        events = await EventRepository(s).list_since(review_id, 0)
    assert [(e.seq, e.type) for e in events] == [(1, "queued")]


async def test_duplicate_request_while_active_returns_same_review(client, queue):
    payload = {"topic": "aspirin stroke prevention", "language": "en"}
    first = (await client.post("/api/v1/reviews", json=payload)).json()
    second = (await client.post("/api/v1/reviews", json=payload)).json()
    assert second["review_id"] == first["review_id"]
    assert second["cached"] is True
    assert len(queue.enqueued) == 1


async def test_recent_done_review_is_reused_but_old_one_is_not(client, queue, session_factory):
    payload = {"topic": "statin myopathy", "language": "en"}
    first = (await client.post("/api/v1/reviews", json=payload)).json()
    async with session_factory() as s, s.begin():
        await ReviewRepository(s).update(
            uuid.UUID(first["review_id"]), status="done", finished_at=datetime.now(UTC)
        )
    assert (await client.post("/api/v1/reviews", json=payload)).json()["cached"] is True

    async with session_factory() as s, s.begin():
        await ReviewRepository(s).update(
            uuid.UUID(first["review_id"]), finished_at=datetime.now(UTC) - timedelta(days=3)
        )
    third = (await client.post("/api/v1/reviews", json=payload)).json()
    assert third["cached"] is False and third["review_id"] != first["review_id"]
    assert len(queue.enqueued) == 2


async def test_validation_rejects_blank_long_and_bad_language(client):
    assert (await client.post("/api/v1/reviews", json={"topic": "   "})).status_code == 422
    assert (await client.post("/api/v1/reviews", json={"topic": "x" * 601})).status_code == 422
    assert (
        await client.post("/api/v1/reviews", json={"topic": "ok topic", "language": "fr"})
    ).status_code == 422
    assert (
        await client.post(
            "/api/v1/reviews", json={"topic": "ok topic", "options": {"max_papers": 99}}
        )
    ).status_code == 422
    # the last two have fewer candidates than papers to analyse
    for bad in ({"max_papers": 51}, {"max_papers": 4}, {"candidate_limit": 121}, {"candidate_limit": 19},
                {"max_papers": 30, "candidate_limit": 25}, {"max_papers": 50, "candidate_limit": 40}):
        resp = await client.post("/api/v1/reviews", json={"topic": "ok topic", "options": bad})
        assert resp.status_code == 422, bad


async def test_fifty_papers_is_accepted_and_clamped_bounds_hold(client):
    resp = await client.post("/api/v1/reviews", json={"topic": "ok topic fifty", "options": {"max_papers": 50}})
    assert resp.status_code == 202
    from app.schemas.review import ReviewOptions
    assert ReviewOptions.clamped({"max_papers": 99}).max_papers == 50
    low = ReviewOptions.clamped({"max_papers": 3, "candidate_limit": 10})
    assert (low.max_papers, low.candidate_limit) == (5, 20)
    assert ReviewOptions.model_validate({"candidate_limit": 60}).candidate_limit == 60  # an old stored option


async def test_symbol_only_topic_is_rejected(client):
    resp = await client.post("/api/v1/reviews", json={"topic": "🙂🙂🙂 !!!"})
    assert resp.status_code == 422
    assert resp.json()["detail"][0]["loc"][-1] == "topic"


async def test_get_unknown_review_404(client):
    assert (await client.get(f"/api/v1/reviews/{uuid.uuid4()}")).status_code == 404


async def test_list_recent_returns_done_only(client, session_factory):
    created = (await client.post("/api/v1/reviews", json={"topic": "vitamin d fracture"})).json()
    assert (await client.get("/api/v1/reviews?recent=5")).json() == []
    async with session_factory() as s, s.begin():
        await ReviewRepository(s).update(
            uuid.UUID(created["review_id"]), status="done", finished_at=datetime.now(UTC),
            result={"quality": {"verification_rate": 0.96}},
        )
    listed = (await client.get("/api/v1/reviews?recent=5")).json()
    assert [r["id"] for r in listed] == [created["review_id"]]
    assert "result" not in listed[0] and listed[0]["verification_rate"] == 0.96


async def test_rate_limit_returns_429(session_factory, redis, queue, monkeypatch):
    import httpx

    import app.api.ratelimit as rl
    from app.config import Settings, get_settings
    from app.main import AppDeps, create_app
    from app.services.events import EventSink

    # The limit string is read from get_settings() (env REVIEW_RATE_LIMIT) by the decorator.
    monkeypatch.setenv("REVIEW_RATE_LIMIT", "2/minute")
    get_settings.cache_clear()
    rl.limiter.reset()
    settings = Settings(_env_file=None, ratelimit_storage_uri="memory://")
    deps = AppDeps(session_factory, redis, queue, EventSink(session_factory, redis, 60))
    app = create_app(settings, deps=deps)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        responses = [
            await c.post("/api/v1/reviews", json={"topic": f"topic number {i}"}) for i in range(3)
        ]
    assert [r.status_code for r in responses] == [202, 202, 429]
    assert "retry-after" in responses[2].headers
    get_settings.cache_clear()


def test_cache_key_changes_with_pipeline_version():
    a = compute_cache_key("metformin and cancer", "th", {"max_papers": 30}, version="2026-10-04.1")
    b = compute_cache_key("metformin and cancer", "th", {"max_papers": 30}, version="2026-10-05.1")
    assert a != b


async def test_new_pipeline_version_does_not_reuse_an_old_review(client, app, queue, session_factory):
    payload = {"topic": "colchicine after myocardial infarction", "language": "en"}
    first = (await client.post("/api/v1/reviews", json=payload)).json()
    async with session_factory() as s, s.begin():
        await ReviewRepository(s).update(uuid.UUID(first["review_id"]), status="done", finished_at=datetime.now(UTC))
    app.state.deps.service.settings.prompt_version = "next-version"
    again = (await client.post("/api/v1/reviews", json=payload)).json()
    assert again["cached"] is False and again["review_id"] != first["review_id"]


async def test_review_type_option_is_stored_and_validated(client):
    ok = await client.post("/api/v1/reviews", json={"topic": "colchicine after myocardial infarction",
                                                    "language": "en", "options": {"review_type": "narrative"}})
    assert ok.status_code == 202
    got = (await client.get(f"/api/v1/reviews/{ok.json()['review_id']}")).json()
    assert got["options"]["review_type"] == "narrative"
    bad = await client.post("/api/v1/reviews", json={"topic": "colchicine after myocardial infarction",
                                                     "options": {"review_type": "umbrella"}})
    assert bad.status_code == 422
