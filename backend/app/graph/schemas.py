"""Domain models. Graph state stores their .model_dump(); nodes re-validate on read.

LLM output models keep every property required (nullable where needed) so they map 1:1 onto
Anthropic structured outputs (json_schema)."""
from __future__ import annotations

import hashlib
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.services.text import normalize_title

Direction = Literal["positive", "negative", "null", "mixed", "unclear"]
EffectMeasure = Literal["HR", "OR", "RR", "RD", "MD", "SMD", "r", "other", "none"]
DesignCategory = Literal["rct", "non_randomized_trial", "cohort", "case_control", "cross_sectional", "case_series",
                         "mendelian_randomization", "sr_ma_rct", "sr_ma_observational", "sr_ma_mixed",
                         "narrative_review", "qualitative", "mixed_methods", "other"]
DESIGN_CATEGORIES: tuple[str, ...] = DesignCategory.__args__


def candidate_key(*, doi: str | None, pmid: str | None, arxiv_id: str | None, title: str) -> str:
    if doi:
        return f"doi:{doi}"
    if pmid:
        return f"pmid:{pmid}"
    if arxiv_id:
        return f"arxiv:{arxiv_id}"
    return "title:" + hashlib.sha1(normalize_title(title).encode()).hexdigest()[:16]


class Candidate(BaseModel):
    key: str = ""
    title: str
    abstract: str | None = None
    # Where the abstract came from: a curated record (europepmc), the arXiv summary, a full abstract returned by a
    # SearXNG engine (engine: pubmed, europe pmc, doaj, plos, openaire), the English abstract a ThaiJO journal
    # published (thaijo, Plan 24), or a search-engine snippet,
    # which is often truncated and only counts as an abstract when it looks complete (see retrieval.usable_abstract).
    abstract_source: Literal["europepmc", "arxiv", "engine", "thaijo", "snippet"] | None = None
    doi: str | None = None
    pmid: str | None = None
    pmcid: str | None = None
    arxiv_id: str | None = None
    year: int | None = None
    journal: str | None = None
    authors: list[str] = Field(default_factory=list)
    url: str | None = None
    pdf_url: str | None = None
    is_open_access: bool = False
    pub_types: list[str] = Field(default_factory=list)
    cited_by: int | None = None
    engines: list[str] = Field(default_factory=list)
    # Plan 24: the ThaiJO article page (https://<journal host>.tci-thaijo.org/index.php/<journal>/article/view/<id>),
    # checked when parsed; the report links it and the OAI-PMH step reads the record from its host. Never a PDF.
    thaijo_url: str | None = None

    @model_validator(mode="after")
    def _fill_key(self) -> Candidate:
        if not self.key:
            self.key = candidate_key(
                doi=self.doi, pmid=self.pmid, arxiv_id=self.arxiv_id, title=self.title
            )
        return self


# ---- LLM structured outputs -----------------------------------------------------------
class TopicVerdict(BaseModel):
    allowed: bool
    reason: str
    english_topic: str


QuestionType = Literal[
    "therapy", "prevention", "harm_etiology", "diagnosis", "prognosis", "prevalence", "mechanism", "other"
]


class KeyTerm(BaseModel):
    term: str
    synonyms: list[str]
    mesh: str | None


def _require_pcc(schema: dict) -> None:
    for name in ("concept", "context"):  # required-nullable: PICO reviews return null
        schema.setdefault("required", []).append(name)
        schema["properties"][name].pop("default", None)  # strict tool schemas reject "default"


class ReviewQuestion(BaseModel):
    """The user's topic interpreted and rewritten as an answerable research question (English)."""

    model_config = ConfigDict(json_schema_extra=_require_pcc)

    question_type: QuestionType
    interpretation: str
    refined_question: str
    population: str
    intervention_or_exposure: str
    comparator: str
    outcomes: list[str]
    study_designs: list[str]
    timeframe: str | None
    sub_questions: list[str]
    key_terms: list[KeyTerm]
    assumptions: list[str]
    ambiguities: list[str]
    concept: str | None = None  # PCC (scoping) only; PICO reviews return null
    context: str | None = None


class QuestionCritique(BaseModel):
    issues: list[str]
    revised: ReviewQuestion


