"""Add a public photo URL to place cards."""

from alembic import op
import sqlalchemy as sa


revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("places", sa.Column("photo_url", sa.String(length=2000), nullable=True))
    op.create_table(
        "constructor_states",
        sa.Column("key", sa.String(length=80), primary_key=True),
        sa.Column("state", sa.JSON().with_variant(sa.JSON(), "sqlite"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )


def downgrade():
    op.drop_table("constructor_states")
    op.drop_column("places", "photo_url")
