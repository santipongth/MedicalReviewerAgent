"""Synthesis as a checked pipeline instead of one big LLM call:
normalize outcome names (LLM, validated) → matrix, consensus, conflicts and GRADE-lite (code)
→ explain each conflict (LLM, fan-out) → narrative with citation check (LLM) ∥ card localization
→ localize the synthesis → finalize."""
from __future__ import annotations

import asyncio
import copy
import logging
import re
import time
from collections import Counter
from datetime import UTC, datetime
from typing import Any

from langgraph.types import Send

from app.graph import prompts
from app.graph.nodes.intake import harness_runner, harness_spec, review_question
from app.graph.nodes.retrieval import MIN_ABSTRACT_CHARS
from app.graph.nodes.screening import MIN_INCLUDE_RELEVANCE
from app.graph.progress import progress_writer
from app.graph.schemas import (
    ConflictNote,
    EvidenceCluster,
    KeyFinding,
    NarrativeFinding,
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
    reconcile_rationale,
)
from app.harness.localize import Localized, localize_strings, untranslated
from app.harness.matrix import (
    DIFFERENCE_MEASURES,
    RATIO_MEASURES,
    build_matrix,
    effect_side,
    expand_clusters,
    is_placeholder,
    outcome_pairs,
    precluster,
    preclustered,
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
from app.harness.prose import (
    ProseContext,
    fix_prose,
    fix_statement,
    prose_context,
    prose_problems,
    statement_problems,
)
from app.harness.quality import summarize_quality
from app.harness.study_types import allowed_designs, design_allowed
from app.harness.trials import related_reports
from app.harness.verify import check_citations, strip_unknown_citations
from app.schemas.review import NON_QUANTITATIVE_TYPES, SLR_LIKE, ReviewOptions
from app.services.llm import LLMError

log = logging.getLogger(__name__)

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
_CITE_GROUPS = re.compile(r"\[([^\]]*)\]")
_CITE_RANGE = re.compile(r"\bP(\d+)\s*[-–]\s*P?(\d+)\b")


def cited_refs(text: str) -> set[str]:
    """Every [Pn] a text cites, including grouped ("[P1, P4]", "[P2; P3]") and ranged ("[P1-P3]", "[P1–3]") ones."""
    refs: set[str] = set()
    for group in _CITE_GROUPS.findall(text or ""):
        for lo, hi in _CITE_RANGE.findall(group):
            if int(lo) <= int(hi) <= int(lo) + 100:
                refs |= {f"P{i}" for i in range(int(lo), int(hi) + 1)}
        refs |= set(re.findall(r"\bP\d+\b", group))
    return refs


NO_QUANTITATIVE_RATIONALE = ("Certainty of evidence is not graded: no quantitative studies (qualitative themes are "
                             "summarised only).")
QUALITATIVE_ONLY_FACTOR = ("no quantitative studies: the included qualitative/mixed-methods studies are summarised "
                           "as themes, which are not graded")
OTHER_COMPARISONS_ONLY_FACTOR = ("no extracted estimate compares the review's intervention with its comparator; the "
                                 "papers' other comparisons are listed on their cards and are not graded")
GRADE_FAILED_FACTOR = "the GRADE-lite assessment could not be computed, so the certainty is rated very low"
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


def _outside_study_types(state: ReviewState, p: dict[str, Any]) -> bool:
    """A paper selected as a ticked study type whose design, as read (and corrected in reading), is none of them
    (final review finding 10): the screener guessed "rct", the reader found a cohort. Selection filters on the
    screener's guess only, so this is re-checked here. A paper kept knowingly despite its design (`design_mismatch`,
    relaxed selection) and an undecided design ("other") stay."""
    allowed = allowed_designs(state.get("options"), _review_type(state))
    return bool(allowed) and not p.get("design_mismatch") and not design_allowed(
        p["card"].get("design_category"), allowed)


def design_excluded(state: ReviewState) -> list[str]:
    """Refs of the papers left out of the evidence because their read design is outside the ticked study types."""
    return [p["ref"] for p in _with_cards(state) if _outside_study_types(state, p)]


def related(state: ReviewState) -> dict[str, dict[str, str]]:
    """Reports of the same trial (Plan 20 Task 10, app.harness.trials): {related ref: {"primary", "reason"}}. Only
    the primary report of each trial is evidence; the others stay in the paper list, linked to it. A scoping review
    maps every report, so it has none. A crash of the check leaves every paper independent (logged)."""
    if _review_type(state) == "scoping":
        return {}
    try:
        cards = _with_cards(state)
        # only evidence may be a primary report (Task 10 review finding 4): in scope, direction evidence, answering
        # the question
        evidence = {p["ref"] for p in cards if not _outside_study_types(state, p)
                    and p["card"].get("design_category") not in NO_DIRECTION_CATEGORIES
                    and question_card(p["card"]) is not None}
        return related_reports(cards, evidence)
    except Exception:
        log.exception("related_reports failed; every paper counts as its own study")
        return {}


def _scoped(state: ReviewState) -> list[dict[str, Any]]:
    """The papers with a card whose design fits the ticked study types (all of them when nothing is ticked), without
    the related reports of a trial whose primary report is analysed."""
    linked = related(state)
    return [p for p in _with_cards(state) if not _outside_study_types(state, p) and p["ref"] not in linked]


def _direction_papers(state: ReviewState) -> list[dict[str, Any]]:
    """Papers of a design that can be direction evidence: narrative reviews (they restate other studies) and
    qualitative or mixed-methods studies (themes, no effect numbers) stay in the paper list but add no matrix cells,
    conflicts, pools or grade. A scoping review maps everything, so it counts them. A paper whose read design is
    outside the ticked study types is no evidence either (it stays in the paper list)."""
    if _review_type(state) == "scoping":
        return _with_cards(state)
    return [p for p in _scoped(state) if p["card"].get("design_category") not in NO_DIRECTION_CATEGORIES]


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
    return [p for p in _scoped(state)
            if p["card"].get("design_category") not in NO_DIRECTION_CATEGORIES
            or p["card"].get("design_category") in NON_QUANTITATIVE_CATEGORIES]


# Question types whose findings have no "side of no effect" (accuracy, frequency): no consensus, conflicts or
# direction-based inconsistency. "other" joins them when no evidence cell carries an effect estimate.
NON_EFFECT_QUESTIONS = frozenset({"prevalence", "diagnosis"})
EFFECT_MEASURES = RATIO_MEASURES | DIFFERENCE_MEASURES
# "None (qualitative inquiry ...)", "no comparator", "N/A", "": the question compares nothing
_NO_COMPARATOR = re.compile(r"^\W*($|none\b|no (comparator|comparison|control)\b|n/?a\b|not applicable\b)",
                            re.IGNORECASE)


def _directional(state: ReviewState, papers: list[dict[str, Any]] | None = None) -> bool:
    """Whether direction logic (consensus, conflicts, direction-based inconsistency) applies (audit I-11). It never
    does for a scoping review (it charts, it makes no claims), for a themes review (every ticked study type is
    qualitative or mixed-methods), for a prevalence or diagnosis question, or for an "other" question that looks like
    no effect question at all: no evidence outcome with a ratio or difference measure (even without a value) and no
    intervention-vs-comparator question (themes or descriptive findings). A mislabelled "other" effect question
    therefore keeps its consensus and conflicts."""
    options = ReviewOptions.clamped(state.get("options"))
    if options.review_type == "scoping":
        return False
    if options.study_types and set(options.study_types) <= NON_QUANTITATIVE_TYPES:
        return False
    question = state.get("question") or {}
    question_type = question.get("question_type")
    if question_type in NON_EFFECT_QUESTIONS:
        return False
    if question_type == "other":
        evidence = _evidence(state) if papers is None else papers
        measured = any(o.get("effect_measure") in EFFECT_MEASURES or effect_side(o) is not None
                       for p in evidence for o in p["card"].get("outcomes") or [])
        compared = bool((question.get("intervention_or_exposure") or "").strip()
                        and not _NO_COMPARATOR.match(question.get("comparator") or ""))
        return measured or compared
    return True


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
                     grade_baseline="very_low" if graded else None, answer=summary, key_findings=[]).model_dump()


