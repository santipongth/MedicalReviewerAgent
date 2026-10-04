"""Regression tests for the Plan 2 final-review findings (Important 1-8)."""
import pytest

from app.config import Settings
from app.graph.graph import GraphDeps
from app.graph.nodes.intake import make_plan_queries, make_refine_question
from app.graph.nodes.reading import make_read_paper
from app.graph.nodes.retrieval import make_enrich, make_search
from app.graph.nodes.synthesis import make_write_synthesis
from app.graph.schemas import Candidate, OutcomeResult, PaperCard, QueryPlan, TopicVerdict
from app.harness.grade import grade_baseline
from app.harness.runner import HarnessRunner
from app.harness.verify import card_problems, null_unverified_numbers
from app.services.llm import LLMError, LLMOutputError, LLMRefusal, LLMs
from app.services.llm_config import HarnessSpec
from tests.fakes import FakeStructuredLLM

SOURCE = ("We enrolled 1,234 adults with type 2 diabetes. Metformin use was associated with a lower risk of "
          "colorectal cancer (HR 0.80, 95% CI 0.71-0.90; p = 0.003).")
QUOTE = "lower risk of colorectal cancer (HR 0.80, 95% CI 0.71-0.90; p = 0.003)"


def card(result="lower risk", findings=("lower CRC risk",), effect=0.8, direction="positive"):
    return PaperCard(
        study_design="cohort", population="adults", sample_size=1234,
        sample_size_quote="We enrolled 1,234 adults with type 2 diabetes", intervention_or_exposure="metformin",
        comparator=None,
        outcomes=[OutcomeResult(outcome="CRC", result=result, evidence_quote=QUOTE, effect_size="HR 0.80",
                                effect_measure="HR", effect_value=effect, ci_lower=0.71, ci_upper=0.9,
                                p_value=0.003, direction=direction)],
        key_findings=list(findings), limitations=[], funding_or_conflicts=None, risk_of_bias="moderate",
        overall_direction=direction)


def unexpected():
    return FakeStructuredLLM("u", lambda s, u: AssertionError("unexpected"))


def deps(**roles):
    u = unexpected()
    base = {"guard": u, "planner": u, "screener": u, "extractor": u, "synthesizer": u,
            "harness": HarnessSpec(max_repairs=1)}
    extra = {k: roles.pop(k) for k in ("searxng", "europepmc") if k in roles}
    return GraphDeps(settings=Settings(_env_file=None), llms=LLMs(**{**base, **roles}), **extra)


# ---- Important 1: numbers in free text must be in the paper ---------------------------------
def test_numbers_in_result_and_findings_must_appear_in_the_paper():
    bad = card(result="25% lower CRC risk (HR 0.75)", findings=("HR 0.75 for CRC", "lower risk in type 2 diabetes"))
    problems = card_problems(bad, SOURCE, 90)
    assert any("result mentions 25, 0.75" in p for p in problems)
    assert any("key_findings" in p and "0.75" in p for p in problems)
    fixed, _, _ = null_unverified_numbers(bad, SOURCE, 90)
    assert fixed.outcomes[0].result == QUOTE  # replaced by the verified verbatim quote
    assert fixed.key_findings == ["lower risk in type 2 diabetes"]  # unverifiable finding dropped
    ok = card(result="HR 0.80 (0.71-0.90)")
    assert not card_problems(ok, SOURCE, 90)


def test_result_with_unverifiable_numbers_and_unverified_quote_loses_its_numbers():
    bad = card(result="HR 0.5 lower risk")
    bad.outcomes[0].evidence_quote = "a sentence that does not appear anywhere in the paper"
    fixed, _, _ = null_unverified_numbers(bad, SOURCE, 90)
    assert "0.5" not in fixed.outcomes[0].result and fixed.outcomes[0].effect_value is None


# ---- Important 2: refine/plan failures degrade -------------------------------------------------
@pytest.mark.parametrize("error", [LLMError("503"), LLMRefusal("filtered")])
async def test_refiner_failure_falls_back_to_english_topic(error):
    d = deps(refiner=FakeStructuredLLM("r", lambda s, u: error))
    out = await make_refine_question(d)({"topic": "t", "english_topic": "metformin", "language": "th"})
    assert out["question"] is None and out["quality"][0]["fallback"] is True
    assert out["errors"] and "question refinement failed" in out["errors"][0]


async def test_planner_bad_json_is_repaired_and_failure_falls_back_to_topic_search():
    plan = QueryPlan(queries=["metformin crc"], population="a", intervention_or_exposure="m", comparator="c",
                     outcomes=["o"], inclusion_criteria=[], exclusion_criteria=[])
    answers = iter([LLMOutputError("bad json"), plan])
    out = await make_plan_queries(deps(planner=FakeStructuredLLM("p", lambda s, u: next(answers))))(
        {"topic": "t", "english_topic": "metformin"})
    assert out["plan"]["queries"] == ["metformin crc"]
    down = await make_plan_queries(deps(planner=FakeStructuredLLM("p", lambda s, u: LLMError("down"))))(
        {"topic": "t", "english_topic": "metformin"})
    assert down["plan"] is None and "query planning failed" in down["errors"][0]


