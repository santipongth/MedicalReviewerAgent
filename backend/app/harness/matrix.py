"""Deterministic evidence matrix: the structured part of the synthesis is built by code, not by the LLM."""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import Any

from app.graph.schemas import OutcomeCluster, OutcomeClusters, OutcomeMember
from app.harness.design import POOLED_CATEGORIES
from app.services.text import normalize_title

DIRECTIONS = ("positive", "negative", "null")
# A row is consensus when at least this share of its studies (and at least 3 of them) report the same direction;
# the rest are listed as dissent. Below it, studies on opposite sides of no effect make a conflict (classify_row).
CONSENSUS_SHARE = 0.7
CONSENSUS_MIN_STUDIES = 3


def _ref_num(ref: str) -> int:
    return int(ref[1:]) if ref[1:].isdigit() else 10**6


def outcome_pairs(papers: list[dict[str, Any]]) -> list[tuple[str, str]]:
    return [(p["ref"], o["outcome"]) for p in papers if p.get("card") for o in p["card"]["outcomes"]]


# ---- deterministic pre-clustering (audit I-17: the LLM normaliser over ~100 pairs took 71 s) -----------------
_STOPWORDS = frozenset({"of", "the", "a", "an", "for"})
# Words that make order meaningful ("stroke in diabetes" is not "diabetes in stroke", "HF hospitalization or CV
# death" is not "CV hospitalization or HF death"): with any of them the word order is kept.
_RELATIONAL = frozenset({"after", "before", "vs", "versus", "than", "from", "to", "between", "during", "within",
                         "in", "on", "at", "with", "without", "and", "or"})
_SPELLING = ((re.compile(r"isation"), "ization"), (re.compile(r"ise\b"), "ize"), (re.compile(r"ae"), "e"),
             (re.compile(r"oe"), "e"), (re.compile(r"(?<=\w{2})our\b"), "or"))  # tumour, not four/hour


def _word(w: str) -> str:
    for pattern, repl in _SPELLING:  # British vs American spelling: haemorrhage/hemorrhage, tumour/tumor
        w = pattern.sub(repl, w)
    return w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w  # plural


def outcome_key(name: str) -> str:
    """Identity of an outcome name up to case, punctuation, British/American spelling, plurals, filler words and
    (when no relational word is present) word order: "Incidence of colorectal cancer" == "colorectal cancer
    incidence", "HF hospitalisations" == "hf hospitalization". Different words never share a key, so "LDL
    cholesterol" and "HDL cholesterol" stay apart."""
    raw = (normalize_title(name) or name.strip().lower()).split()
    # stopwords are judged on the raw word, before the spelling rules ("four" never becomes the filler "for")
    words = [_word(w) for w in raw if w not in _STOPWORDS] or [_word(w) for w in raw]
    if any(w in _RELATIONAL for w in raw):
        return " ".join(words)
    return " ".join(sorted(set(words)))


def precluster(pairs: list[tuple[str, str]]) -> list[list[tuple[str, str]]]:
    """Group (ref, outcome) pairs whose names share an outcome_key, in first-seen order."""
    groups: dict[str, list[tuple[str, str]]] = {}
    for pair in pairs:
        groups.setdefault(outcome_key(pair[1]), []).append(pair)
    return list(groups.values())


def expand_clusters(clusters: OutcomeClusters, groups: list[list[tuple[str, str]]]) -> OutcomeClusters:
    """The LLM clustered one representative pair per pre-cluster: give each representative's cluster the whole
    pre-cluster. Members that are not representatives are kept as they are."""
    by_rep = {g[0]: g for g in groups}
    out = []
    for c in clusters.clusters:
        members = []
        for m in c.members:
            for ref, outcome in by_rep.get((m.ref, m.outcome), [(m.ref, m.outcome)]):
                members.append(OutcomeMember(ref=ref, outcome=outcome))
        out.append(OutcomeCluster(canonical=c.canonical, members=members))
    return OutcomeClusters(clusters=out)


def preclustered(groups: list[list[tuple[str, str]]]) -> OutcomeClusters:
    """The pre-clusters as the final clustering (when there is nothing left for the LLM to group)."""
    return OutcomeClusters(clusters=[OutcomeCluster(canonical=g[0][1], members=[OutcomeMember(ref=r, outcome=o)
                                                                                 for r, o in g]) for g in groups])


