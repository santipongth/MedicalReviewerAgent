import pytest

from app.cli.eval import run
from app.evals import models
from app.evals.models import Manifest, ManifestEntry, Stratum, save_manifest
from tests.unit.test_review_graph import make_deps


def _entry(i: str) -> ManifestEntry:
    return ManifestEntry(id=i, stratum="cv", title="t", question="metformin and colorectal cancer",
                         primary_outcome="CRC incidence", search_date="2023-01-01", year_to=2023,
                         checked_by_owner=True)


@pytest.mark.asyncio
async def test_freeze_run_report_end_to_end(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    save_manifest(Manifest(seed=1, strata=[Stratum(name="cv", query="x")], reviews=[_entry("CD1")]),
                  tmp_path / "manifest.yaml")
    deps = make_deps()
    assert await run(["freeze"], deps, None, "") == 0
    assert await run(["run", "--run-id", "t1", "--repeats", "2"], deps, None, "") == 0
    assert await run(["report", "--run-id", "t1"], deps, None, "") == 0
    report = (tmp_path / "reports" / f"{deps.settings.prompt_version}-t1.md").read_text(encoding="utf-8")
    assert "Glossary consistency" in report and "Runs (failed) | 2 (0)" in report


@pytest.mark.asyncio
async def test_run_prints_missing_fixtures(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    save_manifest(Manifest(seed=1, strata=[Stratum(name="cv", query="x")], reviews=[_entry("CD1"), _entry("CD2")]),
                  tmp_path / "manifest.yaml")
    assert await run(["run", "--run-id", "t2"], make_deps(), None, "") == 0
    assert "missing fixtures (run freeze): CD1, CD2" in capsys.readouterr().out


@pytest.mark.asyncio
async def test_freeze_refuses_unchecked_manifest(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    save_manifest(Manifest(seed=1, reviews=[ManifestEntry(id="CD1", stratum="cv", title="t")]),
                  tmp_path / "manifest.yaml")
    assert await run(["freeze"], make_deps(), None, "") == 1
    assert "checked_by_owner" in capsys.readouterr().out
