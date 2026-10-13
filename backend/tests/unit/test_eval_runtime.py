import asyncio
import json
import math

import pytest

from app.cli.eval import EvalConfigError, eval_runtime
from app.config import Settings
from app.evals import batch, models
from app.evals.batch import run_all
from app.evals.freeze import entry_options, freeze_all
from app.evals.metrics import review_metrics
from app.evals.models import Fixture, RunRecord, read_model, run_path
from app.evals.results import list_results, load_rows, prior_spend, write_report
from app.graph.graph import GraphDeps
from app.harness.glossary import ActiveGlossary
from app.schemas.review import ReviewOptions
from app.services.admin_auth import AdminPrincipal
from app.services.budget import review_cost_cap
from app.services.config_store import save_version
from app.services.glossary_store import GLOSSARY_KIND
from tests.unit.test_eval_batch import manifest
from tests.unit.test_review_graph import make_deps

S = Settings(_env_file=None)
OWNER = AdminPrincipal(kind="cli", id=None, label="cli")


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    return tmp_path


def record(rid, cost, repeat=1, glossary="3", text="placebo = ยาหลอก", result=None, pv="pv", run="r"):
    return RunRecord(id=rid, repeat=repeat, run_id=run, prompt_version=pv, git_sha="s", preset="p", models={},
                     started_at="2026-10-13T00:00:00", elapsed_s=1.0, cost_usd=cost, status="done",
                     glossary=glossary, glossary_text=text, result=result)


def write_fixtures(m):
    for e in m.reviews:
        models.write_json_atomic(models.fixture_path(m.pool_version, e.id), Fixture(
            id=e.id, pool_version=m.pool_version, frozen_at="2026-10-13T00:00:00", git_sha="s", prompt_version="pv",
            engines=["pubmed"], year_to=2023, topic="t", english_topic="t", question=None, plan=None,
            candidates=[], search_stats={}, status="ok"))


def fake_replay(cost):
    async def replay(deps, fixture, *, options, repeat, run_id, git_sha, primary_outcome="", language="th"):
        return record(fixture.id, cost, repeat=repeat, pv=deps.settings.prompt_version, run=run_id)
    return replay


async def test_strict_cap_never_starts_a_review_that_does_not_fit(root, monkeypatch):
    monkeypatch.setattr(batch, "replay", fake_replay(0.10))
    m = manifest(5)
    write_fixtures(m)
    assert review_cost_cap(S, ReviewOptions.clamped(entry_options(m.reviews[0]))) == pytest.approx(0.28)
    # spent before each start: 0 / 0.1 / 0.2 fit under 0.5 with a 0.28 cap; 0.3 + 0.28 does not
    s = await run_all(GraphDeps(settings=S), m, run_id="r", repeats=1, max_usd=0.5, ids=None, git_sha="s",
                      strict_cap=True)
    assert (s.done, s.stopped_for_budget) == (3, True) and s.spent == pytest.approx(0.30)
    lenient = await run_all(GraphDeps(settings=S), m, run_id="r2", repeats=1, max_usd=0.5, ids=None, git_sha="s")
    assert lenient.done == 5  # the CLI's behaviour is unchanged: it stops only once spent >= max_usd


async def test_spent_before_counts_and_the_hooks_run(root, monkeypatch):
    monkeypatch.setattr(batch, "replay", fake_replay(0.10))
    m = manifest(3)
    write_fixtures(m)
    seen = []
    stops = iter([False, False, True])

    async def on_record(rec, summary):
        seen.append((rec.id, round(summary.spent, 2)))

    async def should_stop():
        return next(stops)

    s = await run_all(GraphDeps(settings=S), m, run_id="r", repeats=1, max_usd=5, ids=None, git_sha="s",
                      spent_before=1.0, on_record=on_record, should_stop=should_stop)
    assert seen == [("CD0", 1.1), ("CD1", 1.2)] and s.cancelled and s.done == 2 and s.spent == pytest.approx(1.2)


async def test_a_retry_counts_earlier_spend_against_the_strict_cap(root, monkeypatch):
    monkeypatch.setattr(batch, "replay", fake_replay(0.10))
    m = manifest(3)
    write_fixtures(m)
    # 0.30 spent by earlier attempts: 0.30 + 0.28 > 0.5, so not one review starts
    none = await run_all(GraphDeps(settings=S), m, run_id="r", repeats=1, max_usd=0.5, ids=None, git_sha="s",
                         strict_cap=True, spent_before=0.30)
    assert (none.done, none.stopped_for_budget, none.spent) == (0, True, pytest.approx(0.30))
    # 0.20 spent: one review fits (0.20 + 0.28 <= 0.5), and then 0.30 + 0.28 does not
    one = await run_all(GraphDeps(settings=S), m, run_id="r", repeats=1, max_usd=0.5, ids=None, git_sha="s",
                        strict_cap=True, spent_before=0.20)
    assert (one.done, one.stopped_for_budget, one.spent) == (1, True, pytest.approx(0.30))


