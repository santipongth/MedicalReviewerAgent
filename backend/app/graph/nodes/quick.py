"""Plan 27: the quick answer ("ถามเร็ว"). For mode "quick" it takes the place of explain_conflict and
write_synthesis: one call writes 2-4 English sentences that cite only the papers read, plus one sentence on the main
limitation; code checks the citations, the numbers and the populations (app.harness.prose: a number stays only when a
cited card verified it), and adds the certainty sentence of the GRADE-lite baseline (computed in code, never by the
model). The answer is stored in the Synthesis shape (`executive_summary` = the answer, `answer` = the closing
certainty-and-limits line), so localize, check_support and finalize run unchanged."""
from __future__ import annotations

import logging
import re
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
    _drop_wrong_labels,
    _drop_wrong_self_claims,
    _empty_synthesis,
    _narrative_papers,
    _prose_context,
    _review_type,
    _split_sentences,
    _wrong_self_claim,
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
QUICK_WITHHELD = ("No short answer could be written that the verified abstracts support. A full review of this "
                  "question may help.")
QUICK_FAILED = ("The quick answer could not be written (a temporary model or service problem). A full review of this "
                "question may help.")
NOT_GRADED = "The certainty of the evidence is not graded: the studies read report themes, not effects."


_CITES_AFTER_STOP = re.compile(r"^(?P<body>.*?)(?P<stop>[.!?])\s*(?P<cites>(?:\s*\[\s*P\d+[^\]]*\])+)\s*$", re.DOTALL)


def _cite_inside_stop(sentence: str) -> str:
    """"Risk was lower (HR 0.55). [P1]" -> "Risk was lower (HR 0.55) [P1].": the prose checks split a text before every
    "[", so a citation after the stop would leave its claim looking uncited (and in scope of every paper)."""
    m = _CITES_AFTER_STOP.match(sentence)
    return f"{m['body'].rstrip()} {m['cites'].strip()}{m['stop']}" if m else sentence


_LEADING_CITES = re.compile(r"^(?:\s*\[\s*P\d+[^\]]*\])+")


def _sentences(items: list[str]) -> list[str]:
    """The sentences of the draft's items (an item may hold several): every check below is per sentence, so a sentence
    is judged by its own citations and never by those of its neighbour. A citation after the final stop ("... risk.
    [P1]") belongs to the sentence before it; a piece with nothing but citations is no sentence."""
    out: list[str] = []
    for item in items:
        mine: list[str] = []
        for piece in _split_sentences(item.strip()):
            lead = _LEADING_CITES.match(piece)
            if lead and mine:
                mine[-1] = f"{mine[-1]} {lead.group(0).strip()}"
                piece = piece[lead.end():]
            if re.sub(r"[\W_]+", "", _CITE_GROUP.sub("", piece)):
                mine.append(piece.strip())
            elif piece.strip() and mine:
                mine[-1] = f"{mine[-1]} {piece.strip()}"
        out += [_cite_inside_stop(m) for m in mine]
    return out


_LVL = r"(?:very[- ]low|low|moderate|high)"
# Any mention of a certainty level, broad on purpose: the closing line always states the computed level, so the model
# never needs to (spec 2). Ordinary words stay ("high blood pressure", "low-dose", "high-risk", "low back pain").
_LEVEL_MENTION = re.compile(
    rf"(?i)\b{_LVL}[- ](?:certainty|confidence)\b"
    rf"|\b{_LVL}[- ]quality[- ](?:of[- ])?evidence\b"
    rf"|\b(?:certainty|quality|confidence|strength)\s+(?:of|in)\s+(?:the\s+|this\s+|that\s+)?(?:body\s+of\s+)?"
    rf"(?:evidence|estimates?|findings?|results?)\b"
    rf"|\bevidence\s+(?:is|was|remains?)\s+(?:generally\s+|overall\s+)?of\s+{_LVL}\s+(?:quality|certainty)\b"
    rf"|\bcertainty\b\W+(?:\w+\W+){{0,3}}?{_LVL}\b"
    rf"|\bevidence\b[^.;:!?]{{0,30}}\b(?:is|was|were|remains?|rated|graded|appears?)\b[^.;:!?]{{0,20}}?"
    rf"\b{_LVL}\s*(?=[.;,:!)]|$)")
_GRADE_LABEL = re.compile(r"\bGRADE\b")  # case-sensitive: "grade 3 toxicity" is ordinary
# The limits sentence must not discuss certainty or evidence quality at all (the computed sentence covers it).
_CERTAINTY_TALK = re.compile(
    r"(?i)\bcertainty\b|\bconfidence\s+(?:in|level)\b|\b(?:evidence|body of evidence)\s+quality\b"
    r"|\bquality\s+of\s+(?:the\s+|this\s+)?(?:body\s+of\s+)?evidence\b|\bstrength\s+of\s+(?:the\s+)?evidence\b")


