from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

JSONType = JSON().with_variant(JSONB(), "postgresql")


class Base(DeclarativeBase):
    pass


class ReviewStatus(str, enum.Enum):
    queued = "queued"
    running = "running"
    done = "done"
    error = "error"
    rejected = "rejected"
    cancelled = "cancelled"


TERMINAL_STATUSES = {
    ReviewStatus.done.value,
    ReviewStatus.error.value,
    ReviewStatus.rejected.value,
    ReviewStatus.cancelled.value,
}


def _partial_unique(name: str, column: str) -> Index:
    where = text(f"{column} IS NOT NULL")
    return Index(name, column, unique=True, postgresql_where=where, sqlite_where=where)


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    key_hash: Mapped[str] = mapped_column(String(64), unique=True)
    key_prefix: Mapped[str | None] = mapped_column(String(12), nullable=True)
    name: Mapped[str] = mapped_column(String(100))
    daily_quota: Mapped[int] = mapped_column(Integer, default=100)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (
        # At most one queued/running review per cache key: concurrent identical POSTs (or two
        # API replicas) cannot both start a job; the loser re-selects the winner.
        Index(
            "ux_reviews_active_cache_key",
            "cache_key",
            unique=True,
            postgresql_where=text("status IN ('queued', 'running')"),
            sqlite_where=text("status IN ('queued', 'running')"),
        ),
        Index("ix_reviews_api_key_id_created_at", "api_key_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    topic: Mapped[str] = mapped_column(Text)
    cache_key: Mapped[str] = mapped_column(String(64), index=True)
    language: Mapped[str] = mapped_column(String(8), default="th")
    options: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    status: Mapped[str] = mapped_column(String(16), default=ReviewStatus.queued.value, index=True)
    progress: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)
    result: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    api_key_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid, ForeignKey("api_keys.id"), nullable=True
    )
    callback_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    model_versions: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)
    prompt_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    is_listed: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Paper(Base):
    __tablename__ = "papers"
    __table_args__ = (
        _partial_unique("ux_papers_doi", "doi"),
        _partial_unique("ux_papers_pmid", "pmid"),
        _partial_unique("ux_papers_pmcid", "pmcid"),
        _partial_unique("ux_papers_arxiv", "arxiv_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    doi: Mapped[str | None] = mapped_column(String(255), nullable=True)
    pmid: Mapped[str | None] = mapped_column(String(32), nullable=True)
    pmcid: Mapped[str | None] = mapped_column(String(32), nullable=True)
    arxiv_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    title: Mapped[str] = mapped_column(Text)
    authors: Mapped[list[str]] = mapped_column(JSONType, default=list)
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    journal: Mapped[str | None] = mapped_column(Text, nullable=True)
    abstract: Mapped[str | None] = mapped_column(Text, nullable=True)
    oa_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    fulltext_source: Mapped[str | None] = mapped_column(String(32), nullable=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSONType, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ReviewPaper(Base):
    __tablename__ = "review_papers"

    review_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("reviews.id", ondelete="CASCADE"), primary_key=True
    )
    paper_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("papers.id", ondelete="CASCADE"), primary_key=True
    )
    rank: Mapped[int | None] = mapped_column(Integer, nullable=True)
    relevance_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    screen_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    included: Mapped[bool] = mapped_column(Boolean, default=False)
    extraction: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)


class ReviewEvent(Base):
    __tablename__ = "review_events"
    __table_args__ = (UniqueConstraint("review_id", "seq", name="uq_review_events_seq"),)

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    review_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("reviews.id", ondelete="CASCADE"), index=True
    )
    seq: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
