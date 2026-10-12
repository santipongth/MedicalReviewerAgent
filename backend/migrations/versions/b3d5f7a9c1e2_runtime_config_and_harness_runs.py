"""runtime config versions and harness runs (Plan 23c)

Revision ID: b3d5f7a9c1e2
Revises: f2a4c6e8b0d1
Create Date: 2026-10-13 09:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "b3d5f7a9c1e2"
down_revision: Union[str, None] = "f2a4c6e8b0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")


def upgrade() -> None:
    op.create_table(
        "config_versions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("restored_from", sa.Integer(), nullable=True),
        sa.Column("document", JSON, nullable=False),
        sa.Column("changes", JSON, nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("kind", "version", name="uq_config_versions_kind_version"),
    )
    op.create_table(
        "harness_runs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("run_id", sa.String(length=64), nullable=False),
        sa.Column("prompt_version", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("active", sa.Integer(), nullable=True),
        sa.Column("max_usd", sa.Float(), nullable=False),
        sa.Column("spent_usd", sa.Float(), nullable=False),
        sa.Column("repeats", sa.Integer(), nullable=False),
        sa.Column("strata", JSON, nullable=False),
        sa.Column("max_reviews", sa.Integer(), nullable=True),
        sa.Column("compare_run", sa.String(length=129), nullable=True),
        sa.Column("planned", sa.Integer(), nullable=False),
        sa.Column("done", sa.Integer(), nullable=False),
        sa.Column("failed", sa.Integer(), nullable=False),
        sa.Column("skipped", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("report", sa.String(length=160), nullable=True),
        sa.Column("config", JSON, nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id"),
        sa.UniqueConstraint("active", name="uq_harness_runs_active"),
    )


def downgrade() -> None:
    op.drop_table("harness_runs")
    op.drop_table("config_versions")
