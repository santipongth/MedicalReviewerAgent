# Plan 23a: Admin Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin console at `/admin`. It has username/password sign-in, a dashboard, review management (search,
cancel, hide/show, delete), API key management (mint, edit, revoke) and an audit log of every change.

**Architecture:**
- **Backend:** two new tables (`admin_users`, `admin_audit`). Sessions and the sign-in lockout live in Redis.
  - `require_admin` accepts either the `mra_admin` session cookie or an admin API key.
  - Focused service modules hold the logic, and thin FastAPI routers under `/api/v1/admin` are hidden from OpenAPI.
  - Every change writes its audit row in the same transaction.
- **Frontend:** client pages under `frontend/src/app/admin/` call the admin API with relative, same-origin URLs.
  - Caddy routes `/api/*` in production.
  - `next dev` gets a dev-only rewrite.

**Tech Stack:**
- **Backend:** FastAPI, SQLAlchemy 2 async, Alembic, Redis (fakeredis in tests), argon2-cffi (new), arq.
- **Frontend:** Next.js 16 client components, Tailwind v4 tokens, the ECharts wrapper `EChart`, Vitest + Testing Library, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-10-12-plan-23a-admin-console-design.md`

**Worktree:** `D:\MRA-plan-23a` (branch `plan-23a-admin-console`). Backend commands run from `D:\MRA-plan-23a\backend`,
frontend commands from `D:\MRA-plan-23a\frontend`. The Bash tool's cwd resets between calls, so every command below
starts with `cd /d/MRA-plan-23a/...`.

## Global Constraints

- **New dependency:** exactly one, backend `argon2-cffi>=23.1`. No new frontend dependency.
- **Cookie:** `mra_admin`; `HttpOnly`; `SameSite=Strict`; `Path=/api/v1/admin`; `Max-Age` = `admin_session_ttl_seconds` (default 28,800); `Secure` when `Settings.admin_cookie_is_secure`.
- **CSRF:** `X-MRA-Admin: 1` is required on sign-in and on every cookie-authenticated `POST`/`PUT`/`PATCH`/`DELETE`. Admin-key requests are exempt.
- **Lockout:** 5 failures (`admin_login_max_failures`) per username and per IP within `admin_lockout_seconds` (900) lock that username or IP; the answer is 429 with `Retry-After`.
- **Accounts:**
  - Usernames are stored lower-case and match `^[a-z0-9._-]{3,32}$`.
  - Passwords are 12–256 characters, hashed with argon2id (`argon2.PasswordHasher` defaults).
  - The first admin comes only from `python -m app.cli.admin create`.
- **OpenAPI:** every admin route is registered with `include_in_schema=False`.
- **Audit:**
  - `before`/`after` never hold a password, hash, raw key or session token.
  - The audit row is written in the same transaction as the change.
  - Repositories never commit; services run inside `async with session.begin()`.
- **Dashboard:** days are UTC. The UI never hard-codes a limit or cap.
- **UI:**
  - Thai labels with English technical terms. DESIGN.md: 2px corners (`rounded-sm`), 1px `rule` borders, 44px targets (`min-h-11`).
  - Status blocks are a background tint plus text (`bg-err-bg`, `bg-warn-bg`, `bg-info-bg`), never a coloured left border.
  - No Martian Mono (it belongs to verified numbers only), and no browser `confirm()`/`alert()`.
- **Lint:** effects set state only inside promise callbacks, never synchronously in the effect body (`react-hooks/set-state-in-effect` is on).
- **Do not touch** `CLAUDE.md`, `frontend/CLAUDE.md` or `infra/searxng/limiter.toml.new` in the main worktree `D:\MedicalReviewerAgent`; the owner has uncommitted edits there. The root CLAUDE.md line is added after the merge (Task 14).
- **Commits:** every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

The inputs and conditions below are implied by the spec, though its own tests do not name them. Each line has a test in the task named.
1. **Username case and spaces** (Task 5): a username typed as `" Owner "` signs in to `owner`, and failures typed as `OWNER` count against `owner`, so changing case cannot get round the lockout.
2. **Bad cookie** (Task 5): a forged, empty or expired `mra_admin` cookie gets 401, never a 500.
3. **Oversized or missing sign-in field** (Task 5): a 300-character password, a missing username or a 65-character username gets 422 before any password hashing runs.
4. **Search wildcards** (Task 6): a topic search for `%` or `_` matches those characters literally, never as wildcards.
5. **Session expiry while the console is open** (Tasks 9 and 11): the next action takes the admin back to `/admin?expired=1`, where "หมดเวลาเข้าสู่ระบบ" is shown, instead of a generic error.

---

### Task 1: Settings, tables, migration and the argon2 dependency

**Files:**
- Modify: `backend/pyproject.toml`, `backend/uv.lock` (via `uv add`)
- Modify: `backend/app/config.py` (after `max_usd_per_day`)
- Modify: `backend/app/db/models.py` (append two models)
- Create: `backend/migrations/versions/e1f3a5c7b9d2_admin_users_and_audit.py`
- Modify: `backend/app/services/api_keys.py` (`ApiKeyInfo.key_prefix`)
- Test: `backend/tests/unit/test_admin_models.py`, `backend/tests/integration/test_admin_migration.py`

**Interfaces:**
- Produces:
  - `Settings.admin_session_ttl_seconds: int`, `admin_login_max_failures: int`, `admin_lockout_seconds: int`, `admin_cookie_secure: bool | None`.
  - Property `Settings.admin_cookie_is_secure -> bool`.
  - Models `AdminUser` (`id`, `username`, `password_hash`, `created_at`, `last_login_at`, `disabled_at`) and `AdminAudit` (`id`, `created_at`, `actor_kind`, `actor_id`, `actor_label`, `action`, `target_type`, `target_id`, `before`, `after`, `ip_hash`).
  - `ApiKeyInfo.key_prefix: str | None` (last field, default `None`).

- [ ] **Step 1: Add the dependency**

Run: `cd /d/MRA-plan-23a/backend && uv add "argon2-cffi>=23.1"`
Expected: `pyproject.toml` lists `argon2-cffi>=23.1` under `dependencies` and `uv.lock` is updated.

- [ ] **Step 2: Write the failing tests**

`backend/tests/unit/test_admin_models.py`:

```python
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
```

`backend/tests/integration/test_admin_migration.py`:

```python
import os

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

from app.config import get_settings

pytestmark = pytest.mark.integration

TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://mra:mra@localhost:5432/mra_test")
ADMIN_TABLES = {"admin_users", "admin_audit"}


def test_admin_migration_upgrades_and_downgrades(monkeypatch):
    engine = create_engine(TEST_DB)
    with engine.begin() as conn:  # the test database only: start from an empty schema
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    monkeypatch.setenv("DATABASE_URL", TEST_DB)
    get_settings.cache_clear()
    cfg = Config("alembic.ini")
    try:
        command.upgrade(cfg, "head")
        assert ADMIN_TABLES <= set(inspect(engine).get_table_names())
        command.downgrade(cfg, "-1")
        assert not ADMIN_TABLES & set(inspect(engine).get_table_names())
        command.upgrade(cfg, "head")
        assert ADMIN_TABLES <= set(inspect(engine).get_table_names())
    finally:
        get_settings.cache_clear()
        engine.dispose()
```

- [ ] **Step 3: Run the unit tests to verify they fail**

Run: `cd /d/MRA-plan-23a/backend && uv run pytest tests/unit/test_admin_models.py -q`
Expected: FAIL with `ImportError: cannot import name 'AdminAudit'`.

- [ ] **Step 4: Implement settings, models, `key_prefix` and the migration**

`backend/app/config.py`: insert after `max_usd_per_day: float = 10.0`:

```python
    # Admin console (Plan 23a): sessions live in Redis; the cookie is Secure when the site is https.
    admin_session_ttl_seconds: int = 28800
    admin_login_max_failures: int = 5  # per username and per IP, within admin_lockout_seconds
    admin_lockout_seconds: int = 900
    admin_cookie_secure: bool | None = None  # None: Secure exactly when public_base_url is https
```

and after the `checkpoint_conninfo` property:

```python
    @property
    def admin_cookie_is_secure(self) -> bool:
        if self.admin_cookie_secure is not None:
            return self.admin_cookie_secure
        return self.public_base_url.startswith("https://")
```

`backend/app/db/models.py`: append:

```python
class AdminUser(Base):
    """An admin console account (Plan 23a). Created only by `python -m app.cli.admin create`."""

    __tablename__ = "admin_users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(32), unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AdminAudit(Base):
    """Who changed what, before and after, and when. Never edited or deleted by the application."""

    __tablename__ = "admin_audit"

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    actor_kind: Mapped[str] = mapped_column(String(8))  # user | key | cli
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    actor_label: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(48))
    target_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    target_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)
    ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
```

`backend/app/services/api_keys.py`: add the last field of `ApiKeyInfo` and fill it in `resolve_key`:

```python
@dataclass(frozen=True)
class ApiKeyInfo:
    id: uuid.UUID
    name: str
    daily_quota: int
    is_admin: bool
    key_hash: str
    key_prefix: str | None = None  # labels admin actions taken with this key (Plan 23a)
```

```python
    return ApiKeyInfo(id=row.id, name=row.name, daily_quota=row.daily_quota, is_admin=bool(row.is_admin),
                      key_hash=row.key_hash, key_prefix=row.key_prefix)
```

`backend/migrations/versions/e1f3a5c7b9d2_admin_users_and_audit.py`:

```python
"""admin users and audit log (Plan 23a)

Revision ID: e1f3a5c7b9d2
Revises: d4a8e2f61c37
Create Date: 2026-10-12 12:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "e1f3a5c7b9d2"
down_revision: Union[str, None] = "d4a8e2f61c37"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")


def upgrade() -> None:
    op.create_table(
        "admin_users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("username", sa.String(length=32), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_login_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("username"),
    )
    op.create_table(
        "admin_audit",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("actor_kind", sa.String(length=8), nullable=False),
        sa.Column("actor_id", sa.Uuid(), nullable=True),
        sa.Column("actor_label", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=48), nullable=False),
        sa.Column("target_type", sa.String(length=16), nullable=True),
        sa.Column("target_id", sa.String(length=64), nullable=True),
        sa.Column("before", JSON, nullable=True),
        sa.Column("after", JSON, nullable=True),
        sa.Column("ip_hash", sa.String(length=64), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_admin_audit_created_at", "admin_audit", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_admin_audit_created_at", table_name="admin_audit")
    op.drop_table("admin_audit")
    op.drop_table("admin_users")
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /d/MRA-plan-23a/backend && uv run pytest tests/unit/test_admin_models.py tests/unit/test_api_keys.py -q`
Expected: PASS.

Run the migration test against the running Postgres:
`docker compose -f /d/MedicalReviewerAgent/docker-compose.yml exec -T postgres psql -U mra -d postgres -c "CREATE DATABASE mra_test" || true`
`cd /d/MRA-plan-23a/backend && MRA_INTEGRATION=1 uv run pytest tests/integration/test_admin_migration.py -q`
Expected: PASS. If Postgres is not on `localhost:5432` from the host, write down that the migration test was not run
and why; never mark it passed.

- [ ] **Step 6: Lint and commit**

```bash
cd /d/MRA-plan-23a/backend && uv run ruff check app tests migrations
cd /d/MRA-plan-23a && git add backend/pyproject.toml backend/uv.lock backend/app/config.py backend/app/db/models.py \
  backend/app/services/api_keys.py backend/migrations/versions/e1f3a5c7b9d2_admin_users_and_audit.py \
  backend/tests/unit/test_admin_models.py backend/tests/integration/test_admin_migration.py
git commit -m "feat(admin): admin_users and admin_audit tables, admin settings, argon2-cffi (Plan 23a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Accounts, password hashing and the audit log

**Files:**
- Create: `backend/app/services/admin_auth.py`
- Create: `backend/app/services/audit.py`
- Modify: `backend/tests/conftest.py` (autouse cheap hasher)
- Test: `backend/tests/unit/test_admin_accounts.py`

**Interfaces:**
- Consumes: `AdminUser`, `AdminAudit` (Task 1).
- Produces (`app.services.admin_auth`):
  - Constants `USERNAME_RE`, `PASSWORD_MIN = 12`, `PASSWORD_MAX = 256`, `HASHER: PasswordHasher`; `class AdminAuthError(ValueError)`.
  - `@dataclass(frozen=True) AdminPrincipal(kind: Literal["user","key","cli"], id: uuid.UUID | None, label: str)` and `CLI_ACTOR`.
  - `normalize_username(raw: str) -> str`, `check_username(raw: str) -> str`, `check_password(password: str) -> str`.
  - `async hash_password(password: str) -> str` and `async verify_password(stored: str | None, password: str) -> tuple[bool, str | None]`.
  - `async find_user(session, username) -> AdminUser | None`, `async create_user(session, username, password) -> AdminUser`.
  - `async set_password(session, username, password) -> AdminUser`, `async set_disabled(session, username, disabled: bool) -> AdminUser`, `async list_users(session) -> list[AdminUser]`.
- Produces (`app.services.audit`):
  - `SECRET_FIELDS`.
  - `async record(session, actor: AdminPrincipal, action: str, *, target_type=None, target_id=None, before=None, after=None, ip_hash=None) -> AdminAudit`.
  - `async list_audit(session, *, before: int | None = None, limit: int = 50) -> tuple[list[AdminAudit], int | None]`.
  - `audit_out(row) -> dict`.

- [ ] **Step 1: Make password hashing cheap in every unit test**

Append to `backend/tests/conftest.py`:

```python
@pytest.fixture(autouse=True)
def fast_password_hashing(monkeypatch):
    """argon2's defaults cost tens of milliseconds per hash; unit tests use the cheapest valid parameters."""
    from argon2 import PasswordHasher

    from app.services import admin_auth

    monkeypatch.setattr(admin_auth, "HASHER", PasswordHasher(time_cost=1, memory_cost=8, parallelism=1))
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/unit/test_admin_accounts.py`:

```python
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23a/backend && uv run pytest tests/unit/test_admin_accounts.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.admin_auth'` (the conftest fixture fails the same way).

- [ ] **Step 4: Implement `admin_auth.py`**

```python
"""Admin console accounts (Plan 23a): username rules, argon2id password hashing and the account queries.
Hashing runs in a worker thread so a sign-in never blocks the event loop."""
from __future__ import annotations

import asyncio
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AdminUser

USERNAME_RE = re.compile(r"[a-z0-9._-]{3,32}")
PASSWORD_MIN, PASSWORD_MAX = 12, 256
HASHER = PasswordHasher()  # argon2id with the library defaults; unit tests swap in a cheaper one
_DUMMY_PASSWORD = "not a real password, only for timing"
_dummy_hash: str | None = None


class AdminAuthError(ValueError):
    """A username or password that breaks the rules, or a missing account. The message is safe to show."""


@dataclass(frozen=True)
class AdminPrincipal:
    """Who is acting in the admin console: a signed-in user, an admin API key, or the CLI."""

    kind: Literal["user", "key", "cli"]
    id: uuid.UUID | None
    label: str


CLI_ACTOR = AdminPrincipal(kind="cli", id=None, label="cli")


def normalize_username(raw: str) -> str:
    return raw.strip().lower()


def check_username(raw: str) -> str:
    name = normalize_username(raw)
    if not USERNAME_RE.fullmatch(name):
        raise AdminAuthError("username must be 3-32 characters of a-z, 0-9, '.', '_' or '-'")
    return name


def check_password(password: str) -> str:
    if not PASSWORD_MIN <= len(password) <= PASSWORD_MAX:
        raise AdminAuthError(f"password must be {PASSWORD_MIN}-{PASSWORD_MAX} characters")
    return password


async def hash_password(password: str) -> str:
    return await asyncio.to_thread(HASHER.hash, password)


async def verify_password(stored: str | None, password: str) -> tuple[bool, str | None]:
    """(ok, new hash or None). With no stored hash (unknown or disabled user) the password is checked against a dummy
    hash, so the answer takes as long as a wrong password and never succeeds. A new hash is returned when the stored
    one was made with older parameters."""
    global _dummy_hash
    known = stored is not None
    if stored is None:
        if _dummy_hash is None:
            _dummy_hash = await hash_password(_DUMMY_PASSWORD)
        stored = _dummy_hash
    hasher = HASHER

    def check() -> tuple[bool, str | None]:
        try:
            hasher.verify(stored, password)
        except (VerificationError, InvalidHashError):
            return False, None
        return True, hasher.hash(password) if hasher.check_needs_rehash(stored) else None

    ok, new_hash = await asyncio.to_thread(check)
    return (ok, new_hash) if known else (False, None)


async def find_user(session: AsyncSession, username: str) -> AdminUser | None:
    stmt = select(AdminUser).where(AdminUser.username == normalize_username(username))
    return (await session.execute(stmt)).scalar_one_or_none()


async def _existing(session: AsyncSession, username: str) -> AdminUser:
    user = await find_user(session, username)
    if user is None:
        raise AdminAuthError(f"no admin named {normalize_username(username)}")
    return user


async def create_user(session: AsyncSession, username: str, password: str) -> AdminUser:
    name = check_username(username)
    check_password(password)
    if await find_user(session, name) is not None:
        raise AdminAuthError(f"admin {name} already exists")
    user = AdminUser(username=name, password_hash=await hash_password(password), created_at=datetime.now(UTC))
    session.add(user)
    await session.flush()
    return user


async def set_password(session: AsyncSession, username: str, password: str) -> AdminUser:
    check_password(password)
    user = await _existing(session, username)
    user.password_hash = await hash_password(password)
    await session.flush()
    return user


async def set_disabled(session: AsyncSession, username: str, disabled: bool) -> AdminUser:
    user = await _existing(session, username)
    user.disabled_at = datetime.now(UTC) if disabled else None
    await session.flush()
    return user


async def list_users(session: AsyncSession) -> list[AdminUser]:
    return list((await session.execute(select(AdminUser).order_by(AdminUser.username))).scalars())
```

- [ ] **Step 5: Implement `audit.py`**

```python
"""The admin audit log (Plan 23a): who changed what, before and after, and when. Callers write the row inside the
transaction that makes the change; secrets are dropped before anything is stored."""
from __future__ import annotations

import uuid
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AdminAudit
from app.services.admin_auth import AdminPrincipal

SECRET_FIELDS = frozenset({"password", "password_hash", "key", "key_hash", "raw_key", "token"})


def _jsonable(value: Any) -> Any:
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


def _scrub(state: dict[str, Any] | None) -> dict[str, Any] | None:
    if state is None:
        return None
    return {k: _jsonable(v) for k, v in state.items() if k not in SECRET_FIELDS}


async def record(session: AsyncSession, actor: AdminPrincipal, action: str, *, target_type: str | None = None,
                 target_id: Any = None, before: dict[str, Any] | None = None, after: dict[str, Any] | None = None,
                 ip_hash: str | None = None) -> AdminAudit:
    row = AdminAudit(created_at=datetime.now(UTC), actor_kind=actor.kind, actor_id=actor.id,
                     actor_label=actor.label[:64], action=action, target_type=target_type,
                     target_id=None if target_id is None else str(target_id)[:64],
                     before=_scrub(before), after=_scrub(after), ip_hash=ip_hash)
    session.add(row)
    await session.flush()
    return row


async def list_audit(session: AsyncSession, *, before: int | None = None,
                     limit: int = 50) -> tuple[list[AdminAudit], int | None]:
    """Newest first. The cursor is the last row's id; None on the last page."""
    stmt = select(AdminAudit).order_by(AdminAudit.id.desc()).limit(limit + 1)
    if before is not None:
        stmt = stmt.where(AdminAudit.id < before)
    rows = list((await session.execute(stmt)).scalars())
    cursor = rows[limit - 1].id if len(rows) > limit else None
    return rows[:limit], cursor


def audit_out(row: AdminAudit) -> dict[str, Any]:
    return {"id": row.id, "created_at": row.created_at, "actor_kind": row.actor_kind, "actor_label": row.actor_label,
            "action": row.action, "target_type": row.target_type, "target_id": row.target_id,
            "before": row.before, "after": row.after}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd /d/MRA-plan-23a/backend && uv run pytest tests/unit/test_admin_accounts.py tests/unit/test_admin_models.py -q`
Expected: PASS.

- [ ] **Step 7: Lint and commit**

```bash
cd /d/MRA-plan-23a/backend && uv run ruff check app tests
cd /d/MRA-plan-23a && git add backend/app/services/admin_auth.py backend/app/services/audit.py \
  backend/tests/conftest.py backend/tests/unit/test_admin_accounts.py
git commit -m "feat(admin): accounts with argon2id passwords and the audit log (Plan 23a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Sessions and the sign-in lockout (Redis)

**Files:**
- Create: `backend/app/services/admin_sessions.py`
- Test: `backend/tests/unit/test_admin_sessions.py`

**Interfaces:**
- Produces:
  - `AdminSessions(redis, ttl_seconds: int = 28800)` with `async create(user_id: uuid.UUID, username: str) -> str` (the raw token), `async load(token: str) -> dict | None` (`{"user_id": str, "username": str, "created_at": str}`), `async end(token: str) -> None` and `async end_all(user_id: uuid.UUID) -> int`.
  - `LoginThrottle(redis, max_failures: int, lockout_seconds: int)` with `async locked_for(username: str, ip_hash: str) -> int | None` (seconds left), `async fail(username: str, ip_hash: str) -> bool` (True when this failure locked it) and `async clear_user(username: str) -> None`.
  - Redis keys: `mra:admin:session:<sha256(token)>`, `mra:admin:user:<id>:sessions`, `mra:admin:fail:u:<username>`, `mra:admin:fail:ip:<ip_hash>`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_admin_sessions.py`:

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23a/backend && uv run pytest tests/unit/test_admin_sessions.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.admin_sessions'`.

- [ ] **Step 3: Implement `admin_sessions.py`**

