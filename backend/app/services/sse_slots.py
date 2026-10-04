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
        async with self.redis.pipeline(transaction=True) as pipe:  # INCR and EXPIRE together: never a key without TTL
            pipe.incr(key)
            pipe.expire(key, self.ttl)
            count, _ = await pipe.execute()
        if count > self.limit:
            await self.redis.decr(key)
            return False
        return True

    async def refresh(self, client: str) -> None:
        await self.redis.expire(self._key(client), self.ttl)

    def lease(self, client: str) -> SlotLease:
        return SlotLease(self, client)

    async def release(self, client: str) -> None:
        key = self._key(client)
        if int(await self.redis.decr(key)) <= 0:
            await self.redis.delete(key)


class SlotLease:
    """One acquired slot. Released by whichever runs first: the stream generator's finally, or the response's
    background task (which also runs when the client left before the first byte and the generator never started)."""

    def __init__(self, slots: SseSlots, client: str) -> None:
        self.slots = slots
        self.client = client
        self._released = False

    async def release(self) -> None:
        if self._released:
            return
        self._released = True
        await self.slots.release(self.client)
