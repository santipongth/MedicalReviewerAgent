import asyncio
import contextlib
import json
from datetime import UTC, datetime
from pathlib import Path

import pytest
import yaml

from app.config import Settings
from app.db.models import HarnessRun
from app.evals import models
from app.evals.batch import BatchSummary
from app.graph.graph import GraphDeps
from app.services.admin_auth import AdminPrincipal
from app.services.config_store import save_version
from app.services.glossary_store import GLOSSARY_KIND
from app.services.harness_runs import WORKER_KEY
from app.services.http import HttpClient
from app.worker import harness as harness_worker
from app.worker import llm_reload
from app.worker.harness import HarnessWorkerSettings, build_eval_deps, heartbeat, run_harness
from tests.harness_helpers import make_eval_root, write_run
from tests.llm_helpers import MINIMAL, write_yaml

S = Settings(_env_file=None)
ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    make_eval_root(tmp_path)
    return tmp_path


async def add_run(session_factory, **kw):
    fields = {"run_id": "console-1", "prompt_version": S.prompt_version, "status": "queued", "active": 1,
              "max_usd": 1.0, "repeats": 1, "strata": [], "planned": 3, "created_by": "owner"} | kw
    row = HarnessRun(**fields)
    async with session_factory() as s, s.begin():
        s.add(row)
    return row.id


async def get(session_factory, pk):
    async with session_factory() as s:
        return await s.get(HarnessRun, pk)


def fake_run_all(summary: BatchSummary, seen: dict):
    async def run_all(deps, manifest, **kw):
        seen.update(kw)
        await kw["on_record"](None, summary)
        return summary
    return run_all


async def fake_deps(ctx):
    return GraphDeps(settings=S), {"llm_config": "db:3", "settings_version": "2", "glossary": "file"}


def ctx_for(session_factory, run_all):
    return {"session_factory": session_factory, "settings": S, "run_all": run_all, "build_eval_deps": fake_deps}


async def test_a_run_is_claimed_capped_and_finished(session_factory, root):
    pk = await add_run(session_factory)
    seen = {}
    out = await run_harness(ctx_for(session_factory, fake_run_all(BatchSummary(done=3, spent=0.2), seen)), pk)
    assert out["status"] == "done"
    assert (seen["strict_cap"], seen["max_usd"], seen["ids"]) == (True, 1.0, ["CD0", "CD1", "CD2"])
    assert seen["spent_before"] == 0.0 and seen["run_id"] == "console-1"
    row = await get(session_factory, pk)
    assert (row.status, row.active, row.done, row.spent_usd) == ("done", None, 3, 0.2)
    assert row.config == {"llm_config": "db:3", "settings_version": "2", "glossary": "file"}
    assert row.started_at is not None and row.finished_at is not None


async def test_earlier_spend_counts_and_the_cap_stop_is_recorded(session_factory, root):
    pk = await add_run(session_factory)
    write_run(S.prompt_version, "console-1", [("CD0", 1, 0.25)])
    seen = {}
    summary = BatchSummary(done=1, spent=0.5, stopped_for_budget=True)
    out = await run_harness(ctx_for(session_factory, fake_run_all(summary, seen)), pk)
    assert seen["spent_before"] == pytest.approx(0.25) and out["status"] == "stopped"
    row = await get(session_factory, pk)
    assert row.status == "stopped" and row.report == f"{S.prompt_version}-console-1.md"


async def test_a_cancelled_run_stops_before_the_next_review_and_stays_cancelled(session_factory, root):
    pk = await add_run(session_factory)

    async def run_all(deps, manifest, **kw):
        async with session_factory() as s, s.begin():  # the admin cancels while the batch runs
            row = await s.get(HarnessRun, pk)
            row.status, row.active = "cancelled", None
        return BatchSummary(done=1, spent=0.1, cancelled=await kw["should_stop"]())

    out = await run_harness(ctx_for(session_factory, run_all), pk)
    row = await get(session_factory, pk)
    assert out["status"] == "cancelled" and (row.status, row.active, row.done) == ("cancelled", None, 1)


async def test_cancelled_runs_are_not_claimed(session_factory, root):
    pk = await add_run(session_factory, status="cancelled", active=None)

    async def must_not_run(*a, **k):
        raise AssertionError("a cancelled run must not start")

    assert (await run_harness(ctx_for(session_factory, must_not_run), pk))["status"] == "skipped"
    row = await get(session_factory, pk)
    assert (row.status, row.active, row.started_at, row.finished_at) == ("cancelled", None, None, None)


@pytest.mark.parametrize("fields", [
    {"status": "error", "active": None, "error": "RuntimeError: enqueue failed"},  # the enqueue raised after Redis took the job
    {"status": "done", "active": None},
    {"status": "stopped", "active": None},
    {"status": "queued", "active": None},  # no active slot: not ours to run
    {"status": "error", "active": 1},  # the status alone refuses it, whatever the slot says
    {"status": "cancelled", "active": 1},
], ids=["error", "done", "stopped", "no-active-slot", "error-with-slot", "cancelled-with-slot"])
async def test_only_a_queued_run_that_holds_the_active_slot_is_claimed(session_factory, root, fields):
    pk = await add_run(session_factory, **fields)
    calls = []

    async def must_not_run(*a, **k):
        calls.append(1)
        raise AssertionError("a run that is not queued and active must not start")

    async def must_not_build(ctx):
        calls.append(1)
        raise AssertionError("no deps are built for a run that is not claimed")

    ctx = ctx_for(session_factory, must_not_run) | {"build_eval_deps": must_not_build}
    assert (await run_harness(ctx, pk)) == {"run": pk, "status": "skipped"}
    row = await get(session_factory, pk)
    assert calls == [] and (row.status, row.active, row.started_at, row.finished_at) == (
        fields["status"], fields["active"], None, None)
    assert row.error == fields.get("error")


