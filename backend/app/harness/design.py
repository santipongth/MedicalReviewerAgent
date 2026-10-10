"""Study-design categories: a fixed set the extractor must choose from, cross-checked against Europe PMC's
publication types, with a deterministic text mapping for cards that lack one (older results, model omissions)."""
from __future__ import annotations

import re

from app.graph.schemas import PaperCard

RANDOMIZED_CATEGORIES = frozenset({"rct", "sr_ma_rct"})
POOLED_CATEGORIES = frozenset({"sr_ma_rct", "sr_ma_observational", "sr_ma_mixed"})
# Qualitative and mixed-methods studies are summarised as themes: never direction cells, forest plots, pools or grade.
NON_QUANTITATIVE_CATEGORIES = frozenset({"qualitative", "mixed_methods"})
# Designs that add no direction evidence (they restate other studies or report no effect).
NO_DIRECTION_CATEGORIES = frozenset({"narrative_review"}) | NON_QUANTITATIVE_CATEGORIES

# Ordered: the first matching rule wins. Pooled designs come before the primary designs they mention, and every
# design that merely *mentions* a trial (a cohort nested in one, a post hoc analysis, a non-systematic review of
# trials) comes before "rct", so only genuinely randomised studies count as randomised.
_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("sr_ma_observational", re.compile(
        r"(meta[-\s]?analys|systematic review).*(observational|cohort|case-?control|non-?randomi[sz]ed)",
        re.IGNORECASE)),
    ("sr_ma_rct", re.compile(r"(meta[-\s]?analys|systematic review).*(randomi[sz]ed|rcts?\b|trials)", re.IGNORECASE)),
    ("sr_ma_mixed", re.compile(r"meta[-\s]?analys|systematic review|pooled analysis", re.IGNORECASE)),
    ("mendelian_randomization", re.compile(r"mendelian randomi", re.IGNORECASE)),
    ("narrative_review", re.compile(
        r"^\s*(narrative |literature |scoping )?review(\s+article)?\s*$|narrative review|literature review|^\s*review of\b",
        re.IGNORECASE)),
    ("mixed_methods", re.compile(r"mixed[- ]methods?", re.IGNORECASE)),
    # A design that *starts* as qualitative ("Qualitative interview study", "A longitudinal qualitative study") is
    # qualitative even when it mentions a cohort or a secondary analysis; any other mention waits until no
    # quantitative design matched (see the last rule).
    ("qualitative", re.compile(r"^\W*(\w+\s+)?qualitative\b|longitudinal qualitative", re.IGNORECASE)),
    ("non_randomized_trial", re.compile(r"non-?randomi[sz]ed|single[- ]arm|quasi-?experimental", re.IGNORECASE)),
    ("case_control", re.compile(r"case-?control", re.IGNORECASE)),
    ("cohort", re.compile(r"cohort|observational analysis|secondary analysis|post[- ]hoc|target trial emulation|"
                          r"longitudinal|registry|claims database|new-user", re.IGNORECASE)),
    ("rct", re.compile(r"randomi[sz]ed|\brct\b|controlled trial", re.IGNORECASE)),
    ("cross_sectional", re.compile(r"cross-?sectional|survey", re.IGNORECASE)),
    ("case_series", re.compile(r"case series|case report", re.IGNORECASE)),
    # Last: "cohort study with qualitative interviews" or "RCT with an embedded qualitative process evaluation" stay
    # quantitative (their numbers are direction evidence); only a design with no quantitative match is qualitative.
    ("qualitative", re.compile(r"qualitative|focus groups?|semi-?structured interviews?|in-depth interviews?|"
                               r"thematic analysis|phenomenolog|grounded theory|ethnograph", re.IGNORECASE)),
]


def infer_design_category(text: str | None) -> str | None:
    for category, pattern in _RULES:
        if text and pattern.search(text):
            return category
    return None


def settle_design_category(card: PaperCard, pub_types: list[str] | None) -> PaperCard:
    """Final deterministic pass after the harness: fill a missing category from the free text, and let the
    curated publication types win over a contradicting category. A qualitative evidence synthesis (meta-synthesis,
    thematic synthesis) labelled qualitative keeps that label under a Systematic Review publication type."""
    category = card.design_category or infer_design_category(card.study_design)
    types = {t.strip().lower() for t in pub_types or []}
    if category in NON_QUANTITATIVE_CATEGORIES and QUALITATIVE_SYNTHESIS.search(card.study_design or ""):
        pass
    elif types & {"meta-analysis", "systematic review"} and category not in POOLED_CATEGORIES:
        inferred = infer_design_category(card.study_design)
        category = inferred if inferred in POOLED_CATEGORIES else "sr_ma_mixed"
    elif "randomized controlled trial" in types and category not in ("rct", "sr_ma_rct", "sr_ma_mixed"):
        category = "rct"
    return card.model_copy(update={"design_category": category or "other"})


