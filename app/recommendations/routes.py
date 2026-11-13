from fastapi import APIRouter
from app.api.dependencies import DB, CurrentProfile
from app.recommendations.schemas import RecommendationRequest, RecommendationPage
from app.recommendations.service import recommend

router = APIRouter(tags=["Рекомендации"])


@router.post("/recommendations", response_model=RecommendationPage, summary="Персональная подборка мест")
async def recommendations(data: RecommendationRequest, db: DB, profile: CurrentProfile):
    return await recommend(db, data, profile)


@router.post("/discovery", response_model=RecommendationPage, summary="Случайные места без моей оценки")
async def discovery(data: RecommendationRequest, db: DB, profile: CurrentProfile):
    return await recommend(db, data, profile, exploration=True)
