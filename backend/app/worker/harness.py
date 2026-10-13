"""The Cochrane harness worker (Plan 23c). It has its own arq queue (HARNESS_QUEUE) and process, so a run of hours
never takes a review slot, and it runs one job at a time. A job replays the frozen pools with the production nodes
(run_all) on the service's effective models (23b), settings and glossary (23c), inside the run's USD cap:
run_all(strict_cap=True) never starts a review whose own cap does not fit in what is left, and a retried job counts
what earlier attempts spent (the run files, plus the cap of every review that was started and never finished: see
run_all's in-flight markers). Cancel is graceful (checked before each review). Every way a job can end frees the run's
active slot: the job has its own deadline a minute before arq's, so a timeout is recorded as an error instead of
leaving the run queued; a job interrupted for the last allowed try is recorded as an error instead of being requeued
into arq's "max retries exceeded" (which never calls the function). The service starts only with
`docker compose --profile harness up -d harness`."""
from __future__ import annotations

import asyncio
import contextlib
import json
import math
import os
import socket
from datetime import UTC, datetime
from typing import ClassVar

from arq import func
from arq.connections import RedisSettings
from arq.worker import Retry
from redis.asyncio import Redis

from app.cli.eval import git_sha
from app.config import get_settings
from app.db.session import make_engine, make_session_factory
from app.evals.batch import run_all
from app.evals.models import load_manifest
from app.evals.results import prior_spend, write_report
from app.graph.factory import build_graph_deps
from app.logging import configure_logging, get_logger
from app.services.harness_runs import (
    WORKER_KEY,
    WORKER_TTL_SECONDS,
    claim,
    finish,
    progress,
    requeue,
    run_stopped,
    selection,
    set_config,
)
from app.services.http import DEFAULT_MIN_INTERVAL, HttpClient
from app.services.llm_store import load_effective
from app.services.model_catalog import cached_catalog
from app.services.queue import HARNESS_QUEUE
from app.services.runtime_config import load_runtime
from app.worker.llm_reload import load_live_catalog

log = get_logger(__name__)
JOB_TIMEOUT_SECONDS = 12 * 3600
JOB_DEADLINE_SECONDS = JOB_TIMEOUT_SECONDS - 60  # the job's own deadline fires first (arq's timeout cannot free the slot)
MAX_TRIES = 3
CLAIM_RETRY_SECONDS = 30
HEARTBEAT_SECONDS = 30
MARKER_UNREADABLE = ("an in-flight marker of an earlier attempt could not be read, so its spend is unknown; "
                     "the run was stopped to protect the cap")


async def build_eval_deps(ctx: dict):
    """Graph deps for a replay, built as a review worker builds them: the effective LLM config (23b's load_effective;
    LLM_PRESET applies while llm.yaml is the source), the settings and glossary in force, and the OpenRouter catalog the
    API and the review workers share (cached_catalog with 23b's one-attempt worker loader), so structured-output
    methods and prices match production. No citation network and no external tools, as in the eval CLI. Returns the
    deps and the labels the run records."""
    base = ctx["settings"]
    async with ctx["session_factory"]() as session:
        effective = await load_effective(session, base)
    resolved = effective.resolve()  # an LLM_PRESET that names no preset fails here, before anything is spent
    runtime = await load_runtime(ctx["session_factory"], base)
    catalog = await cached_catalog(ctx["redis_client"], load_live_catalog)
    deps = build_graph_deps(runtime.settings, ctx["http"], catalog=catalog, resolved=resolved,
                            config_version=effective.label, glossary=runtime.glossary)
    deps.openalex, deps.mcp = None, None
    return deps, {"llm_config": effective.label, "settings_version": runtime.settings_version,
                  "glossary": runtime.glossary.label}


def _try(ctx: dict) -> int:
    return ctx.get("job_try", 1)


async def run_harness(ctx: dict, run_pk: int) -> dict:
    session_factory = ctx["session_factory"]
    try:
        row = await claim(session_factory, run_pk)
    except Exception as exc:  # the database is unreachable: retry the job, which has not started anything yet
        log.warning("harness_claim_failed", run=run_pk, error=type(exc).__name__)
        if _try(ctx) >= MAX_TRIES:  # arq never calls a fourth try: a Retry here would only hide the failure
            raise
        raise Retry(defer=CLAIM_RETRY_SECONDS) from exc
    if row is None:
        return {"run": run_pk, "status": "skipped"}
    deadline = asyncio.timeout(JOB_DEADLINE_SECONDS)
    try:
        async with deadline:
            return await _replay(ctx, row)
    except asyncio.CancelledError:
        if _try(ctx) >= MAX_TRIES:  # arq will not call this job again: free the slot now
            await finish(session_factory, run_pk, status="error", error=f"interrupted {MAX_TRIES} times")
        else:
            await requeue(session_factory, run_pk)
        raise
    except Exception as exc:  # recorded on the run, not retried (log.exception keeps the traceback)
        if isinstance(exc, TimeoutError) and deadline.expired():
            log.error("harness_run_timed_out", run=run_pk)
            error = "timed out"
        else:
            log.exception("harness_run_failed", run=run_pk)
            error = f"{type(exc).__name__}: {exc}"
        final = await finish(session_factory, run_pk, status="error", error=error)
        return {"run": run_pk, "status": final or "error"}


