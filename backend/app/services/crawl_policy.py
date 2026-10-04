from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any


class DomainPolicy:
    """Politeness shared by every worker through Redis: ≥ min_interval between requests to a host,
    and a cooldown after the host refuses us (403/429/503)."""

    def __init__(self, redis, *, min_interval: float = 2.0, cooldown_minutes: int = 15,
                 max_wait: float = 30.0, sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep) -> None:
        self.redis = redis
        self.min_interval = min_interval
        self.cooldown_minutes = cooldown_minutes
        self.max_wait = max_wait
        self._sleep = sleep

    async def acquire(self, host: str) -> bool:
        if self.min_interval <= 0:
            return True
        key, waited = f"crawl:slot:{host}", 0.0
        while True:
            if await self.redis.set(key, "1", nx=True, px=int(self.min_interval * 1000)):
                return True
            if waited >= self.max_wait:
                return False
            delay = max(await self.redis.pttl(key), 50) / 1000
            await self._sleep(delay)
            waited += delay

    async def cooling(self, host: str) -> bool:
        return bool(await self.redis.exists(f"crawl:cooldown:{host}"))

    async def penalize(self, host: str) -> None:
        await self.redis.set(f"crawl:cooldown:{host}", "1", ex=self.cooldown_minutes * 60)
