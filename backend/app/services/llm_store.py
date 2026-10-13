"""LLM configuration versions (Plan 23b). config/llm.yaml is the seed; every save from the admin console appends an
immutable, validated version, and the newest version is the configuration in use. Workers learn of a new version from
the Redis key LLM_VERSION_KEY and report what they loaded in LOADED_KEY."""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal

from redis.exceptions import WatchError
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db.models import LlmConfigVersion
from app.logging import get_logger
from app.services.admin_auth import AdminPrincipal
from app.services.audit import record
from app.services.llm_config import (
    LLMConfig,
    ResolvedLLMConfig,
    ensure_storable,
    parse_llm_config,
    read_llm_yaml,
    resolve_llm_config,
)
from app.services.review_service import Conflict, NotFound

log = get_logger(__name__)

LLM_VERSION_KEY = "mra:llm:config_version"
LOADED_KEY = "mra:llm:loaded"
LOADED_MAX_AGE = timedelta(days=1)
NOTE_MAX = 500
PUBLISH_ATTEMPTS = 3
# Postgres advisory-lock key that serialises saves ("MRALLMSV"); the transaction-scoped lock is held until the
# caller commits, so a second save from the same base reads the first one's row and gets the Conflict.
LLM_SAVE_LOCK = 0x4D52_414C_4C4D_5356
_ACTIONS = {"edit": "llm_config.save", "restore": "llm_config.restore", "file": "llm_config.reset"}


@dataclass(frozen=True)
class EffectiveConfig:
    source: Literal["db", "file"]
    version: int | None
    raw: dict[str, Any]
    config: LLMConfig
    env_preset: str | None

    @property
    def label(self) -> str:
        return f"db:{self.version}" if self.source == "db" else "file"

    @property
    def active_id(self) -> str:
        return str(self.version) if self.source == "db" else "file"

    def resolve(self) -> ResolvedLLMConfig:
        """LLM_PRESET overrides the active preset only while config/llm.yaml is the source."""
        preset = self.env_preset if self.source == "file" else None
        return resolve_llm_config(self.config, preset, where=self.label)


async def _newest(session: AsyncSession) -> LlmConfigVersion | None:
    stmt = select(LlmConfigVersion).order_by(LlmConfigVersion.id.desc()).limit(1)
    return (await session.execute(stmt)).scalar_one_or_none()


async def load_effective(session: AsyncSession, settings: Settings) -> EffectiveConfig:
    row = await _newest(session)
    if row is not None:
        return EffectiveConfig("db", row.id, row.config, parse_llm_config(row.config, where=f"version {row.id}"),
                               settings.llm_preset)
    raw = read_llm_yaml(settings.llm_config_path)
    return EffectiveConfig("file", None, raw, parse_llm_config(raw, where=settings.llm_config_path),
                           settings.llm_preset)


def _models(raw: dict[str, Any], preset: str, role: str) -> tuple[str | None, Any]:
    spec = ((raw.get("presets") or {}).get(preset) or {}).get(role)
    return (spec or {}).get("model"), spec


def summarize_change(old_raw: dict[str, Any] | None, new_raw: dict[str, Any]) -> dict[str, Any]:
    """What a save changed, for history and the audit log: the active preset, presets added or removed, each role's
    model (or "settings changed"), and the other top-level sections that differ."""
    old = old_raw or {}
    out: dict[str, Any] = {}
    if old.get("active_preset") != new_raw.get("active_preset"):
        out["active_preset"] = f"{old.get('active_preset')} → {new_raw.get('active_preset')}"
    old_presets, new_presets = old.get("presets") or {}, new_raw.get("presets") or {}
    if added := sorted(set(new_presets) - set(old_presets)):
        out["presets_added"] = added
    if removed := sorted(set(old_presets) - set(new_presets)):
        out["presets_removed"] = removed
    roles: dict[str, str] = {}
    for preset in sorted(set(old_presets) & set(new_presets)):
        for role in sorted(set(old_presets[preset] or {}) | set(new_presets[preset] or {})):
            (a, spec_a), (b, spec_b) = _models(old, preset, role), _models(new_raw, preset, role)
            if a != b:
                roles[f"{preset}.{role}"] = f"{a or '—'} → {b or '—'}"
            elif spec_a != spec_b:
                roles[f"{preset}.{role}"] = "settings changed"
    if roles:
        out["roles"] = roles
    if sections := [k for k in ("default_provider", "providers", "harness", "overrides") if old.get(k) != new_raw.get(k)]:
        out["sections"] = sections
    return out


