import uuid

import pytest

from app.config import Settings
from app.schemas.review import CreateReviewRequest
from app.services.api_keys import ApiKeyInfo
from app.services.events import EventSink
from app.services.ratelimits import RateLimits
from app.services.review_service import Identity, QueueUnavailable, RateLimited, ReviewService


class Queue:
    def __init__(self, ok=True):
        self.ok, self.enqueued = ok, []

    async def enqueue_review(self, review_id):
        if not self.ok:
            raise RuntimeError("redis down")
        self.enqueued.append(review_id)
        return True


def service(session_factory, redis, queue=None, **settings):
    s = Settings(_env_file=None, ratelimit_storage_uri="memory://", **settings)
    return ReviewService(session_factory, queue or Queue(), EventSink(session_factory, redis, 60), s,
                         RateLimits("memory://"))


def req(topic="metformin and colorectal cancer"):
    return CreateReviewRequest(topic=topic)


ANON = Identity(ip="1.2.3.4")


async def test_create_enqueues_and_duplicate_is_reused_without_counting(session_factory, redis):
    svc = service(session_factory, redis, review_rate_limit="1/minute")
    first = await svc.create(req(), identity=ANON)
    again = await svc.create(req(), identity=ANON)  # cache hit: no new review, not rate limited
    assert first.cached is False and again.cached is True and again.review_id == first.review_id
    assert svc.queue.enqueued == [first.review_id]
    review = await svc.get(first.review_id)
    assert review.status == "queued" and review.ip_hash and review.ip_hash != "1.2.3.4"


async def test_rate_limit_is_per_identity_and_reports_retry_after(session_factory, redis):
    svc = service(session_factory, redis, review_rate_limit="1/minute")
    await svc.create(req("topic one about metformin"), identity=ANON)
    with pytest.raises(RateLimited) as exc:
        await svc.create(req("topic two about metformin"), identity=ANON)
    assert 1 <= exc.value.retry_after <= 60
    other = await svc.create(req("topic three about metformin"), identity=Identity(ip="5.6.7.8"))
    assert other.cached is False


async def test_api_key_identity_uses_the_keyed_rate(session_factory, redis):
    svc = service(session_factory, redis, review_rate_limit="1/minute", api_key_rate_limit="3/minute")
    key = ApiKeyInfo(id=uuid.uuid4(), name="lab", daily_quota=100, is_admin=False, key_hash="h")
    ident = Identity(ip="1.2.3.4", api_key=key)
    for i in range(3):
        await svc.create(req(f"keyed topic number {i}"), identity=ident)
    with pytest.raises(RateLimited):
        await svc.create(req("keyed topic number 9"), identity=ident)


async def test_queue_failure_marks_error_and_raises(session_factory, redis):
    svc = service(session_factory, redis, queue=Queue(ok=False))
    with pytest.raises(QueueUnavailable) as exc:
        await svc.create(req(), identity=ANON)
    review = await svc.get(exc.value.review_id)
    assert review.status == "error" and "enqueue failed" in review.error
    svc.queue.ok = True
    again = await svc.create(req(), identity=ANON)  # the failed row is not served as a cache hit
    assert again.review_id != exc.value.review_id
