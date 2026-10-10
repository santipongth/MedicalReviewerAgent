"""GRADE-lite baseline computed from the evidence cards; the LLM may only move it by one level."""
from __future__ import annotations

import re
from typing import Any

from app.harness.design import NON_QUANTITATIVE_CATEGORIES, POOLED_CATEGORIES
from app.harness.matrix import ci_includes_null, classify_row
from app.harness.meta import (
    DESIGN_GROUP_LABEL,
    HIGH_I2,
    pick_outcome,
    pool_outcomes,
    primary_outcome,
)

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


IMPRECISE_N = 400  # GRADE's rule-of-thumb optimal information size (participants)
NOT_ASSESSED = ("not assessed in GRADE-lite: indirectness, publication bias and upgrades for observational "
                "evidence")
DOWNGRADE_DOMAINS = ("risk of bias", "inconsistency", "imprecision")


def _n(card: dict[str, Any]) -> int:
    n = card.get("sample_size")
    return n if isinstance(n, int) and n > 0 else 0


def primary_row(matrix: dict[str, Any], question_outcomes: list[str] | None,
                refs: set[str]) -> dict[str, Any] | None:
    """The matrix row GRADE-lite judges: among the rows with a cell from the graded studies (`refs`), the one that
    answers the question's first outcome (fuzzy, >= 80), else the one with the most graded studies."""
    rows = [r for r in matrix.get("rows") or [] if any(c["ref"] in refs for c in r.get("cells") or [])]
    if not rows:
        return None
    names = [r["outcome"] for r in rows]
    weights = {r["outcome"]: len({c["ref"] for c in r["cells"] if c["ref"] in refs}) for r in rows}
    name = pick_outcome(names, weights, question_outcomes)
    return next(r for r in rows if r["outcome"] == name)


