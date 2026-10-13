"""Admin console: LLM provider keys (Plan 23e). Thin adapters over app/services/llm_keys.py. A key is write-only: no
answer, audit row, log line or Redis value carries it. The PUT body is read and checked here, with fixed messages,
because FastAPI's own 422 quotes the input it refused. Every write audits in its transaction and then raises
mra:llm:keys_version, which workers follow (app/worker/llm_reload.py)."""
from __future__ import annotations

import json
import os
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Path, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from app.api.auth import ip_hash_of, require_admin
from app.api.deps import get_deps
from app.runtime import AppDeps
from app.services.audit import record
from app.services.llm_config import (
    CONFIG_ERRORS,
    MAX_ORIGIN,
    PROVIDER_KEYS,
    PROVIDER_NAME,
    config_error_summary,
    key_env,
    provider_kind,
    provider_origin,
    resolve_llm_config,
)
from app.services.llm_keys import (
    KEY_TEXT_ERROR,
    KeyTextError,
    cipher,
    clean_key,
    clear_key,
    env_key,
    keys_revision,
    live_rows,
    load_keyring,
    resolve_key,
    secret_state,
    store_key,
)
from app.services.llm_store import load_effective, loaded_workers, publish_keys_version
from app.services.llm_validate import is_keyless
from app.services.review_service import Identity

router = APIRouter()
KEY_RATE = "20/hour"
BODY_MAX = 4096
BODY_ERROR = 'the body must be a JSON object {"key": "..."} of at most 4 KiB'
SECRET_TEXT = {"no_secret": "LLM_KEYS_SECRET is not set on the server: keys cannot be stored from the console",
               "bad_secret": "LLM_KEYS_SECRET on the server is not a list of Fernet keys: keys cannot be stored"}
ProviderName = Annotated[str, Path(pattern=f"^{PROVIDER_NAME.pattern}$", max_length=32)]


def _fail(status: int, detail: str, **extra: Any) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": detail, **extra})


async def _limited(deps: AppDeps, identity: Identity) -> JSONResponse | None:
    decision = await deps.limits.hit("llm-key", identity.admin.label, KEY_RATE)
    if decision.allowed:
        return None
    return JSONResponse(status_code=429, content={"detail": "too many key changes; wait and try again"},
                        headers={"Retry-After": str(decision.retry_after)})


async def _body_key(request: Request) -> str:
    """The key from a capped JSON body; KeyTextError (fixed text) for anything else."""
    data = bytearray()
    async for chunk in request.stream():
        data += chunk
        if len(data) > BODY_MAX:
            raise ValueError(BODY_ERROR)
    try:
        body = json.loads(bytes(data) or b"null")
    except (ValueError, RecursionError):  # RecursionError: a few KB of nested brackets
        raise ValueError(BODY_ERROR) from None
    if not isinstance(body, dict) or "key" not in body:
        raise ValueError(BODY_ERROR)
    return clean_key(body["key"])


def _env(name: str, origin: str, settings) -> dict[str, Any]:
    variable = key_env(name)
    value, _problem = env_key(name, origin, settings)
    if name in PROVIDER_KEYS:
        return {"name": variable, "set": bool(value), "origin_ok": True}
    return {"name": variable, "set": bool(os.environ.get(variable)), "origin_ok": bool(value)}


