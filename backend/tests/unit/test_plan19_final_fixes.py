"""Plan 19 final whole-branch review fixes: other-comparison directions (finding 3), research gaps and likely
reasons number-checked (6), failure-isolated deterministic steps (9), the study-type filter re-applied after a design
correction (10) and the design-mismatch flag (11). Findings 1, 4, 7 and 8 are tested next to their code
(test_comparison_and_prose, test_design_grade_conflicts, test_plan19_task6, test_harness_localize)."""
import copy

import pytest

from app.graph.nodes import reading as reading_node
from app.graph.nodes import synthesis as synthesis_node
from app.graph.nodes.reading import make_read_paper
from app.graph.nodes.synthesis import (
    GRADE_FAILED_FACTOR,
    PROSE_REMOVED,
    _evidence,
    _narrative_papers,
    design_excluded,
    make_explain_conflict,
    make_finalize,
    make_normalize_outcomes,
    make_write_synthesis,
)
from app.graph.schemas import ConflictNote, PaperCard, SynthesisNarrative
from app.harness.comparison import question_direction, settle_comparisons
from app.harness.quality import summarize_quality
from app.services.llm_config import HarnessSpec
from tests.fakes import FakeStructuredLLM
from tests.unit import test_nodes_reading as rd
from tests.unit.test_comparison_and_prose import (
    METFORMIN_Q,
    SLR_PAPERS,
    card,
    conflict_payload,
    narrative,
    outcome,
    paper,
    slr_state,
)
from tests.unit.test_nodes_synthesis import deps, state


# ---- finding 3: other comparisons never drive the per-paper direction ------------------------------------------
def test_only_other_comparisons_makes_the_overall_direction_unclear():
    c = PaperCard.model_validate(card([outcome("crc", "HR", 0.54, 0.46, 0.64, comparison="GLP-1RAs vs insulin")],
                                      intervention="Prescription of GLP-1RAs"))
    assert c.overall_direction == "positive"
    settled, flipped = settle_comparisons(c, METFORMIN_Q)
    assert flipped == 1 and settled.overall_direction == "unclear"


def test_model_flagged_other_comparisons_also_clear_the_direction():
    c = PaperCard.model_validate(card([outcome("crc", "HR", 0.54, 0.46, 0.64, matches=False)]))
    settled, flipped = settle_comparisons(c, None)  # no refined question: the backstop is skipped, the flag stands
    assert flipped == 0 and settled.overall_direction == "unclear"


def test_mixed_cards_take_the_direction_of_the_matching_outcomes():
    def o(direction, matches=True):
        return outcome("x", "HR", 0.8, 0.7, 0.9, direction=direction, matches=matches)

    cards = {
        "null": [o("null"), o("positive", matches=False)],
        "mixed": [o("null"), o("negative"), o("positive", matches=False)],
    }
    for expected, outcomes in cards.items():
        c = PaperCard.model_validate(card(outcomes))
        assert settle_comparisons(c, None)[0].overall_direction == expected
    plain = PaperCard.model_validate(card([o("null")]))  # no other comparison: the model's overall direction stays
    assert settle_comparisons(plain, None)[0] is plain and plain.overall_direction == "positive"
    assert question_direction([], "positive") == "positive"


async def test_extracted_event_direction_is_unclear_for_an_other_comparison_paper(monkeypatch):
    events = []
    monkeypatch.setattr(reading_node, "progress_writer", lambda: events.append)
    other = rd.card()
    other = other.model_copy(update={"outcomes": [other.outcomes[0].model_copy(update={"matches_question": False})]})
    primary = FakeStructuredLLM("ds", lambda s, u: other)
    out = await make_read_paper(rd.deps(primary, harness=HarnessSpec(dual_extraction=False)))(rd.payload())
    assert out["papers"][0]["card"]["overall_direction"] == "unclear"
    assert next(e for e in events if e["type"] == "extracted")["direction"] == "unclear"


