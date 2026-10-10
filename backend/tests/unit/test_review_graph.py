"""End-to-end review graph with fake LLMs and sources: every stage, the harness paths and resume."""
import asyncio
import json
import re

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from app.config import Settings
from app.graph.graph import GraphDeps, build_graph, initial_state
from app.graph.schemas import (
    DESIGN_CATEGORIES,
    Candidate,
    ConflictNote,
    KeyTerm,
    OutcomeCluster,
    OutcomeClusters,
    OutcomeMember,
    OutcomeResult,
    PaperCard,
    QueryPlan,
    ReviewQuestion,
    ScreenBatch,
    ScreenDecision,
    SynthesisNarrative,
    TopicVerdict,
    TranslationBatch,
    TranslationItem,
)
from app.services.llm import LLMOutputError, LLMs
from app.services.llm_config import HarnessSpec
from tests.fakes import FakeStructuredLLM

ABSTRACT = (
    "Methods: We enrolled 1,234 adults with type 2 diabetes in a population-based cohort. "
    "Results: Metformin use was associated with a lower risk of colorectal cancer "
    "(HR 0.80, 95% CI 0.71-0.90; p = 0.003)."
)
QUOTE = "lower risk of colorectal cancer (HR 0.80, 95% CI 0.71-0.90; p = 0.003)"


class FakeSearxng:
    def __init__(self, results):
        self.results, self.calls = results, 0

    async def search(self, query, pageno=1):
        self.calls += 1
        return list(self.results)


class FakeEpmc:
    async def lookup(self, *, dois, pmids):
        return [Candidate(title="Paper 0 about metformin and colorectal cancer", doi="10.1/0", pmcid="PMC0",
                          is_open_access=True, abstract="enriched abstract", engines=["europepmc"])]


def card(direction="positive"):
    return PaperCard(
        study_design="cohort", population="adults with type 2 diabetes", sample_size=1234,
        sample_size_quote="We enrolled 1,234 adults with type 2 diabetes", intervention_or_exposure="metformin",
        comparator="no metformin",
        outcomes=[OutcomeResult(outcome="CRC incidence", result="lower risk", evidence_quote=QUOTE,
                                effect_size="HR 0.80 (0.71-0.90)", effect_measure="HR", effect_value=0.8,
                                ci_lower=0.71, ci_upper=0.9, p_value=0.003, direction=direction)],
        key_findings=["lower CRC risk"], limitations=["observational"], funding_or_conflicts=None,
        risk_of_bias="moderate", overall_direction=direction)


def extract(system, user):
    # 3 of 8 studies disagree: a real split (a single dissenter would now be consensus with dissent)
    return card("negative" if any(f"Paper {i} about" in user for i in (3, 5, 7)) else "positive")


QUESTION = ReviewQuestion(
    question_type="prevention", interpretation="Whether metformin lowers colorectal cancer risk.",
    refined_question="In adults with type 2 diabetes, does metformin reduce colorectal cancer incidence?",
    population="adults with type 2 diabetes", intervention_or_exposure="metformin", comparator="no metformin",
    outcomes=["CRC incidence"], study_designs=["cohort", "RCT"], timeframe=None,
    sub_questions=["Does the effect depend on dose?"],
    key_terms=[KeyTerm(term="metformin", synonyms=["biguanide"], mesh="Metformin")],
    assumptions=["Adults only"], ambiguities=["Cancer site"])


def screen_all(system, user):
    refs = re.findall(r"^\[(C\d+)\]", user, flags=re.MULTILINE)
    return ScreenBatch(decisions=[ScreenDecision(ref=r, relevance=95 - i, include=True, reason="ok")
                                  for i, r in enumerate(refs)])


def one_cluster(system, user):
    pairs = json.loads(re.search(r"<outcomes>\n(.*)\n</outcomes>", user, flags=re.DOTALL).group(1))
    return OutcomeClusters(clusters=[OutcomeCluster(canonical="Colorectal cancer incidence",
                                                    members=[OutcomeMember(**p) for p in pairs])])


