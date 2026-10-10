import math

import pytest

from app.harness.meta import (
    METHOD,
    VERSION,
    chi2_sf,
    dersimonian_laird,
    first_author_initial,
    first_author_surname,
    pool_outcomes,
    se_from_ci,
)

TOL = 1e-4

# metafor dat.bcg: tpos, tneg, cpos, cneg for the 13 BCG vaccine trials (Colditz et al., 1994).
BCG = [
    (4, 119, 11, 128), (6, 300, 29, 274), (3, 228, 11, 209), (62, 13536, 248, 12619),
    (33, 5036, 47, 5761), (180, 1361, 372, 1079), (8, 2537, 10, 619), (505, 87886, 499, 87892),
    (29, 7470, 45, 7232), (17, 1699, 65, 1600), (186, 50448, 141, 27197), (5, 2493, 3, 2338),
    (27, 16886, 29, 17825),
]


def bcg_yi_vi() -> tuple[list[float], list[float]]:
    """escalc(measure="RR", ai=tpos, bi=tneg, ci=cpos, di=cneg): log RR and its large-sample variance."""
    y, v = [], []
    for a, b, c, d in BCG:
        y.append(math.log((a / (a + b)) / (c / (c + d))))
        v.append(1 / a - 1 / (a + b) + 1 / c - 1 / (c + d))
    return y, v


# ---- chi-square ---------------------------------------------------------------------------
@pytest.mark.parametrize(("x", "df", "expected"), [
    (3.841459, 1, 0.05), (5.991465, 2, 0.05), (2.0, 2, math.exp(-1.0)), (12.5, 2, math.exp(-6.25)),
    (18.307038, 10, 0.05), (0.0, 3, 1.0),
])
def test_chi2_sf_known_values(x, df, expected):
    assert chi2_sf(x, df) == pytest.approx(expected, rel=1e-5)


def test_chi2_sf_rough_and_tiny_values():
    assert chi2_sf(3.84, 1) == pytest.approx(0.05, abs=1e-3)
    assert chi2_sf(152.23, 12) == pytest.approx(6.5e-26, rel=0.05)


# ---- se_from_ci ---------------------------------------------------------------------------
def test_se_from_ci_log_and_raw():
    assert se_from_ci(0.71, 0.90, "log") == pytest.approx(0.060493, abs=TOL)
    assert se_from_ci(-1.0, 3.0, "raw") == pytest.approx(4 / (2 * 1.959964))
    # asymmetric on the natural scale, symmetric on the log scale
    assert se_from_ci(0.5, 2.0, "log") == pytest.approx(math.log(4) / (2 * 1.959964))


@pytest.mark.parametrize(("lo", "hi", "scale"), [(0.9, 0.71, "log"), (1.0, 1.0, "raw"), (0.0, 1.0, "log"),
                                                 (-0.5, 1.0, "log"), (0.1, 0.2, "cubic")])
def test_se_from_ci_rejects_invalid(lo, hi, scale):
    with pytest.raises(ValueError):
        se_from_ci(lo, hi, scale)


# ---- DerSimonian-Laird --------------------------------------------------------------------
def test_dl_hand_fixture():
    res = dersimonian_laird([0.0, 0.5, 1.0], [0.04] * 3)
    assert res["q"] == pytest.approx(12.5, abs=TOL)
    assert res["df"] == 2
    assert res["tau2"] == pytest.approx(0.21, abs=TOL)
    assert res["est"] == pytest.approx(0.5, abs=TOL)
    assert res["se"] == pytest.approx(0.288675, abs=TOL)
    assert res["i2"] == pytest.approx(84.0, abs=0.01)
    assert res["ci_lower"] == pytest.approx(0.5 - 1.959964 * 0.288675, abs=TOL)
    assert res["p_het"] == pytest.approx(math.exp(-6.25), rel=1e-6)
    assert res["weights"] == pytest.approx([100 / 3] * 3)


