"""Admin console: LLM model management (Plan 23b). Thin adapters over llm_store, llm_validate, the cached catalog and
the probe. Every change writes its audit row in the same transaction; the probe writes its own."""
from __future__ import annotations

from typing import Any

import yaml
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import BaseModel, Field

from app.api.auth import ip_hash_of, require_admin
from app.api.deps import get_deps
from app.api.reviews import service_error_response
from app.runtime import AppDeps
from app.services.audit import record
from app.services.llm import _api_key
from app.services.llm_config import LLMConfigError, parse_llm_config, resolve_llm_config
from app.services.llm_probe import probe
from app.services.llm_store import (
    NOTE_MAX,
    get_version,
    list_versions,
    load_effective,
    loaded_workers,
    publish_version,
    reset_to_file,
    restore_version,
    save_version,
    version_out,
)
from app.services.llm_validate import to_yaml, validate_document
from app.services.model_catalog import cached_catalog, catalog_rows, load_live_catalog
from app.services.review_service import Identity, ServiceError

router = APIRouter()
YAML_MAX = 200_000
TEST_RATE = "10/minute"


class Draft(BaseModel):
    config: dict[str, Any] | None = None
    yaml: str | None = Field(None, max_length=YAML_MAX)

    def raw(self, *, required: bool = True) -> dict[str, Any] | None:
        if self.config is not None and self.yaml is not None:
            raise HTTPException(status_code=422, detail="send either config or yaml, not both")
        if self.yaml is not None:
            try:
                parsed = yaml.safe_load(self.yaml)
            except yaml.YAMLError as exc:
                raise HTTPException(status_code=422, detail=f"invalid YAML: {exc}") from exc
            if not isinstance(parsed, dict):
                raise HTTPException(status_code=422, detail="the YAML must be a mapping (active_preset, presets, …)")
            return parsed
        if self.config is None and required:
            raise HTTPException(status_code=422, detail="config or yaml is required")
        return self.config


class SaveBody(Draft):
    base_version: int | None
    note: str | None = Field(None, max_length=NOTE_MAX)


class BaseBody(BaseModel):
    base_version: int | None
    note: str | None = Field(None, max_length=NOTE_MAX)


class TestBody(Draft):
    preset: str | None = Field(None, max_length=64)
    role: str = Field(min_length=1, max_length=32)


def _config_error(exc: LLMConfigError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc)})


async def _catalog(deps: AppDeps):
    return await cached_catalog(deps.redis, load_live_catalog)


