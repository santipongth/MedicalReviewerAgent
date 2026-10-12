import pytest

from app.evals.models import Fixture
from app.evals.run import eval_state, replay
from app.graph.graph import build_freeze_graph
from tests.fakes import FakeStructuredLLM
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
async def test_replay_matches_the_primary_outcome_with_the_planner_bound_to_outcome_match():
    from app.evals.run import OutcomeMatch
    deps = make_deps()
    fx = fixture_from(await freeze_values(deps))
    asked = []

    def for_schema(role, schema):
        asked.append((role, schema))
        return FakeStructuredLLM("match", lambda s, u: OutcomeMatch(index=0))

    deps.llms.for_schema = for_schema
    rec = await replay(deps, fx, options={"max_papers": 8, "candidate_limit": 20}, repeat=1, run_id="r", git_sha="s",
                       primary_outcome="CRC incidence")
    assert rec.status == "done" and rec.primary_match.row_index == 0 and rec.primary_match.outcome
    assert asked == [("planner", OutcomeMatch)]


@pytest.mark.asyncio
async def test_replay_wrong_schema_from_matcher_counts_as_no_match():
    from app.graph.schemas import QueryPlan
    deps = make_deps()
    fx = fixture_from(await freeze_values(deps))
    deps.llms.for_schema = lambda role, schema: FakeStructuredLLM("match", lambda s, u: QueryPlan(
        queries=["q"], population="p", intervention_or_exposure="i", comparator="c", outcomes=["o"],
        inclusion_criteria=[], exclusion_criteria=[]))
    rec = await replay(deps, fx, options={"max_papers": 8, "candidate_limit": 20}, repeat=1, run_id="r", git_sha="s",
                       primary_outcome="CRC incidence")
    assert rec.status == "done" and rec.primary_match.row_index is None


def test_eval_state_carries_pool_and_question():
    fx = fixture_from({"candidates": [{"title": "x"}], "question": {"p": 1}, "plan": {"queries": ["q"]}})
    s = eval_state(fx, {"max_papers": 8})
    assert s["candidates"] == [{"title": "x"}] and s["plan"] == {"queries": ["q"]} and s["question"] == {"p": 1}


class _FakeGraph:
    def __init__(self, values=None, exc=None):
        self.values, self.exc = values, exc

    async def ainvoke(self, *a, **k):
        if self.exc:
            raise self.exc
        return self.values


async def _replay(deps, fx):
    return await replay(deps, fx, options={"max_papers": 8, "candidate_limit": 20}, repeat=1, run_id="r",
                        git_sha="s", primary_outcome="CRC incidence")


@pytest.mark.asyncio
async def test_replay_graph_exception_is_an_error_record(monkeypatch):
    deps = make_deps()
    fx = fixture_from(await freeze_values(deps))
    monkeypatch.setattr("app.evals.run.build_eval_graph", lambda d: _FakeGraph(exc=ValueError("boom")))
    rec = await _replay(deps, fx)
    assert rec.status == "error" and "boom" in rec.error
    assert rec.cost_usd == 0.0 and rec.citations == {"proposed": 0, "stripped": 0}


@pytest.mark.asyncio
async def test_replay_llm_exception_is_an_error_record():
    from tests.fakes import FakeStructuredLLM

    def boom(system, user):
        raise RuntimeError("llm down")

    deps = make_deps()
    fx = fixture_from(await freeze_values(deps))
    deps.llms.screener = FakeStructuredLLM("scr", boom)
    rec = await _replay(deps, fx)
    assert rec.status == "error" and "llm down" in rec.error
    assert "cost_usd" in rec.model_dump() and set(rec.citations) == {"proposed", "stripped"}


@pytest.mark.asyncio
async def test_replay_empty_result_is_an_error_keeping_cost(monkeypatch):
    deps = make_deps()
    fx = fixture_from(await freeze_values(deps))
    monkeypatch.setattr("app.evals.run.build_eval_graph", lambda d: _FakeGraph(values={"cost_usd": 0.5}))
    rec = await _replay(deps, fx)
    assert rec.status == "error" and rec.error == "empty result" and rec.result is None
    assert rec.cost_usd == 0.5
    assert set(rec.citations) == {"proposed", "stripped"}
