"""Sentence support (Plan 25): does the cited abstract support the sentence that cites it?

Claims are the English text before localization:
- each sentence of the executive summary that carries a citation group (`MARKER`, the groups the report links:
  "[P1]" or "[P1, P3]"); the k-th group of the summary is marker k, and every group of a sentence shares its claim;
- each key finding's statement with its refs (key finding i).

For every (claim, cited paper) pair the scorer picks, without an LLM, the abstract sentences closest to the claim
(content-word overlap with the claim, plus agreement on the claim's numbers) and keeps the best `CANDIDATES`. A judge
(app.graph.nodes.support) then labels the pair supported | partial | unsupported from those sentences only, never
from the whole abstract. The evidence shown is always a sentence copied from the abstract, chosen by index: the
judge never writes it.

The "ตรวจแล้ว" badge (`verified`) needs all of: the judge said supported, every number of the claim traces to a
verified number of the cited papers or to the review's own text (the prose check's rule, `prose.unverified_numbers`),
the claim restates no pooled value (a computed number is never supported by an abstract), and the paper is evidence
(not a further report of a trial, not a design outside the ticked study types).
"""
from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from pydantic import BaseModel

from app.graph.schemas import SupportBatch
from app.harness.prose import ProseContext, unverified_numbers
from app.harness.verify import tokens

LABELS = ("supported", "partial", "unsupported")
CANDIDATES = 2  # abstract sentences per pair sent to the judge
MAX_PAIRS = 30  # pairs judged per review; the rest keep their closest sentence, unjudged
MAX_CLAIM_CHARS = 600
MAX_SENTENCE_CHARS = 500
MIN_SENTENCE_CHARS = 20
MIN_SUPPORT_SCORE = 0.2  # a `supported` label on a candidate this far from the claim earns no badge

# The citation groups the report turns into links (frontend report-parts.tsx `CITE`): "[P1]" or "[P1, P3]". A range
# ("[P1-P3]") is not a link there, so it is no marker here either.
MARKER = re.compile(r"\[(P\d+(?:\s*,\s*P\d+)*)\]")
_REF = re.compile(r"P\d+")
# A sentence ends at . ! ? or a citation group before a capital letter (never before "[": a group after the full
# stop belongs to the sentence before it), not after a common abbreviation or an initial.
_CLAIM_END = re.compile(r"(?<=[.!?\]])\s+(?=[A-Z])")
_ABSTRACT_END = re.compile(r"(?<=[.!?])\s+(?=[A-Z(\[])|(?<![^\S\n])[^\S\n]*\n\s*")
_ABBREVIATION = re.compile(r"(?:\b(?:vs|Vs|et al|approx|Approx|Figs?|No|Nos|cf|e\.g|i\.e)|(?<![\w.])[A-Z])\.$")
_WORD = re.compile(r"[a-z][a-z0-9-]*")
_STOP = """
a about above after again against all also among an and any are as at be been before being between both but by can
could did do does during each either few for from further had has have having here how however if in into is it its
itself may might more most much must no nor not of on once only or other our out over own per same should so some
such than that the their them then there these they this those through to too under until up upon very was we were
what when where whether which while who whom why will with within without would yet
study studies trial trials paper papers patient patients participant participants result results reported report
reports showed show shows found find finding findings evidence associated association compared group groups
"""
STOPWORDS = frozenset(_STOP.split())


def markers(text: str | None) -> list[list[str]]:
    """The refs of each citation group of `text`, in order (the report's marker index is the list index)."""
    return [_REF.findall(m.group(1)) for m in MARKER.finditer(text or "")]


def _split(text: str, boundary: re.Pattern[str]) -> list[tuple[int, int]]:
    """(start, end) spans of the sentences of `text`, never split after an abbreviation or an initial."""
    spans: list[tuple[int, int]] = []
    start = 0
    for m in boundary.finditer(text):
        piece = text[start:m.start()]
        if piece.strip() and not _ABBREVIATION.search(piece.rstrip()):
            spans.append((start, m.start()))
            start = m.end()
        elif not piece.strip():
            start = m.end()
    if text[start:].strip():
        spans.append((start, len(text)))
    return spans


