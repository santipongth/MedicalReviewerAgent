import uuid

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph

from app.config import Settings
from app.db.repositories import EventRepository, ReviewRepository
from app.graph.graph import GraphDeps, build_graph
from app.graph.state import ReviewState
from app.services.events import EventSink
from app.worker.runner import ReviewRunner


async def _queued_review(session_factory):
    async with session_factory() as s, s.begin():
        return await ReviewRepository(s).create(
            topic="metformin", language="en", options={"max_papers": 5}, cache_key="k"
        )


async def test_run_completes_review_and_emits_events(session_factory, redis):
    review = await _queued_review(session_factory)
    sink = EventSink(session_factory, redis, 60)
    graph = build_graph(GraphDeps(settings=Settings(_env_file=None)), checkpointer=InMemorySaver())
    status = await ReviewRunner(session_factory, sink, graph).run(review.id)
    assert status == "done"

    async with session_factory() as s:
        got = await ReviewRepository(s).get(review.id)
        events = await EventRepository(s).list_since(review.id, 0)
    assert got.status == "done"
    assert got.result["summary"] == "Stub review for: metformin"
    assert got.started_at is not None and got.finished_at is not None
    assert [e.type for e in events] == ["started", "planning", "synthesizing", "done"]


def _failing_graph():
    async def boom(state: ReviewState) -> dict:
        get_stream_writer()({"type": "planning"})
        raise RuntimeError("upstream exploded")

    b = StateGraph(ReviewState)
    b.add_node("boom", boom)
    b.add_edge(START, "boom")
    b.add_edge("boom", END)
    return b.compile(checkpointer=InMemorySaver())


async def test_exception_marks_error_and_emits_error_event(session_factory, redis):
    review = await _queued_review(session_factory)
    sink = EventSink(session_factory, redis, 60)
    status = await ReviewRunner(session_factory, sink, _failing_graph()).run(review.id)
    assert status == "error"
    async with session_factory() as s:
        got = await ReviewRepository(s).get(review.id)
        events = await EventRepository(s).list_since(review.id, 0)
    assert got.status == "error" and "upstream exploded" in got.error
    assert events[-1].type == "error" and "upstream exploded" in events[-1].payload["message"]


async def test_terminal_review_is_not_rerun(session_factory, redis):
    review = await _queued_review(session_factory)
    async with session_factory() as s, s.begin():
        await ReviewRepository(s).update(review.id, status="done")
    sink = EventSink(session_factory, redis, 60)
    graph = build_graph(GraphDeps(settings=Settings(_env_file=None)))
    assert await ReviewRunner(session_factory, sink, graph).run(review.id) == "done"
    async with session_factory() as s:
        assert await EventRepository(s).list_since(review.id, 0) == []


async def test_missing_review_returns_missing(session_factory, redis):
    sink = EventSink(session_factory, redis, 60)
    graph = build_graph(GraphDeps(settings=Settings(_env_file=None)))
    assert await ReviewRunner(session_factory, sink, graph).run(uuid.uuid4()) == "missing"


def _single_node_graph(fn):
    b = StateGraph(ReviewState)
    b.add_node("only", fn)
    b.add_edge(START, "only")
    b.add_edge("only", END)
    return b.compile(checkpointer=InMemorySaver())


async def test_rejected_graph_result_sets_rejected_status(session_factory, redis):
    async def guard(state: ReviewState) -> dict:
        return {"rejected": "not a medical topic", "cost_usd": 0.001}

    review = await _queued_review(session_factory)
    sink = EventSink(session_factory, redis, 60)
    status = await ReviewRunner(session_factory, sink, _single_node_graph(guard)).run(review.id)
    assert status == "rejected"
    async with session_factory() as s:
        got = await ReviewRepository(s).get(review.id)
        events = await EventRepository(s).list_since(review.id, 0)
    assert got.status == "rejected" and got.error == "not a medical topic"
    assert float(got.cost_usd) == 0.001
    assert events[-1].type == "rejected" and events[-1].payload["reason"] == "not a medical topic"


async def test_done_review_records_prompt_and_model_versions(session_factory, redis):
    async def fin(state: ReviewState) -> dict:
        return {"result": {"summary": "s", "prompt_version": "pv1", "models": {"synthesizer": "m"}}}

    review = await _queued_review(session_factory)
    sink = EventSink(session_factory, redis, 60)
    assert await ReviewRunner(session_factory, sink, _single_node_graph(fin)).run(review.id) == "done"
    async with session_factory() as s:
        got = await ReviewRepository(s).get(review.id)
    assert got.prompt_version == "pv1" and got.model_versions == {"synthesizer": "m"}


async def test_every_event_carries_elapsed_seconds(session_factory, redis):
    review = await _queued_review(session_factory)
    sink = EventSink(session_factory, redis, 60)
    graph = build_graph(GraphDeps(settings=Settings(_env_file=None)), checkpointer=InMemorySaver())
    await ReviewRunner(session_factory, sink, graph).run(review.id)
    async with session_factory() as s:
        events = await EventRepository(s).list_since(review.id, 0)
    assert all(isinstance(e.payload.get("elapsed_s"), float) and e.payload["elapsed_s"] >= 0 for e in events)


async def test_finished_review_cost_counts_toward_the_daily_budget(session_factory, redis):
    from app.services.capacity import Capacity

    async def fin(state: ReviewState) -> dict:
        return {"result": {"summary": "s"}, "cost_usd": 0.04}

    capacity = Capacity(redis, Settings(_env_file=None))
    review = await _queued_review(session_factory)
    sink = EventSink(session_factory, redis, 60)
    assert await ReviewRunner(session_factory, sink, _single_node_graph(fin), capacity=capacity).run(review.id) == "done"
    assert round(await capacity.usd_today(), 4) == 0.04


async def test_each_review_runs_under_the_configured_cost_cap(session_factory, redis):
    from app.services.budget import current_budget
    seen = {}

    async def fin(state: ReviewState) -> dict:
        seen["cap"] = current_budget().cap_usd if current_budget() else None
        return {"result": {"summary": "s"}}

    review = await _queued_review(session_factory)
    sink = EventSink(session_factory, redis, 60)
    assert await ReviewRunner(session_factory, sink, _single_node_graph(fin), cost_cap_usd=0.25).run(review.id) == "done"
    assert seen["cap"] == 0.25


async def test_an_errored_review_still_counts_what_it_spent(session_factory, redis):
    from app.services.budget import current_budget
    from app.services.capacity import Capacity

    async def boom(state: ReviewState) -> dict:
        current_budget().charge(0.07)  # LLM calls made before the failure
        raise RuntimeError("provider outage")

    capacity = Capacity(redis, Settings(_env_file=None))
    review = await _queued_review(session_factory)
    sink = EventSink(session_factory, redis, 60)
    runner = ReviewRunner(session_factory, sink, _single_node_graph(boom), capacity=capacity, cost_cap_usd=0.25)
    assert await runner.run(review.id) == "error"
    assert round(await capacity.usd_today(), 4) == 0.07
    async with session_factory() as s:
        assert float((await ReviewRepository(s).get(review.id)).cost_usd) == 0.07
