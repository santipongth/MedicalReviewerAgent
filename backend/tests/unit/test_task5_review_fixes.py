"""Plan 19 Task 5 fix round 1: the methodology review's findings 1-11 (task-5-review.md), each with the reviewer's
own probe input."""
from __future__ import annotations

from app.graph.nodes.synthesis import (
    _consensus_explanation,
    _consensus_explanation_th,
    _directional,
    make_normalize_outcomes,
)
from app.harness.design import check_design_consistency, infer_design_category
from app.harness.grade import grade_baseline, rationale_problems
from app.harness.matrix import classify_row
from tests.unit.test_design_grade_conflicts import ev, matrix_of, out, pcard
from tests.unit.test_nodes_synthesis import deps, state


def cell(ref, direction, value=None, pooled=False, lo=None, hi=None, measure="HR"):
    return {"ref": ref, "direction": direction, "effect_measure": measure, "effect_value": value, "ci_lower": lo,
            "ci_upper": hi, "pooled": pooled}


# ---- 1. orientation from the counted cells only; no conflict without significance ---------------------------
def test_two_non_significant_primaries_never_conflict_through_a_review_orientation():
    v = classify_row([cell("P1", "positive", 0.8, pooled=True), cell("P2", "null", 0.9), cell("P3", "null", 1.1)])
    assert v["verdict"] == "consensus" and v["direction"] == "null" and v["refs"] == ["P2", "P3"]
    assert v["discordant_reviews"] == ["P1"]  # the review's significant benefit is named, not hidden
    papers = [ev("P1", "sr_ma_rct", [out("CVD", "positive", "HR", 0.8)], n=9000),
              ev("P2", "rct", [out("CVD", "null", "HR", 0.9)], n=3000),
              ev("P3", "rct", [out("CVD", "null", "HR", 1.1)], n=3000)]
    g = grade_baseline(papers, matrix_of(papers), ["CVD"])
    assert not any(f.startswith("inconsistency:") for f in g["factors"])


# ---- 2. SR/MA wording: "meta analysis", "review of ... trials", and the abstract --------------------------------
def test_reviews_without_a_hyphen_or_with_review_footprints_keep_their_label():
    abstract = "We searched MEDLINE and Embase and pooled 14 randomized trials using random-effects models."
    card = pcard("Meta analysis of randomized controlled trials", "sr_ma_rct")
    assert check_design_consistency(card, [], "Drug X for HF", abstract) == (card, None)
    assert check_design_consistency(card, [], "Drug X for HF", "") == (card, None)  # the wording alone suffices
    review = pcard("Review of randomized trials", "sr_ma_rct")
    assert check_design_consistency(review, [], "t", "") == (review, None)
    assert infer_design_category("Meta analysis of randomized controlled trials") == "sr_ma_rct"
    # the abstract footprint keeps an SR label whose design text says nothing
    odd = pcard("Prospective cohort", "sr_ma_observational")
    assert check_design_consistency(odd, [], "t", "Twelve cohort studies were included (PRISMA).") == (odd, None)
    assert check_design_consistency(odd, [], "t", "We followed 2,000 adults.")[0].design_category == "cohort"


# ---- 3. a randomized body is never made precise by non-randomized participants -----------------------------------
def test_cohort_participants_never_make_an_sr_of_rcts_precise():
    papers = [ev("P1", "sr_ma_rct", [out("CVD", "positive", "HR", 0.8)])] + [
        ev(f"P{i}", "cohort", [out("CVD", "positive", "HR", 0.8)], n=50000) for i in (2, 3, 4)]
    g = grade_baseline(papers, matrix_of(papers), ["CVD"])
    assert g["level"] == "moderate"  # was high with "precision judged from the primary studies ... 150000"
    assert "imprecision: sample sizes for the primary outcome CVD not reported in the abstracts" in g["factors"]
    assert not any("150000" in f for f in g["factors"])


