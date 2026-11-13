from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import (
    CheckConstraint, DateTime, ForeignKey, ForeignKeyConstraint, Integer,
    JSON, String, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class RecommendationRun(Base):
    __tablename__ = "recommendation_runs"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    profile_id: Mapped[UUID] = mapped_column(
        ForeignKey("profiles.id", ondelete="CASCADE"), index=True
    )
    source: Mapped[str] = mapped_column(String(20))
    algorithm_version: Mapped[str] = mapped_column(String(80))
    filters: Mapped[dict] = mapped_column(JSON)
    interests: Mapped[list] = mapped_column(JSON)
    total: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    __table_args__ = (
        CheckConstraint("source IN ('recommendations','discovery')", name="ck_run_source"),
        CheckConstraint("total >= 0", name="ck_run_total"),
    )


class RecommendationRunItem(Base):
    __tablename__ = "recommendation_items"
    recommendation_id: Mapped[UUID] = mapped_column(
        ForeignKey("recommendation_runs.id", ondelete="CASCADE"), primary_key=True
    )
    place_id: Mapped[UUID] = mapped_column(
        ForeignKey("places.id", ondelete="CASCADE"), primary_key=True
    )
    position: Mapped[int] = mapped_column(Integer)
    __table_args__ = (
        UniqueConstraint("recommendation_id", "position", name="uq_run_position"),
        CheckConstraint("position >= 0", name="ck_run_position"),
    )


class InteractionEvent(Base):
    __tablename__ = "interaction_events"
    event_id: Mapped[UUID] = mapped_column(primary_key=True)
    recommendation_id: Mapped[UUID] = mapped_column(index=True)
    place_id: Mapped[UUID] = mapped_column()
    event_type: Mapped[str] = mapped_column(String(20))
    request_payload: Mapped[dict] = mapped_column(JSON)
    reaction: Mapped[str | None] = mapped_column(String(10))
    previous_reaction: Mapped[str | None] = mapped_column(String(10))
    reaction_revision: Mapped[int | None] = mapped_column(Integer)
    undo_event_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("interaction_events.event_id", ondelete="CASCADE")
    )
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    __table_args__ = (
        ForeignKeyConstraint(
            ["recommendation_id", "place_id"],
            ["recommendation_items.recommendation_id", "recommendation_items.place_id"],
            ondelete="CASCADE",
        ),
        CheckConstraint("event_type IN ('card_view','place_open','swipe','swipe_undo')",
                        name="ck_event_type"),
        CheckConstraint("reaction IS NULL OR reaction IN ('like','dislike','neutral')",
                        name="ck_event_reaction"),
        CheckConstraint("previous_reaction IS NULL OR previous_reaction IN ('like','dislike','neutral')",
                        name="ck_event_previous_reaction"),
        CheckConstraint("reaction_revision IS NULL OR reaction_revision >= 1", name="ck_event_revision"),
    )
