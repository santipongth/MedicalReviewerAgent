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


class AdminUser(Base):
    """An admin console account (Plan 23a). Created only by `python -m app.cli.admin create`."""

    __tablename__ = "admin_users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(String(32), unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AdminAudit(Base):
    """Who changed what, before and after, and when. Never edited or deleted by the application."""

    __tablename__ = "admin_audit"

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    actor_kind: Mapped[str] = mapped_column(String(8))  # user | key | cli
    actor_id: Mapped[uuid.UUID | None] = mapped_column(Uuid, nullable=True)
    actor_label: Mapped[str] = mapped_column(String(64))
    action: Mapped[str] = mapped_column(String(48))
    target_type: Mapped[str | None] = mapped_column(String(16), nullable=True)
    target_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    before: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)
    after: Mapped[dict[str, Any] | None] = mapped_column(JSONType, nullable=True)
    ip_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)


class LlmConfigVersion(Base):
    """One saved LLM configuration (Plan 23b), in the config/llm.yaml shape. Never updated or deleted; the newest
    row is the configuration in use, and while the table is empty config/llm.yaml is."""

    __tablename__ = "llm_config_versions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by: Mapped[str] = mapped_column(String(64))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(16))  # edit | restore | file
    restored_from: Mapped[int | None] = mapped_column(Integer, nullable=True)
    config: Mapped[dict[str, Any]] = mapped_column(JSONType)
    changes: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)


class ConfigVersion(Base):
    """One saved runtime document (Plan 23c): kind "settings" (the admin's overrides of env settings) or "glossary"
    (the Thai glossary). Never updated or deleted; the newest version of a kind is in use, and while a kind has none
    its seed is (env values, the built-in glossary)."""

    __tablename__ = "config_versions"
    __table_args__ = (UniqueConstraint("kind", "version", name="uq_config_versions_kind_version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(16))
    version: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by: Mapped[str] = mapped_column(String(64))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(16))  # edit | restore | reset
    restored_from: Mapped[int | None] = mapped_column(Integer, nullable=True)
    document: Mapped[dict[str, Any]] = mapped_column(JSONType)
    changes: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)


class HarnessRun(Base):
    """A Cochrane harness run started from the admin console (Plan 23c). `active` is 1 while the run is queued or
    running and NULL afterwards; its unique constraint allows one active run at a time."""

    __tablename__ = "harness_runs"
    __table_args__ = (UniqueConstraint("active", name="uq_harness_runs_active"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(64), unique=True)
    prompt_version: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16))  # queued | running | done | stopped | cancelled | error
    active: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_usd: Mapped[float] = mapped_column(Float)
    spent_usd: Mapped[float] = mapped_column(Float, default=0.0)
    repeats: Mapped[int] = mapped_column(Integer)
    strata: Mapped[list[str]] = mapped_column(JSONType, default=list)
    max_reviews: Mapped[int | None] = mapped_column(Integer, nullable=True)
    compare_run: Mapped[str | None] = mapped_column(String(129), nullable=True)
    planned: Mapped[int] = mapped_column(Integer, default=0)
    done: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    skipped: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    report: Mapped[str | None] = mapped_column(String(160), nullable=True)
    config: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)  # {llm_config, settings_version, glossary}
