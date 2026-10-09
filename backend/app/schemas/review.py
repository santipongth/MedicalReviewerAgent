from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator, model_validator

ReviewType = Literal["narrative", "slr", "scoping"]
REVIEW_TYPES: tuple[str, ...] = ("narrative", "slr", "scoping")


class ReviewOptions(BaseModel):
    review_type: ReviewType = "slr"
    # Abstract-only: up to 60 candidates with abstracts are screened and the 30 most relevant are analysed.
    max_papers: int = Field(30, ge=5, le=30)
    candidate_limit: int = Field(60, ge=20, le=100)
    year_from: int | None = Field(None, ge=1950, le=2100)
    study_types: list[str] = Field(default_factory=list, max_length=10)

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
    topic: str = Field(min_length=3, max_length=300)
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


class ReviewOut(ReviewSummary):
    options: dict[str, Any]
    progress: dict[str, Any] | None = Field(None, description="reserved; progress is reported by the events stream")
    result: dict[str, Any] | None
    error: str | None
    cost_usd: float
    started_at: datetime | None
    queue_position: int | None = None  # 1 = next to start; None once running or finished


def compute_cache_key(topic: str, language: str, options: dict[str, Any], version: str = "") -> str:
    """version = the pipeline/prompt version: after a change a repeated topic runs again instead of reusing
    a result produced by the old pipeline."""
    normalized = " ".join(topic.lower().split())
    material = json.dumps({"t": normalized, "l": language, "o": options, "v": version}, sort_keys=True)
    return hashlib.sha256(material.encode()).hexdigest()


def hash_ip(ip: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{ip}".encode()).hexdigest()