```python
"""Admin sign-in state in Redis (Plan 23a), shared by every API process: opaque session tokens and the
failed-sign-in lockout. Redis holds only the SHA-256 of a token, so a Redis dump cannot be replayed as a cookie."""
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


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class AdminSessions:
    def __init__(self, redis, ttl_seconds: int = 28800) -> None:
        self.redis = redis
        self.ttl = ttl_seconds

    async def create(self, user_id: uuid.UUID, username: str) -> str:
        token = secrets.token_urlsafe(32)
        digest = _digest(token)
        data = json.dumps({"user_id": str(user_id), "username": username,
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
    """Failed sign-ins counted per username and per IP. When either count reaches max_failures, that username or that
    address is locked until its counter expires (lockout_seconds after the first failure)."""

    def __init__(self, redis, max_failures: int, lockout_seconds: int) -> None:
        self.redis = redis
        self.max_failures = max_failures
        self.lockout = lockout_seconds

    def _keys(self, username: str, ip_hash: str) -> tuple[str, str]:
        return FAIL_USER_KEY.format(username), FAIL_IP_KEY.format(ip_hash)

    async def locked_for(self, username: str, ip_hash: str) -> int | None:
        for key in self._keys(username, ip_hash):
            count = await self.redis.get(key)
            if count is not None and int(count) >= self.max_failures:
                return max(int(await self.redis.ttl(key)), 1)
        return None

    async def fail(self, username: str, ip_hash: str) -> bool:
        locked = False
        for key in self._keys(username, ip_hash):
            count = int(await self.redis.incr(key))
            if await self.redis.ttl(key) < 0:  # new counter, or one that lost its expiry
                await self.redis.expire(key, self.lockout)
            locked = locked or count == self.max_failures
        return locked

    async def clear_user(self, username: str) -> None:
        await self.redis.delete(FAIL_USER_KEY.format(username))
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /d/MRA-plan-23a/backend && uv run pytest tests/unit/test_admin_sessions.py -q`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
cd /d/MRA-plan-23a/backend && uv run ruff check app tests
cd /d/MRA-plan-23a && git add backend/app/services/admin_sessions.py backend/tests/unit/test_admin_sessions.py
git commit -m "feat(admin): Redis sessions with hashed tokens and the sign-in lockout (Plan 23a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The `app.cli.admin` command

**Files:**
- Create: `backend/app/cli/admin.py`
- Test: `backend/tests/unit/test_admin_cli.py`

**Interfaces:**
- Consumes: `create_user`, `set_password`, `set_disabled`, `find_user`, `list_users`, `AdminAuthError`, `CLI_ACTOR` (Task 2); `record` (Task 2); `AdminSessions.end_all` (Task 3).
- Produces: `async run(argv: list[str], session_factory, redis, *, read_password=getpass.getpass, stdin=None) -> int`
  (0 on success, 1 on a refused change); `main()`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_admin_cli.py`:

```python
import io

from sqlalchemy import select

from app.cli.admin import run as admin_cli
from app.db.models import AdminAudit
from app.services.admin_auth import find_user, verify_password
from app.services.admin_sessions import AdminSessions

PW = "correct horse battery staple"


def prompts(*answers):
    it = iter(answers)
    return lambda prompt: next(it)


def stdin(text: str):
    return io.StringIO(text + "\n")


async def actions(session_factory):
    async with session_factory() as s:
        rows = (await s.execute(select(AdminAudit).order_by(AdminAudit.id))).scalars()
        return [(r.actor_kind, r.action) for r in rows]


async def test_create_from_prompt_and_from_stdin(session_factory, redis, capsys):
    assert await admin_cli(["create", "--username", "Owner"], session_factory, redis,
                           read_password=prompts(PW, PW)) == 0
    assert await admin_cli(["create", "--username", "second", "--password-stdin"], session_factory, redis,
                           stdin=stdin(PW)) == 0
    async with session_factory() as s:
        assert (await verify_password((await find_user(s, "owner")).password_hash, PW))[0]
        assert (await verify_password((await find_user(s, "second")).password_hash, PW))[0]
    assert await actions(session_factory) == [("cli", "admin.create"), ("cli", "admin.create")]
    out = capsys.readouterr().out
    assert "owner" in out and PW not in out


async def test_create_refuses_mismatch_short_and_duplicate(session_factory, redis, capsys):
    assert await admin_cli(["create", "--username", "owner"], session_factory, redis,
                           read_password=prompts(PW, PW + "x")) == 1
    assert await admin_cli(["create", "--username", "owner", "--password-stdin"], session_factory, redis,
                           stdin=stdin("short")) == 1
    assert await admin_cli(["create", "--username", "owner", "--password-stdin"], session_factory, redis,
                           stdin=stdin(PW)) == 0
    assert await admin_cli(["create", "--username", "owner", "--password-stdin"], session_factory, redis,
                           stdin=stdin(PW)) == 1
    err = capsys.readouterr().err
    assert "do not match" in err and "12-256" in err and "already exists" in err
    assert await actions(session_factory) == [("cli", "admin.create")]  # refused changes leave no audit row


async def test_passwd_and_disable_end_sessions(session_factory, redis, capsys):
    await admin_cli(["create", "--username", "owner", "--password-stdin"], session_factory, redis, stdin=stdin(PW))
    async with session_factory() as s:
        uid = (await find_user(s, "owner")).id
    sessions = AdminSessions(redis)
    token = await sessions.create(uid, "owner")
    assert await admin_cli(["passwd", "owner", "--password-stdin"], session_factory, redis,
                           stdin=stdin("a brand new password")) == 0
    assert await sessions.load(token) is None
    token = await sessions.create(uid, "owner")
    assert await admin_cli(["disable", "owner"], session_factory, redis) == 0
    assert await sessions.load(token) is None
    assert await admin_cli(["enable", "owner"], session_factory, redis) == 0
    assert await admin_cli(["passwd", "nobody", "--password-stdin"], session_factory, redis,
                           stdin=stdin("a brand new password")) == 1
    assert await admin_cli(["list"], session_factory, redis) == 0
    out = capsys.readouterr().out
    assert "owner" in out and "active" in out and "ended 1 session" in out
    assert [a for _, a in await actions(session_factory)] == [
        "admin.create", "admin.passwd", "admin.disable", "admin.enable"]
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23a/backend && uv run pytest tests/unit/test_admin_cli.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.cli.admin'`.

- [ ] **Step 3: Implement `app/cli/admin.py`**

```python
"""Manage admin console accounts (Plan 23a). There is no sign-up page: the first admin is created here.

    python -m app.cli.admin create --username NAME [--password-stdin]
    python -m app.cli.admin passwd NAME [--password-stdin]      # ends every session of NAME
    python -m app.cli.admin disable NAME                        # ends every session of NAME
    python -m app.cli.admin enable NAME
    python -m app.cli.admin list
"""
from __future__ import annotations

import argparse
import getpass
import sys

from app.services.admin_auth import (
    CLI_ACTOR,
    AdminAuthError,
    create_user,
    find_user,
    list_users,
    set_disabled,
    set_password,
)
from app.services.admin_sessions import AdminSessions
from app.services.audit import record


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m app.cli.admin")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create", help="create an admin (password asked twice, or one line on stdin)")
    c.add_argument("--username", required=True)
    c.add_argument("--password-stdin", action="store_true")
    w = sub.add_parser("passwd", help="set a new password and end the admin's sessions")
    w.add_argument("username")
    w.add_argument("--password-stdin", action="store_true")
    for name, text in (("disable", "disable an admin and end their sessions"), ("enable", "enable an admin")):
        sub.add_parser(name, help=text).add_argument("username")
    sub.add_parser("list", help="list admins")
    return p


def _read_password(args, read_password, stdin) -> str:
    if args.password_stdin:
        return stdin.readline().rstrip("\r\n")
    first = read_password("Password: ")
    if read_password("Repeat password: ") != first:
        raise AdminAuthError("passwords do not match")
    return first


async def run(argv: list[str], session_factory, redis, *, read_password=getpass.getpass, stdin=None) -> int:
    args = _parser().parse_args(argv)
    if args.cmd == "list":
        async with session_factory() as session:
            for u in await list_users(session):
                last = u.last_login_at.isoformat(timespec="minutes") if u.last_login_at else "never"
                state = "disabled" if u.disabled_at else "active"
                print(f"{u.username}  created={u.created_at:%Y-%m-%d}  last_login={last}  {state}")
        return 0
    try:
        password = _read_password(args, read_password, stdin or sys.stdin) if args.cmd in ("create", "passwd") else None
        async with session_factory() as session, session.begin():
            if args.cmd == "create":
                user = await create_user(session, args.username, password)
                await record(session, CLI_ACTOR, "admin.create", target_type="admin", target_id=user.id,
                             after={"username": user.username})
            elif args.cmd == "passwd":
                user = await set_password(session, args.username, password)
                await record(session, CLI_ACTOR, "admin.passwd", target_type="admin", target_id=user.id)
            else:
                existing = await find_user(session, args.username)
                was_disabled = existing is not None and existing.disabled_at is not None
                disabled = args.cmd == "disable"
                user = await set_disabled(session, args.username, disabled)
                await record(session, CLI_ACTOR, f"admin.{args.cmd}", target_type="admin", target_id=user.id,
                             before={"disabled": was_disabled}, after={"disabled": disabled})
            user_id, username = user.id, user.username
    except AdminAuthError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    note = ""
    if args.cmd in ("passwd", "disable"):
        note = f" (ended {await AdminSessions(redis).end_all(user_id)} session(s))"
    print(f"{args.cmd}: {username}{note}")
    return 0


def main() -> None:
    from redis.asyncio import Redis

    from app.compat import run_async
    from app.config import get_settings
    from app.db.session import make_engine, make_session_factory

    settings = get_settings()
    engine = make_engine(settings.database_url)
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    try:
        code = run_async(run(sys.argv[1:], make_session_factory(engine), redis))
    finally:
        run_async(redis.aclose())
        run_async(engine.dispose())
    sys.exit(code)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd /d/MRA-plan-23a/backend && uv run pytest tests/unit/test_admin_cli.py -q`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
cd /d/MRA-plan-23a/backend && uv run ruff check app tests
cd /d/MRA-plan-23a && git add backend/app/cli/admin.py backend/tests/unit/test_admin_cli.py
git commit -m "feat(admin): python -m app.cli.admin create|passwd|disable|enable|list (Plan 23a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Sign-in, sign-out, `require_admin` with cookie or key, and admin routes hidden from OpenAPI

**Files:**
- Modify: `backend/app/services/review_service.py` (`Identity.admin`, `Identity.is_admin`, `cancel(..., audit=None)`)
- Modify: `backend/app/api/auth.py` (cookie constants, `require_csrf_header`, `admin_sessions`, `ip_hash_of`, `require_admin`)
- Modify: `backend/app/api/admin.py` (session routes, `/me`)
- Modify: `backend/app/main.py` (`include_in_schema=False` for the admin router)
- Create: `backend/tests/admin_helpers.py`
- Test: `backend/tests/unit/test_admin_api_auth.py`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `Identity(ip, api_key=None, admin: AdminPrincipal | None = None)` with `Identity.is_admin -> bool`.
  - `ReviewService.cancel(review_id, *, identity, audit=None)`: `audit` is `async (session, review) -> None`, run inside the cancel transaction only when the status changed.
  - In `app.api.auth`: `ADMIN_COOKIE = "mra_admin"`, `ADMIN_COOKIE_PATH = "/api/v1/admin"`, `CSRF_HEADER = "x-mra-admin"`, `require_csrf_header(request)`, `admin_sessions(deps) -> AdminSessions`, `ip_hash_of(identity, deps) -> str`, `require_admin(request, deps) -> Identity` (with `.admin` set).
  - Routes `POST /api/v1/admin/session`, `DELETE /api/v1/admin/session`, `GET /api/v1/admin/me` → `{kind, label}`.
  - In `tests/admin_helpers.py`: `PASSWORD`, `CSRF`, `create_admin`, `cookie_of`, `sign_in`, `admin_headers`.

- [ ] **Step 1: Write the test helpers**

`backend/tests/admin_helpers.py`:

```python
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
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/unit/test_admin_api_auth.py`:

```python
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23a/backend && uv run pytest tests/unit/test_admin_api_auth.py -q`
Expected: FAIL (404 on `/api/v1/admin/session`, and the OpenAPI test finds `/api/v1/admin/mcp/reload`).

- [ ] **Step 4: Extend `Identity` and `ReviewService.cancel`**

In `backend/app/services/review_service.py`, add the import `from app.services.admin_auth import AdminPrincipal`, then:

```python
@dataclass(frozen=True)
class Identity:
    ip: str
    api_key: ApiKeyInfo | None = None
    admin: AdminPrincipal | None = None  # set by require_admin: a signed-in admin or an admin API key (Plan 23a)

    @property
    def rate_key(self) -> str:
        return f"key:{self.api_key.id}" if self.api_key else f"ip:{self.ip}"

    @property
    def is_admin(self) -> bool:
        return self.admin is not None or bool(self.api_key and self.api_key.is_admin)
```

Replace the start of `cancel` and its transaction:

```python
    async def cancel(self, review_id: uuid.UUID, *, identity: Identity, audit=None) -> str:
        """Owner key, admin key or signed-in admin cancels a queued/running review; the worker job is aborted.
        `audit(session, review)` (admin console) runs inside the cancel's transaction, only when it changed the status."""
        key = identity.api_key
        if key is None and not identity.is_admin:
            raise Forbidden("an API key is required")
        review = await self.get(review_id)
        if review is None:
            raise NotFound("review not found")
        owner = key is not None and review.api_key_id == key.id
        if not owner and not identity.is_admin:
            raise Forbidden("only the API key that created this review (or an admin key) can cancel it")
        by = "owner" if owner else "admin"  # key names stay private
        async with self.session_factory() as session, session.begin():
            changed = await ReviewRepository(session).update_unless(
                review_id, TERMINAL_STATUSES, status="cancelled", finished_at=datetime.now(UTC),
                error=f"cancelled by the {by}")
            if changed and audit is not None:
                await audit(session, review)
        if not changed:
            raise Conflict(f"review is already {review.status}")
```

(The rest of `cancel`, from `await self.event_sink.emit(...)` on, is unchanged.)

- [ ] **Step 5: Rewrite `require_admin` in `backend/app/api/auth.py`**

Replace the old `require_admin` with the code below and add these imports:
`import uuid`, `from dataclasses import replace`, `from app.db.models import AdminUser`,
`from app.schemas.review import hash_ip`, `from app.services.admin_auth import AdminPrincipal`,
`from app.services.admin_sessions import AdminSessions`.

```python
ADMIN_COOKIE = "mra_admin"
ADMIN_COOKIE_PATH = "/api/v1/admin"
CSRF_HEADER = "x-mra-admin"
WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def require_csrf_header(request: Request) -> None:
    """Cookie-authenticated writes (and sign-in) must carry X-MRA-Admin: 1, which a cross-site form cannot send."""
    if request.headers.get(CSRF_HEADER) != "1":
        raise HTTPException(status_code=403, detail="the X-MRA-Admin: 1 header is required")


def admin_sessions(deps: AppDeps) -> AdminSessions:
    return AdminSessions(deps.redis, deps.service.settings.admin_session_ttl_seconds)


def ip_hash_of(identity: Identity, deps: AppDeps) -> str:
    return hash_ip(identity.ip, deps.service.settings.ip_hash_salt)


async def admin_from_cookie(request: Request, deps: AppDeps) -> AdminPrincipal:
    unauthorized = HTTPException(status_code=401, detail="sign in required")
    token = request.cookies.get(ADMIN_COOKIE, "")
    sessions = admin_sessions(deps)
    data = await sessions.load(token)
    if data is None:
        raise unauthorized
    async with deps.session_factory() as session:
        user = await session.get(AdminUser, uuid.UUID(data["user_id"]))
    if user is None or user.disabled_at is not None:
        await sessions.end(token)
        raise unauthorized
    return AdminPrincipal(kind="user", id=user.id, label=user.username)


async def require_admin(request: Request, deps: AppDeps = Depends(get_deps)) -> Identity:
    """An admin API key (scripts, as before) or the admin console's session cookie. A presented key decides on its
    own: an invalid key is 401 and a non-admin key 403, never a fallback to the cookie."""
    ip = client_ip(request)
    if presented_key(request.headers) is not None:
        identity = await identity_from(request.headers, ip, deps)
        key = identity.api_key
        if not key.is_admin:
            raise HTTPException(status_code=403, detail="an admin API key is required")
        return replace(identity, admin=AdminPrincipal(kind="key", id=key.id, label=key.key_prefix or key.name[:12]))
    principal = await admin_from_cookie(request, deps)
    if request.method in WRITE_METHODS:
        require_csrf_header(request)
    return Identity(ip=ip, admin=principal)
```

- [ ] **Step 6: Add the session routes to `backend/app/api/admin.py`**

Add imports:
`from datetime import UTC, datetime`, `from fastapi import Request, Response`, `from fastapi.responses import JSONResponse`,
`from pydantic import BaseModel, Field`, `from app.api.auth import ADMIN_COOKIE, ADMIN_COOKIE_PATH, admin_sessions, ip_hash_of, require_csrf_header`,
`from app.api.ratelimit import client_ip`, `from app.schemas.review import hash_ip`,
`from app.services.admin_auth import PASSWORD_MAX, AdminPrincipal, find_user, normalize_username, verify_password`,
`from app.services.admin_sessions import LoginThrottle`, `from app.services.audit import record`.

Then add:

```python
class SignIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=PASSWORD_MAX)


@router.post("/admin/session", status_code=204)
async def sign_in(body: SignIn, request: Request, deps: AppDeps = Depends(get_deps)) -> Response:
    """Sign in to the admin console: sets the mra_admin session cookie. Five failures lock the username and the
    address for admin_lockout_seconds."""
    require_csrf_header(request)
    settings = deps.service.settings
    username = normalize_username(body.username)
    ip_hash = hash_ip(client_ip(request), settings.ip_hash_salt)
    throttle = LoginThrottle(deps.redis, settings.admin_login_max_failures, settings.admin_lockout_seconds)
    wait = await throttle.locked_for(username, ip_hash)
    if wait is not None:
        return JSONResponse(status_code=429, content={"detail": "too many failed sign-ins; try again later"},
                            headers={"Retry-After": str(wait)})
    signed_in: AdminPrincipal | None = None
    async with deps.session_factory() as session, session.begin():
        user = await find_user(session, username)
        known_id = user.id if user is not None else None
        active = user is not None and user.disabled_at is None
        ok, new_hash = await verify_password(user.password_hash if active else None, body.password)
        if ok:
            if new_hash:
                user.password_hash = new_hash
            user.last_login_at = datetime.now(UTC)
            signed_in = AdminPrincipal(kind="user", id=user.id, label=user.username)
            await record(session, signed_in, "admin.login", target_type="admin", target_id=user.id, ip_hash=ip_hash)
    if signed_in is None:
        if await throttle.fail(username, ip_hash):
            async with deps.session_factory() as session, session.begin():
                await record(session, AdminPrincipal(kind="user", id=known_id, label=username[:64]), "admin.lockout",
                             target_type="admin", target_id=username, ip_hash=ip_hash)
        raise HTTPException(status_code=401, detail="invalid username or password")
    await throttle.clear_user(username)
    token = await admin_sessions(deps).create(signed_in.id, signed_in.label)
    response = Response(status_code=204)
    response.set_cookie(ADMIN_COOKIE, token, max_age=settings.admin_session_ttl_seconds, path=ADMIN_COOKIE_PATH,
                        httponly=True, samesite="strict", secure=settings.admin_cookie_is_secure)
    return response


@router.delete("/admin/session", status_code=204)
async def sign_out(request: Request, deps: AppDeps = Depends(get_deps),
                   identity: Identity = Depends(require_admin)) -> Response:
    if identity.admin.kind == "user":
        await admin_sessions(deps).end(request.cookies.get(ADMIN_COOKIE, ""))
        async with deps.session_factory() as session, session.begin():
            await record(session, identity.admin, "admin.logout", target_type="admin", target_id=identity.admin.id,
                         ip_hash=ip_hash_of(identity, deps))
    response = Response(status_code=204)
    response.delete_cookie(ADMIN_COOKIE, path=ADMIN_COOKIE_PATH, httponly=True, samesite="strict",
                           secure=deps.service.settings.admin_cookie_is_secure)
    return response


@router.get("/admin/me")
async def me(identity: Identity = Depends(require_admin)) -> dict:
    return {"kind": identity.admin.kind, "label": identity.admin.label}
```

In the existing `reload_mcp_servers`, update the `responses` and docstring: 401 is now "sign in or an admin API key
required", and signed-in admins may call it too. `Depends(require_admin)` already covers both.

- [ ] **Step 7: Hide the admin router from OpenAPI**

In `backend/app/main.py`, replace
`app.include_router(admin.router, prefix="/api/v1", tags=["admin"])` with:

```python
    # Admin console routes (Plan 23a) are documented in docs/api.md, not in the public OpenAPI.
    app.include_router(admin.router, prefix="/api/v1", tags=["admin"], include_in_schema=False)
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `cd /d/MRA-plan-23a/backend && uv run pytest tests/unit/test_admin_api_auth.py tests/unit/test_api_keys.py tests/unit/test_cancel.py -q`
Expected: PASS. In `test_api_keys.py::test_require_admin`, the 401 for no credentials still holds.

- [ ] **Step 9: Full backend run, lint and commit**

Run: `cd /d/MRA-plan-23a/backend && uv run pytest -q -p no:randomly && uv run ruff check .`
Expected: all pass. `tests/unit/test_capacity.py::test_queue_position` is a known flaky test. If it fails, rerun it
alone and report the result; do not change it.

```bash
cd /d/MRA-plan-23a && git add backend/app/services/review_service.py backend/app/api/auth.py backend/app/api/admin.py \
  backend/app/main.py backend/tests/admin_helpers.py backend/tests/unit/test_admin_api_auth.py
git commit -m "feat(admin): sign-in with lockout, session cookie or admin key in require_admin, routes hidden from OpenAPI (Plan 23a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Review management (search, cancel, hide/show, delete) and checkpoint cleanup

**Files:**
- Create: `backend/app/services/admin_reviews.py`
- Create: `backend/app/api/admin_reviews.py`
- Modify: `backend/app/services/queue.py` (`enqueue_checkpoint_delete`)
- Modify: `backend/app/worker/tasks.py` (`delete_checkpoint`), `backend/app/worker/settings.py` (register it)
- Modify: `backend/app/main.py` (include the router, hidden)
- Modify: `backend/tests/conftest.py` (`FakeJobQueue.enqueue_checkpoint_delete`)
- Test: `backend/tests/unit/test_admin_reviews.py`

**Interfaces:**
- Consumes:
  - `require_admin`, `ip_hash_of` (Task 5).
  - `record` (Task 2).
  - `ReviewService.cancel(..., audit=)` (Task 5).
  - `service_error_response` from `app.api.reviews`.
  - `NotFound` and `Conflict` from `app.services.review_service`.
- Produces:
  - `STATUSES`, `TOPIC_PREVIEW = 200`.
  - `encode_cursor(created_at, review_id) -> str` and `decode_cursor(cursor) -> tuple[datetime, uuid.UUID]` (`ValueError` on garbage).
  - `async list_reviews(session, *, q=None, status=None, listed=None, before=None, limit=50) -> tuple[list[dict], str | None]`.
  - `async set_listed(session, actor, review_id, listed, *, ip_hash) -> dict`.
  - `async delete_review(session, actor, review_id, *, ip_hash) -> None`.
  - `async forget_review(redis, queue, review_id) -> None`.
  - Worker job `delete_checkpoint(ctx, review_id: str) -> dict`.
  - `ArqJobQueue.enqueue_checkpoint_delete(review_id) -> bool`.
  - Routes `GET /admin/reviews`, `POST /admin/reviews/{id}/cancel`, `PATCH /admin/reviews/{id}` and `DELETE /admin/reviews/{id}`.

