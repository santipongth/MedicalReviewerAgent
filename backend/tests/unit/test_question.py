import re

import pytest

from app.config import Settings
from app.graph.graph import GraphDeps
from app.graph.nodes.intake import (
    make_plan_queries,
    make_refine_question,
    review_question,
    route_after_guard,
)
from app.graph.schemas import (
    KeyTerm,
    QueryPlan,
    QuestionCritique,
    ReviewQuestion,
    TranslationBatch,
    TranslationItem,
)
from app.harness.question import question_problems
from app.services.llm import LLMs
from app.services.llm_config import HarnessSpec
from tests.fakes import FakeStructuredLLM, to_thai


def good_question(**kw):
    base = {
        "question_type": "therapy",
        "interpretation": "The user wants to know whether metformin lowers colorectal cancer risk.",
        "refined_question": "In adults with type 2 diabetes, does metformin use compared with other glucose-lowering drugs reduce colorectal cancer incidence?",
        "population": "adults with type 2 diabetes",
        "intervention_or_exposure": "metformin",
        "comparator": "other glucose-lowering drugs or no metformin",
        "outcomes": ["colorectal cancer incidence", "colorectal cancer mortality"],
        "study_designs": ["cohort", "case-control", "RCT", "meta-analysis"],
        "timeframe": None,
        "sub_questions": ["Is there a dose-response relationship?", "Is metformin safe in this context?"],
        "key_terms": [KeyTerm(term="metformin", synonyms=["dimethylbiguanide"], mesh="Metformin"),
                      KeyTerm(term="colorectal cancer", synonyms=["CRC", "colon cancer"], mesh="Colorectal Neoplasms")],
        "assumptions": ["Assumed the user means cancer prevention, not treatment."],
        "ambiguities": ["Could also mean metformin as adjuvant therapy in existing CRC."],
    }
    base.update(kw)
    return ReviewQuestion(**base)


def _unused():
    return FakeStructuredLLM("unused", lambda s, u: AssertionError("not expected"))


def deps_with(refiner=None, critic=None, localizer=None, planner=None, harness=None):
    u = _unused()
    llms = LLMs(guard=u, planner=planner or u, screener=u, extractor=u, synthesizer=u,
                refiner=refiner, refiner_critic=critic, localizer=localizer,
                harness=harness or HarnessSpec())
    return GraphDeps(settings=Settings(_env_file=None), llms=llms)


def thai_localizer():
    def respond(system, user):
        items = re.findall(r'"id": "([^"]+)", "text": "([^"]*)"', user)
        return TranslationBatch(items=[TranslationItem(id=i, text=to_thai(t)) for i, t in items])
    return FakeStructuredLLM("qwen", respond)


STATE = {"topic": "เมตฟอร์มินกับมะเร็งลำไส้", "english_topic": "metformin and colorectal cancer", "language": "th",
         "options": {}}


# ---- validator ---------------------------------------------------------------------------
def test_good_question_has_no_problems():
    assert question_problems(good_question(), {}) == []


@pytest.mark.parametrize(
    "change,needle",
    [
        ({"refined_question": "Does metformin reduce colorectal cancer incidence in adults with diabetes."}, "?"),
        ({"refined_question": "Metformin?"}, "40"),
        ({"population": " "}, "population"),
        ({"outcomes": []}, "outcomes"),
        ({"comparator": ""}, "comparator"),
        ({"sub_questions": []}, "sub_questions"),
        ({"sub_questions": ["a?", "b?", "c?", "d?", "e?"]}, "sub_questions"),
        ({"interpretation": "ผู้ใช้ต้องการทราบ"}, "English"),
        ({"key_terms": [KeyTerm(term="colorectal cancer", synonyms=[], mesh=None)]}, "key_terms"),
    ],
)
def test_validator_rules(change, needle):
    problems = question_problems(good_question(**change), {})
    assert any(needle in p for p in problems), problems


def test_validator_enforces_user_options():
    q = good_question()
    assert any("2015" in p for p in question_problems(q, {"year_from": 2015}))
    assert question_problems(good_question(timeframe="studies published from 2015 onward"), {"year_from": 2015}) == []
    assert any("RCT" in p for p in question_problems(good_question(study_designs=["cohort"]), {"study_types": ["RCT"]}))


