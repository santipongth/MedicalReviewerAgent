"""Trial names and reports of the same trial (Plan 20 Task 10).

Two uses of the same text signals:
- recall: the trial acronyms that the first search round names are searched once more (retrieval.make_search);
- duplicate reports: a trial's primary paper, a commentary on it and its subgroup analyses are one study. Only one
  of them (the primary report) is evidence for consensus, conflicts, the grade, pools and every k; the others stay in
  the paper list as related reports linked to it (`related_reports`).

A trial is recognised by a registry number (NCT########, ISRCTN########) or by an acronym written in a trial context:
followed by trial/study/programme/investigators/ClinicalTrials.gov, in brackets after "trial"/"study", or opening the
title before a colon ("EMPEROR-Preserved: ..."). An acronym needs at least 4 capitals and is never a generic
abbreviation (COVID-19, NHANES, HFpEF, CVOT, ...)."""
from __future__ import annotations

import re
from typing import Any

from rapidfuzz import fuzz

from app.harness.design import POOLED_CATEGORIES
from app.harness.meta import first_author_surname
from app.services.text import normalize_title

ACRONYM = (r"[A-Z][A-Z0-9]{2,}(?:[-–][A-Za-z0-9]+)*(?:\s(?:TIMI\s)?\d{1,3}\b)?"
           r"(?:\s(?:OUTCOMES?|PROGRAM(?:ME)?)\b)?")
_IN_CONTEXT = re.compile(
    rf"({ACRONYM})\s*\)?\s*(?i:trials?|study|studies|programme|program|investigators|ClinicalTrials)\b")
_IN_BRACKETS = re.compile(rf"\b(?i:trial|study)\s*\(({ACRONYM})\)")
_TITLE_LEAD = re.compile(rf"^\s*({ACRONYM})\s*:")
_REGISTRY = re.compile(r"\b(NCT\d{8}|ISRCTN\s?\d{8})\b")
NOT_TRIAL_NAMES = frozenset({"OUTCOME", "OUTCOMES", "CVOT", "CVOTS", "RCT", "RCTS", "NYHA", "HFPEF", "HFREF",
                             "HFMREF", "LVEF", "COVID", "COVID-19", "SARS", "MACE", "KCCQ", "PRISMA", "GRADE",
                             "NHANES", "SEER", "MIMIC", "NIH", "WHO", "FDA", "EMA", "NICE", "AHA", "ESC"})


def trial_key(name: str) -> str:
    """One spelling per trial name: "EMPEROR Reduced", "EMPEROR-reduced" and "EMPEROR–Reduced" are one key."""
    return re.sub(r"[\s\-–]+", "-", name.strip()).upper()


def _clean(name: str) -> str:
    return re.sub(r"\s+", " ", name.replace("–", "-")).strip()


def _is_name(name: str) -> bool:
    key = trial_key(name)
    return not (key in NOT_TRIAL_NAMES or key.split("-")[0] in NOT_TRIAL_NAMES
                or sum(ch.isupper() for ch in name) < 4 or re.search(r"\d{5,}", name))


def trial_acronyms(title: str | None, abstract: str | None = None) -> list[str]:
    """The trial acronyms named in a trial context, in text order, each once (as first written)."""
    text = f"{title or ''}. {abstract or ''}"
    matches = sorted((m.start(1), m.group(1)) for pattern in (_IN_CONTEXT, _IN_BRACKETS)
                     for m in pattern.finditer(text))
    lead = _TITLE_LEAD.match(title or "")
    if lead:
        matches.insert(0, (-1, lead.group(1)))
    out: dict[str, str] = {}
    for _, name in matches:
        name = _clean(name)
        if _is_name(name):
            out.setdefault(trial_key(name), name)
    return list(out.values())


def registry_ids(title: str | None, abstract: str | None = None) -> list[str]:
    return list(dict.fromkeys(m.replace(" ", "").upper()
                              for m in _REGISTRY.findall(f"{title or ''} {abstract or ''}")))


# ---- reports of the same trial ---------------------------------------------------------------------------------
# Titles of reports that are not a trial's primary results.
SECONDARY_REPORT = re.compile(
    r"\b(sub-?group|sub-?stud(y|ies)|post[- ]?hoc|secondary analys|exploratory analys|pre-?specified analys|"
    r"according to|by baseline|insights? from|lessons from|commentary|editorial|perspective|breakthrough|"
    r"rationale and design|design and rationale|baseline characteristics|protocol|review|"
    r"in patients with and without|across the spectrum|participant-level)\b", re.IGNORECASE)
TITLE_MATCH = 90  # near-identical titles (rapidfuzz ratio on normalised titles)