- [ ] **Step 1: Give the fake queue the new method**

In `backend/tests/conftest.py`, extend `FakeJobQueue`:

```python
class FakeJobQueue:
    def __init__(self) -> None:
        self.enqueued: list[str] = []
        self.aborted: list[str] = []
        self.checkpoint_deletes: list[str] = []

    ...

    async def enqueue_checkpoint_delete(self, review_id) -> bool:
        self.checkpoint_deletes.append(str(review_id))
        return True
```

- [ ] **Step 2: Write the failing tests**

`backend/tests/unit/test_admin_reviews.py`:

```python
import uuid
from datetime import UTC, datetime, timedelta
from typing import TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from sqlalchemy import func, select

from app.db.models import AdminAudit, Paper, Review, ReviewEvent, ReviewPaper
from app.db.repositories import EventRepository, ReviewRepository
from app.services.api_keys import mint_key
from app.services.events import stream_key
from app.worker.tasks import delete_checkpoint
from tests.admin_helpers import admin_headers

BASE = "/api/v1/admin/reviews"
T0 = datetime(2026, 10, 12, 8, 0, tzinfo=UTC)


async def make_review(session_factory, topic, status="done", *, created_at=None, listed=True, key_id=None,
                      options=None):
    async with session_factory() as s, s.begin():
        r = await ReviewRepository(s).create(topic=topic, language="th", options=options or {},
                                             cache_key=str(uuid.uuid4()), api_key_id=key_id)
        r.status, r.is_listed = status, listed
        if created_at is not None:
            r.created_at = created_at
        return r.id


async def audit_rows(session_factory, action):
    async with session_factory() as s:
        return list((await s.execute(select(AdminAudit).where(AdminAudit.action == action))).scalars())


async def test_list_filters_search_and_shapes_rows(client, session_factory):
    headers = await admin_headers(client, session_factory)
    async with session_factory() as s, s.begin():
        _, key = await mint_key(s, "lab")
    old = await make_review(session_factory, "Metformin and cancer", created_at=T0)
    new = await make_review(session_factory, "x" * 300, "error", created_at=T0 + timedelta(hours=1), key_id=key.id,
                            options={"review_type": "scoping"})
    hidden = await make_review(session_factory, "Statins 100% safe_ish", created_at=T0 + timedelta(hours=2),
                               listed=False)
    body = (await client.get(BASE, headers=headers)).json()
    assert [i["id"] for i in body["items"]] == [str(hidden), str(new), str(old)] and body["next"] is None
    row = body["items"][1]
    assert len(row["topic"]) == 200 and row["review_type"] == "scoping" and row["api_key_prefix"] == key.key_prefix
    assert body["items"][2]["review_type"] == "slr" and body["items"][2]["api_key_prefix"] is None
    ids = lambda r: [i["id"] for i in r.json()["items"]]  # noqa: E731
    assert ids(await client.get(BASE, params={"q": "METFORMIN"}, headers=headers)) == [str(old)]
    assert ids(await client.get(BASE, params={"status": "error"}, headers=headers)) == [str(new)]
    assert ids(await client.get(BASE, params={"listed": "false"}, headers=headers)) == [str(hidden)]
    assert ids(await client.get(BASE, params={"q": "100%"}, headers=headers)) == [str(hidden)]
    assert ids(await client.get(BASE, params={"q": "%"}, headers=headers)) == [str(hidden)]  # literal, not a wildcard
    assert ids(await client.get(BASE, params={"q": "t_n"}, headers=headers)) == []  # "_" is literal ("statins" has t?n)
    assert (await client.get(BASE, params={"status": "bogus"}, headers=headers)).status_code == 422
    assert (await client.get(BASE, params={"before": "garbage"}, headers=headers)).status_code == 422


async def test_paging_is_stable_when_reviews_share_a_timestamp(client, session_factory):
    headers = await admin_headers(client, session_factory)
    made = {str(await make_review(session_factory, f"topic {i}", created_at=T0)) for i in range(3)}
    first = (await client.get(BASE, params={"limit": 2}, headers=headers)).json()
    second = (await client.get(BASE, params={"limit": 2, "before": first["next"]}, headers=headers)).json()
    seen = [i["id"] for i in first["items"] + second["items"]]
    assert len(seen) == 3 and set(seen) == made and second["next"] is None


async def test_cancel_goes_through_the_service_and_is_audited(client, session_factory, queue):
    headers = await admin_headers(client, session_factory)
    rid = await make_review(session_factory, "running topic", "running")
    r = await client.post(f"{BASE}/{rid}/cancel", headers=headers)
    assert r.status_code == 200 and r.json() == {"id": str(rid), "status": "cancelled"}
    async with session_factory() as s:
        events = await EventRepository(s).list_since(rid, 0)
    assert events[-1].type == "cancelled" and events[-1].payload == {"by": "admin"} and queue.aborted == [str(rid)]
    [row] = await audit_rows(session_factory, "review.cancel")
    assert row.before == {"status": "running"} and row.after == {"status": "cancelled"} and row.actor_label == "owner"
    assert (await client.post(f"{BASE}/{rid}/cancel", headers=headers)).status_code == 409
    assert len(await audit_rows(session_factory, "review.cancel")) == 1


async def test_hide_and_show_change_the_public_list_and_are_audited(client, session_factory):
    headers = await admin_headers(client, session_factory)
    rid = await make_review(session_factory, "public topic")
    async with session_factory() as s, s.begin():
        await ReviewRepository(s).update(rid, finished_at=T0)
    assert (await client.patch(f"{BASE}/{rid}", json={"is_listed": False}, headers=headers)).json() == {
        "id": str(rid), "is_listed": False}
    assert (await client.get("/api/v1/reviews?recent=10")).json() == []
    await client.patch(f"{BASE}/{rid}", json={"is_listed": True}, headers=headers)
    assert [r["id"] for r in (await client.get("/api/v1/reviews?recent=10")).json()] == [str(rid)]
    assert [(r.before, r.after) for r in await audit_rows(session_factory, "review.hide")] == [
        ({"is_listed": True}, {"is_listed": False})]
    assert len(await audit_rows(session_factory, "review.show")) == 1
    assert (await client.patch(f"{BASE}/{uuid.uuid4()}", json={"is_listed": True}, headers=headers)).status_code == 404


async def test_delete_removes_the_review_its_rows_and_its_stream(app, client, session_factory, redis, queue):
    headers = await admin_headers(client, session_factory)
    rid = await make_review(session_factory, "finished topic")
    await app.state.deps.event_sink.emit(rid, "queued", {})
    async with session_factory() as s, s.begin():
        paper = Paper(title="A trial")
        s.add(paper)
        await s.flush()
        s.add(ReviewPaper(review_id=rid, paper_id=paper.id, included=True))
    assert await redis.exists(stream_key(rid))
    assert (await client.delete(f"{BASE}/{rid}", headers=headers)).status_code == 204
    async with session_factory() as s:
        assert await s.get(Review, rid) is None
        for model in (ReviewEvent, ReviewPaper):
            assert await s.scalar(select(func.count()).select_from(model).where(model.review_id == rid)) == 0
        assert await s.scalar(select(func.count()).select_from(Paper)) == 1  # shared paper cache stays
    assert not await redis.exists(stream_key(rid)) and queue.checkpoint_deletes == [str(rid)]
    [row] = await audit_rows(session_factory, "review.delete")
    assert row.before["topic"] == "finished topic" and row.before["status"] == "done" and row.after is None


async def test_delete_refuses_active_and_unknown_reviews(client, session_factory):
    headers = await admin_headers(client, session_factory)
    rid = await make_review(session_factory, "queued topic", "queued")
    r = await client.delete(f"{BASE}/{rid}", headers=headers)
    assert r.status_code == 409 and "cancel" in r.json()["detail"]
    assert (await client.delete(f"{BASE}/{uuid.uuid4()}", headers=headers)).status_code == 404
    assert await audit_rows(session_factory, "review.delete") == []


async def test_delete_succeeds_even_when_cleanup_fails(client, session_factory, queue, monkeypatch):
    headers = await admin_headers(client, session_factory)
    rid = await make_review(session_factory, "finished topic")

    async def broken(_):
        raise ConnectionError("redis down")

    monkeypatch.setattr(queue, "enqueue_checkpoint_delete", broken)
    assert (await client.delete(f"{BASE}/{rid}", headers=headers)).status_code == 204


async def test_admin_key_lists_and_plain_key_is_refused(client, session_factory):
    async with session_factory() as s, s.begin():
        admin, _ = await mint_key(s, "ops", is_admin=True)
        plain, _ = await mint_key(s, "lab")
    assert (await client.get(BASE, headers={"X-API-Key": admin})).status_code == 200
    assert (await client.get(BASE, headers={"X-API-Key": plain})).status_code == 403


class _S(TypedDict):
    n: int


async def test_delete_checkpoint_job_drops_the_thread():
    b = StateGraph(_S)
    b.add_node("inc", lambda s: {"n": s["n"] + 1})
    b.add_edge(START, "inc")
    b.add_edge("inc", END)
    graph = b.compile(checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": "r1"}}
    await graph.ainvoke({"n": 1}, config)
    assert (await graph.aget_state(config)).values
    assert await delete_checkpoint({"graph": graph}, "r1") == {"deleted": True}
    assert not (await graph.aget_state(config)).values
    assert await delete_checkpoint({"graph": object()}, "r1") == {"deleted": False}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23a/backend && uv run pytest tests/unit/test_admin_reviews.py -q`
Expected: FAIL with `ImportError: cannot import name 'delete_checkpoint'`.

- [ ] **Step 4: Implement the service `backend/app/services/admin_reviews.py`**

```python
"""Admin review management (Plan 23a): search, hide or show, delete. Each change writes its audit row in the same
transaction; deleting also drops the live event stream and (through a worker job) the LangGraph checkpoint."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import TERMINAL_STATUSES, ApiKey, Review, ReviewEvent, ReviewPaper, ReviewStatus
from app.logging import get_logger
from app.services.admin_auth import AdminPrincipal
from app.services.audit import record
from app.services.events import stream_key
from app.services.review_service import Conflict, NotFound

log = get_logger(__name__)

STATUSES = frozenset(s.value for s in ReviewStatus)
TOPIC_PREVIEW = 200
_COLUMNS = (Review.id, Review.topic, Review.status, Review.options, Review.created_at, Review.finished_at,
            Review.cost_usd, Review.is_listed, Review.prompt_version, Review.error, ApiKey.key_prefix)


def encode_cursor(created_at: datetime, review_id: uuid.UUID) -> str:
    return f"{created_at.isoformat()}|{review_id}"


def decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    stamp, sep, rid = cursor.rpartition("|")
    if not sep:
        raise ValueError("invalid cursor")
    return datetime.fromisoformat(stamp), uuid.UUID(rid)


def _contains(q: str) -> str:
    """A LIKE pattern that matches q literally: %, _ and the escape character itself are escaped."""
    escaped = q.lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _row_out(row) -> dict[str, Any]:
    return {"id": row.id, "topic": row.topic[:TOPIC_PREVIEW], "status": row.status,
            "review_type": (row.options or {}).get("review_type") or "slr", "created_at": row.created_at,
            "finished_at": row.finished_at, "cost_usd": row.cost_usd, "is_listed": row.is_listed,
            "api_key_prefix": row.key_prefix, "prompt_version": row.prompt_version, "error": row.error}


async def list_reviews(session: AsyncSession, *, q: str | None = None, status: str | None = None,
                       listed: bool | None = None, before: tuple[datetime, uuid.UUID] | None = None,
                       limit: int = 50) -> tuple[list[dict[str, Any]], str | None]:
    """Newest first, keyset-paged on (created_at, id) so reviews created in the same instant are never skipped."""
    stmt = select(*_COLUMNS).outerjoin(ApiKey, Review.api_key_id == ApiKey.id)
    if q and q.strip():
        stmt = stmt.where(func.lower(Review.topic).like(_contains(q.strip()), escape="\\"))
    if status:
        stmt = stmt.where(Review.status == status)
    if listed is not None:
        stmt = stmt.where(Review.is_listed.is_(listed))
    if before is not None:
        created, rid = before
        stmt = stmt.where(or_(Review.created_at < created, and_(Review.created_at == created, Review.id < rid)))
    stmt = stmt.order_by(Review.created_at.desc(), Review.id.desc()).limit(limit + 1)
    rows = (await session.execute(stmt)).all()
    cursor = encode_cursor(rows[limit - 1].created_at, rows[limit - 1].id) if len(rows) > limit else None
    return [_row_out(r) for r in rows[:limit]], cursor


async def set_listed(session: AsyncSession, actor: AdminPrincipal, review_id: uuid.UUID, listed: bool, *,
                     ip_hash: str | None) -> dict[str, Any]:
    review = await session.get(Review, review_id)
    if review is None:
        raise NotFound("review not found")
    before = review.is_listed
    review.is_listed = listed
    await record(session, actor, "review.show" if listed else "review.hide", target_type="review",
                 target_id=review_id, before={"is_listed": before}, after={"is_listed": listed}, ip_hash=ip_hash)
    return {"id": review_id, "is_listed": listed}


async def delete_review(session: AsyncSession, actor: AdminPrincipal, review_id: uuid.UUID, *,
                        ip_hash: str | None) -> None:
    """Only a finished review. Its events and paper links go with it (deleted explicitly: sqlite does not enforce
    cascades); the shared `papers` rows stay, other reviews use them."""
    review = await session.get(Review, review_id)
    if review is None:
        raise NotFound("review not found")
    if review.status not in TERMINAL_STATUSES:
        raise Conflict(f"review is {review.status}; cancel it before deleting")
    before = {"topic": review.topic[:TOPIC_PREVIEW], "status": review.status, "created_at": review.created_at,
              "cost_usd": review.cost_usd, "prompt_version": review.prompt_version}
    await session.execute(delete(ReviewEvent).where(ReviewEvent.review_id == review_id))
    await session.execute(delete(ReviewPaper).where(ReviewPaper.review_id == review_id))
    await session.delete(review)
    await session.flush()
    await record(session, actor, "review.delete", target_type="review", target_id=review_id, before=before,
                 ip_hash=ip_hash)


async def forget_review(redis, queue, review_id: uuid.UUID) -> None:
    """After the delete commits: drop the live event stream and ask a worker to drop the LangGraph checkpoint.
    Best-effort: the review is already gone, so a failure here is only logged."""
    try:
        await redis.delete(stream_key(review_id))
    except Exception:  # noqa: BLE001 - the stream expires by itself (event_stream_ttl_seconds)
        log.warning("admin_delete_stream_failed", review_id=str(review_id))
    try:
        await queue.enqueue_checkpoint_delete(review_id)
    except Exception:  # noqa: BLE001 - an orphaned checkpoint is harmless and small
        log.warning("admin_delete_checkpoint_enqueue_failed", review_id=str(review_id))
```

- [ ] **Step 5: Implement the routes `backend/app/api/admin_reviews.py`**

```python
"""Admin console: reviews (Plan 23a). Thin adapters over app.services.admin_reviews and ReviewService.cancel."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel

from app.api.auth import ip_hash_of, require_admin
from app.api.deps import get_deps
from app.api.reviews import service_error_response
from app.runtime import AppDeps
from app.services.admin_reviews import STATUSES, decode_cursor, delete_review, forget_review, list_reviews, set_listed
from app.services.audit import record
from app.services.review_service import Identity, ServiceError

router = APIRouter()


class ListedBody(BaseModel):
    is_listed: bool


@router.get("/admin/reviews")
async def admin_list_reviews(q: str | None = Query(None, max_length=200), status: str | None = None,
                             listed: bool | None = None, before: str | None = Query(None, max_length=100),
                             limit: int = Query(50, ge=1, le=100), deps: AppDeps = Depends(get_deps),
                             _: Identity = Depends(require_admin)) -> dict:
    if status is not None and status not in STATUSES:
        raise HTTPException(status_code=422, detail=f"unknown status {status}")
    try:
        cursor = decode_cursor(before) if before else None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="invalid cursor") from exc
    async with deps.session_factory() as session:
        items, nxt = await list_reviews(session, q=q, status=status, listed=listed, before=cursor, limit=limit)
    return {"items": items, "next": nxt}


@router.post("/admin/reviews/{review_id}/cancel")
async def admin_cancel_review(review_id: uuid.UUID, deps: AppDeps = Depends(get_deps),
                              identity: Identity = Depends(require_admin)):
    ip_hash = ip_hash_of(identity, deps)

    async def audit(session, review) -> None:
        await record(session, identity.admin, "review.cancel", target_type="review", target_id=review_id,
                     before={"status": review.status}, after={"status": "cancelled"}, ip_hash=ip_hash)

    try:
        status = await deps.service.cancel(review_id, identity=identity, audit=audit)
    except ServiceError as exc:
        return service_error_response(exc)
    return {"id": review_id, "status": status}


@router.patch("/admin/reviews/{review_id}")
async def admin_set_listed(review_id: uuid.UUID, body: ListedBody, deps: AppDeps = Depends(get_deps),
                           identity: Identity = Depends(require_admin)):
    try:
        async with deps.session_factory() as session, session.begin():
            return await set_listed(session, identity.admin, review_id, body.is_listed,
                                    ip_hash=ip_hash_of(identity, deps))
    except ServiceError as exc:
        return service_error_response(exc)


@router.delete("/admin/reviews/{review_id}", status_code=204)
async def admin_delete_review(review_id: uuid.UUID, deps: AppDeps = Depends(get_deps),
                              identity: Identity = Depends(require_admin)):
    try:
        async with deps.session_factory() as session, session.begin():
            await delete_review(session, identity.admin, review_id, ip_hash=ip_hash_of(identity, deps))
    except ServiceError as exc:
        return service_error_response(exc)
    await forget_review(deps.redis, deps.queue, review_id)
    return Response(status_code=204)
```

In `backend/app/main.py`, import `admin_reviews` with the other API modules and add:
`app.include_router(admin_reviews.router, prefix="/api/v1", tags=["admin"], include_in_schema=False)`.

- [ ] **Step 6: Implement the queue method and the worker job**

`backend/app/services/queue.py`, in `ArqJobQueue`:

```python
    async def enqueue_checkpoint_delete(self, review_id: uuid.UUID) -> bool:
        """A deleted review's LangGraph thread is dropped by a worker, which owns the checkpointer (Plan 23a)."""
        job = await self.pool.enqueue_job("delete_checkpoint", str(review_id), _job_id=f"checkpoint-delete:{review_id}")
        return job is not None
```

`backend/app/worker/tasks.py`:

```python
async def delete_checkpoint(ctx: dict, review_id: str) -> dict:
    """Drop the LangGraph thread of a review an admin deleted (Plan 23a)."""
    checkpointer = getattr(ctx["graph"], "checkpointer", None)
    if checkpointer is None:
        return {"deleted": False}
    await checkpointer.adelete_thread(review_id)
    return {"deleted": True}
```

`backend/app/worker/settings.py`: import `delete_checkpoint` from `app.worker.tasks` and set
`functions: ClassVar[list] = [run_review, resume_review, deliver_webhook, delete_checkpoint]`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd /d/MRA-plan-23a/backend && uv run pytest tests/unit/test_admin_reviews.py tests/unit/test_cancel.py -q`
Expected: PASS.

- [ ] **Step 8: Lint and commit**

```bash
cd /d/MRA-plan-23a/backend && uv run ruff check app tests
cd /d/MRA-plan-23a && git add backend/app/services/admin_reviews.py backend/app/api/admin_reviews.py \
  backend/app/services/queue.py backend/app/worker/tasks.py backend/app/worker/settings.py backend/app/main.py \
  backend/tests/conftest.py backend/tests/unit/test_admin_reviews.py
git commit -m "feat(admin): review search, cancel, hide/show and delete with checkpoint cleanup (Plan 23a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: API keys and the audit log routes

**Files:**
- Create: `backend/app/services/admin_keys.py`
- Create: `backend/app/api/admin_keys.py`
- Modify: `backend/app/main.py` (include the router, hidden)
- Test: `backend/tests/unit/test_admin_keys.py`

**Interfaces:**
- Consumes: `mint_key`, `reviews_since` (`app.services.api_keys`); `record`, `list_audit`, `audit_out` (Task 2); `require_admin`, `ip_hash_of` (Task 5).
- Produces:
  - `async list_keys_with_usage(session, *, now=None) -> list[dict]`.
  - `async mint(session, actor, *, name, daily_quota, is_admin, ip_hash) -> tuple[str, dict]`.
  - `async update_key(session, actor, key_id, *, name=None, daily_quota=None, ip_hash) -> dict`.
  - `async revoke(session, actor, key_id, *, ip_hash) -> dict`.
  - Routes `GET /admin/keys` → `[key]`, `POST /admin/keys` → 201 `{key, ...key}`, `PATCH /admin/keys/{id}`, `POST /admin/keys/{id}/revoke`, `GET /admin/audit?before=&limit=` → `{items, next}`.
  - A key dict holds `id`, `key_prefix`, `name`, `daily_quota`, `is_admin`, `created_at`, `revoked_at` and `reviews_24h`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_admin_keys.py`:

```python
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
    mint_row = [a for a in await audit(session_factory) if a.action == "key.mint"][0]
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23a/backend && uv run pytest tests/unit/test_admin_keys.py -q`
Expected: FAIL (404 on `/api/v1/admin/keys`).

- [ ] **Step 3: Implement the service `backend/app/services/admin_keys.py`**

```python
"""Admin API key management (Plan 23a): mint (the raw key is returned once), rename, change quota, revoke.
Each change writes its audit row in the same transaction; the raw key and its hash never reach the log."""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import ApiKey, Review
from app.services.admin_auth import AdminPrincipal
from app.services.api_keys import mint_key, reviews_since
from app.services.audit import record
from app.services.review_service import Conflict, NotFound

DAY = timedelta(hours=24)


def _key_out(row: ApiKey, used: int) -> dict[str, Any]:
    return {"id": row.id, "key_prefix": row.key_prefix, "name": row.name, "daily_quota": row.daily_quota,
            "is_admin": bool(row.is_admin), "created_at": row.created_at, "revoked_at": row.revoked_at,
            "reviews_24h": used}


async def _used(session: AsyncSession, key_id: uuid.UUID) -> int:
    return await reviews_since(session, key_id, datetime.now(UTC) - DAY)


async def _get(session: AsyncSession, key_id: uuid.UUID) -> ApiKey:
    row = await session.get(ApiKey, key_id)
    if row is None:
        raise NotFound("key not found")
    return row


