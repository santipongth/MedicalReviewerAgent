"""Deterministic checks that catch the typical failure modes of smaller models: numbers that are not in
the paper (hallucinations), impossible statistics, unknown citations and numbers altered in translation.

Number verification (Plan 19, audit I-1/I-5):
- A numeric field is verified only when its exact value occurs in the paper text (the abstract) inside the window that
  the evidence quote aligns to, and in the quote itself. The model's quote alone never verifies a number.
- Both sides are parsed by one tokenizer that folds the formats abstracts use: the unicode minus, a hyphen or en dash
  used as a minus (one that follows a number is a range), "·" decimals, decimal commas ("0,85"), comma or space
  thousands ("1,234", "111 725" with a normal, thin or no-break space), leading-dot decimals ("P = .003") and
  percentages ("12.5%" is the number 12.5; it never stands for 0.125).
- Equality is exact on the decimal value: 0.8 equals 0.80 (the model's JSON float cannot keep a trailing zero, and the
  value is the same), but 0.80 never equals 0.86 or 0.804, and a number never matches inside a longer one
  ("0.80" is not in "10.80" or "0.805").
- Fields are nulled one at a time (`null_unverified_numbers`).
"""
from __future__ import annotations

import re
from collections import Counter
from decimal import Decimal, InvalidOperation
from functools import lru_cache

from rapidfuzz import fuzz

from app.graph.schemas import OutcomeResult, PaperCard
from app.services.text import normalize_title

RATIO_MEASURES = {"HR", "OR", "RR"}
NUMERIC_FIELDS = ("effect_value", "ci_lower", "ci_upper", "p_value")

_EN_DASH, _EM_DASH, _MINUS, _MIDDOT = chr(0x2013), chr(0x2014), chr(0x2212), chr(0x00B7)
_SPACES = tuple(chr(c) for c in (0x00A0, 0x2009, 0x202F, 0x2007))  # no-break, thin, narrow no-break, figure

# Localization (numbers_preserved) keeps its own, unchanged tokenizer: it compares numbers as written.
# A number not glued to an ASCII letter/digit before it (so "T2D" is not a number, but Thai text before
# a number is fine). Thousands separators "1,234" are folded; a minus sign counts only after whitespace.
_NUM = re.compile(r"(?<![A-Za-z0-9_.])(-)?(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)")
_DASHES = str.maketrans({_EN_DASH: " to ", _EM_DASH: " to ", _MINUS: "-", _MIDDOT: ".", chr(0x2009): " ",
                         chr(0x00A0): " "})
_CITE_GROUP = re.compile(r"\s?\[([^\]]*\bP\d+[^\]]*)\]")
_REF = re.compile(r"\bP\d+\b")

# Verification tokenizer. `_FOLD` maps one character to one character, so match offsets are offsets in the original:
# em dash -> en dash, middle dot -> decimal point, special spaces -> space. The unicode minus is kept: it is always
# a minus, while "-" and an en dash are a minus only when they do not follow a number.
_FOLD = str.maketrans({_EM_DASH: _EN_DASH, _MIDDOT: ".", **{c: " " for c in _SPACES}})
_TOKEN = re.compile(r"""
    (?<![A-Za-z0-9_.])                                  # not glued to a word ("T2D") or inside a decimal
    (?P<sign>[-–−])?
    (?:
        (?P<comma_k>\d{1,3}(?:,\d{3})+(?:\.\d+)?)(?!\d|,\d)        # 1,234  1,234.5
      | (?P<space_k>\d{1,3}(?:\ \d{3})+(?:\.\d+)?)(?!\d|\ \d)      # 111 725
      | (?P<dec_comma>0,\d+|[1-9]\d{0,2},\d{1,2})(?!\d|,\d)        # 0,85  12,5 (three digits = thousands)
      | (?P<plain>\d+(?:\.\d+)?)
      | (?P<lead_dot>\.\d+)                                         # P = .003
    )
""", re.VERBOSE)


@lru_cache(maxsize=512)
def _tokens(text: str) -> tuple[tuple[int, int, Decimal], ...]:
    """(start, end, value) of every number in `text`; offsets refer to the original string."""
    folded = text.translate(_FOLD)
    out: list[tuple[int, int, Decimal]] = []
    for m in _TOKEN.finditer(folded):
        kind = m.lastgroup
        raw = m.group(kind)
        if kind in ("comma_k", "space_k"):
            raw = raw.replace(",", "").replace(" ", "")
        elif kind == "dec_comma":
            raw = raw.replace(",", ".")
        elif kind == "lead_dot":
            raw = "0" + raw
        value = Decimal(raw)
        start = m.start(kind)
        if sign := m.group("sign"):
            # a hyphen or en dash right after a number ("0.71 - 0.90", "12% – 15%") is a range, not a minus
            before = folded[: m.start("sign")].rstrip(" ")
            if sign == _MINUS or not (before and (before[-1].isdigit() or before[-1] == "%")):
                value, start = -value, m.start("sign")
        out.append((start, m.end(), value))
    return tuple(out)


