import hashlib
import uuid
from datetime import UTC, datetime

import httpx
from fastapi import Depends, FastAPI
from sqlalchemy import select

from app.api.auth import get_identity, require_admin
from app.cli.keys import run as keys_cli
from app.db.models import ApiKey, Review
from app.services.api_keys import mint_key, resolve_key, revoke_key


async def mint(session_factory, **kw):
    async with session_factory() as s, s.begin():
        raw, row = await mint_key(s, kw.pop("name", "lab"), **kw)
        return raw, row.id


async def test_keys_are_stored_as_hashes_only(session_factory):
    raw, key_id = await mint(session_factory)
    assert raw.startswith("mra_") and len(raw) > 40
    async with session_factory() as s:
        row = (await s.execute(select(ApiKey).where(ApiKey.id == key_id))).scalar_one()
    assert row.key_hash == hashlib.sha256(raw.encode()).hexdigest() and row.key_prefix == raw[:12]
    assert raw not in (row.key_hash, row.name)


async def test_resolve_valid_unknown_and_revoked(session_factory):
    raw, key_id = await mint(session_factory, daily_quota=7, is_admin=True)
    async with session_factory() as s:
        info = await resolve_key(s, raw)
        assert info.id == key_id and info.daily_quota == 7 and info.is_admin is True
        assert await resolve_key(s, "mra_unknown") is None
    async with session_factory() as s, s.begin():
        assert await revoke_key(s, raw[:12]) == 1
    async with session_factory() as s:
        assert await resolve_key(s, raw) is None


async def test_post_with_invalid_or_revoked_key_is_401_never_anonymous(client, session_factory):
    r = await client.post("/api/v1/reviews", json={"topic": "metformin"}, headers={"X-API-Key": "mra_nope"})
    assert r.status_code == 401
    raw, _ = await mint(session_factory)
    async with session_factory() as s, s.begin():
        await revoke_key(s, raw[:12])
    r = await client.post("/api/v1/reviews", json={"topic": "metformin"}, headers={"Authorization": f"Bearer {raw}"})
    assert r.status_code == 401


async def test_keyed_review_records_the_key_and_accepts_bearer(client, session_factory):
    raw, key_id = await mint(session_factory)
    r = await client.post("/api/v1/reviews", json={"topic": "metformin and cancer"},
                          headers={"Authorization": f"Bearer {raw}"})
    assert r.status_code == 202
    async with session_factory() as s:
        review = await s.get(Review, uuid.UUID(r.json()["review_id"]))
    assert review.api_key_id == key_id


async def test_callback_url_requires_a_key(client, session_factory):
    body = {"topic": "metformin and cancer", "callback_url": "https://example.org/hook"}
    assert (await client.post("/api/v1/reviews", json=body)).status_code == 403
    raw, _ = await mint(session_factory)
    r = await client.post("/api/v1/reviews", json=body, headers={"X-API-Key": raw})
    assert r.status_code == 202


async def test_daily_quota_is_enforced_per_key(client, session_factory):
    raw, _ = await mint(session_factory, daily_quota=1)
    ok = await client.post("/api/v1/reviews", json={"topic": "first keyed topic"}, headers={"X-API-Key": raw})
    over = await client.post("/api/v1/reviews", json={"topic": "second keyed topic"}, headers={"X-API-Key": raw})
    assert ok.status_code == 202 and over.status_code == 429
    assert "daily quota" in over.json()["detail"] and "retry-after" in over.headers


async def test_require_admin(session_factory, app):
    plain, _ = await mint(session_factory, name="plain")
    admin, _ = await mint(session_factory, name="admin", is_admin=True)
    mini = FastAPI()
    mini.state = app.state

    @mini.get("/x")
    async def x(identity=Depends(require_admin)):
        return {"ok": identity.api_key.name}

    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mini), base_url="http://t") as c:
        assert (await c.get("/x")).status_code == 401
        assert (await c.get("/x", headers={"X-API-Key": plain})).status_code == 403
        assert (await c.get("/x", headers={"X-API-Key": admin})).json() == {"ok": "admin"}
    assert get_identity is not None


async def test_cli_mint_list_revoke(session_factory, capsys):
    assert await keys_cli(["mint", "--name", "partner", "--quota", "50"], session_factory) == 0
    raw = next(line for line in capsys.readouterr().out.split() if line.startswith("mra_"))
    assert await keys_cli(["list"], session_factory) == 0
    listing = capsys.readouterr().out
    assert "partner" in listing and raw[:12] in listing and raw not in listing
    assert await keys_cli(["revoke", raw[:12]], session_factory) == 0
    async with session_factory() as s:
        assert await resolve_key(s, raw) is None
    assert datetime.now(UTC)
