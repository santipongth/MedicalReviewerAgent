"""Synthesis as a checked pipeline instead of one big LLM call:
normalize outcome names (LLM, validated) → matrix, consensus, conflicts and GRADE-lite (code)
→ explain each conflict (LLM, fan-out) → narrative with citation check (LLM) ∥ card localization
→ localize the synthesis → finalize."""
from __future__ import annotations

import asyncio
import copy
import re
import time
from collections import Counter
from typing import Any

from langgraph.types import Send

from app.graph import prompts
from app.graph.nodes.intake import harness_runner, harness_spec, review_question
from app.graph.progress import progress_writer
from app.graph.schemas import (
    ConflictNote,
    EvidenceCluster,
    NarrativeNoGrade,
    OutcomeClusters,
    Synthesis,
    SynthesisNarrative,
)
from app.graph.state import ReviewState
from app.harness.comparison import question_card
from app.harness.design import NO_DIRECTION_CATEGORIES, NON_QUANTITATIVE_CATEGORIES
from app.harness.grade import (
    LEVELS,
    analyse_meta,
    clamp_to_baseline,
    grade_baseline,
)
from app.harness.localize import localize_strings
from app.harness.matrix import (
    build_matrix,
    fallback_clusters,
    outcome_pairs,
    repair_clusters,
    validate_clusters,
)
from app.harness.meta import (
    pooled_extra_patterns,
    pooled_number_strings,
    pools_for_prompt,
    strip_pooled_numbers,
    with_display,
)
from app.harness.prose import ProseContext, context_numbers, fix_prose, paper_facts, prose_problems
from app.harness.quality import summarize_quality
from app.harness.verify import check_citations, strip_unknown_citations
from app.schemas.review import SLR_LIKE, ReviewOptions
from app.services.llm import LLMError

NO_PAPERS = {
    "th": "ไม่พบงานวิจัยที่ตรงกับหัวข้อนี้เพียงพอสำหรับการสรุปเปรียบเทียบ ลองใช้คำค้นที่กว้างขึ้นหรือระบุชื่อสาร/โรคเป็นภาษาอังกฤษ",
    "en": "No sufficiently relevant studies were found for this topic. Try a broader topic or English drug/disease names.",
}
EXTRACTION_FAILED = {
    "th": "พบงานวิจัยที่เกี่ยวข้อง แต่ระบบไม่สามารถสกัดข้อมูลจากงานวิจัยเหล่านั้นได้ (ปัญหาชั่วคราวของโมเดลหรือบริการ) "
          "กรุณาลองใหม่อีกครั้ง",
    "en": "Relevant papers were found, but the agent could not extract data from any of them (a temporary model or "
          "service problem). Please try again later.",
}
SCREENING_FAILED = {
    "th": "พบงานวิจัยที่อาจเกี่ยวข้อง แต่ระบบไม่สามารถคัดกรองได้ (ปัญหาชั่วคราวของโมเดลหรือบริการ) กรุณาลองใหม่อีกครั้ง",
    "en": "Candidate papers were found but could not be screened (a temporary model or service problem). "
          "Please try again later.",
}
SYNTH_FAILED = ("The narrative synthesis step failed; the comparison table, consensus and conflicts below were "
                "computed from the per-paper extractions.")
DIRECTION_TEXT = {"positive": "findings support the hypothesised effect",
                  "negative": "findings show the opposite effect or harm",
                  "null": "findings show no significant association"}
_CITED = re.compile(r"\[P\d+")
NO_QUANTITATIVE_RATIONALE = ("Certainty of evidence is not graded: no quantitative studies (qualitative themes are "
                             "summarised only).")
QUALITATIVE_ONLY_FACTOR = ("no quantitative studies: the included qualitative/mixed-methods studies are summarised "
                           "as themes, which are not graded")
OTHER_COMPARISONS_ONLY_FACTOR = ("no extracted estimate compares the review's intervention with its comparator; the "
                                 "papers' other comparisons are listed on their cards and are not graded")
# GRADE certainty wording the summary must carry (audit I-14); appended in code when the narrative lacks it.
CERTAINTY_WORDING = {"moderate": re.compile(r"\bprobabl[ey]\b|\blikely\b", re.IGNORECASE),
                     "low": re.compile(r"\bmay\b|\bmight\b", re.IGNORECASE),
                     "very_low": re.compile(r"\bvery uncertain\b", re.IGNORECASE)}
CERTAINTY_SENTENCE = {
    "moderate": "The certainty of the evidence is moderate: the effects described here are probably close to the "
                "true effects.",
    "low": "The certainty of the evidence is low: the true effects may differ substantially from those described here.",
    "very_low": "The certainty of the evidence is very low: the evidence is very uncertain about the effects described "
                "here.",
}


def _ref_num(ref: str) -> int:
    return int(ref[1:]) if ref[1:].isdigit() else 10**6


def unique_papers(state: ReviewState) -> list[dict[str, Any]]:
    """One entry per ref (a resumed fan-out may append twice); prefer the one with a card."""
    by_ref: dict[str, dict[str, Any]] = {}
    for p in state.get("papers") or []:
        if p["ref"] not in by_ref or (by_ref[p["ref"]].get("card") is None and p.get("card") is not None):
            by_ref[p["ref"]] = p
    return sorted(by_ref.values(), key=lambda p: _ref_num(p["ref"]))


