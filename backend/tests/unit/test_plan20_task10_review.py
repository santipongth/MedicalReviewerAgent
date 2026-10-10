"""Plan 20 Task 10 review (task-10-review.md): the reviewer's probes, as regression tests."""
from __future__ import annotations

import pytest

from app.graph.nodes.retrieval import intervention_terms
from app.graph.nodes.synthesis import make_normalize_outcomes
from app.harness.design import check_design_consistency
from app.harness.grade import grade_baseline
from app.harness.matrix import CHARTED, build_matrix, fallback_clusters
from app.harness.trials import own_trial_names, related_reports, trial_acronyms
from app.services.text import strip_markup
from tests.unit.test_design_grade_conflicts import ev, out
from tests.unit.test_nodes_synthesis import deps, state
from tests.unit.test_plan20_engine_evidence import DAPA_HF, PRIMARY, SUBGROUP, report
from tests.unit.test_plan20_engine_reading import pcard


# ---- 1. only real-looking trial names ------------------------------------------------------------------------------
@pytest.mark.parametrize(("title", "abstract"), [
    ("EFFECT OF DRUG X ON HEART FAILURE: A RANDOMIZED CONTROLLED TRIAL", ""),
    ("Drug X in heart failure: A MULTICENTER STUDY", ""),
    ("Drug X", "METHODS A PILOT STUDY was done in 40 adults."),
    ("Drug X", strip_markup("<h4>TRIAL REGISTRATION</h4>ClinicalTrials.gov NCT01234567")),
    ("Drug X", "Unlike earlier SGLT2 trials, a COPD study, ESKD trials, LDL-C trials and PCSK9 trials."),
    ("Drug X", ("Chronic obstructive pulmonary disease (COPD) and heart failure with reduced ejection fraction "
                "(HFrEF) were studied.")),
])
def test_generic_words_and_abbreviations_are_no_trial_names(title, abstract):
    assert trial_acronyms(title, abstract) == []


def test_real_trial_names_are_still_found():
    assert trial_acronyms("t", "In the DELIVER trial and the DAPA-HF study.") == ["DELIVER", "DAPA-HF"]
    assert trial_acronyms("The Empagliflozin Outcome Trial in Patients With Chronic Heart Failure (EMPEROR-Reduced)",
                          "") == ["EMPEROR-Reduced"]
    assert trial_acronyms("DELIVER: a review", "") == []  # a plain capitals word needs a trial context


def test_all_caps_names_next_to_program_are_accepted_unless_stoplisted():  # controller ruling on CANVAS
    assert trial_acronyms("t", "Results from the CANVAS Program were consistent.") == ["CANVAS"]
    assert trial_acronyms("t", "In the CANVAS programme, canagliflozin ...") == ["CANVAS"]
    assert trial_acronyms("t", "We ran a PILOT program and the NIH program funded it.") == []
    assert trial_acronyms("t", "A NATIONAL programme and the CLINICAL program.") == []


def test_two_all_caps_trials_of_different_drugs_are_never_one_trial():
    a = report("P1", "EFFECT OF DRUG A ON HEART FAILURE: A RANDOMIZED CONTROLLED TRIAL", "Patients were randomized.")
    b = report("P2", "EFFECT OF DRUG B ON KIDNEY DISEASE: A RANDOMIZED CONTROLLED TRIAL", "Patients were randomized.")
    assert related_reports([a, b]) == {}