def markers(pv, run="r"):
    return sorted(models.run_path(pv, run, "x", 1).parent.glob("*.inflight"))


async def test_an_interrupted_strict_review_leaves_a_marker_that_a_retry_counts(root, monkeypatch):
    pv = S.prompt_version
    m = manifest(3)
    write_fixtures(m)
    first = fake_replay(0.10)
    calls = []

    async def replay(deps, fixture, **kw):
        calls.append(fixture.id)
        if len(calls) == 2:
            raise asyncio.CancelledError  # a worker shutdown in the middle of the second review
        return await first(deps, fixture, **kw)

    monkeypatch.setattr(batch, "replay", replay)
    with pytest.raises(asyncio.CancelledError):
        await run_all(GraphDeps(settings=S), m, run_id="r", repeats=1, max_usd=0.5, ids=None, git_sha="s",
                      strict_cap=True)
    [marker] = markers(pv)
    assert marker.name.startswith("CD1.") and len(marker.name.split(".")) == 3
    assert json.loads(marker.read_text(encoding="utf-8")) == {"cap": pytest.approx(0.28)}
    assert b"\r" not in marker.read_bytes()  # written with newline="\n"
    assert prior_spend(pv, "r") == pytest.approx(0.10 + 0.28)
    # the run listings, metrics and report never read the marker
    assert [r["files"] for r in list_results()] == [1]
    assert len(load_rows(pv, "r", m)[0]) == 1 and write_report(pv, "r", m) is not None
    # the retried job starts from that: 0.10 spent plus the unknown review's 0.28 leaves no room for a 0.28 review
    # under 0.5 (without the marker, 0.10 + 0.28 would fit and the review would start)
    monkeypatch.setattr(batch, "replay", fake_replay(0.10))
    resumed = await run_all(GraphDeps(settings=S), m, run_id="r", repeats=1, max_usd=0.5, ids=None, git_sha="s",
                            strict_cap=True, spent_before=prior_spend(pv, "r"))
    assert (resumed.done, resumed.skipped, resumed.stopped_for_budget) == (0, 1, True)
    assert resumed.spent == pytest.approx(0.38)


async def test_a_strict_review_marks_itself_until_its_record_is_written(root, monkeypatch):
    pv, seen = S.prompt_version, []
    m = manifest(3)
    write_fixtures(m)
    inner = fake_replay(0.10)

    async def replay(deps, fixture, **kw):
        seen.append((len(markers(pv)), models.run_path(pv, "r", fixture.id, 1).exists()))
        return await inner(deps, fixture, **kw)

    async def on_record(rec, summary):
        seen.append((len(markers(pv)), models.run_path(pv, "r", rec.id, rec.repeat).exists()))

    monkeypatch.setattr(batch, "replay", replay)
    s = await run_all(GraphDeps(settings=S), m, run_id="r", repeats=1, max_usd=5, ids=None, git_sha="s",
                      strict_cap=True, on_record=on_record)
    # per review: one marker and no record while it replays; then a record and no marker
    assert s.done == 3 and seen == [(1, False), (0, True)] * 3
    assert markers(pv) == [] and prior_spend(pv, "r") == pytest.approx(0.30)


async def test_a_non_strict_run_writes_no_markers(root, monkeypatch):
    pv, seen = S.prompt_version, []
    m = manifest(2)
    write_fixtures(m)
    inner = fake_replay(0.10)

    async def replay(deps, fixture, **kw):
        seen.append(len(markers(pv)))
        return await inner(deps, fixture, **kw)

    monkeypatch.setattr(batch, "replay", replay)
    s = await run_all(GraphDeps(settings=S), m, run_id="r", repeats=1, max_usd=5, ids=None, git_sha="s")
    assert s.done == 2 and seen == [0, 0] and markers(pv) == []


@pytest.mark.parametrize("content", ["not json", "[]", '{"cap": null}', '{"cap": "x"}', '{"cap": -1}',
                                     '{"cap": NaN}', "{}"], ids=lambda c: c[:8])
