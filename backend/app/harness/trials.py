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

from app.harness.design import NON_QUANTITATIVE_CATEGORIES, POOLED_CATEGORIES
from app.harness.meta import first_author_surname
from app.services.text import normalize_title

ACRONYM = (r"[A-Z][A-Z0-9]{2,}(?:[-–][A-Za-z0-9]+)*(?:\s(?:TIMI\s)?\d{1,3}\b)?"
           r"(?:\s(?:OUTCOMES?|PROGRAM(?:ME)?)\b)?")
# Task 10 review finding 1: a name is accepted only when it looks like a real trial name.
# - Distinctive: hyphenated, digit-bearing or mixed-case (DAPA-HF, EMPEROR-Reduced, EMPA-REG, DECLARE-TIMI 58): any
#   trial context below.
# - A plain all-caps word (DELIVER, CANVAS): only right before trial(s)/study/investigators/ClinicalTrials.gov, or
#   in brackets after a title-case phrase of at least 4 words ("... Trial in Chronic Heart Failure (EMPULSE)").
# Never from an all-caps title or an all-caps heading run (3+ consecutive all-caps words), and never a generic
# design/heading word or a disease, drug-class, biomarker or gene abbreviation (NOT_TRIAL_NAMES).
_IN_CONTEXT = re.compile(
    rf"({ACRONYM})\s*\)?\s*(?i:(trials?|study|studies|programme|program|investigators|ClinicalTrials))\b")
_STRICT_CONTEXT = frozenset({"trial", "trials", "study", "investigators", "clinicaltrials"})
_IN_BRACKETS = re.compile(rf"\b(?i:trial|study)\s*\(({ACRONYM})\)")
_AFTER_TITLE_PHRASE = re.compile(rf"((?:\b[A-Za-z][\w'-]*\s+){{4,}})\(({ACRONYM})\)")
_TITLE_LEAD = re.compile(rf"^\s*({ACRONYM})\s*:")
_CAPS_RUN = re.compile(r"\b[A-Z][A-Z0-9-]+(?:\s+[A-Z][A-Z0-9-]+){2,}\b")
_REGISTRY = re.compile(r"\b(NCT\d{8}|ISRCTN\s?\d{8})\b")
NOT_TRIAL_NAMES = frozenset({
    # outcomes, designs, scales, registries of data, bodies
    "OUTCOME", "OUTCOMES", "CVOT", "CVOTS", "RCT", "RCTS", "NYHA", "MACE", "KCCQ", "PRISMA", "GRADE", "NHANES",
    "SEER", "MIMIC", "NIH", "WHO", "FDA", "EMA", "NICE", "AHA", "ESC", "ADA", "EASD", "ACC", "KDIGO", "CONSORT",
    # bibliographic databases, registries and appraisal tools named in reviews
    "CENTRAL", "ICTRP", "MEDLINE", "EMBASE", "CINAHL", "PUBMED", "SCOPUS", "LILACS", "CDSR", "PROSPERO", "MMAT",
    "AMSTAR", "ROBINS", "ROBINS-I", "ROB", "ROB-2", "JBI", "CASP", "NOS", "STROBE", "QUADAS", "QUADAS-2",
    # generic design and abstract-heading words
    "CONTROLLED", "RANDOMIZED", "RANDOMISED", "MULTICENTER", "MULTICENTRE", "PILOT", "REGISTRATION", "CLINICAL",
    "COHORT", "PHASE", "TRIAL", "TRIALS", "STUDY", "METHODS", "RESULTS", "BACKGROUND", "CONCLUSION", "CONCLUSIONS",
    "OBJECTIVE", "OBJECTIVES", "DESIGN", "SETTING", "PARTICIPANTS", "INTERVENTION", "INTERVENTIONS", "MAIN",
    "PURPOSE", "AIMS", "FINDINGS", "INTERPRETATION", "FUNDING", "IMPORTANCE", "EVIDENCE", "PLACEBO", "CROSSOVER",
    "PRAGMATIC", "CLUSTER", "NATIONAL", "INTERNATIONAL", "PROSPECTIVE", "RETROSPECTIVE", "OBSERVATIONAL", "REVIEW",
    "SYSTEMATIC", "ANALYSIS", "DOUBLE-BLIND", "OPEN-LABEL", "EFFECT", "EFFECTS", "EFFICACY", "SAFETY", "PATIENTS",
    # diseases, drug classes, biomarkers, procedures, genes
    "COVID", "COVID-19", "SARS", "SARS-COV-2", "HIV", "HPV", "COPD", "ESKD", "ESRD", "CKD", "CKD-EPI", "ASCVD",
    "NAFLD", "MASLD", "NASH", "MASH", "HFPEF", "HFREF", "HFMREF", "LVEF", "SGLT2", "SGLT-2", "SGLT2I", "SGLT2IS",
    "GLP-1", "GLP1", "GLP-1RA", "GLP-1RAS", "DPP-4", "DPP4", "LDL", "LDL-C", "HDL", "HDL-C", "PCSK9", "CABG", "TAVR",
    "TAVI", "PCI", "HBA1C", "NT-PROBNP", "BNP", "ARNI", "RAAS", "BMI", "MRI", "ICU", "EGFR", "HER2", "BRCA", "BRCA1",
    "BRCA2", "KRAS", "PD-1", "PD-L1", "TNF", "IL-6", "CRP", "AKI", "CVD", "STEMI", "NSTEMI", "ACS", "ICD", "CRT",
    "T2DM", "T1DM", "IBD", "RCC", "NSCLC", "SCLC", "HCC", "CRC", "AML", "ALL", "CLL", "CML", "DLBCL"})


