import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.config import Settings
from app.db.models import AdminAudit, AdminUser
from app.services.api_keys import mint_key, resolve_key


def test_admin_settings_defaults_and_cookie_security():
    s = Settings(_env_file=None)
    assert (s.admin_session_ttl_seconds, s.admin_login_max_failures, s.admin_lockout_seconds) == (28800, 5, 900)
    assert s.admin_cookie_secure is None and s.admin_cookie_is_secure is False
    assert Settings(_env_file=None, public_base_url="https://reviews.example.org").admin_cookie_is_secure is True
    assert Settings(_env_file=None, public_base_url="https://x.example.org",
                    admin_cookie_secure=False).admin_cookie_is_secure is False
    assert Settings(_env_file=None, admin_cookie_secure=True).admin_cookie_is_secure is True


async def test_admin_tables_store_users_and_audit_rows(session_factory):
    async with session_factory() as s, s.begin():
        s.add(AdminUser(username="owner", password_hash="h"))
        s.add(AdminAudit(actor_kind="cli", actor_label="cli", action="admin.create", after={"username": "owner"}))
    async with session_factory() as s:
        user = (await s.execute(select(AdminUser))).scalar_one()
        row = (await s.execute(select(AdminAudit))).scalar_one()
    assert user.username == "owner" and user.disabled_at is None and user.last_login_at is None
    assert row.action == "admin.create" and row.after == {"username": "owner"} and row.before is None


async def test_usernames_are_unique(session_factory):
    async with session_factory() as s, s.begin():
        s.add(AdminUser(username="owner", password_hash="h"))
    with pytest.raises(IntegrityError):
        async with session_factory() as s, s.begin():
            s.add(AdminUser(username="owner", password_hash="h2"))


async def test_resolved_key_carries_its_prefix(session_factory):
    async with session_factory() as s, s.begin():
        raw, _ = await mint_key(s, "lab")
    async with session_factory() as s:
        info = await resolve_key(s, raw)
    assert info.key_prefix == raw[:12]
