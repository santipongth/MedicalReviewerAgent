"""Deterministic checks that catch the typical failure modes of smaller models: numbers that are not in
the paper (hallucinations), impossible statistics, unknown citations and numbers altered in translation."""
from __future__ import annotations

import re
from collections import Counter

from rapidfuzz import fuzz

from app.graph.schemas import OutcomeResult, PaperCard
from app.services.text import normalize_title

RATIO_MEASURES = {"HR", "OR", "RR"}
# A number not glued to an ASCII letter/digit before it (so "T2D" is not a number, but Thai text before
# a number is fine). Thousands separators "1,234" are folded; a minus sign counts only after whitespace.
_NUM = re.compile(r"(?<![A-Za-z0-9_.])(-)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)")
_DASHES = str.maketrans({"–": " to ", "—": " to ", "−": "-", "·": ".", " ": " ", "\xa0": " "})
_CITE_GROUP = re.compile(r"\s?\[([^\]]*\bP\d+[^\]]*)\]")
_REF = re.compile(r"\bP\d+\b")


def numbers_in(text: str | None) -> list[float]:
    if not text:
        return []
    out: list[float] = []
    for m in _NUM.finditer(text.translate(_DASHES)):
        value = float(m.group(2).replace(",", ""))
        out.append(-value if m.group(1) else value)
    return out


def _norm(text: str) -> str:
    text = text.translate({**_DASHES, ord("–"): "-", ord("—"): "-"}).lower()
    return " ".join(re.sub(r"[^\w.%\- ]", " ", text).split())


def quote_found(quote: str | None, source: str, threshold: int) -> bool:
    q = _norm(quote or "")
    if len(q) < 15:
        return False
    return fuzz.partial_ratio(q, _norm(source)) >= threshold


def _contains(numbers: list[float], value: float) -> bool:
    tol = max(1e-9, abs(value) * 0.005)
    return any(abs(n - value) <= tol for n in numbers)


def outcome_problems(o: OutcomeResult, source: str, threshold: int) -> list[str]:
    name = o.outcome
    problems: list[str] = []
    present = {k: v for k, v in (("effect_value", o.effect_value), ("ci_lower", o.ci_lower),
                                 ("ci_upper", o.ci_upper), ("p_value", o.p_value)) if v is not None}
    if present:
        if not quote_found(o.evidence_quote, source, threshold):
            problems.append(f"{name}: evidence_quote is not found verbatim in the paper text")
        quoted = numbers_in(o.evidence_quote)
        for key, value in present.items():
            if not _contains(quoted, value):
                problems.append(f"{name}: {key} {value:g} does not appear in evidence_quote")
    if o.effect_measure == "none" and o.effect_value is not None:
        problems.append(f"{name}: effect_measure is 'none' but effect_value is set")
    if o.ci_lower is not None and o.ci_upper is not None and o.ci_lower > o.ci_upper:
        problems.append(f"{name}: ci_lower {o.ci_lower:g} is greater than ci_upper {o.ci_upper:g}")
    elif None not in (o.effect_value, o.ci_lower, o.ci_upper) and not (
        o.ci_lower - 1e-9 <= o.effect_value <= o.ci_upper + 1e-9
    ):
        problems.append(f"{name}: effect_value {o.effect_value:g} lies outside its confidence interval")
    if o.effect_measure in RATIO_MEASURES:
        for key in ("effect_value", "ci_lower", "ci_upper"):
            value = getattr(o, key)
            if value is not None and value <= 0:
                problems.append(f"{name}: {key} must be > 0 for ratio measure {o.effect_measure}")
    if o.p_value is not None and not 0 <= o.p_value <= 1:
        problems.append(f"{name}: p_value {o.p_value:g} must be between 0 and 1")
    return problems


def _sample_size_problems(card: PaperCard, source: str, threshold: int) -> list[str]:
    if card.sample_size is None:
        return []
    if not card.sample_size_quote:
        return ["sample_size is set but sample_size_quote is empty"]
    if not quote_found(card.sample_size_quote, source, threshold):
        return ["sample_size_quote is not found verbatim in the paper text"]
    if not _contains(numbers_in(card.sample_size_quote), float(card.sample_size)):
        return [f"sample_size {card.sample_size} does not appear in sample_size_quote"]
    return []


def _unverified(text: str | None, source_numbers: list[float]) -> list[float]:
    return [n for n in numbers_in(text) if not _contains(source_numbers, n)]


def free_text_problems(card: PaperCard, source: str) -> list[str]:
    """Numbers in user-facing free text (result, key_findings) must appear somewhere in the paper text."""
    src = numbers_in(source)
    problems = [f"{o.outcome}: result mentions {', '.join(f'{n:g}' for n in bad)} which does not appear in the "
                "paper text; copy numbers exactly as reported" for o in card.outcomes
                if (bad := _unverified(o.result, src))]
    problems += [f"key_findings item {i + 1} mentions {', '.join(f'{n:g}' for n in bad)} which does not appear in "
                 "the paper text" for i, f in enumerate(card.key_findings) if (bad := _unverified(f, src))]
    return problems