# Plan 30: direct advice to a person ("Patients should stop…", "Take X…", "you should…") is never a limits sentence;
# such a sentence is dropped like a certainty claim (fail-safe: the next clean sentence, else none). Research wording
# ("patients should be followed up longer in future trials") is not advice: the verbs are the ones a person acts on.
_ACT = r"(?:stop|start|take|avoid|switch|use|ask|consult|see|talk|discuss|continue|keep|try|reduce|increase)"
_ADVICE = re.compile(
    rf"(?i)^\W*(?:please\s+)?(?:{_ACT}|do\s+not|don'?t|never|always\s+{_ACT})\b(?!-|\s+of\b)"
    rf"|\b(?:you|your|yourself)\b"
    rf"|\b(?:patients?|people|readers?|anyone|everyone|adults|parents)\s+(?:should|must|need\s+to|ought\s+to)"
    rf"\s+(?:not\s+)?{_ACT}\b")


def _claims_level(sentence: str, strength: str | None) -> bool:
    """The sentence (read without its [Pn] groups) mentions a certainty level for the evidence (any level: the closing
    line states the computed one, so a model-stated level is never needed), or claims another level than `strength`
    with the full review's narrower detectors (Plan 27 spec 2)."""
    text = _CITE_GROUP.sub("", sentence)
    if _LEVEL_MENTION.search(text) or _GRADE_LABEL.search(text):
        return True
    if strength:
        return _drop_wrong_self_claims(text, strength)[1] > 0
    return _wrong_self_claim(text, "") or _drop_wrong_labels(text, "")[1] > 0


def draft_problems(draft: QuickAnswerDraft, allowed: set[str], prose: ProseContext) -> list[str]:
    """Repair messages for a quick answer draft: 2-4 sentences, each citing a paper read; no unknown citation; no
    number, measure or population the cited cards do not support (checked per sentence, against its own citations); a
    limits sentence without citations or numbers."""
    sentences = _sentences(draft.sentences)
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
    """The shown answer, sentence by sentence: unknown citations stripped; a sentence left without a citation is
    dropped; measure names corrected and every sentence with an untraceable number or population removed (fix_prose,
    scoped to the sentence's own citations); a sentence claiming another certainty level for this review (any level
    when ungraded) removed; at most MAX_SENTENCES sentences. Returns (answer, sentences kept, sentences removed)."""
    kept: list[str] = []
    removed = 0
    for text in _sentences([strip_unknown_citations(raw.strip(), allowed) for raw in draft.sentences]):
        if not _CITED.search(text):
            removed += 1
            continue
        fixed, _counts = fix_prose(text, prose)
        if fixed.strip() and _CITED.search(fixed) and not _claims_level(fixed, strength):
            kept.append(fixed.strip())
        else:
            removed += 1
    removed += max(0, len(kept) - MAX_SENTENCES)
    kept = kept[:MAX_SENTENCES]
    return " ".join(kept), len(kept), removed


def closing_line(limits: str, prose: ProseContext, strength: str | None) -> str:
    """The certainty sentence (the GRADE-lite baseline, or "not graded") and the model's limits sentence when it
    passes the numberless check (its first sentence that says nothing about certainty or evidence quality, without
    citations, and (Plan 30) no direct advice to a person)."""
    text, _counts = fix_statement(_CITE_GROUP.sub("", limits or "").strip(), prose)
    text, _n = _drop_wrong_self_claims(text, strength)
    first = next((s for s in _split_sentences(text)
                  if not _claims_level(s, strength) and not _CERTAINTY_TALK.search(s) and not _ADVICE.search(s)), "")
    certainty = ANSWER_CERTAINTY.get(strength or "", NOT_GRADED)
    return f"{certainty} {first}".strip()


def _no_papers(message: str) -> dict[str, Any]:
    """Nothing was read: the message is the answer, said once; no closing line and no certainty (zero studies)."""
    out = _empty_synthesis(message)
    return out | {"answer": "", "evidence_strength": None, "grade_baseline": None}


def make_write_quick_answer(deps):
    async def write_quick_answer(state: ReviewState) -> dict:
        started = time.perf_counter()
        language = state.get("language", "th")
        papers = _narrative_papers(state)
        if not papers:
            messages = empty_messages(state)
            return {"synthesis": _no_papers(messages["en"]),
                    "synthesis_display": _no_papers(messages.get(language, messages["en"])),
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
            def validate(d: QuickAnswerDraft) -> list[str]:
                try:
                    return draft_problems(d, allowed, prose)
                except Exception:  # a checker crash must not fail the review; checked_answer fails closed below
                    log.exception("quick answer validation failed")
                    return []

            res = await runner.call(llm, prompts.QUICK_SYSTEM, user, schema=QuickAnswerDraft,
                                    validate=validate, trigger="quick")
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
