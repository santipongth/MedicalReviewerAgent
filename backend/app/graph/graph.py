from __future__ import annotations

import time
from dataclasses import dataclass
from functools import partial
from itertools import pairwise
from typing import Any

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph

from app.config import Settings
from app.graph.nodes import (
    citations,
    external,
    intake,
    reading,
    retrieval,
    screening,
    stubs,
    synthesis,
)
from app.graph.state import ReviewState


@dataclass
class GraphDeps:
    settings: Settings
    llms: Any = None  # app.services.llm.LLMs; None -> Plan 1 stub graph
    searxng: Any = None
    europepmc: Any = None
    openalex: Any = None  # app.services.openalex.OpenAlexClient; None -> no citation step
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


def _build_timed_stub_graph(checkpointer: BaseCheckpointSaver | None, delay_seconds: float, settings: Settings):
    """Mirrors the real graph's shape and events on a scaled timeline (no model calls). Every phase is its own
    node, so a worker restart resumes at the checkpointed node."""
    nodes = stubs.make_timed_nodes(stubs.StubTimeline(delay_seconds), settings)
    b = StateGraph(ReviewState)
    chain = ["topic_guard", "refine_question", "plan_queries", "search", "enrich"]
    for name in [*chain, "screen_batch", "select_top", "read_paper", "normalize_outcomes", "write_synthesis",
                 "localize", "finalize"]:
        b.add_node(name, nodes[name])
    b.add_edge(START, chain[0])
    for a, c in pairwise(chain):
        b.add_edge(a, c)
    b.add_conditional_edges("enrich", nodes["route_to_screening"], ["screen_batch", "normalize_outcomes"])
    b.add_edge("screen_batch", "select_top")
    b.add_conditional_edges("select_top", nodes["route_to_reading"], ["read_paper", "normalize_outcomes"])
    b.add_edge("read_paper", "normalize_outcomes")
    b.add_edge("normalize_outcomes", "write_synthesis")
    b.add_edge("write_synthesis", "localize")
    b.add_edge("localize", "finalize")
    b.add_edge("finalize", END)
    return b.compile(checkpointer=checkpointer)


def build_stub_graph(checkpointer: BaseCheckpointSaver | None = None, delay_seconds: float = 0.0,
                     settings: Settings | None = None):
    if delay_seconds > 0 and settings is not None:
        return _build_timed_stub_graph(checkpointer, delay_seconds, settings)
    builder = StateGraph(ReviewState)
    builder.add_node("plan_queries", stubs.plan_queries)
    builder.add_node("finalize", stubs.finalize)
    builder.add_edge(START, "plan_queries")
    if delay_seconds > 0:  # load tests: a stub review that lasts about as long as a real one
        builder.add_node("wait", stubs.make_wait(delay_seconds))
        builder.add_edge("plan_queries", "wait")
        builder.add_edge("wait", "finalize")
    else:
        builder.add_edge("plan_queries", "finalize")
    builder.add_edge("finalize", END)
    return builder.compile(checkpointer=checkpointer)


def build_graph(deps: GraphDeps, checkpointer: BaseCheckpointSaver | None = None):
    """topic_guard → refine_question → plan_queries → search → enrich → screen_batch* → select_top
    → read_paper* → normalize_outcomes → explain_conflict* → write_synthesis → localize → finalize
    (* = Send fan-out, run in parallel)."""
    if deps.llms is None:
        return build_stub_graph(checkpointer, deps.settings.stub_delay_seconds, deps.settings)
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
    b.add_node("fetch_citations", citations.make_fetch_citations(deps))
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
        partial(screening.route_to_reading, external_enabled=lambda: deps.mcp is not None and deps.mcp.enabled,
                citations_enabled=lambda: deps.openalex is not None),
        ["read_paper", "external_enrich", "fetch_citations", "normalize_outcomes"],
    )
    b.add_edge("read_paper", "normalize_outcomes")
    b.add_edge("external_enrich", "normalize_outcomes")
    b.add_edge("fetch_citations", "normalize_outcomes")
    b.add_conditional_edges("normalize_outcomes", synthesis.route_conflicts, ["explain_conflict", "write_synthesis"])
    b.add_edge("explain_conflict", "write_synthesis")
    b.add_edge("write_synthesis", "localize")
    b.add_edge("localize", "finalize")
    b.add_edge("finalize", END)
    return b.compile(checkpointer=checkpointer)
