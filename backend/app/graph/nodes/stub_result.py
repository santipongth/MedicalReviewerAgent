"""Deterministic, representative result for the timed stub (STUB_DELAY_SECONDS > 0), so manual QA shows the
report views (literature matrix, concept map, evidence map, PRISMA) without calling a model. Illustrative only."""
from __future__ import annotations

from typing import Any

from app.harness.design import POOLED_CATEGORIES
from app.harness.grade import analyse_meta
from app.harness.meta import with_display
from app.harness.support import build_pairs, citation, claim_record, finding_claims
from app.schemas.review import SLR_LIKE, ReviewOptions

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
# Plan 20 Task 11: a further report of P1's trial (not scoping, which links no reports). Like the engine, it stays in
# `papers` with `related_to`, but never reaches the comparison, consensus, conflicts, pools or key findings.
_RELATED = ("rct", "Prespecified secondary analysis of a randomized controlled trial", 2022, "positive", "low", 198,
            None, None)
_RELATED_REASON = "same trial (STUB-1)"
# The engine's fixed lead clause for a strong causal key finding at low / very low certainty (synthesis._certainty_lead)
_LEAD = {"low": "Low-certainty evidence suggests: ", "very_low": "Very low-certainty evidence: "}


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


def stub_found(candidates: int) -> int:
    """Records identified by the simulated search: always at least the candidates that reach screening."""
    return -(-candidates * 145 // 100)


def stub_result(topic: str, language: str, review_type: str = "slr",
                options: ReviewOptions | None = None) -> dict[str, Any]:
    opts = options or ReviewOptions()
    found = stub_found(opts.candidate_limit)
    sources = {"europe pmc": round(found * 0.31), "semantic scholar": round(found * 0.23), "arxiv": round(found * 0.03)}
    sources = {"pubmed": found - sum(sources.values()), **sources}
    meta = review_type == "meta_analysis"
    scoping = review_type == "scoping"  # a scoping review makes no claims (no consensus or conflicts), links no reports
    specs = (*_PAPERS, _META_EXTRA) if meta else _PAPERS
    evidence = len(specs)
    if not scoping:
        specs = (*specs, _RELATED)
    # The illustrative paper list is fixed (6-8 studies), so `selected` is its length whatever max_papers asks for;
    # the rest of the pool is split so the PRISMA flow balances exactly: screened - excluded = selected.
    # Plan 21: when the fixed list is shorter than the requested count it is a shortfall, so nothing is over the limit.
    gap = max(0, opts.candidate_limit - len(specs))
    over_limit = min(2, gap) if len(specs) >= opts.max_papers else 0
    excluded = gap - over_limit
    off_topic, population = excluded * 7 // 10, excluded * 2 // 10
    excluded_screening = {"off_topic": off_topic, "population": population,
                          "publication_type": excluded - off_topic - population}
    papers = []
    for i, (_d, _s, year, *_rest) in enumerate(specs):
        card = _card(i, topic, specs)
        related = i == evidence  # the further report of P1's trial
        papers.append({
            "ref": f"P{i + 1}",
            "title": (f"Simulated study 1, prespecified secondary analysis: {topic}" if related
                      else f"Simulated study {i + 1}: {topic}"),
            "authors": ["Stub A", "Stub B"],
            "year": year, "journal": "Journal of Simulated Evidence", "doi": None, "pmid": None, "pmcid": None,
            "thaijo_url": None, "bib": None,  # Plan 24 (parity with finalize)
            "url": None, "relevance": round(0.95 - 0.05 * i, 2), "screen_reason": "Relevant to the question",
            "card": card, "card_en": card,
            "verification": _verification(card),
            "error": None,
            "design_excluded": False,  # Plan 20 Task 6 (parity with finalize; the stub ticks no study type)
            "related_to": "P1" if related else None, "related_reason": _RELATED_REASON if related else None,
            "related_reports": [],
        })
    if not scoping:
        papers[0]["related_reports"] = [f"P{evidence + 1}"]

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
    meta_analysis, grade = _stub_meta(comparison, papers) if meta else (None, STUB_BASELINE)
    certainty = grade["level"] if graded else None  # key findings: set in code, the review's final grade
    synthesis = {
        "executive_summary": summary, "comparison": comparison,
        "consensus": [] if scoping else [{"statement": "Most simulated studies point the same way.",
                                          "refs": ["P1", "P3"], "explanation": "Illustrative.",
                                          "likely_reasons": [], "review_discordant": False}],
        "conflicts": [] if scoping else [
            {"statement": "One simulated study disagrees.", "refs": ["P4"], "explanation": "Illustrative.",
             "likely_reasons": ["Different population"], "review_discordant": False},
            # Plan 20 Task 11: a split between a systematic review and primary studies (engine wording)
            {"statement": "Safety outcome: systematic reviews and primary studies disagree", "refs": ["P1", "P3", "P5"],
             "explanation": "Systematic reviews [P5] report a different direction from the primary studies [P1, P3].",
             "likely_reasons": ["The review may include trials this search did not find"],
             "review_discordant": True},
        ],
        "evidence_strength": grade["level"] if graded else None,
        "evidence_rationale": ("Simulated data." + (f" GRADE-lite: {'; '.join(grade['factors'][1:])}."
                                                    if grade["factors"][1:] else ""))
        if graded else f"Certainty of evidence is not graded in a {'scoping' if scoping else 'narrative'} review.",
        "research_gaps": ["No long-term follow-up in the stub data."],
        "grade_baseline": grade["level"] if graded else None,
        # Plan 20: numberless; the report renders the numbers from the cited cards and the matching pool
        "answer": (f"Simulated studies map the evidence on {topic}." if scoping else
                   f"The simulated evidence suggests {topic} may improve the primary outcome."
                   + (f" The certainty of the evidence is {grade['level'].replace('_', ' ')}." if graded else "")),
        "key_findings": [
            {"outcome": row["outcome"], "statement": statement, "refs": refs, "k": len(refs), "certainty": certainty}
            for row, statement in zip(comparison, (
                "Simulated studies of several designs cover the primary outcome." if scoping else
                f"{_LEAD.get(certainty or '', '')}The index intervention reduces the primary outcome in most simulated "
                "studies; one cohort reports harm." if graded else
                "Most simulated studies report a benefit on the primary outcome; one cohort reports harm.",
                "Fewer simulated studies cover safety." if scoping else
                # consistent with the review-discordant Safety conflict above (Task 11 fix round 1)
                "Simulated primary studies report no safety concern; a systematic review points elsewhere."),
                strict=True)
            for refs in [[c["ref"] for c in row["cells"]]]],
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
        "stats": {"found": found, "unique": found * 3 // 4 + 6, "with_abstract": found * 3 // 4,
                  "candidates": opts.candidate_limit, "screened": opts.candidate_limit,
                  "selected": len(papers), "extracted": len(papers), "excluded_screening": excluded_screening,
                  "non_research": 4, "year_excluded": 0, "no_abstract": 2,
                  "excluded_selection": {"narrative_excluded": 0, "over_limit": over_limit,
                                         "requested": opts.max_papers, "eligible": len(specs) + over_limit,
                                         "study_design_relaxed": 0,
                                         "study_design_corrected": 0, "low_relevance": 0, "off_focus": 0},
                  "related_reports": sum(p["related_to"] is not None for p in papers)},
        # the lead clause the first graded finding shows is counted like the real check counts it
        "quality": ({"prose_check": {"key_findings_certainty_lead": 1}} if graded and _LEAD.get(certainty or "")
                    else {}),
        "errors": [], "prompt_version": "stub", "llm_preset": "stub", "models": {},
        "external_context": [],
        "citations": _citations(len(papers)),
        "meta_analysis": meta_analysis,
        "methods": {
            "searched_at": "2026-10-10T00:00:00+00:00",
            "sources": sources,
            "eligibility": {"year_from": None, "study_types": [],
                            "inclusion_criteria": ["Studies reporting the primary outcome"],
                            "exclusion_criteria": ["Editorials and protocols without results"]},
            "limits": {"candidate_limit": opts.candidate_limit, "max_papers": opts.max_papers,
                       "min_abstract_chars": 150},
            "screening": {"model": "stub", "second_model": None, "second_vote": "off", "borderline": [35, 70],
                          "relevance_floor": 35},
            "extraction": {"model": "stub", "second_model": None, "verify_quotes": True, "quote_match_threshold": 90,
                           "text": "abstract"},
            "synthesis": {"model": "stub", "pooling": "DerSimonian-Laird random effects" if meta else None,
                          "grading": "GRADE-lite" if graded else None},
        },
        "support": _stub_support(synthesis, papers),
    }


# Fixed verdict by (claim, ref); a ref not listed is "supported". Together they show every state: supported with the
# badge (k0), partial, unsupported, unjudged (None), and supported without the badge (k1: its numbers are not checked).
_STUB_VERDICT: dict[tuple[str, str], str | None] = {
    ("k0", "P2"): "partial", ("k0", "P4"): "unsupported", ("k1", "P5"): None}
_STUB_UNCHECKED = {"k1"}  # claims whose numbers are not checked, so a supported citation gets no badge


def _stub_abstract(paper: dict[str, Any]) -> str:
    """A fixed 3-sentence abstract of the simulated paper. Used only to pick the evidence; never stored."""
    return (f"This simulated study {paper['ref'][1:]} examined {paper['title'].split(': ', 1)[-1]} in an illustrative "
            f"sample. {paper['card']['key_findings'][0]} The authors note that these data are illustrative only.")


def _stub_support(synthesis: dict[str, Any], papers: list[dict[str, Any]]) -> dict[str, Any]:
    """result.support (Plan 25) for the key findings (the stub summary cites nothing), built with the engine's own
    `build_pairs` / `citation` / `claim_record` so the shape and the badge rule cannot drift. Verdicts are fixed (no
    judge runs); the evidence is a sentence of each paper's fixed stub abstract."""
    abstracts = {p["ref"]: _stub_abstract(p) for p in papers}
    claims = []
    for c in finding_claims(synthesis["key_findings"]):
        checked = c.id not in _STUB_UNCHECKED
        pairs = {p.ref: p for p in build_pairs([c], abstracts, set())}
        cites = []
        for r in c.refs:
            label = _STUB_VERDICT.get((c.id, r), "supported")
            verdict = None if label is None else (label, None if label == "unsupported" else 0)
            cites.append(citation(pairs.get(r), r, verdict, numbers_checked=checked, computed=False,
                                  not_evidence=False))
        claims.append(claim_record(c, cites, numbers_checked=checked, computed=False))
    return {"judge": "ok", "markers": [], "claims": claims, "display_aligned": True}


def _stub_meta(comparison: list[dict[str, Any]],
               papers: list[dict[str, Any]]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Pooled by meta.py from the stub matrix (never hand-written numbers), in the same shape as the real result,
    with the stub baseline adjusted by the real apply_meta_grade. Returns (meta_analysis, adjusted grade)."""
    out, grade = analyse_meta({"rows": comparison}, papers, ["Primary outcome"], STUB_BASELINE)
    return with_display(out), grade