def strip_non_quantitative(card: PaperCard) -> PaperCard:
    """Qualitative and mixed-methods cards are themes only, enforced in code (the prompt asks, models forget):
    every outcome gets effect_measure "none", null numbers and direction "unclear", and so does the card's overall
    direction. A theme compares nothing (Plan 20 Task 10: the re-run's themes carried invented pairings such as
    "patients with stigma vs patients without stigma (implied within cohort)"), so its comparison is null and it
    matches the question. sample_size, quotes and the theme text are kept."""
    if card.design_category not in NON_QUANTITATIVE_CATEGORIES:
        return card
    outcomes = [o.model_copy(update={"effect_measure": "none", "effect_size": None, "effect_value": None,
                                     "ci_lower": None, "ci_upper": None, "p_value": None, "direction": "unclear",
                                     "comparison": None, "matches_question": True})
                for o in card.outcomes]
    return card.model_copy(update={"outcomes": outcomes, "overall_direction": "unclear"})


def strip_directions(card: PaperCard) -> PaperCard:
    """A scoping review charts what exists and makes no claim of effect (Plan 20 Task 10): every outcome direction
    and the card's overall direction are "unclear" (the extractor's guesses were shown on 24 of 30 mammography
    cards). Numbers and text are kept."""
    if card.overall_direction == "unclear" and all(o.direction == "unclear" for o in card.outcomes):
        return card
    return card.model_copy(update={"outcomes": [o.model_copy(update={"direction": "unclear"}) for o in card.outcomes],
                                   "overall_direction": "unclear"})


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
    qualitative_synthesis = (category in NON_QUANTITATIVE_CATEGORIES
                             and QUALITATIVE_SYNTHESIS.search(card.study_design or ""))
    if (types & {"meta-analysis", "systematic review"} and category not in POOLED_CATEGORIES
            and not qualitative_synthesis):
        problems.append(f"design_category '{category}' contradicts the publication type "
                        f"{'Meta-Analysis' if 'meta-analysis' in types else 'Systematic Review'}")
    return problems


# ---- design-label consistency (Plan 19, audit I-7) ----------------------------------------------
# Wording that makes a study a systematic review / meta-analysis (or a qualitative evidence synthesis).
POOLED_WORDING = re.compile(
    r"meta[-\s]?analy|systematic(ally)?\s+(literature\s+)?review|pooled analys|umbrella review|meta-?synthes|"
    r"thematic synthesis|meta-?ethnograph|qualitative (evidence )?synthesis|scoping review|"
    r"\breview of (\w+[\s-]+){0,4}(trials|rcts|studies)\b", re.IGNORECASE)
# Footprints of a review in the abstract: a database search, a pooling model, PRISMA, or a count of included studies.
REVIEW_FOOTPRINT = re.compile(
    r"\bsearch(ed|es)?\b[^.]{0,80}\b(medline|pubmed|embase|cochrane|web of science|scopus|cinahl)\b|"
    r"databases? (were|was) searched|random[- ]effects?|fixed[- ]effects? model|\bprisma\b|"
    r"\b(\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(\w+\s+){0,2}(studies|trials|rcts)\s+(were\s+)?"
    r"(included|pooled|identified)|\bpooled\s+(\w+\s+){0,3}(studies|trials|rcts|estimates?)\b", re.IGNORECASE)
# A qualitative evidence synthesis: its output is themes, not pooled effects.
QUALITATIVE_SYNTHESIS = re.compile(
    r"meta-?synthes|thematic synthesis|meta-?ethnograph|qualitative (evidence )?synthesis|"
    r"(systematic|literature) review of qualitative|synthesis of qualitative", re.IGNORECASE)
QUANTITATIVE_POOLING = re.compile(r"meta[-\s]?analy|pooled analys", re.IGNORECASE)
# An analysis of one trial's data: never a systematic review.
TRIAL_SECONDARY = re.compile(
    r"(secondary|post[- ]?hoc|pre-?specified|exploratory|ancillary|subgroup)\s+(data\s+)?analys|sub-?study",
    re.IGNORECASE)