def test_review_question_helper_prefers_refined_question():
    assert review_question({**STATE, "question": good_question().model_dump()}).startswith("In adults")
    assert review_question(STATE) == "metformin and colorectal cancer"
    assert review_question({"topic": "raw"}) == "raw"


def test_route_after_guard_goes_to_refinement():
    assert route_after_guard({}) == "refine_question"


# ---- node --------------------------------------------------------------------------------
async def test_refine_draft_critique_and_localized_display():
    draft = good_question(sub_questions=["Is there a dose-response relationship?"])
    revised = good_question()
    refiner = FakeStructuredLLM("ds", lambda s, u: draft)
    critic = FakeStructuredLLM("ds", lambda s, u: QuestionCritique(
        issues=["safety was not covered"], revised=revised))
    node = make_refine_question(deps_with(refiner, critic, thai_localizer()))
    out = await node(STATE)
    assert out["question"] == revised.model_dump()
    assert out["question_display"]["refined_question"] == to_thai(revised.refined_question)
    assert out["question_display"]["sub_questions"] == [to_thai(s) for s in revised.sub_questions]
    entry = out["quality"][0]
    assert entry["stage"] == "refine" and entry["critique_applied"] is True and entry["fallback"] is False
    assert entry["critique_issues"] == ["safety was not covered"] and entry["seconds"] >= 0
    assert out["cost_usd"] == pytest.approx(0.01 * 2 + 0.01)  # draft + critique + 1 translation batch
    assert "เมตฟอร์มิน" in refiner.calls[0][1] and "metformin and colorectal cancer" in refiner.calls[0][1]


async def test_bad_draft_is_repaired():
    answers = iter([good_question(population=""), good_question()])
    refiner = FakeStructuredLLM("ds", lambda s, u: next(answers))
    out = await make_refine_question(deps_with(refiner, harness=HarnessSpec(refine_critique=False, localize=False)))(
        {**STATE, "language": "en"})
    assert out["question"]["population"] == "adults with type 2 diabetes"
    assert out["quality"][0]["repaired"] is True
    assert "population" in refiner.calls[1][1]


async def test_failed_critique_keeps_the_valid_draft():
    refiner = FakeStructuredLLM("ds", lambda s, u: good_question())
    critic = FakeStructuredLLM("ds", lambda s, u: QuestionCritique(issues=["x"], revised=good_question(outcomes=[])))
    out = await make_refine_question(deps_with(refiner, critic, harness=HarnessSpec(max_repairs=1, localize=False)))(
        {**STATE, "language": "en"})
    assert out["question"] == good_question().model_dump()
    assert out["quality"][0]["critique_applied"] is False


async def test_everything_failing_falls_back_to_english_topic():
    refiner = FakeStructuredLLM("ds", lambda s, u: good_question(outcomes=[]))
    out = await make_refine_question(deps_with(refiner, harness=HarnessSpec(max_repairs=1, escalate_on=[])))(STATE)
    assert out["question"] is None and out["quality"][0]["fallback"] is True
    assert out["cost_usd"] == pytest.approx(0.02)


async def test_user_options_are_passed_and_enforced():
    answers = iter([good_question(), good_question(timeframe="from 2015 onward")])
    refiner = FakeStructuredLLM("ds", lambda s, u: next(answers))
    state = {**STATE, "language": "en", "options": {"year_from": 2015, "study_types": ["RCT"]}}
    out = await make_refine_question(deps_with(refiner, harness=HarnessSpec(refine_critique=False)))(state)
    assert "2015" in refiner.calls[0][1] and "RCT" in refiner.calls[0][1]
    assert out["question"]["timeframe"] == "from 2015 onward"


async def test_missing_refiner_skips_cleanly():
    out = await make_refine_question(deps_with(None))(STATE)
    assert out["question"] is None and out["quality"][0]["skipped"] is True