async def test_an_unreadable_marker_counts_as_infinite_and_stops_a_strict_run(root, monkeypatch, content):
    pv = S.prompt_version
    m = manifest(2)
    write_fixtures(m)
    models.write_json_atomic(models.run_path(pv, "r", "CD0", 1), record("CD0", 0.1, pv=pv))
    folder = models.run_path(pv, "r", "CD0", 1).parent
    (folder / "CD1.0a1b2c3d.inflight").write_text(content, encoding="utf-8")
    assert math.isinf(prior_spend(pv, "r"))  # unknown spend is never assumed to be zero
    monkeypatch.setattr(batch, "replay", fake_replay(0.10))
    s = await run_all(GraphDeps(settings=S), m, run_id="r", repeats=1, max_usd=5, ids=None, git_sha="s",
                      strict_cap=True, spent_before=prior_spend(pv, "r"))
    assert (s.done, s.skipped, s.stopped_for_budget) == (0, 1, True)


async def test_replay_records_the_glossary_it_used(root):
    deps, m = make_deps(), manifest(1)
    deps.glossary = ActiveGlossary(4, "placebo = ยาหลอก")
    await freeze_all(deps, m, ids=None, force=False, git_sha="s", engines=["pubmed"])
    await run_all(deps, m, run_id="g", repeats=1, max_usd=100, ids=None, git_sha="s")
    rec = read_model(run_path(deps.settings.prompt_version, "g", "CD0", 1), RunRecord)
    assert (rec.glossary, rec.glossary_text) == ("4", "placebo = ยาหลอก")


async def test_a_rejected_fixture_record_names_the_glossary_too(root):
    deps, m = make_deps(allowed=False), manifest(1)
    deps.glossary = ActiveGlossary(4, "placebo = ยาหลอก")
    await freeze_all(deps, m, ids=None, force=False, git_sha="s", engines=["pubmed"])
    await run_all(deps, m, run_id="j", repeats=1, max_usd=100, ids=None, git_sha="s")
    rec = read_model(run_path(deps.settings.prompt_version, "j", "CD0", 1), RunRecord)
    assert rec.status == "rejected" and rec.glossary == "4"


def test_the_glossary_metric_uses_the_runs_own_glossary():
    result = {"synthesis_en": {"executive_summary": "Compared with placebo, risk fell."},
              "synthesis": {"executive_summary": "เมื่อเทียบกับยาหลอก ความเสี่ยงลดลง"},
              "quality": {}, "stats": {}, "papers": []}
    assert review_metrics(record("CD1", 0.1, result=result), "cv").glossary == [("placebo", True)]
    other = record("CD1", 0.1, result=result, text="placebo = ยาเปล่า")
    assert review_metrics(other, "cv").glossary == [("placebo", False)]
    legacy = record("CD1", 0.1, result=result, text="")  # before Plan 23c: the built-in terms
    assert review_metrics(legacy, "cv").glossary == [("placebo", True)]


def test_prior_spend_load_rows_and_the_report(root):
    m = manifest(2)
    models.write_json_atomic(models.run_path("pv", "r", "CD0", 1), record("CD0", 0.1, glossary="3"))
    models.write_json_atomic(models.run_path("pv", "r", "CD1", 1), record("CD1", 0.25, glossary="file", text=""))
    assert prior_spend("pv", "r") == pytest.approx(0.35) and prior_spend("pv", "none") == 0.0
    rows, meta = load_rows("pv", "r", m)
    assert len(rows) == 2 and meta["glossary"] == "3" and meta["mixed"]["glossary"] == ["3", "file"]
    path = write_report("pv", "r", m)
    text = path.read_text(encoding="utf-8")
    assert path.name == "pv-r.md" and "glossary `3`" in text and "**MIXED BATCH:** glossary: 3, file" in text
    assert write_report("pv", "empty", m) is None
    broken = models.run_path("pv", "b", "CD9", 1)
    broken.parent.mkdir(parents=True, exist_ok=True)
    broken.write_text("not json", encoding="utf-8")
    assert prior_spend("pv", "b") == 0.0  # an unreadable file is skipped


async def test_eval_runtime_uses_the_db_unless_a_config_file_is_given(session_factory):
    rt = await eval_runtime(S, None, lambda: session_factory)
    assert (rt.settings_version, rt.glossary.label) == ("env", "file")
    async with session_factory() as s, s.begin():
        await save_version(s, OWNER, GLOSSARY_KIND, {"terms": [{"en": "placebo", "th": "ยาหลอก"}]}, settings=S,
                           base_version=None)
    assert (await eval_runtime(S, None, lambda: session_factory)).glossary.label == "1"
    assert (await eval_runtime(S, "config/llm.yaml", lambda: session_factory)).glossary.label == "file"

    def broken():
        raise OSError("refused")

    with pytest.raises(EvalConfigError, match="--config-file"):
        await eval_runtime(S, None, broken)
