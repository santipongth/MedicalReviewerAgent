import asyncio
from dataclasses import dataclass
from functools import partial

from app.config import Settings
from app.graph.graph import GraphDeps
from app.services.admin_auth import AdminPrincipal
from app.services.llm_store import (
    LLM_VERSION_KEY,
    LOADED_KEY,
    loaded_workers,
    publish_version,
    save_version,
)
from app.worker import tasks
from app.worker.llm_reload import initial_llm_config, refresh_llms, worker_id
from tests.llm_helpers import MINIMAL, with_model, write_yaml

OWNER = AdminPrincipal(kind="user", id=None, label="owner")


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