def trial_key(name: str) -> str:
    """One spelling per trial name: "EMPEROR Reduced", "EMPEROR-reduced" and "EMPEROR–Reduced" are one key."""
    return re.sub(r"[\s\-–]+", "-", name.strip()).upper()


def _clean(name: str) -> str:
    return re.sub(r"\s+", " ", name.replace("–", "-")).strip()


def _distinctive(name: str) -> bool:
    """Hyphenated, digit-bearing or mixed-case: not an ordinary word in capitals."""
    return bool(re.search(r"[-\d]|[a-z]", name))


def _is_name(name: str) -> bool:
    key = trial_key(name)
    parts = key.split("-")
    return not (key in NOT_TRIAL_NAMES or parts[0] in NOT_TRIAL_NAMES or key.replace("-", "") in NOT_TRIAL_NAMES
                or all(p in NOT_TRIAL_NAMES or p.isdigit() for p in parts)
                or sum(ch.isupper() for ch in name) < 4 or re.search(r"\d{5,}", name))


def _mostly_caps(text: str) -> bool:
    letters = [ch for ch in text if ch.isalpha()]
    return bool(letters) and sum(ch.isupper() for ch in letters) > 0.6 * len(letters)


def _name_matches(text: str) -> list[tuple[int, str]]:
    """(position, name) of every accepted trial name in `text` (see the rules above)."""
    caps_runs = [m.span() for m in _CAPS_RUN.finditer(text)]

    def in_caps_run(start: int) -> bool:
        return any(a <= start < b for a, b in caps_runs)

    found: list[tuple[int, str]] = []
    for m in _IN_CONTEXT.finditer(text):
        name = _clean(m.group(1))
        if in_caps_run(m.start(1)):
            continue
        if _distinctive(name) or m.group(2).lower() in _STRICT_CONTEXT:
            found.append((m.start(1), name))
    for m in _IN_BRACKETS.finditer(text):
        if not in_caps_run(m.start(1)):
            found.append((m.start(1), _clean(m.group(1))))
    for m in _AFTER_TITLE_PHRASE.finditer(text):
        words = m.group(1).split()[-6:]
        if sum(w[:1].isupper() for w in words) >= 3 and not in_caps_run(m.start(2)):
            found.append((m.start(2), _clean(m.group(2))))
    return sorted(found)


def trial_acronyms(title: str | None, abstract: str | None = None) -> list[str]:
    """The trial names written in a trial context, in text order, each once (as first written). An all-caps title
    gives none."""
    title = "" if _mostly_caps(title or "") else (title or "")
    matches = [(-1, _clean(lead.group(1))) for lead in [_TITLE_LEAD.match(title)]
               if lead and _distinctive(lead.group(1))]
    matches += _name_matches(f"{title}. {abstract or ''}")
    out: dict[str, str] = {}
    for _, name in matches:
        if _is_name(name):
            out.setdefault(trial_key(name), name)
    return list(out.values())


# Mentions of another trial: "unlike the DAPA-HF trial", "consistent with", "as in", "similar to", "compared with"
_CITING_CUE = re.compile(r"(?i)\b(unlike|consistent with|in line with|as in|similar to|similarly to|compared with|"
                         r"compared to|previous|prior|earlier|like|following|after|based on|building on|extend\w*|"
                         r"replicat\w*|confirm\w*|than|eligib\w*|real-world)\b[^.;]{0,40}$")
