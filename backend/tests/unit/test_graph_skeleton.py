from langgraph.checkpoint.memory import InMemorySaver

from app.config import Settings
from app.graph.graph import GraphDeps, build_graph, initial_state


async def test_stub_graph_streams_progress_and_produces_result():
    graph = build_graph(GraphDeps(settings=Settings(_env_file=None)), checkpointer=InMemorySaver())
    config = {"configurable": {"thread_id": "t1"}}
    state = initial_state("t1", "metformin colorectal cancer", "th", {"max_papers": 10})

    custom, updates = [], []
    async for mode, chunk in graph.astream(
        state, config, stream_mode=["custom", "updates"], durability="sync"
    ):
        (custom if mode == "custom" else updates).append(chunk)

    assert [c["type"] for c in custom] == ["planning", "synthesizing"]
    assert [list(u.keys())[0] for u in updates] == ["plan_queries", "finalize"]

    final = await graph.aget_state(config)
    assert final.values["result"]["summary"].startswith("Stub review")
    assert final.values["result"]["language"] == "th"
    assert final.values["errors"] == []
    assert final.values["cost_usd"] == 0.0


async def test_errors_and_cost_use_add_reducers():
    from langgraph.graph import END, START, StateGraph

    from app.graph.state import ReviewState

    async def a(state):
        return {"errors": ["a failed"], "cost_usd": 0.25}

    async def b(state):
        return {"errors": ["b failed"], "cost_usd": 0.5}

    builder = StateGraph(ReviewState)
    builder.add_node("a", a)
    builder.add_node("b", b)
    builder.add_edge(START, "a")
    builder.add_edge(START, "b")  # parallel writers in the same superstep
    builder.add_edge("a", END)
    builder.add_edge("b", END)
    out = await builder.compile().ainvoke(initial_state("x", "topic", "en", {}))
    assert sorted(out["errors"]) == ["a failed", "b failed"]
    assert out["cost_usd"] == 0.75
