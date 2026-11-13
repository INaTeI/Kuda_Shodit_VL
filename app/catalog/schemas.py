from datetime import date
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator


class CategoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    slug: str
    name: str


class PlaceWrite(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=10000)
    activity: str = Field(min_length=1, max_length=2000)
    address: str | None = Field(default=None, max_length=500)
    latitude: float | None = Field(default=None, ge=-90, le=90, allow_inf_nan=False)
    longitude: float | None = Field(default=None, ge=-180, le=180, allow_inf_nan=False)
    price_rub: int | None = Field(default=None, ge=0, le=10000000)
    price_note: str = Field(min_length=1, max_length=500)
    visiting_notes: str | None = Field(default=None, max_length=5000)
    opening_hours: str | None = Field(default=None, max_length=500)
    source_url: HttpUrl | None = None
    checked_at: date | None = None
    category_slugs: list[str] = Field(min_length=1, max_length=8)
    status: Literal["draft", "published", "archived"] = "draft"

    @model_validator(mode="after")
    def checked_date(self):
        if self.status == "published" and any(
            value is None
            for value in (
                self.latitude,
                self.longitude,
                self.source_url,
                self.checked_at,
            )
        ):
            raise ValueError(
                "Для публикации нужны координаты, источник и дата проверки"
            )
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("Передайте обе координаты или оставьте обе пустыми")
        if self.checked_at is not None and self.checked_at > date.today():
            raise ValueError("Дата проверки не может быть в будущем")
        if len(set(self.category_slugs)) != len(self.category_slugs):
            raise ValueError("Категории не должны повторяться")
        return self


class PlaceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    description: str
    activity: str
    address: str | None
    latitude: float | None
    longitude: float | None
    price_rub: int | None
    price_note: str
    visiting_notes: str | None
    opening_hours: str | None
    source_url: str | None
    checked_at: date | None
    status: str
    categories: list[CategoryOut]
    photo_url: str | None = None
    place_type: str | None = None
    interest_tags: list[str] | None = None
    cost_details: dict | None = None


class AdminPlaceOut(PlaceOut):
    import_key: str | None = None
    source_data: dict | None = None


class AdminPlacePage(BaseModel):
    items: list[AdminPlaceOut]
    total: int
    limit: int
    offset: int


class PlacePage(BaseModel):
    items: list[PlaceOut]
    total: int
    limit: int
    offset: int


class SearchFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    categories: list[str] = Field(default_factory=list, max_length=8)
    budget_rub: int | None = Field(default=None, ge=0, le=10000000)
    latitude: float | None = Field(default=None, ge=-90, le=90, allow_inf_nan=False)
    longitude: float | None = Field(default=None, ge=-180, le=180, allow_inf_nan=False)
    radius_km: float | None = Field(default=None, gt=0, le=100, allow_inf_nan=False)
    limit: int = Field(default=5, ge=1, le=100)
    offset: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def location_group(self):
        values = [self.latitude, self.longitude, self.radius_km]
        if any(v is not None for v in values) and not all(
            v is not None for v in values
        ):
            raise ValueError("Передайте latitude, longitude и radius_km вместе")
        return self