def _with_cards(state: ReviewState) -> list[dict[str, Any]]:
    return [p for p in unique_papers(state) if p.get("card")]


def _direction_papers(state: ReviewState) -> list[dict[str, Any]]:
    """Papers of a design that can be direction evidence: narrative reviews (they restate other studies) and
    qualitative or mixed-methods studies (themes, no effect numbers) stay in the paper list but add no matrix cells,
    conflicts, pools or grade. A scoping review maps everything, so it counts them."""
    if _review_type(state) == "scoping":
        return _with_cards(state)
    return [p for p in _with_cards(state) if p["card"].get("design_category") not in NO_DIRECTION_CATEGORIES]


def _evidence(state: ReviewState) -> list[dict[str, Any]]:
    """The direction papers with their cards restricted to the outcomes that answer the question (Plan 19): an
    estimate of another comparison (`matches_question` false) never reaches the matrix, consensus, conflicts, pools
    or grade, and a paper that reports only other comparisons is no evidence at all. The stored cards keep every
    outcome; this is a view."""
    papers = _direction_papers(state)
    if _review_type(state) == "scoping":
        return papers
    out = []
    for p in papers:
        card = question_card(p["card"])
        if card is not None:
            out.append(p if card is p["card"] else {**p, "card": card})
    return out


def _narrative_papers(state: ReviewState) -> list[dict[str, Any]]:
    """Papers the narrative reads and may cite. Narrative and scoping reviews: every card. Graded reviews: the
    direction evidence plus the qualitative/mixed-methods papers, whose themes are summarised (they stay out of the
    matrix, conflicts, pools and grade, which are built from _evidence)."""
    if _review_type(state) not in SLR_LIKE:
        return _with_cards(state)
    return [p for p in _with_cards(state)
            if p["card"].get("design_category") not in NO_DIRECTION_CATEGORIES
            or p["card"].get("design_category") in NON_QUANTITATIVE_CATEGORIES]


def _themes_only(papers: list[dict[str, Any]]) -> bool:
    return any(p["card"].get("design_category") in NON_QUANTITATIVE_CATEGORIES for p in papers)


def _review_type(state: ReviewState) -> str:
    return ReviewOptions.clamped(state.get("options")).review_type


def _brief(p: dict[str, Any]) -> dict[str, Any]:
    """Compact paper card for multi-paper prompts (quotes dropped: they were verified already)."""
    card = copy.deepcopy(p["card"])
    card.pop("sample_size_quote", None)
    for o in card.get("outcomes", []):
        o.pop("evidence_quote", None)
    c = p.get("candidate") or {}
    return {"ref": p["ref"], "title": c.get("title"), "year": c.get("year"),
            "text_source": "abstract", "card": card}


def _empty_synthesis(summary: str, review_type: str = "slr") -> dict[str, Any]:
    graded = review_type in SLR_LIKE
    return Synthesis(executive_summary=summary, comparison=[], consensus=[], conflicts=[],
                     evidence_strength="very_low" if graded else None, evidence_rationale=summary, research_gaps=[],
                     grade_baseline="very_low" if graded else None).model_dump()


def _not_graded_rationale(review_type: str) -> str:
    return f"Certainty of evidence is not graded in a {'scoping' if review_type == 'scoping' else 'narrative'} review."


# ---- S1 + S2: normalize outcome names, then build the matrix in code ----------------------------
def make_normalize_outcomes(deps):
    async def normalize_outcomes(state: ReviewState) -> dict:
        started = time.perf_counter()
        papers = _evidence(state)
        entry: dict[str, Any] = {"stage": "normalize", "fallback": False, "repaired": False}
        cost, errors = 0.0, []
        clusters: OutcomeClusters | None = None
        pairs = outcome_pairs(papers)
        if papers:
            progress_writer()({"type": "synthesizing", "papers": len(papers)})
        normalizer = getattr(deps.llms, "normalizer", None)
        if normalizer is not None and len(pairs) > 1:
            try:
                res = await harness_runner(deps).call(
                    normalizer, prompts.NORMALIZE_SYSTEM,
                    prompts.normalize_user(question=review_question(state), pairs=pairs),
                    schema=OutcomeClusters, validate=lambda c: validate_clusters(c, papers), trigger="normalize")
                cost += res.cost
                entry["repaired"] = res.repaired
                if res.value is not None:  # a near miss is corrected in code, not thrown away
                    fixed, corrections, kept = repair_clusters(res.value, papers)
                    entry["corrections"] = corrections
                    clusters = fixed if kept else None
            except LLMError as exc:
                errors.append(f"outcome normalization failed: {type(exc).__name__}")
            entry["fallback"] = clusters is None
        matrix = build_matrix(papers, clusters or fallback_clusters(papers))
        matrix["grade"] = grade_baseline(papers, matrix)
        if not papers and _direction_papers(state):  # every quantitative paper reports only other comparisons
            matrix["grade"]["factors"] = [OTHER_COMPARISONS_ONLY_FACTOR]
        elif not papers and _themes_only(_narrative_papers(state)):  # the level stays as the baseline gives it
            matrix["grade"]["factors"] = [QUALITATIVE_ONLY_FACTOR]
        entry |= {"outcomes": len(matrix["rows"]), "conflicts": len(matrix["conflicts"]),
                  "seconds": round(time.perf_counter() - started, 3)}
        return {"matrix": matrix, "cost_usd": cost, "errors": errors, "quality": [entry]}

    return normalize_outcomes


