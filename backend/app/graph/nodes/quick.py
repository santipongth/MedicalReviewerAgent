"""Plan 27: the quick answer ("ถามเร็ว"). For mode "quick" it takes the place of explain_conflict and
write_synthesis: one call writes 2-4 English sentences that cite only the papers read, plus one sentence on the main
limitation; code checks the citations, the numbers and the populations (app.harness.prose: a number stays only when a
cited card verified it), and adds the certainty sentence of the GRADE-lite baseline (computed in code, never by the
model). The answer is stored in the Synthesis shape (`executive_summary` = the answer, `answer` = the closing
certainty-and-limits line), so localize, check_support and finalize run unchanged."""
from __future__ import annotations

import logging
import time
from typing import Any

from app.graph import prompts
from app.graph.nodes.intake import harness_spec, review_question
from app.graph.nodes.synthesis import (
    _CITE_GROUP,
    _CITED,
    ANSWER_CERTAINTY,
    NO_QUANTITATIVE_RATIONALE,
    _brief,
    _direction_papers,
    _drop_wrong_self_claims,
    _empty_synthesis,
    _narrative_papers,
    _prose_context,
    _review_type,
    _split_sentences,
    empty_messages,
)
from app.graph.schemas import QuickAnswerDraft, Synthesis
from app.graph.state import ReviewState
from app.harness.prose import (
    ProseContext,
    fix_prose,
    fix_statement,
    prose_problems,
    statement_problems,
)
from app.harness.runner import HarnessRunner
from app.harness.verify import check_citations, strip_unknown_citations
from app.services.llm import LLMError

log = logging.getLogger(__name__)

MIN_SENTENCES, MAX_SENTENCES = 2, 4
MAX_REPAIRS = 1  # latency: one repair round at most, no escalation; code removes what still fails
QUICK_WITHHELD = ("No short answer could be written that the verified abstracts support. The studies read are listed "
                  "below; a full review may help.")
QUICK_FAILED = ("The quick answer could not be written (a temporary model or service problem). The studies read are "
                "listed below; please try again later.")
NOT_GRADED = "The certainty of the evidence is not graded: the studies read report themes, not effects."


def draft_problems(draft: QuickAnswerDraft, allowed: set[str], prose: ProseContext) -> list[str]:
    """Repair messages for a quick answer draft: 2-4 sentences, each citing a paper read; no unknown citation; no
    number, measure or population the cited cards do not support; a limits sentence without citations or numbers."""
    sentences = [s.strip() for s in draft.sentences if s.strip()]
    problems: list[str] = []
    if not MIN_SENTENCES <= len(sentences) <= MAX_SENTENCES:
        problems.append(f"sentences: write {MIN_SENTENCES}-{MAX_SENTENCES} sentences (got {len(sentences)})")
    problems += check_citations(" ".join(sentences), allowed)
    for i, s in enumerate(sentences):
        if not _CITED.search(s):
            problems.append(f"sentences[{i}] cites no paper; end it with the refs that support it, e.g. [P1]")
        problems += prose_problems(s, prose, f"sentences[{i}]", fixable=False)
    if _CITED.search(draft.limits or ""):
        problems.append("limits must not cite papers")
    problems += statement_problems(draft.limits or "", prose, "limits")
    return problems


def checked_answer(draft: QuickAnswerDraft, allowed: set[str], prose: ProseContext,
                   strength: str | None) -> tuple[str, int, int]:
    """The shown answer, item by item: unknown citations stripped, measure names corrected, every sentence with an
    untraceable number or population removed (fix_prose), a self-claim of another certainty level for this review
    removed; an item left without a citation is dropped; at most MAX_SENTENCES items. Returns (answer, items kept,
    items removed)."""
    kept: list[str] = []
    removed = 0
    for raw in draft.sentences:
        text = strip_unknown_citations(raw.strip(), allowed)
        if not text:
            continue
        fixed, _counts = fix_prose(text, prose)
        # a claim of another certainty level (or a wrong-level label) for this review takes its item with it; the
        # patterns read the text without its [Pn] groups
        wrong_level = _drop_wrong_self_claims(_CITE_GROUP.sub("", fixed), strength)[1] > 0
        if fixed.strip() and _CITED.search(fixed) and not wrong_level:
            kept.append(fixed.strip())
        else:
            removed += 1
    removed += max(0, len(kept) - MAX_SENTENCES)
    kept = kept[:MAX_SENTENCES]
    return " ".join(kept), len(kept), removed


