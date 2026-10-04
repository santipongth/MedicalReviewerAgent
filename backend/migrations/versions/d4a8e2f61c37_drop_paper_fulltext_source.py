"""drop papers.fulltext_source (abstract-only reading)

Revision ID: d4a8e2f61c37
Revises: b7e3c1d2a9f0
Create Date: 2026-10-05 12:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "d4a8e2f61c37"
down_revision: Union[str, None] = "b7e3c1d2a9f0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("papers", "fulltext_source")


def downgrade() -> None:
    op.add_column("papers", sa.Column("fulltext_source", sa.String(length=32), nullable=True))