# ---- S2b: pooled effects (meta-analysis only) ----------------------------------------------------
def route_after_normalize(state: ReviewState) -> list[Send] | str:
    """Meta-analysis goes through pool_effects; every other type keeps its path unchanged."""
    if _review_type(state) == "meta_analysis":
        return "pool_effects"
    return route_conflicts(state)


def make_pool_effects(deps):
    async def pool_effects(state: ReviewState) -> dict:
        """DerSimonian-Laird pools over the matrix (code, no LLM), then the meta GRADE-lite adjustments.
        A failure here never fails the review: meta_analysis stays null and the error is recorded."""
        if _review_type(state) != "meta_analysis":
            return {}
        started = time.perf_counter()
        papers = _evidence(state)
        matrix = state.get("matrix") or {}
        if papers and not (harness_spec(deps).verify_quotes and any(p.get("verification") for p in papers)):
            # the pooled section promises numbers checked against the abstracts; without that check, pool nothing
            return {"meta_analysis": None, "errors": ["pooling skipped: study numbers were not verified"],
                    "quality": [{"stage": "pool", "skipped": "numbers not verified",
                                 "seconds": round(time.perf_counter() - started, 3)}]}
        try:  # the whole computation: an unexpected shape anywhere must not fail the review
            meta, grade = analyse_meta(matrix, papers, (state.get("question") or {}).get("outcomes"),
                                       matrix.get("grade") or {"level": "very_low", "factors": []})
            downgrades = meta["grade"]["reasons"]
            k_total = sum(p["k"] for p in meta["pools"])
        except Exception as exc:  # noqa: BLE001 - pooling is an extra; the review goes on without it
            return {"meta_analysis": None, "errors": [f"pooling failed: {type(exc).__name__}"],
                    "quality": [{"stage": "pool", "failed": True,
                                 "seconds": round(time.perf_counter() - started, 3)}]}
        if papers:
            progress_writer()({"type": "pooled", "pools": len(meta["pools"]), "k_total": k_total})
        entry = {"stage": "pool", "pools": len(meta["pools"]), "k_total": k_total,
                 "excluded": len(meta["excluded"]), "downgrades": len(downgrades),
                 "seconds": round(time.perf_counter() - started, 3)}
        update: dict[str, Any] = {"meta_analysis": meta, "quality": [entry]}
        if matrix:
            update["matrix"] = {**matrix, "grade": grade}
        return update

    return pool_effects


# ---- S3: explain each conflict ----------------------------------------------------------------
def route_conflicts(state: ReviewState) -> list[Send] | str:
    conflicts = (state.get("matrix") or {}).get("conflicts") or []
    if not conflicts or _review_type(state) == "scoping":  # a scoping review does not explain disagreements
        return "write_synthesis"
    by_ref = {p["ref"]: p for p in _evidence(state)}
    question = review_question(state)
    return [Send("explain_conflict", {"conflict": c, "question": question,
                                      "papers": [_brief(by_ref[r]) for r in c["refs"] if r in by_ref]})
            for c in conflicts]


def _deterministic_note(conflict: dict[str, Any]) -> dict[str, Any]:
    parts = [f"{d}: {', '.join(f'[{r}]' for r in refs)}" for d, refs in conflict.get("directions", {}).items()]
    return {"outcome": conflict["outcome"], "refs": conflict["refs"], "likely_reasons": [],
            "explanation": f"Studies report different directions for {conflict['outcome']} ({'; '.join(parts)})."}


