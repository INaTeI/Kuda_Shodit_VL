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
    LargeBinary,
    Table,
    UniqueConstraint,
    inspect,
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
    photo_url: Mapped[str | None] = mapped_column(String(2000))
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
    design: Mapped["PlaceDesign | None"] = relationship(
        lazy="selectin", uselist=False, passive_deletes=True
    )

    def _loaded_design(self):
        # Только уже загруженное значение: свойство не должно делать запрос в async-сессии.
        value = inspect(self).attrs.design.loaded_value
        return value if isinstance(value, PlaceDesign) else None

    @property
    def photo_url(self) -> str | None:
        design = self._loaded_design()
        if design is None or design.main_photo_id is None:
            return None
        return f"/api/v1/photos/{design.main_photo_id}"

    @property
    def card_style(self) -> dict | None:
        design = self._loaded_design()
        return design.card if design is not None else None

    @property
    def title_accent(self) -> int | None:
        design = self._loaded_design()
        return design.title_accent if design is not None else None


class Profile(Base):
    __tablename__ = "profiles"
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    interests: Mapped[list] = mapped_column(JSON, default=list)
    budget_rub: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class ConstructorState(Base):
    __tablename__ = "constructor_states"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    state: Mapped[dict] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class PlaceState(Base):
    __tablename__ = "place_states"
    __table_args__ = (
        CheckConstraint(
            "reaction IS NULL OR reaction IN ('like','dislike','neutral')",
            name="ck_reaction",
        ),
        CheckConstraint("reaction_revision >= 0", name="ck_reaction_revision"),
    )
    profile_id: Mapped[UUID] = mapped_column(
        ForeignKey("profiles.id", ondelete="CASCADE"), primary_key=True
    )
    place_id: Mapped[UUID] = mapped_column(
        ForeignKey("places.id", ondelete="CASCADE"), primary_key=True
    )
    reaction: Mapped[str | None] = mapped_column(String(10))
    is_known: Mapped[bool] = mapped_column(Boolean, default=False)
    reaction_revision: Mapped[int] = mapped_column(Integer, default=0, server_default="0")


class PlaceDesign(Base):
    """Опубликованное оформление страницы и карточки места из конструктора."""

    __tablename__ = "place_designs"
    __table_args__ = (CheckConstraint("revision >= 1", name="ck_design_revision"),)
    place_id: Mapped[UUID] = mapped_column(
        ForeignKey("places.id", ondelete="CASCADE"), primary_key=True
    )
    page: Mapped[dict] = mapped_column(JSON)
    card: Mapped[dict] = mapped_column(JSON)
    title_accent: Mapped[int | None] = mapped_column(Integer)
    main_photo_id: Mapped[UUID | None] = mapped_column()
    revision: Mapped[int] = mapped_column(Integer, default=1)
    updated_by: Mapped[str] = mapped_column(String(60))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class PlacePhoto(Base):
    """Фото места. position NULL — загружено, но ещё не сохранено в оформлении."""

    __tablename__ = "place_photos"
    __table_args__ = (
        CheckConstraint("content_type IN ('image/jpeg','image/png','image/webp')", name="ck_photo_type"),
        CheckConstraint("size_bytes > 0", name="ck_photo_size"),
        CheckConstraint("position IS NULL OR position >= 0", name="ck_photo_position"),
        UniqueConstraint("place_id", "position", name="uq_photo_position"),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    place_id: Mapped[UUID] = mapped_column(
        ForeignKey("places.id", ondelete="CASCADE"), index=True
    )
    content_type: Mapped[str] = mapped_column(String(20))
    data: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    alt: Mapped[str] = mapped_column(String(140), default="")
    position: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
