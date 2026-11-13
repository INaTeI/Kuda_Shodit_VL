import hashlib
import hmac
import json
import time
import base64
import binascii
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.dependencies import DB, require_admin_or_session
from app.core.config import get_settings
from app.db.models import ConstructorState, Place

router = APIRouter(tags=["Конструктор карточки"])
admin = APIRouter(prefix="/admin", tags=["Администратор"])
SESSION_SECONDS = 3600


class AdminLogin(BaseModel):
    key: str = Field(min_length=12, max_length=512)


class ConstructorWrite(BaseModel):
    state: dict[str, Any]


@router.get("/constructor-photo/{place_id}", summary="Главное фото места из конструктора")
async def constructor_photo(place_id: UUID, db: DB):
    place = await db.get(Place, place_id)
    if place is None or place.status != "published":
        raise HTTPException(404, "Место не найдено")
    row = await db.get(ConstructorState, f"place:{place_id}")
    card = row.state.get("place", {}) if row else {}
    photo = next((p for p in card.get("photos", []) if isinstance(p, dict) and p.get("id") == card.get("mainId")), None)
    src = photo.get("src", "") if photo else ""
    for media_type in ("image/jpeg", "image/png", "image/webp"):
        prefix = f"data:{media_type};base64,"
        if src.startswith(prefix):
            try:
                content = base64.b64decode(src[len(prefix):], validate=True)
            except binascii.Error:
                break
            if len(content) <= 8_000_000:
                return Response(content, media_type=media_type)
    raise HTTPException(404, "Фото не найдено")


@router.get("/constructor-state/{place_id}", summary="Конструктор выбранного места")
async def get_place_constructor(place_id: UUID, db: DB):
    place = await db.get(Place, place_id)
    if place is None or place.status != "published":
        raise HTTPException(404, "Место не найдено")
    row = await db.get(ConstructorState, f"place:{place_id}")
    return {"state": row.state if row else None}


@router.put("/constructor-state/{place_id}", dependencies=[Depends(require_admin_or_session)], summary="Сохранить выбранное место")
async def put_place_constructor(place_id: UUID, data: ConstructorWrite, db: DB):
    place = await db.get(Place, place_id)
    if place is None:
        raise HTTPException(404, "Место не найдено")
    state = data.state
    card = state.get("place")
    if not isinstance(card, dict):
        raise HTTPException(422, "Отсутствуют данные места")
    name = card.get("name")
    description = card.get("description")
    if not isinstance(name, str) or not name.strip() or len(name) > 200 or not isinstance(description, str) or not description.strip() or len(description) > 10000:
        raise HTTPException(422, "Проверьте название и описание")
    if len(json.dumps(state, ensure_ascii=False).encode("utf-8")) > 16_000_000:
        raise HTTPException(413, "Размер состояния превышает 16 МБ")
    place.name = name.strip()
    place.description = description.strip()
    address = card.get("address")
    if address is not None:
        if not isinstance(address, str) or len(address) > 500:
            raise HTTPException(422, "Адрес слишком длинный")
        place.address = address.strip() or None
    photos = card.get("photos", [])
    if isinstance(photos, list):
        main = next((p for p in photos if isinstance(p, dict) and p.get("id") == card.get("mainId")), None)
        if main is None:
            place.photo_url = None
        if main and isinstance(main.get("src"), str) and len(main["src"]) <= 2000 and (main["src"].startswith("/places/") or main["src"].startswith("https://")):
            place.photo_url = main["src"]
        elif main and isinstance(main.get("src"), str) and main["src"].startswith(("data:image/jpeg;base64,", "data:image/png;base64,", "data:image/webp;base64,")):
            place.photo_url = f"/api/v1/constructor-photo/{place_id}"
    row = await db.get(ConstructorState, f"place:{place_id}")
    if row is None:
        row = ConstructorState(key=f"place:{place_id}", state=state)
        db.add(row)
    else:
        row.state = state
    await db.commit()
    await db.refresh(row)
    return {"saved": True, "updated_at": row.updated_at}


@admin.post("/session", summary="Войти администратором")
async def login(data: AdminLogin, response: Response, request: Request):
    if not hmac.compare_digest(data.key, get_settings().admin_api_key):
        raise HTTPException(401, "Неверный ключ администратора")
    expires = str(int(time.time()) + SESSION_SECONDS)
    signature = hmac.new(
        get_settings().admin_api_key.encode(), expires.encode(), hashlib.sha256
    ).hexdigest()
    response.set_cookie(
        "vdk_admin",
        f"{expires}.{signature}",
        max_age=SESSION_SECONDS,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="strict",
        path="/api/v1",
    )
    return {"authenticated": True, "expires_in": SESSION_SECONDS}


@admin.get("/session", summary="Проверить вход администратора")
async def session_status(token: str | None = Cookie(default=None, alias="vdk_admin")):
    from app.api.dependencies import admin_session_valid

    if not admin_session_valid(token):
        raise HTTPException(401, "Вход администратора не выполнен")
    return {"authenticated": True}


@admin.delete("/session", summary="Выйти из панели администратора")
async def logout(response: Response, request: Request):
    response.delete_cookie("vdk_admin", path="/api/v1", secure=request.url.scheme == "https", httponly=True, samesite="strict")
    return {"authenticated": False}


@router.get("/constructor-state", summary="Общее состояние конструктора карточек")
async def get_constructor_state(db: DB):
    row = await db.scalar(
        select(ConstructorState).where(ConstructorState.key == "place-card")
    )
    return {"state": row.state if row else None, "updated_at": row.updated_at if row else None}


@router.put(
    "/constructor-state",
    dependencies=[Depends(require_admin_or_session)],
    summary="Сохранить общее состояние конструктора карточек",
)
async def put_constructor_state(data: ConstructorWrite, db: DB):
    if len(json.dumps(data.state, ensure_ascii=False).encode("utf-8")) > 16_000_000:
        raise HTTPException(413, "Размер состояния превышает 16 МБ")
    row = await db.scalar(
        select(ConstructorState).where(ConstructorState.key == "place-card")
    )
    if row is None:
        row = ConstructorState(key="place-card", state=data.state)
        db.add(row)
    else:
        row.state = data.state
    await db.commit()
    await db.refresh(row)
    return {"saved": True, "updated_at": row.updated_at}


@admin.get("/constructor-state", include_in_schema=False)
async def admin_constructor_state(db: DB, _=Depends(require_admin_or_session)):
    return await get_constructor_state(db)
