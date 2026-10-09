"""Review exports: Markdown (also the MCP resource review://{id}/report.md) and CSV."""
from __future__ import annotations

import csv
import io
from typing import Any

DIRECTION = {"positive": "supports", "negative": "opposite/harm", "null": "no association",
             "mixed": "mixed", "unclear": "unclear"}


def _cell(text: Any) -> str:
    return " ".join(str(text if text is not None else "").split()).replace("|", "\\|")


TYPE_LABEL = {"narrative": "Narrative review", "slr": "Systematic review", "scoping": "Scoping review"}


def _comparison(rows: list[dict[str, Any]], directions: bool = True) -> list[str]:
    """`directions=False` (scoping review) leaves the direction words out: a scoping review does not judge effects."""
    refs = sorted({c["ref"] for r in rows for c in r["cells"]}, key=lambda r: int(r[1:]) if r[1:].isdigit() else 0)
    if not rows or not refs:
        return []
    lines = ["| Outcome | " + " | ".join(refs) + " |", "|---|" + "---|" * len(refs)]
    for row in rows:
        by_ref = {c["ref"]: c for c in row["cells"]}
        cells = [(f"{_cell(by_ref[r]['finding'])} ({DIRECTION.get(by_ref[r]['direction'], by_ref[r]['direction'])})"
                  if directions else _cell(by_ref[r]["finding"])) if r in by_ref else "" for r in refs]
        lines.append(f"| {_cell(row['outcome'])} | " + " | ".join(cells) + " |")
    return lines


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
    out += ["## Summary", "", result.get("summary") or s.get("executive_summary", ""), ""]
    if "evidence_strength" in s and s["evidence_strength"] is None:
        out += [f"**Evidence strength:** not assessed ({s.get('evidence_rationale', '')})", ""]
    else:
        out += [f"**Evidence strength:** {s.get('evidence_strength', 'n/a')} — {s.get('evidence_rationale', '')}", ""]
    table = _comparison(s.get("comparison") or [], directions=review_type != "scoping")
    if table:
        out += ["## Comparison", "", *table, ""]
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
    papers = result.get("papers") or []
    if papers:
        out += ["## Papers", ""]
        for p in papers:
            card = p.get("card") or {}
            link = f" https://doi.org/{p['doi']}" if p.get("doi") else ""
            design = f" — {card.get('study_design')}, n={card.get('sample_size') or '?'}" if card else " — not extracted"
            out.append(f"- [{p['ref']}] {p.get('title')} ({p.get('year') or 'n.d.'}, {p.get('journal') or ''})"
                       f"{design}.{link}")
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
              "key_findings", "limitations"]


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
                                                "ci_lower", "ci_upper", "p_value", "evidence_quote")}
            writer.writerow({k: _cell_value(v) for k, v in row.items()})
    return "\ufeff" + out.getvalue()  # BOM: spreadsheet apps then read Thai/unicode titles correctly