def grade_baseline(papers: list[dict[str, Any]], matrix: dict[str, Any], question_outcomes: list[str] | None = None,
                   directional: bool = True) -> dict[str, Any]:
    """GRADE-lite baseline (Plan 19, audit I-13; methodology review fix round 1), deterministic and judged on the
    primary outcome (the matrix row answering the question's first outcome, else the row with the most studies):
    - Start tier from the best design with evidence on that outcome: any randomized evidence there (a primary RCT or
      an SR/MA of RCTs) starts high and the graded body is those randomized studies; otherwise it starts low and the
      body is the outcome's primary studies (its SR/MAs when it has none). The other studies are reported, not graded
      again; an observational or mixed SR/MA never lowers a body of RCTs. Without any matrix row, all cards are used.
    - Risk of bias: >= 34 % of the graded body at high risk.
    - Inconsistency: `classify_row` over the body's cells of the primary outcome. A conflict (a significant study on
      each side of no effect, or non-overlapping CIs) downgrades; a non-significant estimate on the other side, an
      SR/MA disagreeing with primary studies, or a dissenting minority is "minor inconsistency" (not downgraded).
      Conflicts in other outcomes are reported, not downgraded. Not assessable for a one-study body; not assessed
      when the question has no effect direction.
    - Imprecision: the outcome's sample size (the body's primary studies summed, or the largest same-tier SR/MA in
      the row, whichever is larger: an SR/MA's n already includes its studies) < 400 or not reported; and, for a
      one-study body, a 95% CI that includes no effect, or a non-significant result without a CI; and (Plan 20 Task
      10) a body of one primary study, which is not replicated (at most one imprecision downgrade in all).
    Downgrade factors start with their domain and a colon ("risk of bias:", "inconsistency:", "imprecision:")."""
    # qualitative/mixed-methods cards are themes, never graded evidence (callers pass _evidence; this is a guard)
    cards = {p.get("ref") or f"#{i}": p["card"] for i, p in enumerate(papers)
             if p.get("card") and p["card"].get("design_category") not in NON_QUANTITATIVE_CATEGORIES}
    if not cards:
        return {"level": "very_low", "factors": ["no extracted studies"]}
    factors: list[str] = []
    pooled = {r for r, c in cards.items() if c.get("design_category") in POOLED_CATEGORIES}
    primary = set(cards) - pooled
    randomized = {r for r in cards if is_randomized(cards[r])}
    row = primary_row(matrix, question_outcomes, set(cards))
    name = row["outcome"] if row else None
    where = f"the primary outcome {name}" if row else "the graded studies"
    scope = {c["ref"] for c in row["cells"]} & set(cards) if row else set(cards)
    if scope & randomized:
        body = scope & randomized
        high = True
        level = LEVELS.index("high")
        rest = len(scope - body)
        factors.append(f"start high: randomized evidence for {where}: {len(body & primary)} randomized trial(s), "
                       f"{len(body & pooled)} systematic review(s)/meta-analysis(es) of randomized trials"
                       + (f"; {rest} non-randomized stud(ies) reported, not graded" if rest else ""))
    else:
        body = (scope & primary) or (scope & pooled)
        high = False
        level = LEVELS.index("low")
        factors.append(f"start low: {len(body)}/{len(body)} primary studies non-randomized" if body & primary else
                       f"start low: graded from pooled evidence: {len(body)} systematic review(s)/meta-analysis(es), "
                       f"{len(body)}/{len(body)} not of randomized trials")
    corroborating = (scope & pooled) - body
    if corroborating and body & primary:
        factors.append(f"{len(corroborating)} systematic review(s)/meta-analysis(es) corroborate; they may overlap "
                       f"with the primary studies, so they are not graded again")
    high_rob = sum(1 for r in body if cards[r].get("risk_of_bias") == "high")
    if high_rob / len(body) >= 0.34:
        level -= 1
        factors.append(f"risk of bias: {high_rob}/{len(body)} graded studies at high risk")

    single = len(body) == 1
    what = "review" if body & pooled else "study"
    body_cells = [c for c in row["cells"] if c["ref"] in body] if row else []
    if not directional:
        factors.append("inconsistency not assessed: the question has no effect direction")
    elif single:
        factors.append(f"inconsistency not assessable: one {what} for {where} (an abstract gives no between-study "
                       f"spread)")
    elif row:
        verdict = classify_row(body_cells)
        kind = verdict["verdict"]
        if kind == "conflict" and not verdict.get("review_discordant"):
            level -= 1
            factors.append(f"inconsistency: studies on opposite sides of no effect for {where}")
        elif kind == "imprecise" and verdict.get("opposite_sides"):
            factors.append(f"minor inconsistency: a non-significant estimate on the other side of no effect for "
                           f"{where} (overlapping evidence, not downgraded)")
        elif verdict.get("review_discordant"):  # imprecise, a conflict or a flagged consensus (Plan 20 Task 10)
            factors.append(f"minor inconsistency: systematic reviews and primary studies point different ways for "
                           f"{where} (they likely overlap, not downgraded)")
        elif kind == "consensus" and (verdict.get("dissent") or verdict.get("discordant_reviews")):
            factors.append(f"minor inconsistency: a dissenting minority for {where}")
        elif kind == "imprecise":
            factors.append(f"mixed significance for {where}: non-significant results without opposite effects are "
                           f"imprecision, not inconsistency")
    split = f"minor inconsistency: systematic reviews and primary studies point different ways for {where}"
    if directional and row and not any(f.startswith(split) for f in factors) and any(
            c.get("outcome") == name and c.get("review_discordant")
            for c in [*(matrix.get("conflicts") or []), *(matrix.get("consensus") or [])]):
        # Plan 20 Task 10: the reviews are outside the graded body, but their disagreement is reported
        factors.append(f"{split} (they likely overlap, not downgraded)")
    others = [c for c in matrix.get("conflicts") or [] if c.get("outcome") != name] if directional else []
    if others:
        factors.append(f"conflicting directions in {len(others)} other outcome(s): reported, not graded (GRADE-lite "
                       f"judges the primary outcome)")

    # SR/MAs of the same tier inform precision (an SR of RCTs for a randomized body; any SR for a low start); a
    # randomized body is never made precise by non-randomized participants
    tier_pooled = body & pooled if high else scope & pooled
    n = max(sum(_n(cards[r]) for r in scope & primary & body),
            max((_n(cards[r]) for r in scope & tier_pooled), default=0))
    imprecise = False
    if n == 0:
        level -= 1
        imprecise = True
        factors.append(f"imprecision: sample sizes for {where} not reported in the abstracts")
    elif n < IMPRECISE_N:
        level -= 1
        imprecise = True
        factors.append(f"imprecision: sample size for {where} {n}")
    if single and directional and body_cells:
        ci_null = [ci_includes_null(c) for c in body_cells]
        if any(v is True for v in ci_null):
            reason = f"the single graded {what}'s 95% CI for {where} includes no effect"
        elif all(v is None for v in ci_null) and any(c.get("direction") == "null" for c in body_cells):
            reason = f"the single graded {what} reports no significant effect for {where} and no CI"
        else:
            reason = ""
        if reason and imprecise:
            factors.append(f"imprecision (already downgraded): {reason}")
        elif reason:
            level -= 1
            imprecise = True
            factors.append(f"imprecision: {reason}")
    if single and what == "study":
        # Plan 20 Task 10 (the SGLT2 re-run graded "high" from one trial per outcome): a single primary study is not
        # replicated, and its optimal information size cannot be judged from an abstract, so it is downgraded once
        # (a single SR/MA already combines several studies and is not)
        text = f"one study for {where} (k = 1): its estimate is not replicated by another study"
        if imprecise:
            factors.append(f"imprecision (already downgraded): {text}")
        else:
            level -= 1
            factors.append(f"imprecision: {text}")
    factors.append(NOT_ASSESSED)
    # k: the graded body on the primary outcome; studies: every graded card (the rationale may cite either count)
    return {"level": LEVELS[max(level, 0)], "factors": factors, "k": len(body), "studies": len(cards)}