_METHODS = re.compile(r"(?is)\bmethods?\b\s*[:.]?(.*?)(?=\bresults?\b\s*[:.]|$)")
_SENTENCES = re.compile(r"(?<=[.!?])\s+")
# A sentence about the paper's own study population or aim
_SELF = re.compile(r"(?i)\b(we|our|this (study|analysis|trial|report|substudy|sub-study)|the (aims?|objectives?|"
                   r"purpose) of|enrolled in|randomi[sz]ed in|participants (in|of|from) the|patients (in|of|from) the)\b")


def own_trial_names(title: str | None, abstract: str | None = None) -> list[str]:
    """The trial names a paper reports on itself (Task 10 review finding 2): named in its title, or in its abstract's
    first sentence, methods section or registration ("X ClinicalTrials.gov number"), and never right after a citing
    cue ("consistent with the X trial", "unlike X", "as in X"). Mentions elsewhere cite other trials."""
    title = "" if _mostly_caps(title or "") else (title or "")
    lead = _TITLE_LEAD.match(title)
    names = [_clean(lead.group(1))] if lead and _distinctive(lead.group(1)) and _is_name(_clean(lead.group(1))) else []
    text = abstract or ""
    sentences = _SENTENCES.split(text.strip()) if text.strip() else []
    places = [title] + sentences[:1] + [m.group(1) for m in _METHODS.finditer(text)]
    places += [s for s in sentences if re.search(r"ClinicalTrials|\bNCT\d{8}|ISRCTN|registered", s)]
    places += [s for s in sentences if _SELF.search(s)]  # "the aims of this study were ... in the X trial"
    for place in places:
        for start, name in _name_matches(place):
            if not _CITING_CUE.search(place[:start]) and _is_name(name):
                names.append(name)
    out: dict[str, str] = {}
    for n in names:
        out.setdefault(trial_key(n), n)
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
TITLE_MATCH = 95  # near-identical titles (rapidfuzz ratio on normalised titles); also needs the same n or registry
# Words whose difference makes two near-identical titles two populations (Task 10 review finding 3)
POPULATION_WORDS = frozenset({
    "men", "women", "male", "males", "female", "females", "boys", "girls", "children", "adults", "adolescents",
    "elderly", "older", "younger", "young", "infants", "pregnant", "postmenopausal", "premenopausal", "white", "black",
    "asian", "hispanic", "urban", "rural", "type", "1", "2"})
COMMENTARY_TYPES = frozenset({"comment", "editorial", "discussion", "letter", "news"})
_COMMENTARY_TITLE = re.compile(r"(?i)\b(commentary|editorial|perspective|breakthrough|viewpoint|lessons|"
                               r"implications|the future of|what .* means|reflections?)\b")


def _ids(paper: dict[str, Any]) -> tuple[set[str], int]:
    """(trial identifiers the paper reports on itself, number of its own trial names) of one paper. Trials it only
    cites ("consistent with the DAPA-HF trial") are not its identifiers."""
    c = paper.get("candidate") or {}
    names = own_trial_names(c.get("title"), c.get("abstract"))
    ids = {f"name:{trial_key(n)}" for n in names}
    ids |= {f"reg:{r}" for r in registry_ids(c.get("title"), c.get("abstract"))}
    return ids, len(names)


def is_commentary(paper: dict[str, Any]) -> bool:
    c = paper.get("candidate") or {}
    types = {t.strip().lower() for t in c.get("pub_types") or []}
    return bool(types & COMMENTARY_TYPES) or bool(_COMMENTARY_TITLE.search(c.get("title") or ""))


def _population_split(a: str, b: str) -> bool:
    """Titles that differ by a population word or a proper name (men/women, Korea/Japan)."""
    diff = set(normalize_title(a).split()) ^ set(normalize_title(b).split())
    raw = set(re.findall(r"\b[A-Z][a-z]+\b", a)) ^ set(re.findall(r"\b[A-Z][a-z]+\b", b))
    return bool(diff & POPULATION_WORDS) or bool(raw)


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
    # design and publication type first (Task 10 review finding 4), then the title heuristic
    return (card.get("design_category") == "rct",
            bool(types & {"randomized controlled trial", "clinical trial", "clinical trial, phase iii"}),
            not SECONDARY_REPORT.search(c.get("title") or ""),
            estimates, n, -year, -(int(ref[1:]) if ref[1:].isdigit() else 10**6))


def _sample(paper: dict[str, Any]) -> int | None:
    n = (paper.get("card") or {}).get("sample_size")
    return n if isinstance(n, int) and n > 0 else None


