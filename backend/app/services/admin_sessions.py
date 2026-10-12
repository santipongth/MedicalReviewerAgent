"""Admin sign-in state in Redis (Plan 23a), shared by every API process: opaque session tokens and the
failed-sign-in lockout. Redis holds only the SHA-256 of a token, so a Redis dump cannot be replayed as a cookie."""
from __future__ import annotations

import hashlib
import json
import secrets
import uuid
from datetime import UTC, datetime

SESSION_KEY = "mra:admin:session:{}"
USER_SESSIONS_KEY = "mra:admin:user:{}:sessions"
FAIL_USER_KEY = "mra:admin:fail:u:{}"
FAIL_IP_KEY = "mra:admin:fail:ip:{}"


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class AdminSessions:
    def __init__(self, redis, ttl_seconds: int = 28800) -> None:
        self.redis = redis
        self.ttl = ttl_seconds

    async def create(self, user_id: uuid.UUID, username: str) -> str:
        token = secrets.token_urlsafe(32)
        digest = _digest(token)
        data = json.dumps({"user_id": str(user_id), "username": username,
                           "created_at": datetime.now(UTC).isoformat()})
        await self.redis.set(SESSION_KEY.format(digest), data, ex=self.ttl)  # absolute TTL, never extended
        members = USER_SESSIONS_KEY.format(user_id)
        await self.redis.sadd(members, digest)
        await self.redis.expire(members, self.ttl)
        return token

    async def load(self, token: str) -> dict | None:
        if not token:
            return None
        raw = await self.redis.get(SESSION_KEY.format(_digest(token)))
        return json.loads(raw) if raw else None

    async def end(self, token: str) -> None:
        if not token:
            return
        data = await self.load(token)
        digest = _digest(token)
        await self.redis.delete(SESSION_KEY.format(digest))
        if data:
            await self.redis.srem(USER_SESSIONS_KEY.format(data["user_id"]), digest)

    async def end_all(self, user_id: uuid.UUID) -> int:
        """End every session of one user (password change, disable). Returns how many were live."""
        members = USER_SESSIONS_KEY.format(user_id)
        ended = 0
        for digest in await self.redis.smembers(members):
            ended += int(await self.redis.delete(SESSION_KEY.format(digest)))
        await self.redis.delete(members)
        return ended


class LoginThrottle:
    """Failed sign-ins counted per username and per IP. When either count reaches max_failures, that username or that
    address is locked until its counter expires (lockout_seconds after the first failure)."""

    def __init__(self, redis, max_failures: int, lockout_seconds: int) -> None:
        self.redis = redis
        self.max_failures = max_failures
        self.lockout = lockout_seconds

    def _keys(self, username: str, ip_hash: str) -> tuple[str, str]:
        return FAIL_USER_KEY.format(username), FAIL_IP_KEY.format(ip_hash)

    async def locked_for(self, username: str, ip_hash: str) -> int | None:
        for key in self._keys(username, ip_hash):
            count = await self.redis.get(key)
            if count is not None and int(count) >= self.max_failures:
                return max(int(await self.redis.ttl(key)), 1)
        return None

    async def fail(self, username: str, ip_hash: str) -> bool:
        locked = False
        for key in self._keys(username, ip_hash):
            count = int(await self.redis.incr(key))
            if await self.redis.ttl(key) < 0:  # new counter, or one that lost its expiry
                await self.redis.expire(key, self.lockout)
            locked = locked or count == self.max_failures
        return locked

    async def clear_user(self, username: str) -> None:
        await self.redis.delete(FAIL_USER_KEY.format(username))