def _values(text: str | None) -> set[Decimal]:
    return {v for _, _, v in _tokens(text)} if text else set()


def _dec(value: float) -> Decimal | None:
    try:
        return Decimal(repr(value)) if isinstance(value, float) else Decimal(value)
    except (InvalidOperation, TypeError, ValueError):
        return None


def numbers_in(text: str | None) -> list[float]:
    return [float(v) for _, _, v in _tokens(text)] if text else []


_KEEP = re.compile(r"[\w.%\-]")
_NORM_DASHES = str.maketrans({_EN_DASH: "-", _MINUS: "-"})


@lru_cache(maxsize=512)
def _norm_map(text: str) -> tuple[str, tuple[int, ...]]:
    """Lower-cased text with punctuation as single spaces, plus the original offset of every kept character."""
    folded = text.translate(_FOLD).translate(_NORM_DASHES)
    chars: list[str] = []
    index: list[int] = []
    for i, ch in enumerate(folded):
        for c in ch.lower():
            if not _KEEP.match(c):
                c = " "
            if c == " " and (not chars or chars[-1] == " "):
                continue
            chars.append(c)
            index.append(i)
    while chars and chars[-1] == " ":
        chars.pop()
        index.pop()
    return "".join(chars), tuple(index)


def _norm(text: str) -> str:
    return _norm_map(text)[0]


def quote_window(quote: str | None, source: str, threshold: int) -> tuple[int, int] | None:
    """The [start, end) span of `source` the quote aligns to (rapidfuzz partial_ratio >= threshold), else None."""
    q = _norm(quote or "")
    if len(q) < 15:
        return None
    s, index = _norm_map(source)
    hit = fuzz.partial_ratio_alignment(q, s, score_cutoff=threshold)
    if hit is None or hit.dest_end <= hit.dest_start:
        return None
    return index[hit.dest_start], index[hit.dest_end - 1] + 1


def quote_found(quote: str | None, source: str, threshold: int) -> bool:
    return quote_window(quote, source, threshold) is not None


def _window_values(source: str, window: tuple[int, int]) -> set[Decimal]:
    """Numbers overlapping the window: a number cut by the window edge counts whole, never as a fragment."""
    start, end = window
    return {v for s, e, v in _tokens(source) if s < end and e > start}


def _supported(value: float, quote: str | None, source: str, window: tuple[int, int]) -> str | None:
    """None when the exact value is in the quote and in the aligned source window, else the reason it is not."""
    d = _dec(value)
    if d is None or d not in _values(quote):
        return "does not appear in evidence_quote"
    if d not in _window_values(source, window):
        return "does not appear in the paper text where evidence_quote is found; copy numbers exactly as reported"
    return None


def outcome_failures(o: OutcomeResult, source: str, threshold: int) -> list[tuple[tuple[str, ...], str]]:
    """Every problem with the numeric fields it condemns, so callers can null exactly those fields."""
    name = o.outcome
    out: list[tuple[tuple[str, ...], str]] = []
    present = {k: getattr(o, k) for k in NUMERIC_FIELDS if getattr(o, k) is not None}
    if present:
        window = quote_window(o.evidence_quote, source, threshold)
        if window is None:
            out.append((tuple(present), f"{name}: evidence_quote is not found verbatim in the paper text"))
        else:
            for key, value in present.items():
                if reason := _supported(value, o.evidence_quote, source, window):
                    out.append(((key,), f"{name}: {key} {value:g} {reason}"))
    if o.effect_measure == "none" and o.effect_value is not None:
        out.append((("effect_value",), f"{name}: effect_measure is 'none' but effect_value is set"))
    if o.ci_lower is not None and o.ci_upper is not None and o.ci_lower > o.ci_upper:
        out.append((("ci_lower", "ci_upper"),
                    f"{name}: ci_lower {o.ci_lower:g} is greater than ci_upper {o.ci_upper:g}"))
    elif None not in (o.effect_value, o.ci_lower, o.ci_upper) and not (
        o.ci_lower - 1e-9 <= o.effect_value <= o.ci_upper + 1e-9
    ):
        out.append((("effect_value", "ci_lower", "ci_upper"),
                    f"{name}: effect_value {o.effect_value:g} lies outside its confidence interval"))
    if o.effect_measure in RATIO_MEASURES:
        for key in ("effect_value", "ci_lower", "ci_upper"):
            value = getattr(o, key)
            if value is not None and value <= 0:
                out.append(((key,), f"{name}: {key} must be > 0 for ratio measure {o.effect_measure}"))
    if o.p_value is not None and not 0 <= o.p_value <= 1:
        out.append((("p_value",), f"{name}: p_value {o.p_value:g} must be between 0 and 1"))
    return out