def related_reports(papers: list[dict[str, Any]],
                    evidence_refs: set[str] | None = None) -> dict[str, dict[str, str]]:
    """Reports of the same study, by trial: {ref of a related report: {"primary": ref, "reason": text}}.

    Two papers report the same trial when they share a trial name the paper reports on itself (title, first sentence,
    methods or registration; never a trial it only cites) or a registry number, or when their titles are
    near-identical (ratio >= 95) with the same first author, years at most one apart, the same reported sample size or
    a shared registry number, and no population word or proper name between them (men/women, Korea/Japan).
    Guards (Task 10 review findings 1-4): a paper naming two or more trials never links trials together; papers with
    different registry numbers are never one group; SR/MAs and qualitative/mixed-methods papers are never grouped.
    The primary report is chosen only among `evidence_refs` (the papers that are evidence: in scope, direction
    evidence, answering the question; every paper when None), never a commentary: an RCT design, an RCT publication
    type, a title that is not a subgroup/post hoc/design paper, more estimates with a CI, a larger sample, the earlier
    year, the lower ref. A group with no such member links nothing. Pure: papers are {"ref", "candidate", "card"}."""
    eligible = [p for p in papers if p.get("card") and p.get("ref")
                and p["card"].get("design_category") not in POOLED_CATEGORIES | NON_QUANTITATIVE_CATEGORIES]
    parent = {p["ref"]: p["ref"] for p in eligible}
    regs: dict[str, set[str]] = {}

    def find(r: str) -> str:
        while parent[r] != r:
            parent[r] = parent[parent[r]]
            r = parent[r]
        return r

    def union(a: str, b: str) -> bool:
        ra, rb = find(a), find(b)
        if ra == rb:
            return True
        if regs[ra] and regs[rb] and not regs[ra] & regs[rb]:
            return False  # two registrations: two trials, whatever else they share
        parent[rb] = ra
        regs[ra] |= regs[rb]
        return True

    reason: dict[frozenset[str], str] = {}
    owner: dict[str, str] = {}
    spelled: dict[str, str] = {}
    ids_of: dict[str, set[str]] = {}
    for p in eligible:
        c = p.get("candidate") or {}
        for n in own_trial_names(c.get("title"), c.get("abstract")):
            spelled.setdefault(trial_key(n), n)
        ids, n_names = _ids(p)
        registries = {i for i in ids if i.startswith("reg:")}
        if n_names > 1:  # a multi-trial report: only its own single registry number may link it
            ids = registries if len(registries) == 1 else set()
        ids_of[p["ref"]] = ids
        regs[p["ref"]] = registries if len(registries) == 1 else set()
    for p in eligible:
        for ident in sorted(ids_of[p["ref"]]):
            if ident in owner:
                if union(owner[ident], p["ref"]):
                    reason.setdefault(frozenset({owner[ident], p["ref"]}), f"same trial ({_label(ident, spelled)})")
            else:
                owner[ident] = p["ref"]
    for i, a in enumerate(eligible):
        for b in eligible[i + 1:]:
            ca, cb = a.get("candidate") or {}, b.get("candidate") or {}
            ta, tb = ca.get("title") or "", cb.get("title") or ""
            na, nb = normalize_title(ta), normalize_title(tb)
            ya, yb = ca.get("year"), cb.get("year")
            same_size = _sample(a) is not None and _sample(a) == _sample(b)
            same_reg = bool(regs[a["ref"]] & regs[b["ref"]])
            if (na and nb and isinstance(ya, int) and isinstance(yb, int) and abs(ya - yb) <= 1
                    and first_author_surname(ca.get("authors"))
                    and first_author_surname(ca.get("authors")) == first_author_surname(cb.get("authors"))
                    and (same_size or same_reg) and not _population_split(ta, tb)
                    and fuzz.ratio(na, nb) >= TITLE_MATCH and union(a["ref"], b["ref"])):
                reason.setdefault(frozenset({a["ref"], b["ref"]}),
                                  "near-identical title, same first author, same "
                                  + ("registry number" if same_reg else "sample size"))
    groups: dict[str, list[dict[str, Any]]] = {}
    for p in eligible:
        groups.setdefault(find(p["ref"]), []).append(p)
    out: dict[str, dict[str, str]] = {}
    for members in groups.values():
        if len(members) < 2:
            continue
        candidates = [p for p in members if (evidence_refs is None or p["ref"] in evidence_refs)
                      and not is_commentary(p)]
        if not candidates:
            continue  # no member is evidence: nothing is absorbed
        primary = max(candidates, key=_primary_score)["ref"]
        for p in members:
            if p["ref"] == primary:
                continue
            why = next((text for pair, text in reason.items() if p["ref"] in pair), "same trial")
            out[p["ref"]] = {"primary": primary, "reason": why}
    return out
