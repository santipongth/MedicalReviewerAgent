"""Plan 22a: run every frozen review `repeats` times. Resumable: an existing run file is skipped. Stops starting new
runs once the batch has spent `max_usd`."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime

from app.evals import models
from app.evals.freeze import _selected, entry_options
from app.evals.models import Fixture, Manifest, RunRecord
from app.evals.run import replay


@dataclass
class BatchSummary:
    done: int = 0
    skipped: int = 0
    failed: int = 0
    spent: float = 0.0
    stopped_for_budget: bool = False
    missing_fixture: list[str] = field(default_factory=list)


async def run_all(deps, manifest: Manifest, *, run_id: str, repeats: int, max_usd: float, ids: list[str] | None,
                  git_sha: str) -> BatchSummary:
    s = BatchSummary()
    pv = deps.settings.prompt_version
    for entry in _selected(manifest, ids):
        fx_path = models.fixture_path(manifest.pool_version, entry.id)
        if not fx_path.exists():  # operator error, not a review outcome: no run record, so freeze can repair it
            s.missing_fixture.append(entry.id)
            continue
        fixture = models.read_model(fx_path, Fixture)
        for repeat in range(1, repeats + 1):
            path = models.run_path(pv, run_id, entry.id, repeat)
            if path.exists():
                s.skipped += 1
                continue
            if s.spent >= max_usd:
                s.stopped_for_budget = True
                return s
            if fixture.status != "ok":
                rec = RunRecord(id=entry.id, repeat=repeat, run_id=run_id, prompt_version=pv, git_sha=git_sha,
                                pool_version=fixture.pool_version, fixture_frozen_at=fixture.frozen_at,
                                preset=getattr(deps.llms, "preset", ""), models={},
                                llm_config=getattr(deps.llms, "config_version", ""),
                                started_at=datetime.now(UTC).isoformat(timespec="seconds"), elapsed_s=0.0,
                                cost_usd=0.0, status="rejected" if fixture.status == "rejected" else "error",
                                error=fixture.error)
            else:
                rec = await replay(deps, fixture, options=entry_options(entry), repeat=repeat, run_id=run_id,
                                   git_sha=git_sha, primary_outcome=entry.primary_outcome)
            models.write_json_atomic(path, rec)
            s.spent += rec.cost_usd
            if rec.status == "done":
                s.done += 1
            else:
                s.failed += 1
    return s
