"""Review exports: Markdown (also the MCP resource review://{id}/report.md) and CSV."""
from __future__ import annotations

import csv
import io
from typing import Any

from app.harness.design import NON_QUANTITATIVE_CATEGORIES
from app.harness.meta import DESIGN_GROUP_LABEL

DIRECTION = {"positive": "supports", "negative": "opposite/harm", "null": "no association",
             "mixed": "mixed", "unclear": "unclear"}


def _cell(text: Any) -> str:
    return " ".join(str(text if text is not None else "").split()).replace("|", "\\|")


TYPE_LABEL = {"narrative": "Narrative review", "slr": "Systematic review", "scoping": "Scoping review",
              "meta_analysis": "Meta-analysis"}
POOLED_HEADING = ("## Pooled analysis (computed by the system from abstract-verified numbers — "
                  "not a result of any single study)")
# Per-pool warnings shown on the pool line; abstract_only, ci_assumed_95 and adjustment_unknown are on every pool
# and go into the method note instead.
WARNING_LABEL = {
    "small_k": "small number of studies (k<5)",
    "high_heterogeneity": "substantial heterogeneity (I² ≥ 50%)",
    "duplicate_cohort_skipped": "a possible duplicate cohort was left out",
    "other_measures_not_pooled": "studies reporting another effect measure were not pooled",
    "md_units_assumed_equal": "mean differences assumed to share units",
}


def _num(value: float, decimals: int = 2) -> str:
    return f"{value:.{decimals}f}"


def _reported(value: float) -> str:
    """A verified paper number as the paper printed it: no rounding to a fixed number of decimals."""
    return f"{value:g}"


def _warnings(codes: list[str]) -> str:
    labels = [WARNING_LABEL[c] for c in codes if c in WARNING_LABEL]
    return f" Warnings: {'; '.join(labels)}." if labels else ""


def _pooled_section(meta: dict[str, Any] | None) -> list[str]:
    """Markdown lines for result.meta_analysis (empty when there is nothing to show)."""
    if not meta:
        return []
    out = [POOLED_HEADING, ""]
    pools = meta.get("pools") or []
    if not pools:
        out += [("No outcome had at least 3 comparable primary studies with verified effect estimates, "
                 "so nothing was pooled."), ""]
    for p in pools:
        est = p["pooled"]
        refs = ", ".join(f"{s['ref']} {_reported(s['effect'])} [{_reported(s['ci_lower'])}, {_reported(s['ci_upper'])}]"
                         f" w {s['weight']:.1f}%" for s in p["studies"])
        out.append(f"- **{_cell(p.get('outcome_display') or p['outcome'])}** — {p['measure']}, "
                   f"{DESIGN_GROUP_LABEL.get(p['design_group'], p['design_group'])}, k={p['k']}: "
                   f"{_num(est['est'])} (95% CI {_num(est['ci_lower'])} to {_num(est['ci_upper'])}) "
                   f"_(computed)_; I² {p['i2']:.0f}%, τ² {p['tau2']:.3f}. Inputs: {refs}."
                   + _warnings(p.get("warnings") or []))
    if pools:
        out += ["", (f"_Method: {pools[0]['method']} ({meta.get('version')}); 95% CIs; ratio measures pooled on the "
                     "log scale. Inputs are abstracts only; adjusted and unadjusted estimates cannot be told apart._")]
    reference = [r for r in meta.get("reference") or [] if r.get("effect") is not None]
    if reference:
        out += ["", "Systematic reviews / meta-analyses (reference only, not pooled): "
                + "; ".join(f"{r['ref']} {r.get('measure') or ''} {_reported(r['effect'])}" for r in reference) + "."]
    return [*out, ""]


def _comparison(rows: list[dict[str, Any]], directions: bool = True) -> list[str]:
    """`directions=False` (scoping review) leaves the direction words out: a scoping review does not judge effects."""
    refs = sorted({c["ref"] for r in rows for c in r["cells"]}, key=lambda r: int(r[1:]) if r[1:].isdigit() else 0)
    if not rows or not refs:
        return []
    lines = ["| Outcome | " + " | ".join(refs) + " |", "|---|" + "---|" * len(refs)]
    def text(c: dict[str, Any]) -> str:
        # qualitative / mixed-methods themes never carry a direction (Task 2 review finding 5, as in the UI)
        if not directions or c.get("design_category") in NON_QUANTITATIVE_CATEGORIES:
            return _cell(c["finding"])
        return f"{_cell(c['finding'])} ({DIRECTION.get(c['direction'], c['direction'])})"

    for row in rows:
        by_ref = {c["ref"]: c for c in row["cells"]}
        cells = [text(by_ref[r]) if r in by_ref else "" for r in refs]
        lines.append(f"| {_cell(row['outcome'])} | " + " | ".join(cells) + " |")
    return lines


