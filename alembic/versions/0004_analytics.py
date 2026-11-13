"""Recommendation snapshots, interaction history and reaction concurrency versions."""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = depends_on = None


def upgrade():
    op.add_column("place_states", sa.Column("reaction_revision", sa.Integer(), server_default="0", nullable=False))
    op.create_check_constraint("ck_reaction_revision", "place_states", "reaction_revision >= 0")
    op.create_table(
        "recommendation_runs",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("profile_id", sa.Uuid(), sa.ForeignKey("profiles.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("algorithm_version", sa.String(80), nullable=False),
        sa.Column("filters", sa.JSON(), nullable=False),
        sa.Column("interests", sa.JSON(), nullable=False),
        sa.Column("total", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("source IN ('recommendations','discovery')", name="ck_run_source"),
        sa.CheckConstraint("total >= 0", name="ck_run_total"),
    )
    op.create_index("ix_recommendation_runs_profile_id", "recommendation_runs", ["profile_id"])
    op.create_index("ix_recommendation_runs_created_at", "recommendation_runs", ["created_at"])
    op.create_table(
        "recommendation_items",
        sa.Column("recommendation_id", sa.Uuid(), sa.ForeignKey("recommendation_runs.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("place_id", sa.Uuid(), sa.ForeignKey("places.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.UniqueConstraint("recommendation_id", "position", name="uq_run_position"),
        sa.CheckConstraint("position >= 0", name="ck_run_position"),
    )
    op.create_table(
        "interaction_events",
        sa.Column("event_id", sa.Uuid(), primary_key=True),
        sa.Column("recommendation_id", sa.Uuid(), nullable=False),
        sa.Column("place_id", sa.Uuid(), nullable=False),
        sa.Column("event_type", sa.String(20), nullable=False),
        sa.Column("request_payload", sa.JSON(), nullable=False),
        sa.Column("reaction", sa.String(10)),
        sa.Column("previous_reaction", sa.String(10)),
        sa.Column("reaction_revision", sa.Integer()),
        sa.Column("undo_event_id", sa.Uuid(), sa.ForeignKey("interaction_events.event_id", ondelete="CASCADE")),
        sa.Column("received_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["recommendation_id", "place_id"],
                                ["recommendation_items.recommendation_id", "recommendation_items.place_id"],
                                ondelete="CASCADE"),
        sa.CheckConstraint("event_type IN ('card_view','place_open','swipe','swipe_undo')", name="ck_event_type"),
        sa.CheckConstraint("reaction IS NULL OR reaction IN ('like','dislike','neutral')", name="ck_event_reaction"),
        sa.CheckConstraint("previous_reaction IS NULL OR previous_reaction IN ('like','dislike','neutral')", name="ck_event_previous_reaction"),
        sa.CheckConstraint("reaction_revision IS NULL OR reaction_revision >= 1", name="ck_event_revision"),
    )
    op.create_index("ix_interaction_events_recommendation_id", "interaction_events", ["recommendation_id"])
    op.create_index("ix_interaction_events_received_at", "interaction_events", ["received_at"])


def downgrade():
    op.drop_table("interaction_events")
    op.drop_table("recommendation_items")
    op.drop_table("recommendation_runs")
    op.drop_constraint("ck_reaction_revision", "place_states", type_="check")
    op.drop_column("place_states", "reaction_revision")
