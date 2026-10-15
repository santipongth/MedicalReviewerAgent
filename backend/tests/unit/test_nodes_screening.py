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
from app.services.llm import NOT_CONFIGURED_ERROR, LLMError, LLMs, MissingKeyLLM
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


async def test_a_missing_key_leaves_no_reason_in_the_screening_note():
    reason = "no key for provider deepseek (the stored key belongs to https://llm.internal.example; enter one)"
    out = await make_screen_batch(deps(MissingKeyLLM("deepseek-chat", reason=reason)))(payload(2))
    assert out["errors"] == [f"screening batch failed: {NOT_CONFIGURED_ERROR}"]
    assert "internal.example" not in str(out) and "deepseek" not in str(out)


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


async def test_screen_batch_records_the_screeners_design_guess():
    def respond(system, user):
        return ScreenBatch(decisions=[ScreenDecision(ref=r, relevance=90, include=True, reason="ok",
                                                     design_guess="narrative_review" if r == "C1" else "rct")
                                      for r in refs_in(user)])
    out = await make_screen_batch(deps(FakeStructuredLLM("s", respond)))(payload(3))
    assert [d["design"] for d in out["screened"]] == ["narrative_review", "rct", "rct"]
    from app.graph.prompts import SCREEN_SYSTEM
    assert "design_guess" in SCREEN_SYSTEM


async def test_select_top_drops_narrative_reviews_when_enough_primary_evidence_exists():
    candidates = cands(6)
    designs = ["narrative_review", "rct", "narrative_review", "cohort", "sr_ma_rct", "narrative_review"]
    screened = [{"key": c["key"], "relevance": 99 - i, "include": True, "reason": "r", "uncertain": False,
                 "design": designs[i]} for i, c in enumerate(candidates)]
    out = await make_select_top(deps(FakeStructuredLLM("g", scorer({}))))(
        {"candidates": candidates, "screened": screened, "options": {}})
    assert [s["candidate"]["key"] for s in out["selected"]] == [candidates[i]["key"] for i in (1, 3, 4)]
    assert out["quality"][0]["narrative_excluded"] == 3
    few = screened[:3]  # only 1 primary study: narrative reviews are kept so the review has something
    out2 = await make_select_top(deps(FakeStructuredLLM("g", scorer({}))))(
        {"candidates": candidates, "screened": few, "options": {}})
    assert len(out2["selected"]) == 3


def _screened(candidates, designs, include=True, **extra):
    return [{"key": c["key"], "relevance": 99 - i, "include": include, "reason": "r", "uncertain": False,
             "design": designs[i], **extra} for i, c in enumerate(candidates)]


async def test_scoping_and_narrative_keep_narrative_reviews():
    candidates = cands(6)
    designs = ["narrative_review", "rct", "narrative_review", "cohort", "sr_ma_rct", "narrative_review"]
    screened = _screened(candidates, designs)
    for rt in ("scoping", "narrative"):
        out = await make_select_top(deps(FakeStructuredLLM("g", scorer({}))))(
            {"candidates": candidates, "screened": screened, "options": {"review_type": rt}})
        assert len(out["selected"]) == 6
        assert out["quality"][0]["narrative_excluded"] == 0
        assert out["selection_stats"]["narrative_excluded"] == 0
    slr = await make_select_top(deps(FakeStructuredLLM("g", scorer({}))))(
        {"candidates": candidates, "screened": screened, "options": {"review_type": "slr"}})
    assert len(slr["selected"]) == 3 and slr["selection_stats"]["narrative_excluded"] == 3


async def test_select_top_tallies_exclusion_reasons_and_over_limit():
    candidates = cands(10)
    reasons = ["population", "population", "outcome", None, "off_topic"]
    screened = [{"key": c["key"], "relevance": 90 - i, "include": i >= 5, "reason": "r", "uncertain": False,
                 "design": "rct", "exclusion_reason": reasons[i] if i < 5 else None}
                for i, c in enumerate(candidates)]
    out = await make_select_top(deps(FakeStructuredLLM("g", scorer({}))))(
        {"candidates": candidates, "screened": screened, "options": {"max_papers": 5}})
    assert out["selection_stats"] == {
        "excluded_screening": {"population": 2, "outcome": 1, "other": 1, "off_topic": 1},
        "narrative_excluded": 0, "over_limit": 0, "requested": 5, "eligible": 5}
    many = _screened(candidates, ["rct"] * 10, exclusion_reason=None)
    out = await make_select_top(deps(FakeStructuredLLM("g", scorer({}))))(
        {"candidates": candidates, "screened": many, "options": {"max_papers": 5}})
    assert len(out["selected"]) == 5 and out["selection_stats"]["over_limit"] == 5


