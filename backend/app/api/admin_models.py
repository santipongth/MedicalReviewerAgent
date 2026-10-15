"""Admin console: LLM model management (Plan 23b). Thin adapters over llm_store, llm_validate, the cached catalog and
the probe. Every change writes its audit row in the same transaction; the probe writes its own."""
from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, PlainTextResponse
from pydantic import AfterValidator, BaseModel, Field

from app.api.auth import ip_hash_of, require_admin
from app.api.deps import get_deps
from app.api.reviews import service_error_response
from app.runtime import AppDeps
from app.services.audit import record
from app.services.llm import PRICES_PER_MTOK
from app.services.llm_config import (
    CONFIG_ERRORS,
    PROVIDER_NAME,
    LLMConfigError,
    ResolvedRole,
    RoleSpec,
    config_error_summary,
    config_error_text,
    has_bad_text,
    key_env,
    parse_llm_config,
    parse_yaml_text,
    resolve_llm_config,
    url_host,
)
from app.services.llm_keys import load_keyring, resolve_key
from app.services.llm_probe import probe
from app.services.llm_store import (
    NOTE_MAX,
    get_version,
    list_versions,
    load_effective,
    loaded_workers,
    newest_row,
    publish_version,
    reset_to_file,
    restore_version,
    save_version,
    version_out,
)
from app.services.llm_validate import DocumentErrors, key_status, to_yaml, validate_document
from app.services.model_catalog import cached_catalog, catalog_rows, load_live_catalog
from app.services.review_service import Identity, ServiceError

router = APIRouter()
YAML_MAX = 200_000
TEST_RATE = "10/minute"
ID_MAX = 2**31 - 1  # Postgres INTEGER: a larger id in a lookup is a DataError (a 500), so it is a 422 here
VersionId = Annotated[int, Path(ge=1, le=ID_MAX)]
Before = Annotated[int | None, Query(ge=1, le=ID_MAX)]


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
    """Test a role of a preset, or (Plan 23e) a provider with a model of its own, so a key can be tried before any
    preset uses it."""

    preset: str | None = Field(None, max_length=64)
    role: str | None = Field(None, min_length=1, max_length=32)
    provider: str | None = Field(None, pattern=f"^{PROVIDER_NAME.pattern}$", max_length=32)
    model: str | None = Field(None, min_length=1, max_length=200)
    price_in: float | None = Field(None, ge=0, le=1000)
    price_out: float | None = Field(None, ge=0, le=1000)


def _config_error(exc: BaseException) -> JSONResponse:
    content: dict = {"detail": config_error_text(exc)}
    if isinstance(exc, DocumentErrors):
        content["role_errors"] = exc.role_errors
    return JSONResponse(status_code=422, content=content)


async def _catalog(deps: AppDeps):
    return await cached_catalog(deps.redis, load_live_catalog)


def _unreadable(settings, row, exc: BaseException, loaded: list) -> dict:
    """The state when the configuration in use no longer passes validation: the newest version was saved under older
    rules, or llm.yaml is broken while no version exists. It is shown as stored, with the error, and never as a 500,
    so the console can still restore an older version or build a new one from llm.yaml. Workers keep the models they
    loaded and report the same error."""
    raw = row.config if row is not None and isinstance(row.config, dict) else {}
    preset = raw.get("active_preset")
    return {"source": "db" if row is not None else "file", "version": row.id if row is not None else None,
            "config": raw, "active_preset": preset if isinstance(preset, str) else "",
            "env_preset": settings.llm_preset, "keys_present": {}, "key_status": {}, "known_prices": KNOWN_PRICES,
            "loaded": loaded, "error": config_error_summary(exc)}


# Plan 23e: what a direct Anthropic model costs without a price of its own (USD per 1M tokens, input and output)
KNOWN_PRICES = {model: list(price) for model, price in PRICES_PER_MTOK.items()}