def validate_clusters(clusters: OutcomeClusters, papers: list[dict[str, Any]],
                      pairs: list[tuple[str, str]] | None = None) -> list[str]:
    """`pairs`: the pairs the model was given (the pre-cluster representatives); default all of the papers'."""
    expected = Counter(outcome_pairs(papers) if pairs is None else pairs)
    seen = Counter((m.ref, m.outcome) for c in clusters.clusters for m in c.members)
    problems = [f"missing outcome {ref}: {outcome}" for (ref, outcome) in expected if (ref, outcome) not in seen]
    problems += [f"{ref}: {outcome} is assigned more than once" for (ref, outcome), n in seen.items() if n > 1]
    problems += [f"unknown member {ref}: {outcome} (not an outcome of that paper)"
                 for (ref, outcome) in seen if (ref, outcome) not in expected]
    problems += [f"cluster #{i + 1} has an empty canonical name" for i, c in enumerate(clusters.clusters)
                 if not c.canonical.strip()]
    return problems


def repair_clusters(clusters: OutcomeClusters, papers: list[dict[str, Any]],
                    pairs: list[tuple[str, str]] | None = None) -> tuple[OutcomeClusters, int, int]:
    """Deterministically fix a near-miss clustering instead of discarding it: drop unknown members, keep the first
    of duplicate assignments, name unnamed clusters after their first member, and put missing outcomes into the
    cluster whose name (or a member) matches their normalized name, else into their own cluster.
    Returns (clusters, corrections, members kept from the model)."""
    expected = outcome_pairs(papers) if pairs is None else pairs
    valid = set(expected)
    seen: set[tuple[str, str]] = set()
    fixed: list[OutcomeCluster] = []
    corrections = kept = 0
    for cluster in clusters.clusters:
        members = []
        for m in cluster.members:
            pair = (m.ref, m.outcome)
            if pair in valid and pair not in seen:
                seen.add(pair)
                members.append(OutcomeMember(ref=m.ref, outcome=m.outcome))
            else:
                corrections += 1
        if not members:
            continue
        canonical = cluster.canonical.strip()
        if not canonical:
            canonical, corrections = members[0].outcome, corrections + 1
        kept += len(members)
        fixed.append(OutcomeCluster(canonical=canonical, members=members))

    def key(text: str) -> str:
        return normalize_title(text) or text.lower()

    for ref, outcome in expected:
        if (ref, outcome) in seen:
            continue
        corrections += 1
        seen.add((ref, outcome))
        k = key(outcome)
        home = next((c for c in fixed if key(c.canonical) == k or any(key(m.outcome) == k for m in c.members)), None)
        if home is None:
            home = OutcomeCluster(canonical=outcome, members=[])
            fixed.append(home)
        home.members.append(OutcomeMember(ref=ref, outcome=outcome))
    return OutcomeClusters(clusters=fixed), corrections, kept


def fallback_clusters(papers: list[dict[str, Any]]) -> OutcomeClusters:
    groups: dict[str, OutcomeCluster] = {}
    for ref, outcome in outcome_pairs(papers):
        key = normalize_title(outcome) or outcome
        cluster = groups.setdefault(key, OutcomeCluster(canonical=outcome, members=[]))
        cluster.members.append(OutcomeMember(ref=ref, outcome=outcome))
    return OutcomeClusters(clusters=list(groups.values()))


RATIO_MEASURES = frozenset({"HR", "OR", "RR"})
DIFFERENCE_MEASURES = frozenset({"RD", "MD", "SMD", "r"})
# Literal placeholders a model writes instead of a finding; never shown as a row, a cell or a research gap.
_PLACEHOLDER = re.compile(r"^\W*(null|none|nil|n/?a|not (reported|applicable|available)|unknown|-+)?\W*$",
                          re.IGNORECASE)


def is_placeholder(text: Any) -> bool:
    return not isinstance(text, str) or bool(_PLACEHOLDER.match(text))


def effect_side(cell: dict[str, Any]) -> int | None:
    """Which side of no effect the point estimate lies on: -1 below, +1 above, 0 on it, None when unknown (no
    estimate, or a measure whose no-effect value is unknown, e.g. "other")."""
    value, measure = cell.get("effect_value"), cell.get("effect_measure")
    if not isinstance(value, int | float):
        return None
    if measure in RATIO_MEASURES:
        return None if value <= 0 else (value > 1) - (value < 1)
    if measure in DIFFERENCE_MEASURES:
        return (value > 0) - (value < 0)
    return None


