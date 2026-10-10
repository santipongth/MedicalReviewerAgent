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
# - A plain all-caps word (DELIVER, CANVAS): only right before trial(s)/study/investigators/program(me)/
#   ClinicalTrials.gov, or
#   in brackets after a title-case phrase of at least 4 words ("... Trial in Chronic Heart Failure (EMPULSE)").
# Never from an all-caps title or an all-caps heading run (3+ consecutive all-caps words), and never a generic
# design/heading word or a disease, drug-class, biomarker or gene abbreviation (NOT_TRIAL_NAMES).
_IN_CONTEXT = re.compile(
    rf"({ACRONYM})\s*\)?\s*(?i:(trials?|study|studies|programme|program|investigators|ClinicalTrials))\b")
_STRICT_CONTEXT = frozenset({"trial", "trials", "study", "investigators", "clinicaltrials", "program", "programme"})
_IN_BRACKETS = re.compile(rf"\b(?i:trial|study)\s*\(({ACRONYM})\)")
_AFTER_TITLE_PHRASE = re.compile(rf"((?:\b[A-Za-z][\w'-]*\s+){{4,}})\(({ACRONYM})\)")
_TITLE_LEAD = re.compile(rf"^\s*({ACRONYM})\s*:")
_CAPS_RUN = re.compile(r"\b[A-Z][A-Z0-9-]+(?:\s+[A-Z][A-Z0-9-]+){2,}\b")
_REGISTRY = re.compile(r"\b(NCT\d{8}|ISRCTN\s?\d{8})\b")
NOT_TRIAL_NAMES = frozenset({
    # outcomes, designs, scales, registries of data, bodies
    "OUTCOME", "OUTCOMES", "CVOT", "CVOTS", "RCT", "RCTS", "NYHA", "MACE", "KCCQ", "PRISMA", "GRADE", "NHANES",
    "SEER", "MIMIC", "NIH", "WHO", "FDA", "EMA", "NICE", "AHA", "ESC", "ADA", "EASD", "ACC", "KDIGO", "CONSORT",
    "TIMI",  # the TIMI Study Group runs many trials; "DECLARE-TIMI 58" stays a name (its first part is not stoplisted)
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


_CONNECTORS = frozenset({"of", "in", "on", "for", "with", "and", "to", "the", "a", "an", "&"})


def _expansion(phrase: str) -> str:
    """The acronym's expansion: the trailing run of title-case words (and connectors between them) right before the
    bracket. "This randomized trial used the Hospital Anxiety and Depression Scale" gives "Hospital Anxiety and
    Depression Scale"; "the Empagliflozin Outcome Trial in Patients With Chronic Heart Failure" keeps "Trial"."""
    out: list[str] = []
    for word in reversed(phrase.split()):
        if word[:1].isupper() or (word.lower() in _CONNECTORS and out):
            out.append(word)
        else:
            break
    while out and out[-1].lower() in _CONNECTORS:
        out.pop()
    return " ".join(reversed(out))


def _name_matches(text: str, own: bool = False) -> list[tuple[int, str]]:
    """(position, name) of every accepted trial name in `text` (see the rules above). `own` (linking, fix round 2,
    N3): a bracketed acronym after a title-case phrase counts only when the phrase names a trial or study ("...
    Outcome Trial in ... (EMPEROR-Reduced)"), never a database or instrument ("National Health Insurance Service
    (NHIS)", "Hospital Anxiety and Depression Scale (HADS)")."""
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
        if own and not re.search(r"(?i)\b(trial|study)\b", _expansion(m.group(1))):
            continue  # fix round 3 (N8): only the acronym's own expansion may name a trial
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
                         r"compared to|comparable to|previous|prior|earlier|like|following|after|based on|building on|"
                         r"extend\w*|replicat\w*|confirm\w*|than|eligib\w*|real-world|agree\w* with|support\w*|"
                         r"mirror\w*|echo\w*)\b[^.;]{0,40}$")
# Only a structured "Methods" heading (fix round 2): "Methods:", "METHODS", or "Methods We ..." at the start of the
# abstract or after a sentence end; never the bare word "method" inside a sentence. It ends at the next heading.
_METHODS = re.compile(r"(?:^|(?<=[.!?])\s+)(?:Methods?|METHODS?|Materials and [Mm]ethods)\s*(?::|\.|\s(?=[A-Z]))\s*"
                      r"(.*?)(?=(?:^|(?<=[.!?])\s+)(?:Results?|RESULTS?|Findings|FINDINGS|Conclusions?|CONCLUSIONS?|"
                      r"Interpretation|INTERPRETATION)\b|$)", re.DOTALL)
_SENTENCES = re.compile(r"(?<=[.!?])\s+")
# A sentence that says the trial is the paper's own subject (fix round 2: an explicit self pattern; a bare we/our
# sentence such as "our findings agree with the DAPA-HF trial" is not one)
# The paper's own voice: "we ...", "this (secondary) analysis of", "the aims of this", "this commentary discusses",
# "in the X trial, we". A trial an owner names this way (or in its title or registration) is explicitly its own (fix
# round 4, N15); "patients enrolled in the X trial" (_SELF_PATIENTS) describes patients, so it names the paper's own
# trial for linking but is not enough to make the paper the owner a secondary report joins.
_SELF_EXPLICIT = re.compile(
    r"(?i)\bwe (conducted|performed|analy[sz]ed|randomi[sz]ed|randomly assigned|enrolled|report|present|examined|"
    r"assessed|evaluated|studied|used data from|followed)\b|"
    r"\b(this|the present|the current) ((secondary|post[- ]?hoc|pre-?specified|exploratory|ancillary) )?"
    r"(analysis|substudy|sub-study|study|report|trial) (of|from|in|using|was)\b|"
    r"\bthe (aims?|objectives?|purpose) of this\b|"
    r"\bthis (commentary|editorial|review|perspective|viewpoint) (of|on|about|discusses|summari[sz]es|reviews)\b|"
    r"\bin the [A-Z][\w-]+(?: [\w-]+){0,4} (trial|study)\s*,\s*we\b")
_SELF_PATIENTS = re.compile(r"(?i)\b(enrolled|randomi[sz]ed|participating) in the\b")
# Explicit ownership (fix round 5, N22): the non-"we" self patterns above, or a we-sentence whose ownership verb is
# aimed at the trial itself ("we conducted/designed/performed/report(ed) (the results of) the X trial", "in the X
# trial, we randomised/assigned"). A we-sentence that only uses or cites a trial ("we enrolled patients who met the X
# trial criteria", "we followed the X trial protocol") is no explicit owner.
_SELF_THIS = re.compile(
    r"(?i)\b(this|the present|the current) ((secondary|post[- ]?hoc|pre-?specified|exploratory|ancillary) )?"
    r"(analysis|substudy|sub-study|study|report|trial) (of|from|in|using|was)\b|"
    r"\bthe (aims?|objectives?|purpose) of this\b|"
    r"\bthis (commentary|editorial|review|perspective|viewpoint) (of|on|about|discusses|summari[sz]es|reviews)\b")
_TRIAL_WORD = r"\s+(?i:trial|study|program|programme)\b"
_OWNER_WE = re.compile(
    rf"(?i:\bwe\s+(?:conducted|designed|performed|report(?:ed)?)\s+(?:the\s+(?:[\w-]+\s+)?results\s+of\s+)?"
    rf"(?:the\s+)?)({ACRONYM})(?={_TRIAL_WORD})|"
    rf"(?i:\bin\s+the\s+)({ACRONYM})(?={_TRIAL_WORD}\s*,\s*(?i:we)\s+(?i:randomi[sz]ed|randomly assigned|assigned)\b)")


def own_trial_names(title: str | None, abstract: str | None = None, *, explicit: bool = False) -> list[str]:
    """The trial names a paper reports on itself (Task 10 review finding 2, fix round 2): named in its title (citing
    cues never apply there: "...: the DAPA-MI trial" is the paper's own), or, in the abstract, in its first sentence,
    its structured Methods section, its registration ("X ClinicalTrials.gov number") or a sentence with an explicit
    self pattern ("we analysed ... the X trial", "this secondary analysis of X", "patients enrolled in the X trial"),
    and there never right after a citing cue ("consistent with", "agrees with", "supports", "unlike", "as in", ...).
    A trial an abstract only cites outside these places, or after a cue, is not the paper's own. `explicit` (fix
    round 4, N15): only the title, the registration, the non-"we" self patterns (_SELF_THIS) and a we-sentence whose
    ownership verb is aimed at the trial (_OWNER_WE, fix round 5, N22) count, not the Methods section, "patients
    enrolled in the X trial" or a we-sentence that only uses or cites the trial."""
    title = "" if _mostly_caps(title or "") else (title or "")
    lead = _TITLE_LEAD.match(title)
    names = [_clean(lead.group(1))] if lead and _distinctive(lead.group(1)) and _is_name(_clean(lead.group(1))) else []
    names += [name for _, name in _name_matches(title, own=True) if _is_name(name)]
    text = abstract or ""
    sentences = _SENTENCES.split(text.strip()) if text.strip() else []
    # fix round 3 (N9): the first sentence (or a Background section) is the paper's own only with a self pattern
    # ("The DAPA-HF trial showed ..." opens many follow-up trials); the self sentences below include it then
    places = [] if explicit else [m.group(1) for m in _METHODS.finditer(text.strip())]
    places += [s for s in sentences if re.search(r"ClinicalTrials|\bNCT\d{8}|ISRCTN|registered", s)]
    if explicit:  # fix round 5 (N22): the paper's own voice only with an ownership verb aimed at the trial
        places += [s for s in sentences if _SELF_THIS.search(s)]
        names += [_clean(g) for s in sentences for m in _OWNER_WE.finditer(s) for g in m.groups()
                  if g and _is_name(_clean(g))]
    else:
        places += [s for s in sentences if _SELF_EXPLICIT.search(s) or _SELF_PATIENTS.search(s)]
    for place in places:
        for start, name in _name_matches(place, own=True):
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


TRIAL_TYPES = frozenset({"randomized controlled trial", "clinical trial", "clinical trial, phase i",
                         "clinical trial, phase ii", "clinical trial, phase iii", "clinical trial, phase iv",
                         "controlled clinical trial", "pragmatic clinical trial"})
_TRIAL_REPORT = re.compile(r"(?i)\b(secondary|post[- ]?hoc|pre-?specified|exploratory|ancillary|sub-?group)\b"
                           r"[^.]{0,60}\b(trial|analysis of)\b|\btrial\b")


def is_trial(paper: dict[str, Any]) -> bool:
    """A trial or a report or secondary analysis of one (fix round 2 ruling): an RCT or non-randomised trial design,
    a trial publication type, or a design text / title that names a trial. Only trials link by trial name."""
    card = paper.get("card") or {}
    c = paper.get("candidate") or {}
    if card.get("design_category") in ("rct", "non_randomized_trial"):
        return True
    if card.get("design_category") not in (None, "other", "narrative_review"):
        return False  # cohort, case-control, cross-sectional, ...: a registry-ID link only
    types = {t.strip().lower() for t in c.get("pub_types") or []}
    return bool(types & TRIAL_TYPES) or bool(_TRIAL_REPORT.search(f"{card.get('study_design') or ''} "
                                                                 f"{c.get('title') or ''}"))


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


# A report that is not a trial's primary results (fix round 4, N14 ruling): report-type phrases only, in the title or
# the design text. Bare words that primary RCTs use ("secondary prevention", "long-term", "12-month follow-up",
# "extension", "results from", "data from", "patients in the ICU") are no cue.
_REPORT_TYPE = re.compile(
    r"(?i)\b((secondary|post[- ]?hoc|pre-?specified|exploratory|ancillary) analys[ie]s|sub-?stud(y|ies)|"
    r"sub-?group analys[ie]s|follow[- ]?up (of|from) the|extension (study )?of the|insights? from|"
    r"an? report from the|an analysis from the|rationale and design|design and rationale|baseline characteristics)\b")
# "according to ... in (the) X" is a subgroup report only when X is a trial name (fix round 5, N21): a distinctive
# name ("in DAPA-HF") or a name followed by trial/study/program(me) ("in the CANVAS Program"); never a disease or
# setting acronym ("in COPD", "in ICU patients", "in HIV", "in ARIC participants").
_ACCORDING_TO = re.compile(rf"(?i:according to)\b[^.:;]{{0,100}}?\b(?i:in)\s+(?:(?i:the)\s+)?({ACRONYM})"
                           rf"(\s+(?i:trials?|study|program|programme))?")
# The design text (free text from the extraction) counts only when it describes this paper as a report of a trial
# (fix round 5, N21): "this (prespecified subgroup) analysis", "a secondary analysis of the X trial", "post hoc
# analysis of a randomised trial", "substudy of the X trial"; never "RCT with prespecified subgroup analyses".
_DESIGN_REPORT_TYPE = re.compile(
    r"(?i)\bthis\s+(?:[\w-]+\s+){0,3}(?:analysis|sub-?study)\b|"
    r"\b(?:(?:secondary|post[- ]?hoc|pre-?specified|exploratory|ancillary|sub-?group)\s+)+analys[ie]s\s+(?:of|from)\s+"
    r"(?:the|an?)\s+(?:[\w-]+\s+){0,4}?(?:trial|study|RCT)\b|"
    r"\bsub-?study\s+of\s+(?:the|an?)\b|\b(?:follow[- ]?up|extension(?: study)?)\s+of\s+the\b")


def _according_to_trial(title: str) -> bool:
    for m in _ACCORDING_TO.finditer(title):
        name = _clean(m.group(1))
        if _is_name(name) and (_distinctive(name) or m.group(2)):
            return True
    return False


def is_secondary_report(paper: dict[str, Any]) -> bool:
    """A secondary report, sub-study, follow-up or commentary (fix round 3 ruling; report-type phrases only since fix
    round 4; an anchored design text and "according to" a trial name since round 5): only these link to a trial by
    its name alone."""
    c = paper.get("candidate") or {}
    card = paper.get("card") or {}
    title = c.get("title") or ""
    return (is_commentary(paper) or bool(_REPORT_TYPE.search(title)) or _according_to_trial(title)
            or bool(_DESIGN_REPORT_TYPE.search(card.get("study_design") or "")))


def _n_fits(p: dict[str, Any], q: dict[str, Any], regs: dict[str, set[str]]) -> bool:
    """A secondary report `p` is no larger than the trial `q` it would join (fix round 4, N15): its n is at most q's
    n; with an n unknown, only a shared registry number fits. A commentary reports no sample, so it always fits."""
    np_, nq = _sample(p), _sample(q)
    if np_ is not None and nq is not None:
        return np_ <= nq
    return is_commentary(p) or bool(regs[p["ref"]] & regs[q["ref"]])


def _may_join(p: dict[str, Any], group: list[dict[str, Any]], regs: dict[str, set[str]], ident: str,
              explicit: dict[str, set[str]]) -> bool:
    """Whether `p` may join `group` by the shared trial name `ident`. A group with no primary-looking member takes
    any report. A secondary report joins primary-looking members only when it is no larger than each of them
    (_n_fits) and one of them names the trial explicitly (title, registration or its own voice; fix round 4, N15).
    Two primary-looking reports also need the same reported n or a registry number (fix round 3)."""
    primaries = [q for q in group if not is_secondary_report(q)]
    if not primaries:
        return True
    if is_secondary_report(p):
        return (all(_n_fits(p, q, regs) for q in primaries)
                and any(ident in explicit[q["ref"]] for q in primaries))
    return all((_sample(p) is not None and _sample(p) == _sample(q)) or bool(regs[p["ref"]] & regs[q["ref"]])
               for q in primaries)


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
    secondary_owner: dict[str, str] = {}  # a name's group of secondary reports that no primary-looking owner took
    spelled: dict[str, str] = {}
    ids_of: dict[str, set[str]] = {}
    explicit: dict[str, set[str]] = {}
    for p in eligible:
        c = p.get("candidate") or {}
        for n in own_trial_names(c.get("title"), c.get("abstract")):
            spelled.setdefault(trial_key(n), n)
        explicit[p["ref"]] = {f"name:{trial_key(n)}"
                              for n in own_trial_names(c.get("title"), c.get("abstract"), explicit=True)}
        ids, n_names = _ids(p)
        registries = {i for i in ids if i.startswith("reg:")}
        if n_names > 1 or not is_trial(p):
            # a multi-trial report, or a paper that is not a trial (cohort, registry, programme evaluation: "NHIS",
            # "the SNAP program" name data sources, not studies; fix round 2, N3/N5): only its own single registry
            # number may link it
            ids = registries if len(registries) == 1 else set()
        ids_of[p["ref"]] = ids
        regs[p["ref"]] = registries if len(registries) == 1 else set()
    # primary-looking reports own the names first, the largest first (a landmark trial is larger than the trials
    # that cite it), so a secondary report joins the trial it reports on
    order = sorted(eligible, key=lambda p: (is_secondary_report(p), -(_sample(p) or 0)))
    for p in order:
        for ident in sorted(ids_of[p["ref"]]):
            if ident not in owner:
                owner[ident] = p["ref"]
                continue
            # structural backstop (fix round 3, N8/N9; round 4, N15): a name alone links only a secondary report,
            # sub-study, follow-up or commentary of the named trial, and only to an owner at least as large that
            # names the trial explicitly; two primary-looking reports also need the same reported n or a shared
            # registry number (a registry ID always links). A secondary report no owner takes groups with the other
            # secondary reports of that name.
            if not ident.startswith("name:"):
                target = owner[ident]
            else:
                target = next((t for t in (owner[ident], secondary_owner.get(ident)) if t is not None and _may_join(
                    p, [q for q in eligible if find(q["ref"]) == find(t)], regs, ident, explicit)), None)
                if target is None:
                    if is_secondary_report(p) and ident not in secondary_owner:
                        secondary_owner[ident] = p["ref"]
                    continue
            if union(target, p["ref"]):
                reason.setdefault(frozenset({target, p["ref"]}), f"same trial ({_label(ident, spelled)})")
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