async def keys_state(deps: AppDeps) -> dict[str, Any]:
    """Everything the providers tab shows: each configured provider with its key status (never the key), the stored
    keys of providers no longer configured (orphans) and the workers' reports."""
    settings = deps.service.settings
    state = secret_state(settings)
    async with deps.session_factory() as session:
        rows = {row.provider: row for row in await live_rows(session)}
        revision = await keys_revision(session)
        ring = await load_keyring(session, settings)
        try:
            effective = await load_effective(session, settings)
            error = None
        except CONFIG_ERRORS as exc:
            effective, error = None, config_error_summary(exc)
    providers: list[dict[str, Any]] = []
    used: dict[str, list[str]] = {}
    if effective is not None:
        running = settings.llm_preset if effective.source == "file" and settings.llm_preset else None
        try:
            resolved = resolve_llm_config(effective.config, running, where=effective.label)
            for role in resolved.roles.values():
                used.setdefault(role.provider, []).append(role.role)
        except CONFIG_ERRORS:
            pass  # an LLM_PRESET that names no preset: no role is in use, the models page says why
        for name, spec in effective.config.providers.items():
            origin = provider_origin(name, spec)
            choice = resolve_key(name, spec, ring, settings)
            row = rows.get(name)
            live = row is not None and row.ciphertext is not None
            providers.append({
                "name": name, "kind": provider_kind(name, spec), "origin": origin, "used_by": used.get(name, []),
                "keyless": is_keyless(name, spec),
                "key": {"source": choice.source, "problem": choice.problem,
                        "last4": row.last4 if live else None, "bound_origin": row.bound_origin if live else None,
                        "updated_at": row.updated_at if live else None, "updated_by": row.updated_by if live else None},
                "env": _env(name, origin, settings)})
    configured = {p["name"] for p in providers}
    orphans = [{"name": row.provider, "last4": row.last4, "bound_origin": row.bound_origin,
                "updated_at": row.updated_at, "unreadable": row.provider in ring.unreadable}
               for row in rows.values() if row.ciphertext is not None and row.provider not in configured
               and error is None]  # an unreadable config says nothing about which providers are configured
    return {"writable": state == "ok", "reason": None if state == "ok" else state, "keys_version": revision,
            "config_version": effective.version if effective is not None else None, "config_error": error,
            "providers": providers, "orphans": orphans, "loaded": await loaded_workers(deps.redis)}


@router.get("/admin/llm-keys")
async def llm_keys(deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)):
    return JSONResponse(content=jsonable_encoder(await keys_state(deps)))


async def _answer(deps: AppDeps, revision: int) -> JSONResponse:
    notified = await publish_keys_version(deps.redis, revision)  # False: the workers' poll repairs it from the DB
    state = await keys_state(deps)
    return JSONResponse(content=jsonable_encoder({**state, "workers_notified": notified}))


@router.put("/admin/llm-keys/{provider}")
async def llm_key_set(provider: ProviderName, request: Request, deps: AppDeps = Depends(get_deps),
                      identity: Identity = Depends(require_admin)):
    if limited := await _limited(deps, identity):
        return limited
    try:
        key = await _body_key(request)
    except KeyTextError:
        return _fail(422, KEY_TEXT_ERROR)
    except ValueError:
        return _fail(422, BODY_ERROR)
    settings = deps.service.settings
    fernet = cipher(settings)
    if fernet is None:
        state = secret_state(settings)
        return _fail(409, SECRET_TEXT[state], code=state)
    async with deps.session_factory() as session:
        try:
            effective = await load_effective(session, settings)
        except CONFIG_ERRORS as exc:
            return _fail(409, f"the configuration in use cannot be read: {config_error_summary(exc)}")
    spec = effective.config.providers.get(provider)
    if spec is None:
        return _fail(404, f"provider {provider} is not configured; save a version with it first")
    origin = provider_origin(provider, spec)
    if len(origin) > MAX_ORIGIN:  # backstop: the document refuses these, but a stored one may predate the rule
        return _fail(422, f"the provider's origin is longer than {MAX_ORIGIN} characters: shorten its base_url")
    async with deps.session_factory() as session, session.begin():
        row, replaced = await store_key(session, fernet, provider, origin, key, by=identity.admin.label)
        await record(session, identity.admin, "llm_key.replace" if replaced else "llm_key.set", target_type="llm_key",
                     target_id=provider, after={"provider": provider, "kind": provider_kind(provider, spec),
                                                "origin": origin, "revision": row.revision},
                     ip_hash=ip_hash_of(identity, deps))
        revision = row.revision
    return await _answer(deps, revision)


@router.delete("/admin/llm-keys/{provider}")
async def llm_key_delete(provider: ProviderName, deps: AppDeps = Depends(get_deps),
                         identity: Identity = Depends(require_admin)):
    """Works without a secret and for providers no longer configured, so an unreadable or orphaned key can always go.
    It does not revoke the key at the provider."""
    if limited := await _limited(deps, identity):
        return limited
    async with deps.session_factory() as session, session.begin():
        row = await clear_key(session, provider, by=identity.admin.label)
        if row is None:
            return _fail(404, f"no stored key for provider {provider}")
        await record(session, identity.admin, "llm_key.delete", target_type="llm_key", target_id=provider,
                     after={"provider": provider, "revision": row.revision}, ip_hash=ip_hash_of(identity, deps))
        revision = row.revision
    return await _answer(deps, revision)
