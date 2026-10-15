"""Plan 30: a citation written after the stop is checked against its own sentence, and the quick answer's limits
sentence never gives a person advice."""
import pytest

from app.graph.nodes.quick import _is_advice, closing_line
from app.graph.nodes.quick import _sentences as quick_sentences
from app.graph.nodes.synthesis import ANSWER_CERTAINTY
from app.harness.prose import _sentences, fix_prose, fix_statement, prose_problems
from tests.unit.test_comparison_and_prose import META_PAPERS, ctx
from tests.unit.test_quick_answer import ctx as quick_ctx


def test_a_citation_after_the_stop_joins_its_sentence_inside_the_stop():
    text = "Dapagliflozin lowered worsening heart failure (HR 0.74). [P1] Empagliflozin lowered it too [P2]."
    assert _sentences(text) == ["Dapagliflozin lowered worsening heart failure (HR 0.74) [P1].",
                                "Empagliflozin lowered it too [P2]."]
    assert _sentences("It fell (HR 0.74). [P1]") == ["It fell (HR 0.74) [P1]."]
    assert _sentences("It fell (HR 0.74). [P1] [P2]") == ["It fell (HR 0.74) [P1] [P2]."]


def test_a_leading_citation_stays_when_the_sentence_before_already_cites():
    text = "It fell (HR 0.74) [P1]. [P2] reported a smaller effect."
    assert _sentences(text) == ["It fell (HR 0.74) [P1].", "[P2] reported a smaller effect."]
    # a lone group after a cited sentence still belongs to it (nothing else to attach it to)
    assert _sentences("It fell (HR 0.74) [P1]. [P2]") == ["It fell (HR 0.74) [P1] [P2]."]


def test_a_number_is_checked_against_the_paper_cited_after_the_stop():
    c = ctx(META_PAPERS)
    wrong = "Empagliflozin lowered heart failure hospitalisation (HR 0.74). [P2]"  # 0.74 is P1's, not P2's
    right = "Dapagliflozin lowered worsening heart failure (HR 0.74). [P1]"
    problems = prose_problems(wrong, c, "executive_summary")
    assert len(problems) == 1 and "states 0.74" in problems[0] and "(P2)" in problems[0]
    assert fix_prose(wrong, c) == ("", {"numbers_removed": 1})
    assert prose_problems(right, c, "executive_summary") == []
    assert fix_prose(right, c) == ("Dapagliflozin lowered worsening heart failure (HR 0.74) [P1].", {})


def test_a_numberless_statement_is_scoped_the_same_way():
    c = ctx(META_PAPERS)
    text, counts = fix_statement("Empagliflozin reduced events by 0.74. [P2]", c)
    assert text == "" and counts == {"numbers_removed": 1}


@pytest.mark.parametrize("advice", [
    "Patients should stop taking metformin before surgery.", "Take the drug with food.",
    "Do not stop treatment without asking a doctor.", "You should talk to your doctor first.",
    "Please consult a pharmacist.", "People must not switch brands.", "Don't use it in pregnancy.",
])
def test_a_limits_sentence_that_advises_a_person_is_dropped(advice):
    assert closing_line(advice, quick_ctx(), "low") == ANSWER_CERTAINTY["low"]
    assert closing_line(f"{advice} All studies were observational.", quick_ctx(), "low") == \
        f"{ANSWER_CERTAINTY['low']} All studies were observational."


@pytest.mark.parametrize("limits", [
    "Use of statins was self-reported.", "Never-smokers were excluded from two cohorts.",
    "Patients should be followed up longer in future trials.", "Starting doses varied between studies.",
    "All studies were observational cohorts, so confounding may remain.",
])
def test_research_wording_is_not_advice(limits):
    assert closing_line(limits, quick_ctx(), "low") == f"{ANSWER_CERTAINTY['low']} {limits}"


def test_a_group_that_starts_a_new_clause_stays_with_it():
    assert _sentences("Results were mixed. [P2] found a hazard ratio of 0.74.") == [
        "Results were mixed.", "[P2] found a hazard ratio of 0.74."]
    assert _sentences("Risk fell (HR 0.74). [P1] [P2] reported a smaller effect.") == [
        "Risk fell (HR 0.74).", "[P1] [P2] reported a smaller effect."]
    assert _sentences("Results were mixed. [P2] Another trial found less.") == [
        "Results were mixed [P2].", "Another trial found less."]
    c = ctx(META_PAPERS)
    text = "Results were mixed. [P2] found a hazard ratio of 0.74 for hospitalisation."
    fixed, counts = fix_prose(text, c)
    assert "[P2]. found" not in fixed and counts == {"numbers_removed": 1}


