from pydantic import BaseModel
from app.catalog.schemas import SearchFilters, PlaceOut


class RecommendationRequest(SearchFilters):
    exclude_known: bool = True
    exclude_disliked: bool = True


class RecommendationItem(BaseModel):
    place: PlaceOut
    score: float
    reasons: list[str]
    distance_km: float | None


class RecommendationPage(BaseModel):
    items: list[RecommendationItem]
    total: int
    algorithm_version: str = "rules-v1"
