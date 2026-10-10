"""Plan 19 Task 5: design-label consistency (audit I-7), GRADE-lite tiers (I-13) and conflicts by the side of the
effect (I-11). The cards are transcribed from the audit runs (.superpowers/audit/runs): SLR metformin/CRC 84edcb5d,
meta-analysis SGLT2i/HF 91b5b764, narrative qualitative insulin initiation 4f33f660, scoping AI mammography f78b2184."""
from __future__ import annotations

import json
import re

from app.graph.nodes.reading import make_read_paper
from app.graph.nodes.synthesis import (
    DIRECTION_TEXT,
    _directional,
    make_normalize_outcomes,
    make_pool_effects,
    make_write_synthesis,
)
from app.graph.schemas import (
    NarrativeNoGrade,
    OutcomeCluster,
    OutcomeClusters,
    OutcomeMember,
    OutcomeResult,
    PaperCard,
    SynthesisNarrative,
)
from app.harness.design import check_design_consistency, design_problems, settle_design_category
from app.harness.grade import NOT_ASSESSED, grade_baseline, rationale_problems, reconcile_rationale
from app.harness.matrix import build_matrix, classify_row, fallback_clusters
from app.harness.quality import summarize_quality
from tests.fakes import FakeStructuredLLM
from tests.unit import test_nodes_reading as reading
from tests.unit import test_review_graph as graph_test
from tests.unit.test_nodes_synthesis import deps, paper, state


# ---- helpers ------------------------------------------------------------------------------------
def pcard(design, category, *, n=None, quote=None, outcomes=None):
    outcomes = outcomes or [OutcomeResult(outcome="o", result="r", evidence_quote="q", effect_size=None,
                                          effect_measure="none", effect_value=None, ci_lower=None, ci_upper=None,
                                          p_value=None, direction="positive")]
    return PaperCard(study_design=design, design_category=category, population="adults", sample_size=n,
                     sample_size_quote=quote, intervention_or_exposure="x", comparator=None, outcomes=outcomes,
                     key_findings=[], limitations=[], funding_or_conflicts=None, risk_of_bias="moderate",
                     overall_direction="positive")


def out(name, direction, measure="none", value=None, lo=None, hi=None):
    return {"outcome": name, "result": f"{name}: {direction}", "evidence_quote": "q", "effect_size": None,
            "effect_measure": measure, "effect_value": value, "ci_lower": lo, "ci_upper": hi, "p_value": None,
            "direction": direction}


def ev(ref, category, outcomes, n=None, rob="low", design=None):
    """An evidence paper (the dict shape the synthesis nodes read), with candidate and verification records."""
    card = {"study_design": design or category, "design_category": category, "population": "adults",
            "sample_size": n, "sample_size_quote": None, "intervention_or_exposure": "x", "comparator": "y",
            "outcomes": outcomes, "key_findings": [], "limitations": [], "funding_or_conflicts": None,
            "risk_of_bias": rob, "overall_direction": outcomes[0]["direction"]}
    return paper(ref, card)


def matrix_of(papers, **kw):
    return build_matrix(papers, fallback_clusters(papers), **kw)


# ---- (a) design-category consistency (I-7) ----------------------------------------------------------
SLR_P7_TITLE = "Diabetes, metformin use, and colon cancer: a population-based cohort study in Taiwan"
SLR_P7_ABSTRACT = (f"{SLR_P7_TITLE}\n\nWe followed diabetic patients in the National Health Insurance database and "
                   "compared metformin users with non-users for incident colon cancer.")
META_P5_TITLE = ("Decline in Estimated Glomerular Filtration Rate After Dapagliflozin in Heart Failure With Mildly "
                 "Reduced or Preserved Ejection Fraction: A Prespecified Secondary Analysis of the DELIVER Randomized "
                 "Clinical Trial")


def test_slr_p7_cohort_labelled_rct_becomes_cohort():
    card = settle_design_category(pcard("retrospective cohort study", "rct"), ["Journal Article"])
    fixed, correction = check_design_consistency(card, ["Journal Article"], SLR_P7_TITLE, SLR_P7_ABSTRACT)
    assert fixed.design_category == "cohort"
    assert correction == {"from": "rct", "to": "cohort", "reason": "the design says cohort, with no randomisation"}