def test_dl_dat_bcg_matches_metafor():
    y, v = bcg_yi_vi()
    assert y[0] == pytest.approx(-0.8893, abs=TOL)  # metafor escalc yi / vi for Aronson 1948
    assert v[0] == pytest.approx(0.3256, abs=TOL)
    res = dersimonian_laird(y, v)
    assert res["est"] == pytest.approx(-0.7141, abs=TOL)
    assert res["se"] == pytest.approx(0.1787, abs=TOL)
    assert res["tau2"] == pytest.approx(0.3088, abs=TOL)
    assert res["i2"] == pytest.approx(92.12, abs=0.01)
    assert res["q"] == pytest.approx(152.2330, abs=TOL)
    assert res["df"] == 12
    assert res["p_het"] < 1e-24
    assert sum(res["weights"]) == pytest.approx(100.0)


def test_dl_homogeneous_gives_zero_tau2_and_i2():
    res = dersimonian_laird([0.1, 0.12, 0.11], [0.04, 0.05, 0.06])
    assert res["q"] < res["df"]
    assert res["tau2"] == 0.0
    assert res["i2"] == 0.0
    identical = dersimonian_laird([0.3, 0.3, 0.3], [0.1, 0.2, 0.3])
    assert identical["q"] == pytest.approx(0.0) and identical["i2"] == 0.0 and identical["p_het"] == 1.0


def test_dl_huge_variance_study_barely_moves_estimate():
    y, v = bcg_yi_vi()
    base = dersimonian_laird(y, v)
    for outlier in (-5.0, 0.0, 5.0):
        moved = dersimonian_laird([*y, outlier], [*v, 1e6])
        # the extra df shifts tau2 slightly (Q is unchanged, df + 1), so the estimate moves by ~2e-4 at most
        assert moved["est"] == pytest.approx(base["est"], abs=1e-3)
        assert moved["se"] == pytest.approx(base["se"], abs=1e-3)
        assert moved["weights"][-1] < 1e-3


def test_dl_rejects_bad_input():
    with pytest.raises(ValueError):
        dersimonian_laird([0.1], [0.1])
    with pytest.raises(ValueError):
        dersimonian_laird([0.1, 0.2], [0.1, 0.0])


# ---- pool_outcomes ------------------------------------------------------------------------
def cell(ref, value, lo, hi, measure="RR", design="rct", **kw):
    from app.harness.design import POOLED_CATEGORIES
    return {"ref": ref, "finding": "", "direction": "positive", "effect_measure": measure, "effect_value": value,
            "ci_lower": lo, "ci_upper": hi, "design_category": design, "pooled": design in POOLED_CATEGORIES, **kw}


def paper(ref, author=None, year=2020, n=100):
    """Distinct first authors by default, so the duplicate-cohort guard stays out of the way."""
    return {"ref": ref, "candidate": {"authors": [author or f"Author{ref} X"], "year": year},
            "card": {"sample_size": n, "outcomes": []}}


def run(cells, papers=None):
    refs = sorted({c["ref"] for c in cells})
    matrix = {"rows": [{"outcome": "mortality", "cells": cells}]}
    return pool_outcomes(matrix, papers if papers is not None else [paper(r) for r in refs])


def reasons(result):
    return {(e["ref"], e["reason"]) for e in result["excluded"]}