# ---- fix round 2: databases, instruments and programmes never link studies ---------------------------------------
@pytest.mark.parametrize(("source", "drug"), [
    ("Korean National Health Insurance Service (NHIS)", "metformin"),
    ("Taiwan National Health Insurance Research Database (NHIRD)", "metformin"),
    ("Clinical Practice Research Datalink (CPRD)", "statins"),
    ("Supplemental Nutrition Assistance Program (SNAP)", "food vouchers"),
    ("the SNAP program", "food vouchers"),
    ("the PEPFAR program", "antiretroviral therapy"),
])
def test_cohorts_and_programme_evaluations_sharing_a_source_stay_separate(source, drug):
    a = report("P1", f"{drug.capitalize()} and cancer risk: a nationwide cohort",
               f"Methods: We used data from {source} for adults.", category="cohort", n=50000)
    b = report("P2", "Another exposure and kidney outcomes: a nationwide cohort",
               f"Methods: We used data from {source} for adults.", category="cohort", n=70000)
    assert related_reports([a, b]) == {}


def test_instruments_in_brackets_never_link_two_rcts():
    a = report("P1", "Drug A for depression after stroke: a randomised trial",
               "Methods: Mood was measured with the Hospital Anxiety and Depression Scale (HADS).", n=200)
    b = report("P2", "Drug B for depression in heart failure: a randomised trial",
               "Methods: Mood was measured with the Hospital Anxiety and Depression Scale (HADS).", n=300)
    for abbr in ("EORTC", "PROMIS", "BRFSS", "EPDS"):
        assert own_trial_names("t", f"Methods: We assessed the European Organisation Quality Score ({abbr}).") == []
    assert related_reports([a, b]) == {}


def test_canvas_program_reports_still_link():
    main = report("P1", "Canagliflozin and cardiovascular and renal events in type 2 diabetes",
                  "Methods: The CANVAS Program integrated data from two trials. (Funded by Janssen.)", n=10142,
                  year=2017)
    sub = report("P2", "Canagliflozin and heart failure in type 2 diabetes: results from the CANVAS Program",
                 "We assessed heart failure outcomes.", n=10142, year=2018)
    assert related_reports([main, sub]) == {"P2": {"primary": "P1", "reason": "same trial (CANVAS)"}}


@pytest.mark.parametrize("sentence", [
    "Our findings agree with the DAPA-HF trial.",
    "Our results support the findings of the DAPA-HF trial.",
    "The benefit was comparable to the DAPA-HF trial.",
    "These data extend the DAPA-HF trial.",
])
def test_agreeing_or_supporting_a_trial_is_citing_it(sentence):
    small = report("P1", "Dapagliflozin and walking distance in heart failure: a randomized trial",
                   f"Background: Exercise matters. Methods: 120 patients were randomized. Results: Better. "
                   f"Conclusions: {sentence}", n=120)
    assert own_trial_names(small["candidate"]["title"], small["candidate"]["abstract"]) == []
    assert related_reports([DAPA_HF, small]) == {}


def test_the_bare_word_method_is_no_methods_section():
    text = "A novel method improved scoring. Benefit mirrored the DELIVER trial in this cohort."
    assert own_trial_names("Scoring heart failure", text) == []


def test_explicit_self_sentences_and_titles_name_the_own_trial():
    assert own_trial_names("Frailty and empagliflozin", "Background: Frailty matters. The aims of this study were to "
                           "evaluate patients enrolled in the EMPEROR-Preserved trial.") == ["EMPEROR-Preserved"]
    assert own_trial_names("Dapagliflozin after myocardial infarction: the DAPA-MI trial", "") == ["DAPA-MI"]
    assert own_trial_names("Early rehabilitation following stroke: the AVERT trial", "") == ["AVERT"]


# ---- fix round 3: the structural backstop (N8, N9) ----------------------------------------------------------------
@pytest.mark.parametrize("methods", [
    "This randomized trial used the Hospital Anxiety and Depression Scale (HADS) to measure mood.",
    "We conducted a randomised trial using the Hospital Anxiety and Depression Scale (HADS) to measure mood.",
    "Study participants completed the Minnesota Living with Heart Failure Questionnaire (MLHFQ).",
    "In this trial patients completed the Mini Mental State Examination (MMSE) at baseline.",
    "Trial participants were drawn from the Korean National Health Insurance Service (NHIS) database.",
    "Adults enrolled in the SNAP program were randomized to vouchers or usual care.",
    "Adults in the PEPFAR program were randomized.",
    "Adults were recruited from the ARIC study cohort and randomized.",
    "This trial was run by the TIMI Study Group in 40 centres.",
])
def test_two_rcts_sharing_an_instrument_database_or_programme_stay_separate(methods):
    a = report("P1", "Drug A for mood in heart failure: a randomized trial", f"Methods: {methods} Results: Better.",
               n=200)
    b = report("P2", "Drug B for mood after stroke: a randomized trial", f"Methods: {methods} Results: Better.",
               n=300)
    assert related_reports([a, b]) == {}