async def list_keys_with_usage(session: AsyncSession, *, now: datetime | None = None) -> list[dict[str, Any]]:
    since = (now or datetime.now(UTC)) - DAY
    counts = dict((await session.execute(
        select(Review.api_key_id, func.count()).where(Review.api_key_id.is_not(None), Review.created_at >= since)
        .group_by(Review.api_key_id))).all())
    rows = (await session.execute(select(ApiKey).order_by(ApiKey.created_at.desc(), ApiKey.id))).scalars()
    return [_key_out(r, counts.get(r.id, 0)) for r in rows]


async def mint(session: AsyncSession, actor: AdminPrincipal, *, name: str, daily_quota: int, is_admin: bool,
               ip_hash: str | None) -> tuple[str, dict[str, Any]]:
    raw, row = await mint_key(session, name, daily_quota=daily_quota, is_admin=is_admin)
    await session.refresh(row)  # created_at comes from the database default
    await record(session, actor, "key.mint", target_type="key", target_id=row.id,
                 after={"key_prefix": row.key_prefix, "name": name, "daily_quota": daily_quota, "is_admin": is_admin},
                 ip_hash=ip_hash)
    return raw, _key_out(row, 0)


async def update_key(session: AsyncSession, actor: AdminPrincipal, key_id: uuid.UUID, *, name: str | None = None,
                     daily_quota: int | None = None, ip_hash: str | None) -> dict[str, Any]:
    row = await _get(session, key_id)
    if row.revoked_at is not None:
        raise Conflict("key is revoked")
    before: dict[str, Any] = {}
    after: dict[str, Any] = {}
    for field, value in (("name", name), ("daily_quota", daily_quota)):
        if value is not None and value != getattr(row, field):
            before[field], after[field] = getattr(row, field), value
            setattr(row, field, value)
    await session.flush()
    await record(session, actor, "key.update", target_type="key", target_id=key_id, before=before, after=after,
                 ip_hash=ip_hash)
    return _key_out(row, await _used(session, key_id))


async def revoke(session: AsyncSession, actor: AdminPrincipal, key_id: uuid.UUID, *,
                 ip_hash: str | None) -> dict[str, Any]:
    row = await _get(session, key_id)
    if row.revoked_at is None:
        row.revoked_at = datetime.now(UTC)
        await session.flush()
        await record(session, actor, "key.revoke", target_type="key", target_id=key_id, before={"revoked": False},
                     after={"revoked": True}, ip_hash=ip_hash)
    return _key_out(row, await _used(session, key_id))
```

- [ ] **Step 4: Implement the routes `backend/app/api/admin_keys.py`**

```python
"""Admin console: API keys and the audit log (Plan 23a). Thin adapters over app.services.admin_keys and audit."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from pydantic import BaseModel, Field, field_validator

from app.api.auth import ip_hash_of, require_admin
from app.api.deps import get_deps
from app.api.reviews import service_error_response
from app.runtime import AppDeps
from app.services.admin_keys import list_keys_with_usage, mint, revoke, update_key
from app.services.audit import audit_out, list_audit
from app.services.review_service import Identity, ServiceError

router = APIRouter()


def _name(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    if not value:
        raise ValueError("name must not be blank")
    return value


class MintBody(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    daily_quota: int = Field(100, ge=1, le=100_000)
    is_admin: bool = False

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str) -> str:
        return _name(value)


class KeyPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    daily_quota: int | None = Field(None, ge=1, le=100_000)

    @field_validator("name")
    @classmethod
    def strip_name(cls, value: str | None) -> str | None:
        return _name(value)


@router.get("/admin/keys")
async def admin_list_keys(deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> list[dict]:
    async with deps.session_factory() as session:
        return await list_keys_with_usage(session)


@router.post("/admin/keys", status_code=201)
async def admin_mint_key(body: MintBody, deps: AppDeps = Depends(get_deps),
                         identity: Identity = Depends(require_admin)):
    async with deps.session_factory() as session, session.begin():
        raw, key = await mint(session, identity.admin, name=body.name, daily_quota=body.daily_quota,
                              is_admin=body.is_admin, ip_hash=ip_hash_of(identity, deps))
    return JSONResponse(status_code=201, content=jsonable_encoder({"key": raw, **key}))


@router.patch("/admin/keys/{key_id}")
async def admin_update_key(key_id: uuid.UUID, body: KeyPatch, deps: AppDeps = Depends(get_deps),
                           identity: Identity = Depends(require_admin)):
    try:
        async with deps.session_factory() as session, session.begin():
            return await update_key(session, identity.admin, key_id, name=body.name, daily_quota=body.daily_quota,
                                    ip_hash=ip_hash_of(identity, deps))
    except ServiceError as exc:
        return service_error_response(exc)


@router.post("/admin/keys/{key_id}/revoke")
async def admin_revoke_key(key_id: uuid.UUID, deps: AppDeps = Depends(get_deps),
                           identity: Identity = Depends(require_admin)):
    try:
        async with deps.session_factory() as session, session.begin():
            return await revoke(session, identity.admin, key_id, ip_hash=ip_hash_of(identity, deps))
    except ServiceError as exc:
        return service_error_response(exc)


@router.get("/admin/audit")
async def admin_audit(before: int | None = Query(None, ge=1), limit: int = Query(50, ge=1, le=100),
                      deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> dict:
    async with deps.session_factory() as session:
        rows, nxt = await list_audit(session, before=before, limit=limit)
    return {"items": [audit_out(r) for r in rows], "next": nxt}
```

In `backend/app/main.py`, import `admin_keys` and add
`app.include_router(admin_keys.router, prefix="/api/v1", tags=["admin"], include_in_schema=False)`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /d/MRA-plan-23a/backend && uv run pytest tests/unit/test_admin_keys.py tests/unit/test_api_keys.py -q`
Expected: PASS.

- [ ] **Step 6: Lint and commit**

```bash
cd /d/MRA-plan-23a/backend && uv run ruff check app tests
cd /d/MRA-plan-23a && git add backend/app/services/admin_keys.py backend/app/api/admin_keys.py backend/app/main.py \
  backend/tests/unit/test_admin_keys.py
git commit -m "feat(admin): API key mint, edit, revoke and the audit log route (Plan 23a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The dashboard

**Files:**
- Create: `backend/app/services/admin_dashboard.py`
- Create: `backend/app/api/admin_dashboard.py`
- Modify: `backend/app/main.py` (include the router, hidden)
- Test: `backend/tests/unit/test_admin_dashboard.py`

**Interfaces:**
- Consumes: `Capacity.check(queued=, running=)`, `.reviews_today()`, `.usd_today()`; `ReviewRepository.count_by_status`; `require_admin` (Task 5).
- Produces: `async build_dashboard(session_factory, capacity, settings, *, days: int, now: datetime | None = None) -> dict`
  (shape in spec section 7); route `GET /admin/dashboard?days=` (1–90).

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_admin_dashboard.py`:

```python
import uuid
from datetime import UTC, datetime, timedelta

from app.config import Settings
from app.db.repositories import ReviewRepository
from app.services.admin_dashboard import build_dashboard
from app.services.capacity import Capacity
from tests.admin_helpers import admin_headers

NOW = datetime(2026, 10, 12, 15, 0, tzinfo=UTC)
A = "openrouter:qwen/qwen3.5-flash-02-23"


async def make(session_factory, status, cost, *, ago: timedelta, synthesizer: str | None = None):
    async with session_factory() as s, s.begin():
        r = await ReviewRepository(s).create(topic="t", language="th", options={}, cache_key=str(uuid.uuid4()))
        r.status, r.cost_usd, r.created_at = status, cost, NOW - ago
        r.model_versions = {"synthesizer": synthesizer} if synthesizer else None


async def test_empty_window_is_zero_filled(session_factory, redis):
    s = Settings(_env_file=None)
    d = await build_dashboard(session_factory, Capacity(redis, s), s, days=3, now=NOW)
    assert [p["date"] for p in d["per_day"]] == ["2026-10-10", "2026-10-11", "2026-10-12"]
    assert all(p == {"date": p["date"], "by_status": {}, "cost_usd": 0.0} for p in d["per_day"])
    assert d["since"] == "2026-10-10" and d["days"] == 3
    assert d["totals"] == {"reviews": 0, "by_status": {}, "cost_usd": 0.0, "avg_cost_done_usd": None}
    assert d["error_rate_7d"] is None and d["by_model"] == []


async def test_tallies_error_rate_and_cost_by_synthesizer(session_factory, redis):
    await make(session_factory, "done", 0.1, ago=timedelta(hours=1), synthesizer=A)
    await make(session_factory, "error", 0.02, ago=timedelta(hours=2), synthesizer=A)
    await make(session_factory, "rejected", 0.0, ago=timedelta(hours=3))
    await make(session_factory, "done", 0.2, ago=timedelta(days=1))
    await make(session_factory, "error", 0.05, ago=timedelta(days=5), synthesizer=A)  # in the week, not the window
    await make(session_factory, "done", 9.0, ago=timedelta(days=10), synthesizer=A)  # outside both
    s = Settings(_env_file=None)
    d = await build_dashboard(session_factory, Capacity(redis, s), s, days=3, now=NOW)
    today, yesterday = d["per_day"][-1], d["per_day"][-2]
    assert today["by_status"] == {"done": 1, "error": 1, "rejected": 1} and today["cost_usd"] == 0.12
    assert yesterday["by_status"] == {"done": 1} and yesterday["cost_usd"] == 0.2
    assert d["totals"]["reviews"] == 4 and d["totals"]["by_status"] == {"done": 2, "error": 1, "rejected": 1}
    assert d["totals"]["cost_usd"] == 0.32 and d["totals"]["avg_cost_done_usd"] == 0.15
    assert d["error_rate_7d"] == 0.5  # 2 errors / (2 done + 2 errors) in the last 7 days; rejections never count
    assert d["by_model"] == [{"synthesizer": "unknown", "reviews": 2, "cost_usd": 0.2},
                             {"synthesizer": A, "reviews": 2, "cost_usd": 0.12}]


async def test_route_reports_capacity_with_caps_from_settings(client, session_factory, app):
    headers = await admin_headers(client, session_factory)
    capacity = app.state.deps.service.capacity
    await capacity.note_review()
    await capacity.note_cost(0.4)
    await make(session_factory, "queued", 0.0, ago=timedelta(minutes=1))
    d = (await client.get("/api/v1/admin/dashboard", params={"days": 7}, headers=headers)).json()
    s = app.state.deps.service.settings
    assert len(d["per_day"]) == 7
    assert d["capacity"] == {"accepting": True, "reason": None, "queued": 1, "running": 0,
                             "max_queued_reviews": s.max_queued_reviews, "reviews_today": 1,
                             "max_reviews_per_day": s.max_reviews_per_day, "usd_today": 0.4,
                             "max_usd_per_day": s.max_usd_per_day}
    for bad in (0, 91):
        assert (await client.get("/api/v1/admin/dashboard", params={"days": bad}, headers=headers)).status_code == 422
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23a/backend && uv run pytest tests/unit/test_admin_dashboard.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.admin_dashboard'`.

- [ ] **Step 3: Implement `backend/app/services/admin_dashboard.py`**

```python
"""Admin dashboard numbers (Plan 23a). One window of review rows is aggregated in Python, which keeps one code path
for Postgres and sqlite (the window is at most 90 days of a small service). Days are UTC, like the daily caps.
Cost is stored per review, so `by_model` is "cost of reviews whose synthesizer was X", not a per-model bill."""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import UTC, datetime, time, timedelta
from typing import Any

from sqlalchemy import select

from app.db.models import Review
from app.db.repositories import ReviewRepository

WEEK = timedelta(days=7)


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def _money(value: float) -> float:
    return round(value, 4)


async def build_dashboard(session_factory, capacity, settings, *, days: int,
                          now: datetime | None = None) -> dict[str, Any]:
    now = _utc(now or datetime.now(UTC))
    first_day = now.date() - timedelta(days=days - 1)
    since = datetime.combine(first_day, time.min, tzinfo=UTC)
    week_ago = now - WEEK
    async with session_factory() as session:
        rows = (await session.execute(
            select(Review.created_at, Review.status, Review.cost_usd, Review.model_versions)
            .where(Review.created_at >= min(since, week_ago)))).all()
        repo = ReviewRepository(session)
        queued, running = await repo.count_by_status("queued"), await repo.count_by_status("running")

    per_day: dict = {first_day + timedelta(days=i): {"by_status": Counter(), "cost_usd": 0.0} for i in range(days)}
    totals: Counter = Counter()
    week: Counter = Counter()
    cost_total = done_cost = 0.0
    by_model: dict[str, dict[str, Any]] = defaultdict(lambda: {"reviews": 0, "cost_usd": 0.0})
    for created, status, cost, models in rows:
        created, cost = _utc(created), float(cost or 0.0)
        if created >= week_ago:
            week[status] += 1
        day = per_day.get(created.date()) if created >= since else None
        if day is None:
            continue
        day["by_status"][status] += 1
        day["cost_usd"] += cost
        totals[status] += 1
        cost_total += cost
        if status == "done":
            done_cost += cost
        model = by_model[(models or {}).get("synthesizer") or "unknown"]
        model["reviews"] += 1
        model["cost_usd"] += cost

    judged = week["done"] + week["error"]
    refusal = await capacity.check(queued=queued, running=running) if capacity is not None else None
    return {
        "days": days,
        "since": first_day.isoformat(),
        "per_day": [{"date": d.isoformat(), "by_status": dict(v["by_status"]), "cost_usd": _money(v["cost_usd"])}
                    for d, v in sorted(per_day.items())],
        "totals": {"reviews": sum(totals.values()), "by_status": dict(totals), "cost_usd": _money(cost_total),
                   "avg_cost_done_usd": _money(done_cost / totals["done"]) if totals["done"] else None},
        "error_rate_7d": round(week["error"] / judged, 4) if judged else None,
        "by_model": sorted(({"synthesizer": k, "reviews": v["reviews"], "cost_usd": _money(v["cost_usd"])}
                            for k, v in by_model.items()), key=lambda m: (-m["cost_usd"], m["synthesizer"])),
        "capacity": {
            "accepting": refusal is None, "reason": refusal.reason if refusal else None,
            "queued": queued, "running": running, "max_queued_reviews": settings.max_queued_reviews,
            "reviews_today": await capacity.reviews_today() if capacity is not None else 0,
            "max_reviews_per_day": settings.max_reviews_per_day,
            "usd_today": _money(await capacity.usd_today()) if capacity is not None else 0.0,
            "max_usd_per_day": settings.max_usd_per_day,
        },
    }
```

- [ ] **Step 4: Implement the route `backend/app/api/admin_dashboard.py`**

```python
"""Admin console: the dashboard (Plan 23a)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.auth import require_admin
from app.api.deps import get_deps
from app.runtime import AppDeps
from app.services.admin_dashboard import build_dashboard
from app.services.review_service import Identity

router = APIRouter()


@router.get("/admin/dashboard")
async def admin_dashboard(days: int = Query(30, ge=1, le=90), deps: AppDeps = Depends(get_deps),
                          _: Identity = Depends(require_admin)) -> dict:
    return await build_dashboard(deps.session_factory, deps.service.capacity, deps.service.settings, days=days)
```

In `backend/app/main.py`, import `admin_dashboard` and add
`app.include_router(admin_dashboard.router, prefix="/api/v1", tags=["admin"], include_in_schema=False)`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd /d/MRA-plan-23a/backend && uv run pytest tests/unit/test_admin_dashboard.py -q`
Expected: PASS. If a float comparison is off by rounding (for example 0.12 against 0.12000000000000001), the fix
belongs in `_money` rounding inside the service, not in a looser test.

- [ ] **Step 6: Full backend run, lint and commit**

Run: `cd /d/MRA-plan-23a/backend && uv run pytest -q && uv run ruff check .`
Expected: all pass (the known flaky `test_queue_position` aside; report it if it fails).

```bash
cd /d/MRA-plan-23a && git add backend/app/services/admin_dashboard.py backend/app/api/admin_dashboard.py \
  backend/app/main.py backend/tests/unit/test_admin_dashboard.py
git commit -m "feat(admin): dashboard with daily reviews and cost, error rate, cost by synthesizer and capacity (Plan 23a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Frontend foundation (API client, copy, dev rewrite, sign-in page, gate and nav)

**Files:**
- Create: `frontend/src/lib/admin-types.ts`, `frontend/src/lib/admin-api.ts`, `frontend/src/lib/admin-copy.ts`
- Modify: `frontend/next.config.ts` (dev-only rewrite)
- Create: `frontend/src/components/admin/ui.ts`, `admin-gate.tsx`, `admin-nav.tsx`, `sign-in-form.tsx`
- Create: `frontend/src/app/admin/layout.tsx`, `frontend/src/app/admin/page.tsx`, `frontend/src/app/admin/(console)/layout.tsx`
- Create: `frontend/src/test/admin-fetch.tsx`, `frontend/src/test/admin-fixtures.ts`
- Test: `frontend/src/lib/admin-api.test.ts`, `frontend/src/lib/admin-copy.test.ts`, `frontend/src/test/next-config.test.ts`,
  `frontend/src/components/admin/sign-in-form.test.tsx`, `frontend/src/components/admin/admin-gate.test.tsx`

**Interfaces:**
- Consumes: the backend routes from Tasks 5–8 (shapes in their Interfaces blocks).
- Produces:
  - `adminApi` with `signIn`, `signOut`, `me`, `dashboard`, `reviews`, `cancelReview`, `setListed`, `deleteReview`, `keys`, `mintKey`, `updateKey`, `revokeKey` and `audit`.
  - `AdminApiError(status, message, retryAfter)` and `adminErrorText(e)`.
  - From `admin-copy.ts`: `STATUS_LABEL`, `STATUS_ORDER`, `ACTION_LABEL`, `ACTOR_LABEL`, `NOT_BEHIND_SITE`, `formatUsd`, `formatWhen` and `describeChange`.
  - `<AdminGate>` and `useAdmin() -> { me, fail }`.
  - From `ui.ts`: `BUTTON_PRIMARY`, `BUTTON_GHOST`, `BUTTON_DANGER`, `INPUT`, `TABLE_REGION`, `TH` and `TD`.
  - Test helpers `mockAdminFetch(handler)`, `renderAdmin(ui)` and `nav` mocks; fixtures `DASHBOARD`, `REVIEWS`, `KEYS` and `AUDIT`.

- [ ] **Step 0: Install the frontend dependencies in the worktree**

Run: `cd /d/MRA-plan-23a/frontend && npm ci`
Expected: completes (the worktree has no `node_modules` yet). Read `node_modules/next/dist/docs/` for `rewrites` and
`metadata.robots` before Step 4 (AGENTS.md: this Next.js differs from older versions).

- [ ] **Step 1: Write the types, copy and fixtures (no behaviour yet)**

`frontend/src/lib/admin-types.ts`:

```ts
/** Payloads of the admin API (/api/v1/admin, Plan 23a). Mirrors backend/app/services/admin_*.py. */
export type AdminStatus = "queued" | "running" | "done" | "error" | "rejected" | "cancelled";

export interface AdminMe { kind: "user" | "key"; label: string }

export interface Page<T> { items: T[]; next: string | number | null }

export interface Dashboard {
  days: number;
  since: string;
  per_day: { date: string; by_status: Partial<Record<AdminStatus, number>>; cost_usd: number }[];
  totals: { reviews: number; by_status: Partial<Record<AdminStatus, number>>; cost_usd: number; avg_cost_done_usd: number | null };
  error_rate_7d: number | null;
  by_model: { synthesizer: string; reviews: number; cost_usd: number }[];
  capacity: {
    accepting: boolean; reason: string | null; queued: number; running: number; max_queued_reviews: number;
    reviews_today: number; max_reviews_per_day: number; usd_today: number; max_usd_per_day: number;
  };
}

export interface AdminReview {
  id: string; topic: string; status: AdminStatus; review_type: string; created_at: string; finished_at: string | null;
  cost_usd: number; is_listed: boolean; api_key_prefix: string | null; prompt_version: string | null; error: string | null;
}

export interface AdminKey {
  id: string; key_prefix: string | null; name: string; daily_quota: number; is_admin: boolean; created_at: string;
  revoked_at: string | null; reviews_24h: number;
}

export interface MintedKey extends AdminKey { key: string }

export interface AuditEntry {
  id: number; created_at: string; actor_kind: "user" | "key" | "cli"; actor_label: string; action: string;
  target_type: string | null; target_id: string | null;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null;
}
```

`frontend/src/lib/admin-copy.ts`:

```ts
import type { AdminStatus, AuditEntry } from "./admin-types";

export const STATUS_LABEL: Record<AdminStatus, string> = {
  queued: "รอคิว", running: "กำลังทำ", done: "เสร็จ", error: "ผิดพลาด", rejected: "ถูกปฏิเสธ", cancelled: "ยกเลิกแล้ว",
};

/** Stack and legend order on the dashboard chart; also the status filter's order. */
export const STATUS_ORDER: AdminStatus[] = ["done", "error", "rejected", "cancelled", "running", "queued"];

export const ACTION_LABEL: Record<string, string> = {
  "review.cancel": "ยกเลิกรีวิว", "review.hide": "ซ่อนรีวิวจากรายการสาธารณะ", "review.show": "แสดงรีวิวในรายการสาธารณะ",
  "review.delete": "ลบรีวิว", "key.mint": "สร้าง API key", "key.update": "แก้ไข API key", "key.revoke": "เพิกถอน API key",
  "admin.login": "เข้าสู่ระบบ", "admin.logout": "ออกจากระบบ", "admin.lockout": "ล็อกการเข้าสู่ระบบ (ผิดหลายครั้ง)",
  "admin.create": "สร้างบัญชีผู้ดูแล", "admin.passwd": "เปลี่ยนรหัสผ่าน", "admin.disable": "ปิดบัญชีผู้ดูแล",
  "admin.enable": "เปิดบัญชีผู้ดูแล",
};

export const ACTOR_LABEL: Record<AuditEntry["actor_kind"], string> = { user: "ผู้ดูแล", key: "API key", cli: "CLI" };

export const NOT_BEHIND_SITE =
  "หน้า admin ใช้ผ่านที่อยู่หลักของเว็บเท่านั้น เปิดผ่าน Caddy (เช่น http://localhost:8088/admin) หรือโดเมนจริง ไม่ใช่พอร์ตของเว็บโดยตรง";

/** Service costs, not numbers from a paper: plain figures in the display face. */
export function formatUsd(n: number): string {
  return `$${n.toFixed(n !== 0 && Math.abs(n) < 1 ? 3 : 2)}`;
}

export function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

