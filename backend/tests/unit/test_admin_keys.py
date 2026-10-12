import json
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.db.models import AdminAudit, ApiKey
from app.db.repositories import ReviewRepository
from tests.admin_helpers import admin_headers

KEYS = "/api/v1/admin/keys"


async def audit(session_factory):
    async with session_factory() as s:
        return list((await s.execute(select(AdminAudit).order_by(AdminAudit.id))).scalars())


async def test_mint_shows_the_key_once_and_stores_only_its_hash(client, session_factory):
    headers = await admin_headers(client, session_factory)
    r = await client.post(KEYS, json={"name": "  partner lab ", "daily_quota": 50, "is_admin": False}, headers=headers)
    assert r.status_code == 201
    body = r.json()
    raw = body["key"]
    assert raw.startswith("mra_") and body["key_prefix"] == raw[:12] and body["name"] == "partner lab"
    assert body["daily_quota"] == 50 and body["reviews_24h"] == 0 and body["revoked_at"] is None
    listing = (await client.get(KEYS, headers=headers)).json()
    assert [k["key_prefix"] for k in listing] == [raw[:12]] and raw not in json.dumps(listing)
    async with session_factory() as s:
        row = (await s.execute(select(ApiKey))).scalar_one()
    assert raw not in (row.key_hash, row.name)
    [mint_row] = [a for a in await audit(session_factory) if a.action == "key.mint"]
    assert raw not in json.dumps(mint_row.after) and mint_row.after["key_prefix"] == raw[:12]
    assert (await client.get("/api/v1/admin/me", headers={"X-API-Key": raw})).status_code == 403  # not an admin key


async def test_mint_validation(client, session_factory):
    headers = await admin_headers(client, session_factory)
    for body in ({"name": "lab", "daily_quota": 0}, {"name": "lab", "daily_quota": -1},
                 {"name": "lab", "daily_quota": 100_001}, {"name": "   "}, {"name": "n" * 101}, {}):
        assert (await client.post(KEYS, json=body, headers=headers)).status_code == 422, body


async def test_listing_counts_reviews_in_the_last_24_hours(client, session_factory):
    headers = await admin_headers(client, session_factory)
    key_id = (await client.post(KEYS, json={"name": "lab"}, headers=headers)).json()["id"]
    async with session_factory() as s, s.begin():
        repo = ReviewRepository(s)
        for hours in (1, 2, 30):
            r = await repo.create(topic="t", language="th", options={}, cache_key=str(uuid.uuid4()),
                                  api_key_id=uuid.UUID(key_id))
            r.created_at = datetime.now(UTC) - timedelta(hours=hours)
    [row] = (await client.get(KEYS, headers=headers)).json()
    assert row["reviews_24h"] == 2


async def test_update_records_only_what_changed(client, session_factory):
    headers = await admin_headers(client, session_factory)
    key_id = (await client.post(KEYS, json={"name": "lab", "daily_quota": 10}, headers=headers)).json()["id"]
    r = await client.patch(f"{KEYS}/{key_id}", json={"daily_quota": 25, "name": "lab"}, headers=headers)
    assert r.status_code == 200 and r.json()["daily_quota"] == 25 and r.json()["name"] == "lab"
    [row] = [a for a in await audit(session_factory) if a.action == "key.update"]
    assert row.before == {"daily_quota": 10} and row.after == {"daily_quota": 25}
    assert (await client.patch(f"{KEYS}/{uuid.uuid4()}", json={"daily_quota": 5}, headers=headers)).status_code == 404
    assert (await client.patch(f"{KEYS}/{key_id}", json={"daily_quota": 0}, headers=headers)).status_code == 422


async def test_revoke_is_idempotent_and_a_revoked_key_cannot_change(client, session_factory):
    headers = await admin_headers(client, session_factory)
    minted = (await client.post(KEYS, json={"name": "lab"}, headers=headers)).json()
    for _ in range(2):
        r = await client.post(f"{KEYS}/{minted['id']}/revoke", headers=headers)
        assert r.status_code == 200 and r.json()["revoked_at"] is not None
    assert len([a for a in await audit(session_factory) if a.action == "key.revoke"]) == 1
    assert (await client.patch(f"{KEYS}/{minted['id']}", json={"name": "x"}, headers=headers)).status_code == 409
    gone = await client.post("/api/v1/reviews", json={"topic": "metformin"}, headers={"X-API-Key": minted["key"]})
    assert gone.status_code == 401


async def test_audit_route_pages_newest_first(client, session_factory):
    headers = await admin_headers(client, session_factory)  # writes admin.login
    for i in range(3):
        await client.post(KEYS, json={"name": f"lab{i}"}, headers=headers)
    first = (await client.get("/api/v1/admin/audit", params={"limit": 2}, headers=headers)).json()
    rest = (await client.get("/api/v1/admin/audit", params={"limit": 2, "before": first["next"]},
                             headers=headers)).json()
    actions = [a["action"] for a in first["items"] + rest["items"]]
    assert actions == ["key.mint", "key.mint", "key.mint", "admin.login"] and rest["next"] is None
    assert first["items"][0]["actor_label"] == "owner" and "ip_hash" not in first["items"][0]
