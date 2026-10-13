import asyncio
import contextlib
import json
import math
from datetime import UTC, datetime
from pathlib import Path

import pytest
import yaml
from arq.worker import Retry

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
from app.services.model_catalog import ModelInfo
from app.services.runtime_settings import SETTINGS_KIND
from app.worker import harness as harness_worker
from app.worker import llm_reload
from app.worker.harness import (
    MARKER_UNREADABLE,
    SPEND_UNKNOWN,
    HarnessWorkerSettings,
    build_eval_deps,
    heartbeat,
    run_harness,
)
from tests.harness_helpers import make_eval_root, write_run
from tests.llm_helpers import MINIMAL, with_model, write_yaml

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
async def test_a_run_that_is_over_or_holds_no_slot_is_not_claimed(session_factory, root, fields):
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
        called.append("run_all")

    async def build(ctx):  # config loads, the catalog fetch and LLM construction all come after the check
        called.append("build_eval_deps")
        return await fake_deps(ctx)

    out = await run_harness(ctx_for(session_factory, run_all) | {"build_eval_deps": build}, pk)
    row = await get(session_factory, pk)
    assert out["status"] == "error" and called == [] and "prompt_version" in row.error and row.active is None
    assert row.config == {} and row.started_at is not None


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


async def test_a_late_cancel_is_reported_as_cancelled_not_done(session_factory, root):
    pk = await add_run(session_factory)

    async def run_all(deps, manifest, **kw):
        async with session_factory() as s, s.begin():  # cancelled during the last review: nothing left to stop
            row = await s.get(HarnessRun, pk)
            row.status, row.active = "cancelled", None
        return BatchSummary(done=3, spent=0.3)

    out = await run_harness(ctx_for(session_factory, run_all), pk)
    row = await get(session_factory, pk)
    assert out["status"] == "cancelled" and (row.status, row.active, row.done) == ("cancelled", None, 3)


async def test_the_job_has_its_own_deadline_that_frees_the_slot(session_factory, root, monkeypatch):
    monkeypatch.setattr(harness_worker, "JOB_DEADLINE_SECONDS", 0.05)
    pk = await add_run(session_factory)

    async def slow(*a, **k):
        await asyncio.sleep(30)

    out = await run_harness(ctx_for(session_factory, slow), pk)  # arq's own timeout would leave the row queued
    row = await get(session_factory, pk)
    assert out["status"] == "error" and (row.status, row.active, row.error) == ("error", None, "timed out")
    assert row.finished_at is not None


async def test_a_timeout_from_inside_the_work_is_not_called_the_deadline(session_factory, root):
    pk = await add_run(session_factory)

    async def timed_out(*a, **k):
        raise TimeoutError("provider")

    out = await run_harness(ctx_for(session_factory, timed_out), pk)
    row = await get(session_factory, pk)
    assert out["status"] == "error" and row.error == "TimeoutError: provider" and row.active is None


async def test_the_last_allowed_interruption_ends_the_run_instead_of_requeueing_it(session_factory, root):
    async def interrupted(*a, **k):
        raise asyncio.CancelledError

    early = await add_run(session_factory)
    with pytest.raises(asyncio.CancelledError):
        await run_harness(ctx_for(session_factory, interrupted) | {"job_try": 2}, early)
    row = await get(session_factory, early)
    assert (row.status, row.active) == ("queued", 1)  # a try is left: arq runs the job again

    async with session_factory() as s, s.begin():  # free the slot for the next run
        row = await s.get(HarnessRun, early)
        row.status, row.active = "cancelled", None
    last = await add_run(session_factory, run_id="console-2")
    with pytest.raises(asyncio.CancelledError):
        await run_harness(ctx_for(session_factory, interrupted) | {"job_try": 3}, last)  # a 4th try never calls us
    row = await get(session_factory, last)
    assert (row.status, row.active, row.error) == ("error", None, "interrupted 3 times")
    assert row.finished_at is not None


