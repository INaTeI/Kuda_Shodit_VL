"""Preserve incomplete Excel drafts and original source data."""

from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = depends_on = None


def upgrade():
    for name, type_ in [
        ("latitude", sa.Float()),
        ("longitude", sa.Float()),
        ("checked_at", sa.Date()),
        ("source_url", sa.String(2000)),
    ]:
        op.alter_column("places", name, existing_type=type_, nullable=True)
    op.add_column("places", sa.Column("import_key", sa.String(200)))
    op.create_unique_constraint("uq_places_import_key", "places", ["import_key"])
    op.add_column("places", sa.Column("source_data", sa.JSON()))
    op.add_column("places", sa.Column("place_type", sa.String(120)))
    op.add_column("places", sa.Column("interest_tags", sa.JSON()))
    op.add_column("places", sa.Column("cost_details", sa.JSON()))
    op.create_check_constraint(
        "ck_published_complete",
        "places",
        "status != 'published' OR (latitude IS NOT NULL AND longitude IS NOT NULL "
        "AND source_url IS NOT NULL AND checked_at IS NOT NULL)",
    )


def downgrade():
    # Refuse destructive downgrade while incomplete drafts exist; fill fields first.
    op.alter_column("places", "latitude", nullable=False)
    op.alter_column("places", "longitude", nullable=False)
    op.alter_column("places", "checked_at", nullable=False)
    op.alter_column("places", "source_url", nullable=False)
    op.drop_constraint("ck_published_complete", "places", type_="check")
    op.drop_constraint("uq_places_import_key", "places", type_="unique")
    for name in [
        "import_key",
        "source_data",
        "place_type",
        "interest_tags",
        "cost_details",
    ]:
        op.drop_column("places", name)
