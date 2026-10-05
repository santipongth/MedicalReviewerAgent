"""Rate limits shared by REST and MCP (moving window, Redis-backed in production)."""
from __future__ import annotations

import math
import time
from dataclasses import dataclass

from limits import parse
from limits.aio.storage import MemoryStorage, RedisStorage, Storage
from limits.aio.strategies import MovingWindowRateLimiter


@dataclass
class RateDecision:
    allowed: bool
    retry_after: int = 0


def _storage(uri: str) -> Storage:
    if uri.startswith("memory://"):
        return MemoryStorage()
    if uri.startswith(("redis://", "rediss://")):
        return RedisStorage(uri, implementation="redispy", key_prefix="mra-limits")
    raise ValueError(f"unsupported rate limit storage: {uri}")


class RateLimits:
    def __init__(self, storage_uri: str) -> None:
        self.storage = _storage(storage_uri)
        self.strategy = MovingWindowRateLimiter(self.storage)

    async def hit(self, scope: str, identity: str, rate: str) -> RateDecision:
        item = parse(rate)
        if await self.strategy.hit(item, scope, identity):
            return RateDecision(True)
        stats = await self.strategy.get_window_stats(item, scope, identity)
        # Whole seconds, at least 1 and never longer than the window itself (int()+1 could say 61 for a minute).
        return RateDecision(False, min(item.get_expiry(), max(1, math.ceil(stats.reset_time - time.time()))))

    async def reset(self) -> None:
        await self.storage.reset()
