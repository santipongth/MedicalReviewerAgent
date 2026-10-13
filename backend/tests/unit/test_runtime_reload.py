import asyncio
import contextlib
import json
from dataclasses import dataclass

import pytest
from sqlalchemy import delete, update

from app.config import Settings
from app.db.models import ConfigVersion
from app.graph.graph import GraphDeps
from app.harness.glossary import SEED_GLOSSARY, ActiveGlossary
from app.services import llm_store
from app.services.admin_auth import AdminPrincipal
from app.services.config_store import newest, publish, save_version
from app.services.glossary_store import GLOSSARY_KIND
from app.services.llm_config import load_llm_config
from app.services.llm_store import LOADED_KEY, loaded_workers, publish_version, report_loaded
from app.services.runtime_settings import SETTINGS_KIND
from app.worker import llm_reload, runtime_reload, tasks
from app.worker.llm_reload import worker_id
from app.worker.runtime_reload import init_runtime, poll_runtime, refresh_runtime
from tests.llm_helpers import MINIMAL, write_yaml

OWNER = AdminPrincipal(kind="user", id=None, label="owner")


@pytest.fixture(autouse=True)
def offline_catalog(monkeypatch):
    """The poller also runs 23b's refresh_llms, which may ask the live catalog: no test may reach the network."""
    async def offline():
        raise OSError("offline")

    monkeypatch.setattr(llm_reload, "load_live_catalog", offline)


@dataclass
class FakeGraph:
    deps: GraphDeps
    checkpointer: object = None


def build_graph_fn(deps, checkpointer=None):
    return FakeGraph(deps, checkpointer)


class FakeLLMs:
    config_version = "file"
    preset = "cheap"


async def make_ctx(tmp_path, session_factory, redis, mode="real"):
    base = Settings(_env_file=None, openrouter_api_key="sk-or-x", llm_concurrency=4, graph_mode=mode,
                    llm_config_path=str(write_yaml(tmp_path / "llm.yaml", MINIMAL)))
    ctx = {"settings": base, "session_factory": session_factory, "events_redis": redis,
           "llm_lock": asyncio.Lock(), "catalog": None, "llm_version": "file"}
    await init_runtime(ctx)
    deps = GraphDeps(settings=ctx["settings"], llms=None if mode == "stub" else FakeLLMs(), glossary=ctx["glossary"])
    ctx.update(graph_deps=deps, graph=FakeGraph(deps, checkpointer="CP"), llm_sem=asyncio.Semaphore(4),
               llm_sem_size=4, llm_resolved=load_llm_config(base.llm_config_path))
    return ctx


async def save(session_factory, kind, raw):
    async with session_factory() as s, s.begin():
        current = await newest(s, kind)
        return await save_version(s, OWNER, kind, raw, settings=Settings(_env_file=None),
                                  base_version=current.version if current else None)


async def save_and_publish(session_factory, redis, kind, raw):
    row = await save(session_factory, kind, raw)
    await publish(redis, kind, row)
    return row


async def test_startup_without_versions_uses_env_and_the_seed(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    assert (ctx["settings_version"], ctx["glossary_version"], ctx["runtime_error"]) == ("env", "file", None)
    assert ctx["settings"] is ctx["base_settings"] and ctx["glossary"] is SEED_GLOSSARY
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is False  # nothing published
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn, poll=True) is False  # nothing saved


async def test_a_saved_version_is_loaded_at_startup(tmp_path, session_factory, redis):
    await save_and_publish(session_factory, redis, SETTINGS_KIND, {"values": {"max_cost_per_review_usd": 0.3}})
    ctx = await make_ctx(tmp_path, session_factory, redis)
    assert ctx["settings_version"] == "1" and ctx["settings"].max_cost_per_review_usd == 0.3


