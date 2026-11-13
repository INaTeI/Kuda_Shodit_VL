import asyncio
from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select

from app.api.dependencies import DB
from app.catalog import service as catalog
from app.core.config import get_settings
from app.db.models import PlaceDesign, PlacePhoto
from app.editor import security, service
from app.editor.schemas import (
    DesignSave,
    EditorPlace,
    EditorPlaceSummary,
    LoginIn,
    PhotoOut,
    PublicDesign,
    SessionOut,
)

CSRF_HEADER = "X-VDK-Editor"
public = APIRouter(tags=["Оформление мест"])
auth = APIRouter(prefix="/editor", tags=["Конструктор"])


def _session_out(session: security.EditorSession) -> dict:
    return {
        "username": session.username,
        "expires_at": datetime.fromtimestamp(session.expires_at, timezone.utc),
    }


def client_address(request: Request) -> str:
    # API слушает только loopback; X-Real-IP выставляет nginx из $remote_addr.
    return request.headers.get("x-real-ip") or (request.client.host if request.client else "unknown")


def current_editor(request: Request) -> security.EditorSession | None:
    return security.read_session(request.cookies.get(security.COOKIE_NAME))


async def require_editor(request: Request) -> security.EditorSession:
    session = current_editor(request)
    if session is None:
        raise HTTPException(401, "Нужен вход в конструктор")
    # Изменения только с собственным заголовком: чужой сайт не отправит его без CORS-разрешения.
    if request.method not in ("GET", "HEAD") and request.headers.get(CSRF_HEADER) != "1":
        raise HTTPException(403, f"Нет заголовка {CSRF_HEADER}")
    return session


Editor = Annotated[security.EditorSession, Depends(require_editor)]
editor = APIRouter(prefix="/editor", tags=["Конструктор"], dependencies=[Depends(require_editor)])


@auth.post("/login", response_model=SessionOut, summary="Вход в конструктор")
async def login(data: LoginIn, request: Request, response: Response):
    if request.headers.get(CSRF_HEADER) != "1":
        raise HTTPException(403, f"Нет заголовка {CSRF_HEADER}")
    settings = get_settings()
    if not security.login_configured():
        raise HTTPException(503, "Вход в конструктор не настроен: задайте EDITOR_PASSWORD_HASH")
    client = client_address(request)
    if wait := security.limiter.retry_after(client):
        raise HTTPException(429, "Слишком много попыток входа. Попробуйте позже",
                            headers={"Retry-After": str(wait)})
    valid = await asyncio.to_thread(security.verify_password, data.password, settings.editor_password_hash)
    if not valid or data.username != settings.editor_username:
        security.limiter.fail(client)
        raise HTTPException(401, "Неверный логин или пароль")
    security.limiter.succeed(client)
    token, session = security.issue_session(settings.editor_username)
    response.set_cookie(
        security.COOKIE_NAME, token, max_age=settings.editor_session_hours * 3600,
        path=security.COOKIE_PATH, httponly=True, samesite="strict",
        secure=settings.editor_cookie_secure,
    )
    response.headers["Cache-Control"] = "no-store"
    return _session_out(session)


@auth.post("/logout", status_code=204, summary="Выход из конструктора")
async def logout():
    response = Response(status_code=204)
    response.delete_cookie(
        security.COOKIE_NAME, path=security.COOKIE_PATH, httponly=True, samesite="strict",
        secure=get_settings().editor_cookie_secure,
    )
    return response


@auth.get("/session", response_model=SessionOut, summary="Текущая сессия редактора")
async def session(request: Request, response: Response):
    current = current_editor(request)
    if current is None:
        raise HTTPException(401, "Нужен вход в конструктор")
    response.headers["Cache-Control"] = "no-store"
    return _session_out(current)


@editor.get("/places", response_model=list[EditorPlaceSummary], summary="Места для оформления")
async def places(db: DB):
    return await service.list_places(db)


@editor.get("/places/{place_id}", response_model=EditorPlace, summary="Место и его оформление")
async def place(place_id: UUID, db: DB):
    return await service.editor_view(db, await service.load_place(db, place_id))


@editor.put(
    "/places/{place_id}",
    response_model=EditorPlace,
    summary="Сохранить и опубликовать оформление",
    description="Меняет название, описание и адрес места, порядок и подписи фото, стиль страницы "
    "и карточки. expected_revision защищает от затирания чужого сохранения (409).",
)
async def save(place_id: UUID, data: DesignSave, db: DB, editor_session: Editor):
    return await service.save_design(db, place_id, data, editor_session.username)


@editor.post(
    "/places/{place_id}/photos",
    response_model=PhotoOut,
    status_code=201,
    summary="Загрузить фото (тело — байты JPEG/PNG/WebP до 4 МБ)",
    description="Фото станет видно посетителям только после сохранения оформления.",
)
async def upload_photo(place_id: UUID, request: Request, db: DB):
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > service.MAX_PHOTO_BYTES:
        raise HTTPException(413, "Фото больше 4 МБ")
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > service.MAX_PHOTO_BYTES:
            raise HTTPException(413, "Фото больше 4 МБ")
    if not data:
        raise HTTPException(422, "Пустой файл")
    photo = await service.store_photo(db, place_id, bytes(data))
    return {"id": photo.id, "url": service.photo_url(photo.id), "alt": photo.alt}


@public.get(
    "/places/{place_id}/design",
    response_model=PublicDesign,
    summary="Опубликованное оформление места",
    responses={404: {"description": "Место не опубликовано или оформление не настроено"}},
)
async def public_design(place_id: UUID, db: DB):
    await catalog.get_public(db, place_id)
    design = await service.design_out(db, await db.get(PlaceDesign, place_id))
    if design is None:
        raise HTTPException(404, "Оформление не настроено")
    return design


@public.get("/photos/{photo_id}", summary="Фото места", response_class=Response)
async def photo(photo_id: UUID, request: Request, db: DB):
    row = await db.execute(
        select(PlacePhoto, PlacePhoto.data).where(PlacePhoto.id == photo_id)
    )
    found = row.first()
    if found is None:
        raise HTTPException(404, "Фото не найдено")
    item, data = found
    place = await service.load_place(db, item.place_id)
    public_photo = item.position is not None and place.status == "published"
    if not public_photo and current_editor(request) is None:
        raise HTTPException(404, "Фото не найдено")
    etag = f'"{item.sha256}"'
    headers = {
        "ETag": etag,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "public, max-age=86400" if public_photo else "private, no-store",
    }
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    return Response(content=data, media_type=item.content_type, headers=headers)