def _other_comparisons(card: dict[str, Any] | None) -> str:
    """The paper's outcomes of another comparison (Plan 19), labelled so a reader never takes them as evidence."""
    others = [o for o in (card or {}).get("outcomes") or [] if o.get("matches_question") is False]
    if not others:
        return ""
    items = "; ".join(_cell(f"{o.get('outcome')} ({o['comparison']})" if o.get("comparison") else o.get("outcome"))
                      for o in others)
    return f" Other comparisons, not evidence for the question: {items}."


def _methods_section(result: dict[str, Any]) -> list[str]:
    """A short Methods block (Plan 20): search date, sources with their record counts, queries, models and the prompt
    version. Absent when the result has none of them (results stored before Plan 20 still list queries and models)."""
    methods = result.get("methods") or {}
    lines: list[str] = []
    if methods.get("searched_at"):
        lines.append(f"- **Searched:** {methods['searched_at']}")
    sources = methods.get("sources") or {}
    if sources:
        lines.append("- **Sources (records before deduplication):** "
                     + ", ".join(f"{_cell(k)} {v}" for k, v in sorted(sources.items(), key=lambda kv: -kv[1])))
    queries = result.get("queries") or []
    if queries:
        lines.append("- **Queries:** " + "; ".join(f"`{_cell(q)}`" for q in queries))
    models = result.get("models") or {}
    if models:
        lines.append("- **Models:** " + ", ".join(f"{role} {_cell(m)}" for role, m in models.items() if m))
    if result.get("prompt_version"):
        lines.append(f"- **Prompt version:** {result['prompt_version']}")
    return ["## Methods", "", *lines, ""] if lines else []


def render_markdown(review) -> str:
    result = review.result
    out = [f"# Literature review: {review.topic}", ""]
    if not result:
        out.append(f"Status: **{review.status}**" + (f" — {review.error}" if review.error else ""))
        return "\n".join(out) + "\n"
    q = result.get("question") or {}
    s = result.get("synthesis") or {}
    if q.get("refined_question"):
        out += [f"**Question:** {q['refined_question']}", ""]
    review_type = result.get("review_type")
    if review_type and review_type != "slr":  # SLR Markdown stays as before
        out += [f"**Review type:** {TYPE_LABEL.get(review_type, review_type)} (automated, abstracts only)", ""]
    # Plan 20: the bottom line and the key findings lead (absent for results stored before Plan 20)
    if s.get("answer"):
        out += ["## Answer", "", s["answer"], ""]
    findings = s.get("key_findings") or []
    if findings:
        out += ["## Key findings", ""]
        for f in findings:
            extra = f"k={f.get('k', len(f.get('refs') or []))}"
            if f.get("certainty"):
                extra += f", certainty {str(f['certainty']).replace('_', ' ')}"
            out.append(f"- **{_cell(f.get('outcome'))}** — {f.get('statement')} [{', '.join(f.get('refs') or [])}] "
                       f"({extra})")
        out.append("")
    out += ["## Summary", "", result.get("summary") or s.get("executive_summary", ""), ""]
    if "evidence_strength" in s and s["evidence_strength"] is None:
        out += [f"**Evidence strength:** not assessed ({s.get('evidence_rationale', '')})", ""]
    else:
        out += [f"**Evidence strength:** {s.get('evidence_strength', 'n/a')} — {s.get('evidence_rationale', '')}", ""]
    table = _comparison(s.get("comparison") or [], directions=review_type != "scoping")
    if table:
        out += ["## Comparison", "", *table, ""]
    if review_type == "meta_analysis":
        out += _pooled_section(result.get("meta_analysis"))
    for title, key in (("Consensus", "consensus"), ("Conflicts", "conflicts")):
        items = [] if review_type == "scoping" else s.get(key) or []  # a scoping review makes no claims
        if items:
            out += [f"## {title}", ""]
            for c in items:
                reasons = f" Likely reasons: {', '.join(c['likely_reasons'])}." if c.get("likely_reasons") else ""
                out.append(f"- **{c['statement']}** [{', '.join(c['refs'])}] {c['explanation']}{reasons}")
            out.append("")
    if s.get("research_gaps"):
        out += ["## Research gaps", "", *[f"- {g}" for g in s["research_gaps"]], ""]
    out += _methods_section(result)
    papers = result.get("papers") or []
    if papers:
        out += ["## Papers", ""]
        for p in papers:
            card = p.get("card") or {}
            link = f" https://doi.org/{p['doi']}" if p.get("doi") else ""
            design = f" — {card.get('study_design')}, n={card.get('sample_size') or '?'}" if card else " — not extracted"
            # Plan 20 Task 10: a further report of a trial counted once, under its primary report
            related = (f" Related report of [{p['related_to']}] ({p.get('related_reason') or 'same trial'}), not "
                       f"counted again." if p.get("related_to") else "")
            out.append(f"- [{p['ref']}] {p.get('title')} ({p.get('year') or 'n.d.'}, {p.get('journal') or ''})"
                       f"{design}.{link}{_other_comparisons(p.get('card_en') or card)}{related}")
        out.append("")
    quality = result.get("quality") or {}
    if quality:
        rate = quality.get("verification_rate")
        out.append(f"_Numbers verified against paper text: {'n/a' if rate is None else f'{rate:.0%}'}; "
                   f"papers flagged uncertain: {quality.get('papers_uncertain', 0)}._")
    return "\n".join(out) + "\n"