async def test_a_change_rebuilds_deps_and_graph_and_a_running_graph_keeps_its_own(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    old_graph, old_llms = ctx["graph"], ctx["graph_deps"].llms
    await save_and_publish(session_factory, redis, SETTINGS_KIND, {"values": {"max_cost_per_review_usd": 0.3}})
    await save_and_publish(session_factory, redis, GLOSSARY_KIND, {"terms": [{"en": "placebo", "th": "ยาหลอก"}]})
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is True
    assert ctx["settings"].max_cost_per_review_usd == 0.3 and ctx["graph_deps"].settings is ctx["settings"]
    assert ctx["graph_deps"].glossary == ActiveGlossary(1, "placebo = ยาหลอก")
    assert ctx["graph"] is not old_graph and ctx["graph"].checkpointer == "CP"
    assert ctx["graph_deps"].llms is old_llms  # same concurrency: same LLMs
    assert old_graph.deps.glossary is SEED_GLOSSARY  # the running review's graph is untouched
    assert (ctx["settings_version"], ctx["glossary_version"]) == ("1", "1")
    report = json.loads(await redis.hget(LOADED_KEY, worker_id()))
    assert (report["settings"], report["glossary"], report["runtime_error"]) == ("1", "1", None)
    assert report["version"] == "file"  # 23b's own fields are untouched
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is False


async def test_a_concurrency_change_gives_new_reviews_a_new_semaphore(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    old_sem, old_graph = ctx["llm_sem"], ctx["graph"]
    await save_and_publish(session_factory, redis, SETTINGS_KIND, {"values": {"llm_concurrency": 9}})
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is True
    assert ctx["llm_sem"] is not old_sem and ctx["llm_sem_size"] == 9
    llms = ctx["graph_deps"].llms
    assert llms.synthesizer.sem is ctx["llm_sem"] and llms.config_version == "file"
    assert old_graph.deps.llms.__class__ is FakeLLMs  # reviews already running keep the old LLMs and semaphore


async def test_stub_mode_rebuilds_the_graph_and_has_no_models_to_rebuild(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis, mode="stub")
    await save_and_publish(session_factory, redis, SETTINGS_KIND, {"values": {"llm_concurrency": 9}})
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is True
    assert ctx["graph_deps"].llms is None and ctx["settings_version"] == "1" and ctx["llm_sem_size"] == 9


async def test_a_failed_reload_keeps_the_old_state_and_reports_it(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    before = (ctx["settings"], ctx["graph"], ctx["graph_deps"])
    await save_and_publish(session_factory, redis, SETTINGS_KIND, {"values": {"sse_max_per_ip": 3}})

    def boom(deps, checkpointer=None):
        raise RuntimeError("graph build failed")

    assert await refresh_runtime(ctx, build_graph_fn=boom) is False
    assert (ctx["settings"], ctx["graph"], ctx["graph_deps"]) == before and ctx["settings_version"] == "env"
    assert "graph build failed" in json.loads(await redis.hget(LOADED_KEY, worker_id()))["runtime_error"]
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is True and ctx["runtime_error"] is None


async def test_a_poll_picks_up_a_version_whose_publish_was_lost_and_repairs_the_mirror(tmp_path, session_factory,
                                                                                      redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    await save(session_factory, SETTINGS_KIND, {"values": {"sse_max_per_ip": 3}})  # saved, never published
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is False  # a job start trusts Redis
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn, poll=True) is True
    assert ctx["settings"].sse_max_per_ip == 3
    assert json.loads(await redis.get(SETTINGS_KIND.redis_key)) == {"version": 1, "values": {"sse_max_per_ip": 3}}
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn, poll=True) is False


async def test_a_poll_follows_an_emptied_table_back_to_env(tmp_path, session_factory, redis):
    await save_and_publish(session_factory, redis, SETTINGS_KIND, {"values": {"sse_max_per_ip": 3}})
    ctx = await make_ctx(tmp_path, session_factory, redis)
    async with session_factory() as s, s.begin():  # a database restored from an older backup
        await s.execute(delete(ConfigVersion))
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn, poll=True) is True
    assert ctx["settings_version"] == "env" and ctx["settings"] is ctx["base_settings"]
    assert await redis.get(SETTINGS_KIND.redis_key) is None


async def test_a_poll_clears_a_stale_error_and_keeps_one_that_still_applies(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    ctx["runtime_error"] = "the DB was down at startup"
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn, poll=True) is False
    assert ctx["runtime_error"] is None  # the worker runs env and the seed, which is what the DB says
    await save(session_factory, SETTINGS_KIND, {"values": {"sse_max_per_ip": 3}})

    def boom(deps, checkpointer=None):
        raise RuntimeError("graph build failed")

    assert await refresh_runtime(ctx, build_graph_fn=boom, poll=True) is False
    assert "graph build failed" in ctx["runtime_error"]  # version 1 is still not running


async def test_redis_or_the_db_down_keeps_the_current_state(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)

    class Down:
        async def mget(self, *_):
            raise ConnectionError("down")

        async def get(self, *_):
            raise ConnectionError("down")

    ctx["events_redis"] = Down()
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is False
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn, poll=True) is False