# ---- the narrative's rationale must agree with the factors (audit I-13e) -------------------------
_DOMAIN_WORDS = {
    "risk of bias": re.compile(r"\bbias", re.IGNORECASE),
    "inconsistency": re.compile(r"inconsisten|heterogene|conflict|disagree|opposite", re.IGNORECASE),
    "imprecision": re.compile(r"imprecis|precision|sample size|small (sample|stud|trial)|few (participant|patient)|"
                              r"wide (95% )?(confidence )?interval|not reported", re.IGNORECASE),
}
# A stated starting level: the level right after "at/as/from (a)", or followed by certainty/quality/level, and never
# a level that describes something else ("from cohorts with high risk of bias").
_LEVEL = r"(very low|high|moderate|low)"
_START = re.compile(r"\b(?:start(?:s|ed|ing)?|begin(?:s|ning)?|began|initial(?:ly)?)\b[^.;]{0,40}?"
                    rf"(?:\b(?:at|as|from)\s+(?:an?\s+)?{_LEVEL}\b(?!\s+risk)|\b{_LEVEL}\s+(?:certainty|quality|level))",
                    re.IGNORECASE)


def downgraded_domains(factors: list[str]) -> list[str]:
    return [d for d in DOWNGRADE_DOMAINS if any(f.startswith(f"{d}:") for f in factors)]


# Claims the data must back (Plan 20 Task 10: the SGLT2 re-run's rationale said "three randomized controlled trials
# ... narrow confidence intervals ... consistent" while each outcome had one trial). A count of studies must be the
# graded body on the primary outcome (`k`) or the number of graded studies; consistency or agreement across studies
# needs more than one study on the primary outcome.
_NUMBER_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9,
                 "ten": 10, "eleven": 11, "twelve": 12, "a single": 1, "single": 1}
