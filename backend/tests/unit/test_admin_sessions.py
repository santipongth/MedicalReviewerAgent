import uuid

from app.services.admin_sessions import AdminSessions, LoginThrottle


async def test_session_round_trip_stores_only_the_digest(redis):
    sessions = AdminSessions(redis, ttl_seconds=600)
    uid = uuid.uuid4()
    token = await sessions.create(uid, "owner")
    data = await sessions.load(token)
    assert data["user_id"] == str(uid) and data["username"] == "owner" and data["created_at"]
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
    t1, t2, t3 = await sessions.create(a, "a"), await sessions.create(a, "a"), await sessions.create(b, "b")
    assert await sessions.end_all(a) == 2
    assert await sessions.load(t1) is None and await sessions.load(t2) is None
    assert await sessions.load(t3) is not None
    assert await sessions.end_all(a) == 0


async def test_throttle_locks_the_username_and_the_ip(redis):
    t = LoginThrottle(redis, max_failures=3, lockout_seconds=900)
    assert [await t.fail("owner", "ip1") for _ in range(3)] == [False, False, True]
    assert 890 <= await t.locked_for("owner", "ip2") <= 900  # the username is locked from any address
    assert await t.locked_for("other", "ip1") is not None  # the address is locked for every username
    assert await t.locked_for("other", "ip2") is None


async def test_clear_user_keeps_the_ip_count(redis):
    t = LoginThrottle(redis, max_failures=5, lockout_seconds=900)
    for _ in range(2):
        await t.fail("owner", "ip1")
    await t.clear_user("owner")
    assert await redis.get("mra:admin:fail:u:owner") is None
    assert await redis.get("mra:admin:fail:ip:ip1") == "2"


async def test_a_counter_without_expiry_gets_one(redis):
    await redis.set("mra:admin:fail:u:owner", "1")  # e.g. a crash between INCR and EXPIRE
    t = LoginThrottle(redis, max_failures=5, lockout_seconds=900)
    await t.fail("owner", "ip1")
    assert 0 < await redis.ttl("mra:admin:fail:u:owner") <= 900


async def test_a_locked_counter_without_expiry_is_repaired_by_locked_for(redis):
    await redis.set("mra:admin:fail:u:owner", "5")  # e.g. a crash after the INCR that reached the limit
    t = LoginThrottle(redis, max_failures=5, lockout_seconds=900)
    wait = await t.locked_for("owner", "ip1")
    assert wait is not None and 0 < wait <= 900
    assert 0 < await redis.ttl("mra:admin:fail:u:owner") <= 900


async def test_a_later_failure_does_not_extend_the_window(redis):
    t = LoginThrottle(redis, max_failures=5, lockout_seconds=900)
    await t.fail("owner", "ip1")
    await redis.expire("mra:admin:fail:u:owner", 100)  # as if most of the window had passed
    await t.fail("owner", "ip1")
    assert 0 < await redis.ttl("mra:admin:fail:u:owner") <= 100