CSV_FIELDS = ["ref", "title", "year", "journal", "doi", "pmid", "design_category", "study_design", "sample_size",
              "outcome", "direction", "effect_measure", "effect_value", "ci_lower", "ci_upper", "p_value",
              "evidence_quote", "error",
              "population", "intervention_or_exposure", "comparator", "risk_of_bias", "overall_direction",
              "key_findings", "limitations",
              # Plan 19, appended so existing column positions hold: the outcome's own comparison, and whether it is
              # the review's intervention vs comparator (false: another comparison, never evidence for the question)
              "comparison", "matches_question"]


FORMULA_START = ("=", "+", "-", "@", "\t", "\r")


def _cell_value(value: Any) -> Any:
    """Text that a spreadsheet would run as a formula (titles and quotes come from third-party metadata) gets a
    leading apostrophe; numbers are left as numbers."""
    if isinstance(value, str) and value.startswith(FORMULA_START):
        return "'" + value
    return value


def render_csv(result: dict[str, Any] | None) -> str:
    """One row per paper × outcome, from the English cards. Values the verifier blanked are already null and stay
    empty here: nothing is estimated. A paper without a card gets one row carrying its error."""
    # A scoping review judges neither direction nor bias: those columns stay in the header but are left empty.
    scoping = (result or {}).get("review_type") == "scoping"
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=CSV_FIELDS, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for p in (result or {}).get("papers") or []:
        card = p.get("card_en") or p.get("card")
        base = {"ref": p.get("ref"), "title": p.get("title"), "year": p.get("year"), "journal": p.get("journal"),
                "doi": p.get("doi"), "pmid": p.get("pmid"), "error": p.get("error")}
        if not card:
            writer.writerow({k: _cell_value(v) for k, v in base.items()})
            continue
        base |= {"design_category": card.get("design_category"), "study_design": card.get("study_design"),
                 "sample_size": card.get("sample_size"),
                 **{k: card.get(k) for k in ("population", "intervention_or_exposure", "comparator", "risk_of_bias",
                                             "overall_direction")},
                 **{k: " | ".join(str(x) for x in card.get(k) or []) for k in ("key_findings", "limitations")}}
        for o in card.get("outcomes") or [{}]:
            row = base | {k: o.get(k) for k in ("outcome", "direction", "effect_measure", "effect_value",
                                                "ci_lower", "ci_upper", "p_value", "evidence_quote", "comparison")}
            if o:  # outcomes stored before Plan 19 answer the question
                row["matches_question"] = "false" if o.get("matches_question") is False else "true"
            if scoping:
                row |= {"direction": None, "overall_direction": None, "risk_of_bias": None}
            elif card.get("design_category") in NON_QUANTITATIVE_CATEGORIES:  # themes: no direction (Task 2 review)
                row |= {"direction": None, "overall_direction": None}
            writer.writerow({k: _cell_value(v) for k, v in row.items()})
    return "\ufeff" + out.getvalue()  # BOM: spreadsheet apps then read Thai/unicode titles correctly