# ---- 4. the tier comes from the best design with evidence on the primary outcome -------------------------------
def test_two_rcts_and_three_cohorts_start_high_from_the_rcts():
    papers = [ev(f"P{i}", "rct", [out("CVD", "positive", "HR", 0.8)], n=1000) for i in (1, 2)] + [
        ev(f"P{i}", "cohort", [out("CVD", "positive", "HR", 0.8)], n=1000) for i in (3, 4, 5)]
    g = grade_baseline(papers, matrix_of(papers), ["CVD"])
    assert g["level"] == "high"  # was "start low: 3/5 primary studies non-randomized"
    assert g["factors"][0] == ("start high: randomized evidence for the primary outcome CVD: 2 randomized trial(s), 0 "
                               "systematic review(s)/meta-analysis(es) of randomized trials; 3 non-randomized "
                               "stud(ies) reported, not graded")
    # randomized evidence only on another outcome does not lift the primary outcome
    other = [ev("P1", "rct", [out("Quality of life", "positive", "MD", 2.0)], n=1000)] + papers[2:]
    g = grade_baseline(other, matrix_of(other), ["CVD"])
    assert g["factors"][0] == "start low: 3/3 primary studies non-randomized"


# ---- 5. a lone review or study: CI and significance, and inconsistency not assessable ----------------------------
def test_a_single_non_significant_review_is_not_high():
    lone = [ev("P1", "sr_ma_rct", [out("CVD", "null", "HR", 0.95)], n=5000)]
    g = grade_baseline(lone, matrix_of(lone), ["CVD"])
    assert g["level"] == "moderate"  # was high
    assert ("imprecision: the single graded review reports no significant effect for the primary outcome CVD and "
            "no CI") in g["factors"]
    assert any(f.startswith("inconsistency not assessable: one review") for f in g["factors"])
    with_ci = [ev("P1", "sr_ma_rct", [out("CVD", "null", "HR", 0.95, 0.85, 1.06)], n=5000)]
    g = grade_baseline(with_ci, matrix_of(with_ci), ["CVD"])
    assert g["level"] == "moderate" and any("95% CI for the primary outcome CVD includes no effect" in f
                                            for f in g["factors"])
    clear = [ev("P1", "sr_ma_rct", [out("CVD", "positive", "HR", 0.8, 0.7, 0.9)], n=5000)]
    assert grade_baseline(clear, matrix_of(clear), ["CVD"])["level"] == "high"
    small = [ev("P1", "rct", [out("CVD", "null", "HR", 0.95, 0.6, 1.4)], n=100)]  # one downgrade per domain
    g = grade_baseline(small, matrix_of(small), ["CVD"])
    assert g["level"] == "moderate" and any(f.startswith("imprecision (already downgraded)") for f in g["factors"])


# ---- 6. a non-significant estimate on the far side is minor inconsistency ----------------------------------------
def test_a_non_significant_far_side_estimate_does_not_downgrade():
    papers = [ev("P1", "rct", [out("CVD", "positive", "HR", 0.8)], n=3000),
              ev("P2", "rct", [out("CVD", "null", "HR", 1.1)], n=3000)]
    m = matrix_of(papers)
    assert m["conflicts"] == []
    g = grade_baseline(papers, m, ["CVD"])
    assert g["level"] == "high"
    assert any(f.startswith("minor inconsistency: a non-significant estimate on the other side") for f in g["factors"])
    apart = [ev("P1", "rct", [out("CVD", "positive", "HR", 0.6, 0.5, 0.7)], n=3000),
             ev("P2", "rct", [out("CVD", "null", "HR", 1.3, 0.95, 1.8)], n=3000)]  # CIs do not overlap
    g = grade_baseline(apart, matrix_of(apart), ["CVD"])
    assert g["level"] == "moderate" and any(f.startswith("inconsistency:") for f in g["factors"])


# ---- 7. a split exactly between reviews and primaries is review-discordant, never a conflict ---------------------
def test_a_review_against_its_own_trial_is_review_discordant():
    v = classify_row([cell("P1", "negative", pooled=True), cell("P2", "positive")])
    assert v["verdict"] == "imprecise" and v["review_discordant"] is True
    papers = [ev("P1", "sr_ma_rct", [out("CVD", "negative")], n=8000),
              ev("P2", "rct", [out("CVD", "positive")], n=3000)]
    m = matrix_of(papers)
    assert m["conflicts"] == []
    g = grade_baseline(papers, m, ["CVD"])
    assert not any(f.startswith("inconsistency:") for f in g["factors"])
    assert any(f.startswith("minor inconsistency: systematic reviews and primary studies") for f in g["factors"])
    # a primary study on each side is still a conflict
    v = classify_row([cell("P1", "negative", pooled=True), cell("P2", "positive"), cell("P3", "negative")])
    assert v["verdict"] == "conflict" and v["refs"] == ["P2", "P3"]


