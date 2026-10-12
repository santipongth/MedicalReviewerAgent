import asyncio
from contextlib import asynccontextmanager

import pytest
from sqlalchemy import func, select
from starlette.requests import Request

from app.api.auth import admin_cookie_secure
from app.config import Settings
from app.db.models import AdminAudit
from app.services.admin_auth import find_user, set_disabled
from app.services.api_keys import mint_key
from tests.admin_helpers import CSRF, PASSWORD, cookie_of, create_admin, sign_in

SESSION = "/api/v1/admin/session"
HTTPS_PROXY = {"X-Forwarded-Proto": "https"}  # what Caddy sends when it terminates TLS


def cookie_attrs(response) -> list[str]:
    """The Set-Cookie attributes after the name=value pair, lower-cased (a random token could contain "secure")."""
    return [a.strip().lower() for a in response.headers["set-cookie"].split(";")[1:]]


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


async def test_cookie_is_secure_behind_the_trusted_proxy_on_https(app, client, session_factory):
    """Behind Caddy on https with PUBLIC_BASE_URL left at its default: uvicorn runs with --no-proxy-headers, so only the
    proxy's X-Forwarded-Proto says the site is https. Sign-out clears the cookie with the same attributes."""
    app.state.deps.service.settings.trust_proxy = True
    await create_admin(session_factory)
    r = await client.post(SESSION, json={"username": "owner", "password": PASSWORD}, headers={**CSRF, **HTTPS_PROXY})
    assert r.status_code == 204 and "secure" in cookie_attrs(r)
    client.cookies.clear()
    out = await client.delete(SESSION, headers={"Cookie": f"mra_admin={cookie_of(r)}", **CSRF, **HTTPS_PROXY})
    assert out.status_code == 204 and "secure" in cookie_attrs(out)


async def test_forwarded_proto_is_ignored_without_a_trusted_proxy(client, session_factory):
    """Without TRUST_PROXY the header comes from the client, so it decides nothing."""
    await create_admin(session_factory)
    r = await client.post(SESSION, json={"username": "owner", "password": PASSWORD}, headers={**CSRF, **HTTPS_PROXY})
    assert r.status_code == 204 and "secure" not in cookie_attrs(r)


async def test_admin_cookie_secure_false_wins_over_https(app, client, session_factory):
    settings = app.state.deps.service.settings
    settings.trust_proxy, settings.public_base_url, settings.admin_cookie_secure = True, "https://x.example.org", False
    await create_admin(session_factory)
    r = await client.post(SESSION, json={"username": "owner", "password": PASSWORD}, headers={**CSRF, **HTTPS_PROXY})
    assert r.status_code == 204 and "secure" not in cookie_attrs(r)


@pytest.mark.parametrize(("overrides", "headers", "secure"), [
    ({}, {}, False),
    ({"public_base_url": "https://reviews.example.org"}, {}, True),
    ({"admin_cookie_secure": True}, {}, True),
    ({"public_base_url": "https://x.example.org", "admin_cookie_secure": False}, {}, False),
    ({"trust_proxy": True}, HTTPS_PROXY, True),
    ({"trust_proxy": True}, {"X-Forwarded-Proto": "http"}, False),
    ({"trust_proxy": True}, {"X-Forwarded-Proto": "http, https"}, True),  # the proxy's own hop is the rightmost
    ({}, HTTPS_PROXY, False),
    ({"trust_proxy": True, "admin_cookie_secure": False}, HTTPS_PROXY, False),
])
def test_the_admin_cookie_secure_rule(overrides, headers, secure):
    request = Request({"type": "http", "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()]})
    assert admin_cookie_secure(request, Settings(_env_file=None, **overrides)) is secure


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


async def test_a_burst_of_sign_ins_never_runs_more_password_checks_at_once_than_the_limit(
        app, client, session_factory, monkeypatch):
    """argon2 is CPU and memory heavy and the route is unauthenticated, so password checks queue for a few slots."""
    import app.api.admin as admin_api

    app.state.deps.service.settings.admin_login_max_failures = 100  # let the whole burst past the lockout
    in_flight = peak = calls = 0

    async def tracked(*_):
        nonlocal in_flight, peak, calls
        calls += 1
        in_flight += 1
        peak = max(peak, in_flight)
        await asyncio.sleep(0.02)
        in_flight -= 1
        return False, None

    monkeypatch.setattr(admin_api, "verify_password", tracked)
    await create_admin(session_factory)
    n = admin_api.VERIFY_CONCURRENCY * 3
    responses = await asyncio.gather(*(attempt(client, username=f"user{i}", password="not the password")
                                       for i in range(n)))
    assert [r.status_code for r in responses] == [401] * n and calls == n
    assert peak == admin_api.VERIFY_CONCURRENCY  # bounded, and the bound is actually reached


async def test_the_password_is_checked_with_no_database_session_open(app, client, session_factory, monkeypatch):
    """The lookup and the success write each use a short session; the slow argon2 check holds neither a connection
    nor a transaction."""
    import app.api.admin as admin_api

    open_sessions = 0
    seen: list[int] = []

    @asynccontextmanager
    async def tracking_factory():
        nonlocal open_sessions
        async with session_factory() as session:
            open_sessions += 1
            try:
                yield session
            finally:
                open_sessions -= 1

    real_verify = admin_api.verify_password

    async def watched(stored, password):
        seen.append(open_sessions)
        return await real_verify(stored, password)

    await create_admin(session_factory)
    app.state.deps.session_factory = tracking_factory
    monkeypatch.setattr(admin_api, "verify_password", watched)
    assert (await attempt(client)).status_code == 204
    assert (await attempt(client, password="not the password")).status_code == 401
    assert (await attempt(client, username="ghost")).status_code == 401
    assert seen == [0, 0, 0]
    assert await count(session_factory, "admin.login") == 1


async def test_an_admin_disabled_while_the_password_is_checked_does_not_get_in(app, client, session_factory,
                                                                              monkeypatch, redis):
    """The success write re-loads the account: one disabled (or given a new password) in the meantime is refused."""
    import app.api.admin as admin_api

    real_verify = admin_api.verify_password

    async def disable_meanwhile(stored, password):
        result = await real_verify(stored, password)
        async with session_factory() as s, s.begin():
            await set_disabled(s, "owner", True)
        return result

    await create_admin(session_factory)
    monkeypatch.setattr(admin_api, "verify_password", disable_meanwhile)
    r = await attempt(client)
    assert r.status_code == 401 and "set-cookie" not in r.headers
    assert await count(session_factory, "admin.login") == 0 and await redis.keys("mra:admin:session:*") == []


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
