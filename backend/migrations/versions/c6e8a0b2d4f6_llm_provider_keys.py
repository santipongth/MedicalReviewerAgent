"""llm provider keys (Plan 23e)

Revision ID: c6e8a0b2d4f6
Revises: b3d5f7a9c1e2
Create Date: 2026-10-14 09:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c6e8a0b2d4f6"
down_revision: Union[str, None] = "b3d5f7a9c1e2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "llm_provider_keys",
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("ciphertext", sa.Text(), nullable=True),
        sa.Column("last4", sa.String(length=4), nullable=True),
        sa.Column("bound_origin", sa.String(length=255), nullable=True),
        sa.Column("revision", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_by", sa.String(length=64), nullable=False),
        sa.PrimaryKeyConstraint("provider"),
    )


def downgrade() -> None:
    op.drop_table("llm_provider_keys")
