import asyncio

from sqlalchemy import func, select

from app.db.models import AdminAudit
from app.services.admin_auth import find_user, set_disabled
from app.services.api_keys import mint_key
from tests.admin_helpers import CSRF, PASSWORD, cookie_of, create_admin, sign_in

SESSION = "/api/v1/admin/session"


async def mint(session_factory, **kw):
    async with session_factory() as s, s.begin():
        raw, _ = await mint_key(s, kw.pop("name", "lab"), **kw)
        return raw


async def count(session_factory, action):
    async with session_factory() as s:
        return await s.scalar(select(func.count()).select_from(AdminAudit).where(AdminAudit.action == action))


async def attempt(client, username="owner", password=PASSWORD):
    return await client.post(SESSION, json={"username": username, "password": password}, headers=CSRF)


async def test_sign_in_sets_a_strict_http_only_cookie_and_me_answers(client, session_factory):
    await create_admin(session_factory)
    r = await attempt(client)
    assert r.status_code == 204
    attrs = r.headers["set-cookie"].lower()
    assert "httponly" in attrs and "samesite=strict" in attrs and "path=/api/v1/admin" in attrs
    assert "max-age=28800" in attrs and "secure" not in attrs
    client.cookies.clear()
    me = await client.get("/api/v1/admin/me", headers={"Cookie": f"mra_admin={cookie_of(r)}"})
    assert me.json() == {"kind": "user", "label": "owner"}
    assert await count(session_factory, "admin.login") == 1
    async with session_factory() as s:
        assert (await find_user(s, "owner")).last_login_at is not None


async def test_cookie_is_secure_on_an_https_site(app, client, session_factory):
    app.state.deps.service.settings.public_base_url = "https://reviews.example.org"
    await create_admin(session_factory)
    assert "secure" in (await attempt(client)).headers["set-cookie"].lower()


async def test_wrong_password_and_unknown_user_get_the_same_401(client, session_factory):
    await create_admin(session_factory)
    wrong, unknown = await attempt(client, password="not the password"), await attempt(client, username="ghost")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json() == {"detail": "invalid username or password"}
    assert "set-cookie" not in wrong.headers


async def test_fifth_failure_locks_even_the_right_password(client, session_factory):
    await create_admin(session_factory)
    for _ in range(5):
        assert (await attempt(client, password="not the password")).status_code == 401
    locked = await attempt(client)
    assert locked.status_code == 429 and 0 < int(locked.headers["retry-after"]) <= 900
    assert await count(session_factory, "admin.lockout") == 1 and await count(session_factory, "admin.login") == 0


async def test_failures_across_usernames_lock_the_address(client, session_factory):
    await create_admin(session_factory)
    for i in range(5):
        await attempt(client, username=f"guess{i}", password="not the password")
    assert (await attempt(client)).status_code == 429


async def test_username_case_and_spaces_are_one_account_and_one_counter(client, redis, session_factory):
    await create_admin(session_factory)
    assert (await attempt(client, username="  OWNER ")).status_code == 204
    for _ in range(3):
        await attempt(client, username="OWNER", password="not the password")
    assert await redis.get("mra:admin:fail:u:owner") == "3"


async def test_success_clears_the_username_counter_but_not_the_address(client, redis, session_factory):
    await create_admin(session_factory)
    for _ in range(2):
        await attempt(client, password="not the password")
    assert (await attempt(client)).status_code == 204
    assert await redis.get("mra:admin:fail:u:owner") is None
    assert len([k for k in await redis.keys("mra:admin:fail:ip:*")]) == 1


async def test_oversized_or_missing_fields_are_422_before_any_hashing(client, session_factory, monkeypatch):
    import app.api.admin as admin_api

    async def boom(*_):
        raise AssertionError("hashing must not run")

    monkeypatch.setattr(admin_api, "verify_password", boom)
    await create_admin(session_factory)
    assert (await attempt(client, password="x" * 300)).status_code == 422
    assert (await attempt(client, username="u" * 65)).status_code == 422
    assert (await client.post(SESSION, json={"password": PASSWORD}, headers=CSRF)).status_code == 422


