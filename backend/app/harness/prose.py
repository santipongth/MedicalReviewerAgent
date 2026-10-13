"""Grounded prose (Plan 19, audit I-2b/I-2c): deterministic checks on the executive summary, the evidence rationale
and the conflict explanations, the free text the narrative model writes about the cards.

Checks, sentence by sentence. A sentence's scope is the papers it cites ([P2, P4]); a sentence that cites none is
checked against every paper. Sentences split at . ! ? before an uppercase letter or "[", never after "vs.", "e.g.",
"i.e.", "Fig.", "et al.", "approx." or "cf.".
- Numbers. Every number must trace to one of:
  - the scope's verified card numbers, taken from the outcomes that answer the question only (an other-comparison
    estimate is never support): surviving numeric fields, sample size, the numbers of their verified `result` and
    `effect_size` texts, and the `key_findings` numbers that are not other-comparison numbers;
  - a pooled value (`ComputedNumber`), a CI level written "95%", or a count written as a count: an integer
    followed by a study or outcome noun ("3 trials", "2 of the 4 included reviews") that is at most the number of
    papers or a pipeline count (matrix rows and cells, consensus and pool sizes). Any other integer ("prevented 12
    deaths", "a 15-year follow-up") must trace to a card like a decimal;
  - the search and selection counts, only in a sentence about the search (records, screened, included, ...);
  - context: the question and PICO text and the cited papers' titles, years, population, intervention, comparator,
    and matching outcome and comparison names. A context number admits a percentage only when the context wrote it as
    one ("type 2" never admits "2%" or "2 percent"; "ejection fraction of more than 40%" admits "40%"). "percent",
    "per cent" and "percentage points" count as "%".
  Anything else, e.g. a rounded, derived or invented number, fails.
- Measure names. A named measure (odds ratio/OR, risk ratio/relative risk/RR, hazard ratio/HR, risk difference/RD,
  mean difference/MD, standardized mean difference/SMD; never "relative risk reduction") must be the card's
  `effect_measure` of the estimates it introduces (the numbers after it, up to the next measure name), else one of the
  scope's measures. A bare abbreviation is judged only when it introduces a card estimate ("OR" may be the operating
  room, "HR" heart rate, "MD" a doctor). A wrong name is rewritten only when a number follows it within 5 words: to
  the right measure when the estimates share one, else to the neutral "effect estimate". Otherwise the sentence is
  removed (a rewrite there would only produce another wrong phrase).
- Populations. A sentence that ascribes a subgroup (reduced vs preserved/mildly reduced ejection fraction, type 1 vs
  type 2 diabetes, children vs adults) to a cited paper fails when that paper's title or population names the
  opposite subgroup and not the claimed one. A sentence that names both subgroups (a comparison) is not judged.

`prose_problems` lists the failures as repair messages for the harness runner; `fix_prose` corrects measure names
and removes every sentence that still fails, never inventing a replacement number.

Numberless fields (Plan 20: the direct answer and the key-finding statements) are stricter: `statement_problems` and
`fix_statement` admit only context numbers ("type 2 diabetes"), never a card estimate, pooled value or count, because
the report renders those numbers from the verified cards and the computed pools beside the text.

Why deterministic and not an LLM claim check: these checks cost nothing, cannot hallucinate, run identically on every
review and are unit-tested on the audit's real failures. A bounded LLM check through the runner would add a call per
review on the budget model, which is the model that wrote the error. The population check is lexical and covers only
the subgroups listed in `_SUBGROUPS`; other claims are left to the narrative prompt rules.
"""
from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any

from app.harness.comparison import answers_question
from app.harness.verify import CI_LEVELS, NUMERIC_FIELDS, Tok
from app.harness.verify import to_decimal as _dec
from app.harness.verify import tokens as _tokens

