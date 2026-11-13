from typing import Annotated
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select, func
from app.api.dependencies import DB, require_admin
from app.catalog import repository, service
from app.catalog.schemas import (
    CategoryOut,
    PlaceWrite,
    PlaceOut,
    PlacePage,
    SearchFilters,
)
from app.catalog.schemas import AdminPlaceOut, AdminPlacePage
from app.db.models import Place

router = APIRouter(tags=["Каталог"])
admin = APIRouter(
    prefix="/admin", tags=["Редактор"], dependencies=[Depends(require_admin)]
)


@router.get("/categories", response_model=list[CategoryOut], summary="Категории мест")
async def categories(db: DB):
    return await repository.categories(db)


@router.get(
    "/places", response_model=PlacePage, summary="Каталог: фильтры, радиус, пагинация"
)
async def places(db: DB, filters: Annotated[SearchFilters, Query()]):
    items = await service.candidates(db, filters)
    return {
        "items": items[filters.offset : filters.offset + filters.limit],
        "total": len(items),
        "limit": filters.limit,
        "offset": filters.offset,
    }


@router.get(
    "/places/{place_id}",
    response_model=PlaceOut,
    summary="Карточка опубликованного места",
)
async def detail(place_id: UUID, db: DB):
    return await service.get_public(db, place_id)


@admin.get(
    "/places",
    response_model=AdminPlacePage,
    summary="Каталог редактора, включая черновики",
)
async def admin_places(
    db: DB, limit: int = Query(20, ge=1, le=100), offset: int = Query(0, ge=0)
):
    total = await db.scalar(select(func.count()).select_from(Place))
    items = (
        await db.scalars(select(Place).order_by(Place.id).limit(limit).offset(offset))
    ).all()
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@admin.post(
    "/places", response_model=AdminPlaceOut, status_code=201, summary="Создать место"
)
async def create(data: PlaceWrite, db: DB):
    return await service.save(db, data)


@admin.put(
    "/places/{place_id}",
    response_model=AdminPlaceOut,
    summary="Полностью заменить карточку места",
)
async def replace(place_id: UUID, data: PlaceWrite, db: DB):
    place = await repository.by_id(db, place_id)
    if not place:
        raise HTTPException(404, "Место не найдено")
    return await service.save(db, data, place)


@admin.delete(
    "/places/{place_id}",
    status_code=204,
    summary="Снять место с публикации, сохранить ID",
)
async def archive(place_id: UUID, db: DB):
    place = await repository.by_id(db, place_id)
    if not place:
        raise HTTPException(404, "Место не найдено")
    place.status = "archived"
    await db.commit()
    return Response(status_code=204)
