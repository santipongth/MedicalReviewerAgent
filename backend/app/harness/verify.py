"""Deterministic checks that catch the typical failure modes of smaller models: numbers that are not in
the paper (hallucinations), impossible statistics, unknown citations and numbers altered in translation.

Number verification (Plan 19, audit I-1/I-5):
- The evidence quote is located in the paper text (the abstract) with rapidfuzz partial_ratio_alignment. The quote must
  then be numerically verbatim: its ordered numbers must equal the ordered numbers of that source window. The only
  exception is a source number cut by the window edge: the quote may leave it out, or end (start) with a true
  truncation of it ("0.8" of "0.86" at the end, "86" at the start, never "0.80"); such a truncated number verifies
  no field. A quote that changes, adds or drops a number verifies nothing.
- A numeric field is verified only when its exact value is one of those matched window numbers. The model's quote
  alone never verifies a number.
- Binding to the outcome: an effect with a CI must appear as an ordered run, effect then lower then upper bound;
  between the effect and the lower bound only the CI level ("95" of "95% CI") and integer counts ("779 of 1118",
  "per 1000") may stand. An estimate is rejected when the phrase before it names another outcome of the same card
  and not this one: for a later estimate the phrase since the previous estimate ("... mortality (HR 0.86,
  0.75-0.99) and stroke (HR 0.80 ..." cannot give 0.80 to mortality); for the first estimate of the window the
  quote's lead-in, which must name at least half of the other outcome's words ("Results: stroke HR 0.80" cannot be
  mortality's), because lead-ins often set the scene with general words. When that lead-in names no outcome (a quote
  that starts at the statistic, "HR 0.80 (0.70-0.91)"), the paper's own lead-in from the start of that sentence is
  judged instead.
  Known limit: binding is lexical. It does not catch wordings that name the outcome after the number ("HR 0.86 for
  mortality and 0.80 for stroke"), lead-ins that name both outcomes, outcome names that share their words
  ("all-cause mortality" vs "cardiovascular mortality") or sibling outcomes the card does not list. There an
  estimate can still be given to the wrong outcome of the same passage; the number itself is still verbatim.
- Both sides are parsed by one tokenizer that folds the formats abstracts use: the unicode minus (always a minus, also
  when a space follows it), a hyphen or en dash used as a minus (one that follows a number is a range), "·" decimals,
  comma or space thousands ("1,234", "111 725" with a normal, thin or no-break space), leading-dot decimals
  ("P = .003") and percentages ("12.5%" is the number 12.5; it never stands for 0.125). The unicode minus may be
  followed by any number of spaces, a hyphen or en dash by up to two (more is read as a prose dash). Decimal commas ("0,85") are read only when the paper text has no decimal point and never inside a
  list ("1,2,5"). In a decimal-point text "0,86" or "weeks 2,4" is one opaque token: it matches only the same text
  and never verifies a field (it is never split into 0 and 86).
- Equality is exact on the decimal value: 0.8 equals 0.80 (the model's JSON float cannot keep a trailing zero, and the
  value is the same), but 0.80 never equals 0.86 or 0.804, and a number never matches inside a longer one
  ("0.80" is not in "10.80" or "0.805").
- Fields are nulled one at a time (`null_unverified_numbers`). A CI is kept only whole and only with its effect.
- Free text: an outcome's `result` may only use numbers of its quote's source window (the whole abstract when the
  quote is not found), and never a value that was nulled from that outcome. `key_findings` have no quote, so their
  numbers are checked against the whole abstract.
"""
from __future__ import annotations

