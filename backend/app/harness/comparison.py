"""Comparison-aware evidence (Plan 19, audit I-2a).

An abstract often reports estimates for comparisons other than the review's intervention vs comparator: a GLP-1
receptor agonist vs insulin in a metformin review, or the association of an eGFR decline with outcomes inside an
SGLT2 trial. Such an estimate is not evidence for the question. The extractor states each outcome's `comparison` and
`matches_question`; `matches_question=false` outcomes ("other comparisons") stay on the card but never reach the
matrix, consensus, conflicts, pools or grade.

The model's flag is the primary signal. `settle_comparisons` adds one conservative deterministic backstop: when the
refined question names its intervention, an outcome whose comparison text and whose card's intervention both name
none of the intervention's words (or its key-term synonyms) cannot be about that intervention, so it is flipped to
`matches_question=false`. Drug classes are covered by the key-term synonyms ("SGLT2 inhibitors": dapagliflozin,
empagliflozin). The backstop never flips an outcome to true, and it is skipped when there is no refined question.
"""
from __future__ import annotations

import re
from typing import Any

from app.graph.schemas import PaperCard

# Words that say nothing about which intervention is meant (and drug-class suffixes shared by unrelated classes).
_GENERIC = {
    "therapy", "therapies", "treatment", "treatments", "treated", "use", "users", "user", "using", "long", "term",
    "short", "prescription", "prescribed", "intake", "dose", "doses", "dosing", "daily", "once", "twice", "oral",
    "inhibitor", "inhibitors", "agonist", "agonists", "antagonist", "antagonists", "blocker", "blockers",
    "receptor", "receptors", "drug", "drugs", "medication", "medications", "agent", "agents", "exposure",
    "exposed", "intervention", "interventions", "the", "and", "with", "for", "plus", "add", "standard", "care",
    "usual", "initiation", "initiated", "new", "current", "ever", "never", "any", "high", "low", "level", "levels",
    "patients", "adults", "people", "mg", "kg", "day", "week", "weeks", "per", "group", "groups", "arm", "versus",
    "compared", "other", "non", "based", "related", "associated", "prior", "pre", "post", "diagnostic",
}
_WORD = re.compile(r"[a-z][a-z0-9]+")


def _stems(text: str | None) -> set[str]:
    return {w[:5] for w in _WORD.findall((text or "").lower()) if len(w) >= 3 and w not in _GENERIC}


def intervention_lexicon(question: dict[str, Any] | None) -> set[str]:
    """Word stems naming the review's intervention/exposure: its own words plus the synonyms and MeSH heading of each
    key term that shares a word with it. Empty when the question was not refined (the backstop is then skipped)."""
    q = question or {}
    own = _stems(q.get("intervention_or_exposure"))
    if not own:
        return set()
    lexicon = set(own)
    for term in q.get("key_terms") or []:
        names = [term.get("term") or "", term.get("mesh") or "", *(term.get("synonyms") or [])]
        stems = set().union(*(_stems(n) for n in names))
        if stems & own:
            lexicon |= stems
    return lexicon


def answers_question(outcome: dict[str, Any]) -> bool:
    """False only for an outcome flagged as another comparison (outcomes stored before Plan 19 count as matching)."""
    return outcome.get("matches_question", True) is not False


def settle_comparisons(card: PaperCard, question: dict[str, Any] | None,
                       review_type: str = "slr") -> tuple[PaperCard, int]:
    """Apply the deterministic backstop. Returns (card, outcomes flipped to other comparisons). A scoping review
    maps every aspect and has no comparison, so its outcomes always match."""
    if review_type == "scoping":
        if all(o.matches_question for o in card.outcomes):
            return card, 0
        return card.model_copy(update={"outcomes": [o.model_copy(update={"matches_question": True})
                                                    for o in card.outcomes]}), 0
    lexicon = intervention_lexicon(question)
    if not lexicon or _stems(card.intervention_or_exposure) & lexicon:
        return card, 0
    flipped = 0
    outcomes = []
    for o in card.outcomes:
        if o.matches_question and o.comparison and not _stems(o.comparison) & lexicon:
            o = o.model_copy(update={"matches_question": False})
            flipped += 1
        outcomes.append(o)
    return (card.model_copy(update={"outcomes": outcomes}) if flipped else card), flipped


def question_card(card: dict[str, Any]) -> dict[str, Any] | None:
    """The card restricted to the outcomes that answer the question; None when it reports outcomes and none of them
    do (the paper is then no evidence for the question). A card without outcomes is kept as it is."""
    outcomes = card.get("outcomes") or []
    kept = [o for o in outcomes if answers_question(o)]
    if outcomes and not kept:
        return None
    return card if len(kept) == len(outcomes) else {**card, "outcomes": kept}
