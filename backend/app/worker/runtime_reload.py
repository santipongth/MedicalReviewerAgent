"""Workers follow saved runtime settings and glossary versions without a restart (Plan 23c), the way they follow LLM
config versions (Plan 23b, app/worker/llm_reload.py), and under the same lock (ctx["llm_lock"]). A job start trusts the
Redis mirrors (one MGET; a missing mirror is no news). The 30-second poll reads the DB instead through
reconcile_mirror, which also repairs the mirrors (a lost publish, a mirror above the DB), so a saved version reaches
every worker and every API process within one interval even when its publish failed. When either kind moved, the
worker reads both from the DB and rebuilds its graph deps (settings, glossary) and graph. A running review keeps the
graph it started with, and so its caps, glossary and LLM semaphore. An llm_concurrency change gives reviews that start
afterwards a new semaphore (their LLMs are rebuilt on it, with the catalog the current LLMs were built with); reviews
already running keep the old one, so for a short while the process may run up to old + new calls. In stub mode there
are no LLMs to rebuild; the stub graph is rebuilt with the new settings. A failed reload keeps the old state and
reports runtime_error; the next poll retries, and a poll that finds the worker already on the DB's versions clears a
stale error. Anything that fails while reading a version, including a stored row nobody should have written (a hand
edit that left the document or its values something other than a mapping), is such a failure: startup falls back to env
and the built-in glossary and the poll that cannot read the versions reports it, so a bad row never stops the worker."""
from __future__ import annotations

import asyncio
import dataclasses

from app.graph.graph import build_graph
from app.harness.glossary import SEED_GLOSSARY
from app.logging import get_logger
from app.services.config_store import mirror_version, reconcile_mirror
from app.services.glossary_store import GLOSSARY_KIND
from app.services.llm import build_llms
from app.services.runtime_config import Runtime, load_runtime
from app.services.runtime_settings import SETTINGS_KIND
from app.worker.llm_reload import POLL_SECONDS, refresh_llms, report_state

log = get_logger(__name__)


async def init_runtime(ctx: dict) -> None:
    """Worker startup, before init_llms (the LLM semaphore then gets the configured size). ctx["base_settings"]
    keeps the env settings; ctx["settings"] becomes the settings in force. A DB that cannot be read leaves env values
    and the built-in glossary, and the error is reported; the poller retries."""
    base = ctx.setdefault("base_settings", ctx["settings"])
    try:
        runtime = await load_runtime(ctx["session_factory"], base)
    except Exception as exc:  # noqa: BLE001
        log.error("runtime_load_failed", error=str(exc))
        ctx.update(settings=base, glossary=SEED_GLOSSARY, settings_version="env", glossary_version="file",
                   runtime_error=str(exc)[:300])
        return
    ctx.update(settings=runtime.settings, glossary=runtime.glossary, settings_version=runtime.settings_version,
               glossary_version=runtime.glossary.label, runtime_error=None)


def _label(version: int | None, empty: str) -> str:
    return empty if version is None else str(version)


async def _wanted(ctx: dict, *, poll: bool) -> tuple[str | None, str | None]:
    """The (settings, glossary) versions this worker should run; None for a kind with no news."""
    redis = ctx["events_redis"]
    if poll:  # the DB is the truth; the mirrors are repaired on the way
        settings = await reconcile_mirror(redis, ctx["session_factory"], SETTINGS_KIND)
        glossary = await reconcile_mirror(redis, ctx["session_factory"], GLOSSARY_KIND)
        return _label(settings, "env"), _label(glossary, "file")
    raw_settings, raw_glossary = await redis.mget(SETTINGS_KIND.redis_key, GLOSSARY_KIND.redis_key)
    settings, glossary = mirror_version(raw_settings), mirror_version(raw_glossary)
    return (None if settings is None else str(settings)), (None if glossary is None else str(glossary))


def _rebuild(ctx: dict, runtime: Runtime, build_graph_fn):
    settings = runtime.settings
    sem, size = ctx["llm_sem"], max(1, settings.llm_concurrency)
    llms = getattr(ctx["graph_deps"], "llms", None)
    if size != ctx.get("llm_sem_size"):
        sem = asyncio.Semaphore(size)
        if llms is not None and ctx.get("llm_resolved") is not None:
            llms = build_llms(settings, ctx.get("catalog"), resolved=ctx["llm_resolved"], sem=sem,
                              config_version=getattr(llms, "config_version", "file"))
    deps = dataclasses.replace(ctx["graph_deps"], settings=settings, llms=llms, glossary=runtime.glossary)
    return deps, build_graph_fn(deps, checkpointer=getattr(ctx["graph"], "checkpointer", None)), sem, size


async def refresh_runtime(ctx: dict, *, build_graph_fn=None, poll: bool = False) -> bool:
    """Rebuild the deps when a settings or glossary version moved. True when this call switched."""
    build_graph_fn = build_graph_fn or build_graph
    try:
        wanted = await _wanted(ctx, poll=poll)
    except Exception as exc:  # noqa: BLE001 - keep the current state while Redis or the DB is unreachable
        if poll:  # a job start only trusts Redis; the poll is the check that says "I could not tell"
            log.warning("runtime_poll_reconcile_failed", error=str(exc))
            ctx["runtime_error"] = f"could not read the saved versions: {exc}"[:300]
        return False
    loaded = (ctx.get("settings_version"), ctx.get("glossary_version"))
    moved = any(w is not None and w != have for w, have in zip(wanted, loaded, strict=True))
    if not moved:
        if poll:
            ctx["runtime_error"] = None  # this worker already runs what the DB says: an old error is stale
        return False
    async with ctx["llm_lock"]:
        try:
            runtime = await load_runtime(ctx["session_factory"], ctx["base_settings"])
            if (runtime.settings_version, runtime.glossary.label) == (ctx.get("settings_version"),
                                                                      ctx.get("glossary_version")):
                return False  # the mirror disagrees with the DB and this worker already runs what the DB says
            deps, graph, sem, size = _rebuild(ctx, runtime, build_graph_fn)
        except Exception as exc:  # noqa: BLE001 - keep serving with what is loaded
            log.error("runtime_reload_failed", error=str(exc))
            ctx["runtime_error"] = str(exc)[:300]
            await report_state(ctx)
            return False
        ctx.update(settings=runtime.settings, glossary=runtime.glossary, graph_deps=deps, graph=graph, llm_sem=sem,
                   llm_sem_size=size, settings_version=runtime.settings_version,
                   glossary_version=runtime.glossary.label, runtime_error=None)
        await report_state(ctx)
        log.info("runtime_reloaded", settings=runtime.settings_version, glossary=runtime.glossary.label)
        return True


async def poll_runtime(ctx: dict, interval: float = POLL_SECONDS) -> None:
    """The worker's background check (it replaces 23b's poll_llm_config in startup): settings and glossary first,
    then the models (23b's DB check, poll=True), then the heartbeat. Never dies."""
    while True:
        try:
            await refresh_runtime(ctx, poll=True)
            await refresh_llms(ctx, poll=True)
            await report_state(ctx)
        except Exception as exc:  # noqa: BLE001 - the poller must never die
            log.error("runtime_poll_failed", error=str(exc))
        await asyncio.sleep(interval)
