"""Place constructor: published page/card design and place photos."""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "place_designs",
        sa.Column("place_id", sa.Uuid(), sa.ForeignKey("places.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("page", sa.JSON(), nullable=False),
        sa.Column("card", sa.JSON(), nullable=False),
        sa.Column("title_accent", sa.Integer()),
        sa.Column("main_photo_id", sa.Uuid()),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("updated_by", sa.String(60), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("revision >= 1", name="ck_design_revision"),
    )
    op.create_table(
        "place_photos",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("place_id", sa.Uuid(), sa.ForeignKey("places.id", ondelete="CASCADE"), nullable=False),
        sa.Column("content_type", sa.String(20), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("alt", sa.String(140), nullable=False),
        sa.Column("position", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("content_type IN ('image/jpeg','image/png','image/webp')", name="ck_photo_type"),
        sa.CheckConstraint("size_bytes > 0", name="ck_photo_size"),
        sa.CheckConstraint("position IS NULL OR position >= 0", name="ck_photo_position"),
        sa.UniqueConstraint("place_id", "position", name="uq_photo_position"),
    )
    op.create_index("ix_place_photos_place_id", "place_photos", ["place_id"])


def downgrade():
    op.drop_index("ix_place_photos_place_id", table_name="place_photos")
    op.drop_table("place_photos")
    op.drop_table("place_designs")
