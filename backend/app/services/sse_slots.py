"""Concurrent event-stream slots per client, shared by every API process through Redis. The counter's TTL is
refreshed while streams are open, so slots held by a crashed process expire on their own."""
from __future__ import annotations


class SseSlots:
    def __init__(self, redis, *, limit: int, ttl_seconds: int = 120) -> None:
        self.redis = redis
        self.limit = limit
        self.ttl = ttl_seconds

    @staticmethod
    def _key(client: str) -> str:
        return f"mra:sse:{client}"

    async def acquire(self, client: str) -> bool:
        key = self._key(client)
        count = await self.redis.incr(key)
        await self.redis.expire(key, self.ttl)
        if count > self.limit:
            await self.redis.decr(key)
            return False
        return True

    async def refresh(self, client: str) -> None:
        await self.redis.expire(self._key(client), self.ttl)

    async def release(self, client: str) -> None:
        key = self._key(client)
        if int(await self.redis.decr(key)) <= 0:
            await self.redis.delete(key)
