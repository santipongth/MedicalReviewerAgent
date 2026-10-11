"""Plan 20 Task 10 fix round 5 (task-10-rereview-4.md): N20, N21, N22 and the wrong-level token removal."""
from __future__ import annotations

import pytest

from app.graph.nodes.synthesis import (
    ANSWER_CERTAINTY,
    _bottom_line,
    _fallback_answer,
    _split_sentences,
)
from app.harness.prose import prose_context
from app.harness.trials import is_secondary_report, own_trial_names, related_reports
from tests.unit.test_comparison_and_prose import SLR_PAPERS
from tests.unit.test_plan20_engine_evidence import DAPA_HF, report

CTX = prose_context(SLR_PAPERS, texts=["Does metformin reduce colorectal cancer in type 2 diabetes?"])
ALLOWED = {p["ref"] for p in SLR_PAPERS}
LOW = ANSWER_CERTAINTY["low"]


def answer(text: str, strength: str | None = "low") -> tuple[str, int]:
    return _bottom_line(text, CTX, ALLOWED, no_pool=False, strength=strength)


# ---- N20: no split after common abbreviations -------------------------------------------------------------------
@pytest.mark.parametrize("text", [
    "Metformin vs. Sulfonylureas may lower CRC incidence.",
    "Metformin may lower CRC incidence, e.g. In older adults.",
    "Metformin may lower CRC incidence, i.e. Fewer cancers.",
    "Smith et al. Reported a lower CRC incidence.",
    "The dose was approx. Two grams.",
    "See Fig. Two for the CRC incidence.",
    "Trial No. Four reported the CRC incidence.",
    "Patients from J. Smith's cohort may have fewer cancers.",
])
def test_the_splitter_keeps_abbreviations_inside_their_sentence(text):
    assert _split_sentences(text) == [text]
    assert _split_sentences(f"{text} Mortality may fall.") == [text, "Mortality may fall."]


def test_an_abbreviation_never_cuts_a_sentence_before_a_removal():
    text = "Metformin may lower CRC incidence (vs. Sulfonylureas: the certainty of the evidence is high)."
    out, _ = answer(text)
    assert not out.startswith("Metformin may lower CRC incidence (vs. The")
    assert out.endswith(LOW)


# ---- optional token: only a wrong-level label goes, with its brackets and separator -------------------------------
@pytest.mark.parametrize(("text", "strength", "expected", "removed"), [
    ("Metformin may lower CRC incidence (high-certainty evidence).", "low", "Metformin may lower CRC incidence.", 1),
    ("Metformin may lower CRC incidence (High certainty evidence) in adults.", "low",
     "Metformin may lower CRC incidence in adults.", 1),
    ("Metformin may lower CRC incidence (GRADE: high).", "low", "Metformin may lower CRC incidence.", 1),
    ("Metformin may lower CRC incidence; GRADE: high.", "low", "Metformin may lower CRC incidence.", 1),
    ("Metformin may lower CRC incidence (high-certainty evidence). GRADE: high.", "low",
     "Metformin may lower CRC incidence.", 2),
    ("Metformin may lower CRC incidence (low-certainty evidence).", "low",
     "Metformin may lower CRC incidence (low-certainty evidence).", 0),
    ("Metformin may lower CRC incidence (GRADE: very low).", "very_low",
     "Metformin may lower CRC incidence (GRADE: very low).", 0),
])
def test_a_wrong_level_label_is_removed_with_its_brackets(text, strength, expected, removed):
    out, n = answer(text, strength)
    assert out == f"{expected} {ANSWER_CERTAINTY[strength]}" and n == removed


def test_labels_stay_in_ungraded_answers_and_the_crash_fallback_removes_them_too():
    text = "Metformin may lower CRC incidence (high-certainty evidence)."
    assert answer(text, None)[0] == text
    assert _fallback_answer(text, set(), no_pool=False, strength="low") == f"Metformin may lower CRC incidence. {LOW}"


# ---- N21: "according to ... in X" needs a trial name; design text needs a report about this paper ----------------
@pytest.mark.parametrize("title", [
    "Procalcitonin-guided antibiotic duration according to severity in COPD exacerbations: a randomized trial",
    "Oxygen targets according to baseline PaO2 in ICU patients: a randomized trial",
    "Dose adjustment according to renal function in HIV: a randomized trial",
    "Exercise training according to baseline fitness in ARIC participants: a randomized trial",
])
def test_according_to_a_disease_or_setting_acronym_is_no_secondary_cue(title):
    assert not is_secondary_report(report("P1", title, "We randomized adults."))


@pytest.mark.parametrize("title", [
    "Dapagliflozin according to baseline blood pressure in the DAPA-HF trial",
    "Effects of dapagliflozin according to age in DAPA-HF",
    "Canagliflozin according to baseline risk in the CANVAS Program",
])
def test_according_to_in_a_trial_name_is_still_a_secondary_cue(title):
    assert is_secondary_report(report("P1", title, "We analysed patients."))


