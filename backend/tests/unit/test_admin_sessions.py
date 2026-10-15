import asyncio
import uuid

from app.services.admin_sessions import AdminSessions, LoginThrottle, fingerprint


async def test_session_round_trip_stores_only_the_digest(redis):
    sessions = AdminSessions(redis, ttl_seconds=600)
    uid = uuid.uuid4()
    token = await sessions.create(uid, "owner", "hash-1")
    data = await sessions.load(token)
    assert data["user_id"] == str(uid) and data["username"] == "owner" and data["created_at"]
    assert data["pw"] == fingerprint("hash-1") and len(data["pw"]) == 16 and "hash-1" not in data["pw"]
    keys = await redis.keys("mra:admin:session:*")
    assert len(keys) == 1 and token not in keys[0]
    assert 590 <= await redis.ttl(keys[0]) <= 600
    assert await sessions.load("forged") is None and await sessions.load("") is None
    await sessions.end(token)
    assert await sessions.load(token) is None
    await sessions.end("never-existed")  # ending an unknown token is harmless


async def test_end_all_ends_every_session_of_one_user_only(redis):
    sessions = AdminSessions(redis)
    a, b = uuid.uuid4(), uuid.uuid4()
    t1, t2, t3 = await sessions.create(a, "a", "h"), await sessions.create(a, "a", "h"), await sessions.create(b, "b", "h")
    assert await sessions.end_all(a) == 2
    assert await sessions.load(t1) is None and await sessions.load(t2) is None
    assert await sessions.load(t3) is not None
    assert await sessions.end_all(a) == 0


USER, IP = "mra:admin:fail:u:owner", "mra:admin:fail:ip:ip1"


async def test_throttle_allows_max_failures_attempts_then_refuses(redis):
    t = LoginThrottle(redis, max_failures=3, lockout_seconds=900)
    assert [await t.begin_attempt("owner", "ip1") for _ in range(3)] == [(None, False), (None, False), (None, True)]
    wait, reached = await t.begin_attempt("owner", "ip1")  # the fourth is refused
    assert reached is False and 890 <= wait <= 900


async def test_throttle_locks_the_username_from_any_ip_and_the_ip_for_any_username(redis):
    t = LoginThrottle(redis, max_failures=3, lockout_seconds=900)
    for _ in range(3):
        await t.begin_attempt("owner", "ip1")
    wait, _ = await t.begin_attempt("owner", "ip2")  # the username is locked from any address
    assert 890 <= wait <= 900
    assert (await t.begin_attempt("other", "ip1"))[0] is not None  # the address is locked for every username
    assert await t.begin_attempt("other", "ip2") == (None, False)


async def test_the_wait_is_the_longest_window_among_the_counters_over_the_limit(redis):
    t = LoginThrottle(redis, max_failures=2, lockout_seconds=900)
    await redis.set(USER, "5", ex=100)
    await redis.set(IP, "5", ex=500)
    wait, _ = await t.begin_attempt("owner", "ip1")
    assert 490 <= wait <= 500
    await redis.set(IP, "0", ex=500)  # only the username is over the limit now
    wait, _ = await t.begin_attempt("owner", "ip1")
    assert 90 <= wait <= 100


async def test_parallel_attempts_cannot_all_pass_the_check(redis):
    t = LoginThrottle(redis, max_failures=5, lockout_seconds=900)
    results = await asyncio.gather(*(t.begin_attempt("owner", "ip1") for _ in range(20)))
    assert sum(1 for wait, _ in results if wait is None) == 5
    assert sum(1 for wait, _ in results if wait is not None) == 15
    assert sum(1 for _, reached in results if reached) == 1  # exactly one attempt is the one that locks


async def test_success_clears_the_username_counter_and_gives_the_ip_attempt_back(redis):
    t = LoginThrottle(redis, max_failures=5, lockout_seconds=900)
    for _ in range(2):
        await t.begin_attempt("owner", "ip1")  # two failures
    await t.begin_attempt("owner", "ip1")  # the successful attempt is counted first ...
    await t.succeeded("owner", "ip1")
    assert await redis.get(USER) is None  # ... then the username is cleared
    assert await redis.get(IP) == "2"  # and the address still holds its two failures


async def test_success_never_takes_the_ip_counter_below_zero(redis):
    t = LoginThrottle(redis, max_failures=5, lockout_seconds=900)
    await t.begin_attempt("owner", "ip1")
    await t.succeeded("owner", "ip1")
    assert await redis.get(IP) is None  # deleted at zero
    await t.succeeded("owner", "ip1")  # nothing left to give back
    assert await redis.get(IP) is None and await redis.get(USER) is None


async def test_a_counter_without_expiry_gets_one(redis):
    await redis.set(USER, "1")  # e.g. a crash between INCR and EXPIRE
    t = LoginThrottle(redis, max_failures=5, lockout_seconds=900)
    await t.begin_attempt("owner", "ip1")
    assert 0 < await redis.ttl(USER) <= 900


async def test_a_locked_counter_without_expiry_is_repaired_and_refused_for_the_full_window(redis):
    await redis.set(USER, "5")  # e.g. a crash after the INCR that reached the limit
    t = LoginThrottle(redis, max_failures=5, lockout_seconds=900)
    wait, reached = await t.begin_attempt("owner", "ip1")
    assert reached is False and 890 <= wait <= 900
    assert 0 < await redis.ttl(USER) <= 900


async def test_a_later_attempt_does_not_extend_the_window(redis):
    t = LoginThrottle(redis, max_failures=5, lockout_seconds=900)
    await t.begin_attempt("owner", "ip1")
    await redis.expire(USER, 100)  # as if most of the window had passed
    await t.begin_attempt("owner", "ip1")
    assert 0 < await redis.ttl(USER) <= 100