RANDOMISED_WORDING = re.compile(r"randomi[sz]|\brcts?\b|randomly (assigned|allocated)", re.IGNORECASE)
# A trial named in the design or title ("follow-up of a trial cohort") blocks an RCT -> cohort demotion; a target
# trial emulation is observational by definition.
TRIAL_WORDING = re.compile(r"\btrial\b(?!\s+emulation)", re.IGNORECASE)
# Abstract cues that the participants themselves were randomised or allocated (not "a review of randomised trials"),
# or that the study is a registered or placebo-controlled trial.
RANDOMISED_IN_ABSTRACT = re.compile(
    r"(were|was|been|being)\s+randomi[sz]ed\b|randomly (assigned|allocated)|randomi[sz]ed (\w+\s+){0,2}(to|1:1|2:1)\b|"
    r"\brandomi[sz]ation\b|\ballocated to\b|\bplacebo\b|\bNCT\d{8}\b|\bISRCTN\s?\d+", re.IGNORECASE)
OBSERVATIONAL_WORDING = re.compile(
    r"\bcohort\b|case-?control|cross-?sectional|\bregistry\b|retrospective|population-based|claims database|"
    r"\bobservational\b|\bsurvey\b", re.IGNORECASE)
# A sample-size quote that counts studies is the footprint of a review.
COUNTS_STUDIES = re.compile(r"\b(\d[\d,]*|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+"
                            r"(eligible\s+|included\s+)?(studies|trials|articles|cohorts|reports)\b", re.IGNORECASE)
_PRIMARY_OBSERVATIONAL = ("cohort", "case_control", "cross_sectional")
# Plan 20 Task 10 (the mammography re-run): reviews of diagnostic-accuracy or screening-programme studies were
# labelled sr_ma_rct, and a prospective paired-reader screening study rct.
# Studies an SR/MA includes that are not randomised trials.
# Narrow on purpose (Task 10 review finding 7): "sensitivity analyses" or "a cohort of trials" are no non-RCT evidence.
NON_RCT_EVIDENCE = re.compile(
    r"diagnostic (test )?accuracy|sensitivity and specificity|diagnostic sensitivity|\bspecificity\b|area under|"
    r"\bauc\b|detection rates?|recall rates?|prospective (programs?|programmes?|studies|cohorts)|"
    r"screening programs?|screening programmes?|real-world|retrospective|observational (studies|data)|"
    r"cohort studies|case-?control|cross-?sectional|registry (studies|data)|registries", re.IGNORECASE)
_NON_RANDOMISED = re.compile(r"non-?randomi[sz]ed|non-?randomi[sz]ation", re.IGNORECASE)
# A sentence about trials still to be done ("randomised trials are needed") is no evidence of included trials.
_FUTURE = re.compile(r"\b(need(ed|s)?|warrant(ed|s)?|future|should|further|required|awaited)\b", re.IGNORECASE)
_SENTENCES = re.compile(r"(?<=[.!?])\s+")
# Designs with no randomisation by construction: every participant gets both tests (paired), or one arm only.
NON_RANDOMISED_DESIGN = re.compile(
    r"paired[- ]reader|paired design|paired screening|single[- ]arm|before[- ]and[- ]after|pre-?post|"
    r"non-?randomi[sz]ed|uncontrolled", re.IGNORECASE)
STRONG_RANDOMISATION = re.compile(
    r"(were|was|been|being)\s+randomi[sz]ed\b|randomly (assigned|allocated)|randomi[sz]ed (\w+\s+){0,2}(to|1:1|2:1)\b|"
    r"\brandomi[sz]ation\b|\brandomi[sz]ed (controlled )?trial\b", re.IGNORECASE)


_TRIALS = re.compile(r"\btrials?\b(?!\s+emulation)", re.IGNORECASE)


def _includes_trials(text: str) -> bool:
    """Randomised-trial wording outside sentences about future research."""
    return any((RANDOMISED_WORDING.search(s) or _TRIALS.search(s)) and not _FUTURE.search(s)
               for s in _SENTENCES.split(text or ""))


def _observational_category(*texts: str) -> str | None:
    for text in texts:
        inferred = infer_design_category(text)
        if inferred in _PRIMARY_OBSERVATIONAL:
            return inferred
    return None


