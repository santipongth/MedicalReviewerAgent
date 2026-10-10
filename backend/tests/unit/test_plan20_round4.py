"""Plan 20 Task 10 fix round 4 (task-10-rereview-3.md): N10, N14, N15, N16 and N17, with the re-review's probes."""
from __future__ import annotations

import pytest

from app.graph.nodes.synthesis import (
    ANSWER_CERTAINTY,
    _bottom_line,
    _certainty_lead,
    _fallback_answer,
)
from app.harness.prose import prose_context
from app.harness.trials import is_secondary_report, related_reports
from tests.unit.test_comparison_and_prose import SLR_PAPERS
from tests.unit.test_plan20_engine_evidence import DAPA_HF, PRIMARY, report

CTX = prose_context(SLR_PAPERS, texts=["Does metformin reduce colorectal cancer in type 2 diabetes?"])
ALLOWED = {p["ref"] for p in SLR_PAPERS}
LOW = "Low-certainty evidence suggests: "


def answer(text: str, strength: str | None) -> str:
    return _bottom_line(text, CTX, ALLOWED, no_pool=False, strength=strength)[0]


# ---- N10: no level is ever rewritten; the canonical certainty sentence is always appended -------------------------
@pytest.mark.parametrize(("text", "strength"), [
    ("Metformin may lower CRC incidence, but high-certainty evidence is lacking.", "low"),
    ("Metformin may lower CRC incidence; high-certainty evidence from larger trials is needed.", "low"),
    ("In the absence of high-certainty evidence, metformin may lower CRC incidence.", "low"),
    ("Metformin may lower CRC incidence; there is little high-certainty evidence.", "low"),
    ("Metformin may lower CRC incidence, although few trials provide high-certainty evidence.", "low"),
    ("Neither high-certainty nor moderate-certainty evidence shows that metformin lowers CRC incidence.", "low"),
    ("Metformin may lower CRC incidence, but it is unclear whether high-certainty evidence will emerge.", "low"),
    (("Earlier reviews reported high-certainty evidence; this review finds low-certainty evidence that metformin "
      "may lower CRC incidence."), "low"),
    ("Metformin may lower CRC incidence; the certainty of evidence was high for incidence but low for mortality.",
     "low"),
    (("Metformin probably lowers CRC incidence (moderate-certainty evidence), but evidence for mortality is "
      "low-certainty."), "moderate"),
    ("Metformin may lower CRC incidence; there is no high-certainty evidence.", "low"),
    ("Metformin may lower CRC incidence; the certainty of the evidence is not high.", "low"),
    ("In earlier reviews, the certainty of the evidence was high. Metformin may lower CRC incidence.", "low"),
    ("Metformin may lower risk in patients at high risk.", "low"),
])
def test_level_words_outside_the_narrow_self_claims_are_untouched(text, strength):
    assert answer(text, strength) == f"{text} {ANSWER_CERTAINTY[strength]}"


@pytest.mark.parametrize(("text", "strength", "expected"), [
    ("Metformin lowers CRC incidence. The certainty of the evidence is high.", "low", "Metformin lowers CRC incidence."),
    ("Metformin may lower CRC incidence. The quality of the evidence was moderate.", "low",
     "Metformin may lower CRC incidence."),
    ("Metformin may lower CRC incidence. Overall, the certainty of evidence for this review is very low.", "low",
     "Metformin may lower CRC incidence."),
    ("High-certainty evidence shows that metformin lowers CRC incidence. Metformin may reduce mortality.", "low",
     "Metformin may reduce mortality."),
    ("Moderate certainty evidence suggests metformin lowers CRC incidence. Mortality may fall.", "low",
     "Mortality may fall."),
])
def test_a_self_claim_naming_another_level_is_removed_never_rewritten(text, strength, expected):
    out, removed = _bottom_line(text, CTX, ALLOWED, no_pool=False, strength=strength)
    assert out == f"{expected} {ANSWER_CERTAINTY[strength]}" and removed == 1


def test_a_self_claim_of_the_final_level_stays_and_the_sentence_is_not_doubled():
    text = "Metformin may lower CRC incidence. The certainty of the evidence is low."
    assert answer(text, "low") == text
    led = "Low-certainty evidence suggests that metformin may lower CRC incidence."
    assert answer(led, "low") == f"{led} {ANSWER_CERTAINTY['low']}"


def test_ungraded_answers_get_no_certainty_sentence_and_lose_nothing():
    text = "Metformin may lower CRC incidence. The certainty of the evidence is high."
    assert answer(text, None) == text


def test_a_removal_that_would_empty_the_answer_leaves_the_certainty_sentence():
    out, _ = _bottom_line("The certainty of the evidence is moderate.", CTX, ALLOWED, no_pool=False, strength="low")
    assert out == ANSWER_CERTAINTY["low"]


