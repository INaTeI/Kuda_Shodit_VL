"""Rank eligible places with Qwen embeddings, falling back to rules."""

import asyncio
from dataclasses import dataclass
import logging
import json
import os
from urllib.request import Request, urlopen
from typing import Protocol
from uuid import UUID

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class RankingCandidate:
    id: UUID
    name: str
    description: str
    activity: str
    categories: tuple[str, ...]
    interest_tags: tuple[str, ...]
    base_score: float


@dataclass(frozen=True)
class RankingContext:
    interests: tuple[str, ...]
    budget_rub: int | None
    liked_places: tuple[str, ...] = ()
    disliked_places: tuple[str, ...] = ()
    weather: str = ""


@dataclass(frozen=True)
class RankedOrder:
    place_ids: tuple[UUID, ...]
    algorithm_version: str


class Ranker(Protocol):
    async def rank(
        self, candidates: tuple[RankingCandidate, ...], context: RankingContext
    ) -> RankedOrder:
        """Return every candidate ID exactly once. Never fetch or invent places."""
        ...


class RuleRanker:
    async def rank(self, candidates, context):
        ordered = sorted(
            candidates, key=lambda candidate: (-candidate.base_score, str(candidate.id))
        )
        return RankedOrder(tuple(candidate.id for candidate in ordered), "rules-v1")


class QwenRanker:
    """Ask the separate Qwen embedding service to reorder only eligible places."""

    def __init__(self, endpoint: str):
        self.endpoint = endpoint.rstrip("/")

    async def rank(self, candidates, context):
        payload = {
            "interests": list(context.interests),
            "liked_places": list(context.liked_places),
            "disliked_places": list(context.disliked_places),
            "weather": context.weather,
            "budget_rub": context.budget_rub,
            "candidates": [
                {
                    "id": str(candidate.id), "name": candidate.name,
                    "description": candidate.description, "activity": candidate.activity,
                    "categories": list(candidate.categories),
                    "interest_tags": list(candidate.interest_tags),
                }
                for candidate in candidates
            ],
        }
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = Request(self.endpoint, data=body, headers={"Content-Type": "application/json"}, method="POST")

        def send():
            with urlopen(request, timeout=12.0) as response:
                if response.status != 200:
                    raise RuntimeError(f"Qwen rank service returned {response.status}")
                return json.loads(response.read())

        data = await asyncio.to_thread(send)
        return RankedOrder(tuple(UUID(value) for value in data["place_ids"]), data["algorithm_version"])


def get_ranker() -> Ranker:
    endpoint = os.getenv("QWEN_RANK_URL", "").strip()
    if endpoint:
        return QwenRanker(endpoint)
    return RuleRanker()


async def rank_safely(ranker, candidates, context):
    try:
        result = await asyncio.wait_for(ranker.rank(candidates, context), timeout=13.0)
        allowed = {candidate.id for candidate in candidates}
        if (
            len(result.place_ids) != len(allowed)
            or set(result.place_ids) != allowed
            or not result.algorithm_version
            or len(result.algorithm_version) > 80
        ):
            raise ValueError(
                "Ranker output must contain every permitted ID exactly once"
            )
        return result
    except Exception as error:
        logger.warning("Ranking fallback: %s", type(error).__name__)
        return await RuleRanker().rank(candidates, context)
