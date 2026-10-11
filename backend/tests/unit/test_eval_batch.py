import pytest

from app.evals import models
from app.evals.batch import run_all
from app.evals.freeze import freeze_all
from app.evals.models import Manifest, ManifestEntry, RunRecord, Stratum, read_model, run_path
from tests.unit.test_review_graph import make_deps


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    return tmp_path


def manifest(n=2):
    return Manifest(seed=1, strata=[Stratum(name="cv", query="x")], reviews=[
        ManifestEntry(id=f"CD{i}", stratum="cv", title="t", question="metformin and colorectal cancer",
                      primary_outcome="CRC incidence", search_date="2023-01-01", year_to=2023, checked_by_owner=True)
        for i in range(n)])


@pytest.mark.asyncio
async def test_freeze_then_run_then_resume(root):
    deps, m = make_deps(), manifest()
    fixtures = await freeze_all(deps, m, ids=None, force=False, git_sha="s", engines=["pubmed"])
    assert [f.status for f in fixtures] == ["ok", "ok"]
    s1 = await run_all(deps, m, run_id="r1", repeats=2, max_usd=100, ids=None, git_sha="s")
    assert (s1.done, s1.skipped) == (4, 0)
    s2 = await run_all(deps, m, run_id="r1", repeats=2, max_usd=100, ids=None, git_sha="s")
    assert (s2.done, s2.skipped) == (0, 4)
    rec = read_model(run_path(deps.settings.prompt_version, "r1", "CD0", 2), RunRecord)
    assert rec.repeat == 2 and rec.status == "done"


@pytest.mark.asyncio
async def test_budget_stop_leaves_partial_batch(root):
    deps, m = make_deps(), manifest(3)
    await freeze_all(deps, m, ids=None, force=False, git_sha="s", engines=["pubmed"])
    s = await run_all(deps, m, run_id="r2", repeats=1, max_usd=0.000001, ids=None, git_sha="s")
    assert s.stopped_for_budget and s.done == 1


@pytest.mark.asyncio
async def test_rejected_topic_is_recorded_not_dropped(root):
    deps, m = make_deps(allowed=False), manifest(1)
    [fx] = await freeze_all(deps, m, ids=None, force=False, git_sha="s", engines=["pubmed"])
    assert fx.status == "rejected"
    s = await run_all(deps, m, run_id="r3", repeats=1, max_usd=100, ids=None, git_sha="s")
    rec = read_model(run_path(deps.settings.prompt_version, "r3", "CD0", 1), RunRecord)
    assert s.failed == 1 and rec.status == "rejected"