# ---- finding 6: research gaps and likely reasons are number-checked ---------------------------------------------
async def test_research_gaps_are_number_checked():
    answer = SynthesisNarrative(executive_summary="Metformin may lower CRC incidence [P1, P2].",
                                evidence_strength="low", evidence_rationale="Observational evidence [P1].",
                                research_gaps=["Only 2 of 12 trials reported mortality.",
                                               "Trials in type 2 diabetes are needed.",
                                               "Longer follow-up is needed."])
    synth = FakeStructuredLLM("s", lambda s, u: answer)
    out = await make_write_synthesis(deps(synthesizer=synth))(slr_state())
    assert out["synthesis"]["research_gaps"] == ["Trials in type 2 diabetes are needed.", "Longer follow-up is needed."]
    assert next(e for e in out["quality"] if e["stage"] == "prose_check")["numbers_removed"] == 1


async def test_likely_reasons_are_number_checked():
    llm = FakeStructuredLLM("c", lambda s, u: ConflictNote(
        outcome="x", refs=["P1"], explanation="Designs differed [P1, P2].",
        likely_reasons=["follow-up of 18 months vs 5 years", "different comparators"]))
    out = await make_explain_conflict(deps(conflict_explainer=llm))(conflict_payload())
    note = out["conflict_notes"][0]
    assert note["likely_reasons"] == ["different comparators"] and note["explanation"] == "Designs differed [P1, P2]."
    assert out["quality"][0]["prose_numbers_removed"] == 1


# ---- finding 9: deterministic steps never fail the review --------------------------------------------------------
def boom(*args, **kwargs):
    raise ValueError("unexpected shape")


@pytest.mark.parametrize("name", ["build_matrix", "grade_baseline"])
async def test_matrix_and_grade_failures_fall_back(monkeypatch, name):
    monkeypatch.setattr(synthesis_node, name, boom)
    out = await make_normalize_outcomes(deps())(state(copy.deepcopy(SLR_PAPERS[:2]), language="en"))
    m = out["matrix"]
    assert m["grade"]["level"] in ("very_low", "low", "moderate", "high")
    if name == "build_matrix":
        assert m["rows"] == [] and m["conflicts"] == [] and out["quality"][0]["matrix_failed"] is True
    else:
        assert m["grade"] == {"level": "very_low", "factors": [GRADE_FAILED_FACTOR]}
        assert out["quality"][0]["grade_failed"] is True
    assert any("failed: ValueError" in e for e in out["errors"])


async def test_prose_check_crash_fails_closed(monkeypatch):
    monkeypatch.setattr(synthesis_node, "fix_prose", boom)
    monkeypatch.setattr(synthesis_node, "prose_problems", boom)
    synth = FakeStructuredLLM("s", lambda s, u: narrative("Metformin may lower CRC incidence [P1]."))
    out = await make_write_synthesis(deps(synthesizer=synth))(slr_state())
    s = out["synthesis"]
    assert len(synth.calls) == 1  # the validator's crash is not a repair round
    assert s["executive_summary"] == PROSE_REMOVED and s["research_gaps"] == []
    assert s["evidence_rationale"] == "start low: 3/3 non-randomized studies"
    assert next(e for e in out["quality"] if e["stage"] == "prose_check")["check_failed"] is True
    assert any("grounded-prose check failed" in e for e in out["errors"])
    assert summarize_quality(out["quality"], None)["prose_check"]["check_failed"] is True
    plain = [{"stage": "prose_check", "numbers_removed": 0}]
    assert "check_failed" not in summarize_quality(plain, None)["prose_check"]


async def test_conflict_prose_check_crash_uses_the_deterministic_note(monkeypatch):
    monkeypatch.setattr(synthesis_node, "fix_prose", boom)
    llm = FakeStructuredLLM("c", lambda s, u: ConflictNote(outcome="x", refs=["P1"], likely_reasons=["dose"],
                                                           explanation="Doses differed [P1, P2]."))
    out = await make_explain_conflict(deps(conflict_explainer=llm))(conflict_payload())
    assert out["conflict_notes"][0]["explanation"].startswith("Studies report different directions")
    assert out["quality"][0]["prose_check_failed"] is True and out["errors"]


