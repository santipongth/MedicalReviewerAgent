"""Rebuild the landing page's sample (frontend/src/data/landing-sample.json) from a finished review.

Usage: python scripts/landing_sample.py <review.json> > frontend/src/data/landing-sample.json
<review.json> is the body of GET /api/v1/reviews/{id}. Only the MACE outcome of the chosen papers is kept (plus
P1's blanked recurrent-MI value, which the page shows as a gap); numbers are copied, never edited.
frontend/src/lib/landing-sample.test.ts fails if any shown number is not found verbatim in its quote.
"""
from __future__ import annotations

import json
import sys

KEEP = {  # ref -> English outcome-name prefixes to keep, in order
    "P1": ("Major Adverse Cardiovascular Events", "Recurrent myocardial infarction"),
    "P2": ("Major Adverse Cardiovascular Events",),
    "P4": ("Major Adverse Cardiovascular Events",),
    "P5": ("Major Adverse Cardiovascular Events",),
    "P8": ("Major Adverse Cardiovascular Events",),
    "P10": ("Major Adverse Cardiovascular Events",),
    "P11": ("Major Adverse Cardiovascular Events",),
    "P15": ("Major Adverse Cardiovascular Events",),
}
PAPER_FIELDS = ("ref", "title", "journal", "year", "doi", "pmid", "url", "relevance")
CARD_FIELDS = ("study_design", "design_category", "population", "sample_size", "sample_size_quote",
               "intervention_or_exposure", "comparator", "risk_of_bias", "overall_direction")


def trim(card: dict, indexes: list[int]) -> dict:
    out = {k: card.get(k) for k in CARD_FIELDS}
    out.update(outcomes=[card["outcomes"][i] for i in indexes], key_findings=[], limitations=[])
    return out


def main(path: str) -> None:
    review = json.load(open(path, encoding="utf-8"))
    result = review["result"]
    papers = []
    for p in result["papers"]:
        prefixes = KEEP.get(p["ref"])
        if not prefixes:
            continue
        en = p["card_en"]
        indexes = [i for prefix in prefixes for i, o in enumerate(en["outcomes"]) if o["outcome"].startswith(prefix)]
        names = {en["outcomes"][i]["outcome"] for i in indexes}
        verification = dict(p["verification"])
        verification["unverified"] = [u for u in verification.get("unverified") or []
                                      if u["field"] == "sample_size" or u["outcome"] in names]
        papers.append({**{k: p.get(k) for k in PAPER_FIELDS}, "card": trim(p["card"], indexes),
                       "card_en": trim(en, indexes), "verification": verification})
    quality = result.get("quality") or {}
    sample = {
        "topic": review["topic"],
        "capturedAt": review["created_at"],
        "question": result["question"]["refined_question"],
        "stats": result["stats"],
        "quality": {k: quality.get(k) for k in ("numbers_verified", "numbers_total", "verification_rate")},
        "papers": papers,
    }
    json.dump(sample, sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main(sys.argv[1])