def outcome_problems(o: OutcomeResult, source: str, threshold: int) -> list[str]:
    return [message for _, message in outcome_failures(o, source, threshold)]


def _sample_size_problems(card: PaperCard, source: str, threshold: int) -> list[str]:
    if card.sample_size is None:
        return []
    if not card.sample_size_quote:
        return ["sample_size is set but sample_size_quote is empty"]
    window = quote_window(card.sample_size_quote, source, threshold)
    if window is None:
        return ["sample_size_quote is not found verbatim in the paper text"]
    if reason := _supported(card.sample_size, card.sample_size_quote, source, window):
        return [f"sample_size {card.sample_size} {reason.replace('evidence_quote', 'sample_size_quote')}"]
    return []


def _unverified(text: str | None, source_numbers: set[Decimal]) -> list[float]:
    return [float(v) for _, _, v in _tokens(text or "") if v not in source_numbers]


def free_text_problems(card: PaperCard, source: str) -> list[str]:
    """Numbers in user-facing free text (result, key_findings) must appear somewhere in the paper text."""
    src = _values(source)
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


def _mask_unverified(text: str, source_numbers: set[Decimal]) -> str:
    """Replace each number that is not in the paper text by "[unverified]"; everything else stays as written."""
    out, last = [], 0
    for start, end, value in _tokens(text):
        if value not in source_numbers:
            out += [text[last:start], "[unverified]"]
            last = end
    return "".join(out) + text[last:]


def _quote_is_faithful(quote: str | None, source: str, threshold: int) -> bool:
    """The quote is found and every number in it is in its aligned source window (no altered digit)."""
    window = quote_window(quote, source, threshold)
    return window is not None and _values(quote) <= _window_values(source, window)


def _null_fields(o: OutcomeResult, failed: set[str]) -> OutcomeResult:
    """Null only the failed fields, plus what cannot stand alone: half a CI is no CI, and a CI without its point
    estimate is neither shown nor pooled. The reported-effect text goes with any blanked estimate or CI."""
    if failed & {"effect_value", "ci_lower", "ci_upper"}:
        failed = failed | {"ci_lower", "ci_upper"}
    update: dict = dict.fromkeys(failed)
    if "effect_value" in failed:
        update["effect_measure"] = "none"
    if failed & {"effect_value", "ci_lower", "ci_upper"}:
        update["effect_size"] = None
    return o.model_copy(update=update)


def null_unverified_numbers(card: PaperCard, source: str, threshold: int) -> tuple[PaperCard, int, int]:
    """Blank every number that failed verification so it can never reach a forest plot or the table.

    Fields are blanked one at a time: an unverifiable p-value never blanks a verified effect or CI.
    Counts are per unit (each outcome that carries numbers, plus the sample size), so the stored rate stays
    comparable with older reviews. An outcome counts as verified when its estimate survives (its effect_value, or,
    for an outcome without one, any of its numbers). The unverified units are exactly the `unverified` list that
    reading.py derives, so numbers_total - numbers_verified == len(unverified)."""
    verified = total = 0
    outcomes = []
    src = _values(source)
    for o in card.outcomes:
        if _unverified(o.result, src):  # free text: use the faithful verbatim quote, else mask the numbers
            faithful = _quote_is_faithful(o.evidence_quote, source, threshold)
            o = o.model_copy(update={"result": o.evidence_quote if faithful else _mask_unverified(o.result, src)})
        had_effect = o.effect_value is not None
        if not any(getattr(o, k) is not None for k in NUMERIC_FIELDS):
            outcomes.append(o)
            continue
        total += 1
        failed = {k for fields, _ in outcome_failures(o, source, threshold) for k in fields}
        if failed:
            o = _null_fields(o, failed)
        verified += (o.effect_value is not None) if had_effect else any(getattr(o, k) is not None
                                                                         for k in NUMERIC_FIELDS)
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