def _ids(paper: dict[str, Any]) -> tuple[set[str], int]:
    """(trial identifiers, number of distinct acronyms) of one paper."""
    c = paper.get("candidate") or {}
    names = trial_acronyms(c.get("title"), c.get("abstract"))
    ids = {f"name:{trial_key(n)}" for n in names}
    ids |= {f"reg:{r}" for r in registry_ids(c.get("title"), c.get("abstract"))}
    return ids, len(names)


def _label(ident: str, spelled: dict[str, str]) -> str:
    kind, value = ident.split(":", 1)
    return spelled.get(value, value) if kind == "name" else value


def _primary_score(paper: dict[str, Any]) -> tuple:
    card = paper.get("card") or {}
    c = paper.get("candidate") or {}
    types = {t.strip().lower() for t in c.get("pub_types") or []}
    estimates = sum(1 for o in card.get("outcomes") or []
                    if o.get("effect_value") is not None and o.get("ci_lower") is not None)
    year = c.get("year") if isinstance(c.get("year"), int) else 10**4
    n = card.get("sample_size") if isinstance(card.get("sample_size"), int) else 0
    ref = paper.get("ref") or ""
    return (not SECONDARY_REPORT.search(c.get("title") or ""),
            card.get("design_category") == "rct",
            bool(types & {"randomized controlled trial", "clinical trial", "clinical trial, phase iii"}),
            estimates, n, -year, -(int(ref[1:]) if ref[1:].isdigit() else 10**6))


def related_reports(papers: list[dict[str, Any]]) -> dict[str, dict[str, str]]:
    """Reports of the same study, by trial: {ref of a related report: {"primary": ref, "reason": text}}.

    Two papers report the same trial when they share a trial acronym or a registry number (a paper naming two or more
    trial acronyms is a multi-trial report and never links trials together), or when their titles are near-identical
    (ratio >= 90) with the same first author and years at most one apart. Systematic reviews / meta-analyses are never
    grouped (they name many trials). Of each group the primary report is kept: a title that is not a subgroup,
    post hoc, commentary or design paper, then an RCT design, an RCT publication type, more estimates with a CI, a
    larger sample, the earlier year and the lower ref. Pure: papers are {"ref", "candidate", "card"}."""
    eligible = [p for p in papers if p.get("card") and p.get("ref")
                and (p["card"].get("design_category") not in POOLED_CATEGORIES)]
    parent = {p["ref"]: p["ref"] for p in eligible}

    def find(r: str) -> str:
        while parent[r] != r:
            parent[r] = parent[parent[r]]
            r = parent[r]
        return r

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    reason: dict[frozenset[str], str] = {}
    owner: dict[str, str] = {}
    spelled: dict[str, str] = {}
    for p in eligible:
        c = p.get("candidate") or {}
        for n in trial_acronyms(c.get("title"), c.get("abstract")):
            spelled.setdefault(trial_key(n), n)
        ids, n_names = _ids(p)
        if n_names > 1:  # a multi-trial report: only its own single registry number may link it
            registries = {i for i in ids if i.startswith("reg:")}
            ids = registries if len(registries) == 1 else set()
        for ident in sorted(ids):
            if ident in owner:
                reason.setdefault(frozenset({owner[ident], p["ref"]}), f"same trial ({_label(ident, spelled)})")
                union(owner[ident], p["ref"])
            else:
                owner[ident] = p["ref"]
    titles = {p["ref"]: normalize_title((p.get("candidate") or {}).get("title")) for p in eligible}
    for i, a in enumerate(eligible):
        for b in eligible[i + 1:]:
            ca, cb = a.get("candidate") or {}, b.get("candidate") or {}
            ya, yb = ca.get("year"), cb.get("year")
            if (titles[a["ref"]] and titles[b["ref"]]
                    and isinstance(ya, int) and isinstance(yb, int) and abs(ya - yb) <= 1
                    and first_author_surname(ca.get("authors"))
                    and first_author_surname(ca.get("authors")) == first_author_surname(cb.get("authors"))
                    and fuzz.ratio(titles[a["ref"]], titles[b["ref"]]) >= TITLE_MATCH):
                reason.setdefault(frozenset({a["ref"], b["ref"]}),
                                  "near-identical title, same first author and year")
                union(a["ref"], b["ref"])
    groups: dict[str, list[dict[str, Any]]] = {}
    for p in eligible:
        groups.setdefault(find(p["ref"]), []).append(p)
    out: dict[str, dict[str, str]] = {}
    for members in groups.values():
        if len(members) < 2:
            continue
        primary = max(members, key=_primary_score)["ref"]
        for p in members:
            if p["ref"] == primary:
                continue
            why = next((text for pair, text in reason.items() if p["ref"] in pair), "same trial")
            out[p["ref"]] = {"primary": primary, "reason": why}
    return out
