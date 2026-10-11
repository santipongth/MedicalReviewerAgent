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
    assert "manifest already has 1 reviews; re-run with --continue" in capsys.readouterr().out
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


def _write_rec(root, pv, run_id, rid, n, **kw):
    from app.evals.models import RunRecord, run_path, write_json_atomic
    base = {"id": rid, "repeat": n, "run_id": run_id, "prompt_version": pv, "git_sha": "s", "pool_version": "v1",
            "preset": "test", "models": {"extractor": "m1"}, "started_at": "2026-10-11T00:00:00", "elapsed_s": 1.0,
            "cost_usd": 0.1, "status": "done", "result": {}}
    write_json_atomic(run_path(pv, run_id, rid, n), RunRecord(**{**base, **kw}))


@pytest.mark.asyncio
async def test_report_flags_incomplete_batch(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    save_manifest(Manifest(seed=1, strata=[Stratum(name="cv", query="x")], reviews=[_entry("CD1"), _entry("CD2")]),
                  tmp_path / "manifest.yaml")
    deps = make_deps()
    pv = deps.settings.prompt_version
    _write_rec(tmp_path, pv, "t1", "CD1", 1)
    _write_rec(tmp_path, pv, "t1", "CD1", 2)
    _write_rec(tmp_path, pv, "t1", "CD2", 1)
    assert await run(["report", "--run-id", "t1"], deps, None, "") == 0
    report = (tmp_path / "reports" / f"{pv}-t1.md").read_text(encoding="utf-8")
    assert "**INCOMPLETE: 1 of 4 runs missing**" in report and "CD2 r2" in report
    assert "MIXED BATCH" not in report


@pytest.mark.asyncio
async def test_report_flags_mixed_models(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    save_manifest(Manifest(seed=1, strata=[Stratum(name="cv", query="x")], reviews=[_entry("CD1")]),
                  tmp_path / "manifest.yaml")
    deps = make_deps()
    pv = deps.settings.prompt_version
    _write_rec(tmp_path, pv, "t1", "CD1", 1)
    _write_rec(tmp_path, pv, "t1", "CD1", 2, models={"extractor": "m2"})
    assert await run(["report", "--run-id", "t1"], deps, None, "") == 0
    report = (tmp_path / "reports" / f"{pv}-t1.md").read_text(encoding="utf-8")
    assert "**MIXED BATCH:** models:" in report and "m1" in report and "m2" in report
    assert "INCOMPLETE" not in report


@pytest.mark.asyncio
async def test_select_continue_keeps_entries_and_conflicts_with_force(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    save_manifest(Manifest(seed=1, strata=[Stratum(name="cv", query="x")], reviews=[_entry("CD1")]),
                  tmp_path / "manifest.yaml")
    seen = {}

    async def stub(deps, http, base_url, m):
        seen["ids"] = [r.id for r in m.reviews]
        return m

    monkeypatch.setattr("app.cli.eval.select", stub)
    assert await run(["select", "--continue"], make_deps(), None, "") == 0
    assert seen["ids"] == ["CD1"]
    with pytest.raises(SystemExit):
        await run(["select", "--continue", "--force"], make_deps(), None, "")


@pytest.mark.asyncio
async def test_run_prints_run_id_first_and_report_shows_record_pool(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    save_manifest(Manifest(seed=1, strata=[Stratum(name="cv", query="x")], reviews=[_entry("CD1")]),
                  tmp_path / "manifest.yaml")
    deps = make_deps()
    assert await run(["run", "--run-id", "idx"], deps, None, "") == 0
    assert capsys.readouterr().out.splitlines()[0] == "run id: idx"
    _write_rec(tmp_path, deps.settings.prompt_version, "pp", "CD1", 1, pool_version="v7")
    _write_rec(tmp_path, deps.settings.prompt_version, "pp", "CD1", 2, pool_version="v7")
    assert await run(["report", "--run-id", "pp"], deps, None, "") == 0
    report = (tmp_path / "reports" / f"{deps.settings.prompt_version}-pp.md").read_text(encoding="utf-8")
    assert "pool `v7`" in report


def test_git_sha_uses_describe_dirty(monkeypatch):
    import subprocess

    from app.cli import eval as cli
    seen = {}

    def fake(cmd, **k):
        seen["cmd"] = cmd
        return subprocess.CompletedProcess(cmd, 0, stdout="abc123-dirty\n")

    monkeypatch.setattr(cli.subprocess, "run", fake)
    assert cli.git_sha() == "abc123-dirty" and seen["cmd"] == ["git", "describe", "--always", "--dirty"]
