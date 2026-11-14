from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from app.core.config import get_settings
from app.db.session import engine
from app.api.dependencies import DB
from app.catalog.routes import router as catalog, admin
from app.profiles.routes import router as profiles
from app.importing.routes import router as imports
from app.importing.middleware import ImportBodyLimitMiddleware
from app.recommendations.routes import router as recommendations
from app.analytics.routes import router as analytics
from app.weather.routes import router as weather
from app.editor.routes import (
    public as editor_public,
    auth as editor_auth,
    editor as editor_api,
)
from app.web import router as web
from app.constructor.routes import router as constructor, admin as constructor_admin


@asynccontextmanager
async def lifespan(app):
    yield
    await engine.dispose()


app = FastAPI(
    title="Kuda_Shodit_VL",
    version="0.1.0",
    lifespan=lifespan,
    description="Городской гид Владивостока. MVP: каталог, подбор, гостевой профиль и реакции. "
    "Данные seed демонстрационные. Влево → dislike, вправо → like, вверх → neutral.",
)
app.add_middleware(ImportBodyLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "X-Admin-Key"],
)
for router in [
    catalog,
    admin,
    profiles,
    recommendations,
    imports,
    analytics,
    weather,
    editor_public,
    editor_auth,
    editor_api,
    constructor,
    constructor_admin,
]:
    app.include_router(router, prefix="/api/v1")
app.include_router(web)


@app.get("/health/live", tags=["Состояние"], summary="Процесс приложения работает")
async def live():
    return {"status": "ok"}


@app.get("/health/ready", tags=["Состояние"], summary="PostgreSQL и миграции доступны")
async def ready(db: DB):
    try:
        await db.execute(text("SELECT version_num FROM alembic_version"))
    except SQLAlchemyError:
        raise HTTPException(503, "База данных не готова") from None
    return {"status": "ready"}
