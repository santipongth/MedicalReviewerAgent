"""Study-design categories: a fixed set the extractor must choose from, cross-checked against Europe PMC's
publication types, with a deterministic text mapping for cards that lack one (older results, model omissions)."""
from __future__ import annotations

import re

from app.graph.schemas import PaperCard

RANDOMIZED_CATEGORIES = frozenset({"rct", "sr_ma_rct"})
POOLED_CATEGORIES = frozenset({"sr_ma_rct", "sr_ma_observational", "sr_ma_mixed"})

# Ordered: the first matching rule wins (pooled designs before the primary designs they mention).
_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("sr_ma_rct", re.compile(r"(meta-?analys|systematic review).*(randomi[sz]ed|rcts?\b|trials)", re.IGNORECASE)),
    ("sr_ma_observational", re.compile(r"(meta-?analys|systematic review).*(observational|cohort|case-control)", re.IGNORECASE)),
    ("sr_ma_mixed", re.compile(r"meta-?analys|systematic review|pooled analysis", re.IGNORECASE)),
    ("mendelian_randomization", re.compile(r"mendelian randomi", re.IGNORECASE)),
    ("non_randomized_trial", re.compile(r"non-?randomi[sz]ed|single[- ]arm|quasi-?experimental", re.IGNORECASE)),
    ("rct", re.compile(r"randomi[sz]ed|\brct\b|controlled trial", re.IGNORECASE)),
    ("case_control", re.compile(r"case-?control", re.IGNORECASE)),
    ("cohort", re.compile(r"cohort|target trial emulation|longitudinal|registry|claims database|new-user", re.IGNORECASE)),
    ("cross_sectional", re.compile(r"cross-?sectional|survey", re.IGNORECASE)),
    ("case_series", re.compile(r"case series|case report", re.IGNORECASE)),
    ("narrative_review", re.compile(r"^\s*(narrative |literature |scoping )?review(\s+article)?\s*$|narrative review", re.IGNORECASE)),
]


def infer_design_category(text: str | None) -> str | None:
    for category, pattern in _RULES:
        if text and pattern.search(text):
            return category
    return None


def settle_design_category(card: PaperCard, pub_types: list[str] | None) -> PaperCard:
    """Final deterministic pass after the harness: fill a missing category from the free text, and let the
    curated publication types win over a contradicting category."""
    category = card.design_category or infer_design_category(card.study_design)
    types = {t.strip().lower() for t in pub_types or []}
    if types & {"meta-analysis", "systematic review"} and category not in POOLED_CATEGORIES:
        inferred = infer_design_category(card.study_design)
        category = inferred if inferred in POOLED_CATEGORIES else "sr_ma_mixed"
    elif "randomized controlled trial" in types and category not in ("rct", "sr_ma_rct", "sr_ma_mixed"):
        category = "rct"
    return card.model_copy(update={"design_category": category or "other"})


def design_problems(card: PaperCard, pub_types: list[str] | None) -> list[str]:
    """Problems the extractor must fix: a category that contradicts the publication types Europe PMC curates
    for the paper. A missing category is not worth a repair round: settle_design_category infers it."""
    category = card.design_category
    if category is None:
        return []
    types = {t.strip().lower() for t in pub_types or []}
    problems: list[str] = []
    if "randomized controlled trial" in types and category not in ("rct", "sr_ma_rct", "sr_ma_mixed"):
        problems.append(f"design_category '{category}' contradicts the publication type Randomized Controlled Trial")
    if types & {"meta-analysis", "systematic review"} and category not in POOLED_CATEGORIES:
        problems.append(f"design_category '{category}' contradicts the publication type "
                        f"{'Meta-Analysis' if 'meta-analysis' in types else 'Systematic Review'}")
    return problems
