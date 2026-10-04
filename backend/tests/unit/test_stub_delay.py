import time

from langgraph.checkpoint.memory import InMemorySaver

from app.config import Settings
from app.graph.graph import GraphDeps, build_graph, initial_state


async def test_stub_graph_can_simulate_a_slow_review_for_load_tests():
    graph = build_graph(GraphDeps(settings=Settings(_env_file=None, graph_mode="stub", stub_delay_seconds=0.2)),
                        checkpointer=InMemorySaver())
    started = time.perf_counter()
    out = await graph.ainvoke(initial_state("r", "topic", "en", {}), {"configurable": {"thread_id": "r"}})
    assert time.perf_counter() - started >= 0.2 and out["result"]["summary"].startswith("Stub review")
