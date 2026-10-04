import re

import pytest
from langgraph.types import Send

from app.config import Settings
from app.graph.graph import GraphDeps
from app.graph.nodes.screening import (
    make_screen_batch,
    make_select_top,
    route_to_reading,
    route_to_screening,
)
from app.graph.schemas import Candidate, ScreenBatch, ScreenDecision
from app.services.llm import LLMError, LLMs
from app.services.llm_config import HarnessSpec
from tests.fakes import FakeStructuredLLM


def cands(n):
    return [Candidate(title=f"Paper {i} about metformin", doi=f"10.1/{i}", abstract="abs").model_dump()
            for i in range(n)]


def refs_in(user):
    return re.findall(r"^\[(C\d+)\]", user, flags=re.MULTILINE)


def scorer(scores, *, include=None, extra=()):
    """scores: {title-index: relevance}; include defaults to relevance >= 50."""
    def respond(system, user):
        out = []
        for ref in refs_in(user):
            idx = int(re.search(rf"^\[{ref}\] Paper (\d+)", user, flags=re.MULTILINE).group(1))
            rel = scores.get(idx, 10)
            inc = include(idx, rel) if include else rel >= 50
            out.append(ScreenDecision(ref=ref, relevance=rel, include=inc, reason=f"r{idx}"))
        out += [ScreenDecision(ref=r, relevance=99, include=True, reason="ghost") for r in extra]
        return ScreenBatch(decisions=out)
    return respond


def deps(screener, secondary=None, escalation=None, harness=None):
    u = FakeStructuredLLM("u", lambda s, user: AssertionError("unexpected"))
    llms = LLMs(guard=u, planner=u, screener=screener, extractor=u, synthesizer=u,
                screener_secondary=secondary, escalation=(lambda schema: escalation) if escalation else None,
                harness=harness or HarnessSpec(max_repairs=1))
    return GraphDeps(settings=Settings(_env_file=None), llms=llms)


def payload(n=4):
    return {"batch": cands(n), "plan": {"inclusion_criteria": ["human"]}, "question": "Does metformin reduce CRC?",
            "language": "th"}


def by_key(out):
    return {d["key"]: d for d in out["screened"]}


def test_route_to_screening_uses_refined_question():
    state = {"candidates": cands(23), "plan": {}, "topic": "t", "english_topic": "metformin",
             "question": {"refined_question": "In adults, does metformin reduce CRC?"}, "language": "th"}
    sends = route_to_screening(state, batch_size=10)
    assert [len(s.arg["batch"]) for s in sends] == [10, 10, 3]
    assert all(isinstance(s, Send) and s.arg["question"] == "In adults, does metformin reduce CRC?" for s in sends)
    assert route_to_screening({"candidates": []}) == "normalize_outcomes"


async def test_clear_decisions_need_no_second_vote():
    secondary = FakeStructuredLLM("qwen", lambda s, u: AssertionError("no borderline items"))
    out = await make_screen_batch(deps(FakeStructuredLLM("g", scorer({0: 95, 1: 5, 2: 90, 3: 10})), secondary))(
        payload())
    assert [d["include"] for d in out["screened"]] == [True, False, True, False]
    q = out["quality"][0]
    assert q["stage"] == "screen" and q["borderline"] == 0 and q["disagreements"] == 0 and q["seconds"] >= 0


async def test_borderline_items_get_a_second_vote_and_agreement_keeps_decision():
    primary = FakeStructuredLLM("g", scorer({0: 60, 1: 40, 2: 95, 3: 5}))
    secondary = FakeStructuredLLM("qwen", scorer({0: 70, 1: 30}))
    out = await make_screen_batch(deps(primary, secondary))(payload())
    sent = refs_in(secondary.calls[0][1])
    assert len(sent) == 2  # only the two borderline items
    d = by_key(out)
    assert d["doi:10.1/0"]["include"] is True and d["doi:10.1/0"]["relevance"] == 65  # averaged
    assert d["doi:10.1/1"]["include"] is False
    assert out["quality"][0]["borderline"] == 2 and out["quality"][0]["disagreements"] == 0