# ---- 8. discordant reviews are named, in English and in fixed Thai ---------------------------------------------
def test_discordant_reviews_are_named_in_the_consensus():
    v = classify_row([cell("P1", "negative", 1.3, pooled=True), cell("P2", "positive", 0.8),
                      cell("P3", "positive", 0.7)])
    assert v["refs"] == ["P2", "P3"] and v["corroborating"] == [] and v["discordant_reviews"] == ["P1"]
    c = {"outcome": "CVD", **v}
    assert _consensus_explanation(c).endswith(" Systematic reviews [P1] report a different direction.")
    assert "[P1] รายงานผลไปในทิศทางที่ต่างออกไป" in _consensus_explanation_th(c, "CVD")


# ---- 9. a level word about something else is not a starting level --------------------------------------------------
def test_start_phrase_about_risk_of_bias_is_not_a_starting_level():
    factors = ["start low: 3/3 primary studies non-randomized"]
    assert rationale_problems("Starting from observational cohorts with high risk of bias, certainty is low.",
                              factors) == []
    assert rationale_problems("The rating starts at moderate.", factors)
    assert rationale_problems("Starting from high certainty, it was downgraded.", factors)
    assert rationale_problems("We start at a high level.", factors)


# ---- 10. a mislabelled "other" effect question keeps direction logic -----------------------------------------------
def test_other_questions_with_measures_or_a_comparator_stay_directional():
    def st(papers, **question):
        s = state(papers)
        s["question"] |= {"question_type": "other", **question}
        return s

    labels = [ev("P1", "cohort", [out("CVD", "positive", "HR")]), ev("P2", "cohort", [out("CVD", "positive", "HR")])]
    themes = [ev("P1", "cohort", [out("Barriers", "positive")])]
    assert _directional(st(labels)) is True  # an HR measure, even without its value
    assert _directional(st(themes)) is False
    assert _directional(st(themes, intervention_or_exposure="metformin", comparator="sulfonylurea")) is True
    assert _directional(st(themes, intervention_or_exposure="insulin initiation",
                           comparator="None (qualitative inquiry focusing on patient perspectives).")) is False


async def test_normalize_logs_whether_direction_logic_ran():
    s = state([ev("P1", "cohort", [out("Barriers", "positive")]), ev("P2", "cohort", [out("Barriers", "positive")])])
    s["question"]["question_type"] = "other"
    res = await make_normalize_outcomes(deps())(s)
    assert res["quality"][0]["directional"] is False and res["matrix"]["consensus"] == []
    s["question"]["question_type"] = "therapy"
    res = await make_normalize_outcomes(deps())(s)
    assert res["quality"][0]["directional"] is True and res["matrix"]["consensus"]


# ---- 11. randomisation cues block the RCT -> cohort demotion -----------------------------------------------------
def test_trial_cues_block_the_rct_to_cohort_demotion():
    card = pcard("Long-term follow-up of a trial cohort", "rct")
    assert check_design_consistency(card, [], "t", "Participants were allocated to drug or placebo.") == (card, None)
    cohort = pcard("Retrospective cohort study", "rct")
    for abstract in ("Registered at ClinicalTrials.gov (NCT01234567).", "Drug versus placebo.", "ISRCTN12345678"):
        assert check_design_consistency(cohort, [], "t", abstract) == (cohort, None), abstract
    assert check_design_consistency(cohort, [], "Trial X: ten-year outcomes", "")[1] is None  # trial in the title
    emulation = pcard("Target trial emulation using a retrospective cohort", "rct")
    assert check_design_consistency(emulation, [], "t", "")[0].design_category == "cohort"
