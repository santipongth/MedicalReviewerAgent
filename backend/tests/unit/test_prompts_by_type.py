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
    "refine_system": (prompts.refine_system, "c98080d63c4f2c0e1da703789486dad2de1ec2907bb6d7cd9a857da9f9ddfe7c"),
    "critique_system": (prompts.critique_system, "20dcf2409037bf9ae5854d99b6f9e870af67ac11f80060fe90edc460f86d02d4"),
    "plan_system": (prompts.plan_system, "4511213da99591cdf2d72fa93f128ca7fde79a50495585e8689cca18bf71bd58"),
    "screen_system": (prompts.screen_system, "b5c17e3a4db2afe4da614f31d2bc63613f25b142392f5b2b90840c6dd3fadfb2"),
    "extract_system": (prompts.extract_system, "74dc03786fb0fa75155f52a4005026ebc361162d834cd97f8b557cd6381dd82f"),
    "narrative_system": (prompts.narrative_system, "a67d0d9906785bbff2a6f6ac6d673853c8bfe7e62141a199a7a67a8881461082"),
}


@pytest.mark.parametrize("name", SYSTEM_HASHES)
def test_slr_system_prompts_are_unchanged(name):
    builder, digest = SYSTEM_HASHES[name]
    assert sha(builder("slr")) == digest


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
