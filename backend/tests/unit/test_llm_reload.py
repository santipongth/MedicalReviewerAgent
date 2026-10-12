import asyncio
import contextlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import partial

import pytest

from app.config import Settings
from app.graph.graph import GraphDeps
from app.services.admin_auth import AdminPrincipal
from app.services.llm_store import (
    LLM_VERSION_KEY,
    LOADED_KEY,
    loaded_workers,
    publish_version,
    report_loaded,
    save_version,
)
from app.services.model_catalog import ModelInfo, cached_catalog
from app.worker import llm_reload, tasks
from app.worker.llm_reload import (
    init_llms,
    initial_llm_config,
    poll_llm_config,
    refresh_llms,
    report_state,
    stop_llms,
    worker_id,
)
from tests.llm_helpers import MINIMAL, with_model, write_yaml

OWNER = AdminPrincipal(kind="user", id=None, label="owner")
WORKER_CATALOG_LOADER = llm_reload.load_live_catalog  # captured before the autouse fixture replaces it


@pytest.fixture(autouse=True)
def offline_catalog(monkeypatch):
    """A reload asks the shared catalog cache and then the live loader: no test may reach the network."""
    async def offline():
        raise OSError("offline")

    monkeypatch.setattr(llm_reload, "load_live_catalog", offline)


@dataclass
class FakeGraph:
    deps: GraphDeps
    checkpointer: object = None


def build_graph_fn(deps, checkpointer=None):
    return FakeGraph(deps, checkpointer)


async def make_ctx(tmp_path, session_factory, redis, mode="real"):
    settings = Settings(_env_file=None, openrouter_api_key="sk-or-x", graph_mode=mode,
                        llm_config_path=str(write_yaml(tmp_path / "llm.yaml", MINIMAL)))
    sem = asyncio.Semaphore(4)
    deps = GraphDeps(settings=settings, llms=object())
    return {"settings": settings, "session_factory": session_factory, "events_redis": redis,
            "graph_deps": deps, "graph": FakeGraph(deps, checkpointer="CP"), "llm_version": "file",
            "llm_sem": sem, "llm_lock": asyncio.Lock(), "catalog": None}


async def save(session_factory, settings, raw, base):
    async with session_factory() as s, s.begin():
        row = await save_version(s, OWNER, raw, settings=settings, base_version=base)
    return row.id


