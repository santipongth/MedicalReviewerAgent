from __future__ import annotations

import operator
from typing import Annotated, Any, TypedDict


class ReviewState(TypedDict, total=False):
    review_id: str
    topic: str
    language: str
    options: dict[str, Any]
    english_topic: str
    question: dict[str, Any] | None  # ReviewQuestion (English) after interpretation/refinement
    question_display: dict[str, Any] | None  # same fields in the user's language
    quality: Annotated[list[dict[str, Any]], operator.add]  # harness telemetry per stage (incl. seconds)
    rejected: str | None
    plan: dict[str, Any] | None  # QueryPlan
    candidates: list[dict[str, Any]]  # Candidate
    search_stats: dict[str, int]  # {"found": raw hits, "unique": after dedupe} for the PRISMA diagram
    # Send fan-out branches append to these; reducers merge them.
    screened: Annotated[list[dict[str, Any]], operator.add]  # {key, relevance, include, reason}
    selected: list[dict[str, Any]]  # {ref, relevance, reason, candidate}
    papers: Annotated[list[dict[str, Any]], operator.add]  # {ref, candidate, relevance, fulltext_source, card, error}
    synthesis: dict[str, Any] | None
    errors: Annotated[list[str], operator.add]
    cost_usd: Annotated[float, operator.add]
    result: dict[str, Any] | None