async def _replay(ctx: dict, row) -> dict:
    session_factory, run_pk = ctx["session_factory"], row.id
    pv = ctx["settings"].prompt_version
    if pv != row.prompt_version:  # before anything is built, fetched or spent
        raise RuntimeError(f"this worker runs prompt_version {pv} but the run was started for "
                           f"{row.prompt_version}; rebuild the containers")
    deps, labels = await ctx.get("build_eval_deps", build_eval_deps)(ctx)
    await set_config(session_factory, run_pk, labels)
    manifest = load_manifest()
    entries = selection(manifest, row.strata or [], row.max_reviews)
    earlier = prior_spend(pv, row.run_id)

    async def on_record(rec, summary) -> None:
        await progress(session_factory, run_pk, summary)

    async def should_stop() -> bool:
        return await run_stopped(session_factory, run_pk)

    summary = await ctx.get("run_all", run_all)(
        deps, manifest, run_id=row.run_id, repeats=row.repeats, max_usd=row.max_usd,
        ids=[e.id for e in entries], git_sha=git_sha(), strict_cap=True,
        spent_before=earlier, on_record=on_record, should_stop=should_stop)
    report = write_report(pv, row.run_id, manifest, row.compare_run)
    status = "cancelled" if summary.cancelled else "stopped" if summary.stopped_for_budget else "done"
    note = MARKER_UNREADABLE if status == "stopped" and math.isinf(earlier) else None
    final = await finish(session_factory, run_pk, status=status, summary=summary,
                         report=report.name if report else None, error=note) or status
    spent = round(summary.spent, 6) if math.isfinite(summary.spent) else None
    log.info("harness_run_finished", run=run_pk, status=final, spent=spent)  # final: an admin may have cancelled late
    return {"run": run_pk, "status": final, "spent_usd": spent}


async def heartbeat(ctx: dict, interval: float = HEARTBEAT_SECONDS) -> None:
    """The console's sign of life (WORKER_KEY expires 90 s after the last beat)."""
    name = f"{socket.gethostname()}:{os.getpid()}"
    while True:
        try:
            await ctx["redis_client"].set(WORKER_KEY, json.dumps(
                {"worker": name, "seen_at": datetime.now(UTC).isoformat(timespec="seconds")}), ex=WORKER_TTL_SECONDS)
        except Exception:  # noqa: BLE001 - the next beat retries
            log.warning("harness_heartbeat_failed")
        await asyncio.sleep(interval)


async def startup(ctx: dict) -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    ctx["settings"] = settings
    ctx["engine"] = make_engine(settings.database_url)
    ctx["session_factory"] = make_session_factory(ctx["engine"])
    ctx["redis_client"] = Redis.from_url(settings.redis_url, decode_responses=True)
    ctx["http"] = HttpClient(timeout=settings.http_timeout_seconds, min_interval=DEFAULT_MIN_INTERVAL)
    ctx["heartbeat"] = asyncio.create_task(heartbeat(ctx))
    log.info("harness_worker_started", graph_mode=settings.graph_mode)


async def shutdown(ctx: dict) -> None:
    task = ctx.get("heartbeat")
    if task is not None:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task
    with contextlib.suppress(Exception):
        await ctx["redis_client"].delete(WORKER_KEY)
    await ctx["http"].aclose()
    await ctx["redis_client"].aclose()
    await ctx["engine"].dispose()


class HarnessWorkerSettings:
    functions: ClassVar[list] = [func(run_harness, name="run_harness", timeout=JOB_TIMEOUT_SECONDS,
                                      max_tries=MAX_TRIES)]
    queue_name = HARNESS_QUEUE
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    max_jobs = 1
    job_timeout = JOB_TIMEOUT_SECONDS
    retry_jobs = True  # a shutdown re-runs the job; it resumes (existing run files are skipped, their cost counted)
    max_tries = MAX_TRIES
    keep_result = 0
    health_check_interval = 60