import re
from collections import Counter
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from typing import NamedTuple

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
# em dash -> en dash, middle dot -> decimal point, special spaces -> space.
_FOLD = str.maketrans({_EM_DASH: _EN_DASH, _MIDDOT: ".", **{c: " " for c in _SPACES}})
_TOKEN_HEAD = r"""
    (?<![A-Za-z0-9_.])                                  # not glued to a word ("T2D") or inside a decimal
    (?:(?P<sign>[-DASH])\ {0,2}|(?P<usign>MINUS)\ *)?   # "MD - 0.5"; any spaces only after the unicode minus
    (?:
"""
_TOKEN_TAIL = r"""
        (?P<comma_k>\d{1,3}(?:,\d{3})+(?:\.\d+)?)(?!\d|,\d)        # 1,234  1,234.5
      | (?P<space_k>\d{1,3}(?:\ \d{3})+(?:\.\d+)?)(?!\d|\ \d)      # 111 725
      | (?P<plain>\d+(?:\.\d+)?)
      | (?P<lead_dot>\.\d+)                                         # P = .003
    )
"""
# comma-decimal papers only: 0,85 / 12,5 (three digits after the comma = thousands), never inside a list "1,2,5"
_DEC_COMMA = r"(?<!\d,)(?P<dec_comma>0,\d+|[1-9]\d{0,2},\d{1,2})(?!\d|,\d) |"
# decimal-point papers: "0,86" (a stray comma decimal) or "2,4" is one opaque token that verifies nothing, never two
# integers
_OPAQUE_COMMA = r"(?<!\d,)(?P<opaque>\d+,\d{1,2})(?!\d|,\d) |"
_HEAD = _TOKEN_HEAD.replace("DASH", _EN_DASH).replace("MINUS", _MINUS)
_TOKEN_POINT = re.compile(_HEAD + _OPAQUE_COMMA + _TOKEN_TAIL, re.VERBOSE)
_TOKEN_COMMA = re.compile(_HEAD + _DEC_COMMA + _TOKEN_TAIL, re.VERBOSE)
_DECIMAL_POINT = re.compile(r"\d\.\d")
_CI_LEVELS = {Decimal(90), Decimal(95), Decimal(99)}


class Tok(NamedTuple):
    start: int
    end: int
    value: Decimal
    integer: bool  # written without a decimal part ("779", "1,118"): a count, never an estimate
    text: str  # the digits as written (folded, without the sign)
    opaque: bool = False  # unreadable ("0,86" in a decimal-point paper): matches only the same text, never a field

    @property
    def key(self) -> Decimal | str:
        """What two tokens are compared by: the value, or the raw text of an opaque token (never equal to a value)."""
        return "#" + self.text if self.opaque else self.value


def _comma_decimals(text: str) -> bool:
    """True when the text writes decimals with a comma: it has no decimal point at all."""
    return not _DECIMAL_POINT.search(text.translate(_FOLD))


@lru_cache(maxsize=1024)
def _tokens(text: str, comma_decimals: bool | None = None) -> tuple[Tok, ...]:
    """Every number in `text` with its offsets in the original string. `comma_decimals` defaults to the text's own
    convention; pass the source's convention when parsing a quote of it."""
    folded = text.translate(_FOLD)
    if comma_decimals is None:
        comma_decimals = not _DECIMAL_POINT.search(folded)
    out: list[Tok] = []
    for m in (_TOKEN_COMMA if comma_decimals else _TOKEN_POINT).finditer(folded):
        kind = m.lastgroup
        text_ = raw = m.group(kind)
        integer = kind in ("comma_k", "space_k", "plain") and "." not in raw
        if kind in ("comma_k", "space_k"):
            raw = raw.replace(",", "").replace(" ", "")
        elif kind in ("dec_comma", "opaque"):
            raw = raw.replace(",", ".")
        elif kind == "lead_dot":
            raw = "0" + raw
        value = Decimal(raw)
        start = m.start(kind)
        if m.group("usign"):  # the unicode minus is always a minus
            value, start, text_ = -value, m.start("usign"), "-" + text_
        elif m.group("sign"):
            # a hyphen or en dash right after a number ("0.71 - 0.90", "12% – 15%") is a range, not a minus
            before = folded[: m.start("sign")].rstrip(" ")
            if not (before and (before[-1].isdigit() or before[-1] == "%")):
                value, start, text_ = -value, m.start("sign"), "-" + text_
        out.append(Tok(start, m.end(), value, integer, text_, kind == "opaque"))
    return tuple(out)


def _values(text: str | None, comma_decimals: bool | None = None) -> set[Decimal | str]:
    """The comparison keys of every number in `text` (see `Tok.key`)."""
    return {t.key for t in _tokens(text, comma_decimals)} if text else set()


def _dec(value: float) -> Decimal | None:
    try:
        return Decimal(repr(value)) if isinstance(value, float) else Decimal(value)
    except (InvalidOperation, TypeError, ValueError):
        return None


# Public names for other deterministic checks (app.harness.prose): the same tokenizer and conversions the verifier
# uses, so prose numbers are compared exactly as card numbers were verified.
tokens = _tokens
to_decimal = _dec
CI_LEVELS = frozenset(_CI_LEVELS)