def test_meta_p5_secondary_analysis_is_not_a_systematic_review():
    design = "Prespecified secondary analysis of a randomized clinical trial"
    for types in ([], ["Journal Article", "Randomized Controlled Trial"]):
        card = settle_design_category(pcard(design, "sr_ma_rct", n=5788, quote="Study data from 5788 participants"),
                                      types)
        assert card.design_category == "sr_ma_rct"  # the publication types alone allow it...
        fixed, correction = check_design_consistency(card, types, META_P5_TITLE, "")
        assert fixed.design_category == "rct"  # ...the consistency check does not
        assert correction["from"] == "sr_ma_rct" and "secondary or post hoc" in correction["reason"]


def test_other_mislabelled_reviews_take_their_own_design():
    fixed, c = check_design_consistency(pcard("Post hoc analysis of a national registry", "sr_ma_mixed"), [], "t")
    assert fixed.design_category == "cohort" and c["to"] == "cohort"
    fixed, c = check_design_consistency(pcard("Nested case-control study", "sr_ma_observational"), [], "t")
    assert fixed.design_category == "case_control"


def test_qualitative_evidence_syntheses_are_themes_not_pooled_effects():
    # narrative run 4f33f660: five meta-syntheses were labelled sr_ma_observational/sr_ma_mixed
    for design, category, expected in (
            ("Meta-synthesis of qualitative studies", "sr_ma_observational", "qualitative"),  # P12
            ("Systematic review with thematic synthesis", "sr_ma_observational", "qualitative"),  # P13
            ("Thematic synthesis of qualitative and survey studies", "sr_ma_observational", "qualitative"),  # P14
            ("Qualitative meta-synthesis", "sr_ma_observational", "qualitative"),  # P27
            ("Systematic review of qualitative and quantitative studies", "sr_ma_mixed", "mixed_methods")):  # P7
        fixed, c = check_design_consistency(pcard(design, category), ["Systematic Review"], "t")
        assert fixed.design_category == expected, design
        assert c["reason"].startswith("a qualitative evidence synthesis")
        # and the settle step / repair loop no longer push a qualitative synthesis back to SR/MA
        assert settle_design_category(fixed, ["Systematic Review"]).design_category == expected
        assert design_problems(fixed, ["Systematic Review"]) == []


def test_labels_the_evidence_supports_are_kept():
    keep = [
        (pcard("Meta-analysis of observational studies", "sr_ma_observational", n=108161,
               quote="The analysis included five studies comprising 108,161 patients"), [], "a meta-analysis"),  # SLR P2
        (pcard("Phase 3, placebo-controlled randomized trial", "rct"), [], "DAPA-HF"),  # meta P1
        (pcard("Randomized Clinical Trial and Meta-Analysis", "sr_ma_rct"), [], "DAPA ACT HF-TIMI 68"),  # meta P4
        (pcard("Systematic literature review", "sr_ma_observational"), [], "beliefs"),  # narrative P15
        (pcard("Review", "sr_ma_mixed", quote="12 studies were included"), [], "t"),  # counts studies: a review
        (pcard("retrospective cohort study", "rct"), ["Randomized Controlled Trial"], "t"),  # curated pub type wins
        (pcard("Prospective cohort study", "rct"), [], "t"),
    ]
    for card, types, title in keep:
        abstract = "Participants were randomized to drug or placebo." if card.study_design.startswith("Prosp") else ""
        fixed, correction = check_design_consistency(card, types, title, abstract)
        assert correction is None and fixed is card, card.study_design


async def test_reading_corrects_the_label_and_logs_it_in_quality():
    mislabelled = reading.card().model_copy(update={"study_design": "retrospective cohort study",
                                                    "design_category": "rct"})
    res = await make_read_paper(reading.deps(FakeStructuredLLM("ds", lambda s, u: mislabelled)))(reading.payload())
    assert res["papers"][0]["card"]["design_category"] == "cohort"
    entry = res["quality"][0]
    assert entry["design_corrected"]["from"] == "rct" and entry["design_corrected"]["to"] == "cohort"
    summary = summarize_quality([entry, {"stage": "read", "ref": "P2"}], None)
    assert summary["design_corrections"] == [{"ref": "P1", **entry["design_corrected"]}]
    assert summarize_quality([], None)["design_corrections"] == []


