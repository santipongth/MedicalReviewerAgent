"""Plan 22a run folders and reports, shared by the eval CLI, the harness worker and the admin console (Plan 23c).
Paths are relative to models.EVAL_ROOT (backend/ in development, /app in the containers)."""
from __future__ import annotations

import json
from pathlib import Path

from app.evals import models
from app.evals.freeze import _selected
from app.evals.metrics import aggregate, review_metrics
from app.evals.models import Manifest, RunRecord, read_model
from app.evals.report import render_report


def load_rows(prompt_version: str, run_id: str, manifest: Manifest) -> tuple[list, dict]:
    """(metrics rows, meta) of one run folder: moved here from app/cli/eval.py (23b's version, with its llm_config
    label and mixed check), plus the glossary."""
    strata = {e.id: e.stratum for e in manifest.reviews}
    folder = models.EVAL_ROOT / "runs" / prompt_version / run_id
    recs = [read_model(p, RunRecord) for p in sorted(folder.glob("*.json"))]
    meta: dict = {}
    if recs:
        meta = {"git_sha": recs[0].git_sha, "preset": recs[0].preset, "models": recs[0].models,
                "pool_version": recs[0].pool_version, "llm_config": recs[0].llm_config,
                "glossary": recs[0].glossary}
        # expected = every selected review x every repeat number seen in the folder (at least r1 and r2)
        repeats = {1, 2} | {r.repeat for r in recs}
        have = {(r.id, r.repeat) for r in recs}
        meta["missing"] = [f"{e.id} r{n}" for e in _selected(manifest, None) for n in sorted(repeats)
                           if (e.id, n) not in have]
        meta["expected"] = len(_selected(manifest, None)) * len(repeats)
        fields = {"models": [json.dumps(r.models, sort_keys=True) for r in recs],
                  "git_sha": [r.git_sha for r in recs], "preset": [r.preset for r in recs],
                  "prompt_version": [r.prompt_version for r in recs],
                  "pool_version": [r.pool_version for r in recs],
                  "llm_config": [r.llm_config for r in recs], "glossary": [r.glossary for r in recs]}
        # records of rejected/errored fixtures carry no models or pool version, and records from before a field
        # existed carry "": neither ever makes a batch "mixed"
        distinct = {k: sorted(set(v) - {"{}", ""}) for k, v in fields.items()}
        meta["mixed"] = {k: v for k, v in distinct.items() if len(v) > 1}
    return [review_metrics(r, strata.get(r.id, "?")) for r in recs], meta


def write_report(prompt_version: str, run_id: str, manifest: Manifest, compare_label: str | None = None) -> Path | None:
    """reports/<prompt_version>-<run_id>.md, or None when the run has no files. A comparison run without files is
    left out."""
    rows, meta = load_rows(prompt_version, run_id, manifest)
    if not rows:
        return None
    compare = None
    if compare_label and "/" in compare_label:
        other_pv, other_run = compare_label.split("/", 1)
        other_rows, _ = load_rows(other_pv, other_run, manifest)
        if other_rows:
            compare = {"label": compare_label, "aggregate": aggregate(other_rows), "rows": other_rows}
    path = models.EVAL_ROOT / "reports" / f"{prompt_version}-{run_id}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_report(prompt_version, run_id, manifest, rows, meta, compare), encoding="utf-8",
                    newline="\n")
    return path


def prior_spend(prompt_version: str, run_id: str) -> float:
    """What the records already in a run folder cost (a retried harness job counts it against its cap). Files that
    do not read are skipped."""
    total = 0.0
    for path in (models.EVAL_ROOT / "runs" / prompt_version / run_id).glob("*.json"):
        try:
            total += float(json.loads(path.read_text(encoding="utf-8")).get("cost_usd") or 0.0)
        except (OSError, ValueError, AttributeError, TypeError):
            continue
    return total