def test_pool_bcg_on_the_log_scale_with_back_transform():
    y, v = bcg_yi_vi()
    cells = []
    for i, (yi, vi) in enumerate(zip(y, v, strict=True)):
        half = 1.959964 * math.sqrt(vi)
        cells.append(cell(f"P{i + 1}", math.exp(yi), math.exp(yi - half), math.exp(yi + half)))
    out = run(cells)
    assert out["version"] == VERSION and not out["excluded"] and not out["reference"]
    [pool] = out["pools"]
    assert pool["measure"] == "RR" and pool["scale"] == "log" and pool["design_group"] == "rct" and pool["k"] == 13
    assert pool["method"] == METHOD and pool["version"] == VERSION
    assert pool["pooled"]["y"] == pytest.approx(-0.7141, abs=TOL)
    assert pool["pooled"]["se"] == pytest.approx(0.1787, abs=TOL)
    assert pool["pooled"]["est"] == pytest.approx(math.exp(pool["pooled"]["y"]))
    assert pool["pooled"]["ci_lower"] == pytest.approx(math.exp(pool["pooled"]["y_ci_lower"]))
    assert pool["pooled"]["y_ci_lower"] == pytest.approx(-1.06445, abs=TOL)  # metafor DL: [-1.0644, -0.3638]
    assert pool["pooled"]["y_ci_upper"] == pytest.approx(-0.36378, abs=TOL)
    assert pool["pooled"]["ci_upper"] == pytest.approx(math.exp(-0.36378), abs=TOL)
    assert pool["tau2"] == pytest.approx(0.3088, abs=TOL)
    assert pool["i2"] == pytest.approx(92.12, abs=0.01)
    assert pool["q"] == pytest.approx(152.233, abs=1e-3) and pool["df"] == 12
    s = pool["studies"][0]
    assert set(s) == {"ref", "effect", "ci_lower", "ci_upper", "y", "se", "variance", "weight"}
    assert s["y"] == pytest.approx(y[0]) and s["se"] == pytest.approx(math.sqrt(v[0]))
    assert sum(st["weight"] for st in pool["studies"]) == pytest.approx(100.0)
    assert {"abstract_only", "high_heterogeneity", "adjustment_unknown"} <= set(pool["warnings"])
    assert "small_k" not in pool["warnings"]


def test_md_is_pooled_on_the_raw_scale():
    out = run([cell("P1", -1.0, -2.0, 0.0, "MD"), cell("P2", -0.5, -1.5, 0.5, "MD"), cell("P3", 0.0, -1.0, 1.0, "MD")])
    [pool] = out["pools"]
    assert pool["scale"] == "raw"
    assert pool["pooled"]["est"] == pool["pooled"]["y"]
    assert pool["pooled"]["est"] == pytest.approx(-0.5)
    assert "small_k" in pool["warnings"] and "md_units_assumed_equal" in pool["warnings"]


def test_rct_and_observational_pooled_separately():
    cells = [cell("P1", 0.8, 0.6, 1.0), cell("P2", 0.7, 0.5, 0.9), cell("P3", 0.9, 0.7, 1.1),
             cell("P4", 0.6, 0.4, 0.9, design="cohort"), cell("P5", 0.7, 0.5, 1.0, design="case_control"),
             cell("P6", 0.8, 0.6, 1.1, design="cross_sectional"),
             cell("P7", 0.9, 0.7, 1.2, design="non_randomized_trial")]
    out = run(cells)
    by_group = {p["design_group"]: p for p in out["pools"]}
    assert set(by_group) == {"rct", "observational"}
    assert [s["ref"] for s in by_group["rct"]["studies"]] == ["P1", "P2", "P3"]
    assert [s["ref"] for s in by_group["observational"]["studies"]] == ["P4", "P5", "P6", "P7"]
    assert [p["design_group"] for p in out["pools"]] == ["rct", "observational"]


def test_never_pooled_designs_and_sr_ma_reference_rows():
    cells = [cell("P1", 0.8, 0.6, 1.0), cell("P2", 0.7, 0.5, 0.9), cell("P3", 0.9, 0.7, 1.1),
             cell("P4", 0.5, 0.3, 0.8, design="sr_ma_rct"), cell("P5", 0.6, 0.4, 0.9, design="sr_ma_mixed"),
             cell("P6", 0.6, 0.4, 0.9, design="case_series"),
             cell("P7", 0.6, 0.4, 0.9, design="mendelian_randomization"),
             cell("P8", 0.6, 0.4, 0.9, design="narrative_review"), cell("P9", 0.6, 0.4, 0.9, design="other"),
             cell("P10", 0.6, 0.4, 0.9, design=None)]
    out = run(cells)
    [pool] = out["pools"]
    assert [s["ref"] for s in pool["studies"]] == ["P1", "P2", "P3"]
    assert [r["ref"] for r in out["reference"]] == ["P4", "P5"]
    assert out["reference"][0] == {"outcome": "mortality", "ref": "P4", "design_category": "sr_ma_rct",
                                   "measure": "RR", "effect": 0.5, "ci_lower": 0.3, "ci_upper": 0.8}
    assert reasons(out) == {(r, "design_not_poolable") for r in ("P6", "P7", "P8", "P9", "P10")}