def test_the_restored_answer_still_loses_a_wrong_self_claim(monkeypatch):
    from collections import Counter

    from app.graph.nodes import synthesis as s

    monkeypatch.setattr(s, "fix_statement", lambda text, prose, refs=None: ("", Counter(population_removed=1)))
    out, removed = s._bottom_line("Metformin lowers CRC risk in children. The certainty of the evidence is high.",
                                  CTX, ALLOWED, no_pool=False, strength="low")
    assert out == f"Metformin lowers CRC risk in children. {ANSWER_CERTAINTY['low']}" and removed == 0


# ---- N16: the crash fallback applies the same narrow removal and appends the certainty sentence -----------------
@pytest.mark.parametrize(("text", "strength", "expected"), [
    # fix round 5: the wrong-level label goes as a token (test_plan20_round5.py has the label cases)
    ("Metformin lowers CRC incidence (high-certainty evidence).", "low",
     "Metformin lowers CRC incidence. The certainty of the evidence is low."),
    ("The certainty of the evidence is high. Metformin may lower CRC incidence [P1].", "low",
     "Metformin may lower CRC incidence. The certainty of the evidence is low."),
    ("Metformin may lower CRC incidence. The certainty of the evidence is low.", "low",
     "Metformin may lower CRC incidence. The certainty of the evidence is low."),
    ("Metformin may lower CRC incidence. The certainty of the evidence is high.", None,
     "Metformin may lower CRC incidence. The certainty of the evidence is high."),
    ("The risk fell by 20%.", "moderate", ANSWER_CERTAINTY["moderate"]),
    ("The risk fell by 20%.", None, ""),
])
def test_the_crash_fallback_removes_wrong_self_claims_and_appends_the_certainty(text, strength, expected):
    assert _fallback_answer(text, {"P1"}, no_pool=False, strength=strength) == expected


# ---- N17: a hedge in one clause does not hide a causal claim in another --------------------------------------
@pytest.mark.parametrize(("statement", "strength", "led"), [
    ("Patients with a higher BMI may benefit; metformin reduces CRC incidence.", "low", True),
    ("The effect is uncertain in women, but metformin reduces CRC incidence in men.", "low", True),
    ("The evidence is very uncertain, but metformin reduces CRC incidence.", "very_low", False),
    ("Metformin may reduce CRC incidence.", "low", False),
    ("Metformin reduces CRC incidence; the effect is uncertain in women.", "low", True),
])
def test_the_hedge_test_works_per_clause(statement, strength, led):
    out, was_led = _certainty_lead(statement, strength)
    assert was_led is led and out.endswith(statement)


# ---- N14: only report-type phrases make a secondary report ---------------------------------------------------
@pytest.mark.parametrize("title", [
    "Haloperidol for delirium in patients in the intensive care unit: a randomized trial",
    "Cinacalcet for secondary hyperparathyroidism: a randomized trial",
    "Ocrelizumab in secondary progressive multiple sclerosis: a randomized trial",
    "Ticagrelor for secondary prevention after stroke: a randomized trial",
    "Long-term efficacy of semaglutide: a randomized controlled trial",
    "Effect of X on blood pressure: results from a randomized trial",
    "Drug X in heart failure: a randomized trial with 12-month follow-up",
    "Ticagrelor dosing according to CYP2C19 genotype: a randomized trial",
])
def test_primary_rct_titles_are_not_secondary_reports(title):
    assert not is_secondary_report(report("P1", title, "We randomized adults."))


@pytest.mark.parametrize("design", [
    "Randomized secondary prevention trial",
    "Randomized controlled trial with 12-month follow-up",
    "RCT of patients in the emergency department",
    "Open-label extension randomized trial",
    "Long-term randomized trial; data from 40 centres",
])
def test_primary_rct_designs_are_not_secondary_reports(design):
    p = report("P1", "Drug X in heart failure: a randomized trial", "We randomized adults.")
    p["card"]["study_design"] = design
    assert not is_secondary_report(p)


@pytest.mark.parametrize("title", [
    "Dapagliflozin and kidney outcomes: a prespecified analysis of the DAPA-HF trial",
    "Dapagliflozin and atrial fibrillation: a post hoc analysis of DAPA-HF",
    "Effect of dapagliflozin by age: insights from DAPA-HF",
    "Dapagliflozin in patients without diabetes: a subgroup analysis of DAPA-HF",
    "Dapagliflozin according to baseline blood pressure in the DAPA-HF trial",
    "Long-term follow-up of the DAPA-HF trial",
    "An extension study of the DAPA-HF trial",
    "Quality of life with dapagliflozin: a report from the DAPA-HF trial",
    "Dapagliflozin and anaemia: a DAPA-HF substudy",
])
def test_report_type_phrases_make_a_secondary_report(title):
    assert is_secondary_report(report("P1", title, "We analysed patients."))


def _rct(ref: str, title: str, abstract: str, n: int, design: str | None = None) -> dict:
    p = report(ref, title, abstract, n=n)
    if design:
        p["card"]["study_design"] = design
    return p


ARIC = "Methods: Adults were recruited from the Atherosclerosis Risk in Communities Study (ARIC) and randomized."


