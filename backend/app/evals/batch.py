"""Plan 22a: run every frozen review `repeats` times. Resumable: an existing run file is skipped. Stops starting new
runs once the batch has spent `max_usd`."""
from __future__ import annotations

import contextlib
from dataclasses import dataclass, field
from datetime import UTC, datetime

from app.evals import models
from app.evals.freeze import _selected, entry_options
from app.evals.models import Fixture, Manifest, RunRecord
from app.evals.run import replay
from app.harness.glossary import glossary_of
from app.schemas.review import ReviewOptions
from app.services.budget import review_cost_cap


@dataclass
class BatchSummary:
    done: int = 0
    skipped: int = 0
    failed: int = 0
    spent: float = 0.0
    stopped_for_budget: bool = False
    cancelled: bool = False
    missing_fixture: list[str] = field(default_factory=list)


async def run_all(deps, manifest: Manifest, *, run_id: str, repeats: int, max_usd: float, ids: list[str] | None,
                  git_sha: str, strict_cap: bool = False, spent_before: float = 0.0, on_record=None,
                  should_stop=None) -> BatchSummary:
    """Plan 23c, for the console's runs:
    - strict_cap: a review starts only when what is spent plus that review's own cost cap fits in max_usd, so the
      batch never overshoots by a whole review. Each review also writes an in-flight marker (models.inflight_path,
      {"cap": its own cap}) before it starts and removes it once its record is written, so a review that is
      interrupted or killed mid-way (no record, unknown spend) is still counted at its cap by results.prior_spend
      when the job is retried. The marker is deliberately not removed on CancelledError;
    - spent_before: what earlier attempts of this run already spent;
    - on_record(rec, summary): called after each record is written;
    - should_stop(): checked before each review; True stops the batch with summary.cancelled."""
    s = BatchSummary(spent=spent_before)
    pv = deps.settings.prompt_version
    for entry in _selected(manifest, ids):
        fx_path = models.fixture_path(manifest.pool_version, entry.id)
        if not fx_path.exists():  # operator error, not a review outcome: no run record, so freeze can repair it
            s.missing_fixture.append(entry.id)
            continue
        fixture = models.read_model(fx_path, Fixture)
        need = review_cost_cap(deps.settings, ReviewOptions.clamped(entry_options(entry))) if strict_cap else 0.0
        for repeat in range(1, repeats + 1):
            path = models.run_path(pv, run_id, entry.id, repeat)
            if path.exists():
                s.skipped += 1
                continue
            if should_stop is not None and await should_stop():
                s.cancelled = True
                return s
            if s.spent >= max_usd or (strict_cap and s.spent + need > max_usd):
                s.stopped_for_budget = True
                return s
            marker = None
            if fixture.status != "ok":
                rec = RunRecord(id=entry.id, repeat=repeat, run_id=run_id, prompt_version=pv, git_sha=git_sha,
                                pool_version=fixture.pool_version, fixture_frozen_at=fixture.frozen_at,
                                preset=getattr(deps.llms, "preset", ""), models={},
                                llm_config=getattr(deps.llms, "config_version", ""),
                                glossary=glossary_of(deps).label,
                                started_at=datetime.now(UTC).isoformat(timespec="seconds"), elapsed_s=0.0,
                                cost_usd=0.0, status="rejected" if fixture.status == "rejected" else "error",
                                error=fixture.error)
            else:
                if strict_cap:  # a write that fails stops the run before any money is spent
                    marker = models.inflight_path(pv, run_id, entry.id)
                    models.write_json_atomic(marker, {"cap": need})
                rec = await replay(deps, fixture, options=entry_options(entry), repeat=repeat, run_id=run_id,
                                   git_sha=git_sha, primary_outcome=entry.primary_outcome, title=entry.title)
            models.write_json_atomic(path, rec)
            if marker is not None:  # only now: until the record exists the marker is the only trace of the spend
                with contextlib.suppress(OSError):  # a marker left behind only over-counts
                    marker.unlink(missing_ok=True)
            s.spent += rec.cost_usd
            if rec.status == "done":
                s.done += 1
            else:
                s.failed += 1
            if on_record is not None:
                await on_record(rec, s)
    return s