@pytest.mark.parametrize("abstract", [
    ("Background: The DAPA-HF trial showed that dapagliflozin reduced heart failure events. Methods: We randomized "
     "120 patients to dapagliflozin or placebo. Results: Walking distance improved."),
    ("The DAPA-HF trial showed that dapagliflozin reduced heart failure events. We randomized 120 patients to "
     "dapagliflozin or placebo. Walking distance improved."),
    "In the DAPA-HF trial, dapagliflozin reduced events. We randomized 120 patients. Walking distance improved.",
])
def test_a_trial_opening_with_a_landmark_trial_is_not_absorbed(abstract):
    small = report("P1", "Dapagliflozin and walking distance in heart failure: a randomized trial", abstract, n=120)
    assert related_reports([small, DAPA_HF]) == {}


def test_secondary_reports_of_dapa_hf_and_emperor_still_link():
    secondary = report("P5", "Dapagliflozin and kidney outcomes: a prespecified analysis of the DAPA-HF trial",
                       "Methods: We analysed patients enrolled in the DAPA-HF trial.", n=4744, year=2020)
    other_n = report("P6", "Effect of dapagliflozin by age: insights from DAPA-HF",
                     "Methods: Patients enrolled in the DAPA-HF trial were grouped by age.", n=4500, year=2020)
    links = related_reports([DAPA_HF, secondary, other_n])
    assert links == {"P5": {"primary": "P3", "reason": "same trial (DAPA-HF)"},
                     "P6": {"primary": "P3", "reason": "same trial (DAPA-HF)"}}
    assert set(related_reports([PRIMARY, SUBGROUP])) == {"P7"}


def test_two_primary_reports_of_one_name_need_the_same_n_or_registry():
    a = report("P1", "Drug X in heart failure: the ALPHA-HF trial", "Methods: (ALPHA-HF ClinicalTrials.gov.)", n=900)
    b = report("P2", "Drug X in kidney disease: the ALPHA-HF trial", "Methods: (ALPHA-HF ClinicalTrials.gov.)",
               n=1200)
    assert related_reports([a, b]) == {}
    c = {**b, "card": {**b["card"], "sample_size": 900}}
    assert set(related_reports([a, c])) == {"P2"}


# ---- 2. a cited trial is not the paper's own -------------------------------------------------------------------
def test_a_trial_that_cites_another_is_never_absorbed():
    small = report("P1", "Dapagliflozin and exercise capacity in heart failure: a randomized trial",
                   "Consistent with the DAPA-HF trial, dapagliflozin improved walking distance. As in DAPA-HF, ...",
                   n=120)
    assert own_trial_names(small["candidate"]["title"], small["candidate"]["abstract"]) == []
    assert related_reports([small, DAPA_HF]) == {}


def test_two_registrations_are_two_trials():
    other = report("P9", "Dapagliflozin in the DAPA-HF trial cohort",
                   "Methods: participants of the DAPA-HF trial ... (NCT09999999.)", n=500)
    assert related_reports([DAPA_HF, other]) == {}


