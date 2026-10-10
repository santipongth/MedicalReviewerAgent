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
import unicodedata
from typing import Any

from app.harness.design import POOLED_CATEGORIES

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


def first_author_surname(authors: list[str] | None) -> str | None:
    """Surname of the first author: "Smith J" (Europe PMC), "Smith, John" and "John Smith" all give "smith"."""
    if not authors or not str(authors[0]).strip():
        return None
    name = str(authors[0]).strip()
    if "," in name:
        surname = name.split(",", 1)[0]
    else:
        parts = name.replace(".", " ").split()
        initials = len(parts) > 1 and parts[-1].isupper() and len(parts[-1]) <= 3
        surname = " ".join(parts[:-1]) if initials else parts[-1]
    surname = _fold(surname).strip()
    return surname or None


def _paper_identity(paper: dict[str, Any]) -> tuple[str, int, int] | None:
    candidate = paper.get("candidate") or {}
    authors = paper.get("authors") or candidate.get("authors")
    year = paper.get("year") or candidate.get("year")
    card = paper.get("card_en") or paper.get("card") or {}
    n = card.get("sample_size")
    surname = first_author_surname(authors)
    if surname is None or year is None or n is None:
        return None
    return surname, int(year), int(n)


def _study_input(cell: dict[str, Any], scale: str) -> tuple[float, float] | str:
    """(y, se) on the analysis scale, or the reason the cell cannot be pooled."""
    values = (cell.get("effect_value"), cell.get("ci_lower"), cell.get("ci_upper"))
    if any(x is None for x in values):
        return "missing_numbers"
    eff, lo, hi = (float(x) for x in values)
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
    """Pool every matrix row that the rules allow. See docs in the Plan 14b task-3 report for the schema."""
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
            seen_ids: dict[tuple[str, int, int], str] = {}
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
                studies.append({"ref": ref, "effect": float(cell["effect_value"]),
                                "ci_lower": float(cell["ci_lower"]), "ci_upper": float(cell["ci_upper"]),
                                "y": y, "se": se, "variance": se * se, "weight": None})

            if len(studies) < MIN_STUDIES:
                cell_of = {c["ref"]: c for c in reversed(groups[(group, measure)])}  # first cell per ref
                excluded += [_exclusion(outcome, cell_of[s["ref"]], "too_few_studies", k=len(studies),
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
