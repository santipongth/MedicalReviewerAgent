"""Deterministic checks for the interpreted/refined review question."""
from __future__ import annotations

import re
from typing import Any

from app.graph.schemas import ReviewQuestion
from app.harness.study_types import loose as _loose  # noqa: F401  (kept: imported by tests)
from app.harness.study_types import missing_study_types
from app.services.text import normalize_title

_THAI = re.compile(r"[฀-๿]")
COMPARATIVE_TYPES = {"therapy", "prevention"}


def _english_fields(q: ReviewQuestion) -> list[str]:
    texts = [q.interpretation, q.refined_question, q.population, q.intervention_or_exposure, q.comparator,
             q.concept or "", q.context or "", *q.outcomes, *q.study_designs, *q.sub_questions, *q.assumptions, *q.ambiguities, q.timeframe or ""]
    for kt in q.key_terms:
        texts += [kt.term, *kt.synonyms, kt.mesh or ""]
    return texts


def question_problems(q: ReviewQuestion, options: dict[str, Any], review_type: str = "slr",
                      enforce_study_types: bool = True) -> list[str]:
    scoping = review_type == "scoping"
    problems: list[str] = []
    rq = q.refined_question.strip()
    if not rq.endswith("?"):
        problems.append("refined_question must be a single question ending with '?'")
    if not 40 <= len(rq) <= 400:
        problems.append(f"refined_question must be 40-400 characters (got {len(rq)})")
    if not q.population.strip():
        problems.append("population must not be empty")
    if not q.intervention_or_exposure.strip():
        problems.append("intervention_or_exposure must not be empty")
    if not 1 <= len([o for o in q.outcomes if o.strip()]) <= 6:
        problems.append("outcomes must list 1-6 measurable outcomes, primary outcome first")
    if scoping:  # PCC: the concept is the intervention_or_exposure; a comparator is optional
        if not (q.concept or "").strip():
            problems.append("concept must not be empty (the phenomenon being mapped)")
        if not (q.context or "").strip():
            problems.append("context must not be empty (setting, geography or care level)")
    elif q.question_type in COMPARATIVE_TYPES and not q.comparator.strip():
        problems.append("comparator must be stated for therapy/prevention questions (e.g. placebo, usual care)")
    if not 1 <= len(q.sub_questions) <= 4:
        problems.append("sub_questions must contain 1-4 questions that together cover the topic")
    if any(_THAI.search(t) for t in _english_fields(q)):
        problems.append("write every field in English (translation to the user's language happens later)")
    intervention_words = {w for w in normalize_title(q.intervention_or_exposure).split() if len(w) >= 4}
    term_words = {w for kt in q.key_terms for t in (kt.term, *kt.synonyms) for w in normalize_title(t).split()}
    if intervention_words and not intervention_words & term_words:
        problems.append("key_terms must include the intervention/exposure with its synonyms and MeSH heading")
    year_from = options.get("year_from")
    if year_from and str(year_from) not in (q.timeframe or ""):
        problems.append(f"timeframe must state that only studies from {year_from} onward are included")
    # Only canonical names (a fixed list, never user text) are hard-checked, through their synonyms. A free-text
    # "Other: ..." entry stays a soft constraint (data in the User constraints line): it may be in any language, and
    # a problem never quotes it. The refiner turns the check off and appends missing names in code instead.
    missing = missing_study_types(options, q.study_designs) if enforce_study_types else []
    if missing:
        problems.append(f"study_designs must include {', '.join(missing)} (requested by the user)")
    return problems

