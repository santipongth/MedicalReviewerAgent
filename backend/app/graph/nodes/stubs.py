from __future__ import annotations

import asyncio

from langgraph.config import get_stream_writer

from app.graph.state import ReviewState


async def plan_queries(state: ReviewState) -> dict:
    writer = get_stream_writer()
    writer({"type": "planning", "topic": state["topic"]})
    return {}


def make_wait(seconds: float):
    """Load tests: the stub review takes about as long as a real one, without calling any model."""
    async def wait(state: ReviewState) -> dict:
        if seconds > 0:
            get_stream_writer()({"type": "reading", "ref": "P1", "title": "simulated paper"})
            await asyncio.sleep(seconds)
        return {}
    return wait


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
