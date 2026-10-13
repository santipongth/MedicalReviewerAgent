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

# Plan 23e: api_key, ciphertext and llm_keys_secret too, a backstop for any caller that passes one (the key routes
# never do: their rows hold provider, kind, origin and revision only)
SECRET_FIELDS = frozenset({"password", "password_hash", "key", "key_hash", "raw_key", "token", "api_key", "ciphertext",
                           "llm_keys_secret"})
SECRET_SUFFIXES = ("password", "token", "secret", "_hash", "api_key")


def _is_secret(name: Any) -> bool:
    """A field that must never reach the log: a known secret name, or any name ending like one (new_password,
    session_token, client_secret, pw_hash), in any case. 'key_prefix' is not a secret and is kept."""
    lowered = str(name).lower()
    return lowered in SECRET_FIELDS or lowered.endswith(SECRET_SUFFIXES)


def _drop_secrets(value: Any) -> Any:
    """Copies dicts, lists and tuples at every depth without their secret fields."""
    if isinstance(value, dict):
        return {k: _drop_secrets(v) for k, v in value.items() if not _is_secret(k)}
    if isinstance(value, list | tuple):
        return [_drop_secrets(item) for item in value]
    return value


def _jsonable(value: Any) -> Any:
    """Makes a value fit a JSON column, at every depth: datetimes and dates become ISO text, UUIDs text."""
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_jsonable(item) for item in value]
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


def _scrub(state: dict[str, Any] | None) -> dict[str, Any] | None:
    return None if state is None else _jsonable(_drop_secrets(state))


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
