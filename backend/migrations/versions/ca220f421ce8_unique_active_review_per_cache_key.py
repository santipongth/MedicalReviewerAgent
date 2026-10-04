"""unique active review per cache key

Revision ID: ca220f421ce8
Revises: f0ad9e69c999
Create Date: 2026-10-04 18:09:18.529100
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "ca220f421ce8"
down_revision: Union[str, None] = "f0ad9e69c999"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ACTIVE = sa.text("status IN ('queued', 'running')")


def upgrade() -> None:
    op.create_index(
        "ux_reviews_active_cache_key",
        "reviews",
        ["cache_key"],
        unique=True,
        postgresql_where=ACTIVE,
        sqlite_where=ACTIVE,
    )


def downgrade() -> None:
    op.drop_index("ux_reviews_active_cache_key", table_name="reviews")