function show(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** One line per changed field: "daily_quota: 10 → 25"; a field only before or only after shows its one value. */
export function describeChange(before: Record<string, unknown> | null, after: Record<string, unknown> | null): string[] {
  const b = before ?? {};
  const a = after ?? {};
  return [...new Set([...Object.keys(b), ...Object.keys(a)])].sort().map((k) =>
    k in b && k in a ? `${k}: ${show(b[k])} → ${show(a[k])}` : `${k}: ${show(k in a ? a[k] : b[k])}`);
}
```

`frontend/src/test/admin-fixtures.ts`:

```ts
import type { AdminKey, AdminReview, AuditEntry, Dashboard, Page } from "@/lib/admin-types";

export const DASHBOARD: Dashboard = {
  days: 30, since: "2026-09-13",
  per_day: [
    { date: "2026-10-11", by_status: { done: 3 }, cost_usd: 0.21 },
    { date: "2026-10-12", by_status: { done: 4, error: 1 }, cost_usd: 0.31 },
  ],
  totals: { reviews: 8, by_status: { done: 7, error: 1 }, cost_usd: 0.52, avg_cost_done_usd: 0.072 },
  error_rate_7d: 0.125,
  by_model: [{ synthesizer: "openrouter:qwen/qwen3.5-flash-02-23", reviews: 7, cost_usd: 0.5 }, { synthesizer: "unknown", reviews: 1, cost_usd: 0.02 }],
  capacity: { accepting: true, reason: null, queued: 0, running: 1, max_queued_reviews: 50, reviews_today: 5,
    max_reviews_per_day: 500, usd_today: 0.4, max_usd_per_day: 10 },
};

export const REVIEWS: Page<AdminReview> = {
  items: [
    { id: "11111111-1111-4111-8111-111111111111", topic: "เมตฟอร์มินกับมะเร็งลำไส้ใหญ่", status: "running", review_type: "slr",
      created_at: "2026-10-12T09:00:00Z", finished_at: null, cost_usd: 0.01, is_listed: true, api_key_prefix: null,
      prompt_version: "2026-10-12.1", error: null },
    { id: "22222222-2222-4222-8222-222222222222", topic: "Statins and dementia", status: "done", review_type: "meta_analysis",
      created_at: "2026-10-11T09:00:00Z", finished_at: "2026-10-11T09:02:00Z", cost_usd: 0.074, is_listed: true,
      api_key_prefix: "mra_abcdefgh", prompt_version: "2026-10-12.1", error: null },
  ],
  next: null,
};

export const KEYS: AdminKey[] = [
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", key_prefix: "mra_abcdefgh", name: "partner lab", daily_quota: 100,
    is_admin: false, created_at: "2026-10-01T00:00:00Z", revoked_at: null, reviews_24h: 3 },
];

export const AUDIT: Page<AuditEntry> = {
  items: [
    { id: 2, created_at: "2026-10-12T10:00:00Z", actor_kind: "user", actor_label: "owner", action: "key.update",
      target_type: "key", target_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", before: { daily_quota: 10 }, after: { daily_quota: 100 } },
    { id: 1, created_at: "2026-10-12T09:59:00Z", actor_kind: "cli", actor_label: "cli", action: "admin.create",
      target_type: "admin", target_id: "x", before: null, after: { username: "owner" } },
  ],
  next: null,
};
```

`frontend/src/test/admin-fetch.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import { AdminGate } from "@/components/admin/admin-gate";

export const ME = { kind: "user", label: "owner" };

/** [status, body?, headers?]; undefined falls through to GET /me (signed in) or a 404. */
export type AdminReply = [number, unknown?, Record<string, string>?];
export type AdminHandler = (method: string, path: string, body: unknown) => AdminReply | undefined;

/** Stubs fetch for the admin API. `path` is relative to /api/v1/admin and keeps its query string. */
export function mockAdminFetch(handler: AdminHandler = () => undefined) {
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://site.test");
    const path = url.pathname.replace(/^\/api\/v1\/admin/, "") + url.search;
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    const [status, payload, headers] = handler(method, path, body)
      ?? (method === "GET" && path === "/me" ? [200, ME] : [404, { detail: `no mock for ${method} ${path}` }]);
    return new Response(status === 204 ? null : JSON.stringify(payload ?? {}), {
      status, headers: { "Content-Type": "application/json", ...headers },
    });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** Renders inside the real gate (GET /me answered by the mock) and waits for the admin nav. */
export async function renderAdmin(ui: ReactElement) {
  const result = render(<AdminGate>{ui}</AdminGate>);
  await screen.findByRole("navigation", { name: "ผู้ดูแลระบบ" });
  return result;
}
```

- [ ] **Step 2: Write the failing tests**

`frontend/src/lib/admin-api.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminApiError, adminApi, adminErrorText } from "./admin-api";

afterEach(() => vi.unstubAllGlobals());

function stub(status: number, body: unknown = {}, headers: Record<string, string> = {}) {
  const fn = vi.fn().mockResolvedValue(new Response(status === 204 ? null : JSON.stringify(body), { status, headers }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

describe("adminApi", () => {
  it("reads with a relative same-origin GET and no CSRF header", async () => {
    const fn = stub(200, { kind: "user", label: "owner" });
    expect(await adminApi.me()).toEqual({ kind: "user", label: "owner" });
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/me");
    expect(init.credentials).toBe("same-origin");
    expect((init.headers as Record<string, string>)["X-MRA-Admin"]).toBeUndefined();
  });

  it("sends writes with the CSRF header and a JSON body; 204 resolves to undefined", async () => {
    const fn = stub(204);
    expect(await adminApi.signIn("owner", "pw")).toBeUndefined();
    const [url, init] = fn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/v1/admin/session");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "X-MRA-Admin": "1", "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ username: "owner", password: "pw" });
  });

  it("builds the review query with trimmed search, filters and the cursor", async () => {
    const fn = stub(200, { items: [], next: null });
    await adminApi.reviews({ q: "  statins ", status: "done", listed: "false", before: "2026-10-12T09:00:00|abc" });
    const url = new URL(fn.mock.calls[0][0] as string, "http://x");
    expect(url.pathname).toBe("/api/v1/admin/reviews");
    expect(Object.fromEntries(url.searchParams)).toEqual({ q: "statins", status: "done", listed: "false", before: "2026-10-12T09:00:00|abc" });
    await adminApi.reviews();
    expect(fn.mock.calls[1][0]).toBe("/api/v1/admin/reviews");
  });

  it("maps failures to AdminApiError with the detail and Retry-After", async () => {
    stub(429, { detail: "too many failed sign-ins; try again later" }, { "Retry-After": "600" });
    const err = await adminApi.signIn("owner", "x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AdminApiError);
    expect(err).toMatchObject({ status: 429, retryAfter: 600, message: "too many failed sign-ins; try again later" });
    expect(adminErrorText(err)).toBe("ลองใหม่ได้ในอีก 10 นาที");
  });

  it("turns a network failure into status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const err = await adminApi.keys().catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0 });
    expect(adminErrorText(err)).toContain("ติดต่อเซิร์ฟเวอร์ไม่ได้");
  });

  it("gives Thai text for the other statuses", () => {
    expect(adminErrorText(new AdminApiError(409, "review is running; cancel it before deleting"))).toBe("review is running; cancel it before deleting");
    expect(adminErrorText(new AdminApiError(404, "x"))).toBe("ไม่พบรายการนี้แล้ว");
    expect(adminErrorText(new AdminApiError(500, "x"))).toContain("(500)");
    expect(adminErrorText(new Error("x"))).toBe("เกิดข้อผิดพลาด ลองใหม่อีกครั้ง");
  });
});
```

`frontend/src/lib/admin-copy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { describeChange, formatUsd } from "./admin-copy";

describe("admin copy", () => {
  it("formats service costs", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(0.0745)).toBe("$0.075");
    expect(formatUsd(7.9)).toBe("$7.90");
  });

  it("describes a change field by field", () => {
    expect(describeChange({ daily_quota: 10 }, { daily_quota: 25 })).toEqual(["daily_quota: 10 → 25"]);
    expect(describeChange(null, { username: "owner", is_admin: false })).toEqual(["is_admin: false", "username: owner"]);
    expect(describeChange({ topic: "t", status: "done" }, null)).toEqual(["status: done", "topic: t"]);
    expect(describeChange(null, null)).toEqual([]);
  });
});
```

`frontend/src/test/next-config.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config";

afterEach(() => vi.unstubAllEnvs());

describe("next.config admin rewrite", () => {
  it("proxies the admin API only under next dev", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ADMIN_DEV_API_URL", "http://localhost:8000/");
    const rules = await nextConfig.rewrites!();
    expect(rules).toEqual([{ source: "/api/v1/admin/:path*", destination: "http://localhost:8000/api/v1/admin/:path*" }]);
    vi.stubEnv("NODE_ENV", "production");
    expect(await nextConfig.rewrites!()).toEqual([]);
  });
});
```

`frontend/src/components/admin/sign-in-form.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockAdminFetch } from "@/test/admin-fetch";
import { NOT_BEHIND_SITE } from "@/lib/admin-copy";
import { SignInForm } from "./sign-in-form";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin" }));

afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); window.history.replaceState(null, "", "/"); });

function fill(username: string, password: string) {
  fireEvent.change(screen.getByLabelText("ชื่อผู้ใช้"), { target: { value: username } });
  fireEvent.change(screen.getByLabelText("รหัสผ่าน"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "เข้าสู่ระบบ" }));
}

describe("SignInForm", () => {
  it("signs in and goes to the dashboard", async () => {
    let signedIn = false;
    mockAdminFetch((m, p) => {
      if (m === "GET" && p === "/me") return signedIn ? [200, { kind: "user", label: "owner" }] : [401, { detail: "sign in required" }];
      if (m === "POST" && p === "/session") { signedIn = true; return [204]; }
    });
    render(<SignInForm />);
    fill("owner", "correct horse battery staple");
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/admin/dashboard"));
  });

  it("says the credentials are wrong and clears the password", async () => {
    mockAdminFetch((m, p) => (p === "/me" ? [401, {}] : m === "POST" ? [401, { detail: "invalid username or password" }] : undefined));
    render(<SignInForm />);
    fill("owner", "wrong password");
    expect(await screen.findByRole("alert")).toHaveTextContent("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
    expect(screen.getByLabelText("รหัสผ่าน")).toHaveValue("");
  });

  it("shows the lockout wait", async () => {
    mockAdminFetch((m, p) => (p === "/me" ? [401, {}] : [429, { detail: "locked" }, { "Retry-After": "300" }]));
    render(<SignInForm />);
    fill("owner", "whatever password");
    expect(await screen.findByRole("alert")).toHaveTextContent("ลองใหม่ได้ในอีก 5 นาที");
  });

  it("explains when the page is not behind the site address", async () => {
    mockAdminFetch(() => [404, { detail: "Not Found" }]);
    render(<SignInForm />);
    expect(await screen.findByRole("alert")).toHaveTextContent(NOT_BEHIND_SITE);
  });

  it("says the session expired when sent back from the console", async () => {
    window.history.replaceState(null, "", "/admin?expired=1");
    mockAdminFetch((_, p) => (p === "/me" ? [401, {}] : undefined));
    render(<SignInForm />);
    expect(await screen.findByRole("status")).toHaveTextContent("หมดเวลาเข้าสู่ระบบ");
  });
});
```

`frontend/src/components/admin/admin-gate.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AdminApiError } from "@/lib/admin-api";
import { NOT_BEHIND_SITE } from "@/lib/admin-copy";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { AdminGate, useAdmin } from "./admin-gate";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/keys" }));

afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

function ExpiresOnClick() {
  const { fail } = useAdmin();
  return <button type="button" onClick={() => fail(new AdminApiError(401, "sign in required"))}>ทำรายการ</button>;
}