def numbers_in(text: str | None) -> list[float]:
    return [float(t.value) for t in _tokens(text) if not t.opaque] if text else []


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


class _Match(NamedTuple):
    window: tuple[int, int]
    toks: tuple[Tok, ...]  # every number of the source
    in_window: tuple[int, ...]  # indices into toks that overlap the window
    exact: frozenset[int] | None  # indices whose value the quote repeats exactly; None = the quote alters a number
    excused: frozenset[Decimal | str]  # values of quote numbers excused as truncated at an edge: they verify nothing


_ALNUM = re.compile(r"[A-Za-z0-9]")


def _truncation(q: Tok, quote: str, s: Tok, window: tuple[int, int], first: bool, last: bool) -> bool:
    """The quote's edge number is a true truncation of the source number cut by the window edge: at the start of the
    quote its digits are a strict suffix of the source's ("86" of "0.86"), at the end a strict prefix ("0.8" of
    "0.86"). "0.80" or "0.81" for "0.86" is an alteration, never a truncation."""
    if q.opaque != s.opaque or len(q.text) >= len(s.text):
        return False
    if first and s.start < window[0] and not _ALNUM.search(quote[:q.start]) and s.text.endswith(q.text):
        return True
    return last and s.end > window[1] and not _ALNUM.search(quote[q.end:]) and s.text.startswith(q.text)


def _pair(qtoks: tuple[Tok, ...], quote: str, toks: tuple[Tok, ...], w: tuple[int, ...],
          window: tuple[int, int]) -> tuple[frozenset[int] | None, frozenset[Decimal | str]]:
    """Pair the quote's ordered numbers with the window's. A source number cut by the window edge may be left out of
    the quote, or appear in it truly truncated; any other difference means the quote altered the paper."""
    ws, we = window
    cut_first = bool(w) and toks[w[0]].start < ws
    cut_last = bool(w) and toks[w[-1]].end > we
    for drop_first in (False, True):
        for drop_last in (False, True):
            if (drop_first and not cut_first) or (drop_last and not cut_last):
                continue
            cand = w[(1 if drop_first else 0): len(w) - (1 if drop_last else 0)]
            if len(cand) != len(qtoks):
                continue
            exact: set[int] = set()
            excused: set[Decimal | str] = set()
            for k, (q, wi) in enumerate(zip(qtoks, cand, strict=True)):
                if toks[wi].key == q.key:
                    exact.add(wi)
                elif _truncation(q, quote, toks[wi], window, k == 0, k == len(cand) - 1):
                    excused.add(q.key)
                else:
                    break
            else:
                return frozenset(exact), frozenset(excused)
    return None, frozenset()


def _match(quote: str | None, source: str, threshold: int) -> _Match | None:
    window = quote_window(quote, source, threshold)
    if window is None:
        return None
    comma = _comma_decimals(source)
    toks = _tokens(source, comma)
    w = tuple(i for i, t in enumerate(toks) if t.start < window[1] and t.end > window[0])
    exact, excused = _pair(_tokens(quote or "", comma), quote or "", toks, w, window)
    return _Match(window, toks, w, exact, excused)


_ALTERED = ("changes, adds or leaves out a number of the paper text at the quoted passage; quote the passage exactly, "
            "with every number as printed")
_STOP = {"with", "from", "that", "were", "than", "this", "those", "these", "group", "groups", "ratio", "ratios",
         "patients", "participants", "risk", "rate", "rates", "versus", "compared", "between", "among", "after",
         "during", "total", "overall", "significant", "significantly", "higher", "lower", "there", "which",
         "while", "both", "each", "other", "results", "outcome", "outcomes", "associated", "association", "difference",
         "differences", "mean", "median", "change", "changes", "reduction", "increase", "increased", "reduced"}


def _words(text: str) -> set[str]:
    return {w[:5] for w in re.findall(r"[a-z]+", text.lower()) if len(w) >= 4 and w not in _STOP}


def _gap_ok(tok: Tok, source: str) -> bool:
    """Numbers allowed between an estimate and its CI: the CI level ("95%") and integer counts ("779 of 1118")."""
    if tok.opaque:
        return False
    return (tok.value in _CI_LEVELS and source[tok.end:tok.end + 1] == "%") or (tok.integer and tok.value >= 0)


