"""Workers pick up a saved LLM configuration without a restart (Plan 23b). Each worker compares the Redis key
LLM_VERSION_KEY with the version it loaded when a review job starts, and the DB's newest version every 30 seconds; the
poll also repairs the key (a lost publish, a key above the DB's newest) and treats the DB as the truth. On a change it
rebuilds its LLMs (on the worker's current semaphore, ctx["llm_sem"], which a Plan 23c llm_concurrency change replaces
for reviews that start afterwards; the catalog the API sees) and graph (same checkpointer). Runners already
holding the old graph keep it, so a review never switches models mid-way. A configuration that fails to build keeps the
old models and is reported. Each worker also re-reports its state on every poll (a heartbeat), so `loaded_at` in
LOADED_KEY means "last seen"."""
from __future__ import annotations

import asyncio
import contextlib
import dataclasses
import os
import socket

from app.graph.factory import build_graph_deps
from app.graph.graph import build_graph
from app.logging import get_logger
from app.services import model_catalog
from app.services.llm import build_llms
from app.services.llm_config import ResolvedLLMConfig, load_llm_config
from app.services.llm_store import (
    LLM_VERSION_KEY,
    LOADED_KEY,
    load_effective,
    publish_version,
    reconcile_version_key,
    report_loaded,
)
from app.services.model_catalog import ModelInfo, cached_catalog

log = get_logger(__name__)
POLL_SECONDS = 30.0
RELOAD_CATALOG_TIMEOUT_SECONDS = 10


async def load_live_catalog() -> dict[str, ModelInfo]:
    """The worker's catalog fetch on a cold cache: one attempt with a short timeout, because it runs inside the reload
    lock that job starts wait on (the shared client's retries would hold it for about two minutes when OpenRouter is
    unreachable)."""
    return await model_catalog.load_live_catalog(timeout=RELOAD_CATALOG_TIMEOUT_SECONDS, retries=0)


def worker_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}"


async def initial_llm_config(session_factory, settings) -> tuple[ResolvedLLMConfig | None, str, str | None]:
    """(resolved config, active id, error) for worker startup. A DB version that cannot be read or resolved falls
    back to config/llm.yaml so the worker still starts; the error is reported."""
    try:
        async with session_factory() as session:
            effective = await load_effective(session, settings)
        return effective.resolve(), effective.active_id, None
    except Exception as exc:  # noqa: BLE001
        log.error("llm_config_load_failed", error=str(exc))
        return load_llm_config(settings.llm_config_path, settings.llm_preset), "file", str(exc)


async def refresh_llms(ctx: dict, *, build_graph_fn=build_graph, poll: bool = False) -> bool:
    """Rebuild the models when the active version changed. True when this call switched to a new version.
    A job start trusts the Redis key (one cheap GET). A poll reads the DB's newest id instead, repairs the key to match
    and clears a load error that is stale because the worker already runs the DB's active id."""
    redis = ctx["events_redis"]
    try:
        if poll:
            newest = await reconcile_version_key(redis, ctx["session_factory"])
            wanted = str(newest) if newest is not None else "file"
            if wanted == ctx.get("llm_version"):
                ctx["llm_error"] = None
        else:
            wanted = await redis.get(LLM_VERSION_KEY)
    except Exception as exc:  # noqa: BLE001 - keep the current models while Redis or the DB is unreachable
        if poll:
            log.warning("llm_poll_reconcile_failed", error=str(exc))
        return False
    if not wanted or wanted == ctx.get("llm_version"):
        return False
    async with ctx["llm_lock"]:
        if wanted == ctx.get("llm_version"):
            return False
        settings = ctx["settings"]
        try:
            async with ctx["session_factory"]() as session:
                effective = await load_effective(session, settings)
            if effective.source == "db" and effective.active_id != wanted:
                # Redis holds a stale id (a lost or out-of-order publish): put the DB's newest back so the next poll
                # sees no change. publish_version only ever raises the key.
                await publish_version(redis, effective.version)
            if effective.active_id == ctx.get("llm_version"):
                return False  # Redis and the DB disagree but this worker already runs what the DB says
            resolved = effective.resolve()
            catalog = None
            if settings.graph_mode == "stub":
                deps, graph = ctx["graph_deps"], ctx["graph"]
            else:
                # The catalog the API's validate and test call use (shared in Redis); the worker's own startup fetch
                # only when that is unavailable, so a model added since startup is built with its real capabilities.
                catalog = await cached_catalog(redis, load_live_catalog) or ctx.get("catalog")
                llms = build_llms(settings, catalog, resolved=resolved, sem=ctx["llm_sem"],
                                  config_version=effective.label)
                deps = dataclasses.replace(ctx["graph_deps"], llms=llms)
                graph = build_graph_fn(deps, checkpointer=getattr(ctx["graph"], "checkpointer", None))
        except Exception as exc:  # noqa: BLE001 - keep serving with the models already loaded
            log.error("llm_reload_failed", wanted=wanted, error=str(exc))
            ctx["llm_error"] = str(exc)
            await report_state(ctx)
            return False
        ctx["graph_deps"], ctx["graph"], ctx["llm_version"] = deps, graph, effective.active_id
        ctx["llm_preset"], ctx["llm_error"], ctx["llm_resolved"] = resolved.preset, None, resolved
        if catalog is not None:
            ctx["catalog"] = catalog
        await report_state(ctx)
        log.info("llm_reloaded", version=effective.active_id, preset=resolved.preset)
        return True