def explain(system, user):
    conflict = json.loads(re.search(r"<conflict>\n(.*)\n</conflict>", user, flags=re.DOTALL).group(1))
    return ConflictNote(outcome=conflict["outcome"], refs=conflict["refs"], likely_reasons=["follow-up"],
                        explanation=f"[{conflict['refs'][0]}] had longer follow-up.")


def thai(system, user):
    items = json.loads(re.search(r"<items>\n(.*)\n</items>", user, flags=re.DOTALL).group(1))
    return TranslationBatch(items=[TranslationItem(id=i["id"], text="TH " + i["text"]) for i in items])


def make_deps(*, allowed=True, results=None, extractor=None):
    if results is None:
        results = [Candidate(title=f"Paper {i} about metformin and colorectal cancer", doi=f"10.1/{i}",
                             abstract=f"Paper {i}. {ABSTRACT}", engines=["pubmed"]) for i in range(10)]
    llms = LLMs(
        guard=FakeStructuredLLM("g", lambda s, u: TopicVerdict(
            allowed=allowed, reason="ok" if allowed else "not a medical topic", english_topic="metformin and CRC")),
        refiner=FakeStructuredLLM("ref", lambda s, u: QUESTION),
        planner=FakeStructuredLLM("plan", lambda s, u: QueryPlan(
            queries=["metformin colorectal cancer", "metformin CRC cohort"], population="adults",
            intervention_or_exposure="metformin", comparator="none", outcomes=["CRC incidence"],
            inclusion_criteria=["human"], exclusion_criteria=["editorial"])),
        screener=FakeStructuredLLM("scr", screen_all),
        extractor=extractor or FakeStructuredLLM("ext", extract),
        normalizer=FakeStructuredLLM("norm", one_cluster),
        conflict_explainer=FakeStructuredLLM("conf", explain),
        synthesizer=FakeStructuredLLM("syn", lambda s, u: SynthesisNarrative(
            executive_summary="Metformin is associated with lower CRC risk [P1, P2].", evidence_strength="low",
            evidence_rationale="observational cohorts [P1]", research_gaps=["RCTs"])),
        localizer=FakeStructuredLLM("loc", thai),
        harness=HarnessSpec(max_repairs=1, dual_extraction=False),
        preset="test", models={"extractor": "openrouter:ext"},
    )
    return GraphDeps(settings=Settings(_env_file=None, searxng_pages=1), llms=llms,
                     searxng=FakeSearxng(results), europepmc=FakeEpmc())


def all_calls(deps):
    llms = deps.llms
    return sum(len(getattr(llms, r).calls) for r in ("guard", "refiner", "planner", "screener", "extractor",
                                                     "normalizer", "conflict_explainer", "synthesizer",
                                                     "localizer"))