# ---- (c) conflicts by the side of the effect (I-11) --------------------------------------------------
def meta_papers(p5_category="rct"):
    """The SGLT2i/HF meta-analysis run (91b5b764). P5's eGFR-association HR 1.33 is an other comparison (Plan 19
    Task 2) and is left out; its randomised renal comparison stays."""
    cvd = "Cardiovascular death or heart failure hospitalization"
    return [
        ev("P1", "rct", [out(cvd, "positive", "HR", 0.74, 0.65, 0.85), out("All-cause mortality", "positive", "HR",
                                                                            0.83, 0.71, 0.97)], n=4744),
        ev("P2", "rct", [out("Heart failure hospitalization", "positive", "HR", 0.73, 0.61, 0.88),
                         out(cvd, "positive", "HR", 0.79, 0.69, 0.90)], n=5988),
        ev("P3", "rct", [out("Clinical benefit composite", "positive", "other", 1.36, 1.09, 1.68),
                         out("Serious adverse events", "positive")], n=530),
        ev("P4", "sr_ma_rct", [out(cvd, "mixed", "HR"), out("All-cause mortality", "mixed", "HR"),
                               out("Renal outcomes", "negative")], rob="moderate"),
        ev("P5", p5_category, [out("Renal outcomes", "null", "HR", 0.94, 0.49, 1.82)], n=5788, rob="moderate"),
    ]


def test_meta_renal_row_is_not_a_conflict():
    # the audit's only "conflict": an SR's harm without numbers vs a non-significant HR 0.94 (no side to compare)
    for category in ("rct", "sr_ma_rct"):  # corrected or as mislabelled in the audit
        m = matrix_of(meta_papers(category))
        assert m["conflicts"] == []
        assert [i["outcome"] for i in m["imprecise"]] == ["Renal outcomes"]


def test_slr_crc_incidence_consensus_keeps_its_reviews():
    # SLR run 84edcb5d: three SR/MAs and two cohorts lower CRC incidence; P12 reports no significant association
    crc = "Incidence of colorectal cancer"
    papers = [ev("P1", "sr_ma_mixed", [out(crc, "positive", "OR", 0.78, 0.70, 0.87)], rob="moderate"),
              ev("P2", "sr_ma_observational", [out(crc, "positive", "RR", 0.63, 0.47, 0.84)], n=108161,
                 rob="moderate"),
              ev("P4", "sr_ma_mixed", [out(crc, "positive", "RR", 0.75, 0.66, 0.86)], rob="moderate"),
              ev("P7", "cohort", [out(crc, "positive")], rob="moderate"),
              ev("P8", "cohort", [out(crc, "positive")], rob="moderate"),
              ev("P12", "cohort", [out(crc, "null")], rob="unclear")]
    m = matrix_of(papers)
    # the primary studies alone are imprecise (2 of 3), so each review counts once: 5 of 6, P12 dissents
    [c] = m["consensus"]
    assert c["refs"] == ["P1", "P2", "P4", "P7", "P8"] and c["dissent"] == {"null": ["P12"]}
    assert m["conflicts"] == []
    g = grade_baseline(papers, m, [crc])
    assert g["level"] == "low"  # the audit's verdict: low certainty, observational
    assert g["factors"][0] == "start low: 3/3 primary studies non-randomized"
    assert not any(f.startswith(("inconsistency:", "imprecision:")) for f in g["factors"])  # n 108,161 via P2
    assert any(f.startswith("mixed significance for the primary outcome") for f in g["factors"])
    assert any("corroborate" in f for f in g["factors"]) and g["factors"][-1] == NOT_ASSESSED


def test_consensus_needs_agreement_in_direction():
    cvd = "CVD"
    agree = [ev("P1", "rct", [out(cvd, "positive", "HR", 0.74)]), ev("P2", "rct", [out(cvd, "null", "HR", 0.92)])]
    assert matrix_of(agree)["consensus"][0]["nonsignificant"] == ["P2"]  # same side, not significant
    split = [ev("P1", "rct", [out(cvd, "positive", "HR", 0.74)]), ev("P2", "rct", [out(cvd, "null", "HR", 1.08)])]
    assert matrix_of(split)["consensus"] == [] and matrix_of(split)["conflicts"][0]["refs"] == ["P1", "P2"]
    # a mixed/unclear cell is not a direction at all
    assert classify_row([{"ref": "P1", "direction": "mixed"}, {"ref": "P2", "direction": "unclear"}]) == {
        "verdict": "none"}


# ---- (b) GRADE-lite tiers (I-13) -----------------------------------------------------------------------
def test_sglt2_rcts_reach_high_and_one_review_never_replaces_them():
    for category, start in (("rct", "4/4"), ("sr_ma_rct", "3/3")):
        papers = meta_papers(category)
        g = grade_baseline(papers, matrix_of(papers))
        assert g["level"] == "high", (category, g)  # the audit run was moderate (graded from P4/P5, renal "conflict")
        assert g["factors"][0] == f"start high: {start} primary studies randomized"


