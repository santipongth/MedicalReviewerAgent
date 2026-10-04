"""Synthesis as a checked pipeline instead of one big LLM call:
normalize outcome names (LLM, validated) → matrix, consensus, conflicts and GRADE-lite (code)
→ explain each conflict (LLM, fan-out) → narrative with citation check (LLM) ∥ card localization
→ localize the synthesis → finalize."""
from __future__ import annotations

import asyncio
import copy
import re
import time
from typing import Any

from langgraph.types import Send

from app.graph import prompts
from app.graph.nodes.intake import harness_runner, harness_spec, review_question
from app.graph.progress import progress_writer
from app.graph.schemas import (
    ConflictNote,
    EvidenceCluster,
    OutcomeClusters,
    Synthesis,
    SynthesisNarrative,
)
from app.graph.state import ReviewState
from app.harness.grade import LEVELS, clamp_to_baseline, grade_baseline
from app.harness.localize import localize_strings
from app.harness.matrix import build_matrix, fallback_clusters, outcome_pairs, validate_clusters
from app.harness.quality import summarize_quality
from app.harness.verify import check_citations, strip_unknown_citations
from app.services.fulltext import FULLTEXT_SOURCES
from app.services.llm import LLMError

NO_PAPERS = {
    "th": "ไม่พบงานวิจัยที่ตรงกับหัวข้อนี้เพียงพอสำหรับการสรุปเปรียบเทียบ ลองใช้คำค้นที่กว้างขึ้นหรือระบุชื่อสาร/โรคเป็นภาษาอังกฤษ",
    "en": "No sufficiently relevant studies were found for this topic. Try a broader topic or English drug/disease names.",
}
SYNTH_FAILED = ("The narrative synthesis step failed; the comparison table, consensus and conflicts below were "
                "computed from the per-paper extractions.")
DIRECTION_TEXT = {"positive": "findings support the hypothesised effect",
                  "negative": "findings show the opposite effect or harm",
                  "null": "findings show no significant association"}
_CITED = re.compile(r"\[P\d+")


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


def _brief(p: dict[str, Any]) -> dict[str, Any]:
    """Compact paper card for multi-paper prompts (quotes dropped: they were verified already)."""
    card = copy.deepcopy(p["card"])
    card.pop("sample_size_quote", None)
    for o in card.get("outcomes", []):
        o.pop("evidence_quote", None)
    c = p.get("candidate") or {}
    return {"ref": p["ref"], "title": c.get("title"), "year": c.get("year"),
            "text_source": p.get("fulltext_source"), "card": card}


def _empty_synthesis(summary: str) -> dict[str, Any]:
    return Synthesis(executive_summary=summary, comparison=[], consensus=[], conflicts=[],
                     evidence_strength="very_low", evidence_rationale=summary, research_gaps=[],
                     grade_baseline="very_low").model_dump()


# ---- S1 + S2: normalize outcome names, then build the matrix in code ----------------------------
def make_normalize_outcomes(deps):
    async def normalize_outcomes(state: ReviewState) -> dict:
        started = time.perf_counter()
        papers = _with_cards(state)
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
                clusters = res.value if res.ok else None
            except LLMError as exc:
                errors.append(f"outcome normalization failed: {type(exc).__name__}")
            entry["fallback"] = clusters is None
        matrix = build_matrix(papers, clusters or fallback_clusters(papers))
        matrix["grade"] = grade_baseline(papers, matrix)
        entry |= {"outcomes": len(matrix["rows"]), "conflicts": len(matrix["conflicts"]),
                  "seconds": round(time.perf_counter() - started, 3)}
        return {"matrix": matrix, "cost_usd": cost, "errors": errors, "quality": [entry]}

    return normalize_outcomes


