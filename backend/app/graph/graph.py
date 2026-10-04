from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph

from app.config import Settings
from app.graph.nodes import stubs
from app.graph.state import ReviewState


@dataclass
class GraphDeps:
    settings: Settings
    llms: Any = None  # app.services.llm.LLMs; None -> Plan 1 stub graph
    searxng: Any = None
    europepmc: Any = None
    fulltext: Any = None


def initial_state(
    review_id: str, topic: str, language: str, options: dict[str, Any]
) -> ReviewState:
    return ReviewState(
        review_id=review_id,
        topic=topic,
        language=language,
        options=options,
        errors=[],
        cost_usd=0.0,
        result=None,
    )


def build_graph(deps: GraphDeps, checkpointer: BaseCheckpointSaver | None = None):
    builder = StateGraph(ReviewState)
    builder.add_node("plan_queries", stubs.plan_queries)
    builder.add_node("finalize", stubs.finalize)
    builder.add_edge(START, "plan_queries")
    builder.add_edge("plan_queries", "finalize")
    builder.add_edge("finalize", END)
    return builder.compile(checkpointer=checkpointer)
