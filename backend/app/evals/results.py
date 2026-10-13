"""Plan 22a run folders and reports, shared by the eval CLI, the harness worker and the admin console (Plan 23c).
Paths are relative to models.EVAL_ROOT (backend/ in development, /app in the containers)."""
from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path

from app.evals import models
from app.evals.freeze import _selected
from app.evals.metrics import aggregate, review_metrics
from app.evals.models import Manifest, RunRecord, load_manifest, read_model
from app.evals.report import EMPTY, render_report, summary_rows, verdict_changes


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


REPORT_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.md$")
LABEL_PART = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
REPORT_MAX_BYTES = 1_000_000
_REPORT_PARTS = re.compile(r"^(\d{4}-\d{2}-\d{2}\.\d+)-(.+)\.md$")


def _stamp(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat(timespec="seconds")


def list_reports() -> list[dict]:
    folder = models.EVAL_ROOT / "reports"
    if not folder.is_dir():
        return []
    out = []
    for path in folder.glob("*.md"):
        if not REPORT_NAME.match(path.name) or path.is_symlink() or not path.is_file():
            continue
        m = _REPORT_PARTS.match(path.name)
        out.append({"name": path.name, "prompt_version": m.group(1) if m else None,
                    "run_id": m.group(2) if m else None, "size": path.stat().st_size, "modified_at": _stamp(path)})
    return sorted(out, key=lambda r: r["modified_at"], reverse=True)


def read_report(name: str) -> str:
    """A report's Markdown. FileNotFoundError for any name that is not a plain .md file directly in reports/ of at
    most REPORT_MAX_BYTES."""
    folder = (models.EVAL_ROOT / "reports").resolve()
    if not REPORT_NAME.match(name):
        raise FileNotFoundError(name)
    path = folder / name
    if path.is_symlink() or not path.is_file() or path.resolve().parent != folder:
        raise FileNotFoundError(name)
    if path.stat().st_size > REPORT_MAX_BYTES:
        raise FileNotFoundError(name)
    return path.read_text(encoding="utf-8", errors="replace")


def parse_label(label: str) -> tuple[str, str]:
    pv, _, run = label.partition("/")
    if not (LABEL_PART.match(pv) and LABEL_PART.match(run)):
        raise ValueError("a run label looks like PROMPT_VERSION/RUN_ID")
    return pv, run


def list_results() -> list[dict]:
    root = models.EVAL_ROOT / "runs"
    if not root.is_dir():
        return []
    out = []
    for pv_dir in root.iterdir():
        if not pv_dir.is_dir() or pv_dir.is_symlink() or not LABEL_PART.match(pv_dir.name):
            continue
        for run_dir in pv_dir.iterdir():
            if not run_dir.is_dir() or run_dir.is_symlink() or not LABEL_PART.match(run_dir.name):
                continue
            files = sum(1 for _ in run_dir.glob("*.json"))
            if files:
                out.append({"label": f"{pv_dir.name}/{run_dir.name}", "prompt_version": pv_dir.name,
                            "run_id": run_dir.name, "files": files, "modified_at": _stamp(run_dir)})
    return sorted(out, key=lambda r: r["modified_at"], reverse=True)


def compare_results(a: str, b: str) -> dict:
    """Two runs side by side with the report's summary rows. ValueError for a bad label, LookupError when a run has
    no files, FileNotFoundError when the manifest is missing."""
    manifest = load_manifest()
    sides = []
    for side, label in (("a", a), ("b", b)):
        pv, run = parse_label(label)
        rows, _ = load_rows(pv, run, manifest)
        if not rows:
            raise LookupError(f"no run files for run {side}")  # names the field, never the submitted label
        sides.append((label, rows))
    (label_a, rows_a), (label_b, rows_b) = sides
    other = dict(summary_rows(aggregate(rows_b)))
    return {"a": {"label": label_a, "runs": len(rows_a)}, "b": {"label": label_b, "runs": len(rows_b)},
            "rows": [{"metric": name, "a": value, "b": other.get(name, EMPTY)}
                     for name, value in summary_rows(aggregate(rows_a))],
            "verdict_changes": [line.removeprefix("- ") for line in verdict_changes(rows_a, rows_b, label_b)
                                if line != "- none"]}