# ---- S3: explain each conflict ----------------------------------------------------------------
def route_conflicts(state: ReviewState) -> list[Send] | str:
    conflicts = (state.get("matrix") or {}).get("conflicts") or []
    if not conflicts:
        return "write_synthesis"
    by_ref = {p["ref"]: p for p in _with_cards(state)}
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

        def validate(n: ConflictNote) -> list[str]:
            problems = check_citations(n.explanation, allowed)
            if not n.explanation.strip():
                problems.append("explanation must not be empty")
            if not 1 <= len(n.likely_reasons) <= 4:
                problems.append("likely_reasons must list 1-4 reasons")
            return problems

        llm = getattr(deps.llms, "conflict_explainer", None)
        if llm is not None:
            try:
                res = await harness_runner(deps).call(
                    llm, prompts.CONFLICT_SYSTEM,
                    prompts.conflict_user(question=payload["question"], conflict=conflict, papers=payload["papers"]),
                    schema=ConflictNote, validate=validate, trigger="conflict")
                cost += res.cost
                entry["repaired"] = res.repaired
                if res.value is not None and res.value.explanation.strip():
                    # outcome and refs are owned by code; unknown citations are removed if repair failed
                    note = {"outcome": conflict["outcome"], "refs": conflict["refs"],
                            "likely_reasons": res.value.likely_reasons[:4],
                            "explanation": strip_unknown_citations(res.value.explanation, allowed)}
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


def _clusters(matrix: dict[str, Any], notes: list[dict[str, Any]]) -> tuple[list, list]:
    consensus = [EvidenceCluster(
        statement=f"{c['outcome']}: {DIRECTION_TEXT.get(c['direction'], c['direction'])}",
        refs=c["refs"], explanation=f"{len(c['refs'])} studies report the same direction for {c['outcome']}.")
        for c in matrix.get("consensus", [])]
    by_outcome = {n["outcome"]: n for n in notes}
    conflicts = []
    for c in matrix.get("conflicts", []):
        note = by_outcome.get(c["outcome"]) or _deterministic_note(c)
        conflicts.append(EvidenceCluster(statement=f"{c['outcome']}: studies disagree", refs=c["refs"],
                                         explanation=note["explanation"], likely_reasons=note["likely_reasons"]))
    return consensus, conflicts


def make_write_synthesis(deps):
    async def write_synthesis(state: ReviewState) -> dict:
        started = time.perf_counter()
        language = state.get("language", "th")
        papers = _with_cards(state)
        if not papers:
            english = _empty_synthesis(NO_PAPERS["en"])
            display = _empty_synthesis(NO_PAPERS.get(language, NO_PAPERS["en"]))
            return {"synthesis": english, "synthesis_display": display, "localized_cards": None,
                    "quality": [{"stage": "narrative", "skipped": True, "seconds": 0.0}]}
        matrix = state.get("matrix") or {}
        baseline = (matrix.get("grade") or {}).get("level", "very_low")
        allowed = {p["ref"] for p in papers}
        notes = sorted({n["outcome"]: n for n in state.get("conflict_notes") or []}.values(),
                       key=lambda n: n["outcome"].lower())
        question = state.get("question") or {}

        def validate(n: SynthesisNarrative) -> list[str]:
            problems = check_citations(" ".join([n.executive_summary, n.evidence_rationale, *n.research_gaps]),
                                       allowed)
            if not _CITED.search(n.executive_summary):
                problems.append("executive_summary must cite the supporting papers inline, e.g. [P1]")
            if abs(LEVELS.index(n.evidence_strength) - LEVELS.index(baseline)) > 1:
                problems.append(f"evidence_strength {n.evidence_strength} is more than one level away from the "
                                f"GRADE-lite baseline {baseline}")
            return problems

        user = prompts.narrative_user(question=review_question(state),
                                      sub_questions=question.get("sub_questions") or [],
                                      papers=[_brief(p) for p in papers], matrix=matrix, conflict_notes=notes,
                                      baseline=matrix.get("grade") or {})
        narrative_call = harness_runner(deps).call(deps.llms.synthesizer, prompts.NARRATIVE_SYSTEM, user,
                                                   schema=SynthesisNarrative, validate=validate, trigger="narrative")
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
        narrative: SynthesisNarrative | None = None
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
            narrative = SynthesisNarrative(executive_summary=SYNTH_FAILED, evidence_strength=baseline,
                                           evidence_rationale="; ".join((matrix.get("grade") or {}).get("factors", [])),
                                           research_gaps=[])
        elif not res.ok:  # still invalid after repairs: remove what cannot be trusted, keep the rest
            fixed = narrative.model_copy(update={
                "executive_summary": strip_unknown_citations(narrative.executive_summary, allowed),
                "evidence_rationale": strip_unknown_citations(narrative.evidence_rationale, allowed),
                "research_gaps": [strip_unknown_citations(g, allowed) for g in narrative.research_gaps]})
            entry["citation_fixes"] = int(fixed != narrative)
            narrative = fixed
        synthesis = Synthesis(
            executive_summary=narrative.executive_summary, comparison=matrix.get("rows", []),
            consensus=consensus, conflicts=conflicts,
            evidence_strength=clamp_to_baseline(narrative.evidence_strength, baseline),
            evidence_rationale=narrative.evidence_rationale, research_gaps=narrative.research_gaps,
            grade_baseline=baseline)
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
        synthesis = state.get("synthesis") or _empty_synthesis("")
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
                "english": None, "pico": None, "question_type": None, "ambiguities": [], "key_terms": []}
    display = state.get("question_display") or {}
    return {"original_topic": state["topic"], "english_topic": english_topic, "refined": True,
            **{k: display.get(k, q.get(k)) for k in QUESTION_TEXT},
            "english": {k: q.get(k) for k in QUESTION_TEXT}, "pico": {k: q.get(k) for k in PICO},
            "question_type": q.get("question_type"), "ambiguities": q.get("ambiguities") or [],
            "key_terms": q.get("key_terms") or []}