def test_an_observational_review_does_not_make_a_body_of_rcts_start_low():
    rcts = [ev(f"P{i}", "rct", [out("CVD", "positive", "HR", 0.8, 0.7, 0.9)], n=1000) for i in range(1, 4)]
    sr = ev("P4", "sr_ma_mixed", [out("CVD", "positive", "HR", 0.85, 0.8, 0.9)], rob="moderate")
    g = grade_baseline([*rcts, sr], matrix_of([*rcts, sr]))
    assert g["level"] == "high"  # before Plan 19 the one mixed SR was the whole body: start low
    assert "1 systematic review(s)/meta-analysis(es) corroborate" in g["factors"][1]


def test_inconsistency_is_judged_on_the_primary_outcome_only():
    def body(safety_split, primary_split=False):
        papers = []
        for i in range(1, 5):
            primary_dir = "negative" if primary_split and i > 2 else "positive"
            value = 1.25 if primary_dir == "negative" else 0.8
            sae = "negative" if safety_split and i > 2 else "positive"
            papers.append(ev(f"P{i}", "rct", [out("CV death or HF hospitalization", primary_dir, "HR", value),
                                              out("Serious adverse events", sae)], n=1000))
        return papers, grade_baseline(papers, matrix_of(papers), ["cardiovascular death or HF hospitalisation"])

    papers, safety = body(safety_split=True)
    assert matrix_of(papers)["conflicts"][0]["outcome"] == "Serious adverse events"  # still shown and explained
    assert safety["level"] == "high"  # ...but a secondary safety row no longer downgrades
    assert any(f.startswith("conflicting directions in 1 other outcome(s)") for f in safety["factors"])
    _, primary = body(safety_split=False, primary_split=True)
    assert primary["level"] == "moderate"
    assert "inconsistency: studies on opposite sides of no effect for the primary outcome CV death or HF " \
           "hospitalization" in primary["factors"]


def test_sample_size_is_counted_per_outcome():
    papers = [ev("P1", "rct", [out("CVD", "positive", "HR", 0.8)], n=120),
              ev("P2", "rct", [out("CVD", "positive", "HR", 0.7)], n=150),
              ev("P3", "rct", [out("Quality of life", "positive", "MD", 2.0)], n=5000)]
    g = grade_baseline(papers, matrix_of(papers), ["CVD"])
    assert g["level"] == "moderate"  # 120 + 150 for the primary outcome (the summed 5,270 used to pass)
    assert "imprecision: sample size for the primary outcome CVD 270" in g["factors"]


def test_meta_grade_rules_still_absorb_a_baseline_downgrade():
    from app.harness.grade import apply_meta_grade
    papers = [ev("P1", "rct", [out("CVD", "positive", "HR", 0.8)], n=120),
              ev("P2", "rct", [out("CVD", "positive", "HR", 0.7)], n=150)]
    base = grade_baseline(papers, matrix_of(papers), ["CVD"])
    pool = {"i2": 10.0, "pooled": {"y_ci_lower": -0.3, "y_ci_upper": 0.05}}  # CI includes no effect
    grade, reasons = apply_meta_grade(base, [pool], "CVD", "rct")
    assert grade["level"] == base["level"]  # imprecision already downgraded by the per-outcome n: once only
    assert reasons[0].startswith("imprecision (pooled analysis, already downgraded)")


async def test_graph_level_grade_moves_through_normalize_and_pool_effects():
    papers = meta_papers("sr_ma_rct")  # as the audit labelled it
    st = state(papers, options={"review_type": "meta_analysis"}, language="en")
    st["question"]["question_type"] = "therapy"
    normalized = await make_normalize_outcomes(deps())(st)
    m = normalized["matrix"]
    assert m["grade"]["level"] == "high" and m["conflicts"] == []
    pooled = await make_pool_effects(deps())({**st, "matrix": m})
    assert pooled["matrix"]["grade"]["level"] == "high"  # nothing pooled (k < 3): no meta downgrade
    assert pooled["meta_analysis"]["grade"]["reasons"] == []


# ---- (b) the rationale agrees with the factors (I-13e) --------------------------------------------------
META_RATIONALE = ("The rating starts at moderate due to the presence of pooled analyses from randomized trials, but "
                  "is maintained rather than downgraded further because the primary limitation lies in conflicting "
                  "renal outcome definitions.")  # verbatim from the meta run


