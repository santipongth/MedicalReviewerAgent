from langgraph.graph import END

from app.config import Settings
from app.graph.graph import GraphDeps
from app.graph.nodes.intake import make_plan_queries, make_topic_guard, route_after_guard
from app.graph.prompts import DATA_NOTICE, language_instruction
from app.graph.schemas import QueryPlan, TopicVerdict
from app.services.llm import LLMRefusal, LLMs
from tests.fakes import FakeStructuredLLM


def _llms(**overrides):
    unused = FakeStructuredLLM("unused", lambda s, u: AssertionError("not expected"))
    base = {"guard": unused, "planner": unused, "screener": unused, "extractor": unused, "synthesizer": unused}
    base.update(overrides)
    return LLMs(**base)


def _deps(llms):
    return GraphDeps(settings=Settings(_env_file=None), llms=llms)


def _plan(**kw):
    base = {
        "queries": ["metformin colorectal cancer", "metformin colorectal cancer", " metformin CRC risk cohort ",
                    "q3", "q4", "q5", "q6", "q7"],
        "population": "adults", "intervention_or_exposure": "metformin", "comparator": "no metformin",
        "outcomes": ["CRC incidence"], "inclusion_criteria": ["human"], "exclusion_criteria": ["case report"],
    }
    base.update(kw)
    return QueryPlan(**base)


async def test_guard_allows_and_records_english_topic_and_cost():
    guard = FakeStructuredLLM("h", lambda s, u: TopicVerdict(allowed=True, reason="ok", english_topic="metformin and CRC"))
    out = await make_topic_guard(_deps(_llms(guard=guard)))({"topic": "เมตฟอร์มินกับมะเร็งลำไส้", "language": "th"})
    assert out == {"english_topic": "metformin and CRC", "cost_usd": 0.01}
    system, user = guard.calls[0]
    assert "<topic>เมตฟอร์มินกับมะเร็งลำไส้</topic>" in user and DATA_NOTICE in user
    assert "เมตฟอร์มิน" not in system


async def test_guard_rejects_and_refusal_counts_as_rejection():
    no = FakeStructuredLLM("h", lambda s, u: TopicVerdict(allowed=False, reason="not medical", english_topic=""))
    out = await make_topic_guard(_deps(_llms(guard=no)))({"topic": "best pizza", "language": "en"})
    assert out["rejected"] == "not medical"
    refusing = FakeStructuredLLM("h", lambda s, u: LLMRefusal("declined"))
    out2 = await make_topic_guard(_deps(_llms(guard=refusing)))({"topic": "x", "language": "en"})
    assert out2["rejected"].startswith("The topic was declined")


def test_route_after_guard():
    assert route_after_guard({"rejected": "no"}) == END
    assert route_after_guard({"rejected": None}) == "refine_question"
    assert route_after_guard({}) == "refine_question"


async def test_plan_queries_dedupes_caps_and_passes_options():
    planner = FakeStructuredLLM("s", lambda s, u: _plan())
    state = {"topic": "เมตฟอร์มิน", "english_topic": "metformin and CRC", "language": "th",
             "options": {"year_from": 2015, "study_types": ["RCT", "cohort"]}}
    out = await make_plan_queries(_deps(_llms(planner=planner)))(state)
    assert out["plan"]["queries"] == ["metformin colorectal cancer", "metformin CRC risk cohort", "q3", "q4"]
    assert out["cost_usd"] == 0.01
    user = planner.calls[0][1]
    assert "2015" in user and "RCT" in user and "metformin and CRC" in user


def test_language_instruction():
    assert "Thai" in language_instruction("th") and "English" in language_instruction("en")


async def test_guard_repairs_a_malformed_answer_instead_of_failing_the_review():
    from app.services.llm import LLMOutputError
    answers = iter([LLMOutputError("1 validation error for TopicVerdict: allowed Field required"),
                    TopicVerdict(allowed=True, reason="ok", english_topic="statins and dementia")])
    guard = FakeStructuredLLM("q", lambda s, u: next(answers))
    out = await make_topic_guard(_deps(_llms(guard=guard)))({"topic": "statins and dementia", "language": "th"})
    assert out["english_topic"] == "statins and dementia" and len(guard.calls) == 2
    assert "allowed Field required" in guard.calls[1][1]  # the exact problem is fed back


async def test_plan_always_has_a_study_design_query():
    planner = FakeStructuredLLM("p", lambda s, u: _plan(queries=["sglt2 inhibitors hfpef", "empagliflozin hfpef outcomes"]))
    question = {"refined_question": "In HFpEF, do SGLT2 inhibitors reduce events?", "question_type": "therapy",
                "population": "adults with HFpEF", "intervention_or_exposure": "SGLT2 inhibitors",
                "comparator": "placebo", "outcomes": ["HF hospitalization"], "sub_questions": [], "study_designs": [],
                "key_terms": []}
    out = await make_plan_queries(_deps(_llms(planner=planner)))(
        {"topic": "SGLT2 HFpEF", "language": "en", "question": question, "options": {}})
    assert out["plan"]["queries"][-1] == "SGLT2 inhibitors adults with HFpEF randomized controlled trial"
    harm = {**question, "question_type": "harm_etiology"}
    out2 = await make_plan_queries(_deps(_llms(planner=planner)))(
        {"topic": "x", "language": "en", "question": harm, "options": {}})
    assert out2["plan"]["queries"][-1].endswith("cohort study")
    already = FakeStructuredLLM("p", lambda s, u: _plan(queries=["metformin crc cohort", "metformin crc"]))
    out3 = await make_plan_queries(_deps(_llms(planner=already)))({"topic": "x", "language": "en", "options": {}})
    assert out3["plan"]["queries"] == ["metformin crc cohort", "metformin crc"]