def _runs(m: _Match, source: str, effect: Decimal, lo: Decimal | None, hi: Decimal | None) -> list[int]:
    """Positions (indices into m.toks) where the effect starts a valid run: effect, [CI level / counts], lo, hi."""
    starts = []
    for p in sorted(m.exact):
        if m.toks[p].key != effect:
            continue
        if lo is None:
            starts.append(p)
            continue
        j, gap = p + 1, 0
        while j in m.exact:
            if m.toks[j].key == lo and j + 1 in m.exact and m.toks[j + 1].key == hi:
                starts.append(p)
                break
            if gap >= 4 or not _gap_ok(m.toks[j], source):
                break
            gap, j = gap + 1, j + 1
    return starts


def _phrase_before(m: _Match, source: str, p: int) -> tuple[str, bool]:
    """The source text before the estimate at p: since the previous estimate in the window, or, for the first
    estimate, the quote's lead-in from the window start. The flag tells whether it is that lead-in."""
    k = p - 1
    while k >= 0 and k in m.in_window and _gap_ok(m.toks[k], source):
        k -= 1
    if k < 0 or k not in m.in_window:
        return source[m.window[0]:m.toks[p].start], True
    return source[m.toks[k].end:m.toks[p].start], False


def _bound_elsewhere(name: str, others: tuple[str, ...], phrase: str, lead_in: bool) -> str | None:
    """Another outcome of the card that the estimate's phrase names, while it never names this outcome
    ("... (HR 0.86, 0.75-0.99) and stroke (HR 0.80 ..." belongs to stroke, not to mortality).

    A phrase between two estimates is short, so one matching word of another outcome is enough. A lead-in is longer
    and often sets the scene with general words, so there the other outcome must be named by at least half of its
    words ("Results: stroke HR 0.80" names stroke; "156 breasts" does not name "performance by breast density")."""
    words = _words(phrase)
    if _words(name) & words:
        return None
    best: tuple[float, str] = (0.0, "")
    for n in others:
        own_words = _words(n)
        if n == name or not own_words:
            continue
        hits = len(own_words & words)
        score = hits / len(own_words) if lead_in else float(hits)
        if hits and score > best[0]:
            best = (score, n)
    if lead_in:
        return best[1] if best[0] >= 0.5 else None
    return best[1] or None


_SENTENCE_END = re.compile(r"[.;:!?](?=\s)|\n")


def _sentence_lead_in(m: _Match, source: str, p: int) -> str:
    """The source text from the start of the sentence (or clause) that holds the estimate at p, or from the previous
    estimate when that is nearer, up to the estimate."""
    start = 0
    for e in _SENTENCE_END.finditer(source, 0, m.toks[p].start):
        start = e.end()
    k = p - 1
    while k >= 0 and _gap_ok(m.toks[k], source):
        k -= 1
    if k >= 0:
        start = max(start, m.toks[k].end)
    return source[start:m.toks[p].start]


def _owner(m: _Match, source: str, p: int, name: str, others: tuple[str, ...]) -> str | None:
    """The other outcome the estimate at p belongs to, if its phrase says so (None = this outcome or undecided).
    A quote that starts at the statistic ("HR 0.80 (0.70-0.91)") has a lead-in that names no outcome; then the
    paper's own lead-in, from the start of that sentence, is judged instead."""
    phrase, lead_in = _phrase_before(m, source, p)
    owner = _bound_elsewhere(name, others, phrase, lead_in)
    if owner or not lead_in or _words(name) & _words(phrase):
        return owner
    return _bound_elsewhere(name, others, _sentence_lead_in(m, source, p), True)


