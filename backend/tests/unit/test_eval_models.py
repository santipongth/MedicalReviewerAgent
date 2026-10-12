# backend/tests/unit/test_eval_models.py
import json

from app.evals.models import (
    Fixture,
    Manifest,
    ManifestEntry,
    RunRecord,
    Stratum,
    read_model,
    write_json_atomic,
)


def entry(i="CD000001"):
    return ManifestEntry(
        id=i,
        pmid="1",
        doi="10.1002/x",
        stratum="cardiovascular",
        title="t",
        question="In adults, does A versus B reduce death?",
        review_type="slr",
        primary_outcome="death",
        search_date="2023-04-30",
        year_to=2023,
    )


def test_manifest_round_trip(tmp_path):
    from app.evals.models import load_manifest, save_manifest

    m = Manifest(
        seed=7,
        pool_version="v1",
        strata=[Stratum(name="cardiovascular", query="heart")],
        reviews=[entry()],
    )
    save_manifest(m, tmp_path / "manifest.yaml")
    assert load_manifest(tmp_path / "manifest.yaml") == m


def test_atomic_write_leaves_no_tmp_and_reads_back(tmp_path):
    rec = RunRecord(
        id="CD1",
        repeat=1,
        run_id="r",
        prompt_version="p",
        git_sha="s",
        preset="budget",
        models={},
        started_at="2026-10-11T00:00:00Z",
        elapsed_s=1.0,
        cost_usd=0.02,
        status="done",
    )
    p = tmp_path / "a" / "CD1.r1.json"
    write_json_atomic(p, rec)
    assert read_model(p, RunRecord) == rec and not list(p.parent.glob("*.tmp"))
    assert json.loads(p.read_text(encoding="utf-8"))["status"] == "done"


def test_fixture_requires_status():
    f = Fixture(
        id="CD1",
        pool_version="v1",
        frozen_at="x",
        git_sha="s",
        prompt_version="p",
        engines=[],
        year_to=2023,
        topic="t",
        english_topic=None,
        question=None,
        plan=None,
        candidates=[],
        search_stats={},
        status="rejected",
        error="not medical",
    )
    assert f.status == "rejected"


def test_path_helpers_read_eval_root_at_call_time(tmp_path, monkeypatch):
    from app.evals import models

    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    assert models.fixture_path("v1", "CD1") == tmp_path / "fixtures" / "pool-v1" / "CD1.json"
    assert models.run_path("p", "r", "CD1", 2) == tmp_path / "runs" / "p" / "r" / "CD1.r2.json"
    assert models.load_gold("CD1") is None


def test_load_manifest_and_load_gold_follow_eval_root(tmp_path, monkeypatch):
    from app.evals import models

    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    models.save_manifest(Manifest(seed=1))
    assert models.load_manifest().seed == 1
    (tmp_path / "gold").mkdir()
    (tmp_path / "gold" / "CD1.yaml").write_text(
        "id: CD1\nprimary_outcome: death\ndirection: benefit\ncertainty: low\nextracted_by: a\n",
        encoding="utf-8",
    )
    assert models.load_gold("CD1").direction == "benefit"