async def save_version(session: AsyncSession, actor: AdminPrincipal, raw: Any, *, settings: Settings,
                       base_version: int | None, note: str | None = None, source: str = "edit",
                       restored_from: int | None = None, ip_hash: str | None = None) -> LlmConfigVersion:
    """Validate (schema and the active preset), refuse a stale base, append the version and its audit row."""
    config = parse_llm_config(raw, where="config")
    resolve_llm_config(config, None, where="config")
    stored = config.model_dump(mode="json", exclude_unset=True)
    ensure_storable(stored)
    if session.get_bind().dialect.name == "postgresql":  # READ COMMITTED would let two saves pass the same check
        await session.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": LLM_SAVE_LOCK})
    current = await _newest(session)
    current_id = current.id if current is not None else None
    if base_version != current_id:
        active = f"version {current_id}" if current_id is not None else "llm.yaml"
        raise Conflict(f"{active} is in use now; reload the latest version and try again")
    if current is not None:
        previous = current.config
    else:
        # The configuration in use is llm.yaml with LLM_PRESET applied: a first save that changes the running preset
        # must show it in history and the audit log.
        previous = read_llm_yaml(settings.llm_config_path)
        if settings.llm_preset:
            previous = {**previous, "active_preset": settings.llm_preset}
    changes = summarize_change(previous, stored)
    row = LlmConfigVersion(created_at=datetime.now(UTC), created_by=actor.label[:64],
                           note=(note or "").strip()[:NOTE_MAX] or None, source=source,
                           restored_from=restored_from, config=stored, changes=changes)
    session.add(row)
    await session.flush()
    await record(session, actor, _ACTIONS[source], target_type="llm_config", target_id=row.id,
                 before={"version": current_id}, after={"version": row.id, **changes}, ip_hash=ip_hash)
    return row


async def get_version(session: AsyncSession, version_id: int) -> LlmConfigVersion:
    row = await session.get(LlmConfigVersion, version_id)
    if row is None:
        raise NotFound(f"version {version_id} not found")
    return row


async def restore_version(session: AsyncSession, actor: AdminPrincipal, version_id: int, *, settings: Settings,
                          base_version: int | None, note: str | None = None,
                          ip_hash: str | None = None) -> LlmConfigVersion:
    old = await get_version(session, version_id)
    return await save_version(session, actor, old.config, settings=settings, base_version=base_version,
                              note=note or f"restored from version {version_id}", source="restore",
                              restored_from=version_id, ip_hash=ip_hash)


async def reset_to_file(session: AsyncSession, actor: AdminPrincipal, *, settings: Settings,
                        base_version: int | None, note: str | None = None,
                        ip_hash: str | None = None) -> LlmConfigVersion:
    return await save_version(session, actor, read_llm_yaml(settings.llm_config_path), settings=settings,
                              base_version=base_version, note=note or "reset to llm.yaml", source="file",
                              ip_hash=ip_hash)


async def list_versions(session: AsyncSession, *, before: int | None = None,
                        limit: int = 50) -> tuple[list[LlmConfigVersion], int | None]:
    stmt = select(LlmConfigVersion).order_by(LlmConfigVersion.id.desc()).limit(limit + 1)
    if before is not None:
        stmt = stmt.where(LlmConfigVersion.id < before)
    rows = list((await session.execute(stmt)).scalars())
    cursor = rows[limit - 1].id if len(rows) > limit else None
    return rows[:limit], cursor


def version_out(row: LlmConfigVersion) -> dict[str, Any]:
    return {"id": row.id, "created_at": row.created_at, "created_by": row.created_by, "note": row.note,
            "source": row.source, "restored_from": row.restored_from,
            "active_preset": (row.config or {}).get("active_preset"), "changes": row.changes or {}}


