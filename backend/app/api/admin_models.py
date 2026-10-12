"""Admin console: LLM model management (Plan 23b). Thin adapters over llm_store, llm_validate, the cached catalog and
the probe. Every change writes its audit row in the same transaction; the probe writes its own."""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import AfterValidator, BaseModel, Field

from app.api.auth import ip_hash_of, require_admin
from app.api.deps import get_deps
from app.api.reviews import service_error_response
from app.runtime import AppDeps
from app.services.audit import record
from app.services.llm import _api_key
from app.services.llm_config import (
    CONFIG_ERRORS,
    LLMConfigError,
    config_error_text,
    has_bad_text,
    parse_llm_config,
    parse_yaml_text,
    resolve_llm_config,
    url_host,
)
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


def _clean_note(value: str | None) -> str | None:
    if value is not None and has_bad_text(value):
        raise ValueError("the note must not contain a NUL or an invalid character")
    return value


Note = Annotated[str | None, Field(max_length=NOTE_MAX), AfterValidator(_clean_note)]


class Draft(BaseModel):
    config: dict[str, Any] | None = None
    yaml: str | None = Field(None, max_length=YAML_MAX)

    def raw(self, *, required: bool = True) -> dict[str, Any] | None:
        if self.config is not None and self.yaml is not None:
            raise HTTPException(status_code=422, detail="send either config or yaml, not both")
        if self.yaml is not None:
            try:
                parsed = parse_yaml_text(self.yaml)
            except LLMConfigError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc
            if not isinstance(parsed, dict):
                raise HTTPException(status_code=422, detail="the YAML must be a mapping (active_preset, presets, …)")
            return parsed
        if self.config is None and required:
            raise HTTPException(status_code=422, detail="config or yaml is required")
        return self.config


class SaveBody(Draft):
    base_version: int | None
    note: Note = None


class BaseBody(BaseModel):
    base_version: int | None
    note: Note = None


class TestBody(Draft):
    preset: str | None = Field(None, max_length=64)
    role: str = Field(min_length=1, max_length=32)


def _config_error(exc: BaseException) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": config_error_text(exc)})


async def _catalog(deps: AppDeps):
    return await cached_catalog(deps.redis, load_live_catalog)


@router.get("/admin/llm-config")
async def llm_config_state(deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> dict:
    settings = deps.service.settings
    async with deps.session_factory() as session:
        effective = await load_effective(session, settings)
    keys = {p.api_key_env: bool(_api_key(settings, p.api_key_env)) for p in effective.config.providers.values()}
    # The preset the workers run: LLM_PRESET replaces the file's own active_preset while llm.yaml is the source, and a
    # DB version ignores it. Computed directly, not with effective.resolve(): an LLM_PRESET that names no preset must
    # not turn this route into a 500 (the page shows it through env_preset, and validate reports it).
    running = settings.llm_preset if effective.source == "file" and settings.llm_preset else effective.config.active_preset
    return {"source": effective.source, "version": effective.version, "config": effective.raw,
            "active_preset": running, "env_preset": settings.llm_preset,
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
    except CONFIG_ERRORS as exc:  # a bad document (or a failure while dumping it) is the admin's 422, not a 500
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
        if raw is not None:  # a draft: its own active preset, or the one asked for
            resolved = resolve_llm_config(parse_llm_config(raw, where="config"), body.preset, where="config")
        else:  # what the workers run: LLM_PRESET applies while llm.yaml is the source, as in the worker
            async with deps.session_factory() as session:
                effective = await load_effective(session, settings)
            resolved = (effective.resolve() if body.preset is None
                        else resolve_llm_config(effective.config, body.preset, where=effective.label))
    except CONFIG_ERRORS as exc:
        return _config_error(exc)
    role = resolved.roles.get(body.role)
    if role is None:
        raise HTTPException(status_code=422, detail=f"preset {resolved.preset} has no {body.role} role")
    try:  # which host the call goes to is parsed before the probe, so a bad URL can only ever be a 422, never a spend
        host = url_host(role.provider_spec.base_url)
    except CONFIG_ERRORS as exc:
        return _config_error(exc)
    result = await probe(role, settings, await _catalog(deps))
    async with deps.session_factory() as session, session.begin():
        await record(session, identity.admin, "llm.test", target_type="llm_model", target_id=role.spec.model,
                     after={"preset": resolved.preset, "role": body.role, "provider": role.provider,
                            "base_url_host": host, "ok": result["ok"], "cost_usd": result["cost_usd"]},
                     ip_hash=ip_hash_of(identity, deps))
    return result