# A sentence ends at . ! or ? followed by space and an uppercase letter or "[" (as in meta.strip_pooled_numbers),
# but not after a common abbreviation ("vs. Placebo", "e.g. Smith", "Fig. 2").
_SENTENCE = re.compile(r"(?<=[.!?])(?<!\bvs\.)(?<!\bVs\.)(?<!\be\.g\.)(?<!\bi\.e\.)(?<!\bFig\.)(?<!\bfig\.)"
                       r"(?<!\bet al\.)(?<!\bapprox\.)(?<!\bcf\.)\s+(?=[A-Z\[])")
_BRACKETS = re.compile(r"\[([^\]]*)\]")
_REF = re.compile(r"\bP\d+\b")

_MEASURE_PATTERNS: tuple[tuple[str, str], ...] = (
    ("SMD", r"(?i:standardi[sz]ed mean differences?)|\bSMDs?\b"),
    ("MD", r"(?i:(?<!standardized )(?<!standardised )\bmean differences?)|\bW?MDs?\b"),
    ("RD", r"(?i:\brisk differences?)|\bRDs?\b"),
    ("HR", r"(?i:\bhazard ratios?)|\ba?HRs?\b"),
    ("OR", r"(?i:\bodds ratios?)|\ba?ORs?\b"),
    ("RR", r"(?i:\b(?:relative risks?|risk ratios?|rate ratios?)(?! reduction))|\ba?I?RRs?\b"),
)
_MEASURE = re.compile("|".join(f"(?P<{m}>{p})" for m, p in _MEASURE_PATTERNS))
_NAMES = {"HR": "hazard ratio", "OR": "odds ratio", "RR": "risk ratio", "RD": "risk difference",
          "MD": "mean difference", "SMD": "standardized mean difference"}
KNOWN_MEASURES = frozenset(_NAMES)
GENERIC = "effect estimate"
NEAR_WORDS = 5  # a measure name is rewritten only when a number follows within this many words
_WORDS = re.compile(r"[^\W\d_]+")
# A sentence about the search may state the search and selection counts.
_SEARCH = re.compile(r"(?i)\b(?:search\w*|records?|identified|retrieved|screen\w*|candidates?|abstracts?|"
                     r"included|selected|excluded|databases?|duplicates?|found|hits)\b")

# "reduced and preserved ejection fraction" names both; "mildly reduced" is never reduced ejection fraction
_EF = r"(?:left[- ]ventricular )?ejection fraction"
_HFREF = (r"\bHFrEF\b|(?i:(?<!mildly )\breduced (?:(?:and|or) (?:mildly reduced|preserved) )?" + _EF + "|"
          r"ejection fraction (?:of )?(?:≤|<=|<|less than|below|(?:of )?at most|up to)\s*(?:35|40)\s*%|"
          r"ejection fraction (?:of )?(?:35|40)\s*% or (?:less|lower|below))")
_HFPEF = (r"\bHFpEF\b|\bHFmrEF\b|(?i:\bpreserved (?:(?:and|or) (?:mildly )?reduced )?" + _EF + "|"
          r"\bmildly reduced (?:(?:and|or) preserved )?" + _EF + "|"
          r"ejection fraction (?:of )?(?:>|≥|>=|more than|greater than|above|over|(?:of )?at least)\s*(?:40|45|50)\s*%|"
          r"ejection fraction (?:of )?(?:40|45|50)\s*% or (?:more|higher|greater|above))")
_T1D = r"(?i:\btype\s*(?:1|I)(?![I\d])\s*diabetes)|\bT1DM?\b"
_T2D = r"(?i:\btype\s*(?:2|II)(?![I\d])\s*diabetes)|\bT2DM?\b"
_CHILD = r"(?i:\b(?:children|child|paediatric|pediatric|adolescents?|infants?|neonates?|newborns?)\b)"
_ADULT = r"(?i:\badults?\b)"
# (claimed subgroup, how a claim is recognised, how the opposite subgroup is recognised)
_SUBGROUPS: tuple[tuple[str, re.Pattern[str], re.Pattern[str], str], ...] = tuple(
    (label, re.compile(claim), re.compile(opposite), opposite_label) for label, claim, opposite, opposite_label in (
        ("reduced ejection fraction", _HFREF, _HFPEF, "preserved or mildly reduced ejection fraction"),
        ("preserved or mildly reduced ejection fraction", _HFPEF, _HFREF, "reduced ejection fraction"),
        ("type 1 diabetes", _T1D, _T2D, "type 2 diabetes"),
        ("type 2 diabetes", _T2D, _T1D, "type 1 diabetes"),
        ("children", _CHILD, _ADULT, "adults"),
        ("adults", _ADULT, _CHILD, "children"),
    ))