# ---- Important 3: escalation refusal does not crash --------------------------------------------
async def test_escalation_refusal_becomes_a_failed_result():
    big = FakeStructuredLLM("big", lambda s, u: LLMRefusal("filtered"))
    res = await HarnessRunner(escalation=lambda schema: big).escalate("s", "u", schema=TopicVerdict,
                                                                     reason="disagreement")
    assert res is not None and not res.ok and res.value is None


async def test_reading_marks_uncertain_when_escalation_refuses():
    d = deps(extractor=FakeStructuredLLM("a", lambda s, u: card()),
             extractor_secondary=FakeStructuredLLM("b", lambda s, u: card(direction="negative")),
             escalation=lambda schema: FakeStructuredLLM("big", lambda s, u: LLMRefusal("no")))
    out = await make_read_paper(d)(payload())
    assert out["papers"][0]["verification"]["uncertain"] is True and out["papers"][0]["card"] is not None


def payload():
    c = Candidate(title="Metformin and CRC", doi="10.1/a", abstract=SOURCE)
    return {"paper": {"ref": "P1", "relevance": 90, "reason": "r", "uncertain": False, "candidate": c.model_dump()},
            "plan": {}, "question": "Q?", "question_detail": {"outcomes": ["CRC"]}, "language": "en"}


# ---- Important 5: candidate cut keeps search ranking, not citation counts ------------------------
class FakeSearxng:
    def __init__(self, by_query):
        self.by_query = by_query

    async def search(self, query, pageno=1):
        return self.by_query.get(query, [])


async def test_search_interleaves_queries_and_enrich_does_not_rank_by_citations():
    def c(q, i, cited=None):
        return Candidate(title=f"{q} paper number {i} unique words", doi=f"10.1/{q}{i}", abstract=SOURCE,
                         cited_by=cited)
    sx = FakeSearxng({"q1": [c("q1", 0), c("q1", 1)], "q2": [c("q2", 0), c("q2", 1, cited=5000)]})
    out = await make_search(deps(searxng=sx))({"plan": {"queries": ["q1", "q2"]}})
    assert [x["doi"] for x in out["candidates"]] == ["10.1/q10", "10.1/q20", "10.1/q11", "10.1/q21"]

    class NoEpmc:
        async def lookup(self, *, dois, pmids):
            return []

    enriched = await make_enrich(deps(europepmc=NoEpmc()))({"candidates": out["candidates"],
                                                           "options": {"candidate_limit": 20, "max_papers": 10}})
    assert [x["doi"] for x in enriched["candidates"]] == ["10.1/q10", "10.1/q20", "10.1/q11", "10.1/q21"]


# ---- Important 7: pipeline failures are not reported as "no studies found" -----------------------
EMPTY = {"rows": [], "consensus": [], "conflicts": [], "grade": {"level": "very_low", "factors": []}}


async def test_extraction_failure_message_is_not_no_studies_found():
    state = {"topic": "t", "language": "en", "matrix": EMPTY, "conflict_notes": [],
             "candidates": [{}] * 5, "selected": [{}] * 3,
             "papers": [{"ref": "P1", "card": None, "candidate": {"title": "x"}}]}
    out = await make_write_synthesis(deps())(state)
    assert "could not extract" in out["synthesis"]["executive_summary"]
    assert "No sufficiently relevant" not in out["synthesis"]["executive_summary"]
    th = await make_write_synthesis(deps())({**state, "language": "th"})
    assert "ไม่พบงานวิจัย" not in th["synthesis_display"]["executive_summary"]


async def test_screening_failure_message_names_the_failure():
    state = {"topic": "t", "language": "en", "matrix": EMPTY, "conflict_notes": [], "candidates": [{}] * 5,
             "selected": [], "papers": [], "errors": ["screening batch failed: LLMError: down"]}
    out = await make_write_synthesis(deps())(state)
    assert "could not be screened" in out["synthesis"]["executive_summary"]


# ---- Important 8: non-randomized designs are not counted as randomized ---------------------------
def test_non_randomized_designs_start_low():
    papers = [{"card": {"study_design": d, "risk_of_bias": "moderate", "sample_size": 5000}}
              for d in ("non-randomized controlled trial", "non-randomised cohort", "quasi-randomized trial")]
    assert grade_baseline(papers, {"conflicts": []})["level"] == "low"
    rct = [{"card": {"study_design": "randomized controlled trial", "risk_of_bias": "low", "sample_size": 5000}}]
    assert grade_baseline(rct, {"conflicts": []})["level"] == "high"