@router.get("/admin/llm-config")
async def llm_config_state(deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> dict:
    settings = deps.service.settings
    async with deps.session_factory() as session:
        try:
            effective = await load_effective(session, settings)
        except CONFIG_ERRORS as exc:
            row = await newest_row(session)
            return _unreadable(settings, row, exc, await loaded_workers(deps.redis))
        ring = await load_keyring(session, settings)
    providers = effective.config.providers
    # keys_present (by variable name, as before) is true when a console or env key resolves (Plan 23e); key_status
    # says which, or why not
    keys = {key_env(name): resolve_key(name, spec, ring, settings).value is not None for name, spec in providers.items()}
    status = {name: key_status(name, spec, ring, settings) for name, spec in providers.items()}
    # The preset the workers run: LLM_PRESET replaces the file's own active_preset while llm.yaml is the source, and a
    # DB version ignores it. Computed directly, not with effective.resolve(): an LLM_PRESET that names no preset must
    # not turn this route into a 500 (the page shows it through env_preset, and validate reports it).
    running = settings.llm_preset if effective.source == "file" and settings.llm_preset else effective.config.active_preset
    return {"source": effective.source, "version": effective.version, "config": effective.raw,
            "active_preset": running, "env_preset": settings.llm_preset, "keys_present": keys, "key_status": status,
            "known_prices": KNOWN_PRICES, "loaded": await loaded_workers(deps.redis), "error": None}


@router.get("/admin/llm-config/versions")
async def llm_versions(before: Before = None, limit: int = Query(50, ge=1, le=100),
                       deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> dict:
    async with deps.session_factory() as session:
        rows, nxt = await list_versions(session, before=before, limit=limit)
    return {"items": [version_out(r) for r in rows], "next": nxt}


@router.get("/admin/llm-config/versions/{version_id}")
async def llm_version(version_id: VersionId, deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)):
    try:
        async with deps.session_factory() as session:
            row = await get_version(session, version_id)
    except ServiceError as exc:
        return service_error_response(exc)
    return {**version_out(row), "config": row.config}


@router.get("/admin/llm-config/versions/{version_id}/yaml")
async def llm_version_yaml(version_id: VersionId, deps: AppDeps = Depends(get_deps),
                            _: Identity = Depends(require_admin)):
    try:
        async with deps.session_factory() as session:
            row = await get_version(session, version_id)
    except ServiceError as exc:
        return service_error_response(exc)
    return PlainTextResponse(to_yaml(row.config), media_type="text/yaml; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="llm-config-v{version_id}.yaml"'})


@router.post("/admin/llm-config/validate")
async def llm_validate(body: Draft, deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> dict:
    raw = body.raw()
    async with deps.session_factory() as session:
        ring = await load_keyring(session, deps.service.settings)
    return validate_document(raw, deps.service.settings, await _catalog(deps), ring)


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
async def llm_restore(version_id: VersionId, body: BaseBody, deps: AppDeps = Depends(get_deps),
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
            config = parse_llm_config(raw, where="config")
            resolved = resolve_llm_config(config, body.preset, where="config")
        else:  # what the workers run: LLM_PRESET applies while llm.yaml is the source, as in the worker
            async with deps.session_factory() as session:
                effective = await load_effective(session, settings)
            config = effective.config
            resolved = (effective.resolve() if body.preset is None
                        else resolve_llm_config(effective.config, body.preset, where=effective.label))
    except CONFIG_ERRORS as exc:
        return _config_error(exc)
    try:
        role = _test_role(body, resolved, config)
    except CONFIG_ERRORS as exc:
        return _config_error(exc)
    try:  # which host the call goes to is parsed before the probe, so a bad URL can only ever be a 422, never a spend
        host = url_host(role.provider_spec.base_url)
    except CONFIG_ERRORS as exc:
        return _config_error(exc)
    async with deps.session_factory() as session:  # a draft that moves a base_url gets no stored key (Plan 23e)
        ring = await load_keyring(session, settings)
    key_source = resolve_key(role.provider, role.provider_spec, ring, settings).source
    result = await probe(role, settings, await _catalog(deps), keys=ring)
    async with deps.session_factory() as session, session.begin():
        await record(session, identity.admin, "llm.test", target_type="llm_model", target_id=role.spec.model,
                     after={"preset": resolved.preset, "role": role.role, "provider": role.provider,
                            "kind": role.kind, "key_source": key_source, "base_url_host": host, "ok": result["ok"],
                            "cost_usd": result["cost_usd"]},
                     ip_hash=ip_hash_of(identity, deps))
    return result


def _test_role(body: TestBody, resolved, config) -> ResolvedRole:
    """The role a test call probes: a role of the preset, or (Plan 23e) a provider of the configuration with the given
    model and prices. Anything else is a 422."""
    if (body.role is None) == (body.provider is None):
        raise HTTPException(status_code=422, detail="send either role, or provider and model")
    if body.role is not None:
        role = resolved.roles.get(body.role)
        if role is None:
            raise HTTPException(status_code=422, detail=f"preset {resolved.preset} has no {body.role} role")
        return role
    if body.model is None:
        raise HTTPException(status_code=422, detail="model is required with provider")
    spec = config.providers.get(body.provider)
    if spec is None:
        raise HTTPException(status_code=422, detail=f"provider {body.provider} is not configured")
    role_spec = RoleSpec(model=body.model, provider=body.provider, price_in=body.price_in, price_out=body.price_out)
    return ResolvedRole("test", body.provider, spec, role_spec)
