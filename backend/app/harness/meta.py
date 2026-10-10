"""DerSimonian-Laird random-effects meta-analysis over the comparison matrix (pure: no I/O, no numpy).

Pooling rules (Plan 14b global constraints):
- only primary studies; SR/MA cells (`pooled` / `sr_ma_*`) are returned as reference rows, never pooled;
- one pool per (matrix row, effect measure, design group); RCTs and observational studies are pooled separately;
- inputs are the effect and both 95% CI bounds that survived `verify.null_unverified_numbers` (non-null);
- HR/OR/RR on the log scale, RD/MD/SMD on the raw scale; `r`, `other` and `none` are never pooled;
- k >= 3 after the duplicate-cohort guard (same first-author surname, year and n as a study already in the pool).

Design groups: rct = {rct}; observational = {cohort, case_control, cross_sectional, non_randomized_trial}.
A non-randomised trial is a non-randomised study of an intervention: it has no protection against confounding by
allocation, so it never belongs with RCTs, and Cochrane (Handbook ch. 24) analyses non-randomised studies of
interventions together with cohort and case-control designs, separately from randomised trials. Dropping it entirely
would lose usable data, so it joins the observational group.
"""
from __future__ import annotations

import math
import re
import unicodedata
from typing import Any

from rapidfuzz import fuzz

from app.harness.design import POOLED_CATEGORIES
from app.services.text import normalize_title

Z95 = 1.959964
METHOD = "DerSimonian-Laird random effects"
VERSION = "meta-1"
MIN_STUDIES = 3
SMALL_K = 5  # pools with fewer studies carry a "small_k" warning
HIGH_I2 = 50.0  # percent

RATIO_MEASURES = frozenset({"HR", "OR", "RR"})
RAW_MEASURES = frozenset({"RD", "MD", "SMD"})
MEASURE_ORDER = ("HR", "OR", "RR", "RD", "MD", "SMD")
DESIGN_GROUPS: dict[str, frozenset[str]] = {
    "rct": frozenset({"rct"}),
    "observational": frozenset({"cohort", "case_control", "cross_sectional", "non_randomized_trial"}),
}
GROUP_OF = {cat: group for group, cats in DESIGN_GROUPS.items() for cat in cats}


# ---- statistics ---------------------------------------------------------------------------
def se_from_ci(lo: float, hi: float, scale: str) -> float:
    """Standard error from a 95% CI. `scale` is "log" (ratio measures; bounds are on the natural scale) or "raw"."""
    if scale == "log":
        if lo <= 0 or hi <= 0:
            raise ValueError("ratio CI bounds must be positive")
        width = math.log(hi) - math.log(lo)
    elif scale == "raw":
        width = hi - lo
    else:
        raise ValueError(f"unknown scale {scale!r}")
    if not width > 0:
        raise ValueError("CI lower bound must be below the upper bound")
    return width / (2 * Z95)


def _gamma_series(a: float, x: float) -> float:
    """Regularized lower incomplete gamma P(a, x) by its power series (converges fast for x < a + 1)."""
    term = total = 1.0 / a
    ap = a
    for _ in range(10_000):
        ap += 1.0
        term *= x / ap
        total += term
        if abs(term) < abs(total) * 1e-16:
            break
    return total * math.exp(-x + a * math.log(x) - math.lgamma(a))


def _gamma_cf(a: float, x: float) -> float:
    """Regularized upper incomplete gamma Q(a, x) by its continued fraction (modified Lentz; x >= a + 1)."""
    tiny = 1e-300
    b = x + 1.0 - a
    c = 1.0 / tiny
    d = 1.0 / b
    h = d
    for i in range(1, 10_000):
        an = -i * (i - a)
        b += 2.0
        d = an * d + b
        d = tiny if abs(d) < tiny else d
        c = b + an / c
        c = tiny if abs(c) < tiny else c
        d = 1.0 / d
        delta = d * c
        h *= delta
        if abs(delta - 1.0) < 1e-16:
            break
    return h * math.exp(-x + a * math.log(x) - math.lgamma(a))


