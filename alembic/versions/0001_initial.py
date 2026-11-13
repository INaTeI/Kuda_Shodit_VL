"""Initial schema; immutable migration independent of current ORM models."""

from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "categories",
        sa.Column("slug", sa.String(60), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False),
    )
    op.create_table(
        "places",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("activity", sa.Text(), nullable=False),
        sa.Column("address", sa.String(500)),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("price_rub", sa.Integer()),
        sa.Column("price_note", sa.String(500), nullable=False),
        sa.Column("visiting_notes", sa.Text()),
        sa.Column("opening_hours", sa.String(500)),
        sa.Column("source_url", sa.String(2000), nullable=False),
        sa.Column("checked_at", sa.Date(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("latitude BETWEEN -90 AND 90", name="ck_lat"),
        sa.CheckConstraint("longitude BETWEEN -180 AND 180", name="ck_lon"),
        sa.CheckConstraint("price_rub IS NULL OR price_rub >= 0", name="ck_price"),
        sa.CheckConstraint("status IN ('draft','published','archived')", name="ck_status"),
    )
    op.create_index("ix_places_name", "places", ["name"])
    op.create_index("ix_places_status", "places", ["status"])
    op.create_table(
        "place_categories",
        sa.Column("place_id", sa.Uuid(), sa.ForeignKey("places.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("category_slug", sa.String(60), sa.ForeignKey("categories.slug"), primary_key=True),
    )
    op.create_table(
        "profiles",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("interests", sa.JSON(), nullable=False),
        sa.Column("budget_rub", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "place_states",
        sa.Column(
            "profile_id", sa.Uuid(), sa.ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True
        ),
        sa.Column("place_id", sa.Uuid(), sa.ForeignKey("places.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("reaction", sa.String(10)),
        sa.Column("is_known", sa.Boolean(), nullable=False),
        sa.CheckConstraint(
            "reaction IS NULL OR reaction IN ('like','dislike','neutral')", name="ck_reaction"
        ),
    )


def downgrade():
    for table in ["place_states", "profiles", "place_categories", "places", "categories"]:
        op.drop_table(table)