async def test_a_run_left_running_by_a_killed_worker_resumes_with_the_earlier_spend(session_factory, root):
    started = datetime(2026, 10, 13, 1, 0, tzinfo=UTC)
    pk = await add_run(session_factory, status="running", started_at=started)  # the worker died before requeue()
    write_run(S.prompt_version, "console-1", [("CD0", 1, 0.25), ("CD1", 1, 0.125)])
    seen = {}
    out = await run_harness(ctx_for(session_factory, fake_run_all(BatchSummary(done=1, skipped=2, spent=0.5), seen)), pk)
    assert out["status"] == "done"
    assert seen["spent_before"] == pytest.approx(0.375) and seen["strict_cap"] is True and seen["max_usd"] == 1.0
    row = await get(session_factory, pk)
    assert (row.status, row.active, row.skipped) == ("done", None, 2)
    assert row.started_at.replace(tzinfo=UTC) == started  # the first attempt's start time is kept


async def test_a_missing_run_is_skipped(session_factory, root):
    async def must_not_run(*a, **k):
        raise AssertionError("a missing run must not start")

    assert (await run_harness(ctx_for(session_factory, must_not_run), 999))["status"] == "skipped"


async def test_a_prompt_version_mismatch_errors_before_anything_runs(session_factory, root):
    pk = await add_run(session_factory, prompt_version="older")
    called = []

    async def run_all(*a, **k):
        called.append(1)

    out = await run_harness(ctx_for(session_factory, run_all), pk)
    row = await get(session_factory, pk)
    assert out["status"] == "error" and called == [] and "prompt_version" in row.error and row.active is None


async def test_a_shutdown_puts_the_run_back_in_the_queue_and_the_retry_resumes(session_factory, root):
    pk = await add_run(session_factory)

    async def interrupted(*a, **k):
        raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        await run_harness(ctx_for(session_factory, interrupted), pk)
    row = await get(session_factory, pk)
    assert (row.status, row.active) == ("queued", 1)
    seen = {}
    assert (await run_harness(ctx_for(session_factory, fake_run_all(BatchSummary(done=1), seen)), pk))["status"] == "done"


async def test_heartbeat_and_worker_settings(redis):
    task = asyncio.create_task(heartbeat({"redis_client": redis}, interval=0.01))
    try:
        for _ in range(100):
            await asyncio.sleep(0.01)
            if await redis.get(WORKER_KEY):
                break
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
    assert json.loads(await redis.get(WORKER_KEY))["worker"] and 0 < await redis.ttl(WORKER_KEY) <= 90
    assert (HarnessWorkerSettings.queue_name, HarnessWorkerSettings.max_jobs) == ("arq:harness", 1)
    assert HarnessWorkerSettings.functions[0].timeout_s == 12 * 3600


def test_compose_keeps_the_harness_opt_in_and_fixtures_out_of_images():
    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
    harness = compose["services"]["harness"]
    assert harness["profiles"] == ["harness"]
    assert harness["command"] == ["arq", "app.worker.harness.HarnessWorkerSettings"]
    assert "./backend/evals/cochrane:/app/evals/cochrane" in harness["volumes"]
    assert "./backend/evals/cochrane:/app/evals/cochrane:ro" in compose["services"]["api"]["volumes"]
    ignored = set((ROOT / "backend" / ".dockerignore").read_text(encoding="utf-8").split())
    assert {"evals/cochrane/fixtures", "evals/cochrane/runs", "evals/cochrane/*.bak"} <= ignored


async def test_eval_deps_use_the_models_settings_glossary_and_catalog_in_force(tmp_path, session_factory, redis,
                                                                              monkeypatch):
    settings = Settings(_env_file=None, openrouter_api_key="sk-or-x",
                        llm_config_path=str(write_yaml(tmp_path / "llm.yaml", MINIMAL)))
    async with session_factory() as s, s.begin():
        await save_version(s, AdminPrincipal(kind="cli", id=None, label="cli"), GLOSSARY_KIND,
                           {"terms": [{"en": "placebo", "th": "ยาหลอก"}]}, settings=settings, base_version=None)
    loaders = []

    async def fake_cached(redis_client, loader):
        loaders.append(loader)
        return {}

    monkeypatch.setattr(harness_worker, "cached_catalog", fake_cached)
    http = HttpClient(timeout=5)
    try:
        deps, labels = await build_eval_deps({"settings": settings, "session_factory": session_factory,
                                              "redis_client": redis, "http": http})
    finally:
        await http.aclose()
    assert labels == {"llm_config": "file", "settings_version": "env", "glossary": "1"}
    assert deps.glossary.label == "1" and deps.llms.preset == "cheap" and (deps.openalex, deps.mcp) == (None, None)
    assert loaders == [llm_reload.load_live_catalog]  # 23b's one-attempt loader, never the shared client's retries