def outcome_failures(o: OutcomeResult, source: str, threshold: int,
                     others: tuple[str, ...] = ()) -> list[tuple[tuple[str, ...], str]]:
    """Every problem with the numeric fields it condemns, so callers can null exactly those fields. `others` are the
    names of the card's other outcomes (used to bind an estimate to its outcome)."""
    name = o.outcome
    out: list[tuple[tuple[str, ...], str]] = []
    present = {k: getattr(o, k) for k in NUMERIC_FIELDS if getattr(o, k) is not None}
    if present:
        m = _match(o.evidence_quote, source, threshold)
        if m is None:
            out.append((tuple(present), f"{name}: evidence_quote is not found verbatim in the paper text"))
        elif m.exact is None:
            out.append((tuple(present), f"{name}: evidence_quote {_ALTERED}"))
        else:
            quoted = _values(o.evidence_quote, _comma_decimals(source))
            matched = {m.toks[i].key for i in m.exact}
            bad: set[str] = set()
            for key, value in present.items():
                d = _dec(value)
                if d is None or d not in quoted:
                    out.append(((key,), f"{name}: {key} {value:g} does not appear in evidence_quote"))
                    bad.add(key)
                elif d not in matched or d in m.excused:  # a truncated edge number never vouches for a field
                    out.append(((key,), (f"{name}: {key} {value:g} does not appear in the paper text where "
                                         "evidence_quote is found; copy numbers exactly as reported")))
                    bad.add(key)
            if "effect_value" in present and "effect_value" not in bad:
                with_ci = {"ci_lower", "ci_upper"} <= present.keys() and not bad & {"ci_lower", "ci_upper"}
                lo, hi = (_dec(o.ci_lower), _dec(o.ci_upper)) if with_ci else (None, None)
                starts = _runs(m, source, _dec(o.effect_value), lo, hi)
                estimate = ("effect_value", "ci_lower", "ci_upper")
                if not starts:  # only possible with a CI: a lone effect already matched a window number
                    out.append((estimate, (f"{name}: effect_value {o.effect_value:g} and its CI {lo} to {hi} are not "
                                           "reported together (estimate, then its interval) in the paper text")))
                else:
                    owners = [_owner(m, source, p, name, others) for p in starts]
                    if all(owners):
                        out.append((estimate, (f"{name}: effect_value {o.effect_value:g} is reported for "
                                               f"'{owners[0]}', not for this outcome")))
    if (o.ci_lower is None) != (o.ci_upper is None):
        out.append((("ci_lower", "ci_upper"), f"{name}: give both CI bounds or neither"))
    elif o.ci_lower is not None and o.effect_value is None:
        out.append((("ci_lower", "ci_upper"), f"{name}: a CI needs its effect_value"))
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


def outcome_problems(o: OutcomeResult, source: str, threshold: int, others: tuple[str, ...] = ()) -> list[str]:
    return [message for _, message in outcome_failures(o, source, threshold, others)]


def _sample_size_problems(card: PaperCard, source: str, threshold: int) -> list[str]:
    if card.sample_size is None:
        return []
    if not card.sample_size_quote:
        return ["sample_size is set but sample_size_quote is empty"]
    m = _match(card.sample_size_quote, source, threshold)
    if m is None:
        return ["sample_size_quote is not found verbatim in the paper text"]
    if m.exact is None:
        return [f"sample_size_quote {_ALTERED}"]
    d = _dec(card.sample_size)
    if d not in _values(card.sample_size_quote, _comma_decimals(source)):
        return [f"sample_size {card.sample_size} does not appear in sample_size_quote"]
    if d not in {m.toks[i].key for i in m.exact} or d in m.excused:
        return [f"sample_size {card.sample_size} does not appear in the paper text where sample_size_quote is found"]
    return []


def _prose_allowed(quote: str | None, source: str, threshold: int | None) -> set[Decimal | str]:
    """Numbers an outcome's `result` may use: those of its quote's source window, else of the whole abstract."""
    m = _match(quote, source, threshold) if threshold is not None else None
    if m is None:
        return _values(source)
    return {m.toks[i].key for i in m.in_window}


def _unverified(text: str | None, allowed: set[Decimal | str], comma_decimals: bool | None = None) -> list[str]:
    """The numbers of `text` that are not allowed, as printable strings."""
    return [t.text if t.opaque else f"{float(t.value):g}" for t in _tokens(text or "", comma_decimals)
            if t.key not in allowed]


def free_text_problems(card: PaperCard, source: str, threshold: int | None = None) -> list[str]:
    """Numbers in user-facing free text must appear in the paper text: an outcome's `result` in its quote's source
    window (when `threshold` is given and the quote is found), `key_findings` anywhere in the abstract."""
    comma = _comma_decimals(source)
    problems = [f"{o.outcome}: result mentions {', '.join(bad)} which does not appear in the "
                "paper text where evidence_quote is found; copy numbers exactly as reported" for o in card.outcomes
                if (bad := _unverified(o.result, _prose_allowed(o.evidence_quote, source, threshold), comma))]
    src = _values(source, comma)
    problems += [f"key_findings item {i + 1} mentions {', '.join(bad)} which does not appear in "
                 "the paper text" for i, f in enumerate(card.key_findings) if (bad := _unverified(f, src, comma))]
    return problems