async def test_run_review_refreshes_settings_and_glossary_before_the_models(monkeypatch):
    calls = []

    async def fake_runtime(ctx):
        calls.append("runtime")
        return False

    async def fake_llms(ctx):
        calls.append("llms")
        return False

    class Runner:
        async def run(self, review_id):
            return "done"

    monkeypatch.setattr(tasks, "refresh_runtime", fake_runtime)
    monkeypatch.setattr(tasks, "refresh_llms", fake_llms)
    monkeypatch.setattr(tasks, "_runner", lambda c: Runner())
    await tasks.run_review({"llm_lock": asyncio.Lock()}, "00000000-0000-0000-0000-000000000001")
    assert calls == ["runtime", "llms"]


async def test_the_poller_reads_the_db_and_picks_up_a_version_without_a_publish(tmp_path, session_factory, redis,
                                                                               monkeypatch):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    monkeypatch.setattr(runtime_reload, "build_graph", build_graph_fn)
    poller = asyncio.create_task(poll_runtime(ctx, interval=0.01))
    try:
        await save(session_factory, SETTINGS_KIND, {"values": {"sse_max_per_ip": 3}})
        report = {}
        for _ in range(300):
            await asyncio.sleep(0.01)
            report = json.loads(await redis.hget(LOADED_KEY, worker_id()) or "{}")
            if report.get("settings") == "1":
                break
    finally:
        poller.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await poller
    assert ctx["settings_version"] == "1" and ctx["settings"].sse_max_per_ip == 3
    assert (report["settings"], report["version"]) == ("1", "file")


# --- Task 5 additions: stored rows nobody should have written, and the 23b fields the reload now carries ---

CORRUPT_ROWS = [
    pytest.param(SETTINGS_KIND, ["not", "a", "mapping"], id="settings-document-is-a-list"),
    pytest.param(SETTINGS_KIND, {"values": "not-a-mapping"}, id="settings-values-is-a-string"),
    pytest.param(GLOSSARY_KIND, {"nope": 1}, id="glossary-document-has-no-terms"),
    pytest.param(GLOSSARY_KIND, ["not", "a", "mapping"], id="glossary-document-is-a-list"),
]


async def insert_raw(session_factory, kind, version, document):
    """A row as a hand edit could leave it: save_version would have refused this document."""
    async with session_factory() as s, s.begin():
        s.add(ConfigVersion(kind=kind.name, version=version, created_by="hand", source="edit", document=document,
                            changes={}))


def state_of(ctx):
    return (ctx["settings"], ctx["glossary"], ctx["graph"], ctx["graph_deps"], ctx["llm_sem"],
            ctx["settings_version"], ctx["glossary_version"])


@pytest.mark.parametrize(("kind", "document"), [c for c in CORRUPT_ROWS if c.id != "settings-values-is-a-string"])
async def test_startup_falls_back_to_env_and_the_seed_on_a_row_it_cannot_read(tmp_path, session_factory, redis, kind,
                                                                            document):
    await insert_raw(session_factory, kind, 1, document)
    ctx = await make_ctx(tmp_path, session_factory, redis)  # does not raise: the worker still starts
    assert (ctx["settings_version"], ctx["glossary_version"]) == ("env", "file")
    assert ctx["settings"] is ctx["base_settings"] and ctx["glossary"] is SEED_GLOSSARY
    assert ctx["runtime_error"]


async def test_startup_runs_env_values_for_settings_whose_values_are_not_a_mapping(tmp_path, session_factory, redis):
    await insert_raw(session_factory, SETTINGS_KIND, 1, {"values": "not-a-mapping"})
    ctx = await make_ctx(tmp_path, session_factory, redis)
    assert ctx["settings"] == ctx["base_settings"]  # apply_overrides skips what is not a mapping


@pytest.mark.parametrize(("kind", "document"), CORRUPT_ROWS)
async def test_a_poll_over_a_row_it_cannot_read_keeps_everything_and_reports_it(tmp_path, session_factory, redis,
                                                                              kind, document):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    before = state_of(ctx)
    await insert_raw(session_factory, kind, 1, document)
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn, poll=True) is False
    assert state_of(ctx) == before and ctx["runtime_error"]
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn, poll=True) is False  # and again, no crash


