"""Deterministic, representative result for the timed stub (STUB_DELAY_SECONDS > 0), so manual QA shows the
report views (literature matrix, concept map, evidence map, PRISMA) without calling a model. Illustrative only."""
from __future__ import annotations

from typing import Any

from app.harness.design import POOLED_CATEGORIES
from app.harness.grade import analyse_meta
from app.harness.meta import with_display
from app.schemas.review import SLR_LIKE

# (design_category, study_design, year, direction, risk_of_bias, sample_size, effect_value, ci)
_PAPERS = (
    ("rct", "Randomized controlled trial", 2021, "positive", "low", 412, 0.78, (0.63, 0.96)),
    ("rct", "Randomized controlled trial", 2019, "null", "moderate", 230, 0.97, (0.74, 1.27)),
    ("cohort", "Prospective cohort study", 2020, "positive", "moderate", 5120, 0.84, (0.72, 0.98)),
    ("cohort", "Retrospective cohort study", 2018, "negative", "high", 1893, 1.22, (1.01, 1.47)),
    ("sr_ma_rct", "Systematic review and meta-analysis of RCTs", 2022, "mixed", "low", None, None, None),
    ("narrative_review", "Narrative review", 2017, "unclear", "unclear", None, None, None),
)
# meta_analysis only: a third cohort with a verified HR, so the observational pool reaches k = 3 (P3, P4, P7).
STUB_BASELINE = {"level": "low", "factors": ["start low: illustrative stub evidence"]}  # the stub's "low" grade
_META_EXTRA = ("cohort", "Population-based cohort study", 2016, "positive", "moderate", 3410, 0.88, (0.79, 0.99))


def _card(i: int, topic: str, specs: tuple = _PAPERS) -> dict[str, Any]:
    design, study_design, _year, direction, rob, n, effect, ci = specs[i]
    has_effect = effect is not None
    quote = f"HR {effect} (95% CI {ci[0]}-{ci[1]})" if has_effect and ci else None
    outcomes = [{
        "outcome": "Primary outcome", "result": f"Reported {direction} association for {topic}.",
        "evidence_quote": quote, "effect_size": None,
        "effect_measure": "HR" if has_effect else None, "effect_value": effect,
        "ci_lower": ci[0] if ci else None, "ci_upper": ci[1] if ci else None, "p_value": None,
        "direction": direction,
    }]
    return {
        "study_design": study_design, "design_category": design,
        "population": f"Adults studied in the context of {topic}",
        "sample_size": n, "sample_size_quote": f"A total of {n} participants were enrolled." if n else None,
        "intervention_or_exposure": "Index intervention",
        "comparator": "Placebo or usual care" if design == "rct" else None,
        "outcomes": outcomes,
        "key_findings": [f"Simulated finding {i + 1} for {topic}."],
        "limitations": ["Illustrative stub data; abstract-only reading."],
        "funding_or_conflicts": None, "risk_of_bias": rob, "overall_direction": direction,
    }


def _verification(card: dict[str, Any]) -> dict[str, Any]:
    """Every number the card shows has a quote containing it, so all of them count as verified."""
    o = card["outcomes"][0]
    total = sum(v is not None for v in (card["sample_size"], o["effect_value"], o["ci_lower"], o["ci_upper"]))
    return {"numbers_verified": total, "numbers_total": total, "agreement": None, "escalated": False,
            "repaired": False, "uncertain": False, "unverified": []}


_STUB_EDGES = (("P3", "P1"), ("P3", "P2"), ("P5", "P1"), ("P5", "P2"), ("P5", "P3"), ("P6", "P4"))


def _citations(n: int) -> dict[str, Any]:
    """Small illustrative citation block (P6 has no data, to exercise the coverage-gap display)."""
    refs = [f"P{i + 1}" for i in range(n)]
    return {
        "edges": [{"from": a, "to": b} for a, b in _STUB_EDGES if a in refs and b in refs],
        "cited_by": {r: (None if r == "P6" else 40 - 5 * i) for i, r in enumerate(refs)},
        "cited_by_source": {r: (None if r == "P6" else "openalex" if i % 2 == 0 else "europepmc")
                            for i, r in enumerate(refs)},
        "coverage": {r: (None if r == "P6" else "openalex" if i % 2 == 0 else "europepmc")
                     for i, r in enumerate(refs)},
        "source_note": "Illustrative stub data",
        "partial": False,
    }


