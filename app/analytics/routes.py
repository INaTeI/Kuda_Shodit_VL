from fastapi import APIRouter, Depends, Query

from app.analytics.schemas import AnalyticsSummary, EventIn, EventOut
from app.analytics.service import record_event, summary
from app.api.dependencies import CurrentProfile, DB, require_admin

router = APIRouter(tags=["Статистика"])


@router.post("/me/events", response_model=EventOut, summary="Записать показ, открытие или свайп")
async def event(data: EventIn, db: DB, profile: CurrentProfile):
    return await record_event(db, profile, data)


@router.get("/admin/analytics/summary", response_model=AnalyticsSummary,
            dependencies=[Depends(require_admin)], summary="Сводная статистика действий")
async def analytics_summary(db: DB, days: int = Query(7, ge=1, le=365)):
    return await summary(db, days)