def make_finalize(deps):
    async def finalize(state: ReviewState) -> dict:
        papers = unique_papers(state)
        language = state.get("language", "th")
        synthesis_en = state.get("synthesis") or _empty_synthesis(NO_PAPERS["en"])
        synthesis = state.get("synthesis_display") or synthesis_en
        localized = state.get("localized_cards") or {}
        out_papers = []
        for p in papers:
            c = p["candidate"]
            out_papers.append({
                "ref": p["ref"], "title": c["title"], "authors": c.get("authors") or [], "year": c.get("year"),
                "journal": c.get("journal"), "doi": c.get("doi"), "pmid": c.get("pmid"), "pmcid": c.get("pmcid"),
                "url": c.get("url"), "relevance": p.get("relevance"), "screen_reason": p.get("screen_reason"),
                "fulltext_source": p.get("fulltext_source"), "fulltext_url": p.get("fulltext_url"),
                "card": localized.get(p["ref"]) or p.get("card"), "card_en": p.get("card"),
                "verification": p.get("verification"), "error": p.get("error"),
            })
        stats = state.get("search_stats") or {}
        llms = deps.llms
        models = dict(getattr(llms, "models", {}) or {}) or {
            role: getattr(getattr(llms, role, None), "model", "")
            for role in ("guard", "planner", "screener", "extractor", "synthesizer")}
        result = {
            "topic": state["topic"], "english_topic": state.get("english_topic"), "language": language,
            "question": _question_block(state),
            "summary": synthesis["executive_summary"], "synthesis": synthesis, "synthesis_en": synthesis_en,
            "papers": out_papers, "queries": (state.get("plan") or {}).get("queries", []),
            "stats": {
                "found": stats.get("found", 0), "unique": stats.get("unique", 0),
                "candidates": len(state.get("candidates") or []),
                "screened": len({d["key"] for d in state.get("screened") or []}),
                "selected": len(state.get("selected") or []),
                "with_fulltext": sum(1 for p in papers if p.get("fulltext_source") in FULLTEXT_SOURCES),
                "extracted": sum(1 for p in papers if p.get("card")),
            },
            "quality": summarize_quality(state.get("quality") or [], state.get("started_at")),
            "errors": list(state.get("errors") or []), "prompt_version": deps.settings.prompt_version,
            "llm_preset": getattr(llms, "preset", ""), "models": models,
        }
        progress_writer()({"type": "finalizing"})
        return {"result": result}

    return finalize