def make_explain_conflict(deps):
    async def explain_conflict(payload: dict[str, Any]) -> dict:
        started = time.perf_counter()
        conflict = payload["conflict"]
        allowed = set(conflict["refs"])
        entry: dict[str, Any] = {"stage": "conflict", "outcome": conflict["outcome"], "fallback": True,
                                 "repaired": False}
        note, cost, errors = None, 0.0, []
        prose = ProseContext(facts=paper_facts(payload["papers"]),
                             allowed=context_numbers([payload["question"]], [len(conflict["refs"])]),
                             max_count=len(conflict["refs"]))

        def validate(n: ConflictNote) -> list[str]:
            problems = check_citations(n.explanation, allowed)
            if not n.explanation.strip():
                problems.append("explanation must not be empty")
            if not 1 <= len(n.likely_reasons) <= 4:
                problems.append("likely_reasons must list 1-4 reasons")
            return problems + prose_problems(n.explanation, prose, "explanation")

        llm = getattr(deps.llms, "conflict_explainer", None)
        if llm is not None:
            try:
                res = await harness_runner(deps).call(
                    llm, prompts.CONFLICT_SYSTEM,
                    prompts.conflict_user(question=payload["question"], conflict=conflict, papers=payload["papers"]),
                    schema=ConflictNote, validate=validate, trigger="conflict")
                cost += res.cost
                entry["repaired"] = res.repaired
                explanation = ""
                if res.value is not None:
                    # unknown citations are removed if repair failed, then every sentence with an untraceable
                    # number or population is dropped and wrong measure names are corrected
                    explanation, counts = fix_prose(strip_unknown_citations(res.value.explanation, allowed), prose)
                    entry |= {f"prose_{k}": v for k, v in counts.items()}
                if explanation.strip():
                    # outcome and refs are owned by code
                    note = {"outcome": conflict["outcome"], "refs": conflict["refs"],
                            "likely_reasons": res.value.likely_reasons[:4], "explanation": explanation}
                    entry["fallback"] = False
            except LLMError as exc:
                errors.append(f"conflict explanation failed for {conflict['outcome']}: {type(exc).__name__}")
        entry["seconds"] = round(time.perf_counter() - started, 3)
        return {"conflict_notes": [note or _deterministic_note(conflict)], "cost_usd": cost, "errors": errors,
                "quality": [entry]}

    return explain_conflict


# ---- S4: narrative with citation check, cards localized in parallel ---------------------------
CARD_TEXT_FIELDS = ("study_design", "population", "intervention_or_exposure", "comparator", "funding_or_conflicts")


def _card_strings(ref: str, card: dict[str, Any]) -> dict[str, str]:
    out = {f"{ref}.{f}": card[f] for f in CARD_TEXT_FIELDS if card.get(f)}
    for i, o in enumerate(card.get("outcomes", [])):
        out[f"{ref}.outcomes.{i}.outcome"] = o["outcome"]
        out[f"{ref}.outcomes.{i}.result"] = o["result"]
        if o.get("comparison"):
            out[f"{ref}.outcomes.{i}.comparison"] = o["comparison"]
    for key in ("key_findings", "limitations"):
        out |= {f"{ref}.{key}.{i}": s for i, s in enumerate(card.get(key, [])) if s}
    return out


def _apply_card_strings(ref: str, card: dict[str, Any], strings: dict[str, str]) -> dict[str, Any]:
    out = copy.deepcopy(card)
    for f in CARD_TEXT_FIELDS:
        out[f] = strings.get(f"{ref}.{f}", out.get(f))
    for i, o in enumerate(out.get("outcomes", [])):
        o["outcome"] = strings.get(f"{ref}.outcomes.{i}.outcome", o["outcome"])
        o["result"] = strings.get(f"{ref}.outcomes.{i}.result", o["result"])
        if o.get("comparison"):
            o["comparison"] = strings.get(f"{ref}.outcomes.{i}.comparison", o["comparison"])
    for key in ("key_findings", "limitations"):
        out[key] = [strings.get(f"{ref}.{key}.{i}", s) for i, s in enumerate(out.get(key, []))]
    return out


async def _localize_cards(deps, papers: list[dict[str, Any]], language: str) -> tuple[dict | None, dict, float]:
    started = time.perf_counter()
    llm = getattr(deps.llms, "localizer", None)
    if language == "en" or not harness_spec(deps).localize or llm is None:
        return None, {}, 0.0
    strings: dict[str, str] = {}
    for p in papers:
        strings |= _card_strings(p["ref"], p["card"])
    translated, kept, cost = await localize_strings(llm, harness_runner(deps), strings, language)
    cards = {p["ref"]: _apply_card_strings(p["ref"], p["card"], translated) for p in papers}
    entry = {"stage": "localize_cards", "items": len(strings), "kept_english": kept,
             "seconds": round(time.perf_counter() - started, 3)}
    return cards, entry, cost


def _consensus_explanation(c: dict[str, Any]) -> str:
    dissent = c.get("dissent") or {}
    if not dissent:
        return f"{len(c['refs'])} studies report the same direction for {c['outcome']}."
    total = len(c["refs"]) + sum(len(refs) for refs in dissent.values())
    def finding(d: str, n: int) -> str:
        text = DIRECTION_TEXT.get(d, d).replace("findings ", "")
        return text.replace("show ", "shows ", 1) if n == 1 else text

    others = "; ".join(f"{', '.join(f'[{r}]' for r in refs)} {finding(d, len(refs))}" for d, refs in dissent.items())
    return f"{len(c['refs'])} of {total} studies report the same direction for {c['outcome']}; {others}."


def _clusters(matrix: dict[str, Any], notes: list[dict[str, Any]]) -> tuple[list, list]:
    consensus = [EvidenceCluster(
        statement=f"{c['outcome']}: {DIRECTION_TEXT.get(c['direction'], c['direction'])}",
        refs=c["refs"], explanation=_consensus_explanation(c))
        for c in matrix.get("consensus", [])]
    by_outcome = {n["outcome"]: n for n in notes}
    conflicts = []
    for c in matrix.get("conflicts", []):
        note = by_outcome.get(c["outcome"]) or _deterministic_note(c)
        conflicts.append(EvidenceCluster(statement=f"{c['outcome']}: studies disagree", refs=c["refs"],
                                         explanation=note["explanation"], likely_reasons=note["likely_reasons"]))
    return consensus, conflicts


