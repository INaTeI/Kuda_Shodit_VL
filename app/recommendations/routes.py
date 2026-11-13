from typing import Annotated
from fastapi import APIRouter, Depends
from app.api.dependencies import DB, CurrentProfile
from app.recommendations.schemas import RecommendationRequest, RecommendationPage
from app.recommendations.service import recommend
from app.recommendations.ranking import Ranker, get_ranker

router = APIRouter(tags=["Рекомендации"])


@router.post(
    "/recommendations",
    response_model=RecommendationPage,
    summary="Персональная подборка мест",
)
async def recommendations(
    data: RecommendationRequest,
    db: DB,
    profile: CurrentProfile,
    ranker: Annotated[Ranker, Depends(get_ranker)],
):
    return await recommend(db, data, profile, ranker=ranker)


@router.post(
    "/discovery",
    response_model=RecommendationPage,
    summary="Случайные места без моей оценки",
)
async def discovery(data: RecommendationRequest, db: DB, profile: CurrentProfile):
    return await recommend(db, data, profile, exploration=True)