async def test_initial_config_comes_from_the_db_when_present(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    resolved, active, error = await initial_llm_config(session_factory, ctx["settings"])
    assert (resolved.preset, active, error) == ("cheap", "file", None)
    vid = await save(session_factory, ctx["settings"], {**MINIMAL, "active_preset": "better"}, None)
    resolved, active, _ = await initial_llm_config(session_factory, ctx["settings"])
    assert (resolved.preset, active) == ("better", str(vid))


async def test_no_change_means_no_rebuild(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    graph = ctx["graph"]
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is False
    assert ctx["graph"] is graph


async def test_a_new_version_rebuilds_with_the_same_semaphore_and_checkpointer(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    old_graph = ctx["graph"]
    vid = await save(session_factory, ctx["settings"], with_model(MINIMAL, "cheap", "synthesizer", "vendor/big"), None)
    await publish_version(redis, vid)
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is True
    llms = ctx["graph_deps"].llms
    assert llms.models["synthesizer"] == "openrouter:vendor/big" and llms.config_version == f"db:{vid}"
    assert llms.synthesizer.sem is ctx["llm_sem"]
    assert ctx["graph"] is not old_graph and ctx["graph"].checkpointer == "CP" and ctx["llm_version"] == str(vid)
    assert old_graph.deps.llms is not llms  # a runner already holding the old graph keeps the old models
    [report] = await loaded_workers(redis)
    assert report["worker"] == worker_id() and report["version"] == str(vid) and report["error"] is None


async def test_a_config_that_fails_to_build_keeps_the_old_models_and_reports(tmp_path, session_factory, redis,
                                                                            monkeypatch):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    old_graph = ctx["graph"]
    vid = await save(session_factory, ctx["settings"], MINIMAL, None)
    await publish_version(redis, vid)

    def broken(*_a, **_k):
        raise RuntimeError("cannot build")

    monkeypatch.setattr("app.worker.llm_reload.build_llms", broken)
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is False
    assert ctx["graph"] is old_graph and ctx["llm_version"] == "file"
    [report] = await loaded_workers(redis)
    assert report["version"] == "file" and "cannot build" in report["error"]
    monkeypatch.undo()
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is True  # the next poll retries


async def test_stub_mode_records_the_version_without_building(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis, mode="stub")
    graph = ctx["graph"]
    vid = await save(session_factory, ctx["settings"], MINIMAL, None)
    await publish_version(redis, vid)
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is True
    assert ctx["graph"] is graph and ctx["llm_version"] == str(vid)
    assert (await loaded_workers(redis))[0]["version"] == str(vid)


async def test_a_missing_redis_key_is_no_change(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    await redis.delete(LLM_VERSION_KEY)
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is False
    assert await redis.hgetall(LOADED_KEY) == {}


async def test_a_stale_redis_id_is_republished_from_the_db_and_not_rebuilt_again(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    first = await save(session_factory, ctx["settings"], MINIMAL, None)
    second = await save(session_factory, ctx["settings"], with_model(MINIMAL, "cheap", "synthesizer", "vendor/big"),
                        first)
    await redis.set(LLM_VERSION_KEY, str(first))  # a publish that was lost or arrived out of order
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is True
    assert ctx["llm_version"] == str(second) and ctx["graph_deps"].llms.config_version == f"db:{second}"
    assert await redis.get(LLM_VERSION_KEY) == str(second)
    graph = ctx["graph"]
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is False
    assert ctx["graph"] is graph


async def test_a_redis_id_ahead_of_the_db_does_not_rebuild_on_every_poll(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    vid = await save(session_factory, ctx["settings"], MINIMAL, None)
    ctx["llm_version"] = str(vid)
    graph = ctx["graph"]
    await redis.set(LLM_VERSION_KEY, str(vid + 98))
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is False
    assert ctx["graph"] is graph and await redis.get(LLM_VERSION_KEY) == str(vid + 98)


async def test_run_review_refreshes_before_it_builds_the_runner(tmp_path, session_factory, redis, monkeypatch):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    old_graph = ctx["graph"]
    vid = await save(session_factory, ctx["settings"], MINIMAL, None)
    await publish_version(redis, vid)
    monkeypatch.setattr(tasks, "refresh_llms", partial(refresh_llms, build_graph_fn=build_graph_fn))
    seen = {}

    class Runner:
        async def run(self, review_id):
            return "done"

    def fake_runner(c):
        seen["graph"] = c["graph"]
        return Runner()

    monkeypatch.setattr(tasks, "_runner", fake_runner)
    result = await tasks.run_review(ctx, "00000000-0000-0000-0000-000000000001")
    assert result["status"] == "done" and seen["graph"] is not old_graph and ctx["llm_version"] == str(vid)


async def test_a_poll_without_a_version_change_still_refreshes_loaded_at(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    old = {"version": "file", "preset": "cheap", "error": None,
           "loaded_at": (datetime.now(UTC) - timedelta(hours=20)).isoformat()}
    await redis.hset(LOADED_KEY, worker_id(), json.dumps(old))
    graph = ctx["graph"]
    poller = asyncio.create_task(poll_llm_config(ctx, interval=0.01))
    try:
        report = old
        for _ in range(300):
            await asyncio.sleep(0.01)
            [report] = await loaded_workers(redis)
            if report["loaded_at"] != old["loaded_at"]:
                break
    finally:
        poller.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await poller
    assert report["loaded_at"] > old["loaded_at"] and report["version"] == "file" and ctx["graph"] is graph


async def test_a_heartbeat_keeps_a_failure_report_until_a_reload_succeeds(tmp_path, session_factory, redis,
                                                                         monkeypatch):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    vid = await save(session_factory, ctx["settings"], MINIMAL, None)
    await publish_version(redis, vid)

    def broken(*_a, **_k):
        raise RuntimeError("cannot build")

    monkeypatch.setattr("app.worker.llm_reload.build_llms", broken)
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is False
    assert "cannot build" in ctx["llm_error"]
    await redis.delete(LOADED_KEY)
    await report_state(ctx)  # what the poller does on every pass
    [report] = await loaded_workers(redis)
    assert report["version"] == "file" and "cannot build" in report["error"]
    monkeypatch.undo()
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is True
    assert ctx["llm_error"] is None
    await report_state(ctx)
    [report] = await loaded_workers(redis)
    assert report["version"] == str(vid) and report["error"] is None


async def test_stop_llms_ends_the_poller_and_removes_only_this_worker(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    await report_loaded(redis, worker_id(), "file", "cheap")
    await report_loaded(redis, "other-host:1", "file", "cheap")
    poller = ctx["llm_poller"] = asyncio.create_task(poll_llm_config(ctx, interval=0.01))
    await asyncio.sleep(0.05)
    await stop_llms(ctx)
    assert poller.done()
    assert [r["worker"] for r in await loaded_workers(redis)] == ["other-host:1"]


async def test_stop_llms_never_raises(tmp_path, session_factory, redis):
    class DownRedis:
        async def hdel(self, *_a):
            raise ConnectionError("redis is down")

    ctx = await make_ctx(tmp_path, session_factory, redis)
    ctx["events_redis"] = DownRedis()
    await stop_llms(ctx)  # no poller and Redis down
    ctx["llm_poller"] = asyncio.create_task(asyncio.sleep(0))
    await asyncio.sleep(0.01)
    await stop_llms(ctx)  # a poller that already finished


async def startup_ctx(tmp_path, session_factory, redis):
    base = await make_ctx(tmp_path, session_factory, redis)
    return {k: base[k] for k in ("settings", "session_factory", "events_redis")} | {"http": object()}


async def test_startup_builds_the_saved_version_and_reports_it(tmp_path, session_factory, redis):
    ctx = await startup_ctx(tmp_path, session_factory, redis)
    vid = await save(session_factory, ctx["settings"], {**MINIMAL, "active_preset": "better"}, None)
    await init_llms(ctx, None, "CP", build_graph_fn=build_graph_fn)
    llms = ctx["graph_deps"].llms
    assert llms.preset == "better" and llms.config_version == f"db:{vid}" and llms.synthesizer.sem is ctx["llm_sem"]
    assert ctx["graph"].checkpointer == "CP" and ctx["llm_version"] == str(vid) and ctx["llm_error"] is None
    [report] = await loaded_workers(redis)
    assert (report["version"], report["preset"], report["error"]) == (str(vid), "better", None)


async def test_startup_falls_back_to_the_file_when_the_saved_version_cannot_be_built(tmp_path, session_factory,
                                                                                    redis, monkeypatch):
    ctx = await startup_ctx(tmp_path, session_factory, redis)
    await save(session_factory, ctx["settings"], {**MINIMAL, "active_preset": "better"}, None)
    real = llm_reload.build_graph_deps

    def flaky(*args, **kwargs):
        if kwargs.get("config_version") != "file":
            raise RuntimeError("cannot build")
        return real(*args, **kwargs)

    monkeypatch.setattr(llm_reload, "build_graph_deps", flaky)
    await init_llms(ctx, None, "CP", build_graph_fn=build_graph_fn)
    assert ctx["llm_version"] == "file" and "cannot build" in ctx["llm_error"]
    assert ctx["graph_deps"].llms.config_version == "file" and ctx["graph_deps"].llms.preset == "cheap"
    assert ctx["graph"].checkpointer == "CP"
    [report] = await loaded_workers(redis)
    assert report["version"] == "file" and "cannot build" in report["error"]


async def test_startup_does_not_hide_a_broken_file(tmp_path, session_factory, redis, monkeypatch):
    ctx = await startup_ctx(tmp_path, session_factory, redis)

    def broken(*_a, **_k):
        raise RuntimeError("file cannot build")

    monkeypatch.setattr(llm_reload, "build_graph_deps", broken)
    with pytest.raises(RuntimeError, match="file cannot build"):  # no usable configuration: the worker must not start
        await init_llms(ctx, None, "CP", build_graph_fn=build_graph_fn)


async def test_a_poll_republishes_a_version_whose_publish_was_lost_and_reloads(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    first = await save(session_factory, ctx["settings"], MINIMAL, None)
    await publish_version(redis, first)
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is True
    second = await save(session_factory, ctx["settings"], with_model(MINIMAL, "cheap", "synthesizer", "vendor/big"),
                        first)  # saved and committed, but its publish never reached Redis
    assert await redis.get(LLM_VERSION_KEY) == str(first)
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is False  # job start trusts Redis
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn, poll=True) is True
    assert ctx["llm_version"] == str(second) and await redis.get(LLM_VERSION_KEY) == str(second)
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn, poll=True) is False


async def test_a_poll_publishes_the_db_version_when_redis_lost_it_after_a_startup_fallback(tmp_path, session_factory,
                                                                                          redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    vid = await save(session_factory, ctx["settings"], MINIMAL, None)
    await redis.delete(LLM_VERSION_KEY)
    ctx["llm_error"] = "cannot build"  # the worker started on llm.yaml because the saved version failed
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is False  # job start: nothing to compare with
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn, poll=True) is True
    assert ctx["llm_version"] == str(vid) and ctx["llm_error"] is None
    assert await redis.get(LLM_VERSION_KEY) == str(vid)


async def test_a_poll_pulls_a_redis_id_above_the_db_max_back_to_the_db(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    vid = await save(session_factory, ctx["settings"], MINIMAL, None)
    ctx["llm_version"] = str(vid)
    graph = ctx["graph"]
    await redis.set(LLM_VERSION_KEY, str(vid + 98))  # a DB restored from a backup, or a migration down and up
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn, poll=True) is False
    assert await redis.get(LLM_VERSION_KEY) == str(vid) and ctx["graph"] is graph


async def test_a_poll_deletes_a_redis_id_while_the_table_is_empty(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    await redis.set(LLM_VERSION_KEY, "7")
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn, poll=True) is False
    assert await redis.get(LLM_VERSION_KEY) is None and ctx["llm_version"] == "file"


async def test_a_stale_load_error_is_cleared_once_the_worker_runs_the_dbs_active_id(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    ctx["llm_error"] = "connection refused"  # a startup fallback to llm.yaml; the table is empty
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn, poll=True) is False
    assert ctx["llm_error"] is None
    vid = await save(session_factory, ctx["settings"], MINIMAL, None)
    await publish_version(redis, vid)
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn, poll=True) is True
    ctx["llm_error"] = "an old failure"
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn, poll=True) is False
    assert ctx["llm_error"] is None


async def test_a_load_error_stays_while_the_dbs_active_id_is_not_running(tmp_path, session_factory, redis, monkeypatch):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    await save(session_factory, ctx["settings"], MINIMAL, None)
    ctx["llm_error"] = "cannot build"

    def broken(*_a, **_k):
        raise RuntimeError("still cannot build")

    monkeypatch.setattr("app.worker.llm_reload.build_llms", broken)
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn, poll=True) is False
    assert "still cannot build" in ctx["llm_error"] and ctx["llm_version"] == "file"


async def test_the_poller_reconciles_redis_with_the_db(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    ctx["graph"] = FakeGraph(ctx["graph_deps"], checkpointer=None)  # the poller compiles the real graph
    vid = await save(session_factory, ctx["settings"], MINIMAL, None)  # no publish at all
    poller = asyncio.create_task(poll_llm_config(ctx, interval=0.01))
    try:
        for _ in range(300):
            await asyncio.sleep(0.01)
            if ctx["llm_version"] == str(vid):
                break
    finally:
        poller.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await poller
    assert ctx["llm_version"] == str(vid) and await redis.get(LLM_VERSION_KEY) == str(vid)


async def test_a_reload_builds_with_the_catalog_the_api_sees_not_the_one_from_startup(tmp_path, session_factory,
                                                                                     redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    ctx["catalog"] = {}  # fetched when the worker started: vendor/big did not exist yet
    big = ModelInfo("vendor/big", 100_000, 1e-6, 2e-6, frozenset({"tools"}))  # no structured_outputs, no reasoning

    async def fetched():
        return {"vendor/big": big}

    await cached_catalog(redis, fetched)  # what the API's test call or validate cached
    raw = with_model(MINIMAL, "cheap", "synthesizer", "vendor/big")
    raw["presets"]["cheap"]["synthesizer"]["reasoning_effort"] = "none"
    vid = await save(session_factory, ctx["settings"], raw, None)
    await publish_version(redis, vid)
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is True
    synth = ctx["graph_deps"].llms.synthesizer
    assert synth.method == "tool_calling" and synth.reasoning_effort is None  # as for a known model
    assert synth.inner.price == big and ctx["catalog"] == {"vendor/big": big}


async def test_a_cold_cache_is_filled_by_the_worker_and_an_offline_catalog_keeps_the_startup_one(
        tmp_path, session_factory, redis, monkeypatch):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    startup = {"vendor/cheap": ModelInfo("vendor/cheap", 1000, 1e-7, 1e-7, frozenset())}
    ctx["catalog"] = startup
    vid = await save(session_factory, ctx["settings"], MINIMAL, None)
    await publish_version(redis, vid)
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is True  # offline loader, empty cache
    assert ctx["catalog"] is startup and ctx["graph_deps"].llms.synthesizer.inner.price == startup["vendor/cheap"]
    loaded = []

    async def live():
        loaded.append(1)
        return {"vendor/better": ModelInfo("vendor/better", 1000, 1e-7, 1e-7, frozenset())}

    monkeypatch.setattr(llm_reload, "load_live_catalog", live)
    vid2 = await save(session_factory, ctx["settings"], {**MINIMAL, "active_preset": "better"}, vid)
    await publish_version(redis, vid2)
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is True
    assert loaded == [1] and set(ctx["catalog"]) == {"vendor/better"}
    assert await cached_catalog(redis, live) == ctx["catalog"] and loaded == [1]  # now cached for the other workers


async def test_stub_mode_never_touches_the_catalog(tmp_path, session_factory, redis, monkeypatch):
    ctx = await make_ctx(tmp_path, session_factory, redis, mode="stub")

    async def live():
        raise AssertionError("stub mode must not fetch the catalog")

    monkeypatch.setattr(llm_reload, "load_live_catalog", live)
    vid = await save(session_factory, ctx["settings"], MINIMAL, None)
    await publish_version(redis, vid)
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is True


async def test_a_poll_follows_an_emptied_table_back_to_the_file(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    ctx["llm_version"] = "5"  # the DB was restored to a state without any saved version
    await redis.set(LLM_VERSION_KEY, "5")
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn, poll=True) is True
    assert ctx["llm_version"] == "file" and await redis.get(LLM_VERSION_KEY) is None


async def test_a_poll_with_the_db_unreachable_changes_nothing_and_does_not_raise(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)

    def broken():
        raise ConnectionError("db is down")

    ctx["session_factory"] = broken
    graph = ctx["graph"]
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn, poll=True) is False
    assert ctx["graph"] is graph


async def test_the_worker_fetches_a_cold_catalog_once_with_a_short_timeout(monkeypatch):
    """The fetch runs inside the reload lock that job starts wait on, so it never takes the shared client's retries."""
    calls = []

    async def live(**kwargs):
        calls.append(kwargs)
        return {}

    monkeypatch.setattr("app.services.model_catalog.load_live_catalog", live)
    await WORKER_CATALOG_LOADER()
    assert calls == [{"timeout": llm_reload.RELOAD_CATALOG_TIMEOUT_SECONDS, "retries": 0}]
