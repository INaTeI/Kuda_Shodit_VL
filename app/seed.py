"""Idempotent, explicitly fictional fixtures; never scrape external catalogs."""

import asyncio
from datetime import date
from uuid import uuid5, NAMESPACE_URL
from sqlalchemy.dialects.postgresql import insert
from app.db.models import Category, Place
from app.db.session import SessionFactory, engine

CATEGORIES = {
    "food": "Кафе и рестораны",
    "culture": "Культура и история",
    "hidden-gems": "Нишевые места",
    "nature": "Природа и виды",
    "nightlife": "Ночная жизнь",
    "shopping": "Шоппинг",
    "art": "Искусство и галереи",
    "relax": "Спокойный досуг",
}


async def seed_categories(db):
    for slug, name in CATEGORIES.items():
        await db.execute(insert(Category).values(slug=slug, name=name).on_conflict_do_nothing())
    await db.commit()


async def main():
    async with SessionFactory() as db:
        await seed_categories(db)
        for index, slug in enumerate(CATEGORIES):
            place_id = uuid5(NAMESPACE_URL, f"vdk-gid-demo:{slug}")
            if await db.get(Place, place_id):
                continue
            db.add(
                Place(
                    id=place_id,
                    name=f"ДЕМО: {CATEGORIES[slug]}",
                    description="Вымышленная карточка для проверки API. Не является рекомендацией реального места.",
                    activity="Пример занятия для демонстрации",
                    latitude=43.115 + index * 0.002,
                    longitude=131.885 + index * 0.002,
                    price_rub=None if index == 7 else index * 200,
                    price_note="Демонстрационная цена на одного человека; данные вымышлены",
                    source_url="https://example.com/demo",
                    checked_at=date.today(),
                    status="published",
                    categories=[await db.get(Category, slug)],
                )
            )
        await db.commit()
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