def classify_row(cells: list[dict[str, Any]]) -> dict[str, Any]:
    """Consensus, conflict or imprecision of one outcome row, by the SIDE of the effect, not by significance
    (audit I-11). Each study leans to the hypothesised side ("positive"), the opposite side ("negative"), or neither:
    - a `positive`/`negative` cell leans its way;
    - a `null` (non-significant) cell leans by its point estimate when the significant cells being counted fix which
      side of no effect is "positive" (e.g. positive cells all have HR < 1); otherwise, or with no estimate, it leans
      neither. Cells set aside (below) never fix that orientation;
    - `mixed`/`unclear` cells are ignored.
    Systematic reviews/meta-analyses (`pooled`) usually contain the row's primary studies, so the primary studies
    decide first: when they alone reach a consensus or a conflict, the pooled cells only corroborate
    (`corroborating`) or are named as `discordant_reviews`; they are never counted twice and never a conflict
    against their own studies as independent studies. Only when the primary studies alone reach no verdict (too few,
    or imprecise) does each SR/MA count as one study; a split that then runs exactly between SR/MA cells on one side
    and primary cells on the other is the footprint of a review and its own trials disagreeing on abstracts: it is
    never decided by a majority, and is `imprecise` with `review_discordant`.
    Plan 20 Task 10: such splits are shown. A real one (a significant study on each side, or non-overlapping CIs; HR,
    RR and OR compared with each other) is a `conflict` flagged `review_discordant`, so the conflict explainer runs,
    and so is a primary consensus that significant SR/MAs contradict (see _review_check); without a real split that
    consensus stands, flagged `review_discordant`. GRADE-lite never downgrades for a `review_discordant` split.
    Verdicts:
    - `conflict`: studies on opposite sides of no effect, with a significant study on each side or with 95% CIs of
      the two sides that do not overlap (same measure), and no >= 70 % majority of >= 3 studies; or a real
      review-vs-primary split (`review_discordant`);
    - `consensus`: agreement in direction: one side only (>= 2 studies, any of them may be non-significant), or a
      >= 70 % majority of >= 3 studies with the rest listed as dissent; or >= 2 studies that all show no effect;
    - `imprecise`: significant and non-significant findings without a real split: on the same side or without a side,
      or a non-significant estimate on the other side whose CI overlaps (`opposite_sides`), or a review-discordant
      split (`review_discordant`);
    - `none`: fewer than two studies to compare."""
    usable = [c for c in cells if c.get("direction") in DIRECTIONS]
    primary = [c for c in usable if not c.get("pooled")]
    pooled = [c for c in usable if c.get("pooled")]
    if primary and pooled:
        first = _verdict(primary, pooled)
        if first["verdict"] == "consensus":
            return _review_check(first, primary, pooled)
        if first["verdict"] == "conflict":
            return first
        return _verdict(usable, [], pooled_refs={c["ref"] for c in pooled})
    return _verdict(usable, [])


def _review_check(consensus: dict[str, Any], primary: list[dict[str, Any]],
                  pooled: list[dict[str, Any]]) -> dict[str, Any]:
    """A primary-study consensus that statistically significant SR/MAs contradict (Plan 20 Task 10, the metformin
    re-run: two non-significant cohorts were reported as a "no association" consensus while five SR/MAs reported a
    significant benefit). The split runs between evidence types, so it is never counted as independent studies
    disagreeing (the reviews may contain the very same studies) and never downgrades the grade, but it is shown:
    - a real split, i.e. a significant review on the opposite side of a directional consensus, or a review's 95% CI
      that does not overlap a consensus study's (ratio measures HR/RR/OR are compared with each other here, an
      approximation for flagging, never for pooling), becomes a `conflict` with `review_discordant` (the conflict
      explainer runs);
    - otherwise the consensus stands, flagged `review_discordant`, with the reviews named in `discordant_reviews`.
    Non-significant discordant reviews only stay named in `discordant_reviews`, as before."""
    discordant = set(consensus.get("discordant_reviews") or [])
    against = [c for c in pooled if c["ref"] in discordant and c["direction"] in ("positive", "negative")]
    if not against:
        return consensus
    side = {"positive": 1, "negative": -1}.get(consensus["direction"], 0)
    counted = [c for c in primary if c["ref"] in set(consensus["refs"])]
    opposite = bool(side) and any((1 if c["direction"] == "positive" else -1) == -side for c in against)
    real = opposite or _cis_apart(counted, against, cross_ratio=True)
    if not real:
        return {**consensus, "review_discordant": True}
    review_dirs: dict[str, set[str]] = defaultdict(set)
    for c in against:
        review_dirs[c["direction"]].add(c["ref"])
    directions = {consensus["direction"]: list(consensus["refs"])}
    for d, refs in review_dirs.items():
        directions[d] = sorted(set(directions.get(d, [])) | refs, key=_ref_num)
    refs = sorted({*consensus["refs"], *(c["ref"] for c in against)}, key=_ref_num)
    significant = {c["ref"] for c in [*counted, *against] if c["direction"] != "null"}
    return {"verdict": "conflict", "refs": refs, "directions": directions,
            "nonsignificant": sorted(set(refs) - significant, key=_ref_num), "review_discordant": True}


