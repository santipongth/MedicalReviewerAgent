"""Admin console: runtime settings and the Thai glossary (Plan 23c). Thin adapters over config_store with the
settings and glossary kinds. Every change writes its audit row in the same transaction; after the commit the Redis
mirror is raised (workers reload within 30 s) and this process's cache is dropped (other API processes follow
within 5 s). Validation is done against the env settings, never against other overrides."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.api.admin_models import Before, Note, VersionId
from app.api.auth import ip_hash_of, require_admin
from app.api.deps import get_deps
from app.api.reviews import service_error_response
from app.harness.glossary import SEED_GLOSSARY, render_glossary, seed_document
from app.runtime import AppDeps
from app.services.budget import worst_case_review_cap
from app.services.config_store import (
    DocKind,
    DocumentError,
    get_version,
    list_versions,
    newest,
    publish,
    reset_to_seed,
    restore_version,
    save_version,
    version_out,
)
from app.services.glossary_store import GLOSSARY_KIND, RENDERED_MAX
from app.services.llm_store import loaded_workers
from app.services.review_service import Identity, ServiceError
from app.services.runtime_settings import SETTINGS_KIND, SPECS, apply_overrides, spec_out

router = APIRouter()
TERMS_BODY_MAX = 1000  # more rows than TERMS_MAX reach the validator, which says how many fit


class SettingsDraft(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict)


class SettingsSave(BaseModel):
    values: dict[str, Any]  # required: a body without it must not save "env everywhere"
    base_version: int | None
    note: Note = None


class GlossaryDraft(BaseModel):
    terms: list[Any] = Field(max_length=TERMS_BODY_MAX)


class GlossarySave(GlossaryDraft):
    base_version: int | None
    note: Note = None


class BaseBody(BaseModel):
    base_version: int | None
    note: Note = None


async def _write(deps: AppDeps, kind: DocKind, action) -> JSONResponse:
    try:
        async with deps.session_factory() as session, session.begin():
            row = await action(session)
    except DocumentError as exc:
        return JSONResponse(status_code=422, content={"detail": str(exc), "errors": exc.errors})
    except ServiceError as exc:
        return service_error_response(exc)
    notified = await publish(deps.redis, kind, row)  # False: Redis was not updated; readers fall back to the DB
    if deps.runtime is not None:
        deps.runtime.invalidate()
    return JSONResponse(status_code=201, content=jsonable_encoder({**version_out(row), "workers_notified": notified}))


def _history_routes(kind: DocKind) -> None:
    base = f"/admin/{kind.name}"

    @router.get(f"{base}/versions")
    async def versions(before: Before = None, limit: int = Query(50, ge=1, le=100),
                       deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> dict:
        async with deps.session_factory() as session:
            rows, nxt = await list_versions(session, kind, before=before, limit=limit)
        return {"items": [version_out(r) for r in rows], "next": nxt}

    @router.get(f"{base}/versions/{{version}}")
    async def one_version(version: VersionId, deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)):
        try:
            async with deps.session_factory() as session:
                row = await get_version(session, kind, version)
        except ServiceError as exc:
            return service_error_response(exc)
        return jsonable_encoder({**version_out(row), "document": row.document})

    @router.post(f"{base}/versions/{{version}}/restore", status_code=201)
    async def restore(version: VersionId, body: BaseBody, deps: AppDeps = Depends(get_deps),
                      identity: Identity = Depends(require_admin)):
        settings, ip_hash = deps.service.settings, ip_hash_of(identity, deps)
        return await _write(deps, kind, lambda s: restore_version(
            s, identity.admin, kind, version, settings=settings, base_version=body.base_version, note=body.note,
            ip_hash=ip_hash))

    @router.post(f"{base}/reset", status_code=201)
    async def reset(body: BaseBody, deps: AppDeps = Depends(get_deps), identity: Identity = Depends(require_admin)):
        settings, ip_hash = deps.service.settings, ip_hash_of(identity, deps)
        return await _write(deps, kind, lambda s: reset_to_seed(
            s, identity.admin, kind, settings=settings, base_version=body.base_version, note=body.note,
            ip_hash=ip_hash))


for _kind in (SETTINGS_KIND, GLOSSARY_KIND):
    _history_routes(_kind)


def _in_force(base, overrides: dict[str, Any]) -> dict[str, Any]:
    effective = apply_overrides(base, overrides)
    return {"values": {s.name: getattr(effective, s.name) for s in SPECS},
            "worst_case_review_usd": round(worst_case_review_cap(effective), 4)}


@router.get("/admin/settings")
async def settings_state(deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> dict:
    base = deps.service.settings
    async with deps.session_factory() as session:
        row = await newest(session, SETTINGS_KIND)
    overrides = dict((row.document or {}).get("values") or {}) if row else {}
    return {"source": "db" if row else "env", "version": row.version if row else None, **_in_force(base, overrides),
            "overrides": overrides, "env": {s.name: getattr(base, s.name) for s in SPECS},
            "specs": [spec_out(s) for s in SPECS], "loaded": await loaded_workers(deps.redis)}


@router.post("/admin/settings/validate")
async def settings_validate(body: SettingsDraft, deps: AppDeps = Depends(get_deps),
                            _: Identity = Depends(require_admin)) -> dict:
    base = deps.service.settings
    try:
        document, warnings = SETTINGS_KIND.validate(body.model_dump(), base)
    except DocumentError as exc:
        return {"ok": False, "errors": exc.errors, "warnings": [], "values": None, "worst_case_review_usd": None}
    return {"ok": True, "errors": [], "warnings": warnings, **_in_force(base, document["values"])}


@router.post("/admin/settings", status_code=201)
async def settings_save(body: SettingsSave, deps: AppDeps = Depends(get_deps),
                        identity: Identity = Depends(require_admin)):
    settings, ip_hash = deps.service.settings, ip_hash_of(identity, deps)
    raw = {"values": body.values}
    return await _write(deps, SETTINGS_KIND, lambda s: save_version(
        s, identity.admin, SETTINGS_KIND, raw, settings=settings, base_version=body.base_version, note=body.note,
        ip_hash=ip_hash))


@router.get("/admin/glossary")
async def glossary_state(deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> dict:
    async with deps.session_factory() as session:
        row = await newest(session, GLOSSARY_KIND)
    terms = row.document["terms"] if row else seed_document()["terms"]
    text = render_glossary(terms) if row else SEED_GLOSSARY.text
    return {"source": "db" if row else "file", "version": row.version if row else None, "terms": terms,
            "chars": len(text), "max_chars": RENDERED_MAX, "loaded": await loaded_workers(deps.redis)}


@router.post("/admin/glossary/validate")
async def glossary_validate(body: GlossaryDraft, deps: AppDeps = Depends(get_deps),
                            _: Identity = Depends(require_admin)) -> dict:
    try:
        document, warnings = GLOSSARY_KIND.validate(body.model_dump(), deps.service.settings)
    except DocumentError as exc:
        return {"ok": False, "errors": exc.errors, "warnings": [], "preview": None, "chars": None}
    preview = render_glossary(document["terms"])
    return {"ok": True, "errors": [], "warnings": warnings, "preview": preview, "chars": len(preview)}


@router.post("/admin/glossary", status_code=201)
async def glossary_save(body: GlossarySave, deps: AppDeps = Depends(get_deps),
                        identity: Identity = Depends(require_admin)):
    settings, ip_hash = deps.service.settings, ip_hash_of(identity, deps)
    raw = {"terms": body.terms}
    return await _write(deps, GLOSSARY_KIND, lambda s: save_version(
        s, identity.admin, GLOSSARY_KIND, raw, settings=settings, base_version=body.base_version, note=body.note,
        ip_hash=ip_hash))
