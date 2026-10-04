from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, field_validator


class ReviewOptions(BaseModel):
    # 20 candidates → the 8 most relevant are read and analysed (keeps a review to ~1 minute).
    max_papers: int = Field(8, ge=3, le=10)
    candidate_limit: int = Field(20, ge=10, le=40)
    year_from: int | None = Field(None, ge=1950, le=2100)
    study_types: list[str] = Field(default_factory=list, max_length=10)


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


class ReviewSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    topic: str
    language: str
    status: str
    created_at: datetime
    finished_at: datetime | None


class ReviewOut(ReviewSummary):
    options: dict[str, Any]
    progress: dict[str, Any] | None
    result: dict[str, Any] | None
    error: str | None
    cost_usd: float
    started_at: datetime | None


def compute_cache_key(topic: str, language: str, options: dict[str, Any]) -> str:
    normalized = " ".join(topic.lower().split())
    material = json.dumps({"t": normalized, "l": language, "o": options}, sort_keys=True)
    return hashlib.sha256(material.encode()).hexdigest()


def hash_ip(ip: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}:{ip}".encode()).hexdigest()
