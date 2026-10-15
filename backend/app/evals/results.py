"""Plan 22a run folders and reports, shared by the eval CLI, the harness worker and the admin console (Plan 23c).
Paths are relative to models.EVAL_ROOT (backend/ in development, /app in the containers)."""
from __future__ import annotations

import json
import math
import os
import re
import stat
from datetime import UTC, datetime
from pathlib import Path

import yaml

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
        meta = {"git_sha": recs[0].git_sha, "preset": recs[0].preset, "models": next((r.models for r in recs if r.models), {}),
                "pool_version": recs[0].pool_version, "llm_config": recs[0].llm_config,
                "glossary": recs[0].glossary or "file"}
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
                  "llm_config": [r.llm_config for r in recs],
                  # a record from before Plan 23c carries "" and ran the built-in glossary: that is "file"
                  "glossary": [r.glossary or "file" for r in recs]}
        # records of rejected/errored fixtures carry no models or pool version, and records from before a field
        # existed carry "": neither ever makes a batch "mixed" (except the glossary, whose "" means "file")
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


def _inflight_cap(path: Path) -> float:
    """The cap an in-flight marker holds. A marker that does not read, or holds no usable cap, counts as infinite:
    its review's spend is unknown, so the run stops rather than assume it was zero."""
    try:
        cap = float(json.loads(path.read_text(encoding="utf-8"))["cap"])
    except (OSError, ValueError, KeyError, TypeError, OverflowError):  # OverflowError: a huge integer
        return math.inf
    return cap if math.isfinite(cap) and cap >= 0 else math.inf


def _record_cost(path: Path) -> float:
    """The cost a run record holds (a missing or null cost is 0.0, as replay writes it). A record that does not read,
    or holds a cost that is not a finite non-negative number, counts as infinite, like an unreadable marker."""
    try:
        cost = float(json.loads(path.read_text(encoding="utf-8")).get("cost_usd") or 0.0)
    except (OSError, ValueError, AttributeError, TypeError, OverflowError):
        return math.inf
    return cost if math.isfinite(cost) and cost >= 0 else math.inf


def prior_spend(prompt_version: str, run_id: str) -> float:
    """What a run folder already accounts for, which a retried harness job counts against its cap: the cost of every
    record, plus the cap of every in-flight marker (models.inflight_path). A marker is a review that started in a
    strict run and never wrote its record, because the worker was killed or interrupted mid-review, so it may have
    spent anything up to its cap. A record or a marker that does not read, or holds no usable cost, makes the result
    infinite (its spend is unknown, so the run stops rather than assume it was zero; see _inflight_cap)."""
    folder = models.EVAL_ROOT / "runs" / prompt_version / run_id
    total = 0.0
    for path in folder.glob("*.json"):
        total += _record_cost(path)
    for marker in folder.glob(f"*{models.INFLIGHT_SUFFIX}"):
        total += _inflight_cap(marker)
    return total


# Both name patterns are used with fullmatch: "$" would also let a trailing newline through ("ok.md\n").
REPORT_NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.md")
LABEL_PART = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}")
REPORT_MAX_BYTES = 1_000_000
LABEL_HINT = "a run label looks like PROMPT_VERSION/RUN_ID"
_REPORT_PARTS = re.compile(r"(\d{4}-\d{2}-\d{2}\.\d+)-(.+)\.md")


class RunNotFound(LookupError):
    """A compared run (side "a" or "b") has no run files. Carries the side, never the submitted label."""

    def __init__(self, side: str) -> None:
        super().__init__(f"no run files for run {side}")
        self.side = side


class ResultsUnreadable(Exception):
    """The manifest or a run file does not read or validate. `what` is "manifest" or "run file". The cause is chained
    for the log only: pydantic and YAML errors quote the file's content, so it must never reach a response."""

    def __init__(self, what: str) -> None:
        super().__init__(f"the {what} could not be read")
        self.what = what


def _stamp(mtime: float) -> str:
    return datetime.fromtimestamp(mtime, UTC).isoformat(timespec="seconds")


def list_reports() -> list[dict]:
    folder = models.EVAL_ROOT / "reports"
    if not folder.is_dir():
        return []
    try:
        paths = list(folder.glob("*.md"))
    except OSError:
        return []
    out = []
    for path in paths:
        if not REPORT_NAME.fullmatch(path.name):
            continue
        try:  # a file removed or swapped between the glob and the stat is left out, not a 500
            if path.is_symlink() or not path.is_file():
                continue
            info = path.stat()
        except OSError:
            continue
        m = _REPORT_PARTS.fullmatch(path.name)
        out.append({"name": path.name, "prompt_version": m.group(1) if m else None,
                    "run_id": m.group(2) if m else None, "size": info.st_size, "modified_at": _stamp(info.st_mtime)})
    return sorted(out, key=lambda r: r["modified_at"], reverse=True)


