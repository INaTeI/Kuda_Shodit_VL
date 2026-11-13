from math import asin, cos, radians, sin, sqrt
from fastapi import HTTPException
from app.catalog import repository
from app.db.models import Place


async def validate_categories(db, slugs):
    available = {c.slug: c for c in await repository.categories(db)}
    missing = set(slugs) - available.keys()
    if missing:
        raise HTTPException(
            422, detail=f"Неизвестные категории: {', '.join(sorted(missing))}"
        )
    return [available[s] for s in slugs]


def distance_km(lat1, lon1, lat2, lon2):
    a = (
        sin(radians(lat2 - lat1) / 2) ** 2
        + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lon2 - lon1) / 2) ** 2
    )
    return 6371.0088 * 2 * asin(sqrt(min(1.0, max(0.0, a))))


async def candidates(db, filters):
    await validate_categories(db, filters.categories)
    places = await repository.published(db, filters)
    if filters.radius_km is not None:
        places = [
            p
            for p in places
            if distance_km(filters.latitude, filters.longitude, p.latitude, p.longitude)
            <= filters.radius_km
        ]
    return places


async def get_public(db, place_id):
    place = await repository.by_id(db, place_id)
    if place is None or place.status == "draft":
        raise HTTPException(404, "Место не найдено")
    if place.status == "archived":
        raise HTTPException(410, "Место снято с публикации")
    return place


async def save(db, data, place=None):
    cats = await validate_categories(db, data.category_slugs)
    values = data.model_dump(exclude={"category_slugs"})
    values["source_url"] = str(data.source_url) if data.source_url is not None else None
    if place is None:
        place = Place(**values, categories=cats)
        db.add(place)
    else:
        for key, value in values.items():
            setattr(place, key, value)
        place.categories = cats
    await db.commit()
    return place