async def test_a_real_task_cancel_inside_the_deadline_requeues_the_run(session_factory, root):
    pk = await add_run(session_factory)
    started = asyncio.Event()

    async def run_all(*a, **k):
        started.set()
        await asyncio.sleep(30)

    task = asyncio.create_task(run_harness(ctx_for(session_factory, run_all), pk))  # what arq does on a shutdown
    await asyncio.wait_for(started.wait(), 5)
    assert (await get(session_factory, pk)).status == "running"
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    row = await get(session_factory, pk)
    assert (row.status, row.active) == ("queued", 1)  # the deadline did not turn the cancel into an error


async def test_a_database_failure_while_claiming_is_retried_not_failed(session_factory, root, monkeypatch):
    pk = await add_run(session_factory)
    calls = []

    async def broken_claim(*a, **k):
        calls.append(1)
        raise ConnectionError("database down")

    monkeypatch.setattr(harness_worker, "claim", broken_claim)

    async def must_not_run(*a, **k):
        raise AssertionError("nothing may start when the claim failed")

    with pytest.raises(Retry) as caught:
        await run_harness(ctx_for(session_factory, must_not_run) | {"job_try": 1}, pk)
    assert caught.value.defer_score == 30_000
    with pytest.raises(ConnectionError):  # on the last try a Retry would only become arq's "max retries exceeded"
        await run_harness(ctx_for(session_factory, must_not_run) | {"job_try": 3}, pk)
    assert len(calls) == 2


async def test_an_unfinished_review_counts_at_its_cap_when_the_job_is_retried(session_factory, root):
    pk = await add_run(session_factory)
    write_run(S.prompt_version, "console-1", [("CD0", 1, 0.25)])
    folder = models.run_path(S.prompt_version, "console-1", "CD1", 1).parent
    (folder / "CD1.0a1b2c3d.inflight").write_text(json.dumps({"cap": 0.4}), encoding="utf-8")
    seen = {}
    await run_harness(ctx_for(session_factory, fake_run_all(BatchSummary(done=1, spent=0.7), seen)), pk)
    assert seen["spent_before"] == pytest.approx(0.65)  # the killed review may have spent anything up to its cap


async def test_an_unreadable_marker_stops_the_run_and_infinity_never_reaches_the_row(session_factory, root):
    pk = await add_run(session_factory)
    folder = models.run_path(S.prompt_version, "console-1", "CD1", 1).parent
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "CD1.0a1b2c3d.inflight").write_text("not json", encoding="utf-8")
    seen = {}

    async def run_all(deps, manifest, **kw):  # what the real run_all does when spent_before >= max_usd
        seen.update(kw)
        return BatchSummary(spent=kw["spent_before"], stopped_for_budget=True)

    out = await run_harness(ctx_for(session_factory, run_all), pk)
    row = await get(session_factory, pk)
    assert math.isinf(seen["spent_before"]) and out["status"] == "stopped" and out["spent_usd"] is None
    assert (row.status, row.active, row.spent_usd, row.error) == ("stopped", None, 0.0, MARKER_UNREADABLE)


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
    beat = json.loads(await redis.get(WORKER_KEY))
    assert beat["worker"] and datetime.fromisoformat(beat["seen_at"]) and 0 < await redis.ttl(WORKER_KEY) <= 90
    assert (HarnessWorkerSettings.queue_name, HarnessWorkerSettings.max_jobs) == ("arq:harness", 1)
    assert (HarnessWorkerSettings.max_tries, HarnessWorkerSettings.functions[0].max_tries) == (3, 3)
    assert HarnessWorkerSettings.functions[0].timeout_s == HarnessWorkerSettings.job_timeout == 12 * 3600
    assert harness_worker.JOB_DEADLINE_SECONDS < harness_worker.JOB_TIMEOUT_SECONDS  # ours fires first


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
        loaders.append(loader)  # returns None: cached_catalog's "unavailable" (it never returns an empty dict)

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


async def test_eval_deps_apply_the_saved_settings_override(tmp_path, session_factory, redis, monkeypatch):
    settings = Settings(_env_file=None, openrouter_api_key="sk-or-x",
                        llm_config_path=str(write_yaml(tmp_path / "llm.yaml", MINIMAL)))
    assert settings.review_cost_per_paper_usd != 0.02
    async with session_factory() as s, s.begin():
        await save_version(s, AdminPrincipal(kind="cli", id=None, label="cli"), SETTINGS_KIND,
                           {"values": {"review_cost_per_paper_usd": 0.02}}, settings=settings, base_version=None)

    async def no_catalog(redis_client, loader):
        return None

    monkeypatch.setattr(harness_worker, "cached_catalog", no_catalog)
    http = HttpClient(timeout=5)
    try:
        deps, labels = await build_eval_deps({"settings": settings, "session_factory": session_factory,
                                              "redis_client": redis, "http": http})
    finally:
        await http.aclose()
    assert deps.settings.review_cost_per_paper_usd == 0.02 and labels["settings_version"] == "1"
    assert settings.review_cost_per_paper_usd != 0.02  # the base settings object is not mutated