def chi2_sf(x: float, df: int) -> float:
    """Survival function P(X > x) of the chi-square distribution with `df` degrees of freedom."""
    if df <= 0:
        raise ValueError("df must be positive")
    if math.isnan(x):
        raise ValueError("x must not be NaN")
    if math.isinf(x):
        return 0.0 if x > 0 else 1.0
    if x <= 0:
        return 1.0
    a, half = df / 2.0, x / 2.0
    if half < a + 1.0:
        return max(0.0, 1.0 - _gamma_series(a, half))
    return _gamma_cf(a, half)


def dersimonian_laird(y: list[float], v: list[float]) -> dict[str, Any]:
    """DerSimonian-Laird random-effects pool of estimates `y` with within-study variances `v` (same scale).

    Returns est, se, ci_lower, ci_upper (95%, z = 1.959964), tau2, i2 (percent), q, df, p_het and the
    random-effects weights in percent (`weights`, summing to 100, in input order)."""
    k = len(y)
    if k != len(v) or k < 2:
        raise ValueError("need at least two studies with one variance each")
    if any(not (vi > 0 and math.isfinite(vi)) for vi in v) or any(not math.isfinite(yi) for yi in y):
        raise ValueError("variances must be positive and all values finite")
    w = [1.0 / vi for vi in v]
    sw = sum(w)
    fixed = sum(wi * yi for wi, yi in zip(w, y, strict=True)) / sw
    q = sum(wi * (yi - fixed) ** 2 for wi, yi in zip(w, y, strict=True))
    df = k - 1
    c = sw - sum(wi * wi for wi in w) / sw
    tau2 = (q - df) / c if q > df else 0.0
    i2 = 100.0 * (q - df) / q if q > df else 0.0
    w_re = [1.0 / (vi + tau2) for vi in v]
    sw_re = sum(w_re)
    est = sum(wi * yi for wi, yi in zip(w_re, y, strict=True)) / sw_re
    se = math.sqrt(1.0 / sw_re)
    return {"est": est, "se": se, "ci_lower": est - Z95 * se, "ci_upper": est + Z95 * se, "tau2": tau2,
            "i2": i2, "q": q, "df": df, "p_het": chi2_sf(q, df), "weights": [100.0 * wi / sw_re for wi in w_re]}


# ---- pooling the matrix ---------------------------------------------------------------------
def _fold(text: str) -> str:
    return "".join(ch for ch in unicodedata.normalize("NFKD", text) if not unicodedata.combining(ch)).lower()


def _split_name(authors: list[str] | None) -> tuple[str, str] | None:
    """(surname, given part) of the first author: "Smith J" (Europe PMC), "Smith, John", "John Smith"."""
    if not authors or not str(authors[0]).strip():
        return None
    name = str(authors[0]).strip()
    if "," in name:
        surname, given = name.split(",", 1)
    else:
        parts = name.replace(".", " ").split()
        initials = len(parts) > 1 and parts[-1].isupper() and len(parts[-1]) <= 3
        surname, given = (" ".join(parts[:-1]), parts[-1]) if initials else (parts[-1], " ".join(parts[:-1]))
    return _fold(surname).strip(), _fold(given).strip()


def first_author_surname(authors: list[str] | None) -> str | None:
    """Surname of the first author: "Smith J" (Europe PMC), "Smith, John" and "John Smith" all give "smith"."""
    split = _split_name(authors)
    return (split[0] or None) if split else None


def first_author_initial(authors: list[str] | None) -> str:
    """First given-name initial of the first author ("Smith J", "Smith, John", "John Smith" give "j"); "" if none."""
    split = _split_name(authors)
    return split[1][:1] if split and split[1] else ""


def _as_int(value: Any) -> int | None:
    """An integer year or sample size, or None for anything non-numeric or fractional (LLM cards are untrusted)."""
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return int(number) if math.isfinite(number) and number == int(number) else None