POOLED_REFERENCE = "The pooled estimates are reported in the pooled analysis section."


def _strip_pooled(narrative: SynthesisNarrative, meta: dict[str, Any]) -> tuple[SynthesisNarrative, int, int]:
    """Remove every sentence of the summary, rationale and gaps that restates a pooled estimate, CI bound, I2 or
    tau2 (see meta.strip_pooled_numbers). Returns (narrative, removed, single-study sentences kept)."""
    strings = pooled_number_strings(meta)
    always, numeric = pooled_extra_patterns(meta)
    summary, removed, single = strip_pooled_numbers(narrative.executive_summary, strings, always, numeric)
    rationale, n, s = strip_pooled_numbers(narrative.evidence_rationale, strings, always, numeric)
    removed, single = removed + n, single + s
    gaps = []
    for gap in narrative.research_gaps:
        text, n, s = strip_pooled_numbers(gap, strings, always, numeric)
        removed, single = removed + n, single + s
        if text.strip():
            gaps.append(text)
    if not removed:
        return narrative, 0, single
    return narrative.model_copy(update={"executive_summary": summary or POOLED_REFERENCE,
                                        "evidence_rationale": rationale or POOLED_REFERENCE,
                                        "research_gaps": gaps}), removed, single


PROSE_REMOVED = ("The narrative summary was withheld: its statements could not be traced to the verified paper cards. "
                 "See the comparison table and the paper cards.")
_PICO_TEXT = ("population", "intervention_or_exposure", "comparator", "timeframe", "concept", "context")


def _prose_context(state: ReviewState, papers: list[dict[str, Any]], matrix: dict[str, Any],
                   meta: dict[str, Any] | None) -> ProseContext:
    """What the summary and rationale may state (see app.harness.prose): the cards of the papers the narrative
    reads, the review's own question text, the pooled values and the pipeline counts."""
    q = state.get("question") or {}
    texts = [review_question(state), state.get("english_topic"), *(q.get("sub_questions") or []),
             *(q.get(k) for k in _PICO_TEXT), *(q.get("outcomes") or []), *(q.get("study_designs") or []),
             *((matrix.get("grade") or {}).get("factors") or [])]
    stats = state.get("search_stats") or {}
    rows = matrix.get("rows") or []
    counts: list[Any] = [v for v in stats.values() if isinstance(v, int)]
    counts += [len(state.get("candidates") or []), len(state.get("selected") or []),
               len({d.get("key") for d in state.get("screened") or []}), len(papers), len(_evidence(state)),
               len(rows), ReviewOptions.clamped(state.get("options")).year_from]
    counts += [len(r.get("cells") or []) for r in rows]
    for c in [*(matrix.get("consensus") or []), *(matrix.get("conflicts") or [])]:
        counts += [len(c.get("refs") or []), *(len(refs) for refs in (c.get("dissent") or {}).values())]
    if meta:
        counts += [*pooled_number_strings(meta), *(p.get("k") for p in meta.get("pools") or [])]
    return ProseContext(facts=paper_facts(papers), allowed=context_numbers(texts, [c for c in counts if c]),
                        max_count=len(papers))


def _check_prose(narrative: SynthesisNarrative | NarrativeNoGrade, prose: ProseContext, graded: bool,
                 factors: list[str]) -> tuple[SynthesisNarrative | NarrativeNoGrade, Counter[str]]:
    """Correct measure names and drop the sentences of the summary (and, graded, the rationale) whose numbers or
    population claims cannot be traced to the cards (app.harness.prose). Nothing is invented: an emptied summary
    becomes a fixed notice, an emptied rationale the GRADE-lite factors."""
    summary, counts = fix_prose(narrative.executive_summary, prose)
    update: dict[str, Any] = {"executive_summary": summary or PROSE_REMOVED}
    if graded:
        rationale, more = fix_prose(narrative.evidence_rationale, prose)
        counts += more
        update["evidence_rationale"] = rationale or "; ".join(factors)
    if not counts:
        return narrative, counts
    return narrative.model_copy(update=update), counts