@pytest.mark.parametrize(("design", "secondary"), [
    ("Multicentre RCT with prespecified subgroup analyses by sex", False),
    ("Randomized controlled trial; secondary analyses of quality of life", False),
    ("RCT, exploratory analysis of biomarkers", False),
    ("Double-blind RCT; baseline characteristics balanced", False),
    ("RCT (ancillary analyses planned)", False),
    ("This prespecified subgroup analysis of a randomized trial", True),
    ("A secondary analysis of the DAPA-HF trial", True),
    ("Post hoc analysis of a randomised controlled trial", True),
    ("Echocardiographic substudy of the DAPA-HF trial", True),
])
def test_design_text_cues_must_describe_this_paper(design, secondary):
    p = report("P1", "Drug X in heart failure: a randomized trial", "We randomized adults.")
    p["card"]["study_design"] = design
    assert is_secondary_report(p) is secondary


ARIC_OWNER_ABSTRACT = ("We randomized 300 adults recruited from the Atherosclerosis Risk in Communities (ARIC) study. "
                       "Results: Better.")
ARIC_ABSTRACT = ("Methods: Adults recruited from the Atherosclerosis Risk in Communities (ARIC) study were randomized. "
                 "Results: Better.")


def _rct(ref, title, abstract, n, design=None):
    p = report(ref, title, abstract, n=n)
    if design:
        p["card"]["study_design"] = design
    return p


@pytest.mark.parametrize(("title", "design"), [
    ("Exercise training according to baseline fitness in ARIC participants: a randomized trial", None),
    ("Statin therapy and blood pressure: a randomized trial", "Multicentre RCT with prespecified subgroup analyses by sex"),
])
def test_independent_aric_rcts_stay_separate(title, design):
    owner = _rct("P2", "Exercise training and blood pressure: a randomized trial", ARIC_OWNER_ABSTRACT, 300)
    assert related_reports([_rct("P1", title, ARIC_ABSTRACT, 200, design), owner]) == {}


# ---- N22: a we-sentence names the paper's own trial only with an ownership verb aimed at it ----------------------
@pytest.mark.parametrize("abstract", [
    "We enrolled 120 patients who met the DAPA-HF trial criteria. Walking distance improved.",
    "We followed the DAPA-HF trial protocol in 120 patients. Walking distance improved.",
    "Methods: We randomized 120 outpatients with HFrEF using the dosing of the DAPA-HF trial. Results: Better.",
    "We randomized 300 adults recruited from the Atherosclerosis Risk in Communities (ARIC) study.",
])
def test_a_we_sentence_citing_a_trial_is_no_explicit_owner(abstract):
    assert own_trial_names("Drug X: a randomized trial", abstract, explicit=True) == []


@pytest.mark.parametrize(("abstract", "name"), [
    ("We conducted the ALPHA-HF trial in 40 centres.", "ALPHA-HF"),
    ("We designed the ALPHA-HF trial to test drug X.", "ALPHA-HF"),
    ("We performed the ALPHA-HF study in adults.", "ALPHA-HF"),
    ("We report the results of the ALPHA-HF trial.", "ALPHA-HF"),
    ("We reported the primary results of the ALPHA-HF trial.", "ALPHA-HF"),
    ("In the ALPHA-HF trial, we randomized 900 patients.", "ALPHA-HF"),
    ("In the ALPHA-HF trial, we randomised 900 patients.", "ALPHA-HF"),
    ("In the ALPHA-HF trial, we assigned 900 patients to drug X.", "ALPHA-HF"),
])
def test_ownership_verbs_aimed_at_the_trial_name_it_explicitly(abstract, name):
    assert own_trial_names("Drug X: a randomized trial", abstract, explicit=True) == [name]


SUBSTUDY = _rct("P5", "Dapagliflozin and cardiac remodelling: an echocardiographic substudy of DAPA-HF",
                "Methods: We analysed 100 patients enrolled in the DAPA-HF trial with paired echocardiograms.", 100)


@pytest.mark.parametrize("abstract", [
    "We enrolled 120 patients who met the DAPA-HF trial criteria. Walking distance improved.",
    "We followed the DAPA-HF trial protocol in 120 patients. Walking distance improved.",
    "Methods: We randomized 120 outpatients with HFrEF using the dosing of the DAPA-HF trial. Results: Better.",
])
def test_a_small_rct_citing_dapa_hf_never_absorbs_its_substudy(abstract):
    small = _rct("P1", "Dapagliflozin and walking distance: a randomized trial", abstract, 120)
    assert related_reports([small, SUBSTUDY]) == {}
    assert related_reports([small, SUBSTUDY, DAPA_HF]) == {"P5": {"primary": "P3", "reason": "same trial (DAPA-HF)"}}
