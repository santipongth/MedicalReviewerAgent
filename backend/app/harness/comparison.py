"""Comparison-aware evidence (Plan 19, audit I-2a).

An abstract often reports estimates for comparisons other than the review's intervention vs comparator: a GLP-1
receptor agonist vs insulin in a metformin review, or the association of an eGFR decline with outcomes inside an
SGLT2 trial. Such an estimate is not evidence for the question. The extractor states each outcome's `comparison` and
`matches_question`; `matches_question=false` outcomes ("other comparisons") stay on the card but never reach the
matrix, consensus, conflicts, pools or grade.

The model's flag is the primary signal. `settle_comparisons` adds one conservative deterministic backstop. It flips
an outcome to `matches_question=false` only when the comparison text names a specific agent that is recognisably
outside the question's intervention: a drug class word or an INN stem from `_FAMILY_WORDS` / `_FAMILY_SUFFIXES`
("insulin", "GLP-1", "...gliflozin", "...gliptin") whose family the question does not name, while neither the
comparison nor the card's intervention names the question's intervention (its words, key-term synonyms or drug
family). An unknown word is never evidence of another agent: a brand name ("Glucophage"), an abbreviation ("DMBG")
or no agent at all ("users vs nonusers", "eGFR decline >10% vs <=10%") never flips. The backstop never flips an
outcome to true and is skipped when there is no refined question.
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

# Recognisable agents: whole words and INN stems, each with its drug family. Only these can make the backstop flip.
_FAMILY_WORDS = {
    "metformin": "biguanide", "biguanide": "biguanide", "biguanides": "biguanide",
    "insulin": "insulin", "insulins": "insulin",
    "sulfonylurea": "sulfonylurea", "sulfonylureas": "sulfonylurea", "sulphonylurea": "sulfonylurea",
    "sulphonylureas": "sulfonylurea", "glipizide": "sulfonylurea", "glimepiride": "sulfonylurea",
    "glibenclamide": "sulfonylurea", "gliclazide": "sulfonylurea", "glyburide": "sulfonylurea",
    "glp": "glp1", "glp1": "glp1", "incretin": "glp1", "exenatide": "glp1", "lixisenatide": "glp1",
    "sglt2": "sglt2", "sglt": "sglt2", "dpp": "dpp4", "dpp4": "dpp4",
    "thiazolidinedione": "tzd", "thiazolidinediones": "tzd", "acarbose": "agi",
    "statin": "statin", "statins": "statin", "aspirin": "aspirin", "warfarin": "vka",
}
_FAMILY_SUFFIXES = (
    ("gliflozin", "sglt2"), ("gliptin", "dpp4"), ("glutide", "glp1"), ("glitazone", "tzd"), ("glinide", "glinide"),
    ("formin", "biguanide"), ("statin", "statin"), ("pril", "acei"), ("sartan", "arb"), ("olol", "beta_blocker"),
    ("dipine", "ccb"), ("xaban", "doac"), ("gatran", "doac"), ("parin", "heparin"), ("prazole", "ppi"),
    ("tinib", "kinase_inhibitor"), ("platin", "platinum"), ("taxel", "taxane"), ("floxacin", "quinolone"),
    ("cillin", "penicillin"), ("mycin", "macrolide"), ("cycline", "tetracycline"), ("zumab", "antibody"),
    ("ximab", "antibody"), ("mumab", "antibody"),
)


def _family(word: str) -> str | None:
    if word in _FAMILY_WORDS:
        return _FAMILY_WORDS[word]
    return next((family for suffix, family in _FAMILY_SUFFIXES if word.endswith(suffix) and len(word) > len(suffix)),
                None)


def _words(text: str | None) -> list[str]:
    return [w for w in _WORD.findall((text or "").lower()) if len(w) >= 3 and w not in _GENERIC]


def _stems(text: str | None) -> set[str]:
    return {w[:5] for w in _words(text)}


def _families(text: str | None) -> set[str]:
    return {f for w in _words(text) if (f := _family(w))}


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


def _question_families(question: dict[str, Any] | None) -> set[str]:
    q = question or {}
    families = _families(q.get("intervention_or_exposure"))
    own = _stems(q.get("intervention_or_exposure"))
    for term in q.get("key_terms") or []:
        names = " ".join([term.get("term") or "", term.get("mesh") or "", *(term.get("synonyms") or [])])
        if _stems(names) & own:
            families |= _families(names)
    return families


def answers_question(outcome: dict[str, Any]) -> bool:
    """False only for an outcome flagged as another comparison (outcomes stored before Plan 19 count as matching)."""
    return outcome.get("matches_question", True) is not False


def other_agent(comparison: str | None, intervention: str | None, question: dict[str, Any] | None) -> str | None:
    """The recognised agent outside the question's intervention that `comparison` names, when the comparison and the
    card's intervention name nothing of the question's intervention; None otherwise (no flip)."""
    lexicon = intervention_lexicon(question)
    if not lexicon or not comparison:
        return None
    families = _question_families(question)

    def names_question(text: str | None) -> bool:
        return bool(_stems(text) & lexicon or _families(text) & families)

    if names_question(comparison) or names_question(intervention):
        return None
    return next((w for w in _words(comparison) if (f := _family(w)) and f not in families), None)


def settle_comparisons(card: PaperCard, question: dict[str, Any] | None,
                       review_type: str = "slr") -> tuple[PaperCard, int]:
    """Apply the deterministic backstop. Returns (card, outcomes flipped to other comparisons). A scoping review
    maps every aspect and has no comparison, so its outcomes always match."""
    if review_type == "scoping":
        if all(o.matches_question for o in card.outcomes):
            return card, 0
        return card.model_copy(update={"outcomes": [o.model_copy(update={"matches_question": True})
                                                    for o in card.outcomes]}), 0
    flipped = 0
    outcomes = []
    for o in card.outcomes:
        if o.matches_question and other_agent(o.comparison, card.intervention_or_exposure, question):
            o = o.model_copy(update={"matches_question": False})
            flipped += 1
        outcomes.append(o)
    update: dict[str, Any] = {"outcomes": outcomes} if flipped else {}
    direction = question_direction(outcomes, card.overall_direction)
    if direction != card.overall_direction:
        update["overall_direction"] = direction
    return (card.model_copy(update=update) if update else card), flipped


def question_direction(outcomes: list[Any], overall: str) -> str:
    """The card's overall direction as evidence for the question (final review finding 3). A card with other
    comparisons wrote its overall direction partly or wholly for them ("positive" for GLP-1RA vs insulin in a
    metformin review), so it is derived again from the matching outcomes only: "unclear" when none matches, their
    shared direction when they agree, "mixed" when they do not. A card without other comparisons keeps the model's
    overall direction."""
    matching = [o for o in outcomes if o.matches_question]
    if len(matching) == len(outcomes):
        return overall
    if not matching:
        return "unclear"
    directions = {o.direction for o in matching} - {"unclear"}
    if not directions:
        return "unclear"
    return directions.pop() if len(directions) == 1 else "mixed"


def question_card(card: dict[str, Any]) -> dict[str, Any] | None:
    """The card restricted to the outcomes that answer the question; None when it reports outcomes and none of them
    do (the paper is then no evidence for the question). A card without outcomes is kept as it is."""
    outcomes = card.get("outcomes") or []
    kept = [o for o in outcomes if answers_question(o)]
    if outcomes and not kept:
        return None
    return card if len(kept) == len(outcomes) else {**card, "outcomes": kept}