def make_write_synthesis(deps):
    async def write_synthesis(state: ReviewState) -> dict:
        started = time.perf_counter()
        language = state.get("language", "th")
        review_type = _review_type(state)
        # a graded type with no quantitative evidence (every paper qualitative/mixed) is not graded: themes only
        no_quantitative = review_type in SLR_LIKE and not _direction_papers(state)
        graded = review_type in SLR_LIKE and not no_quantitative
        meta = state.get("meta_analysis") if review_type == "meta_analysis" else None
        # narrative reviews are cited and summarised in narrative/scoping reviews; only the matrix leaves them out.
        # Qualitative/mixed-methods themes reach every narrative, graded or not (never the matrix or the grade).
        papers = _narrative_papers(state)
        if not papers:
            if state.get("selected"):
                messages = EXTRACTION_FAILED
            elif state.get("candidates") and any(e.startswith("screening batch failed")
                                                 for e in state.get("errors") or []):
                messages = SCREENING_FAILED
            else:
                messages = NO_PAPERS
            english = _empty_synthesis(messages["en"], review_type)
            display = _empty_synthesis(messages.get(language, messages["en"]), review_type)
            return {"synthesis": english, "synthesis_display": display, "localized_cards": None,
                    "quality": [{"stage": "narrative", "skipped": True, "seconds": 0.0}]}
        matrix = state.get("matrix") or {}
        baseline = (matrix.get("grade") or {}).get("level", "very_low")
        allowed = {p["ref"] for p in papers}
        notes = sorted({n["outcome"]: n for n in state.get("conflict_notes") or []}.values(),
                       key=lambda n: n["outcome"].lower())
        question = state.get("question") or {}
        prose =_prose_context(state, papers, matrix, meta)

        def validate(n: SynthesisNarrative | NarrativeNoGrade) -> list[str]:
            rationale = getattr(n, "evidence_rationale", "")
            problems = check_citations(" ".join([n.executive_summary, rationale, *n.research_gaps]), allowed)
            if not _CITED.search(n.executive_summary):
                problems.append("executive_summary must cite the supporting papers inline, e.g. [P1]")
            if graded and abs(LEVELS.index(n.evidence_strength) - LEVELS.index(baseline)) > 1:
                problems.append(f"evidence_strength {n.evidence_strength} is more than one level away from the "
                                f"GRADE-lite baseline {baseline}")
            problems += prose_problems(n.executive_summary, prose, "executive_summary")
            if graded:
                problems += prose_problems(rationale, prose, "evidence_rationale")
            return problems

        prompt_matrix = matrix
        if review_type == "scoping":  # no direction-based consensus or per-cell directions reach a scoping summary
            prompt_matrix = {"rows": [{**r, "cells": [{k: v for k, v in c.items() if k != "direction"}
                                                      for c in r.get("cells", [])]}
                                      for r in matrix.get("rows", [])], "consensus": []}
        user = prompts.narrative_user(question=review_question(state),
                                      sub_questions=question.get("sub_questions") or [],
                                      papers=[_brief(p) for p in papers], matrix=prompt_matrix, conflict_notes=notes,
                                      baseline=matrix.get("grade") or {},
                                      external_context=state.get("external_context") or [],
                                      review_type=review_type if not no_quantitative else "narrative",
                                      pooled_analysis=pools_for_prompt(meta) if meta else None)
        narrative_call = harness_runner(deps).call(
            deps.llms.synthesizer, prompts.narrative_system(review_type if not no_quantitative else "narrative", _themes_only(papers)), user,
            schema=SynthesisNarrative if graded else NarrativeNoGrade, validate=validate, trigger="narrative")
        res, cards = await asyncio.gather(narrative_call, _localize_cards(deps, papers, language),
                                          return_exceptions=True)
        cost, errors = 0.0, []
        quality: list[dict[str, Any]] = []
        localized_cards = None
        if isinstance(cards, BaseException):
            errors.append(f"card localization failed: {type(cards).__name__}")
        else:
            localized_cards, cards_entry, cards_cost = cards
            cost += cards_cost
            if cards_entry:
                quality.append(cards_entry)

        entry: dict[str, Any] = {"stage": "narrative", "repaired": False, "escalated": False, "citation_fixes": 0,
                                 "fallback": False}
        consensus, conflicts = _clusters(matrix, notes)
        if review_type == "scoping":  # a scoping review makes no claims
            consensus, conflicts = [], []
        narrative: SynthesisNarrative | NarrativeNoGrade | None = None
        if isinstance(res, BaseException):
            if not isinstance(res, LLMError):
                raise res
            errors.append(f"synthesis failed: {type(res).__name__}: {res}")
        else:
            cost += res.cost
            entry |= {"repaired": res.repaired, "escalated": res.escalated}
            narrative = res.value
        if narrative is None:
            entry["fallback"] = True
            if graded:
                narrative = SynthesisNarrative(
                    executive_summary=SYNTH_FAILED, evidence_strength=baseline,
                    evidence_rationale="; ".join((matrix.get("grade") or {}).get("factors", [])), research_gaps=[])
            else:
                narrative = NarrativeNoGrade(executive_summary=SYNTH_FAILED, research_gaps=[])
        elif not res.ok:  # still invalid after repairs: remove what cannot be trusted, keep the rest
            update = {"executive_summary": strip_unknown_citations(narrative.executive_summary, allowed),
                      "research_gaps": [strip_unknown_citations(g, allowed) for g in narrative.research_gaps]}
            if graded:
                update["evidence_rationale"] = strip_unknown_citations(narrative.evidence_rationale, allowed)
            fixed = narrative.model_copy(update=update)
            entry["citation_fixes"] = int(fixed != narrative)
            narrative = fixed
        if meta and meta.get("pools"):  # pooled numbers render only in the pooled-analysis view, never in prose
            narrative, removed, single = _strip_pooled(narrative, meta)
            quality.append({"stage": "pooled_numbers", "removed": removed, "kept_single_study": single})
        factors = (matrix.get("grade") or {}).get("factors") or []
        narrative, prose_counts = _check_prose(narrative, prose, graded, factors)
        strength = clamp_to_baseline(narrative.evidence_strength, baseline) if graded else None
        summary = narrative.executive_summary
        certainty_added = 0
        wording = CERTAINTY_WORDING.get(strength or "")
        if wording and not entry["fallback"] and summary != PROSE_REMOVED and not wording.search(summary):
            summary, certainty_added = f"{summary} {CERTAINTY_SENTENCE[strength]}", 1
        quality.append({"stage": "prose_check", "numbers_removed": prose_counts["numbers_removed"],
                        "measures_fixed": prose_counts["measures_fixed"],
                        "population_removed": prose_counts["population_removed"],
                        "certainty_added": certainty_added})
        # not graded: no strength, no baseline, a fixed rationale that localizes like any other text
        synthesis = Synthesis(
            executive_summary=summary, comparison=matrix.get("rows", []),
            consensus=consensus, conflicts=conflicts, evidence_strength=strength,
            evidence_rationale=(narrative.evidence_rationale if graded else
                                NO_QUANTITATIVE_RATIONALE if no_quantitative else _not_graded_rationale(review_type)),
            research_gaps=narrative.research_gaps, grade_baseline=baseline if graded else None)
        entry["seconds"] = round(time.perf_counter() - started, 3)
        quality.append(entry)
        return {"synthesis": synthesis.model_dump(), "localized_cards": localized_cards, "cost_usd": cost,
                "errors": errors, "quality": quality}

    return write_synthesis


