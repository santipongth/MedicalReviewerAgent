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