def test_sr_ma_flag_alone_excludes_from_pool():
    cells = [cell("P1", 0.8, 0.6, 1.0), cell("P2", 0.7, 0.5, 0.9), {**cell("P3", 0.9, 0.7, 1.1), "pooled": True}]
    out = run(cells)
    assert not out["pools"]
    assert [r["ref"] for r in out["reference"]] == ["P3"]


def test_fewer_than_three_studies_is_not_pooled_with_a_reason():
    out = run([cell("P1", 0.8, 0.6, 1.0), cell("P2", 0.7, 0.5, 0.9)])
    assert out["pools"] == []
    assert reasons(out) == {("P1", "too_few_studies"), ("P2", "too_few_studies")}
    assert all(e["k"] == 2 and e["design_group"] == "rct" for e in out["excluded"])


def test_mixed_measures_pool_separately_and_never_pool_r_other_none():
    cells = [cell("P1", 0.8, 0.6, 1.0, "HR"), cell("P2", 0.7, 0.5, 0.9, "HR"), cell("P3", 0.9, 0.7, 1.1, "HR"),
             cell("P4", 0.8, 0.6, 1.0, "OR"), cell("P5", 0.7, 0.5, 0.9, "OR"),
             cell("P6", 0.3, 0.1, 0.5, "r"), cell("P7", 1.0, 0.5, 2.0, "other"),
             cell("P8", None, None, None, "none"), cell("P9", 0.2, 0.1, 0.3, "SMD")]
    out = run(cells)
    [pool] = out["pools"]
    assert pool["measure"] == "HR" and pool["k"] == 3
    assert "other_measures_not_pooled" in pool["warnings"]
    assert reasons(out) == {("P4", "too_few_studies"), ("P5", "too_few_studies"), ("P6", "measure_not_poolable"),
                            ("P7", "measure_not_poolable"), ("P8", "measure_not_poolable"),
                            ("P9", "too_few_studies")}


def test_invalid_and_unverified_inputs_are_excluded_with_reasons():
    cells = [cell("P1", 0.8, 0.6, 1.0), cell("P2", 0.7, 0.5, 0.9), cell("P3", 0.9, 0.7, 1.1),
             cell("P4", 0.8, None, 1.0),  # nulled by verify.null_unverified_numbers
             cell("P5", 0.8, 1.0, 0.6), cell("P6", 0.8, 0.8, 0.8), cell("P7", 0.0, -0.1, 0.5),
             cell("P8", 1.5, 0.6, 1.0), cell("P9", -1.0, -2.0, 0.0, "RD"), cell("P10", float("nan"), 0.1, 0.2)]
    out = run(cells)
    [pool] = [p for p in out["pools"] if p["measure"] == "RR"]
    assert pool["k"] == 3
    assert {("P4", "missing_numbers"), ("P5", "invalid_ci"), ("P6", "invalid_ci"), ("P7", "non_positive_ratio"),
            ("P8", "effect_outside_ci"), ("P10", "invalid_numbers")} <= reasons(out)
    assert ("P9", "too_few_studies") in reasons(out)  # RD may be negative: valid, just alone


def test_duplicate_cohort_guard_skips_the_later_study_with_a_warning():
    cells = [cell("P1", 0.8, 0.6, 1.0), cell("P2", 0.7, 0.5, 0.9), cell("P3", 0.9, 0.7, 1.1),
             cell("P4", 0.75, 0.55, 0.95)]
    papers = [paper("P1", "Smith J", 2019, 500), paper("P2", "Jones K", 2020, 300), paper("P3", "Lee M", 2021, 200),
              {"ref": "P4", "authors": ["Smith, John"], "year": 2019, "card_en": {"sample_size": 500}}]
    out = run(cells, papers)
    [pool] = out["pools"]
    assert [s["ref"] for s in pool["studies"]] == ["P1", "P2", "P3"]
    assert "duplicate_cohort_skipped" in pool["warnings"]
    [dup] = out["excluded"]
    assert dup["ref"] == "P4" and dup["reason"] == "duplicate_cohort" and dup["duplicate_of"] == "P1"