def card_problems(card: PaperCard, source: str, threshold: int) -> list[str]:
    problems = _sample_size_problems(card, source, threshold)
    for o in card.outcomes:
        problems += outcome_problems(o, source, threshold)
    return problems + free_text_problems(card, source)


def _mask_unverified(text: str, source_numbers: list[float]) -> str:
    def repl(m: re.Match) -> str:
        value = float(m.group(2).replace(",", ""))
        value = -value if m.group(1) else value
        return m.group(0) if _contains(source_numbers, value) else "[unverified]"
    return _NUM.sub(repl, text.translate(_DASHES))


def null_unverified_numbers(card: PaperCard, source: str, threshold: int) -> tuple[PaperCard, int, int]:
    """Blank every number that failed verification so it can never reach a forest plot or the table."""
    verified = total = 0
    outcomes = []
    src = numbers_in(source)
    for o in card.outcomes:
        if _unverified(o.result, src):  # free text: use the verified verbatim quote, else mask the numbers
            o = o.model_copy(update={"result": o.evidence_quote if quote_found(o.evidence_quote, source, threshold)
                                     else _mask_unverified(o.result, src)})
        has_numbers = any(v is not None for v in (o.effect_value, o.ci_lower, o.ci_upper, o.p_value))
        if not has_numbers:
            outcomes.append(o)
            continue
        total += 1
        if outcome_problems(o, source, threshold):
            outcomes.append(o.model_copy(update={"effect_value": None, "ci_lower": None, "ci_upper": None,
                                                 "p_value": None, "effect_measure": "none", "effect_size": None}))
        else:
            verified += 1
            outcomes.append(o)
    update: dict = {"outcomes": outcomes, "key_findings": [f for f in card.key_findings if not _unverified(f, src)]}
    if card.sample_size is not None:
        total += 1
        if _sample_size_problems(card, source, threshold):
            update.update(sample_size=None, sample_size_quote=None)
        else:
            verified += 1
    return card.model_copy(update=update), verified, total


def _close(a: float, b: float, rel: float = 0.02) -> bool:
    return abs(a - b) <= max(1e-9, rel * max(abs(a), abs(b)))


def compare_cards(a: PaperCard, b: PaperCard) -> tuple[float, list[str]]:
    """Field-level agreement between two independent extractions of the same paper."""
    checks = agree = 0
    disagreements: list[str] = []

    def record(ok: bool, message: str) -> None:
        nonlocal checks, agree
        checks += 1
        if ok:
            agree += 1
        else:
            disagreements.append(message)

    record(a.overall_direction == b.overall_direction,
           f"overall direction differs: {a.overall_direction} vs {b.overall_direction}")
    if a.sample_size is not None and b.sample_size is not None:
        record(_close(a.sample_size, b.sample_size), f"sample_size differs: {a.sample_size} vs {b.sample_size}")
    for oa in a.outcomes:
        if len(a.outcomes) == 1 and len(b.outcomes) == 1:
            ob = b.outcomes[0]
        else:
            ob = max(b.outcomes, key=lambda o: fuzz.token_set_ratio(normalize_title(o.outcome),
                                                                     normalize_title(oa.outcome)), default=None)
            if ob is None or fuzz.token_set_ratio(normalize_title(ob.outcome), normalize_title(oa.outcome)) < 80:
                continue
        record(oa.direction == ob.direction, f"{oa.outcome}: direction differs ({oa.direction} vs {ob.direction})")
        if oa.effect_value is not None and ob.effect_value is not None:
            record(_close(oa.effect_value, ob.effect_value),
                   f"{oa.outcome}: effect differs ({oa.effect_value:g} vs {ob.effect_value:g})")
    return (agree / checks if checks else 1.0), disagreements


def check_citations(text: str, allowed: set[str]) -> list[str]:
    cited = {ref for group in _CITE_GROUP.findall(text) for ref in _REF.findall(group)}
    return [f"unknown citation {ref}" for ref in sorted(cited - allowed, key=lambda r: int(r[1:]))]


def strip_unknown_citations(text: str, allowed: set[str]) -> str:
    def keep(match: re.Match) -> str:
        refs = [r for r in _REF.findall(match.group(1)) if r in allowed]
        if not refs:
            return ""
        lead = " " if match.group(0).startswith(" ") else ""
        return f"{lead}[{', '.join(refs)}]"

    return _CITE_GROUP.sub(keep, text)


def number_tokens(text: str | None) -> list[str]:
    """Numbers exactly as written (sign + digits, thousands separators removed) — keeps precision."""
    if not text:
        return []
    return [(m.group(1) or "") + m.group(2).replace(",", "") for m in _NUM.finditer(text.translate(_DASHES))]


def numbers_preserved(source: str, translated: str) -> bool:
    """Translation must keep every number exactly as written ("0.80" may not become "0.8")."""
    return Counter(number_tokens(source)) == Counter(number_tokens(translated))
