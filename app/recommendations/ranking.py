"""A backend-only seam for future self-hosted LLM ranking; no model calls yet."""

import asyncio
from dataclasses import dataclass
import logging
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


def get_ranker() -> Ranker:
    # Later return a self-hosted LLM adapter configured through server environment variables.
    return RuleRanker()


async def rank_safely(ranker, candidates, context):
    try:
        result = await asyncio.wait_for(ranker.rank(candidates, context), timeout=5.0)
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