def test_duplicate_guard_needs_all_three_keys_and_same_ref_counts_once():
    cells = [cell("P1", 0.8, 0.6, 1.0), cell("P2", 0.7, 0.5, 0.9), cell("P3", 0.9, 0.7, 1.1),
             cell("P3", 0.85, 0.65, 1.05)]
    papers = [paper("P1", "Smith J", 2019, 500), paper("P2", "Smith J", 2019, 501), paper("P3", "Smith J", 2019, None)]
    out = run(cells, papers)
    [pool] = out["pools"]
    assert [s["ref"] for s in pool["studies"]] == ["P1", "P2", "P3"]
    assert "duplicate_cohort_skipped" not in pool["warnings"]
    assert reasons(out) == {("P3", "duplicate_study")}


def test_first_author_surname_formats():
    assert first_author_surname(["Smith J"]) == "smith"
    assert first_author_surname(["Smith JA"]) == "smith"
    assert first_author_surname(["Smith, John"]) == "smith"
    assert first_author_surname(["John Smith"]) == "smith"
    assert first_author_surname(["Müller H"]) == "muller"
    assert first_author_surname(["van der Berg A"]) == "van der berg"
    assert first_author_surname([]) is None and first_author_surname(None) is None


# ---- fix round 1 ---------------------------------------------------------------------------
@pytest.mark.parametrize(("x", "df", "expected"), [(43.772972, 30, 0.05), (67.504807, 50, 0.05),
                                                   (29.336030, 30, 0.5)])
def test_chi2_sf_larger_df(x, df, expected):
    assert chi2_sf(x, df) == pytest.approx(expected, rel=1e-5)


@pytest.mark.parametrize("x", [10.0, 100.0, 600.0])
def test_chi2_sf_df1_large_x_matches_erfc(x):
    assert chi2_sf(x, 1) == pytest.approx(math.erfc(math.sqrt(x / 2)), rel=1e-9)


def test_chi2_sf_non_finite():
    assert chi2_sf(math.inf, 3) == 0.0
    assert chi2_sf(-math.inf, 3) == 1.0
    with pytest.raises(ValueError):
        chi2_sf(math.nan, 3)


def test_dl_two_studies_and_negative_variance():
    res = dersimonian_laird([0.0, 1.0], [0.1, 0.1])
    assert res["df"] == 1 and res["est"] == pytest.approx(0.5)
    with pytest.raises(ValueError):
        dersimonian_laird([0.1, 0.2, 0.3], [0.1, -0.1, 0.1])


def test_identical_effects_pool_with_zero_heterogeneity():
    out = run([cell("P1", 0.8, 0.6, 1.0), cell("P2", 0.8, 0.7, 0.9), cell("P3", 0.8, 0.5, 1.2)])
    [pool] = out["pools"]
    assert pool["q"] == pytest.approx(0.0, abs=1e-12)
    assert pool["tau2"] == 0.0 and pool["i2"] == 0.0 and pool["p_het"] == pytest.approx(1.0)
    assert pool["pooled"]["est"] == pytest.approx(0.8)
    assert "high_heterogeneity" not in pool["warnings"]


def test_effect_on_the_ci_bound_is_accepted():
    out = run([cell("P1", 0.6, 0.6, 1.0), cell("P2", 0.9, 0.5, 0.9), cell("P3", -1.0, -1.0, 1.0, "MD"),
               cell("P4", 0.8, 0.6, 1.0)])
    [pool] = [p for p in out["pools"] if p["measure"] == "RR"]
    assert [s["ref"] for s in pool["studies"]] == ["P1", "P2", "P4"]
    assert ("P3", "too_few_studies") in reasons(out)