# ---- 4. only evidence can be the primary report ------------------------------------------------------------------
def test_a_non_evidence_paper_never_absorbs_a_trial_report():
    cohort = report("P1", "Real-world eligibility for the EMPEROR-Preserved trial in a registry",
                    "We studied a registry.", category="cohort")
    links = related_reports([cohort, SUBGROUP], evidence_refs={"P7"})
    assert "P7" not in links  # the RCT subgroup stays evidence
    commentary = report("P2", "EMPEROR-Preserved and the future of HFpEF care",
                        "This commentary discusses the EMPEROR-Preserved trial.",
                        pub_types=("comment",))
    assert related_reports([commentary, SUBGROUP]) == {"P2": {"primary": "P7",
                                                              "reason": "same trial (EMPEROR-Preserved)"}}
    assert related_reports([commentary, SUBGROUP], evidence_refs=set()) == {}  # nothing is evidence: no links


async def test_out_of_scope_papers_are_not_primary_in_the_graph():
    cohort = report("P1", "Empagliflozin in heart failure: EMPEROR-Preserved trial participants in a registry",
                    "Methods: we followed EMPEROR-Preserved trial participants in a registry.", category="cohort")
    st = state([cohort, {**PRIMARY, "ref": "P2"}], language="en",
               options={"review_type": "slr", "study_types": ["RCT"]},
               question={"refined_question": "q", "outcomes": ["HF hospitalization"]})
    m = (await make_normalize_outcomes(deps())(st))["matrix"]
    assert [c["ref"] for r in m["rows"] for c in r["cells"]] == ["P2"]  # the RCT report is the evidence


# ---- 5. a cap, not a downgrade -------------------------------------------------------------------------------------
def test_one_large_cohort_keeps_low_and_one_rct_is_capped_at_moderate():
    cohort = [ev("P1", "cohort", [out("CRC", "positive", "HR", 0.8, 0.7, 0.9)], n=50000, rob="moderate")]
    assert grade_baseline(cohort, build_matrix(cohort, fallback_clusters(cohort)), ["CRC"])["level"] == "low"
    rct = [ev("P1", "rct", [out("CRC", "positive", "HR", 0.8, 0.7, 0.9)], n=5000)]
    g = grade_baseline(rct, build_matrix(rct, fallback_clusters(rct)), ["CRC"])
    assert g["level"] == "moderate" and any("capped at moderate" in f for f in g["factors"])


# ---- 6 and 7. design rules ---------------------------------------------------------------------------------------
def test_a_non_randomised_trial_labelled_rct_is_corrected():
    card = pcard("non-randomised controlled trial of a screening programme", "rct")
    fixed, fix = check_design_consistency(card, [], "AI-supported screening", "Two regions were compared.")
    assert fixed.design_category == "non_randomized_trial" and fix is not None


def test_sensitivity_analyses_do_not_make_a_review_of_rcts_mixed():
    sr = pcard("Systematic review and meta-analysis of randomized trials with sensitivity analyses", "sr_ma_rct")
    assert check_design_consistency(sr, [], "Drug X: a meta-analysis", "") == (sr, None)


# ---- 9. scoping cells carry no free text ------------------------------------------------------------------------
def test_scoping_matrix_cells_only_chart_coverage():
    papers = [ev("P1", "cohort", [out("Software", "unclear")]), ev("P2", "cohort", [out("Software", "unclear")])]
    m = build_matrix(papers, fallback_clusters(papers), directional=False, charted=True)
    assert {c["finding"] for r in m["rows"] for c in r["cells"]} == {CHARTED}


# ---- 10. generic words never widen the intervention scope --------------------------------------------------------
def test_comparator_terms_sharing_a_generic_word_are_not_intervention_terms():
    q = {"intervention_or_exposure": "SGLT2 inhibitors",
         "key_terms": [{"term": "SGLT2 inhibitors", "mesh": None, "synonyms": ["gliflozins"]},
                       {"term": "DPP-4 inhibitors", "mesh": None, "synonyms": ["gliptins"]},
                       {"term": "standard therapy", "mesh": None, "synonyms": []}]}
    assert intervention_terms(q) == ["SGLT2 inhibitors", "gliflozins"]
