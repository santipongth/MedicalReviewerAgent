"""Plan 22a markdown report. Primary-outcome sections print a placeholder until the 22b gold standard exists."""
from __future__ import annotations

from collections import defaultdict

from app.evals.metrics import ReviewMetrics, aggregate
from app.evals.models import Manifest

PENDING = "รอคำตอบมาตรฐาน (Plan 22b)"


def _pct(v) -> str:
    if v is None:
        return "–"
    if isinstance(v, tuple):
        return f"{v[0]:.1%} ({v[1]:.1%}–{v[2]:.1%})"
    return f"{v:.1%}"


def _rows(a: dict) -> list[tuple[str, str]]:
    return [
        ("Runs (failed)", f"{a['n_runs']} ({a['n_failed']})"),
        ("Number verification rate", _pct(a["verification_rate"])),
        ("Citations stripped as unknown", _pct(a["citation_strip_rate"])),
        ("Thai share, mean / min", f"{_pct(a['thai_share_mean'])} / {_pct(a['thai_share_min'])}"),
        ("Runs below the Thai share floor", _pct(a["below_min_share"])),
        ("Translations refused: numbers / citations", f"{a['numbers_rejected']} / {a['citations_rejected']}"),
        ("Glossary consistency", _pct(a["glossary_consistency"])),
        ("Answer present", _pct(a["answer_rate"])),
        ("Stability of primary-outcome verdict", f"{_pct(a['stability'])} over {a['stability_pairs']} pairs"),
        ("Cost per review: mean / median / max",
         f"${a['cost_mean']:.3f} / ${a['cost_median']:.3f} / ${a['cost_max']:.3f}"),
        ("Batch cost", f"${a['cost_total']:.2f}"),
        ("Time per review (mean)", f"{a['elapsed_mean']:.0f} s"),
    ]


def render_report(prompt_version: str, run_id: str, manifest: Manifest, rows: list[ReviewMetrics], meta: dict,
                  compare: dict | None = None) -> str:
    a = aggregate(rows)
    models = ", ".join(f"{k}={v}" for k, v in sorted((meta.get("models") or {}).items())) or "–"
    out = [f"# Cochrane harness report: {prompt_version} (run {run_id})", "",
           (f"- git `{meta.get('git_sha', '')}` · preset `{meta.get('preset', '')}` · "
            f"pool `{manifest.pool_version}` · seed {manifest.seed}"),
           f"- models: {models}",
           "", "## Summary", ""]
    head = "| Metric | This run |" + (f" {compare['label']} |" if compare else "")
    out += [head, "|---|---|" + ("---|" if compare else "")]
    other = dict(_rows(compare["aggregate"])) if compare else {}
    for name, value in _rows(a):
        out.append(f"| {name} | {value} |" + (f" {other.get(name, '–')} |" if compare else ""))
    out += ["", "## By stratum", "", "| Stratum | Runs | Failed | Glossary | Answer | Cost mean |",
            "|---|---|---|---|---|---|"]
    by: dict[str, list[ReviewMetrics]] = defaultdict(list)
    for r in rows:
        by[r.stratum].append(r)
    for name, group in sorted(by.items()):
        g = aggregate(group)
        out.append(f"| {name} | {g['n_runs']} | {g['n_failed']} | {_pct(g['glossary_consistency'])} | "
                   f"{_pct(g['answer_rate'])} | ${g['cost_mean']:.3f} |")
    out += ["", "## Glossary: most frequent misses", ""]
    out += [f"- {term}: {n}" for term, n in a["glossary_top_misses"]] or ["- none"]
    out += ["", "## Failures (kept in every denominator)", ""]
    out += [f"- {i} r{rep}: {status} — {err}" for i, rep, status, err in a["failures"]] or ["- none"]
    out += ["", "## Agreement with Cochrane (primary outcome)", "", PENDING, "",
            "## Certainty agreement", "", PENDING, "", "## Study recall", "", PENDING, ""]
    return "\n".join(out)