def abstract_sentences(abstract: str | None) -> list[str]:
    """The abstract's sentences, verbatim (whitespace at the edges trimmed), at least MIN_SENTENCE_CHARS long."""
    text = abstract or ""
    out = [text[a:b].strip() for a, b in _split(text, _ABSTRACT_END)]
    return [s for s in out if len(s) >= MIN_SENTENCE_CHARS]


def _stem(word: str) -> str:
    if len(word) > 4 and word.endswith("ies"):
        return word[:-3] + "y"
    if len(word) > 4 and word.endswith("s") and not word.endswith(("ss", "us", "is")):
        return word[:-1]
    return word


def content_words(text: str) -> set[str]:
    return {_stem(w) for w in _WORD.findall(MARKER.sub(" ", text).lower()) if len(w) >= 3 and w not in STOPWORDS}


def _numbers(text: str) -> set[Decimal | str]:
    return {t.key for t in tokens(text) if not t.opaque} if text else set()


def score(claim: str, sentence: str) -> float:
    """How close an abstract sentence is to a claim: the share of the claim's content words it has, and, when the
    claim states numbers, the share of those numbers it has (weighted 0.6 / 0.4)."""
    words = content_words(claim)
    overlap = len(words & content_words(sentence)) / len(words) if words else 0.0
    nums = _numbers(MARKER.sub(" ", claim))
    if not nums:
        return round(overlap, 4)
    return round(0.6 * overlap + 0.4 * len(nums & _numbers(sentence)) / len(nums), 4)


def best_sentences(claim: str, sentences: list[str], k: int = CANDIDATES) -> list[tuple[str, float]]:
    """The k sentences closest to the claim, best first (ties: the earlier sentence)."""
    ranked = sorted(enumerate(sentences), key=lambda p: (-score(claim, p[1]), p[0]))
    return [(s, score(claim, s)) for _, s in ranked[:k]]


def _clip(text: str, limit: int) -> str:
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


@dataclass
class Claim:
    id: str
    where: str  # "summary" | "key_finding"
    text: str  # the English sentence (summary: with its citation groups)
    refs: list[str]
    markers: list[int] | None = None  # summary: the marker indexes in this sentence
    finding: int | None = None  # key finding index


def summary_claims(summary: str | None) -> list[Claim]:
    """One claim per summary sentence that has a citation group; marker k is the k-th group of the whole text."""
    text = summary or ""
    groups = list(MARKER.finditer(text))
    out: list[Claim] = []
    k = 0
    for a, b in _split(text, _CLAIM_END):
        inside = [i for i, m in enumerate(groups) if a <= m.start() < b]
        if not inside:
            continue
        refs = list(dict.fromkeys(r for i in inside for r in _REF.findall(groups[i].group(1))))
        out.append(Claim(id=f"s{k}", where="summary", text=text[a:b].strip(), refs=refs, markers=inside))
        k += 1
    return out


def finding_claims(findings: Iterable[dict[str, Any]] | None) -> list[Claim]:
    return [Claim(id=f"k{i}", where="key_finding", text=(f.get("statement") or "").strip(),
                  refs=list(dict.fromkeys(f.get("refs") or [])), finding=i)
            for i, f in enumerate(findings or []) if (f.get("statement") or "").strip() and f.get("refs")]


def pooled_keys(strings: Iterable[str]) -> set[Decimal | str]:
    """Comparison keys of the pooled values' display strings (meta.pooled_number_strings)."""
    return {key for s in strings for key in _numbers(str(s))}


def claim_checks(claim: Claim, prose: ProseContext, pooled: set[Decimal | str]) -> tuple[bool, bool]:
    """(numbers_checked, computed). numbers_checked: every number of the claim traces to a verified number of the
    cited papers or to the review's own text (prose check rule). computed: the claim restates a pooled value that is
    no verified number of the cited papers."""
    text = MARKER.sub(" ", claim.text)
    refs = [r for r in claim.refs if r in prose.facts]
    own = set().union(*(prose.facts[r].numbers for r in refs)) if refs else set()
    computed = any(t.key in pooled and t.key not in own for t in tokens(text))
    return not unverified_numbers(text, refs, prose), computed


@dataclass
class Pair:
    id: str
    claim: Claim
    ref: str
    candidates: list[tuple[str, float]]


