"""LLM provider keys entered in the admin console (Plan 23e). A key is stored encrypted in llm_provider_keys, never in
a config version, and is write-only: nothing here returns it except to build a client. The master secret is
LLM_KEYS_SECRET (env only): one or more comma-separated Fernet keys, newest first; the first encrypts, all decrypt.

What is encrypted is {"v": 1, "provider", "origin", "key"}: on decrypt the provider and origin must equal the row's, so
a row copied to another provider, or an edited bound_origin, reads as unreadable (Fernet has no associated data).

A key is bound to the origin (scheme://host[:port]) it was saved for. resolve_key gives, per provider: a readable
console key whose origin matches → console; one bound to another origin → none (and no env fallback, or a base_url
change would redirect the env key instead); otherwise the env key (a free name only with LLM_KEY_<NAME>_ORIGIN equal
to the provider's origin). Nothing here logs a key, a payload or the secret."""
from __future__ import annotations

import json
import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db.models import LlmProviderKey
from app.logging import get_logger
from app.services.llm_config import (
    PROVIDER_KEYS,
    VISIBLE_ASCII,
    ProviderSpec,
    key_env,
    provider_origin,
    url_origin,
)

log = get_logger(__name__)

KEY_MIN, KEY_MAX = 8, 512
KEY_TEXT_ERROR = "the key must be 8 to 512 visible characters without spaces"
LAST4_MIN = 12  # a shorter key shows no last 4 characters: they would be a third of it
PAYLOAD_VERSION = 1
# Postgres advisory-lock key that serialises key writes ("MRALLMKY"), like LLM_SAVE_LOCK for config saves
LLM_KEYS_LOCK = 0x4D52_414C_4C4D_4B59
SecretState = Literal["ok", "no_secret", "bad_secret"]
_reported_bad_secret = False


class KeyTextError(ValueError):
    """A key that cannot be stored. The message is fixed and never quotes the input."""

    def __init__(self) -> None:
        super().__init__(KEY_TEXT_ERROR)


def _secret_parts(settings: Settings) -> list[str]:
    return [p.strip() for p in settings.llm_keys_secret.get_secret_value().split(",") if p.strip()]


def secret_state(settings: Settings) -> SecretState:
    """ok, no_secret (unset) or bad_secret (a part that is not a Fernet key: 32 bytes in URL-safe base64)."""
    global _reported_bad_secret
    parts = _secret_parts(settings)
    if not parts:
        return "no_secret"
    try:
        for part in parts:
            Fernet(part)
    except (ValueError, TypeError):
        if not _reported_bad_secret:
            _reported_bad_secret = True
            log.error("llm_keys_secret_invalid", parts=len(parts))
        return "bad_secret"
    return "ok"


def cipher(settings: Settings) -> MultiFernet | None:
    """The MultiFernet of LLM_KEYS_SECRET, or None when it is missing or bad (stored keys are then unreadable)."""
    if secret_state(settings) != "ok":
        return None
    return MultiFernet([Fernet(part) for part in _secret_parts(settings)])


def generate_secret() -> str:
    return Fernet.generate_key().decode("ascii")


def clean_key(raw: object) -> str:
    """The key as stored: surrounding whitespace dropped (a pasted key often ends in a newline), then 8 to 512 visible
    ASCII characters, so it is always a valid Authorization or x-api-key header value."""
    if not isinstance(raw, str):
        raise KeyTextError
    key = raw.strip()
    if not KEY_MIN <= len(key) <= KEY_MAX or not VISIBLE_ASCII.fullmatch(key):
        raise KeyTextError
    return key


def last4_of(key: str) -> str | None:
    return key[-4:] if len(key) >= LAST4_MIN else None


def seal(fernet: MultiFernet, provider: str, origin: str, key: str) -> str:
    payload = {"v": PAYLOAD_VERSION, "provider": provider, "origin": origin, "key": key}
    return fernet.encrypt(json.dumps(payload).encode("utf-8")).decode("ascii")


def open_row(fernet: MultiFernet | None, row: LlmProviderKey) -> str | None:
    """The stored key, or None when the row is a tombstone or unreadable: no secret, another secret, a token that is not
    Fernet's, or a payload that does not name this row's provider and origin."""
    if fernet is None or row.ciphertext is None:
        return None
    try:
        payload = json.loads(fernet.decrypt(row.ciphertext.encode("ascii")))
    except (InvalidToken, ValueError, UnicodeError):
        log.warning("llm_key_unreadable", provider=row.provider)
        return None
    if (not isinstance(payload, dict) or payload.get("v") != PAYLOAD_VERSION
            or payload.get("provider") != row.provider or payload.get("origin") != row.bound_origin
            or not isinstance(payload.get("key"), str)):
        log.warning("llm_key_unreadable", provider=row.provider)
        return None
    return payload["key"]


@dataclass(frozen=True)
class StoredKey:
    value: str = field(repr=False)
    origin: str
    last4: str | None


@dataclass(frozen=True)
class KeyRing:
    """Every readable console key of one moment, decrypted once. Its repr names providers only."""

    entries: dict[str, StoredKey] = field(default_factory=dict)
    unreadable: frozenset[str] = frozenset()
    revision: int | None = None
    state: SecretState = "ok"

    def __repr__(self) -> str:
        return (f"KeyRing(providers={sorted(self.entries)}, unreadable={sorted(self.unreadable)}, "
                f"revision={self.revision}, state={self.state})")

    __str__ = __repr__


