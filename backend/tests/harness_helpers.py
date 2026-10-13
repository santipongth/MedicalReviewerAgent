"""Shared setup for the Plan 23c harness tests: a manifest of two strata (cv: CD0-CD2 frozen; renal: CD3 not
frozen), run files and a live harness worker heartbeat."""
import json

from app.evals import models
from app.evals.models import Fixture, Manifest, ManifestEntry, RunRecord, Stratum, save_manifest
from app.services.harness_runs import WORKER_KEY


def make_eval_root(path) -> None:
    entries = [ManifestEntry(id=f"CD{i}", stratum="cv" if i < 3 else "renal", title="t", question="q",
                             search_date="2023-01-01", year_to=2023, checked_by_owner=True) for i in range(4)]
    save_manifest(Manifest(seed=1, strata=[Stratum(name="cv", query="x"), Stratum(name="renal", query="y")],
                           reviews=entries), path / "manifest.yaml")
    for e in entries[:3]:
        models.write_json_atomic(models.fixture_path("v1", e.id), Fixture(
            id=e.id, pool_version="v1", frozen_at="2026-10-13T00:00:00", git_sha="s", prompt_version="pv",
            engines=["pubmed"], year_to=2023, topic="q", english_topic="q", question=None, plan=None,
            candidates=[], search_stats={}, status="ok"))


async def worker_up(redis) -> None:
    await redis.set(WORKER_KEY, json.dumps({"worker": "h:1", "seen_at": "2026-10-13T00:00:00+00:00"}), ex=90)


def write_run(pv: str, run: str, rows: list[tuple[str, int, float]]) -> None:
    for rid, repeat, cost in rows:
        models.write_json_atomic(models.run_path(pv, run, rid, repeat), RunRecord(
            id=rid, repeat=repeat, run_id=run, prompt_version=pv, git_sha="s", preset="p", models={},
            started_at="2026-10-13T00:00:00", elapsed_s=10.0, cost_usd=cost, status="done"))