# ---- localize the synthesis -------------------------------------------------------------------
def _synthesis_strings(s: dict[str, Any]) -> dict[str, str]:
    out = {"executive_summary": s.get("executive_summary", ""), "evidence_rationale": s.get("evidence_rationale", "")}
    out |= {f"research_gaps.{i}": g for i, g in enumerate(s.get("research_gaps") or [])}
    out |= {f"comparison.{i}.outcome": r["outcome"] for i, r in enumerate(s.get("comparison") or [])}
    for kind in ("consensus", "conflicts"):
        for i, c in enumerate(s.get(kind) or []):
            out[f"{kind}.{i}.statement"] = c["statement"]
            out[f"{kind}.{i}.explanation"] = c["explanation"]
            out |= {f"{kind}.{i}.likely_reasons.{j}": r for j, r in enumerate(c.get("likely_reasons") or [])}
    return {k: v for k, v in out.items() if v}


def _apply_synthesis_strings(s: dict[str, Any], strings: dict[str, str], findings: dict[tuple[str, str], str]):
    out = copy.deepcopy(s)
    for key in ("executive_summary", "evidence_rationale"):
        out[key] = strings.get(key, out.get(key))
    out["research_gaps"] = [strings.get(f"research_gaps.{i}", g) for i, g in enumerate(out.get("research_gaps") or [])]
    for i, row in enumerate(out.get("comparison") or []):
        row["outcome"] = strings.get(f"comparison.{i}.outcome", row["outcome"])
        for cell in row["cells"]:
            cell["finding"] = findings.get((cell["ref"], cell["finding"]), cell["finding"])
    for kind in ("consensus", "conflicts"):
        for i, c in enumerate(out.get(kind) or []):
            c["statement"] = strings.get(f"{kind}.{i}.statement", c["statement"])
            c["explanation"] = strings.get(f"{kind}.{i}.explanation", c["explanation"])
            c["likely_reasons"] = [strings.get(f"{kind}.{i}.likely_reasons.{j}", r)
                                   for j, r in enumerate(c.get("likely_reasons") or [])]
    return out


def _finding_map(state: ReviewState) -> dict[tuple[str, str], str]:
    """(ref, English finding) → localized finding, from the cards localized in parallel with the narrative."""
    localized = state.get("localized_cards") or {}
    out: dict[tuple[str, str], str] = {}
    for p in _with_cards(state):
        lc = localized.get(p["ref"])
        if not lc:
            continue
        for en, loc in zip(p["card"].get("outcomes", []), lc.get("outcomes", []), strict=False):
            out[(p["ref"], en["result"])] = loc["result"]
    return out


def make_localize(deps):
    async def localize(state: ReviewState) -> dict:
        if state.get("synthesis_display") is not None:  # already in the user's language (no-papers message)
            return {}
        started = time.perf_counter()
        synthesis = state.get("synthesis") or _empty_synthesis("", _review_type(state))
        language = state.get("language", "th")
        llm = getattr(deps.llms, "localizer", None)
        if language == "en" or not harness_spec(deps).localize or llm is None:
            return {"synthesis_display": synthesis}
        progress_writer()({"type": "localizing"})
        strings = _synthesis_strings(synthesis)
        errors: list[str] = []
        try:
            translated, kept, cost = await localize_strings(llm, harness_runner(deps), strings, language)
        except LLMError as exc:
            translated, kept, cost = strings, len(strings), 0.0
            errors.append(f"localization failed: {type(exc).__name__}")
        display = _apply_synthesis_strings(synthesis, translated, _finding_map(state))
        return {"synthesis_display": display, "cost_usd": cost, "errors": errors,
                "quality": [{"stage": "localize", "items": len(strings), "kept_english": kept,
                             "seconds": round(time.perf_counter() - started, 3)}]}

    return localize