def _paper_identity(paper: dict[str, Any]) -> tuple[str, str, int, int] | None:
    """Duplicate-cohort key: (first-author surname, first initial or "", year, n); None if any is unknown."""
    candidate = paper.get("candidate") or {}
    authors = paper.get("authors") or candidate.get("authors")
    year = _as_int(paper.get("year") or candidate.get("year"))
    card = paper.get("card_en") or paper.get("card") or {}
    n = _as_int(card.get("sample_size"))
    surname = first_author_surname(authors)
    if surname is None or year is None or n is None:
        return None
    return surname, first_author_initial(authors), year, n


def _study_input(cell: dict[str, Any], scale: str) -> tuple[float, float] | str:
    """(y, se) on the analysis scale, or the reason the cell cannot be pooled."""
    values = (cell.get("effect_value"), cell.get("ci_lower"), cell.get("ci_upper"))
    if any(x is None for x in values):
        return "missing_numbers"
    try:
        eff, lo, hi = (float(x) for x in values)
    except (TypeError, ValueError):
        return "invalid_numbers"
    if not all(math.isfinite(x) for x in (eff, lo, hi)):
        return "invalid_numbers"
    if scale == "log" and min(eff, lo, hi) <= 0:
        return "non_positive_ratio"
    if lo >= hi:
        return "invalid_ci"
    if not lo <= eff <= hi:
        return "effect_outside_ci"
    return (math.log(eff) if scale == "log" else eff), se_from_ci(lo, hi, scale)


def _exclusion(row: str, cell: dict[str, Any], reason: str, **extra: Any) -> dict[str, Any]:
    return {"outcome": row, "ref": cell["ref"], "measure": cell.get("effect_measure"),
            "design_category": cell.get("design_category"), "reason": reason, **extra}