def read_report(name: str) -> str:
    """A report's Markdown. FileNotFoundError for any name that is not a plain .md file directly in reports/ of at
    most REPORT_MAX_BYTES. The file is opened once (no symlink followed where the platform can refuse one), the open
    descriptor is checked, and at most REPORT_MAX_BYTES + 1 bytes are read, so a file that grows or is swapped after
    the checks cannot get past the limit."""
    folder = (models.EVAL_ROOT / "reports").resolve()
    if not REPORT_NAME.fullmatch(name):
        raise FileNotFoundError(name)
    path = folder / name
    try:
        # is_file() first: opening a FIFO named *.md for reading would block the thread until a writer appears
        if path.is_symlink() or path.resolve().parent != folder or not path.is_file():
            raise FileNotFoundError(name)
    except (OSError, RuntimeError) as exc:  # a path that cannot be resolved is not a report
        raise FileNotFoundError(name) from exc
    try:
        # O_NONBLOCK: one swapped for a FIFO after the check still cannot block the open (fstat then refuses it)
        fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)
                     | getattr(os, "O_NONBLOCK", 0))
    except OSError as exc:  # missing, a symlink (ELOOP), a directory on Windows, no permission
        raise FileNotFoundError(name) from exc
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > REPORT_MAX_BYTES:
            raise FileNotFoundError(name)
        handle = os.fdopen(fd, "rb")
    except BaseException:
        os.close(fd)
        raise
    with handle:
        data = handle.read(REPORT_MAX_BYTES + 1)
    if len(data) > REPORT_MAX_BYTES:
        raise FileNotFoundError(name)
    return data.decode("utf-8", errors="replace")


def parse_label(label: str) -> tuple[str, str]:
    pv, _, run = label.partition("/")
    if not (LABEL_PART.fullmatch(pv) and LABEL_PART.fullmatch(run)):
        raise ValueError(LABEL_HINT)
    return pv, run


def list_results() -> list[dict]:
    root = models.EVAL_ROOT / "runs"
    if not root.is_dir():
        return []
    try:
        pv_dirs = list(root.iterdir())
    except OSError:
        return []
    out = []
    for pv_dir in pv_dirs:
        try:
            if not pv_dir.is_dir() or pv_dir.is_symlink() or not LABEL_PART.fullmatch(pv_dir.name):
                continue
            run_dirs = list(pv_dir.iterdir())
        except OSError:
            continue
        for run_dir in run_dirs:
            try:
                if not run_dir.is_dir() or run_dir.is_symlink() or not LABEL_PART.fullmatch(run_dir.name):
                    continue
                files = sum(1 for _ in run_dir.glob("*.json"))
                modified = _stamp(run_dir.stat().st_mtime)
            except OSError:
                continue
            if files:
                out.append({"label": f"{pv_dir.name}/{run_dir.name}", "prompt_version": pv_dir.name,
                            "run_id": run_dir.name, "files": files, "modified_at": modified})
    return sorted(out, key=lambda r: r["modified_at"], reverse=True)


def compare_results(a: str, b: str) -> dict:
    """Two runs side by side with the report's summary rows. ValueError for a bad label (checked first),
    FileNotFoundError when the manifest is missing, RunNotFound when a run has no files and ResultsUnreadable when the
    manifest or a run file does not read or validate. Anything else is a bug and propagates."""
    labels = [parse_label(a), parse_label(b)]
    try:
        manifest = load_manifest()
    except FileNotFoundError:
        raise
    except (OSError, ValueError, yaml.YAMLError) as exc:
        raise ResultsUnreadable("manifest") from exc
    sides = []
    for side, label, (pv, run) in zip("ab", (a, b), labels, strict=True):
        try:
            rows, _ = load_rows(pv, run, manifest)
        except (OSError, ValueError) as exc:  # includes pydantic's ValidationError and UnicodeDecodeError
            raise ResultsUnreadable("run file") from exc
        if not rows:
            raise RunNotFound(side)
        sides.append((label, rows))
    (label_a, rows_a), (label_b, rows_b) = sides
    other = dict(summary_rows(aggregate(rows_b)))
    return {"a": {"label": label_a, "runs": len(rows_a)}, "b": {"label": label_b, "runs": len(rows_b)},
            "rows": [{"metric": name, "a": value, "b": other.get(name, EMPTY)}
                     for name, value in summary_rows(aggregate(rows_a))],
            "verdict_changes": [line.removeprefix("- ") for line in verdict_changes(rows_a, rows_b, label_b)
                                if line != "- none"]}