# ---- finalize -----------------------------------------------------------------------------------
QUESTION_TEXT = ("interpretation", "refined_question", "sub_questions", "assumptions")
PICO = ("population", "intervention_or_exposure", "comparator", "outcomes", "study_designs", "timeframe")


def _question_block(state: ReviewState) -> dict[str, Any]:
    q = state.get("question")
    english_topic = state.get("english_topic") or state["topic"]
    if not q:
        return {"original_topic": state["topic"], "english_topic": english_topic, "refined": False,
                "interpretation": None, "refined_question": english_topic, "sub_questions": [], "assumptions": [],
                "framework": None, "concept": None, "context": None,
                "english": None, "pico": None, "question_type": None, "ambiguities": [], "key_terms": []}
    display = state.get("question_display") or {}
    pcc = ReviewOptions.clamped(state.get("options")).review_type == "scoping"
    framework = "PCC" if pcc else "PICO"
    return {"original_topic": state["topic"], "english_topic": english_topic, "refined": True,
            "framework": framework, "concept": q.get("concept") if pcc else None,
            "context": q.get("context") if pcc else None,
            **{k: display.get(k, q.get(k)) for k in QUESTION_TEXT},
            "english": {k: q.get(k) for k in QUESTION_TEXT}, "pico": {k: q.get(k) for k in PICO},
            "question_type": q.get("question_type"), "ambiguities": q.get("ambiguities") or [],
            "key_terms": q.get("key_terms") or []}


def _meta_result(state: ReviewState, synthesis_en: dict[str, Any], display: dict[str, Any]) -> dict[str, Any] | None:
    """result.meta_analysis: the pool_outcomes output (English outcome names) plus `outcome_display`, the matrix row
    name in the user's language; null for every other review type."""
    meta = state.get("meta_analysis") if _review_type(state) == "meta_analysis" else None
    if not meta:
        return None
    names = {en["outcome"]: loc["outcome"] for en, loc in zip(synthesis_en.get("comparison") or [],
                                                              display.get("comparison") or [], strict=False)}
    return with_display(meta, names)


def make_finalize(deps):
    async def finalize(state: ReviewState) -> dict:
        papers = unique_papers(state)
        language = state.get("language", "th")
        synthesis_en = state.get("synthesis") or _empty_synthesis(NO_PAPERS["en"], _review_type(state))
        synthesis = state.get("synthesis_display") or synthesis_en
        localized = state.get("localized_cards") or {}
        out_papers = []
        for p in papers:
            c = p["candidate"]
            out_papers.append({
                "ref": p["ref"], "title": c["title"], "authors": c.get("authors") or [], "year": c.get("year"),
                "journal": c.get("journal"), "doi": c.get("doi"), "pmid": c.get("pmid"), "pmcid": c.get("pmcid"),
                "url": c.get("url"), "relevance": p.get("relevance"), "screen_reason": p.get("screen_reason"),
                "card": localized.get(p["ref"]) or p.get("card"), "card_en": p.get("card"),
                "verification": p.get("verification"), "error": p.get("error"),
            })
        stats = state.get("search_stats") or {}
        selection = state.get("selection_stats") or {}
        llms = deps.llms
        models = dict(getattr(llms, "models", {}) or {}) or {
            role: getattr(getattr(llms, role, None), "model", "")
            for role in ("guard", "planner", "screener", "extractor", "synthesizer")}
        result = {
            "topic": state["topic"], "english_topic": state.get("english_topic"), "language": language,
            "review_type": ReviewOptions.clamped(state.get("options")).review_type,
            "question": _question_block(state),
            "summary": synthesis["executive_summary"], "synthesis": synthesis, "synthesis_en": synthesis_en,
            "papers": out_papers, "queries": (state.get("plan") or {}).get("queries", []),
            "stats": {
                "found": stats.get("found", 0), "unique": stats.get("unique", 0),
                "with_abstract": stats.get("with_abstract", 0),
                "candidates": len(state.get("candidates") or []),
                "screened": len({d["key"] for d in state.get("screened") or []}),
                "selected": len(state.get("selected") or []),
                "extracted": sum(1 for p in papers if p.get("card")),
                "non_research": stats.get("non_research", 0),
                "excluded_screening": dict(selection.get("excluded_screening") or {}),
                "excluded_selection": {"narrative_excluded": selection.get("narrative_excluded", 0),
                                       "over_limit": selection.get("over_limit", 0)},
            },
            "quality": summarize_quality(state.get("quality") or [], state.get("started_at")),
            "errors": list(state.get("errors") or []), "prompt_version": deps.settings.prompt_version,
            "llm_preset": getattr(llms, "preset", ""), "models": models,
            "external_context": [{"tool": e["tool"], "arguments": e["arguments"], "ok": e["ok"],
                                  "preview": (e.get("text") or e.get("error") or "")[:500]}
                                 for e in state.get("external_context") or []],
            "citations": state.get("citations"),
            "meta_analysis": _meta_result(state, synthesis_en, synthesis),
        }
        progress_writer()({"type": "finalizing"})
        return {"result": result}

    return finalize