def stub_result(topic: str, language: str, review_type: str = "slr") -> dict[str, Any]:
    meta = review_type == "meta_analysis"
    specs = (*_PAPERS, _META_EXTRA) if meta else _PAPERS
    papers = []
    for i, (_d, _s, year, *_rest) in enumerate(specs):
        card = _card(i, topic, specs)
        papers.append({
            "ref": f"P{i + 1}", "title": f"Simulated study {i + 1}: {topic}", "authors": ["Stub A", "Stub B"],
            "year": year, "journal": "Journal of Simulated Evidence", "doi": None, "pmid": None, "pmcid": None,
            "url": None, "relevance": round(0.95 - 0.05 * i, 2), "screen_reason": "Relevant to the question",
            "card": card, "card_en": card,
            "verification": _verification(card),
            "error": None,
        })

    def cells(outcome: str, refs: tuple[int, ...]) -> dict[str, Any]:
        out = []
        for i in refs:
            design, _s, _y, direction, _r, _n, effect, ci = specs[i]
            cell = {"ref": f"P{i + 1}", "finding": f"{outcome}: {direction} in simulated study {i + 1}.",
                    "direction": direction, "effect_measure": "HR" if effect is not None else None,
                    "effect_value": effect, "ci_lower": ci[0] if ci else None,
                    "ci_upper": ci[1] if ci else None}
            if meta:  # the real matrix carries these; other types keep their pre-14b stub shape
                cell |= {"design_category": design, "pooled": design in POOLED_CATEGORIES}
            out.append(cell)
        return {"outcome": outcome, "cells": out}

    comparison = [cells("Primary outcome", (0, 1, 2, 3, 6) if meta else (0, 1, 2, 3)),
                  cells("Safety outcome", (0, 2, 4))]
    summary = f"Stub review for: {topic}"
    graded = review_type in SLR_LIKE  # narrative and scoping reviews are not graded (same rule as write_synthesis)
    scoping = review_type == "scoping"  # a scoping review makes no claims: no consensus, no conflicts
    meta_analysis, grade = _stub_meta(comparison, papers) if meta else (None, STUB_BASELINE)
    synthesis = {
        "executive_summary": summary, "comparison": comparison,
        "consensus": [] if scoping else [{"statement": "Most simulated studies point the same way.",
                                          "refs": ["P1", "P3"], "explanation": "Illustrative."}],
        "conflicts": [] if scoping else [{"statement": "One simulated study disagrees.", "refs": ["P4"],
                                          "explanation": "Illustrative.", "likely_reasons": ["Different population"]}],
        "evidence_strength": grade["level"] if graded else None,
        "evidence_rationale": ("Simulated data." + (f" GRADE-lite: {'; '.join(grade['factors'][1:])}."
                                                    if grade["factors"][1:] else ""))
        if graded else f"Certainty of evidence is not graded in a {'scoping' if scoping else 'narrative'} review.",
        "research_gaps": ["No long-term follow-up in the stub data."],
        "grade_baseline": grade["level"] if graded else None,
    }
    return {
        "topic": topic, "english_topic": topic, "language": language, "review_type": review_type,
        "question": {
            "original_topic": topic, "english_topic": topic, "refined": True,
            "interpretation": f"Evidence on {topic}",
            "refined_question": f"What does the published evidence say about {topic}?",
            "sub_questions": [], "assumptions": [],
            "framework": "PCC" if scoping else "PICO",
            "concept": f"Evidence on {topic}" if scoping else None,
            "context": "Any setting" if scoping else None,
            "pico": {"population": "Adults", "intervention_or_exposure": "Index intervention",
                     "comparator": "Placebo or usual care", "outcomes": ["Primary outcome", "Safety outcome"],
                     "study_designs": [], "timeframe": None},
            "question_type": "therapy", "ambiguities": [],
            "key_terms": [{"term": "simulated term", "synonyms": [topic], "mesh": None}],
        },
        "summary": summary, "synthesis": synthesis, "synthesis_en": synthesis,
        "papers": papers, "queries": [f"{topic} randomized controlled trial", f"{topic} cohort study"],
        "stats": {"found": 87, "unique": 70, "with_abstract": 64, "candidates": 60, "screened": 60,
                  "selected": len(papers), "extracted": len(papers), "excluded_screening": {"off_topic": 20, "population": 5, "publication_type": 3},
                  "non_research": 4, "year_excluded": 0, "no_abstract": 2,
                  "excluded_selection": {"narrative_excluded": 0, "over_limit": 2, "study_design_relaxed": 0,
                                         "study_design_corrected": 0, "low_relevance": 0}},
        "quality": {}, "errors": [], "prompt_version": "stub", "llm_preset": "stub", "models": {},
        "external_context": [],
        "citations": _citations(len(papers)),
        "meta_analysis": meta_analysis,
    }


def _stub_meta(comparison: list[dict[str, Any]],
               papers: list[dict[str, Any]]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Pooled by meta.py from the stub matrix (never hand-written numbers), in the same shape as the real result,
    with the stub baseline adjusted by the real apply_meta_grade. Returns (meta_analysis, adjusted grade)."""
    out, grade = analyse_meta({"rows": comparison}, papers, ["Primary outcome"], STUB_BASELINE)
    return with_display(out), grade