Key = Decimal | str


# "18%", "18 percent", "18 per cent" and "18 percentage points" are all percentages ("type 2" never admits any).
_PCT = re.compile(r"\s*(?:%|(?i:per\s?cent(?:age points?)?\b))")
# A study count: the integer is followed by a study noun, at most two qualifiers apart ("3 randomised controlled
# trials", "2 of the 4 included reviews"); "12 deaths" or "15-year follow-up" is no count.
_QUALIFIER = (r"(?:included|eligible|randomi[sz]ed|controlled|clinical|observational|prospective|retrospective|"
              r"population-based|placebo-controlled|primary|large|small|independent|separate|other|more|additional|"
              r"further|systematic|published|individual|selected|relevant|cohort|case-control|cross-sectional|"
              r"quantitative|qualitative|of|the|these|those|out|phase|I{1,3}|IV|\d+)")
_COUNT_NOUN = re.compile(rf"\s+(?:{_QUALIFIER}\s+){{0,3}}?(?i:stud(?:y|ies)|trials?|rcts?|papers?|reviews?|"
                         r"cohorts?|articles?|meta-analys[ie]s|analyses|reports?|publications?|outcomes?)\b",
                         re.IGNORECASE)


_LABEL_BEFORE = re.compile(r"(?i:\b(?:fig\.|figure|table|panel))\s*$")  # "Fig. 2" labels, it states no fact


def _is_pct(t: Tok, text: str) -> bool:
    return bool(_PCT.match(text, t.end))


def _counts_studies(t: Tok, sentence: str) -> bool:
    return bool(_COUNT_NOUN.match(sentence, t.end))


@dataclass
class ContextNumbers:
    """Numbers written in descriptive text: `plain` may be restated only without "%", `pct` (written as a
    percentage there) also as a percentage."""
    plain: set[Key] = field(default_factory=set)
    pct: set[Key] = field(default_factory=set)

    def add(self, text: str | None) -> None:
        for t in _tokens(text) if text else ():
            (self.pct if _is_pct(t, text) else self.plain).add(t.key)

    def admits(self, t: Tok, sentence: str) -> bool:
        return t.key in self.pct or (t.key in self.plain and not _is_pct(t, sentence))


@dataclass
class RefFacts:
    """What one paper's card lets the prose say."""
    numbers: set[Key] = field(default_factory=set)  # verified numbers of the outcomes that answer the question
    context: ContextNumbers = field(default_factory=ContextNumbers)  # title, year, population, ...
    measures_by_value: dict[Decimal, set[str]] = field(default_factory=dict)  # estimate or CI bound -> measures
    measures: set[str] = field(default_factory=set)  # every known effect_measure of the matching outcomes
    population: str = ""  # title + population text, for the subgroup check


@dataclass
class ProseContext:
    facts: dict[str, RefFacts]
    allowed: set[Key] = field(default_factory=set)  # pooled values (and the year limit), any form
    context: ContextNumbers = field(default_factory=ContextNumbers)  # the review question's text
    search: set[Key] = field(default_factory=set)  # search/selection counts: only in a sentence about the search
    max_count: int = 0  # integers 1..max_count followed by a study noun ("3 trials") are counts of studies
    counts: set[Key] = field(default_factory=set)  # pipeline counts (rows, cells, ...): only as a count ("3 outcomes")


def _keys(text: str | None) -> set[Key]:
    return {t.key for t in _tokens(text)} if text else set()


