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
    commentary = report("P2", "EMPEROR-Preserved and the future of HFpEF care", "On the EMPEROR-Preserved trial.",
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
