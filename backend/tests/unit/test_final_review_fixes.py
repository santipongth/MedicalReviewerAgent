"""Plan 14a final-review fixes: per-type direction, narrative review articles, scoping result shape, stub."""
import json
import re

import pytest

from app.graph import prompts
from app.graph.nodes import reading
from app.graph.nodes.intake import _draft_dump
from app.graph.nodes.reading import make_read_paper
from app.graph.nodes.stub_result import stub_result
from app.graph.nodes.synthesis import make_finalize, make_write_synthesis
from app.graph.schemas import NarrativeNoGrade, SynthesisNarrative
from app.services.report import render_csv
from tests.fakes import FakeStructuredLLM
from tests.unit.test_nodes_reading import card as read_card
from tests.unit.test_nodes_reading import deps as read_deps
from tests.unit.test_nodes_reading import payload as read_payload
from tests.unit.test_nodes_synthesis import card, deps, matrix_for, paper, state
from tests.unit.test_prompts_by_type import OPTIONS, QUESTION, sha
from tests.unit.test_review_graph import QUESTION as REVIEW_QUESTION


def no_grade(summary):
    return NarrativeNoGrade(executive_summary=summary, research_gaps=["more"])


def options(review_type):
    return {"review_type": review_type}


def evidence_of(user):
    return json.loads(re.search(r"<evidence>\n(.*)\n</evidence>", user, flags=re.DOTALL).group(1))


# ---- 1: the extracted event carries no direction for scoping -----------------------------------
@pytest.mark.parametrize("review_type, has_direction", [("scoping", False), ("slr", True), ("narrative", True)])
async def test_extracted_event_direction_only_outside_scoping(monkeypatch, review_type, has_direction):
    events = []
    monkeypatch.setattr(reading, "progress_writer", lambda: events.append)
    primary = FakeStructuredLLM("ds", lambda s, u: read_card())
    await make_read_paper(read_deps(primary))({**read_payload(), "review_type": review_type})
    extracted = next(e for e in events if e["type"] == "extracted")
    assert ("direction" in extracted) is has_direction
    assert extracted["design"] == "cohort"


# ---- 2: pin the scoping result shape (raw agent extraction stays in the JSON) ---------------------
async def test_scoping_result_keeps_raw_direction_fields_but_the_csv_blanks_them():
    papers = [paper("P1", card()), paper("P2", card(direction="negative"))]
    syn = FakeStructuredLLM("ds", lambda s, u: no_grade("Mapped [P1, P2]."))
    st = state(papers, matrix=matrix_for(papers), conflict_notes=[], language="en", options=options("scoping"),
               selected=[{}, {}])
    st |= await make_write_synthesis(deps(synthesizer=syn))(st)
    result = (await make_finalize(deps())(st))["result"]
    assert result["review_type"] == "scoping"
    assert result["synthesis"]["consensus"] == [] and result["synthesis"]["conflicts"] == []
    assert result["synthesis"]["evidence_strength"] is None
    # raw per-paper agent extraction is still present; the report and CSV do not show it
    assert result["papers"][0]["card"]["overall_direction"] == "positive"
    assert result["papers"][0]["card"]["risk_of_bias"] == "moderate"
    assert result["papers"][0]["card"]["outcomes"][0]["direction"] == "positive"
    assert result["synthesis"]["comparison"][0]["cells"][0]["direction"] == "positive"
    body = "\n".join(render_csv(result).lstrip("﻿").splitlines()[1:])
    assert "positive" not in body and "moderate" not in body


# ---- 3: narrative reviews reach the narrative synthesis --------------------------------------------
def review_article(ref):
    return paper(ref, {**card(), "design_category": "narrative_review"})


async def test_narrative_type_gives_review_articles_to_the_synthesizer_and_allows_citing_them():
    papers = [paper("P1", {**card(), "design_category": "cohort"}), review_article("P2")]
    syn = FakeStructuredLLM("ds", lambda s, u: no_grade("Overview [P1] and review [P2]."))
    out = await make_write_synthesis(deps(synthesizer=syn))(
        state(papers, matrix=matrix_for(papers[:1]), conflict_notes=[], language="en",
              options=options("narrative")))
    assert {p["ref"] for p in evidence_of(syn.calls[0][1])["papers"]} == {"P1", "P2"}
    assert out["synthesis"]["executive_summary"] == "Overview [P1] and review [P2]."  # not stripped
    assert [r["cells"][0]["ref"] for r in out["synthesis"]["comparison"]] == ["P1"]  # the matrix stays as before


