"""Per-type prompt builders. The SLR prompts are pinned by hash of the pre-Plan-14a strings: SLR must not change."""
import hashlib

import pytest

from app.graph import prompts
from app.graph.schemas import KeyTerm, ReviewQuestion
from app.harness.question import question_problems

OPTIONS = {"year_from": 2015, "study_types": ["RCT"]}
QUESTION = {"refined_question": "Q?", "sub_questions": ["a", "b"], "population": "P",
            "intervention_or_exposure": "I", "comparator": "C", "outcomes": ["o"], "study_designs": ["rct"],
            "key_terms": [{"term": "t", "synonyms": ["s"], "mesh": "M"}]}


def sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


SYSTEM_HASHES = {
    # Plan 19 (prompt_version 2026-10-10.5, audit I-15): refine and critique stay within the user's scope (harm/safety
    # only for an unrestricted therapy/prevention effect question; the critic removes unrequested sub-questions instead
    # of asking for safety), and the screener excludes an already-diagnosed population for an incidence question.
    # 2026-10-10.6 (Task 6 review): that screener rule is scoped to first-occurrence (incidence / primary prevention)
    # questions, excepts recurrence, progression and secondary prevention, and applies to SLR-like types only (the
    # narrative and scoping override blocks switch it off).
    "refine_system": (prompts.refine_system, "f99a1d12f460a02c1007b06f1b026315be1b14e474d5076866210b8834b5084f"),
    "critique_system": (prompts.critique_system, "9ac2baeaa7cfc551d12d82a877851b4993d8f6b9b0ecfab116fc156aadc1be04"),
    "plan_system": (prompts.plan_system, "4511213da99591cdf2d72fa93f128ca7fde79a50495585e8689cca18bf71bd58"),
    "screen_system": (prompts.screen_system, "f5ae19b693f69e3a1fe2269319bd337de895958530496317e8a6783437175e0c"),
    # Plan 19 (prompt_version 2026-10-10.3): extraction states each outcome's comparison and matches_question
    # (audit I-2a); the narrative gets the other-comparison, number/measure, population and GRADE certainty-wording
    # rules (audit I-2b/c, I-14).
    "extract_system": (prompts.extract_system, "be79abbcebcf454162d8f7d58245103387e748d2c33e52e066bae146ac5841fa"),
    # Plan 20 (prompt_version 2026-10-10.7, report audit issues 1-3): the narrative also writes `answer` (a 1-2
    # sentence bottom line with the GRADE certainty wording) and 3-5 numberless `key_findings` (outcome, statement,
    # refs); the report renders their numbers from the verified cards and the computed pools. Current version
    # 2026-10-10.8 changed only the qualitative screen/extract blocks (appended when ticked), so these SLR pins hold.
    "narrative_system": (prompts.narrative_system, "16278465ee36d386eede4011a039ce7adf15588592669958c92883bcc06b3b7d"),
}


@pytest.mark.parametrize("name", SYSTEM_HASHES)
def test_slr_system_prompts_are_unchanged(name):
    builder, digest = SYSTEM_HASHES[name]
    assert sha(builder("slr")) == digest


CARD = {"title": "T", "year": 2020, "journal": "J", "pub_types": ["RCT"], "abstract": "Abs"}


def test_slr_later_stage_user_prompts_are_unchanged():
    assert sha(prompts.screen_user(english_topic="Q?", plan={"population": "P", "inclusion_criteria": ["a"]},
                                   items=[("C1", CARD), ("C2", {"title": "U"})])) ==         "3e9906647439f78cf429360bc578915c6e5d3180ad29d01537f4c095a0378c70"
    assert sha(prompts.extract_user(question="Q?", outcomes=["o"], candidate=CARD, source="abstract",
                                    text="Text")) ==         "16c0dfb7d2a853fec55729acff0ba3814e4a6e8bb86557ae5ff87e05010cbab0"  # Plan 19: comparison in example + checklist
    assert sha(prompts.normalize_user(question="Q?", pairs=[("P1", "o")])) ==         "a8f11049113c154762d69c6a196ff66233f7fdf824dcfd7724f007a17d1f26ce"
    assert sha(prompts.conflict_user(question="Q?", conflict={"outcome": "o", "refs": ["P1"]},
                                     papers=[{"ref": "P1"}])) ==         "3db817d97a68c42a77255b9dfb6a3919f7cf838e75a874241b6b9ef303f533c2"
    assert sha(prompts.narrative_user(question="Q?", sub_questions=["a"], papers=[{"ref": "P1"}],
                                      matrix={"rows": [], "consensus": []}, conflict_notes=[],
                                      baseline={"level": "low", "factors": ["f"]})) ==         "d5b909e35096435c3529ef70f3f03ce6e2fab864eaaddd8a2217370d078fc345"  # Plan 20: answer/key_findings checklist item
    ext = [{"tool": "t", "arguments": {}, "text": "x", "ok": True}]
    assert sha(prompts.narrative_user(question="Q?", sub_questions=[], papers=[], matrix={}, conflict_notes=[],
                                      baseline={}, external_context=ext)) ==         "cc8e09279b3c3e4ccb2822b3e1f16e2909890353e6ab4dddfb44c558f126353f"  # Plan 20