def _not_graded_rationale(review_type: str) -> str:
    return f"Certainty of evidence is not graded in a {'scoping' if review_type == 'scoping' else 'narrative'} review."


# ---- S1 + S2: normalize outcome names, then build the matrix in code ----------------------------
def make_normalize_outcomes(deps):
    async def normalize_outcomes(state: ReviewState) -> dict:
        started = time.perf_counter()
        papers = _evidence(state)
        entry: dict[str, Any] = {"stage": "normalize", "fallback": False, "repaired": False}
        cost, errors = 0.0, []
        outside = design_excluded(state)
        if outside:  # read as a design the user did not tick: out of the evidence, still listed with its card
            log.info("design outside the ticked study types, not evidence: %s", ", ".join(outside))
            entry["design_excluded"] = outside
        clusters: OutcomeClusters | None = None
        pairs = outcome_pairs(papers)
        if papers:
            progress_writer()({"type": "synthesizing", "papers": len(papers)})
        normalizer = getattr(deps.llms, "normalizer", None)
        # Identical or spelling-variant names are grouped in code first; the model only sees one representative pair
        # per group, so it has far fewer pairs to copy back (audit I-17).
        groups = precluster(pairs)
        reps = [g[0] for g in groups]
        entry |= {"pairs": len(pairs), "sent": 0}
        if normalizer is not None and len(pairs) > 1:  # even one group: the model names it ("CRC incidence" →
            # "Colorectal cancer incidence"), a one-pair call
            entry["sent"] = len(reps)
            try:
                res = await harness_runner(deps).call(
                    normalizer, prompts.NORMALIZE_SYSTEM,
                    prompts.normalize_user(question=review_question(state), pairs=reps),
                    schema=OutcomeClusters, validate=lambda c: validate_clusters(c, papers, reps),
                    trigger="normalize")
                cost += res.cost
                entry["repaired"] = res.repaired
                if res.value is not None:  # a near miss is corrected in code, not thrown away
                    fixed, corrections, kept = repair_clusters(res.value, papers, reps)
                    entry["corrections"] = corrections
                    clusters = expand_clusters(fixed, groups) if kept else None
            except LLMError as exc:
                errors.append(f"outcome normalization failed: {type(exc).__name__}")
            entry["fallback"] = clusters is None
        directional = _directional(state, papers)
        # without the model (none configured, one group, or a failure) the pre-clusters are the clustering.
        # Like pooling, the matrix and the grade are deterministic extras: an unexpected card shape must not fail the
        # review; the papers and their cards still render (final review finding 9).
        try:
            # scoping: cells only chart which paper covers which aspect, no free-text finding (Task 10 review 9)
            matrix = build_matrix(papers, clusters or preclustered(groups), directional=directional,
                                  charted=_review_type(state) == "scoping")
        except Exception as exc:
            log.exception("build_matrix failed")
            errors.append(f"comparison matrix failed: {type(exc).__name__}")
            entry["matrix_failed"] = True
            matrix = {"rows": [], "consensus": [], "conflicts": [], "imprecise": []}
        try:
            matrix["grade"] = grade_baseline(papers, matrix, (state.get("question") or {}).get("outcomes"),
                                             directional=directional)
        except Exception as exc:
            log.exception("grade_baseline failed")
            errors.append(f"GRADE-lite baseline failed: {type(exc).__name__}")
            entry["grade_failed"] = True
            matrix["grade"] = {"level": "very_low", "factors": [GRADE_FAILED_FACTOR]}
        if not papers and _direction_papers(state):  # every quantitative paper reports only other comparisons
            matrix["grade"]["factors"] = [OTHER_COMPARISONS_ONLY_FACTOR]
        elif not papers and _themes_only(_narrative_papers(state)):  # the level stays as the baseline gives it
            matrix["grade"]["factors"] = [QUALITATIVE_ONLY_FACTOR]
        entry |= {"outcomes": len(matrix["rows"]), "conflicts": len(matrix["conflicts"]),
                  "directional": directional,  # false: consensus/conflict logic skipped (scoping, themes, ...)
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
    parts = [f"{d}: {', '.join(f'[{r}]' for r in refs)}" for d, refs in conflict.get("directions", {}).items() if refs]
    who = ("Systematic reviews and primary studies report" if conflict.get("review_discordant")
           else "Studies report")
    return {"outcome": conflict["outcome"], "refs": conflict["refs"], "likely_reasons": [],
            "explanation": f"{who} different directions for {conflict['outcome']} ({'; '.join(parts)})."}


def make_explain_conflict(deps):
    async def explain_conflict(payload: dict[str, Any]) -> dict:
        started = time.perf_counter()
        conflict = payload["conflict"]
        allowed = set(conflict["refs"])
        entry: dict[str, Any] = {"stage": "conflict", "outcome": conflict["outcome"], "fallback": True,
                                 "repaired": False}
        note, cost, errors = None, 0.0, []
        prose = prose_context(payload["papers"], texts=[payload["question"]], counts=[len(conflict["refs"])],
                              max_count=len(conflict["refs"]))
        prose_rounds: list[bool] = []

        def validate(n: ConflictNote) -> list[str]:
            problems = check_citations(n.explanation, allowed)
            if not n.explanation.strip():
                problems.append("explanation must not be empty")
            if not 1 <= len(n.likely_reasons) <= 4:
                problems.append("likely_reasons must list 1-4 reasons")
            try:  # measure names are fixed in code, not by another round (final review finding 4)
                grounded = prose_problems(n.explanation, prose, "explanation", fixable=False)
            except Exception:
                log.exception("grounded-prose validation failed")
                grounded = []
            prose_rounds.append(bool(grounded))
            return problems + grounded

        llm = getattr(deps.llms, "conflict_explainer", None)
        if llm is not None:
            try:
                res = await harness_runner(deps).call(
                    llm, prompts.CONFLICT_SYSTEM,
                    prompts.conflict_user(question=payload["question"], conflict=conflict, papers=payload["papers"]),
                    schema=ConflictNote, validate=validate, trigger="conflict")
                cost += res.cost
                entry["repaired"] = res.repaired
                entry["prose_repairs"] = sum(prose_rounds[:-1])  # rounds the grounded-prose check sent back
                explanation, reasons = "", []
                if res.value is not None:
                    # unknown citations are removed if repair failed, then every sentence with an untraceable
                    # number or population is dropped and wrong measure names are corrected; the likely reasons get
                    # the same number check (final review finding 6). A crash of the check fails closed: the
                    # deterministic note is used.
                    try:
                        before = strip_unknown_citations(res.value.explanation, allowed)
                        explanation, counts = fix_prose(before, prose)
                        for reason in res.value.likely_reasons[:4]:
                            text, more = fix_prose(reason, prose)
                            counts += more
                            if text.strip():
                                reasons.append(text)
                        entry |= {f"prose_{k}": v for k, v in counts.items()}
                        if _CITED.search(before) and not _CITED.search(explanation):
                            explanation = ""  # every cited sentence was removed: the deterministic note instead
                    except Exception as exc:
                        log.exception("grounded-prose check of a conflict explanation failed")
                        errors.append(f"conflict explanation check failed for {conflict['outcome']}: "
                                      f"{type(exc).__name__}")
                        explanation, entry["prose_check_failed"] = "", True
                if explanation.strip():
                    # outcome and refs are owned by code
                    note = {"outcome": conflict["outcome"], "refs": conflict["refs"],
                            "likely_reasons": reasons, "explanation": explanation}
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
    res = await localize_strings(llm, harness_runner(deps), strings, language)
    cards = {p["ref"]: _apply_card_strings(p["ref"], p["card"], res.strings) for p in papers}
    entry = {"stage": "localize_cards", "items": len(strings), **res.telemetry(),
             "seconds": round(time.perf_counter() - started, 3)}
    return cards, entry, res.cost


def _cite(refs: list[str]) -> str:
    return ", ".join(f"[{r}]" for r in refs)


# Thai renderings of the code-generated consensus/conflict text (audit I-16): fixed academic Thai instead of an LLM
# translation of an English template, which came out stiff and inconsistent.
DIRECTION_TEXT_TH = {"positive": "ผลการศึกษาสนับสนุนผลตามที่ตั้งสมมติฐานไว้",
                     "negative": "ผลการศึกษาชี้ไปในทางตรงข้ามหรือพบผลเสีย",
                     "null": "ไม่พบความสัมพันธ์อย่างมีนัยสำคัญทางสถิติ"}
DIRECTION_LABEL_TH = {"positive": "สนับสนุนผลที่คาดไว้", "negative": "ทางตรงข้ามหรือผลเสีย",
                      "null": "ไม่มีนัยสำคัญทางสถิติ"}
CONFLICT_STATEMENT = {"en": "studies disagree", "th": "ผลการศึกษาไม่สอดคล้องกัน"}
# Plan 20 Task 10: a split between systematic reviews and primary studies (matrix `review_discordant`)
REVIEW_CONFLICT_STATEMENT = {"en": "systematic reviews and primary studies disagree",
                             "th": "ผลของการทบทวนวรรณกรรมอย่างเป็นระบบและการศึกษาปฐมภูมิไม่สอดคล้องกัน"}
REVIEW_DISSENT = {"en": "; systematic reviews disagree",
                  "th": " แต่การทบทวนวรรณกรรมอย่างเป็นระบบให้ผลต่างออกไป"}


def _th_for(outcome: str) -> str:
    """"สำหรับ" + the outcome, spaced only before a Latin-script name."""
    return f"สำหรับ{' ' if outcome[:1].isascii() else ''}{outcome}"


def _consensus_statement(c: dict[str, Any], outcome: str | None = None, language: str = "en") -> str:
    texts = DIRECTION_TEXT_TH if language == "th" else DIRECTION_TEXT
    flag = REVIEW_DISSENT["th" if language == "th" else "en"] if c.get("review_discordant") else ""
    return f"{outcome or c['outcome']}: {texts.get(c['direction'], c['direction'])}{flag}"


def _conflict_statement(c: dict[str, Any], outcome: str | None = None, language: str = "en") -> str:
    texts = REVIEW_CONFLICT_STATEMENT if c.get("review_discordant") else CONFLICT_STATEMENT
    return f"{outcome or c['outcome']}: {texts['th' if language == 'th' else 'en']}"


def _consensus_explanation_th(c: dict[str, Any], outcome: str) -> str:
    dissent = c.get("dissent") or {}
    extra = ""
    if c.get("nonsignificant"):
        extra += f" {_cite(c['nonsignificant'])} ชี้ไปในทิศทางเดียวกันแต่ไม่มีนัยสำคัญทางสถิติ"
    if c.get("corroborating"):
        extra += f" การทบทวนวรรณกรรมอย่างเป็นระบบ {_cite(c['corroborating'])} ให้ผลสอดคล้องกัน"
    if c.get("discordant_reviews"):
        extra += f" ส่วนการทบทวนวรรณกรรมอย่างเป็นระบบ {_cite(c['discordant_reviews'])} รายงานผลไปในทิศทางที่ต่างออกไป"
    if not dissent:
        return f"การศึกษา {len(c['refs'])} เรื่องรายงานผลไปในทิศทางเดียวกัน{_th_for(outcome)}{extra}"
    total = len(c["refs"]) + sum(len(refs) for refs in dissent.values())
    others = " และ ".join(f"{_cite(refs)} {DIRECTION_TEXT_TH.get(d, d).replace('ผลการศึกษา', '', 1)}"
                          for d, refs in dissent.items())
    return (f"การศึกษา {len(c['refs'])} จาก {total} เรื่องรายงานผลไปในทิศทางเดียวกัน{_th_for(outcome)} "
            f"ส่วน {others}{extra}")


def _deterministic_explanation_th(conflict: dict[str, Any], outcome: str) -> str:
    parts = [f"{DIRECTION_LABEL_TH.get(d, d)}: {_cite(refs)}" for d, refs in conflict.get("directions", {}).items()
             if refs]
    who = ("การทบทวนวรรณกรรมอย่างเป็นระบบและการศึกษาปฐมภูมิ" if conflict.get("review_discordant")
           else "การศึกษา")
    return f"{who}รายงานทิศทางของผลแตกต่างกัน{_th_for(outcome)} ({'; '.join(parts)})"


def _consensus_explanation(c: dict[str, Any]) -> str:
    dissent = c.get("dissent") or {}
    extra = ""
    nonsignificant = c.get("nonsignificant") or []
    if nonsignificant:  # same side of no effect, not statistically significant: imprecision, not disagreement
        extra += (f" {_cite(nonsignificant)} {'points' if len(nonsignificant) == 1 else 'point'} the same way without "
                  f"statistical significance.")
    if c.get("corroborating"):
        extra += f" Systematic reviews {_cite(c['corroborating'])} agree."
    if c.get("discordant_reviews"):  # reported, never silently dropped (they are not counted)
        extra += f" Systematic reviews {_cite(c['discordant_reviews'])} report a different direction."
    if not dissent:
        return f"{len(c['refs'])} studies report the same direction for {c['outcome']}.{extra}"
    total = len(c["refs"]) + sum(len(refs) for refs in dissent.values())
    def finding(d: str, n: int) -> str:
        text = DIRECTION_TEXT.get(d, d).replace("findings ", "")
        return text.replace("show ", "shows ", 1) if n == 1 else text

    others = "; ".join(f"{_cite(refs)} {finding(d, len(refs))}" for d, refs in dissent.items())
    return f"{len(c['refs'])} of {total} studies report the same direction for {c['outcome']}; {others}.{extra}"


def _clusters(matrix: dict[str, Any], notes: list[dict[str, Any]]) -> tuple[list, list]:
    consensus = [EvidenceCluster(
        statement=_consensus_statement(c),
        refs=sorted({*c["refs"], *(c.get("corroborating") or [])}, key=_ref_num),
        explanation=_consensus_explanation(c))
        for c in matrix.get("consensus", [])]
    by_outcome = {n["outcome"]: n for n in notes}
    conflicts = []
    for c in matrix.get("conflicts", []):
        note = by_outcome.get(c["outcome"]) or _deterministic_note(c)
        conflicts.append(EvidenceCluster(statement=_conflict_statement(c), refs=c["refs"],
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
    # search and selection counts: allowed only in a sentence about the search
    search: list[Any] = [v for v in stats.values() if isinstance(v, int)]
    search += [len(state.get("candidates") or []), len(state.get("selected") or []),
               len({d.get("key") for d in state.get("screened") or []})]
    # pipeline counts: admitted only written as counts ("3 outcomes", "k = 3 studies"), never as "3 deaths"
    counts: list[Any] = [len(papers), len(_evidence(state)), len(rows)]
    counts += [len(r.get("cells") or []) for r in rows]
    for c in [*(matrix.get("consensus") or []), *(matrix.get("conflicts") or [])]:
        counts += [len(c.get("refs") or []), *(len(refs) for refs in (c.get("dissent") or {}).values())]
    values: list[Any] = [ReviewOptions.clamped(state.get("options")).year_from]  # "studies since 2015"
    if meta:
        values += pooled_number_strings(meta)
        counts += [p.get("k") for p in meta.get("pools") or []]
    return prose_context(papers, texts=texts, values=[v for v in values if v], search=[s for s in search if s],
                         counts=[c for c in counts if c])


def _check_prose(narrative: SynthesisNarrative | NarrativeNoGrade, prose: ProseContext, graded: bool,
                 factors: list[str]) -> tuple[SynthesisNarrative | NarrativeNoGrade, Counter[str]]:
    """Correct measure names and drop the sentences of the summary (and, graded, the rationale) whose numbers or
    population claims cannot be traced to the cards (app.harness.prose). Nothing is invented: an emptied summary,
    or one that no longer cites any paper after the removals, becomes a fixed notice; an emptied rationale becomes
    the GRADE-lite factors. The research gaps get the same number check (final review finding 6); an emptied gap is
    dropped. If the check itself crashes, it fails closed: the summary is withheld, the rationale becomes the factors
    and the gaps are dropped (counts then carry "check_failed")."""
    try:
        summary, counts = fix_prose(narrative.executive_summary, prose)
        if _CITED.search(narrative.executive_summary) and not _CITED.search(summary):
            summary = ""  # only uncited sentences are left: they cannot stand as the answer
        update: dict[str, Any] = {"executive_summary": summary or PROSE_REMOVED}
        if graded:
            rationale, more = fix_prose(narrative.evidence_rationale, prose)
            counts += more
            update["evidence_rationale"] = rationale or "; ".join(factors)
        gaps = []
        for gap in narrative.research_gaps:
            text, more = fix_prose(gap, prose)
            counts += more
            if text.strip():
                gaps.append(text)
        update["research_gaps"] = gaps
    except Exception:
        log.exception("grounded-prose check failed; the narrative is withheld")
        update = {"executive_summary": PROSE_REMOVED, "research_gaps": []}
        if graded:
            update["evidence_rationale"] = "; ".join(factors)
        return narrative.model_copy(update=update), Counter(check_failed=1)
    if not counts:
        return narrative, counts
    return narrative.model_copy(update=update), counts


# ---- Plan 20: the direct answer and the key findings ------------------------------------------
MAX_KEY_FINDINGS = 5
NO_POOL_ANSWER = ("Pooling was not possible: no outcome had enough comparable studies with verified estimates, so no "
                  "pooled estimate was computed.")
# A statement that pooling failed: the negation must attach to the pooling verb or noun ("pooling was not possible",
# "could not be pooled", "no outcome could be pooled", "unable to pool", "too few studies to pool"). Arbitrary
# words in between are not allowed, so "does not reduce mortality in the pooled analysis" is no such statement
# (Task 1 review finding 1).
_SAYS_NO_POOL = re.compile(
    r"(?i)\bpool(?:ing|ed analysis|ed estimate)?\s+(?:was|is|were)\s+(?:not\s+(?:possible|feasible|performed|done)"
    r"|impossible|infeasible)"
    r"|\b(?:could|can|cannot|can't|couldn't)\s*(?:not\s+)?be\s+pooled|\b(?:was|were)\s+not\s+pooled"
    r"|\b(?:could|can)\s*not\s+pool\b|\bcannot\s+pool\b|\bunable\s+to\s+pool\b"
    r"|\bno\s+(?:outcomes?|estimates?|results?|studies|data)\s+(?:could|can)\s+be\s+pooled"
    r"|\b(?:not\s+enough|too\s+few|insufficient)\s+(?:\w+\s+){0,3}?(?:to|for)\s+pool(?:ing)?\b"
    r"|\bno\s+pooled\s+(?:estimate|analysis)\s+(?:was|could)")
_POOLED_CLAIM = re.compile(r"(?i)\b(?:pooled|pooling|overall effect|combined estimate)\b")
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z\[])")
_CITE_GROUP = re.compile(r"\s*\[\s*P\d+[^\]]*\]")
ANSWER_CERTAINTY = {"moderate": "The certainty of the evidence is moderate.",
                    "low": "The certainty of the evidence is low.",
                    "very_low": "The certainty of the evidence is very low."}


def _no_pool(review_type: str, meta: dict[str, Any] | None) -> bool:
    """A meta-analysis whose pooling produced no pool (too few comparable studies, skipped or failed)."""
    return review_type == "meta_analysis" and not (meta and meta.get("pools"))


def _bottom_line(answer: str, prose: ProseContext, allowed: set[str], *, no_pool: bool,
                 strength: str | None) -> tuple[str, int]:
    """The checked direct answer: unknown citations stripped, then every sentence with a number (other than a
    context number), a wrong population or measure removed (fix_statement). A meta-analysis without pools states so
    in a fixed sentence, and loses any sentence that claims a pooled effect. A graded answer without the GRADE
    wording for its certainty gets a fixed certainty sentence. Returns (answer, sentences removed)."""
    # the answer carries no [Pn] (the report shows the cited cards beside it; Task 1 review finding 5)
    text, counts = fix_statement(_CITE_GROUP.sub("", strip_unknown_citations(answer or "", allowed)).strip(), prose)
    removed = sum(counts[k] for k in ("numbers_removed", "population_removed", "measures_removed"))
    if no_pool:
        text, n = _drop_pooled_claims(text)
        removed += n
        if not _SAYS_NO_POOL.search(text):
            text = f"{NO_POOL_ANSWER} {text}".strip()
    if strength:
        # a sentence that names another certainty level than the final one is removed (Task 1 review finding 6)
        kept = []
        for sentence in _SENTENCE_END.split(text) if text else []:
            named = _named_level(sentence)
            if named and named != strength:
                removed += 1
                continue
            kept.append(sentence)
        text = " ".join(kept)
    wording = CERTAINTY_WORDING.get(strength or "")
    if text and wording and not wording.search(text) and _named_level(text) != strength:
        text = f"{text} {ANSWER_CERTAINTY[strength]}"
    return text, removed


_LEVEL_NAMED = re.compile(r"(?i)\bcertainty\b[^.]{0,60}?\b(very low|low|moderate|high)\b|"
                          r"\b(very low|low|moderate|high)[- ]certainty\b")


def _named_level(text: str) -> str | None:
    """The GRADE level a text names for the certainty ("the certainty of the evidence is low", "low-certainty")."""
    m = _LEVEL_NAMED.search(text or "")
    return (m.group(1) or m.group(2)).lower().replace(" ", "_") if m else None


def _drop_pooled_claims(text: str) -> tuple[str, int]:
    """Sentences that claim a pooled or overall effect, removed (a meta-analysis that pooled nothing)."""
    kept, removed = [], 0
    for sentence in _SENTENCE_END.split(text) if text else []:
        if _POOLED_CLAIM.search(sentence) and not _SAYS_NO_POOL.search(sentence):
            removed += 1
            continue
        kept.append(sentence)
    return " ".join(kept), removed


# Present-tense causal claims ("reduces", "leads to") that a below-high certainty must hedge (Task 1 review finding 3)
_CAUSAL = re.compile(r"(?i)\b(reduces|lowers|decreases|increases|improves|prevents|causes|raises|worsens|"
                     r"eliminates|cures|protects|leads|results)\b(?=\s)")
_HEDGED = re.compile(r"(?i)\b(may|might|probably|likely|possibly|not|no|unclear|uncertain)\s+$")


def _hedge(statement: str, strength: str | None) -> tuple[str, bool]:
    """A key-finding statement worded for its certainty, fixed in code: when it lacks the GRADE wording for a final
    level below high, each unhedged present-tense causal verb is hedged ("probably reduces" for moderate, "may
    reduce" for low and very low), and a very-low statement ends with "but the evidence is very uncertain"."""
    wording = CERTAINTY_WORDING.get(strength or "")
    if not wording or not statement or wording.search(statement):
        return statement, False

    def hedge(m: re.Match[str]) -> str:
        if _HEDGED.search(statement[: m.start()]):
            return m.group(0)
        verb = m.group(1)
        return f"probably {verb}" if strength == "moderate" else f"may {verb[:-1]}"

    text = _CAUSAL.sub(hedge, statement)
    if strength == "very_low" and text != statement:
        text = f"{text.rstrip().rstrip('.')}, but the evidence is very uncertain."
    return text, text != statement


def _key_findings(drafts: list[NarrativeFinding], prose: ProseContext, allowed: set[str],
                  rows: list[dict[str, Any]], *, no_pool: bool = False,
                  strength: str | None = None) -> tuple[list[dict[str, Any]], int, int]:
    """The checked key findings: refs limited to the analysed papers (inline [Pn] citations are moved into refs),
    the statement made numberless (fix_statement, scoped to the refs), an outcome that names a comparison row
    written exactly as that row, and k = the number of refs. A meta-analysis that pooled nothing loses every
    statement sentence claiming a pooled effect; a statement below high certainty is hedged (_hedge); `certainty`
    is the review's final evidence_strength (null when not graded), set in code. A finding left without a statement,
    a ref or an outcome is dropped; at most MAX_KEY_FINDINGS are kept. Returns (findings, dropped, hedged)."""
    names = {r["outcome"].strip().casefold(): r["outcome"] for r in rows}
    out: list[dict[str, Any]] = []
    dropped = hedged = 0
    for f in drafts:
        if len(out) == MAX_KEY_FINDINGS:
            break
        statement = strip_unknown_citations(f.statement or "", allowed)
        refs = sorted(({r.strip() for r in f.refs} | cited_refs(statement)) & allowed, key=_ref_num)
        text, _counts = fix_statement(_CITE_GROUP.sub("", statement).strip(), prose, refs)
        if no_pool:
            text, _n = _drop_pooled_claims(text)
        text, was_hedged = _hedge(text, strength)
        outcome = names.get((f.outcome or "").strip().casefold(), (f.outcome or "").strip())
        if not text.strip() or not refs or not outcome or is_placeholder(text) or is_placeholder(outcome):
            dropped += 1
            continue
        hedged += int(was_hedged)
        out.append(KeyFinding(outcome=outcome, statement=text, refs=refs, k=len(refs),
                              certainty=strength).model_dump())
    return out, dropped, hedged


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
            if design_excluded(state):  # every card read as a design outside the ticked study types
                messages = NO_PAPERS
            elif state.get("selected"):
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
        prose = _prose_context(state, papers, matrix, meta)
        prose_rounds: list[bool] = []

        def validate(n: SynthesisNarrative | NarrativeNoGrade) -> list[str]:
            rationale = getattr(n, "evidence_rationale", "")
            problems = check_citations(" ".join([n.executive_summary, rationale, *n.research_gaps]), allowed)
            if not _CITED.search(n.executive_summary):
                problems.append("executive_summary must cite the supporting papers inline, e.g. [P1]")
            if graded and abs(LEVELS.index(n.evidence_strength) - LEVELS.index(baseline)) > 1:
                problems.append(f"evidence_strength {n.evidence_strength} is more than one level away from the "
                                f"GRADE-lite baseline {baseline}")
            # Only what code could fix by deleting goes back to the model (final review finding 4): a rationale
            # that disagrees with the GRADE-lite factors is reconciled in code (reconcile_rationale), and a wrong
            # measure name before a number is rewritten in code (fix_prose); neither costs a narrative round.
            # Plan 20: refs of the key findings must be analysed papers; the answer and the statements carry no
            # numbers (deleting them could empty the bottom line, so they go back to the model). An empty answer or
            # no key findings costs no round: the report then leads with the summary.
            for i, f in enumerate(n.key_findings):
                unknown = sorted({r for r in f.refs if r not in allowed}, key=_ref_num)
                if unknown:
                    problems.append(f"key_findings[{i}].refs: unknown {', '.join(unknown)}; cite only refs that "
                                    "appear in the evidence")
            try:
                grounded = prose_problems(n.executive_summary, prose, "executive_summary", fixable=False)
                if graded:
                    grounded += prose_problems(rationale, prose, "evidence_rationale", fixable=False)
                grounded += statement_problems(n.answer, prose, "answer")
                for i, f in enumerate(n.key_findings):
                    grounded += statement_problems(f.statement, prose, f"key_findings[{i}].statement",
                                                   [r for r in f.refs if r in allowed])
            except Exception:
                log.exception("grounded-prose validation failed")
                grounded = []
            prose_rounds.append(bool(grounded))
            return problems + grounded

        factors = (matrix.get("grade") or {}).get("factors") or []
        directional = _directional(state)
        prompt_matrix = matrix
        if not directional:  # no direction-based consensus or per-cell directions reach a scoping/themes summary
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
        # outside the ticked designs or a related report of a trial: not evidence, but their cards are still shown in
        # the user's language
        outside = set(design_excluded(state)) | set(related(state))
        shown = papers + [p for p in _with_cards(state) if p["ref"] in outside and p["ref"] not in allowed]
        res, cards = await asyncio.gather(narrative_call, _localize_cards(deps, shown, language),
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
        if not directional:  # a scoping review makes no claims; themes have no direction (matrix built without them)
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
        narrative, prose_counts = _check_prose(narrative, prose, graded, factors)
        if prose_counts["check_failed"]:
            errors.append("grounded-prose check failed: the narrative summary was withheld")
        rationale_fix = None
        if graded and not entry["fallback"]:  # after every removal: what is shown must agree with the factors
            try:
                grade = matrix.get("grade") or {}
                text, rationale_fix = reconcile_rationale(narrative.evidence_rationale, factors,
                                                          grade.get("k"), grade.get("studies"))
            except Exception as exc:
                log.exception("reconcile_rationale failed")
                errors.append(f"rationale reconciliation failed: {type(exc).__name__}")
                text, rationale_fix = "; ".join(factors) or narrative.evidence_rationale, "replaced"
            if rationale_fix:
                narrative = narrative.model_copy(update={"evidence_rationale": text})
        gaps = [g for g in narrative.research_gaps if not is_placeholder(g)]  # never a "null" gap
        strength = clamp_to_baseline(narrative.evidence_strength, baseline) if graded else None
        summary = narrative.executive_summary
        certainty_added = 0
        wording = CERTAINTY_WORDING.get(strength or "")
        if wording and not entry["fallback"] and summary != PROSE_REMOVED and not wording.search(summary):
            summary, certainty_added = f"{summary} {CERTAINTY_SENTENCE[strength]}", 1
        no_pool = _no_pool(review_type, meta)
        if no_pool and not _SAYS_NO_POOL.search(summary):
            # Plan 20 Task 10: a meta-analysis that pooled nothing says so in the summary too, not only in the answer
            summary = f"{NO_POOL_ANSWER} {summary}"
            entry["no_pool_stated"] = True
        try:  # Plan 20; a crash fails closed: no model-written answer or findings (the no-pool sentence stays)
            answer, answer_removed = _bottom_line(narrative.answer, prose, allowed, no_pool=no_pool, strength=strength)
            key_findings, findings_dropped, findings_hedged = _key_findings(
                narrative.key_findings, prose, allowed, matrix.get("rows") or [], no_pool=no_pool, strength=strength)
        except Exception as exc:
            log.exception("answer/key-findings check failed")
            errors.append(f"answer check failed: {type(exc).__name__}")
            answer, answer_removed = (NO_POOL_ANSWER if no_pool else ""), 0
            key_findings, findings_dropped, findings_hedged = [], len(narrative.key_findings), 0
            prose_counts["check_failed"] += 1
        # coverage telemetry (audit I-22): analysed papers the summary never cites
        # (None when there is no model-written summary to judge: withheld or failed)
        entry["uncited"] = (None if entry["fallback"] or summary in (PROSE_REMOVED, "")
                            else len(allowed - cited_refs(summary)))
        quality.append({"stage": "prose_check", "numbers_removed": prose_counts["numbers_removed"],
                        "measures_fixed": prose_counts["measures_fixed"],
                        "measures_removed": prose_counts["measures_removed"],
                        "population_removed": prose_counts["population_removed"],
                        "certainty_added": certainty_added,
                        # Plan 20: answer sentences and key findings removed by the numberless check
                        "answer_removed": answer_removed, "key_findings_removed": findings_dropped,
                        "key_findings_hedged": findings_hedged,  # causal verbs hedged for their certainty
                        **({"check_failed": True} if prose_counts["check_failed"] else {}),
                        "rationale_fixed": rationale_fix,  # "replaced" | "appended" | None (audit I-13e)
                        # narrative rounds the grounded-prose check sent back to the model (false positives show here)
                        "repairs": sum(prose_rounds[:-1])})
        # not graded: no strength, no baseline, a fixed rationale that localizes like any other text
        synthesis = Synthesis(
            executive_summary=summary, comparison=matrix.get("rows", []),
            consensus=consensus, conflicts=conflicts, evidence_strength=strength,
            evidence_rationale=(narrative.evidence_rationale if graded else
                                NO_QUANTITATIVE_RATIONALE if no_quantitative else _not_graded_rationale(review_type)),
            research_gaps=gaps, grade_baseline=baseline if graded else None,
            answer=answer, key_findings=key_findings)
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
    # Plan 20: the answer and the key findings; a finding's outcome that is a comparison row takes the row's
    # localized name (applied in _apply_synthesis_strings), so the same outcome reads the same everywhere
    out["answer"] = s.get("answer") or ""
    rows = {r["outcome"] for r in s.get("comparison") or []}
    for i, f in enumerate(s.get("key_findings") or []):
        out[f"key_findings.{i}.statement"] = f["statement"]
        if f["outcome"] not in rows:
            out[f"key_findings.{i}.outcome"] = f["outcome"]
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
    if "answer" in out:  # absent only in hand-built or pre-Plan 20 syntheses
        out["answer"] = strings.get("answer", out["answer"])
    row_names = {r["outcome"]: strings.get(f"comparison.{i}.outcome", r["outcome"])
                 for i, r in enumerate(s.get("comparison") or [])}
    for i, f in enumerate(out.get("key_findings") or []):
        f["statement"] = strings.get(f"key_findings.{i}.statement", f["statement"])
        f["outcome"] = strings.get(f"key_findings.{i}.outcome", row_names.get(f["outcome"], f["outcome"]))
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


def _templated(synthesis: dict[str, Any], matrix: dict[str, Any]) -> dict[str, tuple[str, dict[str, Any]]]:
    """Synthesis string keys whose English text is a code template, mapped to (template kind, matrix entry), so the
    Thai text is rendered in code instead of translated (audit I-16). LLM-written text (conflict explanations)
    is not templated and still goes to the localizer."""
    out: dict[str, tuple[str, dict[str, Any]]] = {}
    consensus = {_consensus_statement(c): c for c in matrix.get("consensus") or []}
    for i, item in enumerate(synthesis.get("consensus") or []):
        c = consensus.get(item.get("statement"))
        if c is not None:
            out[f"consensus.{i}.statement"] = ("consensus_statement", c)
            if item.get("explanation") == _consensus_explanation(c):
                out[f"consensus.{i}.explanation"] = ("consensus_explanation", c)
    conflicts = {_conflict_statement(c): c for c in matrix.get("conflicts") or []}
    for i, item in enumerate(synthesis.get("conflicts") or []):
        c = conflicts.get(item.get("statement"))
        if c is not None:
            out[f"conflicts.{i}.statement"] = ("conflict_statement", c)
            if item.get("explanation") == _deterministic_note(c)["explanation"]:
                out[f"conflicts.{i}.explanation"] = ("conflict_explanation", c)
    return out


def _render_th(templated: dict[str, tuple[str, dict[str, Any]]], names: dict[str, str]) -> dict[str, str]:
    """The Thai text of each templated key; `names` maps English outcome names to their localized row names."""
    out = {}
    for key, (kind, c) in templated.items():
        outcome = names.get(c["outcome"], c["outcome"])
        if kind == "consensus_statement":
            out[key] = _consensus_statement(c, outcome, "th")
        elif kind == "consensus_explanation":
            out[key] = _consensus_explanation_th(c, outcome)
        elif kind == "conflict_statement":
            out[key] = _conflict_statement(c, outcome, "th")
        else:
            out[key] = _deterministic_explanation_th(c, outcome)
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
        templated = _templated(synthesis, state.get("matrix") or {}) if language == "th" else {}
        strings = {k: v for k, v in _synthesis_strings(synthesis).items() if k not in templated}
        errors: list[str] = []
        try:
            res = await localize_strings(llm, harness_runner(deps), strings, language)
        except LLMError as exc:
            res = Localized(strings, kept_english=len(strings),
                            untranslated=sum(1 for v in strings.values() if untranslated(v, v, language)))
            errors.append(f"localization failed: {type(exc).__name__}")
        names = {row["outcome"]: res.strings.get(f"comparison.{j}.outcome", row["outcome"])
                 for j, row in enumerate(synthesis.get("comparison") or [])}
        localized = {**res.strings, **_render_th(templated, names)}
        display = _apply_synthesis_strings(synthesis, localized, _finding_map(state))
        return {"synthesis_display": display, "cost_usd": res.cost, "errors": errors,
                "quality": [{"stage": "localize", "items": len(strings), "templated": len(templated),
                             **res.telemetry(), "seconds": round(time.perf_counter() - started, 3)}]}

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


def _iso(epoch: Any) -> str | None:
    if not isinstance(epoch, int | float):
        return None
    return datetime.fromtimestamp(epoch, UTC).isoformat(timespec="seconds")


def _methods(state: ReviewState, deps, models: dict[str, str]) -> dict[str, Any]:
    """result.methods (Plan 20): what the Methods section reports and the rest of the result does not already hold.
    The queries stay in result.queries, the full role → model map in result.models, the counts in result.stats."""
    options = ReviewOptions.clamped(state.get("options"))
    stats = state.get("search_stats") or {}
    plan = state.get("plan") or {}
    spec = harness_spec(deps)
    llms = deps.llms
    secondary = getattr(getattr(llms, "screener_secondary", None), "model", None)
    # what the screening batches logged (Task 1 review finding 7); derived from the models when nothing was logged
    logged = {q.get("second_vote") for q in state.get("quality") or []
              if q.get("stage") == "screen" and q.get("second_vote")}
    second_vote = (next(iter(logged)) if len(logged) == 1
                   else "off" if secondary is None
                   else "same_model" if secondary == getattr(getattr(llms, "screener", None), "model", 0)
                   else "two_models")
    per_source = stats.get("per_source")
    floor = min(spec.screen_borderline or (MIN_INCLUDE_RELEVANCE,))
    return {
        "searched_at": stats.get("searched_at") or _iso(state.get("started_at")),
        "sources": dict(per_source) if isinstance(per_source, dict) else None,  # null: not recorded
        "eligibility": {"year_from": options.year_from, "study_types": list(options.study_types or []),
                        "inclusion_criteria": list(plan.get("inclusion_criteria") or []),
                        "exclusion_criteria": list(plan.get("exclusion_criteria") or [])},
        "limits": {"candidate_limit": options.candidate_limit, "max_papers": options.max_papers,
                   "min_abstract_chars": MIN_ABSTRACT_CHARS},
        "screening": {"model": models.get("screener") or None,
                      "second_model": models.get("screener_secondary") if second_vote == "two_models" else None,
                      "second_vote": second_vote, "borderline": list(spec.screen_borderline),
                      "relevance_floor": floor},
        "extraction": {"model": models.get("extractor") or None,
                       "second_model": (models.get("extractor_secondary") or None) if spec.dual_extraction else None,
                       "verify_quotes": spec.verify_quotes, "quote_match_threshold": spec.quote_match_threshold,
                       "text": "abstract"},
        "synthesis": {"model": models.get("synthesizer") or None,
                      "pooling": ("DerSimonian-Laird random effects"
                                  if options.review_type == "meta_analysis" else None),
                      "grading": "GRADE-lite" if options.review_type in SLR_LIKE else None},
    }


def make_finalize(deps):
    async def finalize(state: ReviewState) -> dict:
        papers = unique_papers(state)
        language = state.get("language", "th")
        synthesis_en = state.get("synthesis") or _empty_synthesis(NO_PAPERS["en"], _review_type(state))
        synthesis = state.get("synthesis_display") or synthesis_en
        localized = state.get("localized_cards") or {}
        linked = related(state)  # Plan 20 Task 10: reports of the same trial
        reports: dict[str, list[str]] = {}
        for ref, link in linked.items():
            reports.setdefault(link["primary"], []).append(ref)
        out_papers = []
        for p in papers:
            c = p["candidate"]
            link = linked.get(p["ref"]) or {}
            out_papers.append({
                "ref": p["ref"], "title": c["title"], "authors": c.get("authors") or [], "year": c.get("year"),
                "journal": c.get("journal"), "doi": c.get("doi"), "pmid": c.get("pmid"), "pmcid": c.get("pmcid"),
                "url": c.get("url"), "relevance": p.get("relevance"), "screen_reason": p.get("screen_reason"),
                "card": localized.get(p["ref"]) or p.get("card"), "card_en": p.get("card"),
                "verification": p.get("verification"), "error": p.get("error"),
                "related_to": link.get("primary"), "related_reason": link.get("reason"),
                "related_reports": sorted(reports.get(p["ref"], []), key=_ref_num),
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
                "year_excluded": stats.get("year_excluded", 0), "no_abstract": stats.get("no_abstract", 0),
                "excluded_screening": dict(selection.get("excluded_screening") or {}),
                "excluded_selection": {"narrative_excluded": selection.get("narrative_excluded", 0),
                                       "over_limit": selection.get("over_limit", 0),
                                       "study_design_relaxed": selection.get("study_design_relaxed", 0),
                                       # read as a design outside the ticked types after selection: not evidence
                                       "study_design_corrected": len(design_excluded(state)),
                                       "low_relevance": selection.get("low_relevance", 0),
                                       # Plan 20 Task 10: themes reviews, papers that never name the focus
                                       "off_focus": selection.get("off_focus", 0)},
                # Plan 20 Task 10: analysed papers that are further reports of a trial already analysed (PRISMA
                # 2020 counts studies and reports apart); they are linked to its primary report, not evidence
                "related_reports": len(linked),
            },
            "quality": summarize_quality(state.get("quality") or [], state.get("started_at")),
            "errors": list(state.get("errors") or []), "prompt_version": deps.settings.prompt_version,
            "llm_preset": getattr(llms, "preset", ""), "models": models,
            "external_context": [{"tool": e["tool"], "arguments": e["arguments"], "ok": e["ok"],
                                  "preview": (e.get("text") or e.get("error") or "")[:500]}
                                 for e in state.get("external_context") or []],
            "citations": state.get("citations"),
            "meta_analysis": _meta_result(state, synthesis_en, synthesis),
            "methods": _methods(state, deps, models),
        }
        progress_writer()({"type": "finalizing"})
        return {"result": result}

    return finalize
