import pytest

from app.evals.models import Fixture
from app.evals.run import eval_state, replay
from app.graph.graph import build_freeze_graph
from tests.unit.test_review_graph import make_deps


def fixture_from(values, status="ok"):
    return Fixture(id="CD1", pool_version="v1", frozen_at="t", git_sha="s", prompt_version="p", engines=["pubmed"],
                   year_to=2025, topic="metformin and CRC", english_topic=values.get("english_topic"),
                   question=values.get("question"), plan=values.get("plan"), candidates=values.get("candidates") or [],
                   search_stats=values.get("search_stats") or {}, status=status)


async def freeze_values(deps):
    from app.graph.graph import initial_state
    g = build_freeze_graph(deps)
    state = {**initial_state("CD1", "metformin and CRC", "th", {"max_papers": 8, "candidate_limit": 20}),
             "eval_year_to": 2025}
    return await g.ainvoke(state, {"configurable": {"thread_id": "f"}})


@pytest.mark.asyncio
async def test_freeze_stops_after_enrich_with_candidates():
    deps = make_deps()
    values = await freeze_values(deps)
    assert values["candidates"] and values.get("result") is None
    assert deps.llms.screener.calls == []


@pytest.mark.asyncio
async def test_replay_starts_at_screening_and_finishes():
    deps = make_deps()
    fx = fixture_from(await freeze_values(deps))
    searches_before = deps.searxng.calls
    rec = await replay(deps, fx, options={"max_papers": 8, "candidate_limit": 20}, repeat=1, run_id="r", git_sha="s")
    assert rec.status == "done" and rec.result["synthesis_en"]
    assert deps.searxng.calls == searches_before  # no search during replay
    assert rec.citations.keys() == {"proposed", "stripped"}
    assert rec.cost_usd > 0


@pytest.mark.asyncio
async def test_replay_without_match_reports_none():
    deps = make_deps()
    fx = fixture_from(await freeze_values(deps))
    rec = await replay(deps, fx, options={"max_papers": 8, "candidate_limit": 20}, repeat=1, run_id="r", git_sha="s",
                       primary_outcome="")
    assert rec.primary_match is not None and rec.primary_match.row_index is None


@pytest.mark.asyncio
async def test_replay_wrong_schema_from_matcher_counts_as_no_match():
    deps = make_deps()  # the planner fake returns a QueryPlan, not an OutcomeMatch
    fx = fixture_from(await freeze_values(deps))
    rec = await replay(deps, fx, options={"max_papers": 8, "candidate_limit": 20}, repeat=1, run_id="r", git_sha="s",
                       primary_outcome="CRC incidence")
    assert rec.status == "done" and rec.primary_match.row_index is None


def test_eval_state_carries_pool_and_question():
    fx = fixture_from({"candidates": [{"title": "x"}], "question": {"p": 1}, "plan": {"queries": ["q"]}})
    s = eval_state(fx, {"max_papers": 8})
    assert s["candidates"] == [{"title": "x"}] and s["plan"] == {"queries": ["q"]} and s["question"] == {"p": 1}
