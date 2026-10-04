from __future__ import annotations

from langgraph.config import get_stream_writer

from app.graph.state import ReviewState


async def plan_queries(state: ReviewState) -> dict:
    writer = get_stream_writer()
    writer({"type": "planning", "topic": state["topic"]})
    return {}


async def finalize(state: ReviewState) -> dict:
    writer = get_stream_writer()
    writer({"type": "synthesizing"})
    return {
        "result": {
            "summary": f"Stub review for: {state['topic']}",
            "language": state["language"],
            "papers": [],
            "comparison": [],
        }
    }
