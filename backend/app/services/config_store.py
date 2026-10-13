"""Versioned runtime documents (Plan 23c): the runtime settings and the Thai glossary. The rules are those of the LLM
config versions (Plan 23b, app/services/llm_store.py): rows are never updated or deleted, the newest version of a kind
is the one in use, a save carries the version it was based on (409 when another one became active meanwhile), saves
are serialised by a Postgres advisory lock, and the audit row is written in the same transaction. While a kind has no
version its seed is in use (the env values for settings, the built-in glossary). Redis mirrors the active version of
each kind under kind.redis_key as JSON (the version plus kind.mirror(document)); the mirror only ever moves forward,
and a reader that finds it missing or unreachable reads the database."""
from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from redis.exceptions import WatchError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db.models import ConfigVersion
from app.logging import get_logger
from app.services.admin_auth import AdminPrincipal
from app.services.audit import record
from app.services.llm_config import LLMConfigError, ensure_storable
from app.services.review_service import Conflict, NotFound

log = get_logger(__name__)

NOTE_MAX = 500
PUBLISH_ATTEMPTS = 3
# Postgres advisory-lock key ("MRARTCFG") that serialises saves of every kind; held until the caller commits, so a
# second save from the same base reads the first one's row and gets the Conflict.
CONFIG_SAVE_LOCK = 0x4D52_4152_5443_4647
_VERB = {"edit": "save", "restore": "restore", "reset": "reset"}


class DocumentError(ValueError):
    """A document failed validation. `errors` lists {"field": str | None, "message": str}; a field names a setting
    or a glossary cell ("terms.3.th"), and no message repeats the submitted text."""

    def __init__(self, errors: list[dict[str, Any]]) -> None:
        self.errors = errors or [{"field": None, "message": "invalid document"}]
        super().__init__(self.errors[0]["message"])


@dataclass(frozen=True)
class DocKind:
    name: str  # "settings" | "glossary": the audit action prefix and target type
    redis_key: str
    validate: Callable[[Any, Settings], tuple[dict[str, Any], list[str]]]  # (normalised document, warnings)
    summarize: Callable[[dict[str, Any] | None, dict[str, Any]], dict[str, Any]]
    seed: Callable[[], dict[str, Any]]
    mirror: Callable[[dict[str, Any]], dict[str, Any]]  # what the Redis mirror carries next to the version


@dataclass(frozen=True)
class Active:
    version: int | None  # None: no saved version, the seed is in use
    mirror: dict[str, Any]


async def newest(session: AsyncSession, kind: DocKind) -> ConfigVersion | None:
    stmt = (select(ConfigVersion).where(ConfigVersion.kind == kind.name)
            .order_by(ConfigVersion.version.desc()).limit(1))
    return (await session.execute(stmt)).scalar_one_or_none()


def _storable(document: dict[str, Any]) -> None:
    """23b's check that the JSON column can hold the document (ensure_storable), as a DocumentError whose message
    does not repeat the document."""
    try:
        ensure_storable(document)
    except LLMConfigError as exc:
        raise DocumentError([{"field": None, "message": "the document cannot be stored as JSON"}]) from exc


async def save_version(session: AsyncSession, actor: AdminPrincipal, kind: DocKind, raw: Any, *, settings: Settings,
                       base_version: int | None, note: str | None = None, source: str = "edit",
                       restored_from: int | None = None, ip_hash: str | None = None) -> ConfigVersion:
    """Validate, refuse a stale base, append the next version of the kind and its audit row."""
    if source not in _VERB:  # a caller's bug: refused before anything is written (the audit verb needs it)
        raise ValueError(f"unknown source {source!r}: use one of {', '.join(_VERB)}")
    document, _ = kind.validate(raw, settings)
    _storable(document)
    if session.get_bind().dialect.name == "postgresql":  # READ COMMITTED would let two saves pass the same check
        await session.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": CONFIG_SAVE_LOCK})
    current = await newest(session, kind)
    current_version = current.version if current is not None else None
    if base_version != current_version:
        active = f"version {current_version}" if current_version is not None else "the default"
        raise Conflict(f"{active} is in use now; reload the latest version and try again")
    previous = current.document if current is not None else kind.seed()
    changes = kind.summarize(previous, document)
    row = ConfigVersion(kind=kind.name, version=(current_version or 0) + 1, created_at=datetime.now(UTC),
                        created_by=actor.label[:64], note=(note or "").strip()[:NOTE_MAX] or None, source=source,
                        restored_from=restored_from, document=document, changes=changes)
    session.add(row)
    await session.flush()
    await record(session, actor, f"{kind.name}.{_VERB[source]}", target_type=kind.name, target_id=row.version,
                 before={"version": current_version}, after={"version": row.version, **changes}, ip_hash=ip_hash)
    return row


async def get_version(session: AsyncSession, kind: DocKind, version: int) -> ConfigVersion:
    stmt = select(ConfigVersion).where(ConfigVersion.kind == kind.name, ConfigVersion.version == version)
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise NotFound(f"{kind.name} version {version} not found")
    return row