def pool_outcomes(matrix: dict[str, Any], papers: list[dict[str, Any]]) -> dict[str, Any]:
    """Pool every matrix row that the rules allow (see the module docstring).

    Returns {"version": "meta-1", "pools": [...], "excluded": [...], "reference": [...]}.

    Each pool: outcome, measure (HR/OR/RR/RD/MD/SMD), scale ("log" for HR/OR/RR, else "raw"), design_group
    ("rct"/"observational"), k (>= 3), studies, pooled, tau2, i2, q, df, p_het, method, version, warnings (codes).
    Scales, which matter for display:
    - studies[].effect / ci_lower / ci_upper: as reported (natural scale, e.g. HR 0.8);
    - studies[].y / se / variance: ANALYSIS scale (ln(effect) when scale == "log", else the effect itself);
    - studies[].weight: random-effects weight in PERCENT (sums to 100);
    - pooled.est / ci_lower / ci_upper: natural (display) scale, exp() applied when scale == "log";
    - pooled.y / y_ci_lower / y_ci_upper / se and tau2: ANALYSIS scale;
    - i2: PERCENT (0-100); q, df, p_het: heterogeneity test (chi-square, df = k - 1).
    excluded[]: {outcome, ref, measure, design_category, reason, [duplicate_of], [k, design_group]}, where reason is one
    of design_not_poolable, measure_not_poolable, missing_numbers, invalid_numbers, non_positive_ratio, invalid_ci,
    effect_outside_ci, duplicate_study, duplicate_cohort, too_few_studies.
    reference[]: SR/MA cells, never pooled: {outcome, ref, design_category, measure, effect, ci_lower, ci_upper}.
    """
    identity = {p["ref"]: _paper_identity(p) for p in papers if p.get("ref")}
    pools: list[dict[str, Any]] = []
    excluded: list[dict[str, Any]] = []
    reference: list[dict[str, Any]] = []

    for row in matrix.get("rows", []):
        outcome = row["outcome"]
        groups: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for cell in row.get("cells", []):
            category = cell.get("design_category")
            measure = cell.get("effect_measure")
            if cell.get("pooled") or category in POOLED_CATEGORIES:
                reference.append({"outcome": outcome, "ref": cell["ref"], "design_category": category,
                                  "measure": measure, "effect": cell.get("effect_value"),
                                  "ci_lower": cell.get("ci_lower"), "ci_upper": cell.get("ci_upper")})
                continue
            group = GROUP_OF.get(category or "")
            if group is None:
                excluded.append(_exclusion(outcome, cell, "design_not_poolable"))
                continue
            if measure not in RATIO_MEASURES and measure not in RAW_MEASURES:
                excluded.append(_exclusion(outcome, cell, "measure_not_poolable"))
                continue
            groups.setdefault((group, measure), []).append(cell)

        measures_by_group: dict[str, set[str]] = {}
        for group, measure in groups:
            measures_by_group.setdefault(group, set()).add(measure)

        ordered = sorted(groups, key=lambda gm: (list(DESIGN_GROUPS).index(gm[0]), MEASURE_ORDER.index(gm[1])))
        for group, measure in ordered:
            scale = "log" if measure in RATIO_MEASURES else "raw"
            warnings: list[str] = []
            studies: list[dict[str, Any]] = []
            seen_refs: set[str] = set()
            seen_ids: dict[tuple[str, str, int, int], str] = {}
            source: dict[str, dict[str, Any]] = {}  # ref -> the cell that became the study
            for cell in groups[(group, measure)]:
                ref = cell["ref"]
                if ref in seen_refs:  # a paper with two outcomes in one row counts once (the first is kept)
                    excluded.append(_exclusion(outcome, cell, "duplicate_study", duplicate_of=ref))
                    continue
                parsed = _study_input(cell, scale)
                if isinstance(parsed, str):
                    excluded.append(_exclusion(outcome, cell, parsed))
                    continue
                ident = identity.get(ref)
                if ident is not None and ident in seen_ids:
                    excluded.append(_exclusion(outcome, cell, "duplicate_cohort", duplicate_of=seen_ids[ident]))
                    if "duplicate_cohort_skipped" not in warnings:
                        warnings.append("duplicate_cohort_skipped")
                    continue
                seen_refs.add(ref)
                if ident is not None:
                    seen_ids[ident] = ref
                y, se = parsed
                source[ref] = cell
                studies.append({"ref": ref, "effect": float(cell["effect_value"]),
                                "ci_lower": float(cell["ci_lower"]), "ci_upper": float(cell["ci_upper"]),
                                "y": y, "se": se, "variance": se * se, "weight": None})

            if len(studies) < MIN_STUDIES:
                excluded += [_exclusion(outcome, source[s["ref"]], "too_few_studies", k=len(studies),
                                        design_group=group) for s in studies]
                continue

            res = dersimonian_laird([s["y"] for s in studies], [s["variance"] for s in studies])
            for s, weight in zip(studies, res["weights"], strict=True):
                s["weight"] = weight
            back = math.exp if scale == "log" else (lambda x: x)
            warnings = ["abstract_only", "ci_assumed_95", "adjustment_unknown", *warnings]
            if len(studies) < SMALL_K:
                warnings.append("small_k")
            if res["i2"] >= HIGH_I2:
                warnings.append("high_heterogeneity")
            if measure == "MD":
                warnings.append("md_units_assumed_equal")
            if len(measures_by_group[group]) > 1:
                warnings.append("other_measures_not_pooled")
            pools.append({
                "outcome": outcome, "measure": measure, "scale": scale, "design_group": group, "k": len(studies),
                "studies": studies,
                "pooled": {"est": back(res["est"]), "ci_lower": back(res["ci_lower"]),
                           "ci_upper": back(res["ci_upper"]), "y": res["est"], "y_ci_lower": res["ci_lower"],
                           "y_ci_upper": res["ci_upper"], "se": res["se"]},
                "tau2": res["tau2"], "i2": res["i2"], "q": res["q"], "df": res["df"], "p_het": res["p_het"],
                "method": METHOD, "version": VERSION, "warnings": warnings,
            })
    return {"version": VERSION, "pools": pools, "excluded": excluded, "reference": reference}


# ---- helpers for the graph (Task 4): prompt data, the no-pooled-numbers post-check, the primary outcome ----------
DISPLAY_DECIMALS = 2  # pooled estimates and CI bounds as the UI shows them; I2 as a whole percent, tau2 at 3 decimals