class QueryPlan(BaseModel):
    queries: list[str]
    population: str
    intervention_or_exposure: str
    comparator: str
    outcomes: list[str]
    inclusion_criteria: list[str]
    exclusion_criteria: list[str]


ExclusionReason = Literal["off_topic", "population", "intervention_exposure", "outcome", "study_design",
                          "publication_type", "other"]


def _require_nullable(schema: dict) -> None:
    for name in ("design_guess", "exclusion_reason"):
        schema.setdefault("required", []).append(name)
        schema["properties"][name].pop("default", None)  # strict tool schemas reject "default"


class ScreenDecision(BaseModel):
    model_config = ConfigDict(json_schema_extra=_require_nullable)

    ref: str
    relevance: int
    include: bool
    reason: str
    design_guess: DesignCategory | None = None  # from title/abstract; lets select_top keep narrative reviews out
    exclusion_reason: ExclusionReason | None = None  # why an excluded paper was dropped (PRISMA); null when included


class ScreenBatch(BaseModel):
    decisions: list[ScreenDecision]


def _require_comparison(schema: dict) -> None:
    # Required for the model; the Python defaults only serve outcomes stored before Plan 19 (treated as matching).
    for name in ("comparison", "matches_question"):
        schema.setdefault("required", []).append(name)
        schema["properties"][name].pop("default", None)  # strict tool schemas reject "default"


class OutcomeResult(BaseModel):
    model_config = ConfigDict(json_schema_extra=_require_comparison)

    outcome: str
    result: str
    evidence_quote: str  # verbatim sentence(s) from the paper that support result and numbers
    effect_size: str | None  # as reported, e.g. "HR 0.80 (95% CI 0.71-0.90)"
    effect_measure: EffectMeasure
    effect_value: float | None  # numeric point estimate for forest plots (Plan 4)
    ci_lower: float | None
    ci_upper: float | None
    p_value: float | None
    direction: Direction
    # Plan 19: the two groups this estimate compares ("metformin vs sulfonylureas"), and whether that is the review
    # question's intervention vs comparator. A false outcome is an "other comparison": shown on the card, never in
    # the matrix, conflicts, pools or grade.
    comparison: str | None = None
    matches_question: bool = True


MAX_OUTCOMES = 6  # an abstract rarely reports more; the extractor lists the most relevant first


def _require_design_category(schema: dict) -> None:
    # Required (nullable) for the model; the Python default only serves cards stored before the field existed.
    schema.setdefault("required", []).append("design_category")
    schema["properties"]["design_category"].pop("default", None)  # strict tool schemas reject "default"


class PaperCard(BaseModel):
    model_config = ConfigDict(json_schema_extra=_require_design_category)

    study_design: str  # free-text detail as the paper describes it
    design_category: DesignCategory | None = None  # fixed category used for grading, filters and evidence tiers
    population: str
    sample_size: int | None
    sample_size_quote: str | None  # verbatim text stating the sample size
    intervention_or_exposure: str
    comparator: str | None
    outcomes: list[OutcomeResult]
    key_findings: list[str]
    limitations: list[str]
    funding_or_conflicts: str | None
    risk_of_bias: Literal["low", "moderate", "high", "unclear"]
    overall_direction: Direction

    @field_validator("outcomes", mode="before")
    @classmethod
    def keep_quoted_outcomes(cls, value: Any) -> Any:
        """Measured on Qwen3.5 Flash: the model lists every outcome of interest and gives the unreported ones a null
        evidence_quote, which used to reject the whole card on every repair. An outcome without a quote is simply not
        reported by the abstract, so it is dropped here; the rest of the card stays usable."""
        if not isinstance(value, list):
            return value
        quoted = [o for o in value if not isinstance(o, dict) or (o.get("evidence_quote") or "").strip()]
        return quoted[:MAX_OUTCOMES]

    @field_validator("key_findings", "limitations", mode="before")
    @classmethod
    def null_list_is_empty(cls, value: Any) -> Any:
        return [] if value is None else value


class ComparisonCell(BaseModel):
    ref: str
    finding: str
    direction: Direction
    effect_measure: str | None = None
    effect_value: float | None = None
    ci_lower: float | None = None
    ci_upper: float | None = None
    design_category: str | None = None
    pooled: bool = False  # from a systematic review / meta-analysis (may overlap with primary studies)


