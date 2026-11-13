from datetime import date, datetime
from uuid import UUID, uuid4
from sqlalchemy import (
    String,
    Text,
    Float,
    Integer,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    JSON,
    Table,
    Column,
    CheckConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.db.session import Base

place_categories = Table(
    "place_categories",
    Base.metadata,
    Column("place_id", ForeignKey("places.id", ondelete="CASCADE"), primary_key=True),
    Column("category_slug", ForeignKey("categories.slug"), primary_key=True),
)


class Category(Base):
    __tablename__ = "categories"
    slug: Mapped[str] = mapped_column(String(60), primary_key=True)
    name: Mapped[str] = mapped_column(String(120))


class Place(Base):
    __tablename__ = "places"
    __table_args__ = (
        CheckConstraint("latitude BETWEEN -90 AND 90", name="ck_lat"),
        CheckConstraint("longitude BETWEEN -180 AND 180", name="ck_lon"),
        CheckConstraint("price_rub IS NULL OR price_rub >= 0", name="ck_price"),
        CheckConstraint("status IN ('draft','published','archived')", name="ck_status"),
        CheckConstraint(
            "status != 'published' OR (latitude IS NOT NULL AND longitude IS NOT NULL "
            "AND source_url IS NOT NULL AND checked_at IS NOT NULL)",
            name="ck_published_complete",
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(200), index=True)
    description: Mapped[str] = mapped_column(Text)
    activity: Mapped[str] = mapped_column(Text)
    address: Mapped[str | None] = mapped_column(String(500))
    latitude: Mapped[float | None] = mapped_column(Float)
    longitude: Mapped[float | None] = mapped_column(Float)
    price_rub: Mapped[int | None] = mapped_column(Integer)
    price_note: Mapped[str] = mapped_column(String(500))
    visiting_notes: Mapped[str | None] = mapped_column(Text)
    opening_hours: Mapped[str | None] = mapped_column(String(500))
    source_url: Mapped[str | None] = mapped_column(String(2000))
    checked_at: Mapped[date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="draft", index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    import_key: Mapped[str | None] = mapped_column(String(200), unique=True)
    source_data: Mapped[dict | None] = mapped_column(JSON)
    place_type: Mapped[str | None] = mapped_column(String(120))
    interest_tags: Mapped[list[str] | None] = mapped_column(JSON)
    cost_details: Mapped[dict | None] = mapped_column(JSON)
    categories: Mapped[list[Category]] = relationship(
        secondary=place_categories, lazy="selectin"
    )


class Profile(Base):
    __tablename__ = "profiles"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    interests: Mapped[list] = mapped_column(JSON, default=list)
    budget_rub: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class PlaceState(Base):
    __tablename__ = "place_states"
    __table_args__ = (
        CheckConstraint(
            "reaction IS NULL OR reaction IN ('like','dislike','neutral')",
            name="ck_reaction",
        ),
    )
    profile_id: Mapped[UUID] = mapped_column(
        ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True
    )
    place_id: Mapped[UUID] = mapped_column(
        ForeignKey("places.id", ondelete="CASCADE"), primary_key=True
    )
    reaction: Mapped[str | None] = mapped_column(String(10))
    is_known: Mapped[bool] = mapped_column(Boolean, default=False)
