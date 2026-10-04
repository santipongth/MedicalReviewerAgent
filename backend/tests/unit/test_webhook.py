import hashlib
import hmac
import json
import uuid

import httpx
import pytest
from arq import Retry

from app.config import Settings
from app.db.repositories import ReviewRepository
from app.services.api_keys import mint_key
from app.services.events import EventSink
from app.services.webhook import DeliveryOutcome, deliver, sign
from app.worker.runner import ReviewRunner
from app.worker.tasks import deliver_webhook


async def public(url):  # test resolver: only example.org counts as public
    return httpx.URL(url).host.endswith("example.org")


def test_signature_is_hmac_of_body_with_sha256_of_the_key():
    raw = "mra_secret"
    body = b'{"review_id":"x"}'
    secret = hashlib.sha256(raw.encode()).hexdigest()
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    assert sign(body, secret) == f"sha256={expected}"


async def mint(session_factory):
    async with session_factory() as s, s.begin():
        raw, _ = await mint_key(s, "lab")
        return raw


@pytest.mark.parametrize("url", ["http://example.org/hook", "https://internal.local/hook", "https://127.0.0.1/x"])
async def test_unsafe_callback_urls_are_rejected_at_creation(client, session_factory, url):
    raw = await mint(session_factory)
    r = await client.post("/api/v1/reviews", json={"topic": "metformin", "callback_url": url},
                          headers={"X-API-Key": raw})
    assert r.status_code == 422 and "callback_url" in r.json()["detail"]


def transport(statuses, seen):
    it = iter(statuses)

    def handler(request):
        seen.append(request)
        status = next(it)
        if isinstance(status, Exception):
            raise status
        return httpx.Response(status, headers={"location": "https://evil.example.org"} if status == 302 else {})
    return httpx.MockTransport(handler)


async def test_deliver_outcomes():
    seen = []
    async with httpx.AsyncClient(transport=transport([200, 503, httpx.ConnectError("x"), 302, 404], seen)) as c:
        args = {"url": "https://hooks.example.org/x", "body": b"{}", "signature": "sha256=ab", "url_check": public}
        assert await deliver(c, **args) == DeliveryOutcome.ok
        assert await deliver(c, **args) == DeliveryOutcome.retry
        assert await deliver(c, **args) == DeliveryOutcome.retry
        assert await deliver(c, **args) == DeliveryOutcome.failed  # redirects are never followed
        assert await deliver(c, **args) == DeliveryOutcome.failed
        assert await deliver(c, **{**args, "url": "https://10.0.0.5/x"}) == DeliveryOutcome.blocked
    assert len(seen) == 5 and seen[0].headers["x-signature"] == "sha256=ab"
    assert seen[0].headers["content-type"] == "application/json"


async def _keyed_review(session_factory, raw, status="done"):
    from app.services.api_keys import resolve_key
    async with session_factory() as s, s.begin():
        info = await resolve_key(s, raw)
        review = await ReviewRepository(s).create(topic="t", language="en", options={}, cache_key=str(uuid.uuid4()),
                                                  callback_url="https://hooks.example.org/x", api_key_id=info.id)
        await ReviewRepository(s).update(review.id, status=status)
        return review.id


async def test_deliver_webhook_task_signs_payload_and_retries(session_factory):
    raw = await mint(session_factory)
    rid = await _keyed_review(session_factory, raw)
    seen = []
    settings = Settings(_env_file=None, public_base_url="https://reviews.example.org")
    async with httpx.AsyncClient(transport=transport([503, 200], seen)) as c:
        ctx = {"session_factory": session_factory, "settings": settings, "webhook_http": c,
               "webhook_url_check": public, "job_try": 1}
        with pytest.raises(Retry):
            await deliver_webhook(ctx, str(rid))
        assert await deliver_webhook({**ctx, "job_try": 2}, str(rid)) == {"delivered": True}
    body = seen[1].content
    assert json.loads(body) == {"review_id": str(rid), "status": "done",
                                "result_url": f"https://reviews.example.org/api/v1/reviews/{rid}"}
    secret = hashlib.sha256(raw.encode()).hexdigest()
    assert seen[1].headers["x-signature"] == "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


async def test_deliver_webhook_gives_up_after_three_tries(session_factory):
    rid = await _keyed_review(session_factory, await mint(session_factory))
    async with httpx.AsyncClient(transport=transport([503], [])) as c:
        ctx = {"session_factory": session_factory, "settings": Settings(_env_file=None), "webhook_http": c,
               "webhook_url_check": public, "job_try": 3}
        assert await deliver_webhook(ctx, str(rid)) == {"delivered": False, "outcome": "retry"}


async def test_runner_notifies_only_reviews_with_a_callback(session_factory, redis):
    from langgraph.checkpoint.memory import InMemorySaver

    from app.graph.graph import GraphDeps, build_graph

    notified = []

    async def notify(review_id):
        notified.append(review_id)

    raw = await mint(session_factory)
    with_cb = await _keyed_review(session_factory, raw, status="queued")
    async with session_factory() as s, s.begin():
        plain = (await ReviewRepository(s).create(topic="t2", language="en", options={}, cache_key="z")).id
    graph = build_graph(GraphDeps(settings=Settings(_env_file=None)), checkpointer=InMemorySaver())
    runner = ReviewRunner(session_factory, EventSink(session_factory, redis, 60), graph, notify=notify)
    await runner.run(with_cb)
    await runner.run(plain)
    assert notified == [with_cb]
