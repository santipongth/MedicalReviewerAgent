"""Workers pick up a saved LLM configuration without a restart (Plan 23b). Each worker compares the Redis key
LLM_VERSION_KEY with the version it loaded, when a review job starts and every 30 seconds; on a change it rebuilds its
LLMs (same per-process semaphore) and graph (same checkpointer). Runners already holding the old graph keep it, so a
review never switches models mid-way. A configuration that fails to build keeps the old models and is reported."""
from __future__ import annotations

import asyncio
import dataclasses
import os
import socket

from app.graph.graph import build_graph
from app.logging import get_logger
from app.services.llm import build_llms
from app.services.llm_config import ResolvedLLMConfig
from app.services.llm_store import LLM_VERSION_KEY, load_effective, publish_version, report_loaded

log = get_logger(__name__)
POLL_SECONDS = 30.0


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
        from app.services.llm_config import load_llm_config
        return load_llm_config(settings.llm_config_path, settings.llm_preset), "file", str(exc)


async def refresh_llms(ctx: dict, *, build_graph_fn=build_graph) -> bool:
    """Rebuild the models when the active version changed. True when this call switched to a new version."""
    redis = ctx["events_redis"]
    try:
        wanted = await redis.get(LLM_VERSION_KEY)
    except Exception:  # noqa: BLE001 - keep the current models while Redis is unreachable
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
            if settings.graph_mode == "stub":
                deps, graph = ctx["graph_deps"], ctx["graph"]
            else:
                llms = build_llms(settings, ctx.get("catalog"), resolved=resolved, sem=ctx["llm_sem"],
                                  config_version=effective.label)
                deps = dataclasses.replace(ctx["graph_deps"], llms=llms)
                graph = build_graph_fn(deps, checkpointer=getattr(ctx["graph"], "checkpointer", None))
        except Exception as exc:  # noqa: BLE001 - keep serving with the models already loaded
            log.error("llm_reload_failed", wanted=wanted, error=str(exc))
            await report_loaded(redis, worker_id(), ctx.get("llm_version") or "file",
                                getattr(getattr(ctx["graph_deps"], "llms", None), "preset", "") or "", error=str(exc))
            return False
        ctx["graph_deps"], ctx["graph"], ctx["llm_version"] = deps, graph, effective.active_id
        await report_loaded(redis, worker_id(), effective.active_id, resolved.preset)
        log.info("llm_reloaded", version=effective.active_id, preset=resolved.preset)
        return True


async def poll_llm_config(ctx: dict, interval: float = POLL_SECONDS) -> None:
    """Background check so an idle worker also picks up (and reports) a new version."""
    while True:
        try:
            await refresh_llms(ctx)
        except Exception as exc:  # noqa: BLE001 - the poller must never die
            log.error("llm_poll_failed", error=str(exc))
        await asyncio.sleep(interval)
