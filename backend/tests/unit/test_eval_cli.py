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


@pytest.mark.asyncio
async def test_select_refuses_nonempty_manifest_without_force(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    save_manifest(Manifest(seed=1, strata=[Stratum(name="cv", query="x")], reviews=[_entry("CD1")]),
                  tmp_path / "manifest.yaml")
    before = (tmp_path / "manifest.yaml").read_bytes()

    async def boom(*a, **k):
        raise AssertionError("select must not run")

    monkeypatch.setattr("app.cli.eval.select", boom)
    assert await run(["select"], make_deps(), None, "") == 1
    assert "manifest already has 1 reviews; re-run with --force" in capsys.readouterr().out
    assert (tmp_path / "manifest.yaml").read_bytes() == before


@pytest.mark.asyncio
async def test_select_force_keeps_backup_and_rebuilds(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    save_manifest(Manifest(seed=1, strata=[Stratum(name="cv", query="x")], reviews=[_entry("CD1")]),
                  tmp_path / "manifest.yaml")
    before = (tmp_path / "manifest.yaml").read_bytes()
    seen = {}

    async def stub(deps, http, base_url, m):
        seen["n"] = len(m.reviews)
        return m

    monkeypatch.setattr("app.cli.eval.select", stub)
    assert await run(["select", "--force"], make_deps(), None, "") == 0
    assert seen["n"] == 0
    assert (tmp_path / "manifest.yaml.bak").read_bytes() == before


@pytest.mark.asyncio
async def test_report_without_run_files_fails(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    save_manifest(Manifest(seed=1, strata=[Stratum(name="cv", query="x")], reviews=[_entry("CD1")]),
                  tmp_path / "manifest.yaml")
    assert await run(["report", "--run-id", "nope"], make_deps(), None, "") == 1
    assert "no run files for" in capsys.readouterr().out


@pytest.mark.asyncio
async def test_report_compare_run_without_slash_fails(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    save_manifest(Manifest(seed=1, strata=[Stratum(name="cv", query="x")], reviews=[_entry("CD1")]),
                  tmp_path / "manifest.yaml")
    assert await run(["report", "--run-id", "t1", "--compare-run", "noslash"], make_deps(), None, "") == 1
    assert "PROMPT_VERSION/RUN_ID" in capsys.readouterr().out
