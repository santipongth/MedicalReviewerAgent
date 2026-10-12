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