def test_rationale_problems_and_reconcile():
    factors = ["start high: 3/3 primary studies randomized", "imprecision: sample size for the primary outcome CVD 270",
               NOT_ASSESSED]
    problems = rationale_problems(META_RATIONALE, factors)
    assert any("starts at moderate" in p for p in problems)
    assert any("imprecision downgrade" in p for p in problems)
    assert reconcile_rationale(META_RATIONALE, factors) == ("; ".join(factors), "replaced")
    text, how = reconcile_rationale("Randomized trials with consistent effects [P1].", factors)
    assert how == "appended" and text.endswith("GRADE-lite downgrades: imprecision: sample size for the primary "
                                               "outcome CVD 270.")
    good = "Starting high with randomized trials, downgraded once for imprecision (small sample size) [P1]."
    assert rationale_problems(good, factors) == [] and reconcile_rationale(good, factors) == (good, None)


async def test_write_synthesis_repairs_then_replaces_a_contradicting_rationale():
    factors = ["start high: 2/2 primary studies randomized", "imprecision: sample size for the primary outcome CVD 270",
               NOT_ASSESSED]
    papers = [ev("P1", "rct", [out("CVD", "positive", "HR", 0.8)], n=120),
              ev("P2", "rct", [out("CVD", "positive", "HR", 0.7)], n=150)]
    narrative = SynthesisNarrative(executive_summary="SGLT2 inhibitors probably reduce CVD [P1, P2].",
                                   evidence_strength="moderate", evidence_rationale=META_RATIONALE,
                                   research_gaps=["null", "Longer trials"])
    synth = FakeStructuredLLM("s", lambda s, u: narrative)
    st = state(papers, language="en", conflict_notes=[],
               matrix={"rows": [], "consensus": [], "conflicts": [], "grade": {"level": "moderate", "factors": factors}})
    res = await make_write_synthesis(deps(synthesizer=synth))(st)
    assert len(synth.calls) == 2 and "starts at moderate" in synth.calls[1][1]  # one repair round
    s = res["synthesis"]
    assert s["evidence_rationale"] == "; ".join(factors)
    assert s["research_gaps"] == ["Longer trials"]  # never a "null" gap
    assert next(q for q in res["quality"] if q["stage"] == "prose_check")["rationale_fixed"] == "replaced"


# ---- (c) no direction logic for themes or scoping; no placeholders --------------------------------------------
def themes_papers():
    # narrative run 4f33f660: "Patient-related barriers: findings support the hypothesised effect [P25, P26]" and a
    # "conflict" between a barrier paper and a facilitator paper (P23 vs P26)
    barriers, hcp = "Patient-related barriers to insulin initiation", "Healthcare professional-related barriers"
    return [ev("P23", "cross_sectional", [out(hcp, "negative")]),
            ev("P25", "non_randomized_trial", [out(barriers, "positive")]),
            ev("P26", "cohort", [out(barriers, "positive"), out(hcp, "positive")])]


async def test_themes_review_has_no_consensus_conflicts_or_direction_claims():
    st = state(themes_papers(), language="en", options={"review_type": "narrative",
                                                        "study_types": ["Qualitative", "Mixed methods"]})
    st["question"]["question_type"] = "other"
    assert matrix_of(themes_papers())["consensus"] and matrix_of(themes_papers())["conflicts"]  # what it used to say
    m = (await make_normalize_outcomes(deps())(st))["matrix"]
    assert m["consensus"] == [] and m["conflicts"] == []
    assert {c["direction"] for r in m["rows"] for c in r["cells"]} == {"unclear"}
    synth = FakeStructuredLLM("s", lambda s, u: NarrativeNoGrade(
        executive_summary="Participants described fear of injections [P25, P26].", research_gaps=["Trials"]))
    res = await make_write_synthesis(deps(synthesizer=synth))({**st, "matrix": m, "conflict_notes": []})
    s = res["synthesis"]
    assert s["consensus"] == [] and s["conflicts"] == []
    prompt = synth.calls[0][1]
    assert all(text not in prompt and text not in json.dumps(s) for text in DIRECTION_TEXT.values())
    assert '"direction"' not in re.search(r'"comparison": (\[.*?\])', prompt, flags=re.DOTALL).group(1)


