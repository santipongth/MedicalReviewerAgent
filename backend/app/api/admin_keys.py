"""Admin console: API keys and the audit log (Plan 23a). Thin adapters over app.services.admin_keys and audit."""
from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
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