async def restore_version(session: AsyncSession, actor: AdminPrincipal, kind: DocKind, version: int, *,
                          settings: Settings, base_version: int | None, note: str | None = None,
                          ip_hash: str | None = None) -> ConfigVersion:
    """Append a copy of an old version. It is validated again: a version the current rules refuse is not restored."""
    old = await get_version(session, kind, version)
    return await save_version(session, actor, kind, old.document, settings=settings, base_version=base_version,
                              note=note or f"restored from version {version}", source="restore",
                              restored_from=version, ip_hash=ip_hash)


async def reset_to_seed(session: AsyncSession, actor: AdminPrincipal, kind: DocKind, *, settings: Settings,
                        base_version: int | None, note: str | None = None,
                        ip_hash: str | None = None) -> ConfigVersion:
    return await save_version(session, actor, kind, kind.seed(), settings=settings, base_version=base_version,
                              note=note or "reset to the default", source="reset", ip_hash=ip_hash)


async def list_versions(session: AsyncSession, kind: DocKind, *, before: int | None = None,
                        limit: int = 50) -> tuple[list[ConfigVersion], int | None]:
    stmt = (select(ConfigVersion).where(ConfigVersion.kind == kind.name)
            .order_by(ConfigVersion.version.desc()).limit(limit + 1))
    if before is not None:
        stmt = stmt.where(ConfigVersion.version < before)
    rows = list((await session.execute(stmt)).scalars())
    cursor = rows[limit - 1].version if len(rows) > limit else None
    return rows[:limit], cursor


def version_out(row: ConfigVersion) -> dict[str, Any]:
    return {"version": row.version, "kind": row.kind, "created_at": row.created_at, "created_by": row.created_by,
            "note": row.note, "source": row.source, "restored_from": row.restored_from, "changes": row.changes or {}}


def mirror_version(raw: str | None) -> int | None:
    """The version a mirror holds, or None when it is empty or holds something else."""
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except ValueError:
        return None
    version = value.get("version") if isinstance(value, dict) else None
    return version if isinstance(version, int) and not isinstance(version, bool) else None


def _payload(kind: DocKind, version: int, document: dict[str, Any]) -> str:
    return json.dumps({"version": version, **kind.mirror(document)}, ensure_ascii=False)


async def publish(redis, kind: DocKind, row: ConfigVersion) -> bool:
    """Raise the kind's mirror to this version; never lower it (commits can reach Redis out of order). False on a
    Redis error or lost WATCH races: the mirror keeps its old value, and readers that miss it read the DB."""
    payload = _payload(kind, row.version, row.document)
    try:
        for _ in range(PUBLISH_ATTEMPTS):
            async with redis.pipeline(transaction=True) as pipe:
                try:
                    await pipe.watch(kind.redis_key)
                    stored = mirror_version(await pipe.get(kind.redis_key))
                    if stored is not None and stored >= row.version:
                        return True
                    pipe.multi()
                    pipe.set(kind.redis_key, payload)
                    await pipe.execute()
                    return True
                except WatchError:
                    continue
        log.warning("runtime_publish_contended", kind=kind.name, version=row.version)
    except Exception:  # noqa: BLE001 - the version is committed; Redis trouble must not fail the save
        log.warning("runtime_publish_failed", kind=kind.name, version=row.version)
    return False


async def read_active(session_factory, redis, kind: DocKind) -> Active:
    """The kind's active version and mirror: Redis first; on a miss or a Redis error the newest DB row (then cached
    with NX, so a publish that landed meanwhile wins); the seed while the kind has no version (not cached)."""
    try:
        raw = await redis.get(kind.redis_key)
        redis_ok = True
    except Exception:  # noqa: BLE001 - Redis down must not block anything that reads settings
        raw, redis_ok = None, False
    version = mirror_version(raw)
    if version is not None:
        data = json.loads(raw)
        return Active(version, {k: v for k, v in data.items() if k != "version"})
    async with session_factory() as session:
        row = await newest(session, kind)
    if row is None:
        return Active(None, kind.mirror(kind.seed()))
    if redis_ok:
        try:
            await redis.set(kind.redis_key, _payload(kind, row.version, row.document), nx=True)
        except Exception:  # noqa: BLE001 - the next reader asks the DB again
            log.warning("runtime_mirror_fill_failed", kind=kind.name)
    return Active(row.version, kind.mirror(row.document))


async def reconcile_mirror(redis, session_factory, kind: DocKind) -> int | None:
    """Make the kind's mirror agree with the DB, which is the truth, and return the DB's newest version (None while
    the kind has none). The rules of 23b's reconcile_version_key: a mirror that is missing or behind is raised (a
    publish that was lost); one above the DB's newest is set back to it, or deleted while the kind is empty (a DB
    restored from a backup). Redis is read before the DB: a publish follows its commit, so a mirror above the DB's
    newest was not committed here. Redis errors propagate; the caller keeps what it has."""
    raw = await redis.get(kind.redis_key)
    stored = mirror_version(raw)
    async with session_factory() as session:
        row = await newest(session, kind)
    if row is None:
        if raw is not None:
            await redis.delete(kind.redis_key)
        return None
    if stored is None or stored < row.version:
        await publish(redis, kind, row)
    elif stored > row.version:
        await redis.set(kind.redis_key, _payload(kind, row.version, row.document))
    return row.version