_STUDY_COUNT = re.compile(
    r"(?<![\d,.])(?<!phase )\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|a single|"
    r"single)\s+(?:(?!patients|participants|people|adults|subjects|years?|months?|weeks?|days?|of\b|in\b)"
    r"[A-Za-z-]+\s+){0,3}?(?:trials?|studies|study|rcts?)\b", re.IGNORECASE)
# "consistent with ..." compares with something else and is no claim about the studies' agreement
_CONSISTENCY_CLAIM = re.compile(r"\b(?:consistent(?:ly)?|consistency)\b(?![^.]{0,20}\bwith\b)|"
                                r"\bacross (?:the |all |both |several |multiple |different |\w+ )?"
                                r"(?:trials|studies|rcts)\b|\breplicated\b", re.IGNORECASE)
_SENTENCE = re.compile(r"(?<=[.!?])\s+")


def _overclaims(sentence: str, factors: list[str], k: int | None, studies: int | None) -> list[str]:
    problems = []
    single = any(f.startswith("inconsistency not assessable") for f in factors)
    if single and _CONSISTENCY_CLAIM.search(sentence) and not re.search(r"not assess|cannot be assessed|single",
                                                                        sentence, re.IGNORECASE):
        problems.append("evidence_rationale claims consistency across studies, but the primary outcome has one study "
                        "(inconsistency not assessable)")
    if k is not None:
        allowed = {k, studies} - {None}
        for m in _STUDY_COUNT.finditer(sentence):
            word = m.group(1).lower()
            n = int(word) if word.isdigit() else _NUMBER_WORDS[word]
            if n not in allowed:
                problems.append(f"evidence_rationale counts {n} studies, but the graded body has {k} on the primary "
                                f"outcome ({studies} graded in all)")
    return problems


def rationale_problems(rationale: str, factors: list[str], k: int | None = None,
                       studies: int | None = None) -> list[str]:
    """Where the narrative's evidence_rationale disagrees with the GRADE-lite factors: a different starting level,
    a downgraded domain it never mentions, or (Plan 20 Task 10) a claim the data do not show: a count of studies
    that is neither `k` (the graded body on the primary outcome) nor `studies` (all graded), or consistency across
    studies when the primary outcome has one study."""
    problems: list[str] = []
    start = next((f.split(":")[0].removeprefix("start ").strip() for f in factors if f.startswith("start ")), None)
    match = _START.search(rationale or "")
    said = (match.group(1) or match.group(2)).lower() if match else None
    if start and said and said != start:
        problems.append(f"evidence_rationale says the rating starts at {said}, but the GRADE-lite factors start at "
                        f"{start}")
    for domain in downgraded_domains(factors):
        if not _DOMAIN_WORDS[domain].search(rationale or ""):
            problems.append(f"evidence_rationale must explain the {domain} downgrade listed in the GRADE-lite factors")
    for sentence in _SENTENCE.split(rationale or ""):
        problems += _overclaims(sentence, factors, k, studies)
    return problems


def reconcile_rationale(rationale: str, factors: list[str], k: int | None = None,
                        studies: int | None = None) -> tuple[str, str | None]:
    """The rationale shown with the grade, made to agree with the factors in code when the model's did not:
    sentences with a claim the data do not show are removed (Plan 20 Task 10); then a contradicting starting level, or
    nothing left, replaces it with the factors, and a missing downgrade is appended from the factors.
    Returns (rationale, "replaced" | "appended" | "trimmed" | None)."""
    sentences = _SENTENCE.split(rationale or "")
    kept = [s for s in sentences if not _overclaims(s, factors, k, studies)]
    trimmed = len(kept) != len(sentences)
    rationale = " ".join(kept) if trimmed else rationale
    problems = rationale_problems(rationale, factors)
    if not problems:
        if trimmed and not rationale.strip():
            return "; ".join(factors), "replaced"
        return rationale, "trimmed" if trimmed else None
    if not rationale.strip() or any("starts at" in p for p in problems):
        return "; ".join(factors), "replaced"
    missing = [f for f in factors if any(f.startswith(f"{d}:") for d in downgraded_domains(factors))
               and not _DOMAIN_WORDS[f.split(":")[0]].search(rationale)]
    return f"{rationale.rstrip()} GRADE-lite downgrades: {'; '.join(missing)}.", "appended"