@router.get("/admin/llm-config")
async def llm_config_state(deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> dict:
    settings = deps.service.settings
    async with deps.session_factory() as session:
        effective = await load_effective(session, settings)
    keys = {p.api_key_env: bool(_api_key(settings, p.api_key_env)) for p in effective.config.providers.values()}
    return {"source": effective.source, "version": effective.version, "config": effective.raw,
            "active_preset": effective.config.active_preset, "env_preset": settings.llm_preset,
            "keys_present": keys, "loaded": await loaded_workers(deps.redis)}


@router.get("/admin/llm-config/versions")
async def llm_versions(before: int | None = Query(None, ge=1), limit: int = Query(50, ge=1, le=100),
                       deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> dict:
    async with deps.session_factory() as session:
        rows, nxt = await list_versions(session, before=before, limit=limit)
    return {"items": [version_out(r) for r in rows], "next": nxt}


@router.get("/admin/llm-config/versions/{version_id}")
async def llm_version(version_id: int, deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)):
    try:
        async with deps.session_factory() as session:
            row = await get_version(session, version_id)
    except ServiceError as exc:
        return service_error_response(exc)
    return {**version_out(row), "config": row.config}


@router.get("/admin/llm-config/versions/{version_id}/yaml")
async def llm_version_yaml(version_id: int, deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)):
    try:
        async with deps.session_factory() as session:
            row = await get_version(session, version_id)
    except ServiceError as exc:
        return service_error_response(exc)
    return PlainTextResponse(to_yaml(row.config), media_type="text/yaml; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="llm-config-v{version_id}.yaml"'})


@router.post("/admin/llm-config/validate")
async def llm_validate(body: Draft, deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> dict:
    return validate_document(body.raw(), deps.service.settings, await _catalog(deps))


async def _write(deps: AppDeps, identity: Identity, action):
    try:
        async with deps.session_factory() as session, session.begin():
            row = await action(session)
    except LLMConfigError as exc:
        return _config_error(exc)
    except ServiceError as exc:
        return service_error_response(exc)
    notified = await publish_version(deps.redis, row.id)  # False: Redis could not be updated, workers were not told
    return JSONResponse(status_code=201, content=jsonable_encoder({**version_out(row), "workers_notified": notified}))


@router.post("/admin/llm-config", status_code=201)
async def llm_save(body: SaveBody, deps: AppDeps = Depends(get_deps), identity: Identity = Depends(require_admin)):
    raw = body.raw()
    settings, ip_hash = deps.service.settings, ip_hash_of(identity, deps)
    return await _write(deps, identity, lambda s: save_version(
        s, identity.admin, raw, settings=settings, base_version=body.base_version, note=body.note, ip_hash=ip_hash))


@router.post("/admin/llm-config/versions/{version_id}/restore", status_code=201)
async def llm_restore(version_id: int, body: BaseBody, deps: AppDeps = Depends(get_deps),
                      identity: Identity = Depends(require_admin)):
    settings, ip_hash = deps.service.settings, ip_hash_of(identity, deps)
    return await _write(deps, identity, lambda s: restore_version(
        s, identity.admin, version_id, settings=settings, base_version=body.base_version, note=body.note,
        ip_hash=ip_hash))


@router.post("/admin/llm-config/reset", status_code=201)
async def llm_reset(body: BaseBody, deps: AppDeps = Depends(get_deps), identity: Identity = Depends(require_admin)):
    settings, ip_hash = deps.service.settings, ip_hash_of(identity, deps)
    return await _write(deps, identity, lambda s: reset_to_file(
        s, identity.admin, settings=settings, base_version=body.base_version, note=body.note, ip_hash=ip_hash))


@router.get("/admin/llm-models")
async def llm_models(q: str | None = Query(None, max_length=100), structured: bool = False, reasoning: bool = False,
                     max_price: float | None = Query(None, ge=0), limit: int = Query(100, ge=1, le=500),
                     deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> dict:
    catalog = await _catalog(deps)
    if catalog is None:
        return {"items": [], "available": False}
    return {"items": catalog_rows(catalog, q=q, structured=structured, reasoning=reasoning, max_price=max_price,
                                  limit=limit), "available": True}


@router.post("/admin/llm-models/test")
async def llm_test(body: TestBody, deps: AppDeps = Depends(get_deps), identity: Identity = Depends(require_admin)):
    decision = await deps.limits.hit("llm-test", identity.admin.label, TEST_RATE)
    if not decision.allowed:
        return JSONResponse(status_code=429, content={"detail": "too many test calls; wait a minute"},
                            headers={"Retry-After": str(decision.retry_after)})
    settings = deps.service.settings
    try:
        raw = body.raw(required=False)
        if raw is None:
            async with deps.session_factory() as session:
                raw = (await load_effective(session, settings)).raw
        resolved = resolve_llm_config(parse_llm_config(raw, where="config"), body.preset, where="config")
    except LLMConfigError as exc:
        return _config_error(exc)
    role = resolved.roles.get(body.role)
    if role is None:
        raise HTTPException(status_code=422, detail=f"preset {resolved.preset} has no {body.role} role")
    result = await probe(role, settings, await _catalog(deps))
    async with deps.session_factory() as session, session.begin():
        await record(session, identity.admin, "llm.test", target_type="llm_model", target_id=role.spec.model,
                     after={"preset": resolved.preset, "role": body.role, "ok": result["ok"],
                            "cost_usd": result["cost_usd"]}, ip_hash=ip_hash_of(identity, deps))
    return result