async def test_reconcile_rationale_crash_falls_back_to_the_factors(monkeypatch):
    monkeypatch.setattr(synthesis_node, "reconcile_rationale", boom)
    synth = FakeStructuredLLM("s", lambda s, u: narrative("Metformin may lower CRC incidence [P1]."))
    out = await make_write_synthesis(deps(synthesizer=synth))(slr_state())
    assert out["synthesis"]["evidence_rationale"] == "start low: 3/3 non-randomized studies"
    assert next(e for e in out["quality"] if e["stage"] == "prose_check")["rationale_fixed"] == "replaced"
    assert any("rationale reconciliation failed" in e for e in out["errors"])


@pytest.mark.parametrize("name", ["settle_comparisons", "check_design_consistency"])
async def test_reading_post_checks_never_fail_the_paper(monkeypatch, name):
    monkeypatch.setattr(reading_node, name, boom)
    primary = FakeStructuredLLM("ds", lambda s, u: rd.card())
    out = await make_read_paper(rd.deps(primary, harness=HarnessSpec(dual_extraction=False)))(rd.payload())
    entry = out["papers"][0]
    assert entry["card"] is not None and entry["error"] is None
    assert entry["card"]["outcomes"][0]["effect_value"] == 0.8
    assert any("check failed for P1: ValueError" in e for e in out["errors"])


# ---- finding 10: the ticked study types are re-applied to the design as read ---------------------------------
def rct_review(papers):
    return state(papers, language="en", options={"study_types": ["RCT"]})


def test_a_paper_read_as_another_design_leaves_the_evidence():
    papers = [paper("P1", card([outcome("CRC", "HR", 0.8, 0.7, 0.9)], design="rct")),
              paper("P2", card([outcome("CRC", "HR", 0.7, 0.6, 0.8)], design="cohort")),  # screener said rct
              paper("P3", card([outcome("CRC", "HR", 0.9, 0.8, 1.0)], design="cohort")) | {"design_mismatch": True},
              paper("P4", card([outcome("CRC", "HR", 0.9, 0.8, 1.0)], design="other"))]  # undecided: stays
    st = rct_review(papers)
    assert design_excluded(st) == ["P2"]
    assert [p["ref"] for p in _evidence(st)] == ["P1", "P3", "P4"]
    assert [p["ref"] for p in _narrative_papers(st)] == ["P1", "P3", "P4"]
    nothing_ticked = state(copy.deepcopy(papers), language="en")
    assert design_excluded(nothing_ticked) == [] and len(_evidence(nothing_ticked)) == 4


async def test_design_excluded_is_logged_and_counted():
    papers = [paper("P1", card([outcome("CRC", "HR", 0.8, 0.7, 0.9)], design="rct")),
              paper("P2", card([outcome("CRC", "HR", 0.7, 0.6, 0.8)], design="cohort"))]
    st = rct_review(papers)
    out = await make_normalize_outcomes(deps())(st)
    assert out["quality"][0]["design_excluded"] == ["P2"]
    assert {c["ref"] for r in out["matrix"]["rows"] for c in r["cells"]} == {"P1"}
    final = await make_finalize(deps())({**st, "topic": "t", "synthesis": None})
    stats = final["result"]["stats"]
    assert stats["excluded_selection"]["study_design_corrected"] == 1
    assert [p["ref"] for p in final["result"]["papers"]] == ["P1", "P2"]  # still listed with its card


# ---- finding 11: design mismatch is not "the models disagreed" --------------------------------------------------
async def test_design_mismatch_is_its_own_flag():
    primary = FakeStructuredLLM("ds", lambda s, u: rd.card())
    p = rd.payload()
    p["paper"] |= {"design_mismatch": True}
    out = await make_read_paper(rd.deps(primary, harness=HarnessSpec(dual_extraction=False)))(p)
    v = out["papers"][0]["verification"]
    assert v["design_mismatch"] is True and v["uncertain"] is False
    assert out["papers"][0]["design_mismatch"] is True
    plain = await make_read_paper(rd.deps(FakeStructuredLLM("ds", lambda s, u: rd.card()),
                                          harness=HarnessSpec(dual_extraction=False)))(rd.payload())
    assert "design_mismatch" not in plain["papers"][0]["verification"]