def closing_line(limits: str, prose: ProseContext, strength: str | None) -> str:
    """The certainty sentence (the GRADE-lite baseline, or "not graded") and the model's limits sentence when it
    passes the numberless check (its first sentence, without citations)."""
    text, _counts = fix_statement(_CITE_GROUP.sub("", limits or "").strip(), prose)
    text, _n = _drop_wrong_self_claims(text, strength)
    first = next(iter(_split_sentences(text)), "")
    certainty = ANSWER_CERTAINTY.get(strength or "", NOT_GRADED)
    return f"{certainty} {first}".strip()


def make_write_quick_answer(deps):
    async def write_quick_answer(state: ReviewState) -> dict:
        started = time.perf_counter()
        language = state.get("language", "th")
        papers = _narrative_papers(state)
        if not papers:
            messages = empty_messages(state)
            return {"synthesis": _empty_synthesis(messages["en"]),
                    "synthesis_display": _empty_synthesis(messages.get(language, messages["en"])),
                    "localized_cards": None, "quality": [{"stage": "quick", "skipped": True, "seconds": 0.0}]}
        matrix = state.get("matrix") or {}
        grade = matrix.get("grade") or {}
        graded = bool(_direction_papers(state))  # qualitative/mixed-methods only: themes, not graded
        baseline = grade.get("level", "very_low")
        strength = baseline if graded else None
        allowed = {p["ref"] for p in papers}
        prose = _prose_context(state, papers, matrix, None)
        user = prompts.quick_user(question=review_question(state), papers=[_brief(p) for p in papers],
                                  baseline=grade if graded else None)
        llm = deps.llms.with_schema("synthesizer", QuickAnswerDraft)
        runner = HarnessRunner(max_repairs=min(MAX_REPAIRS, harness_spec(deps).max_repairs))
        entry: dict[str, Any] = {"stage": "quick", "repaired": False, "fallback": False, "sentences": 0,
                                 "removed": 0, "withheld": False}
        cost, errors = 0.0, []
        try:
            res = await runner.call(llm, prompts.QUICK_SYSTEM, user, schema=QuickAnswerDraft,
                                    validate=lambda d: draft_problems(d, allowed, prose), trigger="quick")
            cost, draft = res.cost, res.value
            entry["repaired"] = res.repaired
        except LLMError as exc:
            errors.append(f"quick answer failed: {type(exc).__name__}: {exc}")
            draft = None
        if draft is None:
            entry["fallback"] = True
            answer, closing = QUICK_FAILED, ANSWER_CERTAINTY.get(strength or "", NOT_GRADED)
        else:
            try:
                answer, entry["sentences"], entry["removed"] = checked_answer(draft, allowed, prose, strength)
                closing = closing_line(draft.limits, prose, strength)
            except Exception as exc:  # the check fails closed: no model-written text is shown
                log.exception("quick answer check failed")
                errors.append(f"quick answer check failed: {type(exc).__name__}")
                answer, closing = "", ANSWER_CERTAINTY.get(strength or "", NOT_GRADED)
            if not answer:
                answer, entry["withheld"] = QUICK_WITHHELD, True
        synthesis = Synthesis(
            executive_summary=answer, comparison=[], consensus=[], conflicts=[], evidence_strength=strength,
            evidence_rationale=("; ".join(grade.get("factors") or []) if graded else NO_QUANTITATIVE_RATIONALE),
            research_gaps=[], grade_baseline=baseline if graded else None, answer=closing, key_findings=[])
        entry |= {"review_type": _review_type(state), "seconds": round(time.perf_counter() - started, 3)}
        return {"synthesis": synthesis.model_dump(), "localized_cards": None, "cost_usd": cost, "errors": errors,
                "quality": [entry]}

    return write_quick_answer
