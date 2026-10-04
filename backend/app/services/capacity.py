"""Admission control shared by every API process and worker through Redis: a bounded queue, a daily review count
and a daily spend. Counters are per UTC day and expire after two days."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from app.config import Settings

KEY_TTL_SECONDS = 48 * 3600
QUEUE_FULL_RETRY_SECONDS = 60


def seconds_until_utc_midnight(now: datetime | None = None) -> int:
    now = now or datetime.now(UTC)
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(1, int((tomorrow - now).total_seconds()))


@dataclass
class Refusal:
    reason: str  # queue_full | daily_reviews | daily_budget
    retry_after: int
    detail: str


class Capacity:
    def __init__(self, redis, settings: Settings) -> None:
        self.redis = redis
        self.settings = settings

    def _key(self, name: str) -> str:
        return f"mra:capacity:{datetime.now(UTC):%Y%m%d}:{name}"

    async def _bump(self, name: str, amount: float) -> None:
        key = self._key(name)
        await self.redis.incrbyfloat(key, amount)
        await self.redis.expire(key, KEY_TTL_SECONDS)

    async def note_review(self) -> None:
        await self._bump("reviews", 1)

    async def note_cost(self, usd: float) -> None:
        if usd > 0:
            await self._bump("usd", usd)

    async def reviews_today(self) -> int:
        return int(float(await self.redis.get(self._key("reviews")) or 0))

    async def usd_today(self) -> float:
        return float(await self.redis.get(self._key("usd")) or 0)

    async def check(self, *, queued: int) -> Refusal | None:
        s = self.settings
        if queued >= s.max_queued_reviews:
            return Refusal("queue_full", QUEUE_FULL_RETRY_SECONDS,
                           "the review queue is full; please try again in a minute")
        if await self.reviews_today() >= s.max_reviews_per_day:
            return Refusal("daily_reviews", seconds_until_utc_midnight(),
                           "today's review capacity is used up; new reviews open at 00:00 UTC")
        if await self.usd_today() >= s.max_usd_per_day:
            return Refusal("daily_budget", seconds_until_utc_midnight(),
                           "today's review budget is used up; new reviews open at 00:00 UTC")
        return None