def _as_id(value: Any) -> int | None:
    """A stored version id, or None when the key is empty or holds something else."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


async def publish_version(redis, version_id: int) -> bool:
    """Raise the shared active-version id to version_id; it never lowers it, because commits can reach Redis out of
    order. True when the key now holds an id >= version_id. False on a Redis error (after PUBLISH_ATTEMPTS lost
    WATCH races or a connection failure): the key then keeps its previous value, so workers do not reload and the
    cache key stays on that version until a later publish succeeds."""
    try:
        for _ in range(PUBLISH_ATTEMPTS):
            async with redis.pipeline(transaction=True) as pipe:
                try:
                    await pipe.watch(LLM_VERSION_KEY)
                    stored = _as_id(await pipe.get(LLM_VERSION_KEY))
                    if stored is not None and stored >= version_id:
                        return True
                    pipe.multi()
                    pipe.set(LLM_VERSION_KEY, str(version_id))
                    await pipe.execute()
                    return True
                except WatchError:
                    continue  # another client wrote the key between WATCH and EXEC: read it again
        log.warning("llm_version_publish_contended", version=version_id)
    except Exception:  # noqa: BLE001 - the caller already committed the version; Redis trouble must not fail it
        log.warning("llm_version_publish_failed", version=version_id)
    return False


async def reconcile_version_key(redis, session_factory) -> int | None:
    """Make LLM_VERSION_KEY agree with the DB, which is the truth, and return the DB's newest id (None while the
    table is empty). A key that is missing or behind is raised (a publish that was lost); a key above the DB's newest
    is pulled back with a plain SET, or deleted while the table is empty (a DB restored from a backup, a migration
    taken down and up). Redis is read before the DB: a publish follows its commit, so a stored id above the DB's
    newest was not committed here, and a save landing in between only makes the DB ahead, which the next line fixes."""
    raw = await redis.get(LLM_VERSION_KEY)
    stored = _as_id(raw)
    newest = await newest_version_id(session_factory)
    if newest is None:
        if raw is not None:
            await redis.delete(LLM_VERSION_KEY)
    elif stored is None or stored < newest:
        await publish_version(redis, newest)
    elif stored > newest:
        await redis.set(LLM_VERSION_KEY, str(newest))
    return newest


async def newest_version_id(session_factory) -> int | None:
    """The newest (= active) version id straight from the DB; None while the table is empty (llm.yaml is active)."""
    async with session_factory() as session:
        return await session.scalar(select(func.max(LlmConfigVersion.id)))


async def active_version_id(session_factory, redis) -> str:
    """The active version id as text ("file" while the table is empty): Redis first, the DB on a miss or an error."""
    try:
        cached = await redis.get(LLM_VERSION_KEY)
    except Exception:  # noqa: BLE001 - Redis down must not block review creation
        cached = None
    if cached:
        return cached
    newest = await newest_version_id(session_factory)
    value = str(newest) if newest is not None else "file"
    if newest is not None:
        try:
            await redis.set(LLM_VERSION_KEY, value, nx=True)  # a publish that landed meanwhile is newer
        except Exception:  # noqa: BLE001 - the next reader asks the DB again
            log.warning("llm_version_cache_failed", version=value)
    return value


async def report_loaded(redis, worker: str, version: str, preset: str, error: str | None = None, *,
                        extra: dict[str, Any] | None = None) -> None:
    """Record what a worker runs. Workers repeat this on every poll (a heartbeat), so `loaded_at` means "last seen",
    and loaded_workers drops entries that were not refreshed for LOADED_MAX_AGE. `extra` carries the runtime versions
    (Plan 23c: settings, glossary, runtime_error); it never overrides the LLM fields."""
    payload = {**(extra or {}), "version": version, "preset": preset, "loaded_at": datetime.now(UTC).isoformat(),
               "error": (error or None) and error[:300]}
    try:
        await redis.hset(LOADED_KEY, worker, json.dumps(payload))
    except Exception:  # noqa: BLE001 - reporting never breaks a worker
        log.warning("llm_loaded_report_failed", worker=worker)


async def loaded_workers(redis, now: datetime | None = None) -> list[dict[str, Any]]:
    now = now or datetime.now(UTC)
    out: list[dict[str, Any]] = []
    for worker, raw in sorted((await redis.hgetall(LOADED_KEY)).items()):
        try:
            item = json.loads(raw)
            loaded_at = datetime.fromisoformat(item["loaded_at"])
        except (ValueError, KeyError, TypeError):
            continue
        if now - loaded_at <= LOADED_MAX_AGE:
            out.append({"worker": worker, **item})
    return out