async def report_state(ctx: dict) -> None:
    """Report this worker's current state to LOADED_KEY: the version it runs, its preset and the last load error
    (ctx["llm_error"], cleared by the next successful load), plus (Plan 23c, through `extra`) the settings version
    ("env" when none), the glossary version ("file" when none) and runtime_error (the last failed settings/glossary
    reload, cleared by the next one that succeeds or by a poll that finds the worker on the DB's versions).
    `loaded_at` therefore means "last seen", not "loaded at"."""
    preset = ctx.get("llm_preset") or getattr(getattr(ctx.get("graph_deps"), "llms", None), "preset", "") or ""
    extra = {"settings": ctx.get("settings_version") or "env", "glossary": ctx.get("glossary_version") or "file",
             "runtime_error": ctx.get("runtime_error")}
    await report_loaded(ctx["events_redis"], worker_id(), ctx.get("llm_version") or "file", preset,
                        error=ctx.get("llm_error"), extra=extra)


async def poll_llm_config(ctx: dict, interval: float = POLL_SECONDS) -> None:
    """Background check so a worker picks up a new version within one interval, even when the publish was lost. Every
    pass ends with report_state, a heartbeat that keeps this worker listed (and any failure shown) while it is alive."""
    while True:
        try:
            await refresh_llms(ctx, poll=True)
            await report_state(ctx)
        except Exception as exc:  # noqa: BLE001 - the poller must never die
            log.error("llm_poll_failed", error=str(exc))
        await asyncio.sleep(interval)


def _wire(ctx: dict, resolved: ResolvedLLMConfig | None, active_id: str, checkpointer, build_graph_fn):
    deps = build_graph_deps(ctx["settings"], ctx["http"], ctx["events_redis"], ctx["catalog"], resolved=resolved,
                            sem=ctx["llm_sem"], config_version=f"db:{active_id}" if active_id != "file" else "file",
                            glossary=ctx.get("glossary"))
    return deps, build_graph_fn(deps, checkpointer=checkpointer)


async def init_llms(ctx: dict, catalog, checkpointer, *, build_graph_fn=build_graph) -> None:
    """Worker startup: the process-wide LLM semaphore and lock, the effective configuration, the graph deps and the
    graph, then the first report. A saved version that resolves but cannot be built is as recoverable as a failed
    reload: the worker falls back to config/llm.yaml, reports the error and the poller retries the version. A
    configuration file that cannot be built either leaves nothing to run on, so that error propagates."""
    settings = ctx["settings"]
    ctx["catalog"] = catalog
    ctx["llm_sem"] = asyncio.Semaphore(max(1, settings.llm_concurrency))
    ctx["llm_sem_size"] = max(1, settings.llm_concurrency)  # Plan 23c: refresh_runtime compares it with the setting
    ctx["llm_lock"] = asyncio.Lock()
    resolved, active_id, error = await initial_llm_config(ctx["session_factory"], settings)
    try:
        deps, graph = _wire(ctx, resolved, active_id, checkpointer, build_graph_fn)
    except Exception as exc:
        if active_id == "file":
            raise
        log.error("llm_startup_build_failed", version=active_id, error=str(exc))
        resolved = load_llm_config(settings.llm_config_path, settings.llm_preset)
        active_id, error = "file", str(exc)
        deps, graph = _wire(ctx, resolved, active_id, checkpointer, build_graph_fn)
    ctx["graph_deps"], ctx["graph"], ctx["llm_version"] = deps, graph, active_id
    ctx["llm_preset"], ctx["llm_error"], ctx["llm_resolved"] = resolved.preset if resolved else "", error, resolved
    await report_state(ctx)


async def stop_llms(ctx: dict) -> None:
    """Worker shutdown: end the poller (awaited, so its heartbeat cannot re-add the worker), then drop this worker's
    entry from LOADED_KEY. Best effort: nothing here may stop the rest of the shutdown."""
    poller = ctx.get("llm_poller")
    if poller is not None:
        poller.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await poller
    try:
        await ctx["events_redis"].hdel(LOADED_KEY, worker_id())
    except Exception:  # noqa: BLE001
        log.warning("llm_loaded_remove_failed", worker=worker_id())
