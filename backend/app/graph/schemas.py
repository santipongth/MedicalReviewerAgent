"""Domain models. Graph state stores their .model_dump(); nodes re-validate on read.

LLM output models keep every property required (nullable where needed) so they map 1:1 onto
Anthropic structured outputs (json_schema)."""
from __future__ import annotations

import hashlib
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.services.text import normalize_title

Direction = Literal["positive", "negative", "null", "mixed", "unclear"]
EffectMeasure = Literal["HR", "OR", "RR", "RD", "MD", "SMD", "r", "other", "none"]


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


class QueryPlan(BaseModel):
    queries: list[str]
    population: str
    intervention_or_exposure: str
    comparator: str
    outcomes: list[str]
    inclusion_criteria: list[str]
    exclusion_criteria: list[str]


class ScreenDecision(BaseModel):
    ref: str
    relevance: int
    include: bool
    reason: str


class ScreenBatch(BaseModel):
    decisions: list[ScreenDecision]


class OutcomeResult(BaseModel):
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


class PaperCard(BaseModel):
    study_design: str
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


class ComparisonCell(BaseModel):
    ref: str
    finding: str
    direction: Direction
    effect_measure: str | None = None
    effect_value: float | None = None
    ci_lower: float | None = None
    ci_upper: float | None = None


class ComparisonRow(BaseModel):
    outcome: str
    cells: list[ComparisonCell]


class EvidenceCluster(BaseModel):
    statement: str
    refs: list[str]
    explanation: str
    likely_reasons: list[str] = Field(default_factory=list)


class Synthesis(BaseModel):
    executive_summary: str
    comparison: list[ComparisonRow]
    consensus: list[EvidenceCluster]
    conflicts: list[EvidenceCluster]
    evidence_strength: Literal["high", "moderate", "low", "very_low"]
    evidence_rationale: str
    research_gaps: list[str]
    grade_baseline: str | None = None


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


class SynthesisNarrative(BaseModel):
    executive_summary: str
    evidence_strength: Literal["high", "moderate", "low", "very_low"]
    evidence_rationale: str
    research_gaps: list[str]


class TranslationItem(BaseModel):
    id: str
    text: str


class TranslationBatch(BaseModel):
    items: list[TranslationItem]
