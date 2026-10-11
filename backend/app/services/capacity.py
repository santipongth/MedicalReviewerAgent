"""Admission control shared by every API process and worker through Redis: a bounded queue, a daily review count
and a daily spend. Counters are per UTC day and expire after two days."""
from __future__ import annotations

import asyncio
import random
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from redis.exceptions import WatchError

from app.config import Settings
from app.schemas.review import ReviewOptions
from app.services.budget import review_cost_cap

KEY_TTL_SECONDS = 48 * 3600
QUEUE_FULL_RETRY_SECONDS = 60
ADMISSION_WAIT_SECONDS = 8
ADMISSION_KEY = "mra:capacity:admission"
ADMISSION_TTL_MS = 10_000


def seconds_until_utc_midnight(now: datetime | None = None) -> int:
    now = now or datetime.now(UTC)
    tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    return max(1, int((tomorrow - now).total_seconds()))


@dataclass
class Refusal:
    reason: str  # queue_full | daily_reviews | daily_budget
    retry_after: int
    detail: str


class AdmissionBusy(Exception):
    """The admission lock could not be taken in time (a very large burst): ask the caller to retry shortly."""


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

    @asynccontextmanager
    async def admission(self) -> AsyncIterator[None]:
        """Serialises check-then-insert across every API process (Redis lock), so a burst of concurrent
        submissions cannot all read "not full" before any of them is counted. Held for a few milliseconds."""
        token = uuid.uuid4().hex
        deadline = time.monotonic() + ADMISSION_WAIT_SECONDS
        # SET NX PX: no Lua needed; the TTL frees the lock if a process dies while holding it.
        wait = 0.002
        while not await self.redis.set(ADMISSION_KEY, token, nx=True, px=ADMISSION_TTL_MS):
            if time.monotonic() > deadline:
                raise AdmissionBusy
            await asyncio.sleep(wait * (0.5 + random.random()))  # jittered backoff: a burst does not spin Redis
            wait = min(wait * 2, 0.05)
        try:
            yield
        finally:
            await self._release(token)

    async def _release(self, token: str) -> None:
        """Compare-and-delete in one transaction (WATCH/MULTI, no Lua): never removes a lock another holder took
        after ours expired, even if it changes hands between the read and the delete."""
        async with self.redis.pipeline(transaction=True) as pipe:
            try:
                await pipe.watch(ADMISSION_KEY)
                if await pipe.get(ADMISSION_KEY) != token:
                    await pipe.unwatch()
                    return
                pipe.multi()
                pipe.delete(ADMISSION_KEY)
                await pipe.execute()
            except WatchError:  # changed hands meanwhile: it is not ours any more
                return

    async def note_review(self) -> None:
        await self._bump("reviews", 1)

    async def note_cost(self, usd: float) -> None:
        if usd > 0:
            await self._bump("usd", usd)

    async def reviews_today(self) -> int:
        return int(float(await self.redis.get(self._key("reviews")) or 0))

    async def usd_today(self) -> float:
        return float(await self.redis.get(self._key("usd")) or 0)

    def worst_case_cap(self) -> float:
        fields = ReviewOptions.model_fields
        hi = next(m.le for m in fields["max_papers"].metadata if getattr(m, "le", None) is not None)
        return review_cost_cap(self.settings,
                               ReviewOptions(max_papers=hi, candidate_limit=fields["candidate_limit"].default))

    async def check(self, *, queued: int, running: int = 0, this_cap: float | None = None) -> Refusal | None:
        s = self.settings
        if queued >= s.max_queued_reviews:
            return Refusal("queue_full", QUEUE_FULL_RETRY_SECONDS,
                           "the review queue is full; please try again in a minute")
        if await self.reviews_today() >= s.max_reviews_per_day:
            return Refusal("daily_reviews", seconds_until_utc_midnight(),
                           "today's review capacity is used up; new reviews open at 00:00 UTC")
        # Spend is booked when a review ends, so reserve the cap for every review already admitted (queued or
        # running; their options are not loaded, so the worst case) plus this one's own cap: the daily budget is
        # then a real bound, not a lagging counter.
        worst_cap = self.worst_case_cap()
        reserved = (queued + running) * worst_cap + (this_cap if this_cap is not None else worst_cap)
        if await self.usd_today() + reserved > s.max_usd_per_day:
            return Refusal("daily_budget", seconds_until_utc_midnight(),
                           "today's review budget is used up; new reviews open at 00:00 UTC")
        return None
