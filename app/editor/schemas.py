"""Схемы конструктора. Справочники совпадают с design/place-constructor и frontend/src/placeDesign.ts."""

from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.catalog.schemas import CategoryOut

BG = {
    "paper": "#F6F7F5", "white": "#FFFFFF", "mist": "#E6F0EF", "lagoon": "#D3ECEE",
    "sand": "#F3E9D8", "dawn": "#F6D9CB", "teal": "#157F8C", "pine": "#2F5D50",
    "deep": "#16343B", "night": "#0F1E24",
}
TEXT = {"ink": "#16343B", "graphite": "#3F4F53", "teal": "#106775", "white": "#FFFFFF", "sand": "#F3E9D8"}
BLOCK_IDS = ("gallery", "title", "price", "address", "description")
DECOR_WEIGHTS = {
    "smile": 5, "grin": 5, "wave": 5, "coffee": 5, "art": 5, "music": 5, "love": 10, "fire": 10,
    "sunset": 10, "star": 15, "gem": 20, "trophy": 20,
    "new": 10, "seaview": 10, "cozy": 10, "kids": 10, "date": 10, "hit": 15, "editor": 20,
}
MAX_DECOR_WEIGHT = 50
MAX_PHOTOS = 12
MIN_TEXT_CONTRAST = 4.5

BgId = Literal["paper", "white", "mist", "lagoon", "sand", "dawn", "teal", "pine", "deep", "night"]
TextId = Literal["auto", "ink", "graphite", "teal", "white", "sand"]
BlockId = Literal["gallery", "title", "price", "address", "description"]
DecorId = Literal[
    "smile", "grin", "wave", "coffee", "art", "music", "love", "fire", "sunset", "star", "gem",
    "trophy", "new", "seaview", "cozy", "kids", "date", "hit", "editor",
]


def _luminance(color: str) -> float:
    channels = [int(color[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    lin = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def contrast(a: str, b: str) -> float:
    x, y = _luminance(a), _luminance(b)
    return (max(x, y) + 0.05) / (min(x, y) + 0.05)


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BlockStyle(Strict):
    bg: BgId
    text: TextId
    size: Literal["S", "M", "L"]
    width: Literal["full", "half"]
    hidden: bool = False

    @model_validator(mode="after")
    def readable(self):
        if self.text != "auto" and contrast(TEXT[self.text], BG[self.bg]) < MIN_TEXT_CONTRAST:
            raise ValueError("Цвет текста нечитаем на выбранном фоне: выберите «Авто» или другой цвет")
        return self


class PageDesign(Strict):
    preset: Literal["classic", "sea", "magazine", "night", "warm"] | None = None
    order: list[BlockId] = Field(min_length=5, max_length=5)
    blocks: dict[BlockId, BlockStyle]

    @model_validator(mode="after")
    def complete(self):
        if sorted(self.order) != sorted(BLOCK_IDS):
            raise ValueError("Порядок должен содержать каждый блок ровно один раз")
        if set(self.blocks) != set(BLOCK_IDS):
            raise ValueError("Нужны настройки всех пяти блоков")
        if self.blocks["title"].hidden:
            raise ValueError("Блок названия нельзя скрыть")
        return self


class CardDesign(Strict):
    preset: Literal["light", "teal", "sand", "night", "polaroid"] | None = None
    bg: BgId
    framed: bool = False
    items: list[DecorId] = Field(default_factory=list, max_length=19)

    @model_validator(mode="after")
    def weight(self):
        if len(set(self.items)) != len(self.items):
            raise ValueError("Каждое украшение можно добавить один раз")
        if sum(DECOR_WEIGHTS[i] for i in self.items) > MAX_DECOR_WEIGHT:
            raise ValueError(f"Суммарный вес украшений больше {MAX_DECOR_WEIGHT}")
        return self


class PhotoRef(Strict):
    id: UUID
    alt: str = Field(default="", max_length=140)

    @field_validator("alt")
    @classmethod
    def strip(cls, value):
        return value.strip()


class DesignSave(Strict):
    expected_revision: int = Field(ge=0, description="0 — оформления ещё нет")
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=10000)
    address: str | None = Field(default=None, max_length=500)
    title_accent: int | None = Field(default=None, ge=-1, le=60)
    page: PageDesign
    card: CardDesign
    photos: list[PhotoRef] = Field(default_factory=list, max_length=MAX_PHOTOS)
    main_photo_id: UUID | None = None

    @model_validator(mode="after")
    def consistent(self):
        self.name = self.name.strip()
        self.description = self.description.strip()
        self.address = (self.address or "").strip() or None
        if not self.name or not self.description:
            raise ValueError("Название и описание не могут быть пустыми")
        if self.title_accent == -1:
            self.title_accent = None
        if self.title_accent is not None and self.title_accent >= len(self.name.split()):
            raise ValueError("Акцентное слово вне названия")
        ids = [p.id for p in self.photos]
        if len(set(ids)) != len(ids):
            raise ValueError("Фото повторяются")
        if self.main_photo_id is not None and self.main_photo_id not in ids:
            raise ValueError("Главное фото должно быть среди фото места")
        if self.main_photo_id is None and ids:
            self.main_photo_id = ids[0]
        return self


class LoginIn(Strict):
    username: str = Field(min_length=1, max_length=60)
    password: str = Field(min_length=1, max_length=200)


class SessionOut(BaseModel):
    username: str
    expires_at: datetime


class PhotoOut(BaseModel):
    id: UUID
    url: str
    alt: str


class PublicDesign(BaseModel):
    place_id: UUID
    revision: int
    updated_at: datetime
    title_accent: int | None
    page: PageDesign
    card: CardDesign
    photos: list[PhotoOut]
    main_photo_id: UUID | None


class EditorPlaceSummary(BaseModel):
    id: UUID
    name: str
    status: str
    has_design: bool
    updated_at: datetime | None


class EditorPlaceFields(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    description: str
    address: str | None
    status: str
    price_rub: int | None
    price_note: str
    checked_at: date | None
    categories: list[CategoryOut]


class EditorPlace(BaseModel):
    place: EditorPlaceFields
    revision: int
    design: PublicDesign | None