def grading_pools(pools: list[dict[str, Any]], outcome: str | None) -> tuple[str | None, list[dict[str, Any]]]:
    """The pools GRADE-lite judges: those of the primary outcome from the best design group. GRADE starts from the
    best available design, so the RCT pools are used when at least one exists, else the observational ones; a
    heterogeneous observational pool then never lowers a body of evidence anchored on consistent RCTs.
    Returns (design group, its pools of that outcome; several when several measures were pooled)."""
    mine = [p for p in pools if p.get("outcome") == outcome]
    for group in ("rct", "observational"):
        chosen = [p for p in mine if p.get("design_group") == group]
        if chosen:
            return group, chosen
    return None, []


def apply_meta_grade(grade: dict[str, Any], pools: list[dict[str, Any]], outcome: str | None,
                     group: str | None = None) -> tuple[dict[str, Any], list[str]]:
    """Meta-analysis only: adjust the GRADE-lite baseline from the pools chosen by `grading_pools` (one design
    group of the primary outcome). Inconsistency: any of them with I2 >= 50%. Imprecision: any of them whose 95% CI
    includes no effect (1 for ratio measures, 0 for differences; i.e. 0 on the analysis scale). Each domain is
    downgraded at most once: when the baseline already downgraded it (conflicting directions, small total n), the
    reason is recorded without another level. The baseline judges inconsistency and imprecision on its primary matrix
    row (Plan 19), which is the same outcome as the pooled primary outcome whenever the question names it; when the
    two differ, a baseline downgrade can still absorb the pooled one (accepted for GRADE-lite).
    Returns (grade, the reason strings added). The reasons carry no pooled numbers."""
    if not pools:
        return grade, []
    what = f"{outcome} ({DESIGN_GROUP_LABEL.get(group, group)})" if group else f"{outcome}"
    level = LEVELS.index(grade.get("level", "very_low"))
    factors = list(grade.get("factors") or [])
    added: list[str] = []
    checks = (
        ("inconsistency", any(p["i2"] >= HIGH_I2 for p in pools),
         f"substantial heterogeneity (I2 >= 50%) in the pooled analysis of {what}"),
        ("imprecision", any(p["pooled"]["y_ci_lower"] <= 0.0 <= p["pooled"]["y_ci_upper"] for p in pools),
         f"the pooled 95% CI for {what} includes no effect"),
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


def analyse_meta(matrix: dict[str, Any], papers: list[dict[str, Any]], question_outcomes: list[str] | None,
                 baseline: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """The one pool -> primary outcome -> GRADE-lite sequence, used by the pool_effects node and the timed stub.
    Returns (meta_analysis with `grade`, the adjusted grade). Raises on an unexpected shape; callers decide."""
    meta = pool_outcomes(matrix, papers)
    outcome = primary_outcome(meta, question_outcomes)
    group, pools = grading_pools(meta["pools"], outcome)
    grade, reasons = apply_meta_grade(baseline, pools, outcome, group)
    meta["grade"] = {"primary_outcome": outcome, "design_group": group, "reasons": reasons}
    return meta, grade


def clamp_to_baseline(chosen: str, baseline: str) -> str:
    """Allow the narrative model to move at most one level away from the deterministic baseline."""
    b, c = LEVELS.index(baseline), LEVELS.index(chosen)
    return LEVELS[min(max(c, b - 1), b + 1)]