@pytest.mark.parametrize(("year", "n"), [("abc", 100), (2019, "abc"), ("2019a", 100), (2019, 12.5), (2019, True),
                                         (None, 100), (2019, float("nan"))])
def test_non_numeric_year_or_n_disables_the_guard_without_crashing(year, n):
    cells = [cell("P1", 0.8, 0.6, 1.0), cell("P2", 0.7, 0.5, 0.9), cell("P3", 0.9, 0.7, 1.1)]
    papers = [paper("P1", "Smith J", 2019, 100), paper("P2", "Smith J", year, n), paper("P3")]
    [pool] = run(cells, papers)["pools"]
    assert pool["k"] == 3 and "duplicate_cohort_skipped" not in pool["warnings"]


def test_numeric_strings_still_feed_the_guard():
    cells = [cell("P1", 0.8, 0.6, 1.0), cell("P2", 0.7, 0.5, 0.9), cell("P3", 0.9, 0.7, 1.1),
             cell("P4", 0.85, 0.65, 1.05)]
    papers = [paper("P1", "Smith J", 2019, 100), paper("P2", "Smith J", "2019", "100"), paper("P3"), paper("P4")]
    out = run(cells, papers)
    assert ("P2", "duplicate_cohort") in reasons(out)


def test_duplicate_key_uses_the_first_initial():
    cells = [cell("P1", 0.8, 0.6, 1.0), cell("P2", 0.7, 0.5, 0.9), cell("P3", 0.9, 0.7, 1.1)]
    papers = [paper("P1", "Wang L", 2019, 100), paper("P2", "Wang Y", 2019, 100), paper("P3", "Chen X", 2019, 100)]
    out = run(cells, papers)
    [pool] = out["pools"]
    assert pool["k"] == 3 and not out["excluded"]
    # "Li Wang" is Wang L in another name order: still a duplicate of P1
    dup = run([*cells, cell("P4", 0.85, 0.65, 1.05)], [*papers, paper("P4", "Li Wang", 2019, 100)])
    assert ("P4", "duplicate_cohort") in reasons(dup)
    assert first_author_initial(["Wang L"]) == "l"
    assert first_author_initial(["Wang, Li"]) == "l"
    assert first_author_initial(["Li Wang"]) == "l"
    assert first_author_initial(["Wang"]) == ""
    assert first_author_initial([]) == ""


def test_too_few_studies_rows_come_from_the_cells_that_became_studies():
    cells = [cell("P1", 1.5, 0.6, 1.0, design="cohort"),  # invalid (outside its CI): not the study
             cell("P1", 0.8, 0.6, 1.0, design="cohort"), cell("P2", 0.7, 0.5, 0.9, design="cohort")]
    out = run(cells)
    assert out["pools"] == []
    rows = [(e["ref"], e["reason"]) for e in out["excluded"]]
    assert rows == [("P1", "effect_outside_ci"), ("P1", "too_few_studies"), ("P2", "too_few_studies")]
    assert all(e["design_group"] == "observational" for e in out["excluded"] if e["reason"] == "too_few_studies")


def test_other_measures_warning_fires_only_when_another_measure_is_present():
    base = [cell("P1", 0.8, 0.6, 1.0), cell("P2", 0.7, 0.5, 0.9), cell("P3", 0.9, 0.7, 1.1)]
    [alone] = run(base)["pools"]
    assert "other_measures_not_pooled" not in alone["warnings"]
    [mixed] = run([*base, cell("P4", 0.7, 0.5, 0.9, "OR")])["pools"]
    assert "other_measures_not_pooled" in mixed["warnings"]
    # a different measure in the other design group does not count
    [split] = run([*base, cell("P4", 0.7, 0.5, 0.9, "OR", design="cohort")])["pools"]
    assert "other_measures_not_pooled" not in split["warnings"]


def test_non_numeric_cell_values_are_invalid_not_a_crash():
    out = run([cell("P1", "abc", 0.6, 1.0), cell("P2", 0.7, 0.5, 0.9)])
    assert ("P1", "invalid_numbers") in reasons(out)
