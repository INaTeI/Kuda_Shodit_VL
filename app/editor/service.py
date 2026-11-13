import hashlib
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Place, PlaceDesign, PlacePhoto
from app.editor.schemas import MAX_PHOTOS, DesignSave

MAX_PHOTO_BYTES = 4 * 1024 * 1024
MAX_STORED_PHOTOS = 2 * MAX_PHOTOS  # сохранённые + загруженные, но ещё не сохранённые
PENDING_TTL = timedelta(hours=24)
SIGNATURES = (
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG\r\n\x1a\n", "image/png"),
)


def photo_url(photo_id) -> str:
    return f"/api/v1/photos/{photo_id}"


def sniff_image(data: bytes) -> str | None:
    """Тип определяется по сигнатуре файла, а не по заголовку клиента. SVG не принимается."""
    for magic, kind in SIGNATURES:
        if data.startswith(magic):
            return kind
    if len(data) > 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


async def attached_photos(db: AsyncSession, place_id: UUID) -> list[PlacePhoto]:
    return list(
        await db.scalars(
            select(PlacePhoto)
            .where(PlacePhoto.place_id == place_id, PlacePhoto.position.is_not(None))
            .order_by(PlacePhoto.position)
        )
    )


async def design_out(db: AsyncSession, design: PlaceDesign | None) -> dict | None:
    if design is None:
        return None
    photos = await attached_photos(db, design.place_id)
    return {
        "place_id": design.place_id,
        "revision": design.revision,
        "updated_at": design.updated_at,
        "title_accent": design.title_accent,
        "page": design.page,
        "card": design.card,
        "photos": [{"id": p.id, "url": photo_url(p.id), "alt": p.alt} for p in photos],
        "main_photo_id": design.main_photo_id,
    }


async def load_place(db: AsyncSession, place_id: UUID, *, lock: bool = False) -> Place:
    query = select(Place).where(Place.id == place_id)
    if lock:
        query = query.with_for_update(of=Place).execution_options(populate_existing=True)
    place = await db.scalar(query)
    if place is None:
        raise HTTPException(404, "Место не найдено")
    return place


async def editor_view(db: AsyncSession, place: Place) -> dict:
    design = await db.get(PlaceDesign, place.id, populate_existing=True)
    return {
        "place": place,
        "revision": design.revision if design else 0,
        "design": await design_out(db, design),
    }


async def list_places(db: AsyncSession) -> list[dict]:
    rows = await db.execute(
        select(Place.id, Place.name, Place.status, PlaceDesign.updated_at)
        .outerjoin(PlaceDesign, PlaceDesign.place_id == Place.id)
        .order_by(func.lower(Place.name), Place.id)
    )
    return [
        {"id": r.id, "name": r.name, "status": r.status, "has_design": r.updated_at is not None,
         "updated_at": r.updated_at}
        for r in rows
    ]


async def store_photo(db: AsyncSession, place_id: UUID, data: bytes) -> PlacePhoto:
    kind = sniff_image(data)
    if kind is None:
        raise HTTPException(415, "Поддерживаются только JPEG, PNG и WebP")
    await load_place(db, place_id, lock=True)
    await db.execute(
        delete(PlacePhoto).where(
            PlacePhoto.position.is_(None),
            PlacePhoto.created_at < datetime.now(timezone.utc) - PENDING_TTL,
        )
    )
    stored = await db.scalar(
        select(func.count()).select_from(PlacePhoto).where(PlacePhoto.place_id == place_id)
    )
    if stored >= MAX_STORED_PHOTOS:
        raise HTTPException(409, "Слишком много несохранённых фото: сохраните оформление или обновите страницу")
    photo = PlacePhoto(
        place_id=place_id, content_type=kind, data=data, size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(), alt="",
    )
    db.add(photo)
    await db.commit()
    return photo


async def save_design(db: AsyncSession, place_id: UUID, data: DesignSave, username: str) -> dict:
    place = await load_place(db, place_id, lock=True)
    design = await db.get(PlaceDesign, place_id, populate_existing=True)
    current = design.revision if design else 0
    if data.expected_revision != current:
        raise HTTPException(409, f"Оформление уже изменено (версия {current}). Обновите страницу")

    ids = [p.id for p in data.photos]
    owned = set(
        await db.scalars(
            select(PlacePhoto.id).where(PlacePhoto.place_id == place_id, PlacePhoto.id.in_(ids))
        )
    ) if ids else set()
    if missing := [str(i) for i in ids if i not in owned]:
        raise HTTPException(422, f"Фото не найдены у этого места: {', '.join(missing)}")

    place.name, place.description, place.address = data.name, data.description, data.address
    # Снять позиции до переупорядочивания, чтобы не нарушить uq_photo_position.
    await db.execute(update(PlacePhoto).where(PlacePhoto.place_id == place_id).values(position=None))
    removed = delete(PlacePhoto).where(PlacePhoto.place_id == place_id)
    if ids:
        removed = removed.where(PlacePhoto.id.not_in(ids))
    await db.execute(removed)
    for position, ref in enumerate(data.photos):
        await db.execute(
            update(PlacePhoto).where(PlacePhoto.id == ref.id).values(position=position, alt=ref.alt)
        )

    values = {
        "page": data.page.model_dump(mode="json"),
        "card": data.card.model_dump(mode="json"),
        "title_accent": data.title_accent,
        "main_photo_id": data.main_photo_id,
        "updated_by": username,
    }
    if design is None:
        design = PlaceDesign(place_id=place_id, revision=1, **values)
        db.add(design)
    else:
        for key, value in values.items():
            setattr(design, key, value)
        design.revision = current + 1
    await db.commit()
    await db.refresh(design)
    return await editor_view(db, place)
