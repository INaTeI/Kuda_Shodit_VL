from uuid import uuid4
import pytest
from app.main import app
from app.recommendations.ranking import (
    get_ranker,
    RankedOrder,
    RankingCandidate,
    RankingContext,
    RuleRanker,
    rank_safely,
)


@pytest.mark.parametrize(
    "failure", ["invented", "duplicate", "missing", "timeout", "unavailable"]
)
async def test_invalid_model_order_falls_back(failure):
    a, b = uuid4(), uuid4()
    candidates = (
        RankingCandidate(a, "A", "description", "activity", ("nature",), (), 2),
        RankingCandidate(b, "B", "description", "activity", ("nature",), (), 1),
    )

    class FakeModel:
        async def rank(self, candidates, context):
            if failure == "timeout":
                raise TimeoutError()
            if failure == "unavailable":
                raise ConnectionError()
            return RankedOrder(
                {"invented": (a, uuid4()), "duplicate": (a, a), "missing": (a,)}[
                    failure
                ],
                "fake-llm",
            )

    result = await rank_safely(FakeModel(), candidates, RankingContext((), None))
    assert result.place_ids == (a, b)
    assert result.algorithm_version == "rules-v1"


async def test_future_ranker_only_sees_filtered_candidates(
    client, admin, guest, place_payload
):
    places = []
    for cost in [100, 200, 10000]:
        places.append(
            (
                await client.post(
                    "/api/v1/admin/places",
                    headers=admin,
                    json=place_payload | {"price_rub": cost},
                )
            ).json()
        )
    observed = []

    class FakeModel:
        async def rank(self, candidates, context):
            observed.extend(candidates)
            assert context.budget_rub == 500
            return RankedOrder(tuple(c.id for c in reversed(candidates)), "test-llm-v1")

    app.dependency_overrides[get_ranker] = lambda: FakeModel()
    try:
        response = await client.post(
            "/api/v1/recommendations",
            headers=guest,
            json={"budget_rub": 500, "limit": 5},
        )
        assert response.status_code == 200, response.text
        result = response.json()
        assert result["algorithm_version"] == "test-llm-v1"
        assert len(observed) == result["total"] == 2
        assert places[2]["id"] not in [str(c.id) for c in observed]
        expected = [str(c.id) for c in reversed(observed)]
        assert [item["place"]["id"] for item in result["items"]] == expected
        assert all(not hasattr(c, "token_hash") for c in observed)
    finally:
        app.dependency_overrides.pop(get_ranker, None)


async def test_default_ranker_is_deterministic():
    first, second = uuid4(), uuid4()
    candidates = (
        RankingCandidate(first, "A", "", "", (), (), 1),
        RankingCandidate(second, "B", "", "", (), (), 5),
    )
    assert (
        await RuleRanker().rank(candidates, RankingContext((), None))
    ).place_ids == (second, first)
