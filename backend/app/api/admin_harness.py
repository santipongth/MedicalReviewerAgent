"""Admin console: the Cochrane harness (Plan 23c). Reports and run folders are read from the mounted evals/cochrane
directory (read-only in the API container); a start records the run and enqueues it on the harness queue, whose worker
runs only with `docker compose --profile harness`. File reads and comparisons run in a thread."""
from __future__ import annotations

import asyncio
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from app.api.admin_models import ID_MAX, Before
from app.api.auth import ip_hash_of, require_admin
from app.api.deps import get_deps
from app.api.reviews import service_error_response
from app.evals.results import compare_results, list_reports, list_results, read_report
from app.logging import get_logger
from app.runtime import AppDeps
from app.services.harness_runs import (
    HarnessUnavailable,
    StartBody,
    cancel_run,
    finish,
    get_run,
    harness_state,
    list_runs,
    run_out,
    start_run,
)
from app.services.review_service import Identity, ServiceError

router = APIRouter()
log = get_logger(__name__)

RunPk = Annotated[int, Path(ge=1, le=ID_MAX)]  # a larger id is a Postgres INTEGER overflow (a 500), so it is a 422


@router.get("/admin/harness")
async def harness(deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)):
    return jsonable_encoder(await harness_state(deps.session_factory, deps.redis, await deps.service.effective()))


@router.get("/admin/harness/runs")
async def runs(before: Before = None, limit: int = Query(20, ge=1, le=100),
               deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)):
    rows, nxt = await list_runs(deps.session_factory, before=before, limit=limit)
    return jsonable_encoder({"items": [run_out(r) for r in rows], "next": nxt})


@router.get("/admin/harness/runs/{run_pk}")
async def one_run(run_pk: RunPk, deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)):
    try:
        return jsonable_encoder(run_out(await get_run(deps.session_factory, run_pk)))
    except ServiceError as exc:
        return service_error_response(exc)


@router.post("/admin/harness/runs", status_code=201)
async def start(body: StartBody, deps: AppDeps = Depends(get_deps), identity: Identity = Depends(require_admin)):
    settings = await deps.service.effective()
    try:
        row = await start_run(deps.session_factory, deps.redis, settings, identity.admin, body,
                              ip_hash=ip_hash_of(identity, deps))
    except HarnessUnavailable as exc:
        return JSONResponse(status_code=503, content={"detail": exc.detail, "reasons": exc.reasons})
    except ServiceError as exc:
        return service_error_response(exc)
    try:
        await deps.queue.enqueue_harness(row.id)
    except Exception:
        log.exception("harness_enqueue_failed", run=row.id)
        await finish(deps.session_factory, row.id, status="error", error="enqueue failed")
        return JSONResponse(status_code=503, content={"detail": "the harness queue is unavailable; try again",
                                                      "reasons": []})
    return JSONResponse(status_code=201, content=jsonable_encoder(run_out(row)))


@router.post("/admin/harness/runs/{run_pk}/cancel")
async def cancel(run_pk: RunPk, deps: AppDeps = Depends(get_deps), identity: Identity = Depends(require_admin)):
    try:
        row = await cancel_run(deps.session_factory, identity.admin, run_pk, ip_hash=ip_hash_of(identity, deps))
    except ServiceError as exc:
        return service_error_response(exc)
    return jsonable_encoder(run_out(row))


@router.get("/admin/harness/reports")
async def reports(_: Identity = Depends(require_admin)):
    return {"items": await asyncio.to_thread(list_reports)}


@router.get("/admin/harness/reports/{name}")
async def report(name: str, _: Identity = Depends(require_admin)):
    try:
        text = await asyncio.to_thread(read_report, name)
    except FileNotFoundError:
        return JSONResponse(status_code=404, content={"detail": "no such report (or it is over 1 MB)"})
    return {"name": name, "text": text}


@router.get("/admin/harness/results")
async def results(_: Identity = Depends(require_admin)):
    return {"items": await asyncio.to_thread(list_results)}


@router.get("/admin/harness/compare")
async def compare(a: str = Query(max_length=129), b: str = Query(max_length=129), _: Identity = Depends(require_admin)):
    try:
        return await asyncio.to_thread(compare_results, a, b)
    except LookupError as exc:
        return JSONResponse(status_code=404, content={"detail": str(exc)})
    except FileNotFoundError:
        return JSONResponse(status_code=404, content={"detail": "the harness manifest is missing"})
    except ValueError as exc:
        return JSONResponse(status_code=422, content={"detail": str(exc)})