def _card_facts(card: dict[str, Any], title: str | None, year: Any) -> RefFacts:
    f = RefFacts(population=" ".join(x for x in (title, card.get("population")) if x))
    for text in (title, card.get("population"), card.get("intervention_or_exposure"), card.get("comparator"),
                 card.get("study_design"), None if year is None else str(year)):
        f.context.add(text)
    if card.get("sample_size") is not None:
        f.numbers.add(_dec(card["sample_size"]))
    other: set[Key] = set()
    for o in card.get("outcomes") or []:
        values = {d for k in NUMERIC_FIELDS if o.get(k) is not None and (d := _dec(o[k])) is not None}
        if not answers_question(o):  # another comparison: its numbers never support the prose
            other |= values | _keys(o.get("result")) | _keys(o.get("effect_size"))
            continue
        f.context.add(o.get("outcome"))
        f.context.add(o.get("comparison"))
        f.numbers |= values | _keys(o.get("result")) | _keys(o.get("effect_size"))
        measure = o.get("effect_measure")
        if measure in KNOWN_MEASURES:
            f.measures.add(measure)
            for k in ("effect_value", "ci_lower", "ci_upper"):
                if o.get(k) is not None and (d := _dec(o[k])) is not None:
                    f.measures_by_value.setdefault(d, set()).add(measure)
    for finding in card.get("key_findings") or []:
        f.numbers |= {k for k in _keys(finding) if k not in other or k in f.numbers}
    f.numbers.discard(None)
    return f


def paper_facts(papers: Iterable[dict[str, Any]]) -> dict[str, RefFacts]:
    """Facts per ref from graph papers ({"ref", "candidate", "card"}) or prompt briefs ({"ref", "title", "card"})."""
    out: dict[str, RefFacts] = {}
    for p in papers:
        card = p.get("card")
        if not card:
            continue
        cand = p.get("candidate") or {}
        out[p["ref"]] = _card_facts(card, p.get("title") or cand.get("title"), p.get("year") or cand.get("year"))
    return out


def _values(values: Iterable[Any]) -> set[Key]:
    out: set[Key] = set()
    for v in values:
        if isinstance(v, str):
            try:
                out.add(Decimal(v if not v.startswith(".") else "0" + v))
            except InvalidOperation:
                continue
        elif isinstance(v, int | float) and not isinstance(v, bool) and (d := _dec(v)) is not None:
            out.add(d)
    return out


def prose_context(papers: Iterable[dict[str, Any]], *, texts: Iterable[str | None] = (), values: Iterable[Any] = (),
                  search: Iterable[Any] = (), max_count: int | None = None,
                  counts: Iterable[Any] = ()) -> ProseContext:
    """`texts`: the review's own text (question, PICO, GRADE-lite factors); `values`: pooled values (numbers or their
    display strings), admitted in any form; `search`: search and selection counts; `max_count`: defaults to the
    number of papers; `counts`: pipeline counts, admitted only as counts (followed by a study or outcome noun)."""
    facts = paper_facts(papers)
    context = ContextNumbers()
    for t in texts:
        context.add(t)
    return ProseContext(facts=facts, allowed=_values(values), context=context, search=_values(search),
                        max_count=len(facts) if max_count is None else max_count, counts=_values(counts))


@dataclass
class _Issues:
    numbers: list[str] = field(default_factory=list)
    # start, end, written, fix (None: no number follows, so the sentence is removed), refs
    measures: list[tuple[int, int, str, str | None, str]] = field(default_factory=list)
    population: list[tuple[str, str, str]] = field(default_factory=list)  # claimed, ref, opposite


def _scope(sentence: str, ctx: ProseContext) -> list[str]:
    cited = [r for g in _BRACKETS.findall(sentence) for r in _REF.findall(g) if r in ctx.facts]
    return list(dict.fromkeys(cited)) or list(ctx.facts)