describe("AdminGate", () => {
  it("shows the nav, the current page and the signed-in admin", async () => {
    mockAdminFetch();
    await renderAdmin(<p>เนื้อหา</p>);
    expect(screen.getByText("เนื้อหา")).toBeInTheDocument();
    expect(screen.getByText("owner")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "API keys" })).toHaveAttribute("aria-current", "page");
  });

  it("sends a signed-out visitor to the sign-in page", async () => {
    mockAdminFetch(() => [401, { detail: "sign in required" }]);
    render(<AdminGate><p>secret</p></AdminGate>);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/admin"));
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });

  it("explains a missing admin API (not behind the site address)", async () => {
    mockAdminFetch(() => [404, { detail: "Not Found" }]);
    render(<AdminGate><p>secret</p></AdminGate>);
    expect(await screen.findByRole("alert")).toHaveTextContent(NOT_BEHIND_SITE);
  });

  it("sends the admin back to sign-in when a later call finds the session expired", async () => {
    mockAdminFetch();
    await renderAdmin(<ExpiresOnClick />);
    fireEvent.click(screen.getByRole("button", { name: "ทำรายการ" }));
    expect(nav.replace).toHaveBeenCalledWith("/admin?expired=1");
  });

  it("signs out and returns to the sign-in page", async () => {
    const fetch = mockAdminFetch((m, p) => (m === "DELETE" && p === "/session" ? [204] : undefined));
    await renderAdmin(<p>เนื้อหา</p>);
    fireEvent.click(screen.getByRole("button", { name: "ออกจากระบบ" }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/admin"));
    expect(fetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "DELETE")).toBe(true);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23a/frontend && npx vitest run src/lib/admin-api.test.ts src/lib/admin-copy.test.ts src/test/next-config.test.ts src/components/admin`
Expected: FAIL (missing modules `./admin-api`, `./sign-in-form`, `./admin-gate`; the rewrite test fails on `rewrites` being undefined).

- [ ] **Step 4: Implement the client, the dev rewrite, the UI classes, the gate, the nav and the sign-in form**

`frontend/src/lib/admin-api.ts`:

```ts
import type { AdminKey, AdminMe, AdminReview, AdminStatus, AuditEntry, Dashboard, MintedKey, Page } from "./admin-types";

/** Admin calls are relative and same-origin: the session cookie (Path=/api/v1/admin) never leaves the site, and Caddy
 * (or the dev rewrite in next.config.ts) routes them to the API. */
export const ADMIN_BASE = "/api/v1/admin";

export class AdminApiError extends Error {
  constructor(public status: number, message: string, public retryAfter: number | null = null) {
    super(message);
    this.name = "AdminApiError";
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body) headers["Content-Type"] = "application/json";
  if (method !== "GET") headers["X-MRA-Admin"] = "1";
  let res: Response;
  try {
    res = await fetch(`${ADMIN_BASE}${path}`, { ...init, method, credentials: "same-origin", headers });
  } catch (e) {
    throw new AdminApiError(0, e instanceof Error ? e.message : "network error");
  }
  if (!res.ok) {
    let detail = res.statusText || `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === "string") detail = body.detail;
    } catch {
      // not JSON: keep the status text
    }
    const retry = Number(res.headers.get("Retry-After"));
    throw new AdminApiError(res.status, detail, Number.isFinite(retry) && retry > 0 ? retry : null);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

const send = (method: string, body?: unknown): RequestInit =>
  body === undefined ? { method } : { method, body: JSON.stringify(body) };
const enc = encodeURIComponent;

export interface ReviewQuery { q?: string; status?: AdminStatus | ""; listed?: "" | "true" | "false"; before?: string | null }

export const adminApi = {
  signIn: (username: string, password: string) => call<void>("/session", send("POST", { username, password })),
  signOut: () => call<void>("/session", send("DELETE")),
  me: () => call<AdminMe>("/me"),
  dashboard: (days = 30) => call<Dashboard>(`/dashboard?days=${days}`),
  reviews: (query: ReviewQuery = {}) => {
    const p = new URLSearchParams();
    if (query.q?.trim()) p.set("q", query.q.trim());
    if (query.status) p.set("status", query.status);
    if (query.listed) p.set("listed", query.listed);
    if (query.before) p.set("before", query.before);
    const qs = p.toString();
    return call<Page<AdminReview>>(`/reviews${qs ? `?${qs}` : ""}`);
  },
  cancelReview: (id: string) => call<{ id: string; status: string }>(`/reviews/${enc(id)}/cancel`, send("POST")),
  setListed: (id: string, isListed: boolean) =>
    call<{ id: string; is_listed: boolean }>(`/reviews/${enc(id)}`, send("PATCH", { is_listed: isListed })),
  deleteReview: (id: string) => call<void>(`/reviews/${enc(id)}`, send("DELETE")),
  keys: () => call<AdminKey[]>("/keys"),
  mintKey: (body: { name: string; daily_quota: number; is_admin: boolean }) => call<MintedKey>("/keys", send("POST", body)),
  updateKey: (id: string, body: { name?: string; daily_quota?: number }) => call<AdminKey>(`/keys/${enc(id)}`, send("PATCH", body)),
  revokeKey: (id: string) => call<AdminKey>(`/keys/${enc(id)}/revoke`, send("POST")),
  audit: (before?: number | null) => call<Page<AuditEntry>>(`/audit${before ? `?before=${before}` : ""}`),
};

/** Thai text for a failed admin call. A 401 is handled by the gate, which sends the admin back to sign-in. */
export function adminErrorText(e: unknown): string {
  if (!(e instanceof AdminApiError)) return "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";
  if (e.status === 0) return "ติดต่อเซิร์ฟเวอร์ไม่ได้ ตรวจการเชื่อมต่อแล้วลองใหม่";
  if (e.status === 429) return e.retryAfter ? `ลองใหม่ได้ในอีก ${Math.ceil(e.retryAfter / 60)} นาที` : "ถูกจำกัดชั่วคราว ลองใหม่ภายหลัง";
  if (e.status === 403) return `ไม่มีสิทธิ์ทำรายการนี้ (${e.message})`;
  if (e.status === 404) return "ไม่พบรายการนี้แล้ว";
  if (e.status === 409 || e.status === 422) return e.message;
  return `เกิดข้อผิดพลาด (${e.status}) ลองใหม่อีกครั้ง`;
}
```

`frontend/next.config.ts`: add inside `nextConfig`:

```ts
  // `next dev` only: send the admin API to the local backend so the admin cookie stays same-origin. Behind Caddy
  // (docker, production) /api/* never reaches Next, and a production build carries no rewrite.
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    const api = (process.env.ADMIN_DEV_API_URL ?? "http://localhost:8000").replace(/\/$/, "");
    return [{ source: "/api/v1/admin/:path*", destination: `${api}/api/v1/admin/:path*` }];
  },
```

`frontend/src/components/admin/ui.ts`:

```ts
/** Admin console control styles (DESIGN.md: 2px corners, 1px rule borders, 44px targets, primary = the action colour). */
export const BUTTON_PRIMARY =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-sm bg-primary px-4 font-display font-semibold text-on-primary hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45";
export const BUTTON_GHOST =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-sm border border-rule bg-transparent px-3 font-display font-semibold text-ink hover:border-ink disabled:cursor-not-allowed disabled:opacity-45";
export const BUTTON_DANGER =
  "inline-flex min-h-11 cursor-pointer items-center justify-center rounded-sm border border-err bg-err-bg px-3 font-display font-semibold text-err disabled:cursor-not-allowed disabled:opacity-45";
export const INPUT = "min-h-11 w-full rounded-sm border border-rule bg-ground px-3 text-ink";
export const TABLE_REGION = "mt-4 overflow-x-auto rounded-sm border border-rule";
export const TH = "border-b border-rule px-3 py-2 text-left font-display text-sm font-semibold whitespace-nowrap";
export const TD = "border-b border-rule px-3 py-2 align-top";
```

`frontend/src/components/admin/admin-gate.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AdminApiError, adminApi, adminErrorText } from "@/lib/admin-api";
import { NOT_BEHIND_SITE } from "@/lib/admin-copy";
import type { AdminMe } from "@/lib/admin-types";
import { AdminNav } from "./admin-nav";

interface AdminContextValue {
  me: AdminMe;
  /** Thai text for a failed call; a 401 (session expired) sends the admin back to sign-in. */
  fail: (e: unknown) => string;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext);
  if (!value) throw new Error("useAdmin is only available inside <AdminGate>");
  return value;
}

type GateState = { kind: "checking" } | { kind: "in"; me: AdminMe } | { kind: "blocked"; message: string };

/** Every console page sits behind this: it checks GET /me once, then renders the admin nav and the page. */
export function AdminGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<GateState>({ kind: "checking" });

  useEffect(() => {
    let alive = true;
    adminApi.me()
      .then((me) => { if (alive) setState({ kind: "in", me }); })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof AdminApiError && e.status === 401) router.replace("/admin");
        else setState({ kind: "blocked", message: e instanceof AdminApiError && e.status === 404 ? NOT_BEHIND_SITE : adminErrorText(e) });
      });
    return () => { alive = false; };
  }, [router]);

  const fail = useCallback((e: unknown) => {
    if (e instanceof AdminApiError && e.status === 401) {
      router.replace("/admin?expired=1");
      return "หมดเวลาเข้าสู่ระบบ กรุณาเข้าใหม่";
    }
    return adminErrorText(e);
  }, [router]);

  const value = useMemo(() => (state.kind === "in" ? { me: state.me, fail } : null), [state, fail]);

  if (state.kind === "checking") return <p role="status" className="py-12 text-muted">กำลังตรวจสิทธิ์…</p>;
  if (state.kind === "blocked") return <p role="alert" className="my-12 rounded-sm bg-err-bg px-4 py-3">{state.message}</p>;
  return (
    <AdminContext.Provider value={value}>
      <AdminNav me={state.me} />
      {children}
    </AdminContext.Provider>
  );
}
```

`frontend/src/components/admin/admin-nav.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { adminApi } from "@/lib/admin-api";
import type { AdminMe } from "@/lib/admin-types";
import { BUTTON_GHOST } from "./ui";

const LINKS = [
  ["/admin/dashboard", "Dashboard"], ["/admin/reviews", "รีวิว"], ["/admin/keys", "API keys"], ["/admin/audit", "Audit log"],
] as const;

export function AdminNav({ me }: { me: AdminMe }) {
  const pathname = usePathname();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setBusy(true);
    try {
      await adminApi.signOut();
    } catch {
      // the session may already be gone; the sign-in page is the right place either way
    }
    router.replace("/admin");
  }

  return (
    <nav aria-label="ผู้ดูแลระบบ" className="mt-4 flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-rule pb-3">
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} aria-current={pathname === href ? "page" : undefined}
          className="inline-flex min-h-11 items-center rounded-sm px-3 font-display font-semibold text-ink hover:bg-rail aria-[current=page]:bg-rail aria-[current=page]:text-primary">
          {label}
        </Link>
      ))}
      <span className="ml-auto flex flex-wrap items-center gap-3 text-sm text-muted">
        <span>{me.kind === "key" ? `API key ${me.label}` : me.label}</span>
        <button type="button" onClick={signOut} disabled={busy} className={BUTTON_GHOST}>ออกจากระบบ</button>
      </span>
    </nav>
  );
}
```

`frontend/src/components/admin/sign-in-form.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState, type FormEvent } from "react";
import { AdminApiError, adminApi, adminErrorText } from "@/lib/admin-api";
import { NOT_BEHIND_SITE } from "@/lib/admin-copy";
import { BUTTON_PRIMARY, INPUT } from "./ui";

export function SignInForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const userId = useId();
  const passId = useId();

  useEffect(() => {
    let alive = true;
    adminApi.me()
      .then(() => { if (alive) router.replace("/admin/dashboard"); })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof AdminApiError && e.status === 404) setError(NOT_BEHIND_SITE);
        else if (new URLSearchParams(window.location.search).get("expired") === "1") setNote("หมดเวลาเข้าสู่ระบบ กรุณาเข้าใหม่");
      });
    return () => { alive = false; };
  }, [router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await adminApi.signIn(username, password);
      router.replace("/admin/dashboard");
    } catch (err) {
      setPassword("");
      if (err instanceof AdminApiError && err.status === 401) setError("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");
      else if (err instanceof AdminApiError && err.status === 404) setError(NOT_BEHIND_SITE);
      else setError(adminErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="sign-in-title" className="mx-auto max-w-sm py-12">
      <h1 id="sign-in-title" className="font-display text-2xl font-semibold">เข้าสู่ระบบผู้ดูแล</h1>
      {note && <p role="status" className="mt-4 rounded-sm bg-info-bg px-3 py-2">{note}</p>}
      <form onSubmit={submit} className="mt-6 grid gap-4" noValidate>
        <div className="grid gap-1">
          <label htmlFor={userId} className="label">ชื่อผู้ใช้</label>
          <input id={userId} name="username" autoComplete="username" required value={username}
            onChange={(e) => setUsername(e.target.value)} className={INPUT} />
        </div>
        <div className="grid gap-1">
          <label htmlFor={passId} className="label">รหัสผ่าน</label>
          <input id={passId} name="password" type="password" autoComplete="current-password" required value={password}
            onChange={(e) => setPassword(e.target.value)} className={INPUT} />
        </div>
        {error && <p role="alert" className="rounded-sm bg-err-bg px-3 py-2">{error}</p>}
        <button type="submit" disabled={busy || !username || !password} className={BUTTON_PRIMARY}>
          {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
        </button>
      </form>
    </section>
  );
}
```

`frontend/src/app/admin/layout.tsx`:

```tsx
import type { Metadata } from "next";

export const metadata: Metadata = { title: "ผู้ดูแลระบบ", robots: { index: false, follow: false } };

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return <div className="pt-2">{children}</div>;
}
```

`frontend/src/app/admin/page.tsx`:

```tsx
import { SignInForm } from "@/components/admin/sign-in-form";

export default function AdminSignInPage() {
  return <SignInForm />;
}
```

`frontend/src/app/admin/(console)/layout.tsx`:

```tsx
import type { ReactNode } from "react";
import { AdminGate } from "@/components/admin/admin-gate";

export default function AdminConsoleLayout({ children }: { children: ReactNode }) {
  return <AdminGate>{children}</AdminGate>;
}
```

- [ ] **Step 5: Run the tests, typecheck and lint**

Run: `cd /d/MRA-plan-23a/frontend && npx vitest run src/lib/admin-api.test.ts src/lib/admin-copy.test.ts src/test/next-config.test.ts src/components/admin && npm run typecheck && npm run lint`
Expected: PASS, with no type or lint errors. If `npm run typecheck` rejects `LayoutProps<"/admin">`, use
`{ children }: { children: React.ReactNode }` as the console layout does.

- [ ] **Step 6: Commit**

```bash
cd /d/MRA-plan-23a && git add frontend/next.config.ts frontend/src/lib/admin-types.ts frontend/src/lib/admin-api.ts \
  frontend/src/lib/admin-copy.ts frontend/src/lib/admin-api.test.ts frontend/src/lib/admin-copy.test.ts \
  frontend/src/test/admin-fetch.tsx frontend/src/test/admin-fixtures.ts frontend/src/test/next-config.test.ts \
  frontend/src/components/admin frontend/src/app/admin
git commit -m "feat(admin-ui): admin API client, sign-in page, gate and nav, dev-only admin rewrite (Plan 23a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: The dashboard page

**Files:**
- Create: `frontend/src/lib/admin-dashboard-view.ts`
- Create: `frontend/src/components/admin/dashboard-view.tsx`
- Create: `frontend/src/app/admin/(console)/dashboard/page.tsx`
- Test: `frontend/src/lib/admin-dashboard-view.test.ts`, `frontend/src/components/admin/dashboard-view.test.tsx`

**Interfaces:**
- Consumes: `adminApi.dashboard`, `useAdmin`, `STATUS_LABEL`, `STATUS_ORDER`, `formatUsd` (Task 9); `EChart` (`@/components/charts/echart`).
- Produces:
  - `StatusColors` (one colour per status, plus `cost`, `text`, `rule` and `font`).
  - `dashboardChartOption(d: Dashboard, c: StatusColors) -> EChartsOption`.
  - `readStatusColors() -> StatusColors`.
  - `<DashboardView />`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/lib/admin-dashboard-view.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DASHBOARD } from "@/test/admin-fixtures";
import { dashboardChartOption, type StatusColors } from "./admin-dashboard-view";

const C: StatusColors = { done: "#0a0", error: "#a00", rejected: "#999", cancelled: "#777", running: "#a80", queued: "#ccc",
  cost: "#111", text: "#222", rule: "#ddd", font: "Bai Jamjuree" };

describe("dashboardChartOption", () => {
  it("stacks only the statuses that occur, with the cost on its own axis", () => {
    const o = dashboardChartOption(DASHBOARD, C) as { xAxis: { data: string[] }; series: Record<string, unknown>[] };
    expect(o.xAxis.data).toEqual(["10-11", "10-12"]);
    const names = o.series.map((s) => s.name);
    expect(names).toEqual(["เสร็จ", "ผิดพลาด", "ค่าใช้จ่าย (USD)"]);
    expect(o.series[0]).toMatchObject({ type: "bar", stack: "reviews", data: [3, 4], itemStyle: { color: "#0a0" } });
    expect(o.series[1]).toMatchObject({ data: [0, 1], itemStyle: { color: "#a00" } });
    expect(o.series[2]).toMatchObject({ type: "line", yAxisIndex: 1, data: [0.21, 0.31] });
  });
});
```

`frontend/src/components/admin/dashboard-view.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { DASHBOARD } from "@/test/admin-fixtures";
import { DashboardView } from "./dashboard-view";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/dashboard" }));
vi.mock("@/components/charts/echart", () => ({ EChart: ({ label }: { label: string }) => <div role="img" aria-label={label} /> }));

afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

describe("DashboardView", () => {
  it("shows totals, capacity against its caps, the chart, its table twin and cost by synthesizer", async () => {
    mockAdminFetch((m, p) => (p.startsWith("/dashboard") ? [200, DASHBOARD] : undefined));
    await renderAdmin(<DashboardView />);
    expect(await screen.findByText("$0.520")).toBeInTheDocument();
    expect(screen.getByText("12.5%")).toBeInTheDocument();
    expect(screen.getByText("รับรีวิวใหม่อยู่")).toBeInTheDocument();
    expect(screen.getByText("5 / 500")).toBeInTheDocument();
    expect(screen.getByText("$0.400 / $10.00")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /จำนวนรีวิวต่อวัน/ })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /รายวัน/ })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /synthesizer/ })).toHaveTextContent("openrouter:qwen/qwen3.5-flash-02-23");
  });

  it("refetches for another range", async () => {
    const fetch = mockAdminFetch((m, p) => (p.startsWith("/dashboard") ? [200, DASHBOARD] : undefined));
    await renderAdmin(<DashboardView />);
    await screen.findByText("$0.520");
    fireEvent.change(screen.getByLabelText("ช่วงเวลา"), { target: { value: "7" } });
    await waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u) === "/api/v1/admin/dashboard?days=7")).toBe(true));
  });

  it("says when the service is not accepting reviews, with the reason", async () => {
    const closed = { ...DASHBOARD, capacity: { ...DASHBOARD.capacity, accepting: false, reason: "daily_capacity" } };
    mockAdminFetch((m, p) => (p.startsWith("/dashboard") ? [200, closed] : undefined));
    await renderAdmin(<DashboardView />);
    expect(await screen.findByText(/ไม่รับรีวิวใหม่ตอนนี้/)).toHaveTextContent("daily_capacity");
  });

  it("shows a failure as an alert", async () => {
    mockAdminFetch((m, p) => (p.startsWith("/dashboard") ? [500, { detail: "boom" }] : undefined));
    await renderAdmin(<DashboardView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("(500)");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23a/frontend && npx vitest run src/lib/admin-dashboard-view.test.ts src/components/admin/dashboard-view.test.tsx`
Expected: FAIL (missing modules).

- [ ] **Step 3: Implement the chart view-model**

`frontend/src/lib/admin-dashboard-view.ts`:

```ts
import type { EChartsOption } from "@/components/charts/echart";
import { STATUS_LABEL, STATUS_ORDER } from "./admin-copy";
import type { AdminStatus, Dashboard } from "./admin-types";

/** Service-status colours. They come from the theme's status tokens, never from the finding-direction palette. */
export type StatusColors = Record<AdminStatus, string> & { cost: string; text: string; rule: string; font: string };

export function readStatusColors(): StatusColors {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    done: v("--ok", "#2e7d4f"), error: v("--err", "#b3261e"), rejected: v("--hatch", "#9aa8a0"),
    cancelled: v("--muted", "#4a5e57"), running: v("--warn", "#8a5a00"), queued: v("--rule", "#bccac1"),
    cost: v("--ink", "#10241e"), text: v("--ink", "#10241e"), rule: v("--rule", "#bccac1"),
    font: v("--font-bai-jamjuree", "sans-serif"),
  };
}

/** Reviews per UTC day stacked by status (bars), with the day's cost as a dashed line on its own axis. */
export function dashboardChartOption(d: Dashboard, c: StatusColors): EChartsOption {
  const present = STATUS_ORDER.filter((s) => d.per_day.some((p) => (p.by_status[s] ?? 0) > 0));
  return {
    animation: false,
    textStyle: { fontFamily: c.font, color: c.text },
    grid: { left: 44, right: 56, top: 40, bottom: 28 },
    legend: { top: 0, textStyle: { color: c.text } },
    tooltip: { trigger: "axis" },
    xAxis: { type: "category", data: d.per_day.map((p) => p.date.slice(5)), axisLine: { lineStyle: { color: c.rule } },
      axisLabel: { color: c.text } },
    yAxis: [
      { type: "value", name: "รีวิว", minInterval: 1, splitLine: { lineStyle: { color: c.rule } }, axisLabel: { color: c.text } },
      { type: "value", name: "USD", splitLine: { show: false }, axisLabel: { color: c.text } },
    ],
    series: [
      ...present.map((s) => ({
        name: STATUS_LABEL[s], type: "bar", stack: "reviews", data: d.per_day.map((p) => p.by_status[s] ?? 0),
        itemStyle: { color: c[s] }, emphasis: { disabled: true },
      })),
      { name: "ค่าใช้จ่าย (USD)", type: "line", yAxisIndex: 1, data: d.per_day.map((p) => p.cost_usd),
        itemStyle: { color: c.cost }, lineStyle: { color: c.cost, type: "dashed" }, symbol: "circle" },
    ],
  };
}
```

- [ ] **Step 4: Implement the view and the page**

`frontend/src/components/admin/dashboard-view.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { EChart } from "@/components/charts/echart";
import { adminApi } from "@/lib/admin-api";
import { STATUS_LABEL, STATUS_ORDER, formatUsd } from "@/lib/admin-copy";
import { dashboardChartOption, readStatusColors } from "@/lib/admin-dashboard-view";
import type { Dashboard } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { INPUT, TABLE_REGION, TD, TH } from "./ui";

const RANGES = [7, 30, 90] as const;

function percent(x: number | null): string {
  return x === null ? "—" : `${(x * 100).toFixed(1)}%`;
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="grid content-start gap-1 border-t border-rule py-3 sm:pr-6">
      <dt className="label">{label}</dt>
      <dd className="font-display text-[1.25rem] font-semibold tabular-nums">{value}</dd>
    </div>
  );
}

export function DashboardView() {
  const { fail } = useAdmin();
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    adminApi.dashboard(days)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e: unknown) => { if (alive) setError(fail(e)); });
    return () => { alive = false; };
  }, [days, fail]);

  const option = useMemo(() => (data ? dashboardChartOption(data, readStatusColors()) : null), [data]);
  const shown = data ? STATUS_ORDER.filter((s) => (data.totals.by_status[s] ?? 0) > 0) : [];

  return (
    <section aria-labelledby="dash-title" className="py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 id="dash-title" className="font-display text-2xl font-semibold">Dashboard</h1>
        <label className="grid gap-1">
          <span className="label">ช่วงเวลา</span>
          <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={INPUT}>
            {RANGES.map((n) => <option key={n} value={n}>{n} วันล่าสุด</option>)}
          </select>
        </label>
      </div>
      <p className="mt-2 text-sm text-muted">นับวันตามเวลา UTC เหมือนเพดานรายวันของระบบ</p>
      {error && <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-3">{error}</p>}
      {!data && !error && <p role="status" className="mt-6 text-muted">กำลังโหลด…</p>}
      {data && (
        <>
          <div className={`mt-6 rounded-sm px-4 py-3 ${data.capacity.accepting ? "bg-info-bg" : "bg-warn-bg"}`}>
            <p className="font-display font-semibold">
              {data.capacity.accepting ? "รับรีวิวใหม่อยู่" : `ไม่รับรีวิวใหม่ตอนนี้: ${data.capacity.reason ?? "ไม่ทราบเหตุผล"}`}
            </p>
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <div><dt className="inline">คิว </dt><dd className="inline tabular-nums">{`${data.capacity.queued} / ${data.capacity.max_queued_reviews}`}</dd></div>
              <div><dt className="inline">กำลังทำ </dt><dd className="inline tabular-nums">{data.capacity.running}</dd></div>
              <div><dt className="inline">รีวิววันนี้ </dt><dd className="inline tabular-nums">{`${data.capacity.reviews_today} / ${data.capacity.max_reviews_per_day}`}</dd></div>
              <div><dt className="inline">ค่าใช้จ่ายวันนี้ </dt><dd className="inline tabular-nums">{`${formatUsd(data.capacity.usd_today)} / ${formatUsd(data.capacity.max_usd_per_day)}`}</dd></div>
            </dl>
          </div>

          <dl className="mt-6 grid sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="รีวิวทั้งหมด" value={data.totals.reviews} />
            <Stat label="ค่าใช้จ่ายรวม" value={formatUsd(data.totals.cost_usd)} />
            <Stat label="เฉลี่ยต่อรีวิวที่เสร็จ" value={data.totals.avg_cost_done_usd === null ? "—" : formatUsd(data.totals.avg_cost_done_usd)} />
            <Stat label="Error rate 7 วัน" value={percent(data.error_rate_7d)} />
          </dl>

          {option && (
            <figure className="mt-8">
              <figcaption className="label">รีวิวต่อวันแยกตามสถานะ และค่าใช้จ่ายต่อวัน</figcaption>
              <EChart option={option} height={280} label="จำนวนรีวิวต่อวันแยกตามสถานะ และค่าใช้จ่ายต่อวัน (USD)" />
            </figure>
          )}

          <details className="mt-3">
            <summary className="cursor-pointer font-display font-semibold">ดูเป็นตาราง</summary>
            <div className={TABLE_REGION} role="region" aria-label="ตารางรายวัน" tabIndex={0}>
              <table className="w-full border-collapse text-sm tabular-nums">
                <caption className="sr-only">รีวิวและค่าใช้จ่ายรายวัน (UTC)</caption>
                <thead><tr><th scope="col" className={TH}>วันที่</th>
                  {shown.map((s) => <th key={s} scope="col" className={TH}>{STATUS_LABEL[s]}</th>)}
                  <th scope="col" className={TH}>ค่าใช้จ่าย</th></tr></thead>
                <tbody>{data.per_day.map((p) => (
                  <tr key={p.date}><th scope="row" className={TD}>{p.date}</th>
                    {shown.map((s) => <td key={s} className={TD}>{p.by_status[s] ?? 0}</td>)}
                    <td className={TD}>{formatUsd(p.cost_usd)}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </details>

          <div className={TABLE_REGION} role="region" aria-label="ค่าใช้จ่ายแยกตามโมเดล" tabIndex={0}>
            <table className="w-full border-collapse text-sm">
              <caption className="px-3 py-2 text-left text-muted">
                ค่าใช้จ่ายของรีวิว แยกตามโมเดล synthesizer (ระบบบันทึกค่าใช้จ่ายต่อรีวิว ไม่ได้แยกต่อโมเดล)
              </caption>
              <thead><tr><th scope="col" className={TH}>โมเดล</th><th scope="col" className={TH}>รีวิว</th>
                <th scope="col" className={TH}>ค่าใช้จ่าย</th></tr></thead>
              <tbody>{data.by_model.map((m) => (
                <tr key={m.synthesizer}><th scope="row" className={`${TD} break-all font-normal`}>{m.synthesizer}</th>
                  <td className={`${TD} tabular-nums`}>{m.reviews}</td><td className={`${TD} tabular-nums`}>{formatUsd(m.cost_usd)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
```

`frontend/src/app/admin/(console)/dashboard/page.tsx`:

```tsx
import type { Metadata } from "next";
import { DashboardView } from "@/components/admin/dashboard-view";

export const metadata: Metadata = { title: "Dashboard" };

export default function AdminDashboardPage() {
  return <DashboardView />;
}
```

- [ ] **Step 5: Run the tests, typecheck and lint**

Run: `cd /d/MRA-plan-23a/frontend && npx vitest run src/lib/admin-dashboard-view.test.ts src/components/admin && npm run typecheck && npm run lint`
Expected: PASS. `getByRole("table", { name: /รายวัน/ })` finds the table by its `<caption>` text; the caption
"รีวิวและค่าใช้จ่ายรายวัน (UTC)" contains "รายวัน".

- [ ] **Step 6: Commit**

```bash
cd /d/MRA-plan-23a && git add frontend/src/lib/admin-dashboard-view.ts frontend/src/lib/admin-dashboard-view.test.ts \
  frontend/src/components/admin/dashboard-view.tsx frontend/src/components/admin/dashboard-view.test.tsx \
  "frontend/src/app/admin/(console)/dashboard/page.tsx"
git commit -m "feat(admin-ui): dashboard page with capacity, totals, daily chart and its table, cost by synthesizer (Plan 23a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The reviews page and the in-page confirm button

**Files:**
- Create: `frontend/src/components/admin/confirm-button.tsx`
- Create: `frontend/src/components/admin/reviews-view.tsx`
- Create: `frontend/src/app/admin/(console)/reviews/page.tsx`
- Test: `frontend/src/components/admin/confirm-button.test.tsx`, `frontend/src/components/admin/reviews-view.test.tsx`

**Interfaces:**
- Consumes: `adminApi.reviews`, `cancelReview`, `setListed` and `deleteReview`; `useAdmin`; `STATUS_LABEL`, `STATUS_ORDER`, `formatUsd` and `formatWhen`; and the `ui.ts` classes.
- Produces:
  - `<ConfirmButton label confirmLabel onConfirm name? disabled? />`: the first click asks, the second confirms, and "ไม่ใช่" backs out.
  - `<ReviewsView />`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/admin/confirm-button.test.tsx`:

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfirmButton } from "./confirm-button";

describe("ConfirmButton", () => {
  it("asks once inside the page, then runs the action", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    render(<ConfirmButton label="ลบ" confirmLabel="ยืนยันลบ" onConfirm={run} />);
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "ยืนยันลบ" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันลบ" }));
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  });

  it("backs out with ไม่ใช่", () => {
    const run = vi.fn();
    render(<ConfirmButton label="ลบ" confirmLabel="ยืนยันลบ" onConfirm={run} />);
    fireEvent.click(screen.getByRole("button", { name: "ลบ" }));
    fireEvent.click(screen.getByRole("button", { name: "ไม่ใช่" }));
    expect(screen.getByRole("button", { name: "ลบ" })).toBeInTheDocument();
    expect(run).not.toHaveBeenCalled();
  });
});
```

`frontend/src/components/admin/reviews-view.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { REVIEWS } from "@/test/admin-fixtures";
import { ReviewsView } from "./reviews-view";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/reviews" }));

afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

const [RUNNING, DONE] = REVIEWS.items;
const row = (topic: string) => screen.getByRole("row", { name: new RegExp(topic) });

describe("ReviewsView", () => {
  it("lists reviews with links, statuses and only the actions that apply", async () => {
    mockAdminFetch((m, p) => (m === "GET" && p.startsWith("/reviews") ? [200, REVIEWS] : undefined));
    await renderAdmin(<ReviewsView />);
    expect(await screen.findByRole("link", { name: RUNNING.topic })).toHaveAttribute("href", `/r/${RUNNING.id}`);
    expect(within(row(RUNNING.topic)).getByRole("button", { name: "ยกเลิก" })).toBeInTheDocument();
    expect(within(row(RUNNING.topic)).queryByRole("button", { name: "ลบ" })).not.toBeInTheDocument();
    expect(within(row(DONE.topic)).getByRole("button", { name: "ลบ" })).toBeInTheDocument();
    expect(within(row(DONE.topic)).queryByRole("button", { name: "ยกเลิก" })).not.toBeInTheDocument();
  });

  it("searches with the typed topic and filters", async () => {
    const fetch = mockAdminFetch((m, p) => (m === "GET" && p.startsWith("/reviews") ? [200, REVIEWS] : undefined));
    await renderAdmin(<ReviewsView />);
    await screen.findByRole("link", { name: RUNNING.topic });
    fireEvent.change(screen.getByLabelText("ค้นหาหัวข้อ"), { target: { value: "statins" } });
    fireEvent.change(screen.getByLabelText("สถานะ"), { target: { value: "done" } });
    fireEvent.click(screen.getByRole("button", { name: "ค้นหา" }));
    await waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u) === "/api/v1/admin/reviews?q=statins&status=done")).toBe(true));
  });

  it("hides, cancels and deletes, updating the row each time", async () => {
    mockAdminFetch((m, p, body) => {
      if (m === "GET" && p.startsWith("/reviews")) return [200, REVIEWS];
      if (m === "PATCH") return [200, { id: DONE.id, is_listed: (body as { is_listed: boolean }).is_listed }];
      if (m === "POST" && p.endsWith("/cancel")) return [200, { id: RUNNING.id, status: "cancelled" }];
      if (m === "DELETE") return [204];
    });
    await renderAdmin(<ReviewsView />);
    await screen.findByRole("link", { name: DONE.topic });
    fireEvent.click(within(row(DONE.topic)).getByRole("button", { name: "ซ่อน" }));
    expect(await within(row(DONE.topic)).findByRole("button", { name: "แสดง" })).toBeInTheDocument();
    fireEvent.click(within(row(RUNNING.topic)).getByRole("button", { name: "ยกเลิก" }));
    expect(await within(row(RUNNING.topic)).findByText("ยกเลิกแล้ว")).toBeInTheDocument();
    fireEvent.click(within(row(DONE.topic)).getByRole("button", { name: "ลบ" }));
    fireEvent.click(within(row(DONE.topic)).getByRole("button", { name: "ยืนยันลบ" }));
    await waitFor(() => expect(screen.queryByRole("link", { name: DONE.topic })).not.toBeInTheDocument());
    expect(screen.getByRole("status")).toHaveTextContent("ลบรีวิวแล้ว");
  });

  it("shows a refusal from the API", async () => {
    mockAdminFetch((m, p) => {
      if (m === "GET" && p.startsWith("/reviews")) return [200, REVIEWS];
      if (m === "POST") return [409, { detail: "review is already done" }];
    });
    await renderAdmin(<ReviewsView />);
    fireEvent.click(within(await screen.findByRole("row", { name: new RegExp(RUNNING.topic) })).getByRole("button", { name: "ยกเลิก" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("review is already done");
  });

  it("sends the admin back to sign-in when the session expired mid-use", async () => {
    mockAdminFetch((m, p) => {
      if (m === "GET" && p.startsWith("/reviews")) return [200, REVIEWS];
      if (m === "PATCH") return [401, { detail: "sign in required" }];
    });
    await renderAdmin(<ReviewsView />);
    fireEvent.click(within(await screen.findByRole("row", { name: new RegExp(DONE.topic) })).getByRole("button", { name: "ซ่อน" }));
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/admin?expired=1"));
  });

  it("loads the next page", async () => {
    const fetch = mockAdminFetch((m, p) => {
      if (p === "/reviews") return [200, { items: [RUNNING], next: "c1" }];
      if (p === "/reviews?before=c1") return [200, { items: [DONE], next: null }];
    });
    await renderAdmin(<ReviewsView />);
    fireEvent.click(await screen.findByRole("button", { name: "โหลดเพิ่ม" }));
    expect(await screen.findByRole("link", { name: DONE.topic })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "โหลดเพิ่ม" })).not.toBeInTheDocument();
    expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23a/frontend && npx vitest run src/components/admin/confirm-button.test.tsx src/components/admin/reviews-view.test.tsx`
Expected: FAIL (missing modules).

- [ ] **Step 3: Implement the confirm button**

`frontend/src/components/admin/confirm-button.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { BUTTON_DANGER, BUTTON_GHOST } from "./ui";

/** A destructive action that asks again inside the page (never the browser's confirm()). */
export function ConfirmButton({ label, confirmLabel, onConfirm, name, disabled = false }: {
  label: string;
  confirmLabel: string;
  onConfirm: () => unknown | Promise<unknown>;
  /** accessible name when several rows carry the same visible label */
  name?: string;
  disabled?: boolean;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (asking) confirmRef.current?.focus();
  }, [asking]);

  if (!asking) {
    return (
      <button type="button" aria-label={name} disabled={disabled} onClick={() => setAsking(true)} className={BUTTON_GHOST}>
        {label}
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap gap-2">
      <button ref={confirmRef} type="button" disabled={busy} className={BUTTON_DANGER} onClick={async () => {
        setBusy(true);
        try {
          await onConfirm();
        } finally {
          setBusy(false);
          setAsking(false);
        }
      }}>
        {confirmLabel}
      </button>
      <button type="button" onClick={() => setAsking(false)} className={BUTTON_GHOST}>ไม่ใช่</button>
    </span>
  );
}
```

- [ ] **Step 4: Implement the reviews view and page**

`frontend/src/components/admin/reviews-view.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useId, useState, type FormEvent } from "react";
import { adminApi, type ReviewQuery } from "@/lib/admin-api";
import { STATUS_LABEL, STATUS_ORDER, formatUsd, formatWhen } from "@/lib/admin-copy";
import type { AdminReview, AdminStatus } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { ConfirmButton } from "./confirm-button";
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT, TABLE_REGION, TD, TH } from "./ui";

const ACTIVE: AdminStatus[] = ["queued", "running"];

export function ReviewsView() {
  const { fail } = useAdmin();
  const [query, setQuery] = useState<ReviewQuery>({});
  const [draft, setDraft] = useState<ReviewQuery>({ q: "", status: "", listed: "" });
  const [items, setItems] = useState<AdminReview[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const qId = useId();
  const statusId = useId();
  const listedId = useId();

  useEffect(() => {
    let alive = true;
    adminApi.reviews(query)
      .then((page) => { if (alive) { setItems(page.items); setNext((page.next as string | null) ?? null); setLoading(false); } })
      .catch((e: unknown) => { if (alive) { setError(fail(e)); setLoading(false); } });
    return () => { alive = false; };
  }, [query, fail]);

  function search(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setNotice(null);
    setQuery({ ...draft });
  }

  async function more() {
    if (!next) return;
    setLoading(true);
    try {
      const page = await adminApi.reviews({ ...query, before: next });
      setItems((prev) => [...prev, ...page.items]);
      setNext((page.next as string | null) ?? null);
    } catch (e) {
      setError(fail(e));
    } finally {
      setLoading(false);
    }
  }

  async function act(id: string, run: () => Promise<AdminReview | null>, done: string) {
    setError(null);
    setNotice(null);
    try {
      const updated = await run();
      setItems((prev) => prev.flatMap((r) => (r.id === id ? (updated ? [updated] : []) : [r])));
      setNotice(done);
    } catch (e) {
      setError(fail(e));
    }
  }

  return (
    <section aria-labelledby="reviews-title" className="py-6">
      <h1 id="reviews-title" className="font-display text-2xl font-semibold">รีวิว</h1>
      <form onSubmit={search} className="mt-4 grid items-end gap-3 md:grid-cols-[2fr_1fr_1fr_auto]">
        <div className="grid gap-1">
          <label htmlFor={qId} className="label">ค้นหาหัวข้อ</label>
          <input id={qId} type="search" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} className={INPUT} />
        </div>
        <div className="grid gap-1">
          <label htmlFor={statusId} className="label">สถานะ</label>
          <select id={statusId} value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as AdminStatus | "" })} className={INPUT}>
            <option value="">ทุกสถานะ</option>
            {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div className="grid gap-1">
          <label htmlFor={listedId} className="label">รายการสาธารณะ</label>
          <select id={listedId} value={draft.listed} onChange={(e) => setDraft({ ...draft, listed: e.target.value as ReviewQuery["listed"] })} className={INPUT}>
            <option value="">ทั้งหมด</option>
            <option value="true">แสดงอยู่</option>
            <option value="false">ซ่อนอยู่</option>
          </select>
        </div>
        <button type="submit" className={BUTTON_PRIMARY}>ค้นหา</button>
      </form>

      {notice && <p role="status" className="mt-4 rounded-sm bg-info-bg px-4 py-2">{notice}</p>}
      {error && <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-2">{error}</p>}

      <div className={TABLE_REGION} role="region" aria-label="รายการรีวิว" tabIndex={0}>
        <table className="w-full min-w-[56rem] border-collapse text-sm">
          <caption className="sr-only">รีวิวทั้งหมด ใหม่สุดก่อน</caption>
          <thead><tr>
            <th scope="col" className={TH}>หัวข้อ</th><th scope="col" className={TH}>สถานะ</th>
            <th scope="col" className={TH}>สร้างเมื่อ</th><th scope="col" className={TH}>ค่าใช้จ่าย</th>
            <th scope="col" className={TH}>รายการสาธารณะ</th><th scope="col" className={TH}>จัดการ</th>
          </tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.id}>
                <th scope="row" className={`${TD} font-normal`}>
                  <Link href={`/r/${r.id}`} className="font-semibold text-primary underline-offset-2 hover:underline">{r.topic}</Link>
                  <span className="mt-1 block text-xs text-muted">
                    {r.review_type}{r.api_key_prefix ? ` · key ${r.api_key_prefix}` : ""}{r.prompt_version ? ` · ${r.prompt_version}` : ""}
                  </span>
                  {r.error && <span className="mt-1 block text-xs text-err">{r.error}</span>}
                </th>
                <td className={TD}>{STATUS_LABEL[r.status] ?? r.status}</td>
                <td className={`${TD} whitespace-nowrap`}>{formatWhen(r.created_at)}</td>
                <td className={`${TD} tabular-nums`}>{formatUsd(r.cost_usd)}</td>
                <td className={TD}>
                  <button type="button" className={BUTTON_GHOST} onClick={() => act(r.id, async () => {
                    const res = await adminApi.setListed(r.id, !r.is_listed);
                    return { ...r, is_listed: res.is_listed };
                  }, r.is_listed ? "ซ่อนรีวิวจากรายการสาธารณะแล้ว" : "แสดงรีวิวในรายการสาธารณะแล้ว")}>
                    {r.is_listed ? "ซ่อน" : "แสดง"}
                  </button>
                </td>
                <td className={TD}>
                  {ACTIVE.includes(r.status) ? (
                    <button type="button" className={BUTTON_GHOST} onClick={() => act(r.id, async () => {
                      await adminApi.cancelReview(r.id);
                      return { ...r, status: "cancelled" };
                    }, "ยกเลิกรีวิวแล้ว")}>ยกเลิก</button>
                  ) : (
                    <ConfirmButton label="ลบ" confirmLabel="ยืนยันลบ" onConfirm={() => act(r.id, async () => {
                      await adminApi.deleteReview(r.id);
                      return null;
                    }, "ลบรีวิวแล้ว")} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && items.length === 0 && !error && <p className="mt-4 text-muted">ไม่พบรีวิว</p>}
      {loading && <p role="status" className="mt-4 text-muted">กำลังโหลด…</p>}
      {next && !loading && <button type="button" onClick={more} className={`mt-4 ${BUTTON_GHOST}`}>โหลดเพิ่ม</button>}
    </section>
  );
}
```

`frontend/src/app/admin/(console)/reviews/page.tsx`:

```tsx
import type { Metadata } from "next";
import { ReviewsView } from "@/components/admin/reviews-view";

export const metadata: Metadata = { title: "รีวิว · ผู้ดูแลระบบ" };

export default function AdminReviewsPage() {
  return <ReviewsView />;
}
```

There are two status regions: the notice and the "กำลังโหลด…" line. In the delete test,
`screen.getByRole("status")` has to find the notice, which it does because loading is false by then. If a test finds
two status regions, query the notice with `getAllByRole("status")` and pick the one with the text. Do not drop
either region.

- [ ] **Step 5: Run the tests, typecheck and lint**

Run: `cd /d/MRA-plan-23a/frontend && npx vitest run src/components/admin && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /d/MRA-plan-23a && git add frontend/src/components/admin/confirm-button.tsx frontend/src/components/admin/confirm-button.test.tsx \
  frontend/src/components/admin/reviews-view.tsx frontend/src/components/admin/reviews-view.test.tsx \
  "frontend/src/app/admin/(console)/reviews/page.tsx"
git commit -m "feat(admin-ui): reviews page with search, filters, cancel, hide/show and confirmed delete (Plan 23a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The API keys page and the audit log page

**Files:**
- Create: `frontend/src/components/admin/keys-view.tsx`, `frontend/src/components/admin/audit-view.tsx`
- Create: `frontend/src/app/admin/(console)/keys/page.tsx`, `frontend/src/app/admin/(console)/audit/page.tsx`
- Test: `frontend/src/components/admin/keys-view.test.tsx`, `frontend/src/components/admin/audit-view.test.tsx`

**Interfaces:**
- Consumes: `adminApi.keys`, `mintKey`, `updateKey`, `revokeKey` and `audit`; `useAdmin`; `ConfirmButton`; `CopyTextButton` (`@/components/ui/copy-text`); `ACTION_LABEL`, `ACTOR_LABEL`, `describeChange` and `formatWhen`.
- Produces: `<KeysView />` and `<AuditView />`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/admin/keys-view.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { KEYS } from "@/test/admin-fixtures";
import { KeysView } from "./keys-view";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/keys" }));

afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

const MINTED = { ...KEYS[0], id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", key_prefix: "mra_newnewne", name: "new lab",
  daily_quota: 20, reviews_24h: 0, key: "mra_newnewnewSECRETSECRETSECRET" };

describe("KeysView", () => {
  it("lists keys with prefix, quota and use", async () => {
    mockAdminFetch((m, p) => (m === "GET" && p === "/keys" ? [200, KEYS] : undefined));
    await renderAdmin(<KeysView />);
    const row = await screen.findByRole("row", { name: /partner lab/ });
    expect(row).toHaveTextContent("mra_abcdefgh");
    expect(row).toHaveTextContent("100");
    expect(row).toHaveTextContent("ใช้งานอยู่");
  });

  it("mints a key, shows it once, and forgets it when closed", async () => {
    const posted: unknown[] = [];
    mockAdminFetch((m, p, body) => {
      if (m === "GET" && p === "/keys") return [200, KEYS];
      if (m === "POST" && p === "/keys") { posted.push(body); return [201, MINTED]; }
    });
    await renderAdmin(<KeysView />);
    await screen.findByRole("row", { name: /partner lab/ });
    fireEvent.change(screen.getByLabelText("ชื่อ key"), { target: { value: "new lab" } });
    fireEvent.change(screen.getByLabelText("โควตาต่อวัน"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("button", { name: "สร้าง key" }));
    expect(await screen.findByText(MINTED.key)).toBeInTheDocument();
    expect(screen.getByText(/แสดงครั้งเดียว/)).toBeInTheDocument();
    expect(posted).toEqual([{ name: "new lab", daily_quota: 20, is_admin: false }]);
    expect(screen.getByRole("row", { name: /new lab/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "เก็บแล้ว ปิด" }));
    expect(screen.queryByText(MINTED.key)).not.toBeInTheDocument();
  });

  it("edits the quota inline", async () => {
    mockAdminFetch((m, p, body) => {
      if (m === "GET" && p === "/keys") return [200, KEYS];
      if (m === "PATCH") return [200, { ...KEYS[0], ...(body as object) }];
    });
    await renderAdmin(<KeysView />);
    const row = await screen.findByRole("row", { name: /partner lab/ });
    fireEvent.click(within(row).getByRole("button", { name: "แก้ไข" }));
    fireEvent.change(within(row).getByLabelText("โควตาต่อวันของ partner lab"), { target: { value: "250" } });
    fireEvent.click(within(row).getByRole("button", { name: "บันทึก" }));
    expect(await within(screen.getByRole("row", { name: /partner lab/ })).findByText("250")).toBeInTheDocument();
  });

  it("revokes after the in-page confirm", async () => {
    mockAdminFetch((m, p) => {
      if (m === "GET" && p === "/keys") return [200, KEYS];
      if (m === "POST" && p.endsWith("/revoke")) return [200, { ...KEYS[0], revoked_at: "2026-10-12T11:00:00Z" }];
    });
    await renderAdmin(<KeysView />);
    const row = await screen.findByRole("row", { name: /partner lab/ });
    fireEvent.click(within(row).getByRole("button", { name: "เพิกถอน" }));
    fireEvent.click(within(row).getByRole("button", { name: "ยืนยันเพิกถอน" }));
    await waitFor(() => expect(screen.getByRole("row", { name: /partner lab/ })).toHaveTextContent("เพิกถอนแล้ว"));
    expect(within(screen.getByRole("row", { name: /partner lab/ })).queryByRole("button", { name: "แก้ไข" })).not.toBeInTheDocument();
  });

  it("shows a validation refusal", async () => {
    mockAdminFetch((m, p) => {
      if (m === "GET" && p === "/keys") return [200, KEYS];
      if (m === "POST") return [422, { detail: "name must not be blank" }];
    });
    await renderAdmin(<KeysView />);
    await screen.findByRole("row", { name: /partner lab/ });
    fireEvent.change(screen.getByLabelText("ชื่อ key"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "สร้าง key" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("name must not be blank");
  });
});
```

`frontend/src/components/admin/audit-view.test.tsx`:

```tsx
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { AUDIT } from "@/test/admin-fixtures";
import { AuditView } from "./audit-view";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/audit" }));

afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

describe("AuditView", () => {
  it("shows who did what with the change", async () => {
    mockAdminFetch((m, p) => (p === "/audit" ? [200, AUDIT] : undefined));
    await renderAdmin(<AuditView />);
    expect(await screen.findByText("แก้ไข API key")).toBeInTheDocument();
    expect(screen.getByText("daily_quota: 10 → 100")).toBeInTheDocument();
    expect(screen.getByText("สร้างบัญชีผู้ดูแล")).toBeInTheDocument();
    expect(screen.getByText("username: owner")).toBeInTheDocument();
    expect(screen.getAllByText(/ผู้ดูแล · owner|CLI · cli/)).toHaveLength(2);
  });

  it("pages with the cursor", async () => {
    mockAdminFetch((m, p) => {
      if (p === "/audit") return [200, { items: [AUDIT.items[0]], next: 2 }];
      if (p === "/audit?before=2") return [200, { items: [AUDIT.items[1]], next: null }];
    });
    await renderAdmin(<AuditView />);
    fireEvent.click(await screen.findByRole("button", { name: "โหลดเพิ่ม" }));
    expect(await screen.findByText("สร้างบัญชีผู้ดูแล")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23a/frontend && npx vitest run src/components/admin/keys-view.test.tsx src/components/admin/audit-view.test.tsx`
Expected: FAIL (missing modules).

- [ ] **Step 3: Implement the keys view**

`frontend/src/components/admin/keys-view.tsx`:

```tsx
"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import { CopyTextButton } from "@/components/ui/copy-text";
import { adminApi } from "@/lib/admin-api";
import { formatWhen } from "@/lib/admin-copy";
import type { AdminKey, MintedKey } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { ConfirmButton } from "./confirm-button";
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT, TABLE_REGION, TD, TH } from "./ui";

function KeyRow({ k, onSaved, onError }: { k: AdminKey; onSaved: (k: AdminKey, note: string) => void; onError: (e: unknown) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(k.name);
  const [quota, setQuota] = useState(String(k.daily_quota));
  const revoked = k.revoked_at !== null;

  async function save() {
    try {
      const body: { name?: string; daily_quota?: number } = {};
      if (name.trim() !== k.name) body.name = name.trim();
      if (Number(quota) !== k.daily_quota) body.daily_quota = Number(quota);
      onSaved(await adminApi.updateKey(k.id, body), "บันทึกการแก้ไข key แล้ว");
      setEditing(false);
    } catch (e) {
      onError(e);
    }
  }

  return (
    <tr>
      <th scope="row" className={`${TD} font-normal`}>
        {editing ? (
          <input aria-label={`ชื่อของ ${k.name}`} value={name} onChange={(e) => setName(e.target.value)} className={INPUT} />
        ) : (
          <span className="font-semibold">{k.name}</span>
        )}
        <span className="mt-1 block text-xs text-muted tabular-nums">{k.key_prefix ?? "—"}{k.is_admin ? " · admin" : ""}</span>
      </th>
      <td className={`${TD} tabular-nums`}>
        {editing ? (
          <input aria-label={`โควตาต่อวันของ ${k.name}`} type="number" min={1} max={100000} value={quota}
            onChange={(e) => setQuota(e.target.value)} className={`${INPUT} w-28`} />
        ) : k.daily_quota}
      </td>
      <td className={`${TD} tabular-nums`}>{k.reviews_24h}</td>
      <td className={`${TD} whitespace-nowrap`}>{formatWhen(k.created_at)}</td>
      <td className={TD}>{revoked ? `เพิกถอนแล้ว ${formatWhen(k.revoked_at)}` : "ใช้งานอยู่"}</td>
      <td className={TD}>
        {!revoked && (
          <span className="flex flex-wrap gap-2">
            {editing ? (
              <>
                <button type="button" onClick={save} className={BUTTON_PRIMARY}>บันทึก</button>
                <button type="button" onClick={() => setEditing(false)} className={BUTTON_GHOST}>ยกเลิก</button>
              </>
            ) : (
              <button type="button" onClick={() => setEditing(true)} className={BUTTON_GHOST}>แก้ไข</button>
            )}
            <ConfirmButton label="เพิกถอน" confirmLabel="ยืนยันเพิกถอน" onConfirm={async () => {
              try {
                onSaved(await adminApi.revokeKey(k.id), "เพิกถอน key แล้ว");
              } catch (e) {
                onError(e);
              }
            }} />
          </span>
        )}
      </td>
    </tr>
  );
}

export function KeysView() {
  const { fail } = useAdmin();
  const [keys, setKeys] = useState<AdminKey[] | null>(null);
  const [minted, setMinted] = useState<MintedKey | null>(null);
  const [name, setName] = useState("");
  const [quota, setQuota] = useState("100");
  const [isAdmin, setIsAdmin] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const nameId = useId();
  const quotaId = useId();

  useEffect(() => {
    let alive = true;
    adminApi.keys().then((k) => { if (alive) setKeys(k); }).catch((e: unknown) => { if (alive) setError(fail(e)); });
    return () => { alive = false; };
  }, [fail]);

  function saved(k: AdminKey, note: string) {
    setKeys((prev) => (prev ?? []).map((x) => (x.id === k.id ? k : x)));
    setNotice(note);
    setError(null);
  }

  async function mint(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const key = await adminApi.mintKey({ name: name.trim(), daily_quota: Number(quota), is_admin: isAdmin });
      setMinted(key);
      setKeys((prev) => [key, ...(prev ?? [])]);
      setName("");
      setIsAdmin(false);
    } catch (err) {
      setError(fail(err));
    }
  }

  return (
    <section aria-labelledby="keys-title" className="py-6">
      <h1 id="keys-title" className="font-display text-2xl font-semibold">API keys</h1>

      <form onSubmit={mint} className="mt-4 grid items-end gap-3 md:grid-cols-[2fr_1fr_auto_auto]">
        <div className="grid gap-1">
          <label htmlFor={nameId} className="label">ชื่อ key</label>
          <input id={nameId} value={name} maxLength={100} onChange={(e) => setName(e.target.value)} className={INPUT} />
        </div>
        <div className="grid gap-1">
          <label htmlFor={quotaId} className="label">โควตาต่อวัน</label>
          <input id={quotaId} type="number" min={1} max={100000} value={quota} onChange={(e) => setQuota(e.target.value)} className={INPUT} />
        </div>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input type="checkbox" checked={isAdmin} onChange={(e) => setIsAdmin(e.target.checked)} className="size-5 accent-primary" />
          <span>สิทธิ์ admin</span>
        </label>
        <button type="submit" disabled={!name.trim()} className={BUTTON_PRIMARY}>สร้าง key</button>
      </form>

      {minted && (
        <div className="mt-4 rounded-sm bg-warn-bg px-4 py-3">
          <p className="font-display font-semibold">key ของ {minted.name}: แสดงครั้งเดียว เก็บไว้ตอนนี้ ระบบไม่เก็บตัว key ไว้ให้ดูอีก</p>
          <p className="mt-2 break-all text-sm">{minted.key}</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <CopyTextButton text={minted.key} label="คัดลอก key" copied="คัดลอกแล้ว" failed="คัดลอกไม่ได้ เลือกข้อความด้านล่างแล้วคัดลอกเอง" boxLabel="API key" />
            <button type="button" onClick={() => setMinted(null)} className={BUTTON_GHOST}>เก็บแล้ว ปิด</button>
          </div>
        </div>
      )}
      {notice && <p role="status" className="mt-4 rounded-sm bg-info-bg px-4 py-2">{notice}</p>}
      {error && <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-2">{error}</p>}

      {keys === null && !error && <p role="status" className="mt-4 text-muted">กำลังโหลด…</p>}
      {keys && (
        <div className={TABLE_REGION} role="region" aria-label="รายการ API key" tabIndex={0}>
          <table className="w-full min-w-[52rem] border-collapse text-sm">
            <caption className="sr-only">API key ทั้งหมด ใหม่สุดก่อน</caption>
            <thead><tr>
              <th scope="col" className={TH}>ชื่อ</th><th scope="col" className={TH}>โควตา/วัน</th>
              <th scope="col" className={TH}>ใช้ใน 24 ชม.</th><th scope="col" className={TH}>สร้างเมื่อ</th>
              <th scope="col" className={TH}>สถานะ</th><th scope="col" className={TH}>จัดการ</th>
            </tr></thead>
            <tbody>{keys.map((k) => <KeyRow key={`${k.id}:${k.revoked_at ?? ""}:${k.daily_quota}:${k.name}`} k={k} onSaved={saved} onError={(e) => setError(fail(e))} />)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
```

The row `key` changes when a key is saved, which resets the row's local edit state to the server values.
`KeyRow`'s inputs have explicit `aria-label`s ("โควตาต่อวันของ partner lab"); the test relies on them.

- [ ] **Step 4: Implement the audit view and both pages**

`frontend/src/components/admin/audit-view.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { ACTION_LABEL, ACTOR_LABEL, describeChange, formatWhen } from "@/lib/admin-copy";
import type { AuditEntry } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { BUTTON_GHOST } from "./ui";

export function AuditView() {
  const { fail } = useAdmin();
  const [items, setItems] = useState<AuditEntry[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    adminApi.audit()
      .then((page) => { if (alive) { setItems(page.items); setNext((page.next as number | null) ?? null); } })
      .catch((e: unknown) => { if (alive) setError(fail(e)); });
    return () => { alive = false; };
  }, [fail]);

  async function more() {
    setLoading(true);
    try {
      const page = await adminApi.audit(next);
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setNext((page.next as number | null) ?? null);
    } catch (e) {
      setError(fail(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section aria-labelledby="audit-title" className="py-6">
      <h1 id="audit-title" className="font-display text-2xl font-semibold">Audit log</h1>
      <p className="mt-2 text-sm text-muted">ทุกการแก้ไขในหน้า admin และจาก CLI ใหม่สุดก่อน</p>
      {error && <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-2">{error}</p>}
      {items === null && !error && <p role="status" className="mt-4 text-muted">กำลังโหลด…</p>}
      {items && items.length === 0 && <p className="mt-4 text-muted">ยังไม่มีรายการ</p>}
      {items && items.length > 0 && (
        <ol className="mt-4 border-t border-rule">
          {items.map((a) => (
            <li key={a.id} className="grid gap-1 border-b border-rule py-3 md:grid-cols-[12rem_1fr]">
              <span className="text-sm text-muted">{formatWhen(a.created_at)}</span>
              <div className="min-w-0">
                <p>
                  <span className="font-display font-semibold">{ACTION_LABEL[a.action] ?? a.action}</span>
                  <span className="text-sm text-muted">{` · ${ACTOR_LABEL[a.actor_kind]} · ${a.actor_label}`}</span>
                </p>
                {a.target_type && <p className="break-all text-xs text-muted">{`${a.target_type} ${a.target_id ?? ""}`}</p>}
                <ul className="mt-1 text-sm">
                  {describeChange(a.before, a.after).map((line) => <li key={line} className="break-words">{line}</li>)}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      )}
      {next !== null && <button type="button" onClick={more} disabled={loading} className={`mt-4 ${BUTTON_GHOST}`}>โหลดเพิ่ม</button>}
    </section>
  );
}
```

`frontend/src/app/admin/(console)/keys/page.tsx`:

```tsx
import type { Metadata } from "next";
import { KeysView } from "@/components/admin/keys-view";

export const metadata: Metadata = { title: "API keys · ผู้ดูแลระบบ" };

export default function AdminKeysPage() {
  return <KeysView />;
}
```

`frontend/src/app/admin/(console)/audit/page.tsx`:

```tsx
import type { Metadata } from "next";
import { AuditView } from "@/components/admin/audit-view";

export const metadata: Metadata = { title: "Audit log · ผู้ดูแลระบบ" };

export default function AdminAuditPage() {
  return <AuditView />;
}
```

- [ ] **Step 5: Run the whole frontend suite, typecheck and lint**

Run: `cd /d/MRA-plan-23a/frontend && npm test && npm run typecheck && npm run lint`
Expected: PASS (every existing test still passes).

- [ ] **Step 6: Commit**

```bash
cd /d/MRA-plan-23a && git add frontend/src/components/admin/keys-view.tsx frontend/src/components/admin/keys-view.test.tsx \
  frontend/src/components/admin/audit-view.tsx frontend/src/components/admin/audit-view.test.tsx \
  "frontend/src/app/admin/(console)/keys/page.tsx" "frontend/src/app/admin/(console)/audit/page.tsx"
git commit -m "feat(admin-ui): API keys page (mint shown once, inline edit, confirmed revoke) and the audit log page (Plan 23a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: End-to-end flow, accessibility and layout (Playwright, mocked admin API)

**Files:**
- Create: `frontend/e2e/admin.spec.ts`

**Interfaces:**
- Consumes: the pages from Tasks 9–12; `mockApi` from `e2e/mock-api.ts` for the public API calls the site chrome makes; and fixtures from `src/test/admin-fixtures.ts`.

- [ ] **Step 1: Write the spec**

`frontend/e2e/admin.spec.ts`:

```ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import { AUDIT, DASHBOARD, KEYS, REVIEWS } from "../src/test/admin-fixtures";
import { mockApi } from "./mock-api";

const PASSWORD = "correct horse battery staple";
const MINTED_KEY = "mra_e2eKEYe2eKEYe2eKEYe2eKEYe2eKEY";

/** A stateful fake of /api/v1/admin (same origin): sign-in, keys that can be minted and revoked, an audit log that grows. */
async function mockAdmin(page: Page, { signedIn = false } = {}) {
  let session = signedIn;
  const keys = KEYS.map((k) => ({ ...k }));
  const audit = AUDIT.items.map((a) => ({ ...a }));
  let nextId = 100;
  const log = (action: string, after: Record<string, unknown> | null = null) =>
    audit.unshift({ id: nextId++, created_at: new Date().toISOString(), actor_kind: "user", actor_label: "owner", action,
      target_type: "key", target_id: "k", before: null, after });
  await page.route("**/api/v1/admin/**", async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/api/v1/admin", "");
    const method = req.method();
    const reply = (status: number, body?: unknown) =>
      route.fulfill({ status, contentType: "application/json", body: body === undefined ? "" : JSON.stringify(body) });
    if (method !== "GET" && req.headers()["x-mra-admin"] !== "1") return reply(403, { detail: "the X-MRA-Admin: 1 header is required" });
    if (path === "/session" && method === "POST") {
      if (req.postDataJSON().password !== PASSWORD) return reply(401, { detail: "invalid username or password" });
      session = true;
      return reply(204);
    }
    if (!session) return reply(401, { detail: "sign in required" });
    if (path === "/session" && method === "DELETE") { session = false; return reply(204); }
    if (path === "/me") return reply(200, { kind: "user", label: "owner" });
    if (path === "/dashboard") return reply(200, DASHBOARD);
    if (path === "/reviews") return reply(200, REVIEWS);
    if (path === "/keys" && method === "GET") return reply(200, keys);
    if (path === "/keys" && method === "POST") {
      const body = req.postDataJSON();
      const key = { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", key_prefix: MINTED_KEY.slice(0, 12), name: body.name,
        daily_quota: body.daily_quota, is_admin: body.is_admin, created_at: new Date().toISOString(), revoked_at: null, reviews_24h: 0 };
      keys.unshift(key);
      log("key.mint", { key_prefix: key.key_prefix, name: key.name });
      return reply(201, { ...key, key: MINTED_KEY });
    }
    const revoke = path.match(/^\/keys\/([^/]+)\/revoke$/);
    if (revoke && method === "POST") {
      const key = keys.find((k) => k.id === revoke[1])!;
      key.revoked_at = new Date().toISOString();
      log("key.revoke", { revoked: true });
      return reply(200, key);
    }
    if (path === "/audit") return reply(200, { items: audit, next: null });
    return reply(404, { detail: `no mock for ${method} ${path}` });
  });
}

async function noSeriousA11y(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`)).toEqual([]);
}

async function noHorizontalScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
}

test("sign in, mint and revoke a key, see both in the audit log, sign out", async ({ page }) => {
  await mockApi(page);
  await mockAdmin(page);
  await page.goto("/admin");
  await page.getByLabel("ชื่อผู้ใช้").fill("owner");
  await page.getByLabel("รหัสผ่าน").fill("wrong password");
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");  // Next's route announcer is an alert too
  await page.getByLabel("รหัสผ่าน").fill(PASSWORD);
  await page.getByRole("button", { name: "เข้าสู่ระบบ" }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("รับรีวิวใหม่อยู่")).toBeVisible();

  await page.getByRole("navigation", { name: "ผู้ดูแลระบบ" }).getByRole("link", { name: "API keys" }).click();
  await page.getByLabel("ชื่อ key").fill("e2e lab");
  await page.getByRole("button", { name: "สร้าง key" }).click();
  await expect(page.getByText(MINTED_KEY)).toBeVisible();
  await page.getByRole("button", { name: "เก็บแล้ว ปิด" }).click();
  await expect(page.getByText(MINTED_KEY)).toHaveCount(0);
  const row = page.getByRole("row", { name: /e2e lab/ });
  await row.getByRole("button", { name: "เพิกถอน" }).click();
  await row.getByRole("button", { name: "ยืนยันเพิกถอน" }).click();
  await expect(page.getByRole("row", { name: /e2e lab/ })).toContainText("เพิกถอนแล้ว");

  await page.getByRole("navigation", { name: "ผู้ดูแลระบบ" }).getByRole("link", { name: "Audit log" }).click();
  await expect(page.getByText("สร้าง API key")).toBeVisible();
  await expect(page.getByText("เพิกถอน API key")).toBeVisible();

  await page.getByRole("button", { name: "ออกจากระบบ" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { level: 1, name: "เข้าสู่ระบบผู้ดูแล" })).toBeVisible();
});

test("a signed-out visit to a console page goes to sign-in", async ({ page }) => {
  await mockApi(page);
  await mockAdmin(page);
  await page.goto("/admin/keys");
  await expect(page).toHaveURL(/\/admin$/);
});

for (const scheme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`admin pages at ${width}px (${scheme}): no sideways scroll, axe-clean, noindex`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await mockApi(page);
      await mockAdmin(page, { signedIn: true });
      for (const path of ["/admin/dashboard", "/admin/reviews", "/admin/keys", "/admin/audit"]) {
        await page.goto(path);
        await expect(page.getByRole("navigation", { name: "ผู้ดูแลระบบ" })).toBeVisible();
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await noHorizontalScroll(page);
        await noSeriousA11y(page);
        await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      }
    });
  }
}
```

- [ ] **Step 2: Run the spec**

Run: `cd /d/MRA-plan-23a/frontend && npx playwright test e2e/admin.spec.ts`
Expected: PASS. The first run builds the app, which takes a few minutes. When an axe or layout check fails, fix the
page (contrast, labels, overflowing table wrappers) and do not loosen the check. The tables scroll inside their own
`TABLE_REGION`, so the page itself must never scroll sideways at 390px.

- [ ] **Step 3: Run the whole e2e suite once**

Run: `cd /d/MRA-plan-23a/frontend && npm run e2e`
Expected: every spec passes. Report any pre-existing failure separately; do not fix unrelated specs in this plan.

- [ ] **Step 4: Commit**

```bash
cd /d/MRA-plan-23a && git add frontend/e2e/admin.spec.ts
git commit -m "test(admin-ui): e2e sign-in, key mint and revoke, audit and sign-out; axe and layout at 1440/390 (Plan 23a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Docs, merge, docker rebuild and the smoke check

**Files:**
- Modify: `docs/api.md` (new "Admin API" section; the `POST /admin/mcp/reload` row moves into it)
- Modify: `README.md` (an "Admin console" bullet in "Integrations")
- Modify: `docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md` (row 23: 23a done)
- After the merge, on master: root `CLAUDE.md`, one convention line (crafted blob; see Step 5)

- [ ] **Step 1: Write the `docs/api.md` section**

In the Routes table, delete the `POST /admin/mcp/reload` row. Insert this section just before `## Paper count and pool (Plan 21)`:

```markdown
## Admin API (Plan 23a)

The admin console (`/admin` on the site address) and scripts use these routes. They are **not in the public
OpenAPI**. All are under `/api/v1/admin` and need either:
- **a signed-in admin**: the `mra_admin` cookie from `POST /admin/session`. The cookie is HttpOnly, SameSite=Strict
  and `Path=/api/v1/admin`, lasts 8 hours (`ADMIN_SESSION_TTL_SECONDS`), and is Secure when `PUBLIC_BASE_URL` is
  https. Cookie-authenticated `POST`, `PATCH` and `DELETE` (and the sign-in itself) must send `X-MRA-Admin: 1`;
  without it the answer is **403**.
- **an admin API key** (`--admin`), sent as on every other route. Key requests need no `X-MRA-Admin` header.

Admins are created only with the CLI:
`docker compose exec api python -m app.cli.admin create --username <name>` (also `passwd`, `disable`, `enable`,
`list`). `passwd` and `disable` end that admin's sessions.

Five failed sign-ins within 15 minutes (`ADMIN_LOGIN_MAX_FAILURES`, `ADMIN_LOCKOUT_SECONDS`), counted per username
and per address, lock that username or address. The answer is **429** with `Retry-After`. Every change below, and
every sign-in, sign-out and lockout, is written to the audit log with the actor, before, after and time. The log
never holds a password, hash, key or token.

| Method and path | Success | Errors |
|---|---|---|
| `POST /admin/session` `{username, password}` | 204 + `Set-Cookie: mra_admin=…` | 401, 403 (no `X-MRA-Admin`), 422, 429 |
| `DELETE /admin/session` | 204, cookie cleared | 401 |
| `GET /admin/me` | 200 `{kind: "user" \| "key", label}` | 401, 403 |
| `GET /admin/dashboard?days=30` (1–90) | 200 `{days, since, per_day, totals, error_rate_7d, by_model, capacity}`. Days are UTC. `by_model` groups review cost by synthesizer model, since cost is stored per review | 401, 403, 422 |
| `GET /admin/reviews?q=&status=&listed=&before=&limit=50` | 200 `{items, next}`, newest first. `q` is a literal, case-insensitive topic match | 401, 403, 422 |
| `POST /admin/reviews/{id}/cancel` | 200 `{id, status: "cancelled"}`; the event says `by: "admin"` | 401, 403, 404, 409 |
| `PATCH /admin/reviews/{id}` `{is_listed}` | 200 `{id, is_listed}` (shown or hidden in the public recent list) | 401, 403, 404, 422 |
| `DELETE /admin/reviews/{id}` | 204. Finished reviews only; its events, paper links, live stream and checkpoint go too | 401, 403, 404, 409 (cancel it first) |
| `GET /admin/keys` | 200 `[{id, key_prefix, name, daily_quota, is_admin, created_at, revoked_at, reviews_24h}]` | 401, 403 |
| `POST /admin/keys` `{name, daily_quota=100, is_admin=false}` | 201 with `key` (shown once) | 401, 403, 422 |
| `PATCH /admin/keys/{id}` `{name?, daily_quota?}` | 200 key | 401, 403, 404, 409 (revoked), 422 |
| `POST /admin/keys/{id}/revoke` | 200 key (idempotent) | 401, 403, 404 |
| `GET /admin/audit?before=&limit=50` | 200 `{items, next}`, newest first | 401, 403, 422 |
| `POST /admin/mcp/reload` | 200 `{servers, path}` (validates `config/mcp_servers.json`) | 401, 403, 422 |
```

Also change the authentication bullet near the top of `docs/api.md`. It currently says keys are minted with the CLI;
add one sentence: "Keys can also be minted, edited and revoked in the admin console (see Admin API)."

- [ ] **Step 2: README and roadmap**

`README.md`, "Integrations: REST, MCP, API keys, webhooks": add a bullet after the API keys bullet:

```markdown
- **Admin console** at `/admin` on the site address (`http://localhost:8088/admin` locally, through Caddy; it does
  not work on the web container's own port). Create the first admin with
  `docker compose exec api python -m app.cli.admin create --username <name>`. The console has a dashboard, review
  management (cancel, hide or show, delete), API keys (mint, edit, revoke) and an audit log of every change. See
  `docs/api.md` → Admin API.
```

Roadmap row 23 (`docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md`): append to the Scope cell:
`**23a done (2026-10-12):** sign-in (argon2id, Redis sessions, lockout), dashboard, reviews, API keys and the audit log; spec ../specs/2026-10-12-plan-23a-admin-console-design.md. 23b (models) and 23c (settings, glossary, harness) next.`

- [ ] **Step 3: Commit the docs**

```bash
cd /d/MRA-plan-23a && git add docs/api.md README.md docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md
git commit -m "docs(admin): Admin API reference, README admin console note, roadmap 23a done (Plan 23a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Final checks on the branch**

Run: `cd /d/MRA-plan-23a/backend && uv run pytest -q && uv run ruff check .`
Run: `cd /d/MRA-plan-23a/frontend && npm test && npm run typecheck && npm run lint`
Expected: everything passes. The only exception is the known flaky `test_queue_position`; report it if it fails.

- [ ] **Step 5: Merge into master and add the CLAUDE.md line without touching the owner's uncommitted edits**

The whole-branch review from the execution skill must come before this step. The main worktree has uncommitted edits
to `CLAUDE.md`, `frontend/CLAUDE.md` and `infra/searxng/limiter.toml.new`, and none of them may be staged or changed.
The branch does not touch those files, so a normal merge is safe:

```bash
cd /d/MedicalReviewerAgent && git status --short   # expect only the owner's three entries
git merge --no-ff plan-23a-admin-console -m "Merge plan-23a-admin-console: admin console (sign-in, dashboard, reviews, API keys, audit log)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Then add the convention line to the committed `CLAUDE.md` only, by building a blob from `HEAD:CLAUDE.md` plus the
line. Do not stage the working-tree file:

```bash
cd /d/MedicalReviewerAgent
git show HEAD:CLAUDE.md > /tmp/claude-md-head.txt
cat >> /tmp/claude-md-head.txt <<'EOF'
- Admin console (Plan 23a): `require_admin` (`app/api/auth.py`) accepts the `mra_admin` session cookie (Redis, `app/services/admin_sessions.py`) or an admin API key; cookie writes need `X-MRA-Admin: 1`; admin routes are registered with `include_in_schema=False` and documented in `docs/api.md`; every admin change writes its `admin_audit` row (`app/services/audit.py`) in the same transaction; admins come only from `python -m app.cli.admin`.
EOF
BLOB=$(git hash-object -w /tmp/claude-md-head.txt)
git update-index --cacheinfo 100644,$BLOB,CLAUDE.md
git commit -m "docs(claude): admin console convention line (Plan 23a)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git status --short   # still exactly the owner's three entries; CLAUDE.md stays modified in the working tree
```

Use the scratchpad directory instead of `/tmp` if the session lists one. Check that `git show HEAD:CLAUDE.md | tail -2`
ends with the new line and that `git diff CLAUDE.md` still shows the owner's own edits.

- [ ] **Step 6: Rebuild docker and run the smoke check through Caddy**

```bash
cd /d/MedicalReviewerAgent && docker compose build migrate api worker web && docker compose up -d
docker compose ps   # api healthy, web up, caddy up; migrate exited 0
PW="smoke-$(openssl rand -hex 12)"
printf '%s\n' "$PW" | docker compose exec -T api python -m app.cli.admin create --username smoke --password-stdin
JAR="$(mktemp)"
curl -s -o /dev/null -w "sign-in %{http_code}\n" -c "$JAR" -H "X-MRA-Admin: 1" -H "Content-Type: application/json" \
  -d "{\"username\":\"smoke\",\"password\":\"$PW\"}" http://localhost:8088/api/v1/admin/session      # 204
curl -s -b "$JAR" "http://localhost:8088/api/v1/admin/dashboard?days=7" | head -c 400; echo          # JSON with "capacity"
curl -s -o /dev/null -w "sign-out %{http_code}\n" -b "$JAR" -c "$JAR" -X DELETE -H "X-MRA-Admin: 1" \
  http://localhost:8088/api/v1/admin/session                                                          # 204
curl -s -o /dev/null -w "me after sign-out %{http_code}\n" -b "$JAR" http://localhost:8088/api/v1/admin/me  # 401
curl -s http://localhost:8088/api/openapi.json | grep -c "/api/v1/admin" || true                      # 0
curl -s -o /dev/null -w "admin page %{http_code}\n" http://localhost:8088/admin                         # 200
docker compose exec -T api python -m app.cli.admin disable smoke
rm -f "$JAR"
```

Expected: the codes in the comments. Report each result exactly. When one differs, stop and investigate before
telling the owner the console is ready.

- [ ] **Step 7: Clean up and record**

- Remove the worktree with `git worktree remove ../MRA-plan-23a` and keep the branch.
- Update the memory file `plan-22a-resume-state.md`, or write a new `plan-23a-state.md` and add it to the
  `MEMORY.md` index. Record:
  - 23a merged.
  - 23b and 23c are next.
  - The smoke admin was disabled.
  - The owner creates their own admin with `docker compose exec api python -m app.cli.admin create --username <name>`.