async def test_disagreement_escalates_and_without_escalation_keeps_for_recall():
    primary = FakeStructuredLLM("g", scorer({0: 60, 1: 95}))
    secondary = FakeStructuredLLM("qwen", scorer({0: 40}))
    big = FakeStructuredLLM("max", scorer({0: 20}), cost=0.05)
    out = await make_screen_batch(deps(primary, secondary, big))(payload(2))
    d = by_key(out)
    assert d["doi:10.1/0"]["include"] is False and d["doi:10.1/0"]["uncertain"] is False
    assert out["quality"][0]["disagreements"] == 1 and out["quality"][0]["escalated"] == 1
    assert out["cost_usd"] == pytest.approx(0.01 + 0.01 + 0.05)

    no_esc = await make_screen_batch(deps(FakeStructuredLLM("g", scorer({0: 60, 1: 95})),
                                          FakeStructuredLLM("qwen", scorer({0: 40}))))(payload(2))
    d2 = by_key(no_esc)
    assert d2["doi:10.1/0"]["include"] is True and d2["doi:10.1/0"]["uncertain"] is True


async def test_missing_and_hallucinated_refs_are_repaired():
    answers = iter([
        ScreenBatch(decisions=[ScreenDecision(ref="C1", relevance=90, include=True, reason="x"),
                               ScreenDecision(ref="C9", relevance=90, include=True, reason="ghost")]),
        ScreenBatch(decisions=[ScreenDecision(ref="C1", relevance=90, include=True, reason="x"),
                               ScreenDecision(ref="C2", relevance=5, include=False, reason="y")]),
    ])
    primary = FakeStructuredLLM("g", lambda s, u: next(answers))
    out = await make_screen_batch(deps(primary))(payload(2))
    assert "C2" in primary.calls[1][1] and "C9" in primary.calls[1][1]
    assert [d["include"] for d in out["screened"]] == [True, False]
    assert out["quality"][0]["repaired"] is True


async def test_screening_failure_keeps_candidates_unscored():
    out = await make_screen_batch(deps(FakeStructuredLLM("g", lambda s, u: LLMError("provider down"))))(payload(2))
    assert [d["include"] for d in out["screened"]] == [False, False]
    assert out["errors"] and "screening" in out["errors"][0]


async def test_select_top_ranks_dedupes_and_caps_at_max_papers():
    candidates = cands(12)
    screened = [{"key": c["key"], "relevance": 50 + i, "include": True, "reason": "r", "uncertain": False}
                for i, c in enumerate(candidates)]
    screened.append(dict(screened[0]))  # duplicate after a resume
    out = await make_select_top(deps(FakeStructuredLLM("g", scorer({}))))(
        {"candidates": candidates, "screened": screened, "options": {"max_papers": 8, "candidate_limit": 20}})
    assert [s["ref"] for s in out["selected"]] == [f"P{i}" for i in range(1, 9)]
    every = await make_select_top(deps(FakeStructuredLLM("g", scorer({}))))(
        {"candidates": candidates, "screened": screened, "options": {}})
    assert len(every["selected"]) == 12  # default max_papers 30 keeps every included candidate
    assert out["selected"][0]["candidate"]["key"] == candidates[11]["key"]


def test_route_to_reading_passes_question():
    sel = [{"ref": "P1", "relevance": 90, "reason": "x", "candidate": cands(1)[0]}]
    state = {"selected": sel, "plan": {}, "topic": "t", "language": "th",
             "question": {"refined_question": "Q?", "outcomes": ["CRC"]}}
    sends = route_to_reading(state)
    assert sends[0].node == "read_paper" and sends[0].arg["question"] == "Q?"
    assert sends[0].arg["question_detail"]["outcomes"] == ["CRC"]
    assert route_to_reading({"selected": []}) == "normalize_outcomes"


async def test_select_top_tolerates_options_stored_under_the_old_ranges():
    candidates = cands(12)
    screened = [{"key": c["key"], "relevance": 50 + i, "include": True, "reason": "r", "uncertain": False}
                for i, c in enumerate(candidates)]
    out = await make_select_top(deps(FakeStructuredLLM("g", scorer({}))))(
        {"candidates": candidates, "screened": screened, "options": {"max_papers": 3, "candidate_limit": 10}})
    assert len(out["selected"]) == 5  # old max_papers 3 → clamped to 5