async def test_screen_batch_coerces_exclusion_reason():
    def respond(system, user):
        return ScreenBatch(decisions=[
            ScreenDecision(ref="C1", relevance=90, include=True, reason="ok", exclusion_reason="outcome"),
            ScreenDecision(ref="C2", relevance=5, include=False, reason="no"),
            ScreenDecision(ref="C3", relevance=5, include=False, reason="no", exclusion_reason="population")])
    out = await make_screen_batch(deps(FakeStructuredLLM("s", respond)))(payload(3))
    assert [d["exclusion_reason"] for d in out["screened"]] == [None, "other", "population"]


async def test_screen_batch_uses_the_review_types_system_prompt():
    from app.graph.prompts import SCREEN_SYSTEM, screen_system
    seen = {}

    def respond(system, user):
        seen["system"] = system
        return scorer({})(system, user)
    for rt in ("slr", "scoping", "narrative"):
        await make_screen_batch(deps(FakeStructuredLLM("s", respond)))({**payload(2), "review_type": rt})
        assert seen["system"] == screen_system(rt)
    assert screen_system("slr") == SCREEN_SYSTEM
    sends = route_to_screening({"topic": "t", "candidates": cands(2), "options": {"review_type": "scoping"}})
    assert sends[0].arg["review_type"] == "scoping"


def test_screen_decision_schema_requires_nullable_exclusion_reason():
    schema = ScreenBatch.model_json_schema()["$defs"]["ScreenDecision"]
    assert "exclusion_reason" in schema["required"] and "default" not in schema["properties"]["exclusion_reason"]


async def test_unresolved_disagreement_clears_exclusion_reason_on_forced_include():
    first = ScreenBatch(decisions=[ScreenDecision(ref="C1", relevance=50, include=False, reason="x",
                                                  exclusion_reason="outcome")])
    second = ScreenBatch(decisions=[ScreenDecision(ref="C1", relevance=50, include=True, reason="y")])
    out = await make_screen_batch(deps(FakeStructuredLLM("s", lambda s, u: first),
                                       secondary=FakeStructuredLLM("s2", lambda s, u: second)))(payload(1))
    d = out["screened"][0]
    assert d["include"] is True and d["uncertain"] is True and d["exclusion_reason"] is None


async def test_failed_screening_stays_out_of_prisma_other_tally():
    candidates = cands(3)
    screened = [{"key": candidates[0]["key"], "relevance": 5, "include": False, "reason": "no", "uncertain": False,
                 "design": None, "exclusion_reason": "population"},
                {"key": candidates[1]["key"], "relevance": 0, "include": False, "reason": "not screened",
                 "uncertain": False, "exclusion_reason": "other", "screen_failed": True},
                {"key": candidates[2]["key"], "relevance": 90, "include": True, "reason": "ok", "uncertain": False,
                 "design": "rct", "exclusion_reason": None}]
    out = await make_select_top(deps(FakeStructuredLLM("g", scorer({}))))(
        {"candidates": candidates, "screened": screened, "options": {}})
    assert out["selection_stats"]["excluded_screening"] == {"population": 1}
    assert out["selection_stats"]["screening_failed"] == 1
    out = await make_select_top(deps(FakeStructuredLLM("g", scorer({}))))(
        {"candidates": candidates, "screened": [screened[0], screened[2]], "options": {}})
    assert "screening_failed" not in out["selection_stats"]


# ---- Plan 21: the requested count is analysed when enough papers are eligible, never padded -------------------
async def _select(monkeypatch, n_eligible, max_papers):
    from app.graph.nodes import screening as screening_node
    events = []
    monkeypatch.setattr(screening_node, "progress_writer", lambda: events.append)
    candidates = cands(n_eligible)
    screened = [{**d, "relevance": 90 - i // 2}  # all above the relevance floor
                for i, d in enumerate(_screened(candidates, ["rct"] * n_eligible, exclusion_reason=None))]
    out = await make_select_top(deps(FakeStructuredLLM("g", scorer({}))))(
        {"candidates": candidates, "screened": screened,
         "options": {"max_papers": max_papers, "candidate_limit": 120}})
    return out, events


async def test_select_top_analyses_n_of_many(monkeypatch):
    out, events = await _select(monkeypatch, 80, 50)
    stats = out["selection_stats"]
    assert len(out["selected"]) == 50
    assert stats["over_limit"] == 30 and stats["eligible"] == 80 and stats["requested"] == 50
    assert events == [{"type": "screened", "kept": 50, "total": 80, "requested": 50}]


@pytest.mark.parametrize(("eligible", "n"), [(22, 50), (5, 5), (49, 50), (50, 50), (7, 30)])
async def test_select_top_never_pads_a_shortfall(monkeypatch, eligible, n):
    out, events = await _select(monkeypatch, eligible, n)
    stats = out["selection_stats"]
    assert len(out["selected"]) == min(n, eligible)
    assert stats["eligible"] == eligible and stats["requested"] == n
    assert stats["over_limit"] == max(0, eligible - n)
    assert events[-1]["requested"] == n