async def test_unpriced_roles_end_the_run_as_an_error_before_anything_is_spent(tmp_path, session_factory, redis,
                                                                              monkeypatch, root):
    raw = with_model(with_model(MINIMAL, "cheap", "screener", "vendor/secret-x"), "cheap", "extractor", "vendor/secret-x")
    settings = Settings(_env_file=None, openrouter_api_key="sk-or-x",
                        llm_config_path=str(write_yaml(tmp_path / "llm.yaml", raw)))
    priced = ModelInfo(id="vendor/cheap", context_length=1000, price_in=1e-7, price_out=1e-7,
                       supported_parameters=frozenset())

    async def catalog(redis_client, loader):
        return {"vendor/cheap": priced}

    monkeypatch.setattr(harness_worker, "cached_catalog", catalog)
    pk = await add_run(session_factory)
    called = []

    async def run_all(*a, **k):
        called.append("run_all")

    http = HttpClient(timeout=5)
    try:
        out = await run_harness({"settings": settings, "session_factory": session_factory, "redis_client": redis,
                                 "http": http, "run_all": run_all}, pk)
    finally:
        await http.aclose()
    row = await get(session_factory, pk)
    assert out["status"] == "error" and called == [] and row.active is None
    # conflict_explainer falls back to the extractor model; the message names roles only, never a model id
    assert row.error == "models without a known price: screener, extractor, conflict_explainer"
    assert row.spent_usd == 0.0 and row.config == {}


async def test_the_deadline_and_the_last_interruption_store_what_the_run_files_account_for(session_factory, root,
                                                                                          monkeypatch):
    monkeypatch.setattr(harness_worker, "JOB_DEADLINE_SECONDS", 0.05)

    async def slow_forever(*a, **k):
        await asyncio.sleep(30)

    pk = await add_run(session_factory)
    write_run(S.prompt_version, "console-1", [("CD0", 1, 0.25)])
    folder = models.run_path(S.prompt_version, "console-1", "CD1", 1).parent
    (folder / "CD1.0a1b2c3d.inflight").write_text(json.dumps({"cap": 0.4}), encoding="utf-8")
    await run_harness(ctx_for(session_factory, slow_forever), pk)
    row = await get(session_factory, pk)
    assert (row.status, row.error, row.spent_usd) == ("error", "timed out", pytest.approx(0.65))

    async def interrupted(*a, **k):
        raise asyncio.CancelledError

    last = await add_run(session_factory, run_id="console-2", spent_usd=0.1)
    write_run(S.prompt_version, "console-2", [("CD0", 1, 0.3)])
    with pytest.raises(asyncio.CancelledError):
        await run_harness(ctx_for(session_factory, interrupted) | {"job_try": 3}, last)
    row = await get(session_factory, last)
    assert (row.status, row.error, row.spent_usd) == ("error", "interrupted 3 times", pytest.approx(0.3))


async def test_unknown_spend_at_the_deadline_keeps_the_last_value_and_says_why(session_factory, root, monkeypatch):
    monkeypatch.setattr(harness_worker, "JOB_DEADLINE_SECONDS", 0.05)
    pk = await add_run(session_factory, spent_usd=0.2)
    folder = models.run_path(S.prompt_version, "console-1", "CD1", 1).parent
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "CD1.0a1b2c3d.inflight").write_text("not json", encoding="utf-8")

    async def slow(*a, **k):
        await asyncio.sleep(30)

    await run_harness(ctx_for(session_factory, slow), pk)
    row = await get(session_factory, pk)
    assert (row.status, row.spent_usd, row.error) == ("error", 0.2, f"timed out; {SPEND_UNKNOWN}")