def _others(card: PaperCard, o: OutcomeResult) -> tuple[str, ...]:
    return tuple(x.outcome for x in card.outcomes if x is not o)


def card_problems(card: PaperCard, source: str, threshold: int) -> list[str]:
    problems = _sample_size_problems(card, source, threshold)
    for o in card.outcomes:
        problems += outcome_problems(o, source, threshold, _others(card, o))
    return problems + free_text_problems(card, source, threshold)


def _mask_unverified(text: str, allowed: set[Decimal | str], comma_decimals: bool | None = None) -> str:
    """Replace each number that is not allowed by "[unverified]"; everything else stays as written."""
    out, last = [], 0
    for t in _tokens(text, comma_decimals):
        if t.key not in allowed:
            out += [text[last:t.start], "[unverified]"]
            last = t.end
    return "".join(out) + text[last:]


def _quote_is_faithful(quote: str | None, source: str, threshold: int) -> bool:
    """The quote is found and numerically verbatim: its ordered numbers are the window's (no altered digit)."""
    m = _match(quote, source, threshold)
    return m is not None and m.exact is not None


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


def _fix_result(before: OutcomeResult, o: OutcomeResult, source: str, threshold: int) -> OutcomeResult:
    """`result` may only use numbers of the quote's source window, never a value nulled from this outcome."""
    comma = _comma_decimals(source)
    nulled = {_dec(getattr(before, k)) for k in NUMERIC_FIELDS
              if getattr(before, k) is not None and getattr(o, k) is None}
    allowed = _prose_allowed(o.evidence_quote, source, threshold) - nulled
    if not _unverified(o.result, allowed, comma):
        return o
    use_quote = (_quote_is_faithful(o.evidence_quote, source, threshold)
                 and not _values(o.evidence_quote, comma) & nulled)
    return o.model_copy(update={"result": o.evidence_quote if use_quote else _mask_unverified(o.result, allowed,
                                                                                               comma)})


def null_unverified_numbers(card: PaperCard, source: str, threshold: int) -> tuple[PaperCard, int, int]:
    """Blank every number that failed verification so it can never reach a forest plot or the table.

    Fields are blanked one at a time: an unverifiable p-value never blanks a verified effect or CI.
    Counts are per unit (each outcome that carries numbers, plus the sample size), so the stored rate stays
    comparable with older reviews. An outcome counts as verified when its estimate survives (its effect_value, or,
    for an outcome without one, any of its numbers). The unverified units are exactly the `unverified` list that
    reading.py derives, so numbers_total - numbers_verified == len(unverified)."""
    verified = total = 0
    outcomes = []
    comma = _comma_decimals(source)
    for before in card.outcomes:
        o = before
        had_effect = o.effect_value is not None
        if any(getattr(o, k) is not None for k in NUMERIC_FIELDS):
            total += 1
            failed = {k for fields, _ in outcome_failures(o, source, threshold, _others(card, before))
                      for k in fields}
            if failed:
                o = _null_fields(o, failed)
            verified += (o.effect_value is not None) if had_effect else any(getattr(o, k) is not None
                                                                             for k in NUMERIC_FIELDS)
        outcomes.append(_fix_result(before, o, source, threshold))
    src = _values(source, comma)
    update: dict = {"outcomes": outcomes,
                    "key_findings": [f for f in card.key_findings if not _unverified(f, src, comma)]}
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


# "T2DM" / "T1D" carry the type number inside a word (not a number token); Thai spells it out as "ชนิดที่ 2" (I-23).
_GLUED_DIABETES_TYPE = re.compile(r"\bT([12])DM?\b")
_THAI_TYPE_NUMBER = re.compile(r"ชนิดที่\s*([12])(?![\d.,])")


def numbers_preserved(source: str, translated: str) -> bool:
    """Translation must keep every number exactly as written ("0.80" may not become "0.8"). The one allowed
    addition: a diabetes type spelled out ("T2DM" → "เบาหวานชนิดที่ 2"), only for a digit the source carries inside
    such an abbreviation, at most as often as the source has it. Nothing may be dropped or changed."""
    src, dst = Counter(number_tokens(source)), Counter(number_tokens(translated))
    if src == dst:
        return True
    if src - dst:
        return False
    glued = Counter(_GLUED_DIABETES_TYPE.findall(source))
    spelled = Counter(_THAI_TYPE_NUMBER.findall(translated))
    return all(n <= min(glued[k], spelled[k]) for k, n in (dst - src).items())
