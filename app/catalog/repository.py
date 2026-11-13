from sqlalchemy import select
from app.db.models import Category, Place


async def categories(db):
    return list((await db.scalars(select(Category).order_by(Category.slug))).all())


async def published(db, filters):
    query = select(Place).where(Place.status == "published")
    if filters.categories:
        query = query.where(Place.categories.any(Category.slug.in_(filters.categories)))
    if filters.budget_rub is not None:
        query = query.where(Place.price_rub.is_not(None), Place.price_rub <= filters.budget_rub)
    return list((await db.scalars(query.order_by(Place.id))).all())


async def by_id(db, place_id):
    return await db.get(Place, place_id)
