from langgraph.graph import END, START, StateGraph

from app.graph.progress import progress_writer
from app.graph.state import ReviewState


def test_progress_writer_is_noop_outside_a_graph():
    progress_writer()({"type": "planning"})  # must not raise


async def test_progress_writer_streams_inside_a_graph():
    async def node(state: ReviewState) -> dict:
        progress_writer()({"type": "planning", "n": 1})
        return {}

    b = StateGraph(ReviewState)
    b.add_node("n", node)
    b.add_edge(START, "n")
    b.add_edge("n", END)
    chunks = [c async for c in b.compile().astream({"topic": "t"}, stream_mode="custom")]
    assert chunks == [{"type": "planning", "n": 1}]