def pools_for_prompt(meta: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Compact pooled results for the synthesis prompt, rounded the way the UI shows them."""
    out = []
    for p in (meta or {}).get("pools") or []:
        est = p["pooled"]
        out.append({"outcome": p["outcome"], "measure": p["measure"], "design_group": p["design_group"], "k": p["k"],
                    "refs": [s["ref"] for s in p["studies"]],
                    "estimate": round(est["est"], DISPLAY_DECIMALS),
                    "ci_lower": round(est["ci_lower"], DISPLAY_DECIMALS),
                    "ci_upper": round(est["ci_upper"], DISPLAY_DECIMALS),
                    "i2_percent": round(p["i2"]), "tau2": round(p["tau2"], 3)})
    return out


def pooled_number_strings(meta: dict[str, Any] | None) -> set[str]:
    """Every pooled estimate and CI bound (display scale, sign dropped) formatted at 2 and 3 decimals, plus their
    trimmed forms (0.80 -> 0.8) and leading-dot forms (.80, .8). Forms that trim to an integer are left out, so
    a citation like [P1] can never match."""
    strings: set[str] = set()
    for p in (meta or {}).get("pools") or []:
        for key in ("est", "ci_lower", "ci_upper"):
            value = abs(p["pooled"][key])
            for s in (f"{value:.2f}", f"{value:.3f}"):
                forms = {s}
                trimmed = s.rstrip("0")
                if not trimmed.endswith("."):
                    forms.add(trimmed)
                strings |= forms | {f[1:] for f in forms if f.startswith("0.")}
    return strings


# A sentence ends at . ! or ? followed by space and an uppercase letter or "[" (so "et al. reported" and
# "vs. placebo" stay inside their sentence).
_SENTENCE = re.compile(r"(?<=[.!?])\s+(?=[A-Z\[])")
_POOLED_WORDING = re.compile(r"pool|overall|combined|meta-?analy|aggregate", re.IGNORECASE)
_BRACKETS = re.compile(r"\[([^\]]*)\]")
_REF = re.compile(r"\bP\d+\b")


def _cited_refs(sentence: str) -> set[str]:
    return {r for group in _BRACKETS.findall(sentence) for r in _REF.findall(group)}


def strip_pooled_numbers(text: str, strings: set[str]) -> tuple[str, int, int]:
    """Remove the sentences that restate a pooled number. A sentence containing one of `strings` as a whole number
    is removed when it cites no paper, cites two or more papers, or uses pooled wording (pooled, overall, combined,
    meta-analysis, aggregate). A sentence that cites exactly one paper and has no pooled wording is a single-study
    quote and is kept. Returns (text, sentences removed, single-study sentences kept despite a matching number)."""
    if not text or not strings:
        return text, 0, 0
    pattern = re.compile("|".join(rf"(?<![\d.]){re.escape(s)}(?!\d)" for s in sorted(strings, key=len, reverse=True)))
    kept, removed, single = [], 0, 0
    for sentence in _SENTENCE.split(text.strip()):
        if not pattern.search(sentence):
            kept.append(sentence)
        elif len(_cited_refs(sentence)) == 1 and not _POOLED_WORDING.search(sentence):
            kept.append(sentence)
            single += 1
        else:
            removed += 1
    return " ".join(kept), removed, single


def primary_outcome(meta: dict[str, Any] | None, question_outcomes: list[str] | None) -> str | None:
    """The pooled outcome that answers the question's first outcome (fuzzy name match, >= 80), else the pooled
    outcome with the most studies (ties: matrix order)."""
    pools = (meta or {}).get("pools") or []
    if not pools:
        return None
    names = list(dict.fromkeys(p["outcome"] for p in pools))
    for wanted in (question_outcomes or [])[:1]:
        key = normalize_title(wanted) or wanted.lower()
        scored = [(fuzz.token_set_ratio(key, normalize_title(n) or n.lower()), -i, n) for i, n in enumerate(names)]
        best = max(scored)
        if best[0] >= 80:
            return best[2]
    totals = {n: sum(p["k"] for p in pools if p["outcome"] == n) for n in names}
    return max(names, key=lambda n: (totals[n], -names.index(n)))