async def test_control_characters_in_the_username_are_422_before_any_lookup_or_hashing(
        client, session_factory, monkeypatch):
    """Postgres raises on NUL in a string literal, which would surface as a 500 if it reached the lookup."""
    import app.api.admin as admin_api

    async def boom(*_):
        raise AssertionError("hashing must not run")

    monkeypatch.setattr(admin_api, "verify_password", boom)
    await create_admin(session_factory)
    for bad in ("own\x00er", "\x00", "owner\n", "ow\x1fner", "owner\x7f", "\tonly"):
        assert (await attempt(client, username=bad)).status_code == 422, repr(bad)
    assert await count(session_factory, "admin.lockout") == 0


async def test_parallel_wrong_passwords_cannot_all_get_past_the_lockout(client, session_factory, monkeypatch):
    """The attempt is counted before the password is hashed, so a burst gets max_failures guesses, not one each."""
    import app.api.admin as admin_api

    calls = 0

    async def slow_wrong(*_):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return False, None

    monkeypatch.setattr(admin_api, "verify_password", slow_wrong)
    await create_admin(session_factory)
    responses = await asyncio.gather(*(attempt(client, password="not the password") for _ in range(20)))
    statuses = sorted(r.status_code for r in responses)
    assert calls <= 5 and statuses == [401] * 5 + [429] * 15
    assert all(0 < int(r.headers["retry-after"]) <= 900 for r in responses if r.status_code == 429)
    assert await count(session_factory, "admin.lockout") == 1


async def test_sign_in_needs_the_csrf_header(client, session_factory):
    await create_admin(session_factory)
    r = await client.post(SESSION, json={"username": "owner", "password": PASSWORD})
    assert r.status_code == 403


async def test_forged_empty_or_ended_cookies_get_401(client, session_factory):
    for cookie in ("mra_admin=forged", "mra_admin=", ""):
        r = await client.get("/api/v1/admin/me", headers={"Cookie": cookie} if cookie else {})
        assert r.status_code == 401, cookie
    await create_admin(session_factory)
    headers = await sign_in(client)
    assert (await client.delete(SESSION, headers=headers)).status_code == 204
    assert (await client.get("/api/v1/admin/me", headers=headers)).status_code == 401


async def test_a_disabled_admin_loses_the_session(client, session_factory, redis):
    await create_admin(session_factory)
    headers = await sign_in(client)
    async with session_factory() as s, s.begin():
        await set_disabled(s, "owner", True)
    assert (await client.get("/api/v1/admin/me", headers=headers)).status_code == 401
    assert await redis.keys("mra:admin:session:*") == []


async def test_cookie_writes_need_the_csrf_header_but_key_writes_do_not(client, session_factory):
    await create_admin(session_factory)
    headers = await sign_in(client)
    no_csrf = {"Cookie": headers["Cookie"]}
    assert (await client.post("/api/v1/admin/mcp/reload", headers=no_csrf)).status_code == 403
    assert (await client.post("/api/v1/admin/mcp/reload", headers=headers)).status_code == 200
    key = await mint(session_factory, name="ops", is_admin=True)
    assert (await client.post("/api/v1/admin/mcp/reload", headers={"X-API-Key": key})).status_code == 200


async def test_admin_keys_still_work_and_other_keys_do_not(client, session_factory):
    admin = await mint(session_factory, name="ops", is_admin=True)
    plain = await mint(session_factory, name="lab")
    me = await client.get("/api/v1/admin/me", headers={"X-API-Key": admin})
    assert me.json() == {"kind": "key", "label": admin[:12]}
    assert (await client.get("/api/v1/admin/me", headers={"X-API-Key": plain})).status_code == 403
    assert (await client.get("/api/v1/admin/me", headers={"X-API-Key": "mra_nope"})).status_code == 401


async def test_sign_out_ends_the_session_and_clears_the_cookie(client, session_factory):
    await create_admin(session_factory)
    headers = await sign_in(client)
    r = await client.delete(SESSION, headers=headers)
    assert r.status_code == 204 and "max-age=0" in r.headers["set-cookie"].lower()
    assert (await client.get("/api/v1/admin/me", headers=headers)).status_code == 401
    assert await count(session_factory, "admin.logout") == 1


async def test_admin_routes_are_not_in_the_public_openapi(client):
    paths = (await client.get("/api/openapi.json")).json()["paths"]
    assert paths and not [p for p in paths if p.startswith("/api/v1/admin")]