def _is_count(t: Tok, sentence: str, ctx: ProseContext) -> bool:
    """An integer that counts studies or outcomes: written as a count ("3 trials", "2 of the 4 reviews") and either
    at most the number of papers or a pipeline count. Any other integer ("12 deaths", "a 15-year follow-up") must
    trace to a card like every other number."""
    if not (t.integer and not t.opaque and t.value > 0) or _is_pct(t, sentence) or not _counts_studies(t, sentence):
        return False
    return t.value <= ctx.max_count or t.key in ctx.counts


def _is_abbreviation(written: str) -> bool:
    return written[-1].isupper() or written[-2:-1].isupper()


def _replacement(written: str, measure: str | None) -> str:
    """The corrected name in the written form: an abbreviation stays an abbreviation, a plural stays plural."""
    plural = written.endswith("s") and not written.endswith("ss")
    if _is_abbreviation(written):
        text = measure if measure else "estimate"
    else:
        text = _NAMES[measure] if measure else GENERIC
        if written[0].isupper():
            text = text[0].upper() + text[1:]
    return text + ("s" if plural else "")


def _number_follows(sentence: str, end: int, toks: tuple[Tok, ...]) -> bool:
    return any(t.start >= end and len(_WORDS.findall(sentence[end:t.start])) <= NEAR_WORDS for t in toks)


def _measure_issues(sentence: str, refs: list[str], ctx: ProseContext,
                    toks: tuple[Tok, ...]) -> list[tuple[int, int, str, str | None, str]]:
    mentions = list(_MEASURE.finditer(sentence))
    if not mentions:
        return []
    by_value: dict[Decimal, set[str]] = {}
    known: set[str] = set()
    for r in refs:
        f = ctx.facts[r]
        known |= f.measures
        for v, ms in f.measures_by_value.items():
            by_value.setdefault(v, set()).update(ms)
    out = []
    for i, m in enumerate(mentions):
        named = m.lastgroup
        end = mentions[i + 1].start() if i + 1 < len(mentions) else len(sentence)
        bound = [by_value[t.value] for t in toks
                 if m.end() <= t.start < end and not t.opaque and t.value in by_value]
        if bound:
            if all(named in ms for ms in bound):
                continue
            common = set.intersection(*bound)
            target = next(iter(common)) if len(common) == 1 else None
        else:
            if not known or named in known:
                continue  # nothing to check against (blanked or unreported measures), or a measure the papers use
            if _is_abbreviation(m.group(0)):
                continue  # a bare "OR", "HR" or "MD" may be the operating room, heart rate or a doctor
            target = next(iter(known)) if len(known) == 1 else None
        written = m.group(0)
        fix = _replacement(written, target) if _number_follows(sentence, m.end(), toks) else None
        out.append((m.start(), m.end(), written, fix, ", ".join(refs)))
    return out


def _population_issues(sentence: str, refs: list[str], ctx: ProseContext, cited: bool) -> list[tuple[str, str, str]]:
    if not cited:
        return []
    out = []
    for label, claim, opposite, opposite_label in _SUBGROUPS:
        if not claim.search(sentence) or opposite.search(sentence):
            continue
        for r in refs:
            text = ctx.facts[r].population
            if opposite.search(text) and not claim.search(text):
                out.append((label, r, opposite_label))
    return out


def _admitted(t: Tok, sentence: str, refs: list[str], ctx: ProseContext, about_search: bool) -> bool:
    if t.key in ctx.allowed or ctx.context.admits(t, sentence) or _is_count(t, sentence, ctx):
        return True
    if about_search and t.key in ctx.search:
        return True
    if t.value in CI_LEVELS and _is_pct(t, sentence):
        return True
    if t.integer and _LABEL_BEFORE.search(sentence, 0, t.start):
        return True
    return any(t.key in ctx.facts[r].numbers or ctx.facts[r].context.admits(t, sentence) for r in refs)


def _analyse(sentence: str, ctx: ProseContext) -> _Issues:
    refs = _scope(sentence, ctx)
    cited = any(_REF.findall(g) for g in _BRACKETS.findall(sentence))
    toks = _tokens(sentence)
    about_search = bool(_SEARCH.search(sentence))
    issues = _Issues()
    issues.numbers = [t.text for t in toks if not _admitted(t, sentence, refs, ctx, about_search)]
    issues.measures = _measure_issues(sentence, refs, ctx, toks)
    issues.population = _population_issues(sentence, refs, ctx, cited)
    return issues