def test_which_questions_get_direction_logic():
    def st(question_type, papers, **options):
        s = state(papers, options=options)
        s["question"]["question_type"] = question_type
        return s

    themes, effects = themes_papers(), meta_papers()
    assert _directional(st("therapy", effects)) is True
    assert _directional(st(None, effects)) is True  # an unrefined question keeps the effect logic
    assert _directional(st("therapy", effects, review_type="scoping")) is False
    assert _directional(st("therapy", effects, study_types=["Qualitative"])) is False
    assert _directional(st("therapy", effects, study_types=["Qualitative", "RCT"])) is True
    assert _directional(st("diagnosis", effects)) is False and _directional(st("prevalence", effects)) is False
    assert _directional(st("other", themes)) is False  # themes or descriptive findings: no estimate
    assert _directional(st("other", effects)) is True  # an "other" question with hazard ratios


async def test_scoping_rows_carry_no_direction_and_no_null_placeholders():
    # scoping run f78b2184: "Research gaps" and "Study designs" rows of direction-null cells (a consensus
    # "Research gaps: findings show no significant association" before Plan 19)
    papers = [ev(f"P{i}", "narrative_review", [out("Research gaps", "null"), out("Study designs", "null")])
              for i in (10, 11, 13)]
    papers[0]["card"]["outcomes"][1]["result"] = "null"
    st = state(papers, language="en", options={"review_type": "scoping"})
    m = (await make_normalize_outcomes(deps())(st))["matrix"]
    assert m["consensus"] == [] and m["conflicts"] == []
    assert {c["direction"] for r in m["rows"] for c in r["cells"]} == {"unclear"}
    assert [c["ref"] for r in m["rows"] if r["outcome"] == "Study designs" for c in r["cells"]] == ["P11", "P13"]
    synth = FakeStructuredLLM("s", lambda s, u: NarrativeNoGrade(
        executive_summary="Most reviews chart retrospective designs [P10, P11].", research_gaps=["N/A", "null",
                                                                                               "Prospective trials"]))
    res = await make_write_synthesis(deps(synthesizer=synth))({**st, "matrix": m, "conflict_notes": []})
    assert res["synthesis"]["research_gaps"] == ["Prospective trials"]


# ---- graph level -------------------------------------------------------------------------------------------
def _by_name(system, user):
    pairs = json.loads(re.search(r"<outcomes>\n(.*)\n</outcomes>", user, flags=re.DOTALL).group(1))
    names = list(dict.fromkeys(p["outcome"] for p in pairs))
    return OutcomeClusters(clusters=[OutcomeCluster(canonical=n, members=[OutcomeMember(**p) for p in pairs
                                                                          if p["outcome"] == n]) for n in names])


def _trial_extractor(design, category):
    def extract(system, user):
        split = "negative" if any(f"Paper {i} about" in user for i in (3, 5, 7)) else "positive"
        base = graph_test.card()
        sae = base.outcomes[0].model_copy(update={
            "outcome": "Serious adverse events", "result": "adverse events", "effect_size": None,
            "effect_measure": "none", "effect_value": None, "ci_lower": None, "ci_upper": None, "p_value": None,
            "direction": split})
        return base.model_copy(update={"study_design": design, "design_category": category, "risk_of_bias": "low",
                                       "outcomes": [base.outcomes[0], sae]})
    return FakeStructuredLLM("ext", extract)


async def test_graph_grade_ignores_a_secondary_conflict_and_follows_design_corrections():
    d = graph_test.make_deps(extractor=_trial_extractor("randomized controlled trial", "rct"))
    d.llms.normalizer = FakeStructuredLLM("norm", _by_name)
    values, _ = await graph_test.run(d, language="en")
    r = values["result"]
    # 8 consistent RCTs on the question's outcome: high, although the safety row splits 5 vs 3 (before: moderate)
    assert r["synthesis_en"]["grade_baseline"] == "high"
    assert [c["statement"] for c in r["synthesis_en"]["conflicts"]] == ["Serious adverse events: studies disagree"]
    assert r["quality"]["design_corrections"] == []

    d = graph_test.make_deps(extractor=_trial_extractor("retrospective cohort study", "rct"))
    d.llms.normalizer = FakeStructuredLLM("norm", _by_name)
    values, _ = await graph_test.run(d, language="en", thread="t2")
    r = values["result"]
    assert {p["card_en"]["design_category"] for p in r["papers"]} == {"cohort"}  # corrected in code
    assert r["synthesis_en"]["grade_baseline"] == "low"  # observational body: start low
    assert len(r["quality"]["design_corrections"]) == 8