def test_a_piece_left_with_only_punctuation_is_dropped():
    assert _sentences("Risk fell. [P1]. Next.") == ["Risk fell [P1].", "Next."]


@pytest.mark.parametrize("advice", [
    "Consider checking renal function.", "Seek medical help if symptoms worsen.",
    "Women should avoid it in pregnancy.", "Clinicians should consider dose reduction.",
    "Speak to your doctor.",
])
def test_more_advice_is_dropped(advice):
    assert closing_line(advice, quick_ctx(), "low") == ANSWER_CERTAINTY["low"]


@pytest.mark.parametrize("limits", [
    "Use was self-reported.", "Stop rules were not reported.", "Increase in dose was rare.",
    "Never users served as controls.", "Trials did not report what your risk would be.",
])
def test_ordinary_limitations_are_kept(limits):
    assert closing_line(limits, quick_ctx(), "low") == f"{ANSWER_CERTAINTY['low']} {limits}"


@pytest.mark.parametrize("text, expected", [
    ("Risk was lower (HR 0.55). [P2] The trial found less harm.",
     ["Risk was lower (HR 0.55).", "[P2] The trial found less harm."]),
    ("Results were mixed. [P2] This cohort reported no effect.",
     ["Results were mixed.", "[P2] This cohort reported no effect."]),
    ("Results were mixed. [P2] Smith et al. reported no effect.",
     ["Results were mixed.", "[P2] Smith et al. reported no effect."]),
    ("Results were mixed. [P2] Their large registry showed less harm.",
     ["Results were mixed.", "[P2] Their large registry showed less harm."]),
])
def test_a_group_naming_its_study_as_subject_stays_with_it(text, expected):
    assert _sentences(text) == expected


def test_the_plan_30_lifts_still_hold():
    assert _sentences("Results were mixed. [P2] Another trial found less.") == [
        "Results were mixed [P2].", "Another trial found less."]
    assert _sentences("Risk fell. [P1] The. [P2]") == ["Risk fell [P1].", "The [P2]."]  # "The." names no study


def test_the_quick_path_uses_the_same_rule():
    assert quick_sentences(["Risk was lower (HR 0.55). [P2] The trial found less harm [P3]."]) == [
        "Risk was lower (HR 0.55).", "[P2] The trial found less harm [P3]."]
    assert quick_sentences(["Risk fell. [P1] Cohorts agree. [P2]"]) == ["Risk fell [P1].", "Cohorts agree [P2]."]


@pytest.mark.parametrize("advice", [
    "Patients may want to discuss this with a doctor.", "It is advisable to consult a doctor.",
    "It is best to avoid alcohol.", "It is recommended that patients stop the drug.",
    "Patients are advised to stop the drug.", "Those taking warfarin should avoid it.",
    "Women who are pregnant should not take it.", "One should avoid it.", "Individuals should consult a doctor.",
    "We recommend avoiding it.", "Check with a pharmacist.", "Contact a doctor if symptoms worsen.",
    "Get tested before starting.", "Call your doctor.", "If you take it, stop.", "You can ask your pharmacist.",
    "It is important to stop the drug before surgery.",
])
def test_more_advice_shapes_are_dropped(advice):
    assert _is_advice(advice)
    assert closing_line(advice, quick_ctx(), "low") == ANSWER_CERTAINTY["low"]


@pytest.mark.parametrize("limits", [
    "See Table 2 for details.", "Consult the full review for the excluded studies.",
    "Do not over-interpret these results.", "Try to interpret the pooled estimate with caution.",
    "Use caution when interpreting the subgroup results.", "Trials did not assess what you would experience.",
    "Trials in women should use longer follow-up.", "Future studies in older adults should consider frailty.",
    "It is important to note that the trials were small.", "Call rates were not reported.",
    "Checklists were incomplete in two trials.",
])
def test_research_wording_that_looked_like_advice_is_kept(limits):
    assert not _is_advice(limits)
    assert closing_line(limits, quick_ctx(), "low") == f"{ANSWER_CERTAINTY['low']} {limits}"