@pytest.mark.parametrize(("design_a", "design_b", "methods"), [
    ("Randomized secondary prevention trial", None, ARIC),
    ("Randomized controlled trial with 12-month follow-up", "Randomized controlled trial with 6-month follow-up", ARIC),
    ("secondary prevention", None, "Methods: Adults from the ARIC study cohort were randomized."),
    ("RCT of patients in the emergency department", "RCT of patients in the emergency department",
     "Methods: Patients were randomized in the HOPE-ED trial network."),
    ("Open-label extension randomized trial", None, "Methods: Adults in the STRONG-HF programme were randomized."),
])
def test_independent_rcts_with_primary_like_cues_stay_separate(design_a, design_b, methods):
    a = _rct("P1", "Drug A for blood pressure: a randomized trial", f"{methods} Results: Better.", 200, design_a)
    b = _rct("P2", "Drug B for lipids: a randomized trial", f"{methods} Results: Better.", 300, design_b)
    assert related_reports([a, b]) == {}


@pytest.mark.parametrize(("title", "abstract", "design"), [
    ("Long-term dapagliflozin and walking distance in heart failure: a randomized trial",
     "Methods: Patients resembled those enrolled in the DAPA-HF trial. We randomized 150 patients.", None),
    ("Dapagliflozin and walking distance in heart failure: a randomized trial",
     "Methods: Patients resembled those enrolled in the DAPA-HF trial. We randomized 150 patients.",
     "RCT with 24-week follow-up"),
    ("Long-term dapagliflozin and walking distance: a randomized trial",
     "We enrolled 120 patients who met the DAPA-HF trial criteria. Walking distance improved.", None),
    ("Long-term dapagliflozin and walking distance: a randomized trial",
     "We followed the DAPA-HF trial protocol in 120 patients. Walking distance improved.", None),
    ("Long-term dapagliflozin and walking distance: a randomized trial",
     "Methods: Using the DAPA-HF trial design, 120 patients were randomized. Results: Better.", None),
    ("Long-term dapagliflozin and walking distance: a randomized trial",
     "Background: Patients randomized in the DAPA-HF trial had fewer events. Methods: We randomized 120 patients.",
     None),
])
def test_a_small_rct_naming_dapa_hf_is_not_absorbed(title, abstract, design):
    small = _rct("P1", title, abstract, 150, design)
    assert related_reports([small, DAPA_HF]) == {}


# ---- N15: a secondary report never joins a smaller or weakly named owner ------------------------------------
SMALL_OWNER = _rct("P1", "Dapagliflozin and exercise capacity: a randomized trial",
                   "Methods: Patients resembled those enrolled in the DAPA-HF trial. We randomized 80 patients.", 80)
POST_HOC = _rct("P5", "Dapagliflozin and atrial fibrillation: a post hoc analysis of DAPA-HF",
                "Methods: We analysed patients enrolled in the DAPA-HF trial.", 4744)
SUBGROUP_REPORT = _rct("P7", "Dapagliflozin in patients without diabetes: a subgroup analysis of DAPA-HF",
                       "Methods: We analysed patients enrolled in the DAPA-HF trial without diabetes.", 1983)


def test_a_landmark_secondary_report_is_not_absorbed_by_a_small_trial():
    assert related_reports([SMALL_OWNER, POST_HOC]) == {}
    assert related_reports([SMALL_OWNER, SUBGROUP_REPORT]) == {}


def test_secondary_reports_without_their_primary_group_among_themselves():
    assert related_reports([SMALL_OWNER, POST_HOC, SUBGROUP_REPORT]) == {
        "P7": {"primary": "P5", "reason": "same trial (DAPA-HF)"}}


def test_an_owner_naming_the_trial_only_in_its_methods_absorbs_no_secondary_report():
    weak = _rct("P1", "Dapagliflozin in heart failure: a randomized trial",
                "Methods: The DAPA-HF trial protocol guided dosing. Results: Better.", 5000)
    assert related_reports([weak, SUBGROUP_REPORT]) == {}


def test_real_secondary_reports_still_join_their_primary_report():
    assert related_reports([DAPA_HF, POST_HOC, SUBGROUP_REPORT]) == {
        "P5": {"primary": "P3", "reason": "same trial (DAPA-HF)"},
        "P7": {"primary": "P3", "reason": "same trial (DAPA-HF)"}}
    frailty = _rct("P8", "Empagliflozin and frailty: a secondary analysis of the EMPEROR-Preserved trial",
                   "Methods: We analysed patients enrolled in the EMPEROR-Preserved trial.", 5988)
    assert related_reports([PRIMARY, frailty]) == {"P8": {"primary": "P1", "reason": "same trial (EMPEROR-Preserved)"}}
    larger = _rct("P9", "Empagliflozin and frailty: a secondary analysis of the EMPEROR-Preserved trial",
                  "Methods: We analysed patients enrolled in the EMPEROR-Preserved trial.", 9000)
    assert related_reports([PRIMARY, larger]) == {}  # a secondary report cannot be larger than its trial