def build_pairs(claims: list[Claim], abstracts: dict[str, str | None], skip: set[str]) -> list[Pair]:
    """Every (claim, evidence paper) pair, summary first, in text order; a pair is made only for a paper with an
    abstract sentence. `skip`: refs never judged (not evidence) and claims never judged (computed)."""
    pairs: list[Pair] = []
    for claim in claims:
        if claim.id in skip:
            continue
        for ref in claim.refs:
            sentences = abstract_sentences(abstracts.get(ref))
            if ref in skip or not sentences:
                continue
            pairs.append(Pair(id=f"c{len(pairs) + 1}", claim=claim, ref=ref,
                              candidates=best_sentences(MARKER.sub(" ", claim.text), sentences)))
    return pairs


def judge_items(pairs: list[Pair]) -> list[dict[str, Any]]:
    return [{"id": p.id, "paper": p.ref, "claim": _clip(p.claim.text, MAX_CLAIM_CHARS),
             "candidates": [_clip(s, MAX_SENTENCE_CHARS) for s, _ in p.candidates]} for p in pairs]


def verdict_problems(value: BaseModel | Any, pairs: list[Pair]) -> list[str]:
    """Repair messages for a judge answer: one verdict per id, ids copied, a candidate number for supported and
    partial."""
    if not isinstance(value, SupportBatch):
        return ["answer with a JSON object that has a `verdicts` list (id, label, sentence)"]
    known = {p.id: len(p.candidates) for p in pairs}
    problems: list[str] = []
    seen: set[str] = set()
    for v in value.verdicts:
        if v.id not in known:
            problems.append(f"unknown id {v.id}; answer only for the ids given")
        elif v.id in seen:
            problems.append(f"id {v.id} answered twice; give one verdict per id")
        elif v.label != "unsupported" and not (v.sentence is not None and 1 <= v.sentence <= known[v.id]):
            problems.append(f"id {v.id}: sentence must name the supporting candidate (1 to {known[v.id]}) when the "
                            f"label is {v.label}")
        seen.add(v.id)
    missing = [i for i in known if i not in seen]
    if missing:
        problems.append(f"missing verdicts for {', '.join(missing)}; answer once for every id")
    return problems


def verdicts(value: Any, pairs: list[Pair]) -> dict[str, tuple[str, int | None]]:
    """The usable verdicts of a judge answer (also of one still invalid after repairs): id -> (label, candidate
    index or None). A verdict for an unknown id, a repeated id or a supported/partial verdict without a valid
    candidate is dropped (that pair stays unjudged)."""
    if not isinstance(value, SupportBatch):
        return {}
    known = {p.id: len(p.candidates) for p in pairs}
    out: dict[str, tuple[str, int | None]] = {}
    seen: set[str] = set()
    for v in value.verdicts:
        if v.id not in known or v.id in seen:
            out.pop(v.id, None)
            continue
        seen.add(v.id)
        if v.label == "unsupported":
            out[v.id] = (v.label, None)
        elif v.sentence is not None and 1 <= v.sentence <= known[v.id]:
            out[v.id] = (v.label, v.sentence - 1)
    return out


def citation(pair: Pair | None, ref: str, verdict: tuple[str, int | None] | None, *, numbers_checked: bool,
             computed: bool, not_evidence: bool) -> dict[str, Any]:
    """One cited paper of a claim, as stored in result.support. `evidence` is the supporting sentence (supported,
    partial) or else the closest sentence; `verified` is the badge rule."""
    label, index = verdict if verdict else (None, None)
    if index is not None and (pair is None or not 0 <= index < len(pair.candidates)):
        label, index = None, None  # a candidate that does not exist: unjudged, never the wrong sentence
    evidence = score_ = None
    if pair is not None and pair.candidates:
        evidence, score_ = pair.candidates[index if index is not None else 0]
        evidence = _clip(evidence, MAX_SENTENCE_CHARS)  # exactly the text the judge read
    return {"ref": ref, "label": label, "evidence": evidence, "score": score_, "not_evidence": not_evidence,
            "verified": bool(label == "supported" and numbers_checked and not computed and not not_evidence
                             and score_ is not None and score_ >= MIN_SUPPORT_SCORE)}


def claim_record(claim: Claim, citations: list[dict[str, Any]], *, numbers_checked: bool,
                 computed: bool) -> dict[str, Any]:
    return {"id": claim.id, "where": claim.where, "markers": claim.markers, "finding": claim.finding,
            "claim": claim.text, "refs": claim.refs, "numbers_checked": numbers_checked, "computed": computed,
            "citations": citations}
