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
    primary = [c for c in cards if c.get("design_category") not in POOLED_CATEGORIES]
    if pooled:
        # Systematic reviews / meta-analyses usually already contain the primary studies found alongside them, so the
        # body of evidence is graded from the pooled tier instead of counting both as independent.
        overlap = f"; {len(primary)} primary stud(ies) may overlap with them" if primary else ""
        factors.append(f"graded from pooled evidence: {len(pooled)} systematic review(s)/meta-analysis(es){overlap}")
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
    source = "total sample size"
    if pooled and total_n == 0:
        # A missing pooled n must never grade higher than a reported small one: judge from the primary studies the
        # reviews pool (a lower bound), and call it imprecise when nothing reports a sample size at all.
        total_n = sum(c.get("sample_size") or 0 for c in primary)
        source = "pooled sample sizes not reported; primary studies' total sample size"
    if total_n == 0:
        level -= 1
        factors.append("imprecision: sample sizes not reported in the abstracts")
    elif total_n < 400:
        level -= 1
        factors.append(f"imprecision: {source} {total_n}")
    elif source != "total sample size":
        factors.append(f"precision judged from the primary studies: {source} {total_n}")
    return {"level": LEVELS[max(level, 0)], "factors": factors}


HIGH_HETEROGENEITY_I2 = 50.0


def apply_meta_grade(grade: dict[str, Any], pools: list[dict[str, Any]],
                     outcome: str | None) -> tuple[dict[str, Any], list[str]]:
    """Meta-analysis only: adjust the GRADE-lite baseline from the pools that report the primary outcome.
    Inconsistency: any such pool with I2 >= 50%. Imprecision: any such pool whose 95% CI includes no effect (1 for
    ratio measures, 0 for differences; i.e. 0 on the analysis scale). Each domain is downgraded at most once: when the
    baseline already downgraded it (conflicting directions, small total n), the reason is recorded without another
    level. Returns (grade, the reason strings added). The reasons carry no pooled numbers."""
    if not pools:
        return grade, []
    level = LEVELS.index(grade.get("level", "very_low"))
    factors = list(grade.get("factors") or [])
    added: list[str] = []
    checks = (
        ("inconsistency", any(p["i2"] >= HIGH_HETEROGENEITY_I2 for p in pools),
         f"substantial heterogeneity (I2 >= 50%) in the pooled analysis of {outcome}"),
        ("imprecision", any(p["pooled"]["y_ci_lower"] <= 0.0 <= p["pooled"]["y_ci_upper"] for p in pools),
         f"the pooled 95% CI for {outcome} includes no effect"),
    )
    for domain, hit, reason in checks:
        if not hit:
            continue
        if any(f.startswith(f"{domain}:") for f in factors):
            text = f"{domain} (pooled analysis, already downgraded): {reason}"
        else:
            level -= 1
            text = f"{domain}: {reason}"
        factors.append(text)
        added.append(text)
    return {**grade, "level": LEVELS[max(level, 0)], "factors": factors}, added


def clamp_to_baseline(chosen: str, baseline: str) -> str:
    """Allow the narrative model to move at most one level away from the deterministic baseline."""
    b, c = LEVELS.index(baseline), LEVELS.index(chosen)
    return LEVELS[min(max(c, b - 1), b + 1)]
