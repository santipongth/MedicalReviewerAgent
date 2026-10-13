from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

from app.services.safety import refusal_code_of

ReviewType = Literal["narrative", "slr", "scoping", "meta_analysis"]
REVIEW_TYPES: tuple[str, ...] = ("narrative", "slr", "scoping", "meta_analysis")
# A meta-analysis is a systematic review plus pooled effects: it behaves exactly like "slr" (screening, selection,
# PICO, conflicts, grading, PRISMA) unless a step says otherwise.
SLR_LIKE: frozenset[str] = frozenset({"slr", "meta_analysis"})

# Plan 27: a quick answer ("ถามเร็ว") runs the same engine on a small pool and writes a 2-4 sentence answer instead of
# the report. Its sizes and review type are fixed by the service (what a caller sends for them is replaced); they are
# the single source for /status, the stub, the docs and the web form.
ReviewMode = Literal["full", "quick"]
REVIEW_MODES: tuple[str, ...] = ("full", "quick")
QUICK_MAX_PAPERS = 8
QUICK_CANDIDATE_LIMIT = 30
QUICK_REVIEW_TYPE = "slr"


def is_quick(options: dict[str, Any] | None) -> bool:
    """True for a quick answer (Plan 27); options stored before Plan 27 have no mode and are full reviews."""
    return (options or {}).get("mode") == "quick"

# Study designs the user can ask for (the scope form's step 3). Aliases map older or differently spelled values onto
# these; anything else becomes one "Other: ..." entry (data for the prompts, never an instruction).
STUDY_TYPES: tuple[str, ...] = ("RCT", "Cohort", "Case-control", "Cross-sectional", "Non-randomized trial",
                                "Qualitative", "Mixed methods", "Systematic review", "Meta-analysis")
NON_QUANTITATIVE_TYPES: frozenset[str] = frozenset({"Qualitative", "Mixed methods"})
OTHER_PREFIX = "Other: "
OTHER_MAX = 60
_STUDY_KEY = {"".join(ch for ch in t.lower() if ch.isalnum()): t for t in STUDY_TYPES} | {
    "randomizedcontrolledtrial": "RCT", "randomisedcontrolledtrial": "RCT", "rcts": "RCT",
    "casecontrolstudy": "Case-control", "cohortstudy": "Cohort", "crosssectionalstudy": "Cross-sectional",
    "nonrandomisedtrial": "Non-randomized trial", "nonrandomized": "Non-randomized trial", "quasiexperimental":
    "Non-randomized trial", "qualitativestudy": "Qualitative", "mixedmethod": "Mixed methods",
    "mixedmethodsstudy": "Mixed methods", "systematicreviews": "Systematic review", "metaanalyses": "Meta-analysis",
}


def _clean_other(text: str) -> str:
    cleaned = " ".join("".join(ch for ch in text if ch.isprintable()).split())
    return cleaned.replace("<", "").replace(">", "")[:OTHER_MAX].strip()


def _study_key(text: str) -> str:
    return "".join(ch for ch in text.lower() if ch.isalnum())


def normalize_study_types(values: list[str]) -> list[str]:
    """Canonical study-design names, deduplicated, at most one free-text "Other: ..." entry.

    A bare "Other" is dropped, "Other: <canonical name>" becomes that name, and several unknown values are joined
    into the one Other text (capped at OTHER_MAX)."""
    out: list[str] = []
    others: list[str] = []
    for raw in values or []:
        text = str(raw).strip()
        if not text:
            continue
        if _study_key(text) in ("other", "others"):
            continue  # a ticked "Other" with nothing typed
        if text.lower().startswith(OTHER_PREFIX.lower().strip()) and ":" in text:
            text = text.split(":", 1)[1].strip()
        canonical = _STUDY_KEY.get(_study_key(text))
        if canonical:
            if canonical not in out:
                out.append(canonical)
            continue
        cleaned = _clean_other(text)
        if cleaned and cleaned.lower() not in (o.lower() for o in others):
            others.append(cleaned)
    other = _clean_other(", ".join(others)).rstrip(", ")
    if other:
        out.append(OTHER_PREFIX + other)
    return out[:10]


def wants_qualitative(options: dict[str, Any] | None) -> bool:
    """True when the user asked for qualitative or mixed-methods studies (limited support: themes, no numbers)."""
    return any(t in NON_QUANTITATIVE_TYPES for t in (options or {}).get("study_types") or [])


