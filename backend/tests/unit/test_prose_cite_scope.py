"""Plan 30: a citation written after the stop is checked against its own sentence, and the quick answer's limits
sentence never gives a person advice."""
import pytest

from app.graph.nodes.quick import closing_line
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