async def run(deps, options=None, language="th", thread="t1"):
    options = {"max_papers": 8, "candidate_limit": 20} if options is None else options
    graph = build_graph(deps, checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": thread}}
    events = []
    async for mode, chunk in graph.astream(
        initial_state(thread, "เมตฟอร์มินกับมะเร็งลำไส้ใหญ่", language, options),
        config, stream_mode=["custom", "updates"], durability="sync",
    ):
        if mode == "custom":
            events.append(chunk)
    return (await graph.aget_state(config)).values, events


async def test_full_review_reads_best_eight_and_reports_quality_and_timings():
    deps = make_deps()
    values, events = await run(deps)
    r = values["result"]
    assert [p["ref"] for p in r["papers"]] == [f"P{i}" for i in range(1, 9)]
    assert r["papers"][0]["doi"] == "10.1/0" and "fulltext_source" not in r["papers"][0]
    assert r["papers"][0]["card"]["population"].startswith("TH ")
    assert r["papers"][0]["card_en"]["population"] == "adults with type 2 diabetes"
    assert r["papers"][0]["verification"]["numbers_verified"] == 2
    assert r["stats"] == {"found": 20, "unique": 10, "with_abstract": 10, "candidates": 10, "screened": 10, "selected": 8,
                          "extracted": 8, "non_research": 0, "excluded_screening": {},
                          "excluded_selection": {"narrative_excluded": 0, "over_limit": 2, "study_design_relaxed": 0}}
    assert r["summary"].startswith("TH Metformin") and r["synthesis_en"]["executive_summary"].startswith("Metformin")
    assert r["synthesis"]["comparison"][0]["outcome"] == "TH Colorectal cancer incidence"
    assert r["synthesis"]["conflicts"][0]["refs"] == [f"P{i}" for i in range(1, 9)]
    assert r["synthesis"]["conflicts"][0]["likely_reasons"] == ["TH follow-up"]
    assert r["question"]["refined_question"].startswith("TH In adults")
    assert r["question"]["english"]["refined_question"].startswith("In adults")
    assert r["llm_preset"] == "test" and r["queries"] == ["metformin colorectal cancer", "metformin CRC cohort"]
    t = r["quality"]["timings"]
    for stage in ("refine", "plan", "search", "enrich", "screen", "read_max", "read_mean", "normalize",
                  "conflict", "narrative", "localize_cards", "localize", "total"):
        assert t[stage] is not None and t[stage] >= 0, stage
    assert r["quality"]["verification_rate"] == 1.0 and r["quality"]["question_refined"] is True
    assert values["cost_usd"] == pytest.approx(0.01 * all_calls(deps))
    types = [e["type"] for e in events]
    assert types.index("question_refined") < types.index("planning")
    for expected in ("checking_topic", "refining", "searching", "enriching", "screening", "screened",
                     "reading", "extracted", "synthesizing", "localizing", "finalizing"):
        assert expected in types
    assert types.count("reading") == 8
    extracted = [e for e in events if e["type"] == "extracted"]
    assert len(extracted) == 8 and all(e["ok"] for e in extracted)
    assert {e["direction"] for e in extracted} == {"positive", "negative"}  # the fake extractor's overall_direction
    assert all(e["design"] in DESIGN_CATEGORIES for e in extracted)
    by_ref = {p["ref"]: p for p in r["papers"]}
    assert all(by_ref[e["ref"]]["card_en"]["overall_direction"] == e["direction"] for e in extracted)
    assert all(by_ref[e["ref"]]["card_en"]["design_category"] == e["design"] for e in extracted)


async def test_english_review_skips_localization():
    deps = make_deps()
    values, _ = await run(deps, language="en")
    r = values["result"]
    assert r["summary"].startswith("Metformin") and r["papers"][0]["card"] == r["papers"][0]["card_en"]
    assert deps.llms.localizer.calls == []


async def test_rejected_topic_stops_before_search():
    deps = make_deps(allowed=False)
    values, events = await run(deps)
    assert values["rejected"] == "not a medical topic"
    assert values.get("result") is None and deps.searxng.calls == 0
    assert [e["type"] for e in events] == ["checking_topic"]


async def test_no_search_results_finishes_with_explicit_empty_synthesis():
    deps = make_deps(results=[])
    values, _ = await run(deps)
    r = values["result"]
    assert r["papers"] == [] and r["stats"]["selected"] == 0
    assert "ไม่พบ" in r["summary"]
    assert deps.llms.synthesizer.calls == [] and deps.llms.screener.calls == []


async def test_one_failed_extraction_is_reported_not_fatal():
    def flaky(system, user):
        return LLMOutputError("bad json") if "Paper 1 about" in user else extract(system, user)

    deps = make_deps(extractor=FakeStructuredLLM("ext", flaky))
    values, events = await run(deps)
    r = values["result"]
    failed = [p for p in r["papers"] if p["card"] is None]
    assert len(failed) == 1 and "bad json" in failed[0]["error"]
    ev = next(e for e in events if e["type"] == "extracted" and e["ref"] == failed[0]["ref"])
    assert ev["ok"] is False and ev["direction"] is None and ev["design"] is None
    assert r["stats"]["extracted"] == 7
    assert f'"ref": "{failed[0]["ref"]}"' not in deps.llms.synthesizer.calls[0][1]
    assert any("extraction failed" in e for e in r["errors"])


async def test_interrupted_reading_resumes_only_unfinished_paper():
    calls = {"n": 0}
    entered = asyncio.Event()

    async def slow_for_paper_2(system, user):
        calls["n"] += 1
        if "Paper 2 about" in user and not entered.is_set():
            entered.set()
            await asyncio.Event().wait()  # hang until cancelled
        return card()

    deps = make_deps(extractor=FakeStructuredLLM("ext", slow_for_paper_2))
    graph = build_graph(deps, checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": "r1"}}

    async def consume(inp):
        async for _ in graph.astream(inp, config, stream_mode=["custom", "updates"], durability="sync"):
            pass

    task = asyncio.create_task(consume(initial_state("r1", "topic", "en", {"max_papers": 5, "candidate_limit": 20})))
    await asyncio.wait_for(entered.wait(), timeout=5)
    await asyncio.sleep(0.2)  # let the other two extractions finish and checkpoint their writes
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert calls["n"] == 5
    await consume(None)  # resume
    values = (await graph.aget_state(config)).values
    assert calls["n"] == 6  # only paper 2 re-extracted
    assert len(values["result"]["papers"]) == 5
    assert values["cost_usd"] == pytest.approx(0.01 * (all_calls(deps) - 1))  # the hung call never returned


async def test_review_finishes_with_what_it_has_when_the_cost_cap_is_reached():
    from app.services.budget import ReviewBudget, use_budget
    from app.services.llm import LimitedLLM
    deps = make_deps()
    sem = asyncio.Semaphore(8)
    for role in ("guard", "refiner", "planner", "screener", "extractor", "normalizer", "conflict_explainer",
                 "synthesizer", "localizer"):
        setattr(deps.llms, role, LimitedLLM(getattr(deps.llms, role), sem))
    with use_budget(ReviewBudget(cap_usd=0.045)):  # enough for intake + screening, not for every paper
        values, _ = await run(deps, thread="capped")
    r = values["result"]
    assert r is not None and any("cost cap" in e for e in r["errors"])


async def test_scoping_run_skips_conflict_explanation_and_grading():
    from app.graph.schemas import NarrativeNoGrade
    deps = make_deps()
    deps.llms.refiner = FakeStructuredLLM("ref", lambda s, u: QUESTION.model_copy(
        update={"concept": "metformin use", "context": "adults with type 2 diabetes", "comparator": ""}))
    deps.llms.synthesizer = FakeStructuredLLM("syn", lambda s, u: NarrativeNoGrade(
        executive_summary="Studies of metformin in diabetes are mostly cohorts [P1, P2].", research_gaps=["RCTs"]))
    values, _ = await run(deps, options={"max_papers": 8, "candidate_limit": 20, "review_type": "scoping"},
                          language="en")
    r = values["result"]
    assert deps.llms.conflict_explainer.calls == []
    assert r["review_type"] == "scoping"
    assert r["synthesis"]["evidence_strength"] is None and r["synthesis"]["grade_baseline"] is None
    assert r["synthesis"]["evidence_rationale"] == "Certainty of evidence is not graded in a scoping review."
    assert "scoping review" in deps.llms.synthesizer.calls[0][0]


async def test_slr_run_still_explains_conflicts_and_grades():
    deps = make_deps()
    values, _ = await run(deps, language="en")
    assert len(deps.llms.conflict_explainer.calls) == 1
    assert values["result"]["synthesis"]["evidence_strength"] == "low"
