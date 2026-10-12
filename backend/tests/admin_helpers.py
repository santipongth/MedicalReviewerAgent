"""Shared setup for the admin console tests (Plan 23a)."""
from app.services.admin_auth import create_user

PASSWORD = "correct horse battery staple"
CSRF = {"X-MRA-Admin": "1"}


async def create_admin(session_factory, username: str = "owner", password: str = PASSWORD):
    async with session_factory() as s, s.begin():
        return await create_user(s, username, password)


def cookie_of(response) -> str:
    """The mra_admin token from Set-Cookie (read directly: httpx's cookie jar is host- and path-sensitive)."""
    header = response.headers["set-cookie"]
    assert header.startswith("mra_admin="), header
    return header.split(";", 1)[0].split("=", 1)[1]


async def sign_in(client, username: str = "owner", password: str = PASSWORD) -> dict[str, str]:
    """Headers for cookie-authenticated admin calls: the session cookie and the CSRF header."""
    r = await client.post("/api/v1/admin/session", json={"username": username, "password": password}, headers=CSRF)
    assert r.status_code == 204, r.text
    client.cookies.clear()
    return {"Cookie": f"mra_admin={cookie_of(r)}", **CSRF}


async def admin_headers(client, session_factory) -> dict[str, str]:
    await create_admin(session_factory)
    return await sign_in(client)