def check_design_consistency(card: PaperCard, pub_types: list[str] | None, title: str | None = None,
                             abstract: str | None = None) -> tuple[PaperCard, dict[str, str] | None]:
    """Cross-check the settled design_category against the publication types, the study_design text, the title, the
    abstract and the sample-size quote, and correct it in code where the evidence is clear (audit I-7). Returns the
    card and the correction made ({"from", "to", "reason"}) or None. Never touches a label the evidence supports:
    - a qualitative evidence synthesis (meta-synthesis, thematic synthesis) labelled SR/MA is `qualitative` (themes);
    - an SR/MA label needs pooled/systematic wording ("meta analysis", "review of ... trials") in the design or title,
      the publication types, a sample quote counting studies, or a review footprint in the abstract (a database
      search, a random-effects model, PRISMA, "14 trials were included"): without any, a trial's secondary/post hoc
      analysis becomes `rct` (its comparisons are by randomised arm; Plan 19's other-comparison flag keeps its
      non-randomised associations out), any other design becomes what its own text says;
    - an RCT label needs randomisation: a design or title naming an observational design (cohort, case-control,
      cross-sectional, registry, retrospective) becomes that observational design unless the design or title says
      randomised or names a trial, the abstract says participants were randomised/allocated, a placebo or a trial
      registration (NCT, ISRCTN), or the publication types say RCT.
    A card with no clear alternative keeps its label."""
    category = card.design_category
    design = card.study_design or ""
    title = title or ""
    types = {t.strip().lower() for t in pub_types or []}
    own_text = f"{design}\n{title}"
    new: str | None = None
    reason = ""
    if category in POOLED_CATEGORIES:
        if QUALITATIVE_SYNTHESIS.search(own_text) and not QUANTITATIVE_POOLING.search(own_text):
            mixed = re.search(r"qualitative and quantitative|quantitative and qualitative|mixed[- ]methods?", own_text,
                              re.IGNORECASE)
            new = "mixed_methods" if mixed else "qualitative"
            reason = "a qualitative evidence synthesis reports themes, not pooled effects"
        elif not (POOLED_WORDING.search(own_text) or types & {"meta-analysis", "systematic review"}
                  or COUNTS_STUDIES.search(card.sample_size_quote or "")
                  or REVIEW_FOOTPRINT.search(abstract or "")):  # the abstract may say what the title does not
            if TRIAL_SECONDARY.search(own_text) and (RANDOMISED_WORDING.search(own_text)
                                                     or "randomized controlled trial" in types):
                new, reason = "rct", "a secondary or post hoc analysis of a randomised trial is not a systematic review"
            else:
                inferred = infer_design_category(design)
                if inferred and inferred not in POOLED_CATEGORIES:
                    new, reason = inferred, "no systematic-review or meta-analysis wording in the design or title"
        elif category == "sr_ma_rct" and "randomized controlled trial" not in types:
            # Plan 20 Task 10: an SR/MA of RCTs must show that it includes randomised trials
            has_trials = (_includes_trials(own_text) or _includes_trials(abstract or "")
                          or _includes_trials(card.sample_size_quote or ""))
            if not has_trials:
                non_rct = NON_RCT_EVIDENCE.search(f"{own_text}\n{abstract or ''}")
                new = "sr_ma_observational" if non_rct else "sr_ma_mixed"
                reason = ("no randomised trials named; the review pools "
                          + ("diagnostic-accuracy or observational studies" if non_rct else "unstated designs"))
            elif NON_RCT_EVIDENCE.search(own_text):
                new, reason = "sr_ma_mixed", "the design or title names non-randomised studies besides trials"
    elif category == "rct" and "randomized controlled trial" not in types:
        randomised = (RANDOMISED_WORDING.search(own_text) or TRIAL_WORDING.search(own_text)
                      or RANDOMISED_IN_ABSTRACT.search(abstract or ""))
        observational = _observational_category(design, title) if OBSERVATIONAL_WORDING.search(own_text) else None
        if observational and not randomised:
            new, reason = observational, f"the design says {observational.replace('_', '-')}, with no randomisation"
        elif (NON_RANDOMISED_DESIGN.search(own_text)
              # "non-randomised" itself is no randomisation wording (Task 10 review finding 6)
              and not RANDOMISED_WORDING.search(_NON_RANDOMISED.sub(" ", own_text))
              and not STRONG_RANDOMISATION.search(_NON_RANDOMISED.sub(" ", abstract or ""))):
            # Plan 20 Task 10: a paired-reader or single-arm design is not randomised, whatever a registry number or
            # the word "trial" suggests; only explicit randomisation wording keeps the label
            if re.search(r"single[- ]arm|before[- ]and[- ]after|pre-?post|non-?randomi[sz]ed|uncontrolled", own_text,
                         re.IGNORECASE):
                new = "non_randomized_trial"
            else:
                new = observational or "cohort"
            reason = "a paired or single-arm design with no randomisation"
    if new is None or new == category:
        return card, None
    return (card.model_copy(update={"design_category": new}),
            {"from": category or "", "to": new, "reason": reason})
