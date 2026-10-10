"""One place that knows what each canonical study type (the scope form's step 3) means.

- Refinement: a canonical name is satisfied by any of its synonyms in the refined `study_designs`.
- Screening and selection: a canonical name maps to the DesignCategory values it admits. "Other: ..." entries are
  free text (data, never an instruction) and are never enforced.
"""
from __future__ import annotations

import re
from typing import Any

from app.schemas.review import STUDY_TYPES

_SR_MA = frozenset({"sr_ma_rct", "sr_ma_observational", "sr_ma_mixed"})

# canonical name -> DesignCategory values it admits. A systematic review or meta-analysis is admitted only when
# "Systematic review" / "Meta-analysis" is ticked, never by "RCT" alone. Unknown designs (None, "other") are not here
# and are treated as undecided, not as a mismatch.
DESIGNS_FOR_TYPE: dict[str, frozenset[str]] = {
    "RCT": frozenset({"rct"}),
    "Cohort": frozenset({"cohort"}),
    "Case-control": frozenset({"case_control"}),
    "Cross-sectional": frozenset({"cross_sectional"}),
    "Non-randomized trial": frozenset({"non_randomized_trial"}),
    "Qualitative": frozenset({"qualitative"}),
    "Mixed methods": frozenset({"mixed_methods"}),
    "Systematic review": _SR_MA,
    "Meta-analysis": _SR_MA,
}

# canonical name -> loose (lower-case alphanumeric, -ise spelled -ize) substrings of a refined study design.
SYNONYMS: dict[str, tuple[str, ...]] = {
    "RCT": ("rct", "randomizedcontrolled", "randomizedtrial", "randomizedclinicaltrial"),
    "Cohort": ("cohort",),
    "Case-control": ("casecontrol",),
    "Cross-sectional": ("crosssectional",),
    "Non-randomized trial": ("nonrandomized", "quasiexperimental", "quasirandomized", "singlearm", "nonrct"),
    "Qualitative": ("qualitative",),
    "Mixed methods": ("mixedmethod",),
    "Systematic review": ("systematicreview",),
    "Meta-analysis": ("metaanalys",),
}
_UNDECIDED = {None, "", "other"}


def loose(text: str) -> str:
    """Case-, hyphen-, space- and -ise/-ize-insensitive form."""
    return "".join(ch for ch in text.lower() if ch.isalnum()).replace("randomis", "randomiz")


def canonical_types(options: dict[str, Any] | None) -> list[str]:
    """The ticked canonical names only (free-text "Other: ..." entries are never enforced)."""
    return [t for t in (options or {}).get("study_types") or [] if t in STUDY_TYPES]


_NOT_RCT = re.compile(r"\b(?:non|quasi)[\s-]*(?:randomi[sz]ed|rcts?)\b", re.IGNORECASE)
_REVIEW = re.compile(r"meta[\s-]*analy|systematic[\s-]*review", re.IGNORECASE)
_RCT = re.compile(r"\brcts?\b|randomi[sz]ed", re.IGNORECASE)


def _is_rct(design: str) -> bool:
    """A randomised design. Non-/quasi-randomised and quasi-RCT do not count, and neither does a review of RCTs."""
    if _REVIEW.search(design):
        return False
    return bool(_RCT.search(_NOT_RCT.sub(" ", design)))


def design_matches(study_type: str, study_designs: list[str]) -> bool:
    if study_type == "RCT":
        return any(_is_rct(d) for d in study_designs)
    designs = loose(" ".join(study_designs))
    return any(s in designs for s in SYNONYMS[study_type])


def missing_study_types(options: dict[str, Any] | None, study_designs: list[str]) -> list[str]:
    return [t for t in canonical_types(options) if not design_matches(t, study_designs)]


def allowed_designs(options: dict[str, Any] | None, review_type: str = "slr") -> frozenset[str]:
    """DesignCategory values admitted by the ticked canonical types; empty when nothing is enforced.

    Narrative and scoping reviews cover every design, so ticked types are not enforced there."""
    if review_type in ("narrative", "scoping"):
        return frozenset()
    return frozenset().union(*(DESIGNS_FOR_TYPE[t] for t in canonical_types(options)))


def design_allowed(design: str | None, allowed: frozenset[str]) -> bool:
    """True when nothing is enforced, the design is undecided (unknown), or it is one of the ticked designs."""
    return not allowed or design in _UNDECIDED or design in allowed