def ci_includes_null(cell: dict[str, Any]) -> bool | None:
    """Whether the cell's 95% CI includes no effect (1 for ratios, 0 for differences); None when unknown."""
    lo, hi, measure = cell.get("ci_lower"), cell.get("ci_upper"), cell.get("effect_measure")
    if not isinstance(lo, int | float) or not isinstance(hi, int | float):
        return None
    null = 1.0 if measure in RATIO_MEASURES else 0.0 if measure in DIFFERENCE_MEASURES else None
    return None if null is None else lo <= null <= hi


def _cis_apart(a: list[dict[str, Any]], b: list[dict[str, Any]], cross_ratio: bool = False) -> bool:
    """Some cell of `a` and some cell of `b` with the same measure (with `cross_ratio`, any two of HR/RR/OR) have
    95% CIs that do not overlap."""
    def ci(c):
        lo, hi = c.get("ci_lower"), c.get("ci_upper")
        return (lo, hi) if isinstance(lo, int | float) and isinstance(hi, int | float) else None

    def comparable(c, d):
        m, n = c.get("effect_measure"), d.get("effect_measure")
        return m == n or (cross_ratio and m in RATIO_MEASURES and n in RATIO_MEASURES)
    return any(comparable(c, d) and ci(c) and ci(d)
               and (ci(c)[1] < ci(d)[0] or ci(d)[1] < ci(c)[0]) for c in a for d in b)


def _verdict(counted: list[dict[str, Any]], aside: list[dict[str, Any]],
             pooled_refs: set[str] | None = None) -> dict[str, Any]:
    """classify_row over `counted`; the `aside` (pooled) cells only corroborate or are named as discordant."""
    sides = {(s if c["direction"] == "positive" else -s)
             for c in counted if c["direction"] in ("positive", "negative")
             for s in [effect_side(c)] if s}
    orientation = next(iter(sides)) if len(sides) == 1 else None  # the numeric side of "positive"

    def lean(cell: dict[str, Any]) -> int:
        if cell["direction"] == "positive":
            return 1
        if cell["direction"] == "negative":
            return -1
        side = effect_side(cell)
        return side * orientation if orientation and side else 0

    leans: dict[str, set[int]] = defaultdict(set)
    significant: set[str] = set()
    for cell in counted:
        leans[cell["ref"]].add(lean(cell))
        if cell["direction"] != "null":
            significant.add(cell["ref"])
    pos = {r for r, s in leans.items() if 1 in s}
    neg = {r for r, s in leans.items() if -1 in s}
    zero = {r for r, s in leans.items() if s == {0}}
    studies = pos | neg | zero

    def ordered(refs: set[str]) -> list[str]:
        return sorted(refs, key=_ref_num)

    def consensus(direction: str, refs: set[str], dissent: dict[str, set[str]]) -> dict[str, Any]:
        side = {"positive": 1, "negative": -1}.get(direction, 0)
        aside_refs = {c["ref"] for c in aside} - studies
        agree = {c["ref"] for c in aside if side and lean(c) == side}
        return {"verdict": "consensus", "direction": direction, "refs": ordered(refs),
                "dissent": {d: ordered(r) for d, r in dissent.items() if r},
                "nonsignificant": ordered(refs - significant) if side else [],
                "corroborating": ordered(agree & aside_refs),
                # SR/MAs that point elsewhere: reported, never silently dropped (and never counted)
                "discordant_reviews": ordered({c["ref"] for c in aside if lean(c) != side and lean(c) != 0}
                                              & aside_refs - agree)}

    if pos and neg:
        # SR/MAs on one side, primary studies on the other: the reviews may contain those very studies, so they are
        # not counted against them (no majority) and the split never reads as independent studies disagreeing
        review_split = pooled_refs is not None and any(
            a <= pooled_refs and not b & pooled_refs for a, b in ((pos, neg), (neg, pos)))
        if not review_split and len(pos) != len(neg) and len(studies) >= CONSENSUS_MIN_STUDIES:
            top, other, name, other_name = ((pos, neg, "positive", "negative") if len(pos) > len(neg)
                                            else (neg, pos, "negative", "positive"))
            # a study that also reports the majority direction (another outcome in this row) is not a dissenter
            if len(top) / len(studies) >= CONSENSUS_SHARE:
                return consensus(name, top, {other_name: other - top, "null": zero})
        directions = {"positive": ordered(pos), "negative": ordered(neg)}
        pos_cells = [c for c in counted if c["ref"] in pos and lean(c) == 1]
        neg_cells = [c for c in counted if c["ref"] in neg and lean(c) == -1]
        real = bool(pos & significant and neg & significant) or _cis_apart(pos_cells, neg_cells,
                                                                           cross_ratio=review_split)
        if real:  # Plan 20 Task 10: a real review-vs-primary split is shown (and explained) as a conflict
            return {"verdict": "conflict", "refs": ordered(pos | neg), "directions": directions,
                    "nonsignificant": ordered((pos | neg) - significant),
                    **({"review_discordant": True} if review_split else {})}
        return {"verdict": "imprecise", "refs": ordered(studies), "directions": {**directions, "null": ordered(zero)},
                "opposite_sides": not review_split, "review_discordant": review_split}
    if pos or neg:
        side, name = (pos, "positive") if pos else (neg, "negative")
        if not zero:
            return consensus(name, side, {}) if len(side) >= 2 else {"verdict": "none"}
        if len(studies) >= CONSENSUS_MIN_STUDIES and len(side) / len(studies) >= CONSENSUS_SHARE:
            return consensus(name, side, {"null": zero})
        return {"verdict": "imprecise", "refs": ordered(studies),
                "directions": {name: ordered(side), "null": ordered(zero)},
                "opposite_sides": False, "review_discordant": False}
    if len(zero) >= 2:
        return consensus("null", zero, {})
    return {"verdict": "none"}


