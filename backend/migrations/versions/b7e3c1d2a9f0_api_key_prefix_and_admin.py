"""api key prefix and admin flag

Revision ID: b7e3c1d2a9f0
Revises: ca220f421ce8
Create Date: 2026-10-04 20:20:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "b7e3c1d2a9f0"
down_revision: Union[str, None] = "ca220f421ce8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("api_keys", sa.Column("key_prefix", sa.String(length=12), nullable=True))
    op.add_column("api_keys", sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.create_index("ix_reviews_api_key_id_created_at", "reviews", ["api_key_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_reviews_api_key_id_created_at", table_name="reviews")
    op.drop_column("api_keys", "is_admin")
    op.drop_column("api_keys", "key_prefix")