async def live_rows(session: AsyncSession) -> list[LlmProviderKey]:
    stmt = select(LlmProviderKey).order_by(LlmProviderKey.provider)
    return list((await session.execute(stmt)).scalars())


async def load_keyring(session: AsyncSession, settings: Settings) -> KeyRing:
    fernet, state = cipher(settings), secret_state(settings)
    entries: dict[str, StoredKey] = {}
    unreadable: set[str] = set()
    revision: int | None = None
    for row in await live_rows(session):
        revision = max(revision or 0, row.revision)
        if row.ciphertext is None:
            continue
        value = open_row(fernet, row)
        if value is None:
            unreadable.add(row.provider)
        else:
            entries[row.provider] = StoredKey(value, row.bound_origin or "", row.last4)
    return KeyRing(entries, frozenset(unreadable), revision, state)


@dataclass(frozen=True)
class KeyChoice:
    """The key a provider's calls use: `source` console, env or none; `problem` origin_mismatch, unreadable or
    env_origin_missing (null when there is none); `bound_origin` the origin a mismatched stored key belongs to."""

    value: str | None = field(repr=False)
    source: Literal["console", "env", "none"]
    problem: str | None = None
    bound_origin: str | None = None


def env_key(name: str, origin: str, settings: Settings | None,
            environ: Mapping[str, str] | None = None) -> tuple[str, str | None]:
    """(env key, problem). A legacy name reads its Settings field, then the environment (unbound, as before Plan 23e).
    A free name reads only os.environ's LLM_KEY_<NAME> (never Settings, so no other field is reachable), and only when
    LLM_KEY_<NAME>_ORIGIN is the provider's origin."""
    environ = os.environ if environ is None else environ
    if name in PROVIDER_KEYS:
        variable = PROVIDER_KEYS[name]
        return str(getattr(settings, variable.lower(), "") or environ.get(variable, "")), None
    variable = key_env(name)
    value = environ.get(variable, "")
    if not value:
        return "", None
    bound = environ.get(f"{variable}_ORIGIN", "")
    try:
        same = bool(bound) and url_origin(bound) == origin
    except ValueError:
        same = False
    return (value, None) if same else ("", "env_origin_missing")


def resolve_key(name: str, spec: ProviderSpec, ring: KeyRing | None, settings: Settings | None,
                environ: Mapping[str, str] | None = None) -> KeyChoice:
    origin = provider_origin(name, spec)
    stored = ring.entries.get(name) if ring is not None else None
    if stored is not None:
        if stored.origin == origin:
            return KeyChoice(stored.value, "console")
        return KeyChoice(None, "none", "origin_mismatch", stored.origin)
    problem = "unreadable" if ring is not None and name in ring.unreadable else None
    value, env_problem = env_key(name, origin, settings, environ)
    if value:
        return KeyChoice(value, "env", problem)
    return KeyChoice(None, "none", problem or env_problem)


async def _lock(session: AsyncSession) -> None:
    if session.get_bind().dialect.name == "postgresql":  # READ COMMITTED would let two writes take one revision
        await session.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": LLM_KEYS_LOCK})


async def keys_revision(session: AsyncSession) -> int | None:
    """The keys version: the newest revision (None while the table is empty). Rows are never deleted, so it only
    grows."""
    return await session.scalar(select(func.max(LlmProviderKey.revision)))


async def _next_revision(session: AsyncSession) -> int:
    return int(await keys_revision(session) or 0) + 1


async def store_key(session: AsyncSession, fernet: MultiFernet, provider: str, origin: str, key: str, *,
                    by: str) -> tuple[LlmProviderKey, bool]:
    """Set or replace a provider's key (the caller commits). Returns the row and whether a live key was replaced."""
    await _lock(session)
    revision = await _next_revision(session)  # before the row joins the session: the query would flush it half-made
    row = await session.get(LlmProviderKey, provider)
    replaced = row is not None and row.ciphertext is not None
    if row is None:
        row = LlmProviderKey(provider=provider)
        session.add(row)
    row.ciphertext = seal(fernet, provider, origin, key)
    row.last4, row.bound_origin, row.revision = last4_of(key), origin, revision
    row.updated_at, row.updated_by = datetime.now(UTC), by[:64]
    await session.flush()
    return row, replaced


async def clear_key(session: AsyncSession, provider: str, *, by: str) -> LlmProviderKey | None:
    """Delete a provider's key, keeping the row as a tombstone with a new revision. None when there is no live key.
    Needs no secret, so an unreadable row can always be cleared."""
    await _lock(session)
    revision = await _next_revision(session)
    row = await session.get(LlmProviderKey, provider)
    if row is None or row.ciphertext is None:
        return None
    row.ciphertext = row.last4 = row.bound_origin = None
    row.revision = revision
    row.updated_at, row.updated_by = datetime.now(UTC), by[:64]
    await session.flush()
    return row


async def rotate_keys(session: AsyncSession, fernet: MultiFernet) -> tuple[int, int]:
    """Re-encrypt every live row with the first key of the secret (MultiFernet.rotate). (rotated, unreadable). The
    revision does not move: no key changed."""
    await _lock(session)
    rotated = unreadable = 0
    for row in await live_rows(session):
        if row.ciphertext is None:
            continue
        try:
            row.ciphertext = fernet.rotate(row.ciphertext.encode("ascii")).decode("ascii")
            rotated += 1
        except (InvalidToken, ValueError, UnicodeError):
            unreadable += 1
    await session.flush()
    return rotated, unreadable
