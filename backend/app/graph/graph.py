from __future__ import annotations

import time
from dataclasses import dataclass
from functools import partial
from typing import Any

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph

from app.config import Settings
from app.graph.nodes import external, intake, reading, retrieval, screening, stubs, synthesis
from app.graph.state import ReviewState


@dataclass
class GraphDeps:
    settings: Settings
    llms: Any = None  # app.services.llm.LLMs; None -> Plan 1 stub graph
    searxng: Any = None
    europepmc: Any = None
    fulltext: Any = None
    mcp: Any = None  # app.services.mcp_client.McpRegistry (external MCP tools); None → never consulted


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
        started_at=time.time(),
    )


def build_stub_graph(checkpointer: BaseCheckpointSaver | None = None):
    builder = StateGraph(ReviewState)
    builder.add_node("plan_queries", stubs.plan_queries)
    builder.add_node("finalize", stubs.finalize)
    builder.add_edge(START, "plan_queries")
    builder.add_edge("plan_queries", "finalize")
    builder.add_edge("finalize", END)
    return builder.compile(checkpointer=checkpointer)


def build_graph(deps: GraphDeps, checkpointer: BaseCheckpointSaver | None = None):
    """topic_guard → refine_question → plan_queries → search → enrich → screen_batch* → select_top
    → read_paper* → normalize_outcomes → explain_conflict* → write_synthesis → localize → finalize
    (* = Send fan-out, run in parallel)."""
    if deps.llms is None:
        return build_stub_graph(checkpointer)
    b = StateGraph(ReviewState)
    b.add_node("topic_guard", intake.make_topic_guard(deps))
    b.add_node("refine_question", intake.make_refine_question(deps))
    b.add_node("plan_queries", intake.make_plan_queries(deps))
    b.add_node("search", retrieval.make_search(deps))
    b.add_node("enrich", retrieval.make_enrich(deps))
    b.add_node("screen_batch", screening.make_screen_batch(deps))
    b.add_node("select_top", screening.make_select_top(deps))
    b.add_node("read_paper", reading.make_read_paper(deps))
    b.add_node("external_enrich", external.make_external_enrich(deps))
    b.add_node("normalize_outcomes", synthesis.make_normalize_outcomes(deps))
    b.add_node("explain_conflict", synthesis.make_explain_conflict(deps))
    b.add_node("write_synthesis", synthesis.make_write_synthesis(deps))
    b.add_node("localize", synthesis.make_localize(deps))
    b.add_node("finalize", synthesis.make_finalize(deps))

    b.add_edge(START, "topic_guard")
    b.add_conditional_edges("topic_guard", intake.route_after_guard, ["refine_question", END])
    b.add_edge("refine_question", "plan_queries")
    b.add_edge("plan_queries", "search")
    b.add_edge("search", "enrich")
    b.add_conditional_edges(
        "enrich", partial(screening.route_to_screening, batch_size=deps.settings.screen_batch_size),
        ["screen_batch", "normalize_outcomes"],
    )
    b.add_edge("screen_batch", "select_top")
    b.add_conditional_edges(
        "select_top",
        partial(screening.route_to_reading, external_enabled=lambda: deps.mcp is not None and deps.mcp.enabled),
        ["read_paper", "external_enrich", "normalize_outcomes"],
    )
    b.add_edge("read_paper", "normalize_outcomes")
    b.add_edge("external_enrich", "normalize_outcomes")
    b.add_conditional_edges("normalize_outcomes", synthesis.route_conflicts, ["explain_conflict", "write_synthesis"])
    b.add_edge("explain_conflict", "write_synthesis")
    b.add_edge("write_synthesis", "localize")
    b.add_edge("localize", "finalize")
    b.add_edge("finalize", END)
    return b.compile(checkpointer=checkpointer)
