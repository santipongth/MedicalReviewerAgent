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