class ReviewOptions(BaseModel):
    review_type: ReviewType = "slr"
    # Abstract-only (Plan 21): about 120 candidates with abstracts are screened and the user's N (5-50, default 30)
    # most relevant are analysed. The field bounds here are the single source for /status, the stub and the docs.
    max_papers: int = Field(30, ge=5, le=50)
    candidate_limit: int = Field(120, ge=20, le=120)
    year_from: int | None = Field(None, ge=1950, le=2100)
    study_types: list[str] = Field(default_factory=list, max_length=10)
    # Plan 27: "quick" = a short answer from QUICK_MAX_PAPERS of QUICK_CANDIDATE_LIMIT candidates; part of the cache key
    mode: ReviewMode = "full"

    @model_validator(mode="before")
    @classmethod
    def quick_sizes(cls, data: Any) -> Any:
        """A quick answer always screens QUICK_CANDIDATE_LIMIT candidates and reads QUICK_MAX_PAPERS as a graded
        systematic review: the review type and both sizes a caller sends are replaced, never rejected."""
        if isinstance(data, dict) and data.get("mode") == "quick":
            return {**data, "review_type": QUICK_REVIEW_TYPE, "max_papers": QUICK_MAX_PAPERS,
                    "candidate_limit": QUICK_CANDIDATE_LIMIT}
        return data

    @classmethod
    def bound(cls, name: str, which: str = "le") -> int:
        """A field's `ge`/`le` bound: the single source for /status, the stub and the admission worst case."""
        return next(getattr(m, which) for m in cls.model_fields[name].metadata if getattr(m, which, None) is not None)

    @field_validator("study_types")
    @classmethod
    def canonical_study_types(cls, value: list[str]) -> list[str]:
        return normalize_study_types(value)

    @model_validator(mode="after")
    def enough_candidates(self) -> ReviewOptions:
        if self.candidate_limit < self.max_papers:
            raise ValueError("candidate_limit must be at least max_papers")
        return self

    @classmethod
    def clamped(cls, raw: dict[str, Any] | None) -> ReviewOptions:
        """Options pulled into the current ranges instead of rejected: for MCP arguments and for graph state
        stored under older ranges (e.g. max_papers 3, candidate_limit 10), which must not crash a resumed review."""
        data = dict(raw or {})
        if data.get("review_type") not in REVIEW_TYPES:
            data["review_type"] = "slr"  # missing/unknown (older state) never crashes a resumed review
        if data.get("mode") not in REVIEW_MODES:
            data["mode"] = "full"  # state from before Plan 27
        bounds = {name: (f.metadata) for name, f in cls.model_fields.items()}
        for name in ("max_papers", "candidate_limit"):
            if isinstance(data.get(name), int):
                lo = next(m.ge for m in bounds[name] if getattr(m, "ge", None) is not None)
                hi = next(m.le for m in bounds[name] if getattr(m, "le", None) is not None)
                data[name] = max(lo, min(data[name], hi))
        max_papers = data.get("max_papers", cls.model_fields["max_papers"].default)
        if isinstance(data.get("candidate_limit"), int):
            data["candidate_limit"] = max(data["candidate_limit"], max_papers)
        return cls.model_validate(data)


class CreateReviewRequest(BaseModel):
    topic: str = Field(min_length=3, max_length=600)  # a topic or a full question/objective (the scope form's step 1)
    language: Literal["th", "en"] = "th"
    options: ReviewOptions = Field(default_factory=ReviewOptions)
    callback_url: HttpUrl | None = None

    @field_validator("topic")
    @classmethod
    def topic_must_have_words(cls, value: str) -> str:
        cleaned = " ".join(value.split())
        if len(cleaned) < 3 or not any(ch.isalnum() for ch in cleaned):
            raise ValueError("topic must contain at least 3 characters including letters or digits")
        return cleaned


class ReviewCreated(BaseModel):
    review_id: uuid.UUID
    status: str
    cached: bool
    # True only when this request's callback_url will receive the webhook. A cached response reuses another
    # request's review, so no webhook is scheduled for it: poll GET /reviews/{id} instead.
    callback_scheduled: bool = False


class ReviewSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    topic: str
    language: str
    status: str
    created_at: datetime
    finished_at: datetime | None
    verification_rate: float | None = None  # share of numbers verified against paper text (done reviews)


def verification_rate_of(result: dict[str, Any] | None) -> float | None:
    """The share of numbers verified against the paper text, as the result's quality summary records it."""
    quality = (result or {}).get("quality")
    rate = quality.get("verification_rate") if isinstance(quality, dict) else None
    return float(rate) if isinstance(rate, int | float) and not isinstance(rate, bool) else None


class ReviewOut(ReviewSummary):
    options: dict[str, Any]
    progress: dict[str, Any] | None = Field(None, description="reserved; progress is reported by the events stream")
    result: dict[str, Any] | None
    error: str | None
    cost_usd: float
    started_at: datetime | None
    queue_position: int | None = None  # 1 = next to start; None once running or finished
    # Plan 26: why a rejected review got no review: personal_medical (one person's own case) or declined; else null
    refusal_code: str | None = None

    @model_validator(mode="after")
    def _top_level_verification_rate(self) -> ReviewOut:
        # Plan 20 Task 10: GET /reviews/{id} left it null (it lives in result.quality); filled like GET /reviews
        if self.verification_rate is None:
            self.verification_rate = verification_rate_of(self.result)
        self.refusal_code = refusal_code_of(self.status, self.error)
        return self


def compute_cache_key(topic: str, language: str, options: dict[str, Any], version: str = "") -> str:
    """version = the pipeline/prompt version: after a change a repeated topic runs again instead of reusing
    a result produced by the old pipeline."""
    normalized = " ".join(topic.lower().split())
    material = json.dumps({"t": normalized, "l": language, "o": options, "v": version}, sort_keys=True)
    return hashlib.sha256(material.encode()).hexdigest()


def hash_ip(ip: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{ip}".encode()).hexdigest()
