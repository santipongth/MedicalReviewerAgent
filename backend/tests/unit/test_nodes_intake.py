from langgraph.graph import END

from app.config import Settings
from app.graph.graph import GraphDeps
from app.graph.nodes.intake import make_plan_queries, make_topic_guard, route_after_guard
from app.graph.prompts import DATA_NOTICE
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
    # Plan 26 final fix A1: a provider refusal gets the fixed personal message (1669 and 1323), never the topic
    from app.services.safety import refusal_code_of
    assert out2["rejected"].startswith("personal_medical: ")
    assert refusal_code_of("rejected", out2["rejected"]) == "personal_medical"
    assert "1669" in out2["rejected"] and "1323" in out2["rejected"]


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


def test_language_instruction_is_gone():  # audit I-18: dead code removed (translation happens last, in localize)
    from app.graph import prompts
    assert not hasattr(prompts, "language_instruction")


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


def test_a_review_query_does_not_count_as_a_primary_design_query():
    from app.graph.nodes.intake import ensure_design_query
    q = {"question_type": "therapy", "intervention_or_exposure": "SGLT2 inhibitors", "population": "HFpEF"}
    out = ensure_design_query(["sglt2 hfpef", "sglt2 hfpef meta-analysis"], q)
    assert out[-1].endswith("randomized controlled trial")  # reviews alone would crowd out the trials again
    prevalence = {**q, "question_type": "prevalence"}
    assert ensure_design_query(["hfpef cross-sectional survey"], prevalence) == ["hfpef cross-sectional survey"]
    long_pico = {**q, "population": "adults aged 50 years or older with heart failure and preserved ejection "
                                    "fraction above fifty percent"}
    assert len(ensure_design_query(["x"], long_pico)[-1].split()) <= 10  # planner rule: short keyword queries


# ---- Plan 26: personal medical questions get a fixed refusal, never a review --------------------------------------
async def test_a_personal_medical_question_is_refused_with_the_fixed_message():
    from app.services.safety import refusal_code_of, rejection_error
    personal = FakeStructuredLLM("h", lambda s, u: TopicVerdict(
        allowed=False, reason="Asks what my mother should take.", english_topic="", category="personal_medical"))
    out = await make_topic_guard(_deps(_llms(guard=personal)))(
        {"topic": "แม่ผมอายุ 80 ควรกินแอสไพรินต่อไหม", "language": "th"})
    assert out == {"rejected": rejection_error("personal_medical"), "cost_usd": 0.01}
    assert "mother" not in out["rejected"] and refusal_code_of("rejected", out["rejected"]) == "personal_medical"
    assert "1323" in out["rejected"] and "1669" in out["rejected"]
    assert len(personal.calls) == 1  # one guard call, nothing after it
    assert route_after_guard(out) == END


async def test_a_personal_category_wins_even_when_allowed_disagrees():
    from app.services.safety import rejection_error
    odd = FakeStructuredLLM("h", lambda s, u: TopicVerdict(allowed=True, reason="ok", english_topic="aspirin",
                                                          category="personal_medical"))
    out = await make_topic_guard(_deps(_llms(guard=odd)))({"topic": "should I take aspirin", "language": "en"})
    assert out["rejected"] == rejection_error("personal_medical")


async def test_declined_or_not_allowed_keeps_the_guard_reason():
    declined = FakeStructuredLLM("h", lambda s, u: TopicVerdict(allowed=True, reason="Not medical.", english_topic="x",
                                                               category="declined"))
    out = await make_topic_guard(_deps(_llms(guard=declined)))({"topic": "best pizza", "language": "en"})
    assert out["rejected"] == "Not medical."


async def test_a_model_reason_cannot_pose_as_a_refusal_code():
    from app.services.safety import refusal_code_of
    for text in ("personal_medical: Not medical.", "  Personal_Medical :Not medical.", "PERSONAL MEDICAL: Not medical.",
                 "personal_medical: personal_medical: Not medical.", "personal_medical:Personal-Medical : Not medical."):
        v = FakeStructuredLLM("h", lambda s, u, text=text: TopicVerdict(allowed=False, reason=text, english_topic="",
                                                                       category="declined"))
        out = await make_topic_guard(_deps(_llms(guard=v)))({"topic": "best pizza", "language": "en"})
        assert out["rejected"] == "Not medical."
        assert refusal_code_of("rejected", out["rejected"]) == "declined"


def test_the_guard_prompt_sends_emergencies_self_harm_and_close_ones_to_personal_medical():
    from app.graph import prompts
    for phrase in ("someone close to the asker", "an emergency happening now", "suicidal thoughts or self-harm",
                   "even if misspelled", "These are never declined", "suicide prevention in adolescents",
                   "is research; personal_medical is for a person describing their own", "causing harm to others"):
        assert phrase in prompts.GUARD_SYSTEM


def test_the_guard_schema_requires_the_category_without_a_default():
    schema = TopicVerdict.model_json_schema()
    assert "category" in schema["required"] and "default" not in schema["properties"]["category"]
    assert schema["properties"]["category"]["enum"] == ["research", "personal_medical", "declined"]
    assert TopicVerdict(allowed=True, reason="ok", english_topic="x").category == "research"


def test_the_guard_prompt_names_the_three_categories():
    from app.graph import prompts
    for name in ("research:", "personal_medical:", "declined:", "allowed: true only for research"):
        assert name in prompts.GUARD_SYSTEM
