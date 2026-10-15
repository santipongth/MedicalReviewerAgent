"""Admin sign-in state in Redis (Plan 23a), shared by every API process: opaque session tokens and the
failed-sign-in lockout. A session also holds a fingerprint of the password hash it was made under (Plan 31), so a
password change ends it at its next request, before the CLI's end_all runs. Redis holds only the SHA-256 of a token, so a Redis dump cannot be replayed as a cookie."""
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


def fingerprint(password_hash: str) -> str:
    """Which password a session was made under: the first 16 hex chars of the SHA-256 of the password hash (the hash
    itself never goes to Redis). A changed password gives another fingerprint, which ends the session."""
    return hashlib.sha256(password_hash.encode()).hexdigest()[:16]


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class AdminSessions:
    def __init__(self, redis, ttl_seconds: int = 28800) -> None:
        self.redis = redis
        self.ttl = ttl_seconds

    async def create(self, user_id: uuid.UUID, username: str, password_hash: str) -> str:
        token = secrets.token_urlsafe(32)
        digest = _digest(token)
        data = json.dumps({"user_id": str(user_id), "username": username, "pw": fingerprint(password_hash),
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
    """Sign-in attempts counted per username and per IP, reserved before the password is checked so a burst of parallel
    attempts cannot all pass the check first: each attempt counts itself atomically, and only the first max_failures
    in a window are allowed to go on. The window is fixed: it starts at the first attempt and later ones never extend
    it. A success gives its attempt back, so the counters hold failures only. Redis keeps counts, never passwords."""

    def __init__(self, redis, max_failures: int, lockout_seconds: int) -> None:
        self.redis = redis
        self.max_failures = max_failures
        self.lockout = lockout_seconds

    def _keys(self, username: str, ip_hash: str) -> tuple[str, str]:
        return FAIL_USER_KEY.format(username), FAIL_IP_KEY.format(ip_hash)

    async def begin_attempt(self, username: str, ip_hash: str) -> tuple[int | None, bool]:
        """Counts this attempt against the username and the address in one Redis transaction (INCR, then EXPIRE NX so a
        counter always has a window, even one left without expiry by a crash). Returns (wait, reached):
        (seconds, False) when either counter is already over max_failures, meaning this attempt must be refused (wait is
        the longest remaining window among the counters over the limit, at least 1); otherwise (None, True) when this
        attempt is the last one allowed for the username or the address, and (None, False) when it is not."""
        keys = self._keys(username, ip_hash)
        async with self.redis.pipeline(transaction=True) as pipe:
            for key in keys:
                pipe.incr(key)
                pipe.expire(key, self.lockout, nx=True)  # NX: the window starts at the first attempt and is not extended
                pipe.ttl(key)
            results = await pipe.execute()
        counts, ttls = [int(n) for n in results[0::3]], [int(t) for t in results[2::3]]
        over = [ttl if ttl > 0 else self.lockout for count, ttl in zip(counts, ttls, strict=True)
                if count > self.max_failures]
        if over:
            return max(max(over), 1), False
        return None, any(count == self.max_failures for count in counts)

    async def succeeded(self, username: str, ip_hash: str) -> None:
        """A correct password: the username's counter is cleared and this attempt is taken back off the address's
        counter (never below zero; deleted at zero), so failures from other people on the same address still count."""
        user_key, ip_key = self._keys(username, ip_hash)
        async with self.redis.pipeline(transaction=True) as pipe:
            pipe.delete(user_key)
            pipe.decr(ip_key)
            _, left = await pipe.execute()
        if int(left) <= 0:
            await self.redis.delete(ip_key)