async def test_the_poller_survives_a_row_it_cannot_read_and_reports_the_error(tmp_path, session_factory, redis,
                                                                            monkeypatch):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    await insert_raw(session_factory, SETTINGS_KIND, 1, ["not", "a", "mapping"])
    monkeypatch.setattr(runtime_reload, "build_graph", build_graph_fn)
    poller = asyncio.create_task(poll_runtime(ctx, interval=0.01))
    try:
        report = {}
        for _ in range(300):
            await asyncio.sleep(0.01)
            report = json.loads(await redis.hget(LOADED_KEY, worker_id()) or "{}")
            if report.get("runtime_error"):
                break
        await asyncio.sleep(0.05)  # a few more passes over the same row
        assert not poller.done()
    finally:
        poller.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await poller
    assert report["runtime_error"] and (report["settings"], report["version"]) == ("env", "file")


async def test_a_job_start_over_a_row_it_cannot_read_keeps_the_state_and_the_next_poll_retries(tmp_path,
                                                                                              session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    before = state_of(ctx)
    good = {"values": {"sse_max_per_ip": 3}}
    await save_and_publish(session_factory, redis, SETTINGS_KIND, good)

    async def set_document(document):
        async with session_factory() as s, s.begin():
            await s.execute(update(ConfigVersion).where(ConfigVersion.kind == "settings").values(document=document))

    await set_document(["hand", "edited"])  # the mirror (version 1) is fine, the row behind it is not
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is False
    assert state_of(ctx) == before and ctx["runtime_error"]
    assert json.loads(await redis.hget(LOADED_KEY, worker_id()))["runtime_error"] == ctx["runtime_error"]
    await set_document(good)
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn, poll=True) is True
    assert ctx["settings"].sse_max_per_ip == 3 and ctx["runtime_error"] is None


async def test_extra_report_fields_never_override_the_llm_fields(redis):
    await report_loaded(redis, "w1", "3", "cheap", None, extra={"version": "x", "preset": "y", "settings": "2"})
    [report] = await loaded_workers(redis)
    assert (report["version"], report["preset"], report["settings"]) == ("3", "cheap", "2")


async def test_startup_sizes_the_semaphore_from_the_settings_in_force_and_wires_the_glossary(tmp_path, session_factory,
                                                                                           redis):
    await save_and_publish(session_factory, redis, SETTINGS_KIND, {"values": {"llm_concurrency": 9}})
    await save_and_publish(session_factory, redis, GLOSSARY_KIND, {"terms": [{"en": "placebo", "th": "ยาหลอก"}]})
    base = Settings(_env_file=None, openrouter_api_key="sk-or-x", llm_concurrency=4,
                    llm_config_path=str(write_yaml(tmp_path / "llm.yaml", MINIMAL)))
    ctx = {"settings": base, "session_factory": session_factory, "events_redis": redis, "http": object()}
    await init_runtime(ctx)
    await llm_reload.init_llms(ctx, None, "CP", build_graph_fn=build_graph_fn)
    assert ctx["llm_sem_size"] == 9 and ctx["llm_sem"]._value == 9
    assert ctx["graph_deps"].settings.llm_concurrency == 9
    assert ctx["graph_deps"].glossary == ActiveGlossary(1, "placebo = ยาหลอก")
    assert ctx["llm_resolved"].preset == "cheap" and ctx["graph_deps"].llms.synthesizer.sem is ctx["llm_sem"]
    [report] = await loaded_workers(redis)
    assert (report["settings"], report["glossary"], report["runtime_error"]) == ("1", "1", None)


async def test_a_concurrency_change_rebuilds_the_models_of_the_version_in_use(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    async with session_factory() as s, s.begin():  # an LLM version that switches the preset
        row = await llm_store.save_version(s, OWNER, {**MINIMAL, "active_preset": "better"},
                                           settings=ctx["settings"], base_version=None)
    await publish_version(redis, row.id)
    assert await llm_reload.refresh_llms(ctx, build_graph_fn=build_graph_fn) is True
    assert ctx["llm_resolved"].preset == "better"  # refresh_llms keeps the resolved config for the next rebuild
    await save_and_publish(session_factory, redis, SETTINGS_KIND, {"values": {"llm_concurrency": 9}})
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is True
    llms = ctx["graph_deps"].llms
    assert llms.preset == "better" and llms.config_version == f"db:{row.id}" and llms.synthesizer.sem is ctx["llm_sem"]
