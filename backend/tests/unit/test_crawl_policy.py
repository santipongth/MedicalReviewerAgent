import asyncio

from app.services.crawl_policy import DomainPolicy
from app.services.fulltext import FullText
from app.services.fulltext_cache import FullTextCache


class SleepRecorder:
    def __init__(self):
        self.total = 0.0

    async def __call__(self, seconds):
        self.total += seconds


async def test_acquire_spaces_requests_per_host(redis):
    sleep = SleepRecorder()
    policy = DomainPolicy(redis, min_interval=2.0, max_wait=5.0, sleep=sleep)
    assert await policy.acquire("www.mdpi.com") is True
    assert await policy.acquire("arxiv.org") is True  # other host unaffected
    # fake sleep never lets the 2 s slot expire → gives up after max_wait
    assert await policy.acquire("www.mdpi.com") is False
    assert 5.0 <= sleep.total < 7.5


async def test_acquire_succeeds_after_interval_with_real_time(redis):
    policy = DomainPolicy(redis, min_interval=0.05, max_wait=2.0)
    assert await policy.acquire("h") and await asyncio.wait_for(policy.acquire("h"), 2) is True


async def test_penalize_sets_shared_cooldown(redis):
    a = DomainPolicy(redis, cooldown_minutes=15)
    b = DomainPolicy(redis, cooldown_minutes=15)  # another worker
    assert await b.cooling("onlinelibrary.wiley.com") is False
    await a.penalize("onlinelibrary.wiley.com")
    assert await b.cooling("onlinelibrary.wiley.com") is True
    assert 0 < await redis.ttl("crawl:cooldown:onlinelibrary.wiley.com") <= 900


async def test_fulltext_cache_roundtrip_and_miss_marker(redis):
    cache = FullTextCache(redis, ttl_days=30, miss_ttl_hours=24)
    assert await cache.get("doi:10.1/a") is None and await cache.is_miss("doi:10.1/a") is False
    await cache.put("doi:10.1/a", FullText("crawl_html", "## Methods\nx", "https://x.org/a"))
    assert await cache.get("doi:10.1/a") == FullText("crawl_html", "## Methods\nx", "https://x.org/a")
    await cache.mark_miss("doi:10.1/b")
    assert await cache.is_miss("doi:10.1/b") is True
    assert 0 < await redis.ttl("fulltext:miss:v1:doi:10.1/b") <= 86400
