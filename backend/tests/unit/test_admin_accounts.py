import uuid
from datetime import UTC, datetime

import pytest
from argon2 import PasswordHasher

from app.services import admin_auth
from app.services.admin_auth import (
    CLI_ACTOR,
    AdminAuthError,
    AdminPrincipal,
    check_username,
    create_user,
    find_user,
    hash_password,
    list_users,
    set_disabled,
    set_password,
    verify_password,
)
from app.services.audit import audit_out, list_audit, record

PW = "correct horse battery staple"


def test_username_rules():
    assert check_username("  Owner.1 ") == "owner.1"
    for bad in ("ab", "x" * 33, "has space", "ไทย", "semi;colon", ""):
        with pytest.raises(AdminAuthError):
            check_username(bad)


async def test_hash_and_verify_round_trip():
    stored = await hash_password(PW)
    assert stored.startswith("$argon2id$") and PW not in stored
    assert await verify_password(stored, PW) == (True, None)
    assert await verify_password(stored, "wrong password here") == (False, None)
    assert await verify_password("not-a-hash", PW) == (False, None)


async def test_unknown_user_never_succeeds():
    assert await verify_password(None, PW) == (False, None)


async def test_old_parameters_are_rehashed_on_success(monkeypatch):
    old = PasswordHasher(time_cost=1, memory_cost=8, parallelism=1).hash(PW)
    monkeypatch.setattr(admin_auth, "HASHER", PasswordHasher(time_cost=2, memory_cost=16, parallelism=1))
    ok, new = await verify_password(old, PW)
    assert ok and new is not None and new != old and "t=2" in new


async def test_create_set_password_disable_and_list(session_factory):
    async with session_factory() as s, s.begin():
        user = await create_user(s, "Owner", PW)
    assert user.username == "owner"
    with pytest.raises(AdminAuthError, match="already exists"):
        async with session_factory() as s, s.begin():
            await create_user(s, "owner", "another long password")
    with pytest.raises(AdminAuthError, match="12-256"):
        async with session_factory() as s, s.begin():
            await create_user(s, "second", "short")
    async with session_factory() as s, s.begin():
        await set_password(s, "OWNER", "a brand new password")
        await set_disabled(s, "owner", True)
    async with session_factory() as s:
        user = await find_user(s, " Owner ")
        users = await list_users(s)
    assert user.disabled_at is not None and [u.username for u in users] == ["owner"]
    assert (await verify_password(user.password_hash, "a brand new password"))[0]
    with pytest.raises(AdminAuthError, match="no admin"):
        async with session_factory() as s, s.begin():
            await set_password(s, "nobody", "a brand new password")


async def test_audit_rows_never_keep_secrets_and_page_newest_first(session_factory):
    actor = AdminPrincipal(kind="user", id=uuid.uuid4(), label="owner")
    when = datetime(2026, 10, 12, 9, 30, tzinfo=UTC)
    async with session_factory() as s, s.begin():
        for i in range(3):
            await record(s, actor, "key.update", target_type="key", target_id=f"k{i}",
                         before={"daily_quota": i, "key_hash": "secret", "at": when},
                         after={"daily_quota": i + 1, "password": "pw", "token": "t", "key": "mra_raw",
                                "password_hash": "h", "raw_key": "mra_raw"})
        await record(s, CLI_ACTOR, "admin.create", target_type="admin", target_id=uuid.uuid4())
    async with session_factory() as s:
        page1, cursor = await list_audit(s, limit=2)
        page2, end = await list_audit(s, before=cursor, limit=2)
    assert [r.action for r in page1] == ["admin.create", "key.update"] and end is None
    assert [r.target_id for r in page2] == ["k1", "k0"]
    row = audit_out(page2[0])
    assert row["before"] == {"daily_quota": 1, "at": "2026-10-12T09:30:00+00:00"}
    assert row["after"] == {"daily_quota": 2}
    assert row["actor_kind"] == "user" and row["actor_label"] == "owner" and "ip_hash" not in row
    assert audit_out(page1[0])["actor_kind"] == "cli" and audit_out(page1[0])["actor_label"] == "cli"