# ---- planner uses the refined question ------------------------------------------------------
async def test_plan_queries_uses_question_subquestions_and_synonyms():
    planner = FakeStructuredLLM("ds", lambda s, u: QueryPlan(
        queries=["metformin colorectal cancer", "dimethylbiguanide colon cancer", "metformin dose response CRC",
                 "metformin safety diabetes", "extra query five"],
        population="x", intervention_or_exposure="x", comparator="x", outcomes=["x"],
        inclusion_criteria=["human"], exclusion_criteria=["editorial"]))
    state = {**STATE, "question": good_question().model_dump()}
    out = await make_plan_queries(deps_with(planner=planner))(state)
    user = planner.calls[0][1]
    assert "Is there a dose-response relationship?" in user and "dimethylbiguanide" in user
    assert "Colorectal Neoplasms" in user
    assert len(out["plan"]["queries"]) == 4
    assert out["plan"]["population"] == "adults with type 2 diabetes"  # PICO comes from the refined question
    assert out["plan"]["outcomes"] == ["colorectal cancer incidence", "colorectal cancer mortality"]


# ---- review types ---------------------------------------------------------------------------
def _pcc(**kw):
    return good_question(question_type="other", comparator="", concept="metformin use",
                         context="population-based cohorts", **kw)


async def test_scoping_refine_uses_pcc_prompt_and_accepts_empty_comparator():
    refiner = FakeStructuredLLM("ds", lambda s, u: _pcc())
    state = {**STATE, "language": "en", "options": {"review_type": "scoping"}}
    out = await make_refine_question(deps_with(refiner, harness=HarnessSpec(refine_critique=False, localize=False)))(state)
    assert out["question"]["concept"] == "metformin use" and out["question"]["comparator"] == ""
    system, user = refiner.calls[0]
    assert "PCC" in system and "concept" in user


async def test_scoping_refine_repairs_missing_concept():
    answers = iter([good_question(question_type="other", comparator=""), _pcc()])
    refiner = FakeStructuredLLM("ds", lambda s, u: next(answers))
    state = {**STATE, "language": "en", "options": {"review_type": "scoping"}}
    out = await make_refine_question(deps_with(refiner, harness=HarnessSpec(refine_critique=False, localize=False)))(state)
    assert out["quality"][0]["repaired"] is True and out["question"]["context"] == "population-based cohorts"
    assert "concept" in refiner.calls[1][1]


def _plan_llm():
    return FakeStructuredLLM("ds", lambda s, u: QueryPlan(
        queries=["metformin colorectal cancer", "dimethylbiguanide colon cancer"],
        population="x", intervention_or_exposure="x", comparator="x", outcomes=["x"],
        inclusion_criteria=["human"], exclusion_criteria=["editorial"]))


@pytest.mark.parametrize("rt,expect_design", [("slr", True), ("narrative", False), ("scoping", False)])
async def test_design_query_unless_type_opts_out(rt, expect_design):
    planner = _plan_llm()
    state = {**STATE, "question": good_question().model_dump(), "options": {"review_type": rt}}
    out = await make_plan_queries(deps_with(planner=planner))(state)
    assert any("randomized controlled trial" in q for q in out["plan"]["queries"]) is expect_design
    assert len(out["plan"]["queries"]) == (3 if expect_design else 2)
    assert ("Review type" in planner.calls[0][0]) is (rt != "slr")


@pytest.mark.parametrize("rt", ["slr", "narrative"])
async def test_pico_types_drop_concept_and_context_a_refiner_filled_in(rt):
    refiner = FakeStructuredLLM("ds", lambda s, u: _pcc())
    state = {**STATE, "language": "en", "options": {"review_type": rt}}
    out = await make_refine_question(deps_with(refiner, harness=HarnessSpec(refine_critique=False, localize=False)))(state)
    assert out["question"]["concept"] is None and out["question"]["context"] is None


@pytest.mark.parametrize("rt,framework,keeps", [("slr", "PICO", False), ("narrative", "PICO", False),
                                                ("scoping", "PCC", True)])
def test_question_block_shows_concept_only_for_pcc(rt, framework, keeps):
    from app.graph.nodes.synthesis import _question_block
    block = _question_block({**STATE, "options": {"review_type": rt}, "question": _pcc().model_dump()})
    assert block["framework"] == framework
    assert (block["concept"] == "metformin use") is keeps and (block["context"] is not None) is keeps


def test_design_query_is_opt_out_so_new_types_keep_it():
    from app.graph.nodes.intake import NO_DESIGN_QUERY
    assert NO_DESIGN_QUERY == {"narrative", "scoping"} and "slr" not in NO_DESIGN_QUERY