def unverified_numbers(sentence: str, refs: list[str], ctx: ProseContext) -> list[str]:
    """Plan 25: the numbers of `sentence` that trace to none of `refs`' verified card numbers, the review's own text,
    a pooled value or a count (the rule `prose_problems` applies to the summary). An empty scope is every paper."""
    scope = [r for r in refs if r in ctx.facts] or list(ctx.facts)
    about_search = bool(_SEARCH.search(sentence))
    return [t.text for t in _tokens(sentence) if not _admitted(t, sentence, scope, ctx, about_search)]


_LEADING_CITES = re.compile(r"^(?:\s*\[\s*P\d+[^\]]*\])+")
_CITES_AFTER_STOP = re.compile(r"^(?P<body>.*?)(?P<stop>[.!?])\s*(?P<cites>(?:\s*\[\s*P\d+[^\]]*\])+)\s*$", re.DOTALL)


def _sentences(text: str) -> list[str]:
    """The sentences of `text`. A citation group written after the stop ("... (HR 0.55). [P1]") belongs to the sentence
    before it when that sentence cites nothing else, and is moved inside its stop ("... (HR 0.55) [P1].") so the
    sentence is checked against its own papers, not every paper (Plan 30; as the quick writer does)."""
    if not text or not text.strip():
        return []
    out: list[str] = []
    for piece in _SENTENCE.split(text.strip()):
        lead = _LEADING_CITES.match(piece)
        rest = piece[lead.end():].strip() if lead else ""
        bare = not re.search(r"\w", rest)  # nothing left, or only punctuation
        if lead and out and (bare or (not _REF.search(out[-1]) and rest[:1].isupper())):
            m = _CITES_AFTER_STOP.match(f"{out[-1]} {lead.group(0).strip()}")
            out[-1] = f"{m['body'].rstrip()} {m['cites'].strip()}{m['stop']}" if m else f"{out[-1]} {lead.group(0).strip()}"
            piece = "" if bare else rest
        if piece:
            out.append(piece)
    return out


def _short(sentence: str) -> str:
    return sentence if len(sentence) <= 120 else sentence[:117] + "..."


def prose_problems(text: str, ctx: ProseContext, label: str = "text", *, fixable: bool = True) -> list[str]:
    """Repair messages for every sentence of `text` that fails a check. `fixable=False` leaves out what `fix_prose`
    corrects in code without losing the sentence (a wrong measure name before a number), so a repair round is spent
    only on problems code could only fix by deleting (final review finding 4: latency)."""
    problems: list[str] = []
    for sentence in _sentences(text):
        issues = _analyse(sentence, ctx)
        refs = ", ".join(_scope(sentence, ctx))
        if issues.numbers:
            problems.append(f"{label}: \"{_short(sentence)}\" states {', '.join(issues.numbers)}, which is not a "
                            f"verified number of the cited papers ({refs}); use only numbers shown on their cards, "
                            "exactly as given, or leave the number out")
        for _, _, written, fix, mrefs in issues.measures:
            if fix is not None and not fixable:
                continue
            wording = f" (correct wording: \"{fix}\")" if fix else ""
            problems.append(f"{label}: \"{_short(sentence)}\" names \"{written}\", which is not the effect_measure on "
                            f"the cards of {mrefs}{wording}; name each measure exactly as its card's effect_measure")
        for claimed, ref, opposite in issues.population:
            problems.append(f"{label}: \"{_short(sentence)}\" ascribes {claimed} to [{ref}], whose population is "
                            f"{opposite}; describe each paper's population as its card states")
    return problems


