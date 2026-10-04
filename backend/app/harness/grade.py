"""GRADE-lite baseline computed from the evidence cards; the LLM may only move it by one level."""
from __future__ import annotations

import re
from typing import Any

from app.harness.design import POOLED_CATEGORIES

LEVELS = ("very_low", "low", "moderate", "high")
RANDOMIZED = ("randomi", "rct", "controlled trial", "meta-analysis of randomized")
NOT_RANDOMIZED = re.compile(r"non[- ]?randomi|quasi|observational|uncontrolled|single[- ]arm", re.IGNORECASE)


def is_randomized(card: dict[str, Any]) -> bool:
    """By the fixed design category when the card has one; older cards fall back to their free-text design."""
    category = card.get("design_category")
    if category:
        return category in ("rct", "sr_ma_rct")
    design = (card.get("study_design") or "").lower()
    return not NOT_RANDOMIZED.search(design) and any(k in design for k in RANDOMIZED)


def grade_baseline(papers: list[dict[str, Any]], matrix: dict[str, Any]) -> dict[str, Any]:
    cards = [p["card"] for p in papers if p.get("card")]
    if not cards:
        return {"level": "very_low", "factors": ["no extracted studies"]}
    factors: list[str] = []
    pooled = [c for c in cards if c.get("design_category") in POOLED_CATEGORIES]
    if pooled:
        # Systematic reviews / meta-analyses usually already contain the primary studies found alongside them, so the
        # body of evidence is graded from the pooled tier instead of counting both as independent.
        factors.append(f"graded from pooled evidence: {len(pooled)} systematic review(s)/meta-analysis(es); "
                       f"{len(cards) - len(pooled)} primary stud(ies) may overlap with them")
        cards = pooled
    randomized = sum(1 for c in cards if is_randomized(c))
    if randomized / len(cards) > 0.5:
        level = LEVELS.index("high")
        factors.append(f"start high: {randomized}/{len(cards)} randomized studies")
    else:
        level = LEVELS.index("low")
        factors.append(f"start low: {len(cards) - randomized}/{len(cards)} non-randomized studies")
    high_rob = sum(1 for c in cards if c.get("risk_of_bias") == "high")
    if high_rob / len(cards) >= 0.34:
        level -= 1
        factors.append(f"risk of bias: {high_rob}/{len(cards)} studies at high risk")
    if matrix.get("conflicts"):
        level -= 1
        factors.append(f"inconsistency: {len(matrix['conflicts'])} outcome(s) with conflicting directions")
    dissenting = [c for c in matrix.get("consensus", []) if c.get("dissent")]
    if dissenting:  # a small minority disagreeing is reported, not downgraded
        factors.append(f"minor inconsistency: {len(dissenting)} outcome(s) with a dissenting minority")
    total_n = sum(c.get("sample_size") or 0 for c in cards)
    if pooled and total_n == 0:
        factors.append("imprecision not assessed: pooled sample sizes not reported in the abstracts")
    elif total_n < 400:
        level -= 1
        factors.append(f"imprecision: total sample size {total_n}")
    return {"level": LEVELS[max(level, 0)], "factors": factors}


def clamp_to_baseline(chosen: str, baseline: str) -> str:
    """Allow the narrative model to move at most one level away from the deterministic baseline."""
    b, c = LEVELS.index(baseline), LEVELS.index(chosen)
    return LEVELS[min(max(c, b - 1), b + 1)]
