"""Markdown rendering of a review (MCP resource review://{id}/report.md; exports later)."""
from __future__ import annotations

from typing import Any

DIRECTION = {"positive": "supports", "negative": "opposite/harm", "null": "no association",
             "mixed": "mixed", "unclear": "unclear"}


def _cell(text: Any) -> str:
    return " ".join(str(text if text is not None else "").split()).replace("|", "\\|")


def _comparison(rows: list[dict[str, Any]]) -> list[str]:
    refs = sorted({c["ref"] for r in rows for c in r["cells"]}, key=lambda r: int(r[1:]) if r[1:].isdigit() else 0)
    if not rows or not refs:
        return []
    lines = ["| Outcome | " + " | ".join(refs) + " |", "|---|" + "---|" * len(refs)]
    for row in rows:
        by_ref = {c["ref"]: c for c in row["cells"]}
        cells = [f"{_cell(by_ref[r]['finding'])} ({DIRECTION.get(by_ref[r]['direction'], by_ref[r]['direction'])})"
                 if r in by_ref else "" for r in refs]
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
    out += ["## Summary", "", result.get("summary") or s.get("executive_summary", ""), ""]
    out += [f"**Evidence strength:** {s.get('evidence_strength', 'n/a')} — {s.get('evidence_rationale', '')}", ""]
    table = _comparison(s.get("comparison") or [])
    if table:
        out += ["## Comparison", "", *table, ""]
    for title, key in (("Consensus", "consensus"), ("Conflicts", "conflicts")):
        items = s.get(key) or []
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