def _result_numbers(sentence: str, refs: list[str], ctx: ProseContext, toks: tuple[Tok, ...]) -> list[str]:
    """Numbers a numberless statement may not carry: everything except context numbers (the question and PICO text,
    the scope's titles, years, population, intervention, comparator and outcome names: "type 2 diabetes", "ejection
    fraction of more than 40%"). Card estimates, sample sizes, pooled values and counts are results, which the report
    renders from the cards and pools (Plan 20).
    Known gap: only numbers written in digits are tokens; number words ("three trials", "half", "thirty-two percent")
    are not caught here or anywhere in the prose check."""
    return [t.text for t in toks
            if not (ctx.context.admits(t, sentence) or any(ctx.facts[r].context.admits(t, sentence) for r in refs))]


def _statement_scope(refs: Iterable[str] | None, sentence: str, ctx: ProseContext) -> list[str]:
    scoped = [r for r in refs or () if r in ctx.facts]
    return list(dict.fromkeys(scoped)) or _scope(sentence, ctx)


def statement_problems(text: str, ctx: ProseContext, label: str, refs: Iterable[str] | None = None) -> list[str]:
    """Repair messages for a numberless field (the answer, a key-finding statement): any result number, and the
    population check, scoped to `refs` (else the sentence's citations, else every paper)."""
    problems: list[str] = []
    for sentence in _sentences(text):
        scope = _statement_scope(refs, sentence, ctx)
        numbers = _result_numbers(sentence, scope, ctx, _tokens(sentence))
        if numbers:
            problems.append(f"{label}: \"{_short(sentence)}\" states {', '.join(numbers)}; this field must contain no "
                            "numbers (the report shows the verified numbers next to it), so leave them out")
        for claimed, ref, opposite in _population_issues(sentence, scope, ctx, True):
            problems.append(f"{label}: \"{_short(sentence)}\" ascribes {claimed} to [{ref}], whose population is "
                            f"{opposite}; describe each paper's population as its card states")
    return problems


def fix_statement(text: str, ctx: ProseContext, refs: Iterable[str] | None = None) -> tuple[str, Counter[str]]:
    """The numberless variant of fix_prose for the answer and the key-finding statements (Plan 20): a sentence is
    removed when it states any number other than a context number, ascribes a population the scoped paper did not
    study, or names a wrong measure with no number after it; a wrong measure name before a number is corrected.
    The scope is `refs` (a key finding's refs), else the sentence's citations, else every paper."""
    counts: Counter[str] = Counter()
    kept: list[str] = []
    for sentence in _sentences(text):
        scope = _statement_scope(refs, sentence, ctx)
        toks = _tokens(sentence)
        if _result_numbers(sentence, scope, ctx, toks):
            counts["numbers_removed"] += 1
            continue
        if _population_issues(sentence, scope, ctx, True):
            counts["population_removed"] += 1
            continue
        measures = _measure_issues(sentence, scope, ctx, toks)
        if any(fix is None for *_, fix, _refs in measures):
            counts["measures_removed"] += 1
            continue
        for start, end, _written, fix, _refs in sorted(measures, reverse=True):
            sentence = sentence[:start] + fix + sentence[end:]
            counts["measures_fixed"] += 1
        kept.append(sentence)
    return " ".join(kept), counts


def fix_prose(text: str, ctx: ProseContext) -> tuple[str, Counter[str]]:
    """Correct measure names that introduce a number, then remove each sentence that still names a wrong measure,
    states an untraceable number or a population the cited paper did not study. Returns (text, counts:
    measures_fixed, measures_removed, numbers_removed, population_removed)."""
    counts: Counter[str] = Counter()
    kept: list[str] = []
    for sentence in _sentences(text):
        issues = _analyse(sentence, ctx)
        if issues.numbers:
            counts["numbers_removed"] += 1
            continue
        if issues.population:
            counts["population_removed"] += 1
            continue
        if any(fix is None for *_, fix, _refs in issues.measures):
            counts["measures_removed"] += 1
            continue
        for start, end, _written, fix, _refs in sorted(issues.measures, reverse=True):
            sentence = sentence[:start] + fix + sentence[end:]
            counts["measures_fixed"] += 1
        kept.append(sentence)
    return " ".join(kept), counts