CHARTED = "✓"  # a scoping cell: the paper covers this aspect (no free-text finding, Task 10 review finding 9)


def build_matrix(papers: list[dict[str, Any]], clusters: OutcomeClusters, directional: bool = True,
                 charted: bool = False) -> dict[str, Any]:
    """The comparison rows, plus consensus and conflicts by `classify_row`. `directional` False (a scoping review, a
    themes review, a question with no effect direction): every cell's direction is `unclear` and there is no
    consensus, conflict or imprecision list. Cells whose finding is a literal placeholder ("null", "N/A") and that
    carry no estimate are dropped, and so are rows left empty or named by a placeholder."""
    by_ref = {p["ref"]: p["card"] for p in papers if p.get("card")}
    rows: list[dict[str, Any]] = []
    for cluster in sorted(clusters.clusters, key=lambda c: c.canonical.lower()):
        cells = []
        for member in sorted(cluster.members, key=lambda m: (_ref_num(m.ref), m.outcome)):
            card = by_ref.get(member.ref)
            outcome = next((o for o in (card or {}).get("outcomes", []) if o["outcome"] == member.outcome), None)
            if outcome is None or (is_placeholder(outcome["result"]) and outcome.get("effect_value") is None):
                continue
            cells.append({
                "ref": member.ref, "finding": CHARTED if charted else outcome["result"],
                "direction": outcome["direction"] if directional else "unclear",
                "effect_measure": outcome.get("effect_measure"), "effect_value": outcome.get("effect_value"),
                "ci_lower": outcome.get("ci_lower"), "ci_upper": outcome.get("ci_upper"),
                "design_category": card.get("design_category"),
                "pooled": card.get("design_category") in POOLED_CATEGORIES,  # SR/MA: may include the primary studies
            })
        if cells and not is_placeholder(cluster.canonical):
            rows.append({"outcome": cluster.canonical, "cells": cells})

    consensus: list[dict[str, Any]] = []
    conflicts: list[dict[str, Any]] = []
    imprecise: list[dict[str, Any]] = []
    for row in rows if directional else []:
        verdict = classify_row(row["cells"])
        kind = verdict.pop("verdict")
        if kind == "consensus":
            consensus.append({"outcome": row["outcome"], **verdict})
        elif kind == "conflict":
            conflicts.append({"outcome": row["outcome"], **verdict})
        elif kind == "imprecise":
            imprecise.append({"outcome": row["outcome"], **verdict})
    return {"rows": rows, "consensus": consensus, "conflicts": conflicts, "imprecise": imprecise}