async def test_narrative_type_with_only_review_articles_does_not_report_extraction_failed():
    papers = [review_article("P1")]
    syn = FakeStructuredLLM("ds", lambda s, u: no_grade("Reviews say [P1]."))
    out = await make_write_synthesis(deps(synthesizer=syn))(
        state(papers, matrix={"rows": [], "consensus": [], "conflicts": [], "grade": {}}, conflict_notes=[],
              language="en", options=options("narrative"), selected=[{}]))
    assert "could not extract" not in out["synthesis"]["executive_summary"]
    assert out["synthesis"]["executive_summary"] == "Reviews say [P1]."


async def test_slr_still_leaves_review_articles_out_of_the_synthesis():
    papers = [paper("P1", {**card(), "design_category": "cohort"}), review_article("P2")]
    syn = FakeStructuredLLM("ds", lambda s, u: SynthesisNarrative(
        executive_summary="A [P1].", evidence_strength="low", evidence_rationale="r", research_gaps=["g"]))
    await make_write_synthesis(deps(synthesizer=syn))(
        state(papers, matrix=matrix_for(papers[:1]), conflict_notes=[], language="en"))
    assert [p["ref"] for p in evidence_of(syn.calls[0][1])["papers"]] == ["P1"]


# ---- 4: SLR critique prompt is built from the real dump path -----------------------------------------
def test_slr_critique_draft_has_no_pcc_fields_and_matches_the_pin_through_the_real_dump():
    q = REVIEW_QUESTION.model_copy(update={"concept": "x", "context": "y"})
    dumped = _draft_dump(q, "slr")
    assert set(dumped) == set(REVIEW_QUESTION.model_dump()) - {"concept", "context"}
    assert _draft_dump(q, "narrative") == dumped
    assert _draft_dump(q, "scoping")["concept"] == "x"
    # the pinned hash is of the pre-plan prompt built from the pre-plan field set
    assert sha(prompts.critique_user(topic="t", question=QUESTION, options=OPTIONS)) == \
        "9ab45fa08d89b6909c98a327f9f878f9681efca8d4b818bc8639128e257df733"
    pre_plan = ["question_type", "interpretation", "refined_question", "population", "intervention_or_exposure",
                "comparator", "outcomes", "study_designs", "timeframe", "sub_questions", "key_terms",
                "assumptions", "ambiguities"]
    assert list(dumped) == pre_plan  # same keys in the same order as before the plan


# ---- 5: stub scoping result matches the pipeline -----------------------------------------------------
def test_stub_scoping_result_is_consistent_with_the_pipeline():
    r = stub_result("t", "en", "scoping")
    assert r["synthesis"]["consensus"] == [] and r["synthesis"]["conflicts"] == []
    q = r["question"]
    assert q["framework"] == "PCC" and q["concept"] and q["context"]
    assert r["stats"]["selected"] == len(r["papers"]) == r["stats"]["extracted"]
    slr = stub_result("t", "en", "slr")
    assert slr["question"]["framework"] == "PICO" and slr["question"]["concept"] is None
    assert slr["synthesis"]["consensus"] and slr["synthesis"]["conflicts"]


# ---- 8: scoping synthesis prompt carries no direction-based consensus or cell directions --------------
async def test_scoping_synthesis_prompt_has_no_consensus_or_cell_directions():
    papers = [paper("P1", card()), paper("P2", card())]
    syn = FakeStructuredLLM("ds", lambda s, u: no_grade("Mapped [P1, P2]."))
    await make_write_synthesis(deps(synthesizer=syn))(
        state(papers, matrix=matrix_for(papers), conflict_notes=[], language="en", options=options("scoping")))
    evidence = evidence_of(syn.calls[0][1])
    assert evidence["consensus"] == []
    assert all("direction" not in c for row in evidence["comparison"] for c in row["cells"])
    assert evidence["comparison"][0]["cells"][0]["ref"] == "P1"


async def test_narrative_type_prompt_keeps_cell_directions():
    papers = [paper("P1", card()), paper("P2", card())]
    syn = FakeStructuredLLM("ds", lambda s, u: no_grade("Mapped [P1, P2]."))
    await make_write_synthesis(deps(synthesizer=syn))(
        state(papers, matrix=matrix_for(papers), conflict_notes=[], language="en", options=options("narrative")))
    evidence = evidence_of(syn.calls[0][1])
    assert evidence["consensus"] and evidence["comparison"][0]["cells"][0]["direction"] == "positive"