class ComparisonRow(BaseModel):
    outcome: str
    cells: list[ComparisonCell]


class EvidenceCluster(BaseModel):
    statement: str
    refs: list[str]
    explanation: str
    likely_reasons: list[str] = Field(default_factory=list)
    # Plan 20 Task 11: the matrix entry's flag, so clients can tell a split between systematic reviews and primary
    # studies (or a consensus that significant reviews contradict) from an ordinary one; it never lowers the grade
    review_discordant: bool = False


class KeyFinding(BaseModel):
    """One key finding of the report (Plan 20): a numberless statement about one outcome. The report renders the
    numbers from the referenced cards (verified) or the matching pool (computed), never from this text. `k` is the
    number of cited papers, set in code."""
    outcome: str
    statement: str
    refs: list[str]
    k: int
    # set in code (never by the model): the review's final evidence_strength for graded types, null otherwise
    certainty: Literal["high", "moderate", "low", "very_low"] | None = None


class Synthesis(BaseModel):
    executive_summary: str  # the discussion (Plan 20); the report leads with `answer` and `key_findings`
    comparison: list[ComparisonRow]
    consensus: list[EvidenceCluster]
    conflicts: list[EvidenceCluster]
    evidence_strength: Literal["high", "moderate", "low", "very_low"] | None = None  # None: not graded (narrative, scoping)
    evidence_rationale: str
    research_gaps: list[str]
    grade_baseline: str | None = None
    answer: str = ""  # Plan 20: 1-2 sentence direct answer ("" for results stored before it or a failed narrative)
    key_findings: list[KeyFinding] = Field(default_factory=list)


# ---- Harness steps (LLM outputs) ---------------------------------------------------------
class OutcomeMember(BaseModel):
    ref: str
    outcome: str


class OutcomeCluster(BaseModel):
    canonical: str
    members: list[OutcomeMember]


class OutcomeClusters(BaseModel):
    clusters: list[OutcomeCluster]


class ConflictNote(BaseModel):
    outcome: str
    refs: list[str]
    likely_reasons: list[str]
    explanation: str


class NarrativeFinding(BaseModel):
    """A key finding as the model writes it; code checks it and adds `k` (KeyFinding)."""
    outcome: str
    statement: str
    refs: list[str]


def _require_answer(schema: dict) -> None:
    # Required for the model (Plan 20); the Python defaults only keep hand-built narratives (tests, fallbacks) short.
    for name in ("answer", "key_findings"):
        schema.setdefault("required", []).append(name)
        schema["properties"][name].pop("default", None)  # strict tool schemas reject "default"


class SynthesisNarrative(BaseModel):
    model_config = ConfigDict(json_schema_extra=_require_answer)

    executive_summary: str
    evidence_strength: Literal["high", "moderate", "low", "very_low"]
    evidence_rationale: str
    research_gaps: list[str]
    answer: str = ""
    key_findings: list[NarrativeFinding] = Field(default_factory=list)


class NarrativeNoGrade(BaseModel):
    """Narrative and scoping reviews are not graded: the model writes the answer, key findings, summary and gaps."""
    model_config = ConfigDict(json_schema_extra=_require_answer)

    executive_summary: str
    research_gaps: list[str]
    answer: str = ""
    key_findings: list[NarrativeFinding] = Field(default_factory=list)


class TranslationItem(BaseModel):
    id: str
    text: str


class TranslationBatch(BaseModel):
    items: list[TranslationItem]


class SupportVerdict(BaseModel):
    """Plan 25: the judge's label for one (claim, cited paper) pair. `sentence`: the 1-based candidate that supports
    the claim (supported, partial); null when unsupported."""
    id: str
    label: Literal["supported", "partial", "unsupported"]
    sentence: int | None


class SupportBatch(BaseModel):
    verdicts: list[SupportVerdict]


class ExternalCall(BaseModel):
    tool: str
    arguments_json: str  # JSON object with the tool's arguments (a string keeps the schema strict-compatible)


class ToolPlan(BaseModel):
    rationale: str
    calls: list[ExternalCall]
