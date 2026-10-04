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
    started_at: float  # epoch seconds when the review started (total time in quality.timings)
    matrix: dict[str, Any] | None  # {rows, consensus, conflicts, grade} built by code from the cards
    conflict_notes: Annotated[list[dict[str, Any]], operator.add]  # ConflictNote per conflicting outcome
    localized_cards: dict[str, dict[str, Any]] | None  # ref -> card in the user's language
    synthesis: dict[str, Any] | None  # Synthesis (English)
    synthesis_display: dict[str, Any] | None  # Synthesis in the user's language
    errors: Annotated[list[str], operator.add]
    cost_usd: Annotated[float, operator.add]
    result: dict[str, Any] | None