def test_slr_user_prompts_are_unchanged():
    assert sha(prompts.refine_user(topic="t", english_topic="e", options=OPTIONS)) == \
        "bdcacd6caee94d2c1e5cd44595d3c3a6eca98f8eb58bf38fe956ccc79534d195"
    assert sha(prompts.critique_user(topic="t", question=QUESTION, options=OPTIONS)) == \
        "9ab45fa08d89b6909c98a327f9f878f9681efca8d4b818bc8639128e257df733"
    assert sha(prompts.plan_user(topic="t", english_topic="e", options=OPTIONS, question=QUESTION)) == \
        "350972bf8305e1a387fcd65baee38ed8b6da9fb63e41b2b816d2ff079422d0eb"
    assert sha(prompts.plan_user(topic="t", english_topic="e", options=OPTIONS)) == \
        "62e2aa279649c998d48524f49a328bded2a683f672f70caaba24927e20b3e082"


@pytest.mark.parametrize("name", ["plan_system", "screen_system", "narrative_system",
                                  "critique_system", "refine_system"])
@pytest.mark.parametrize("rt", ["narrative", "scoping"])
def test_other_types_differ_from_slr(name, rt):
    builder, _ = SYSTEM_HASHES[name]
    assert builder(rt) != builder("slr")


def test_extraction_differs_only_for_scoping():
    assert prompts.extract_system("narrative") == prompts.extract_system("slr")
    assert prompts.extract_system("scoping") != prompts.extract_system("slr")


@pytest.mark.parametrize("name", list(SYSTEM_HASHES))
def test_unknown_type_falls_back_to_slr(name):
    builder, _ = SYSTEM_HASHES[name]
    assert builder("bogus") == builder("slr")


def test_scoping_refine_uses_pcc():
    system = prompts.refine_system("scoping")
    assert system == prompts.REFINE_SYSTEM_PCC
    assert "PCC" in system and "concept" in system and "context" in system
    assert "concept" in prompts.refine_checklist("scoping")
    assert prompts.refine_checklist("slr") == prompts.REFINE_CHECKLIST
    assert prompts.refine_system("narrative").startswith(prompts.REFINE_SYSTEM)


def test_scoping_plan_user_lists_pcc():
    q = {**QUESTION, "concept": "telehealth", "context": "rural primary care"}
    body = prompts.plan_user(topic="t", english_topic="e", options={}, question=q, review_type="scoping")
    assert "Concept: telehealth" in body and "Context: rural primary care" in body


def pcc_question(**kw):
    base = {
        "question_type": "other", "interpretation": "Map the evidence on telehealth.",
        "refined_question": "What evidence exists on telehealth delivery in rural primary care settings worldwide?",
        "population": "adults in rural communities", "intervention_or_exposure": "telehealth", "comparator": "",
        "outcomes": ["access to care", "patient satisfaction"], "study_designs": ["any"], "timeframe": None,
        "sub_questions": ["Which study designs are used?"],
        "key_terms": [KeyTerm(term="telehealth", synonyms=["telemedicine"], mesh="Telemedicine")],
        "assumptions": [], "ambiguities": [], "concept": "telehealth", "context": "rural primary care",
    }
    base.update(kw)
    return ReviewQuestion(**base)


def test_scoping_accepts_empty_comparator():
    assert question_problems(pcc_question(), {}, "scoping") == []


@pytest.mark.parametrize("field", ["concept", "context"])
@pytest.mark.parametrize("value", [None, "  "])
def test_scoping_requires_concept_and_context(field, value):
    problems = question_problems(pcc_question(**{field: value}), {}, "scoping")
    assert any(field in p for p in problems)


def test_scoping_requires_intervention_or_exposure():
    assert any("intervention_or_exposure" in p
               for p in question_problems(pcc_question(intervention_or_exposure=""), {}, "scoping"))


def test_scoping_does_not_require_comparator_for_therapy():
    q = pcc_question(question_type="therapy")
    assert question_problems(q, {}, "scoping") == []
    assert any("comparator" in p for p in question_problems(q, {}, "slr"))


def test_pico_types_do_not_need_concept():
    q = pcc_question(concept=None, context=None, comparator="usual care", question_type="therapy")
    assert question_problems(q, {}, "slr") == []
    assert question_problems(q, {}, "narrative") == []


def test_review_question_schema_requires_nullable_concept_and_context():
    schema = ReviewQuestion.model_json_schema()
    assert {"concept", "context"} <= set(schema["required"])
    assert "default" not in schema["properties"]["concept"]
    assert "default" not in schema["properties"]["context"]


@pytest.mark.parametrize("builder,base", [
    (prompts.refine_system, prompts.REFINE_SYSTEM), (prompts.critique_system, prompts.CRITIQUE_SYSTEM),
    (prompts.plan_system, prompts.PLAN_SYSTEM), (prompts.screen_system, prompts.SCREEN_SYSTEM),
    (prompts.narrative_system, prompts.NARRATIVE_SYSTEM)])
@pytest.mark.parametrize("rt", ["narrative", "scoping"])
def test_appended_type_blocks_state_that_they_override(builder, base, rt):
    system = builder(rt)
    if system == prompts.REFINE_SYSTEM_PCC:
        return  # scoping refine is a dedicated PCC prompt, not an appended block
    assert system.startswith(base) and prompts.OVERRIDE_LEAD in system[len(base):]
    assert sha(builder("slr")) == sha(base)


def test_scoping_extract_block_states_that_it_overrides():
    assert prompts.OVERRIDE_LEAD in prompts.extract_system("scoping")
