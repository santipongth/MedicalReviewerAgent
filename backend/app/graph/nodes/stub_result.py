"""Deterministic, representative result for the timed stub (STUB_DELAY_SECONDS > 0), so manual QA shows the
report views (literature matrix, concept map, evidence map, PRISMA) without calling a model. Illustrative only."""
from __future__ import annotations

from typing import Any

# (design_category, study_design, year, direction, risk_of_bias, sample_size, effect_value, ci)
_PAPERS = (
    ("rct", "Randomized controlled trial", 2021, "positive", "low", 412, 0.78, (0.63, 0.96)),
    ("rct", "Randomized controlled trial", 2019, "null", "moderate", 230, 0.97, (0.74, 1.27)),
    ("cohort", "Prospective cohort study", 2020, "positive", "moderate", 5120, 0.84, (0.72, 0.98)),
    ("cohort", "Retrospective cohort study", 2018, "negative", "high", 1893, 1.22, (1.01, 1.47)),
    ("sr_ma_rct", "Systematic review and meta-analysis of RCTs", 2022, "mixed", "low", None, None, None),
    ("narrative_review", "Narrative review", 2017, "unclear", "unclear", None, None, None),
)


def _card(i: int, topic: str) -> dict[str, Any]:
    design, study_design, _year, direction, rob, n, effect, ci = _PAPERS[i]
    has_effect = effect is not None
    outcomes = [{
        "outcome": "Primary outcome", "result": f"Reported {direction} association for {topic}.",
        "evidence_quote": None, "effect_size": None,
        "effect_measure": "HR" if has_effect else None, "effect_value": effect,
        "ci_lower": ci[0] if ci else None, "ci_upper": ci[1] if ci else None, "p_value": None,
        "direction": direction,
    }]
    return {
        "study_design": study_design, "design_category": design,
        "population": f"Adults studied in the context of {topic}",
        "sample_size": n, "sample_size_quote": None,
        "intervention_or_exposure": "Index intervention",
        "comparator": "Placebo or usual care" if design == "rct" else None,
        "outcomes": outcomes,
        "key_findings": [f"Simulated finding {i + 1} for {topic}."],
        "limitations": ["Illustrative stub data; abstract-only reading."],
        "funding_or_conflicts": None, "risk_of_bias": rob, "overall_direction": direction,
    }


def stub_result(topic: str, language: str, review_type: str = "slr") -> dict[str, Any]:
    papers = []
    for i, (_d, _s, year, *_rest) in enumerate(_PAPERS):
        card = _card(i, topic)
        papers.append({
            "ref": f"P{i + 1}", "title": f"Simulated study {i + 1}: {topic}", "authors": ["Stub A", "Stub B"],
            "year": year, "journal": "Journal of Simulated Evidence", "doi": None, "pmid": None, "pmcid": None,
            "url": None, "relevance": round(0.95 - 0.05 * i, 2), "screen_reason": "Relevant to the question",
            "card": card, "card_en": card,
            "verification": {"numbers_verified": 0, "numbers_total": 0, "agreement": None, "escalated": False,
                             "repaired": False, "uncertain": False, "unverified": []},
            "error": None,
        })

    def cells(outcome: str, refs: tuple[int, ...]) -> dict[str, Any]:
        out = []
        for i in refs:
            _d, _s, _y, direction, _r, _n, effect, ci = _PAPERS[i]
            out.append({"ref": f"P{i + 1}", "finding": f"{outcome}: {direction} in simulated study {i + 1}.",
                        "direction": direction, "effect_measure": "HR" if effect is not None else None,
                        "effect_value": effect, "ci_lower": ci[0] if ci else None,
                        "ci_upper": ci[1] if ci else None})
        return {"outcome": outcome, "cells": out}

    comparison = [cells("Primary outcome", (0, 1, 2, 3)), cells("Safety outcome", (0, 2, 4))]
    summary = f"Stub review for: {topic}"
    synthesis = {
        "executive_summary": summary, "comparison": comparison,
        "consensus": [{"statement": "Most simulated studies point the same way.", "refs": ["P1", "P3"],
                       "explanation": "Illustrative."}],
        "conflicts": [{"statement": "One simulated study disagrees.", "refs": ["P4"],
                       "explanation": "Illustrative.", "likely_reasons": ["Different population"]}],
        "evidence_strength": None if review_type != "slr" else "low",
        "evidence_rationale": "Simulated data.", "research_gaps": ["No long-term follow-up in the stub data."],
        "grade_baseline": None,
    }
    return {
        "topic": topic, "english_topic": topic, "language": language, "review_type": review_type,
        "question": {
            "original_topic": topic, "english_topic": topic, "refined": True,
            "interpretation": f"Evidence on {topic}",
            "refined_question": f"What does the published evidence say about {topic}?",
            "sub_questions": [], "assumptions": [],
            "pico": {"population": "Adults", "intervention_or_exposure": "Index intervention",
                     "comparator": "Placebo or usual care", "outcomes": ["Primary outcome", "Safety outcome"],
                     "study_designs": [], "timeframe": None},
            "question_type": "therapy", "ambiguities": [],
            "key_terms": ["simulated term", topic],
        },
        "summary": summary, "synthesis": synthesis, "synthesis_en": synthesis,
        "papers": papers, "queries": [f"{topic} randomized controlled trial", f"{topic} cohort study"],
        "stats": {"found": 87, "unique": 70, "with_abstract": 64, "candidates": 60, "screened": 60,
                  "selected": len(papers) + 2, "extracted": len(papers), "excluded_screening": 28},
        "quality": {}, "errors": [], "prompt_version": "stub", "llm_preset": "stub", "models": {},
        "external_context": [],
    }
