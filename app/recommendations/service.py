import random
from collections import defaultdict
from sqlalchemy import select
from app.catalog.service import candidates, distance_km
from app.db.models import PlaceState, Place
from app.recommendations.ranking import (
    RankingCandidate,
    RankingContext,
    get_ranker,
    rank_safely,
)


async def recommend(db, request, profile, exploration=False, ranker=None):
    # Explicit request budget overrides profile; absent budget uses saved preference.
    effective = request.model_copy()
    if "budget_rub" not in request.model_fields_set:
        effective.budget_rub = profile.budget_rub
    places = await candidates(db, effective)
    states = {
        s.place_id: s
        for s in (
            await db.scalars(
                select(PlaceState).where(PlaceState.profile_id == profile.id)
            )
        ).all()
    }
    # Aggregate affinity from likes only. Dislikes exclude a place, not an entire category.
    liked_ids = [s.place_id for s in states.values() if s.reaction == "like"]
    affinity = defaultdict(int)
    if liked_ids:
        liked = (
            await db.scalars(
                select(Place).where(
                    Place.id.in_(liked_ids), Place.status == "published"
                )
            )
        ).all()
        for place in liked:
            for category in place.categories:
                affinity[category.slug] += 1
    results = []
    for place in places:
        state = states.get(place.id)
        if state and (
            (request.exclude_known and state.is_known)
            or (request.exclude_disliked and state.reaction == "dislike")
            or (exploration and state.reaction is not None)
        ):
            continue
        categories = {c.slug: c.name for c in place.categories}
        interests = sorted(set(profile.interests) & categories.keys())
        score = 3.0 * len(interests) + sum(min(affinity[c], 3) for c in categories)
        reasons = []
        if interests:
            reasons.append(
                "Совпадает с интересами: " + ", ".join(categories[c] for c in interests)
            )
        if any(affinity[c] for c in categories):
            reasons.append("Есть категории мест, которые вы оценили положительно")
        if state and state.reaction == "like":
            score += 2
            reasons.append("Вы положительно оценили это место")
        if effective.budget_rub is not None:
            reasons.append("Указанная стоимость укладывается в бюджет")
        distance = None
        if effective.radius_km is not None:
            distance = round(
                distance_km(
                    effective.latitude,
                    effective.longitude,
                    place.latitude,
                    place.longitude,
                ),
                3,
            )
            reasons.append("Находится в выбранной области поиска")
        if not reasons:
            reasons.append(
                "Вариант из проверенного каталога; предпочтения пока не уточнены"
            )
        results.append(
            {
                "place": place,
                "score": score,
                "reasons": reasons,
                "distance_km": distance,
            }
        )
    results.sort(key=lambda item: (-item["score"], str(item["place"].id)))
    algorithm_version = "rules-v1"
    if exploration:
        random.SystemRandom().shuffle(results)
    elif results:
        ranking_candidates = tuple(
            RankingCandidate(
                id=item["place"].id,
                name=item["place"].name,
                description=item["place"].description,
                activity=item["place"].activity,
                categories=tuple(c.slug for c in item["place"].categories),
                interest_tags=tuple(item["place"].interest_tags or []),
                base_score=item["score"],
            )
            for item in results
        )
        order = await rank_safely(
            ranker or get_ranker(),
            ranking_candidates,
            RankingContext(tuple(profile.interests), effective.budget_rub),
        )
        by_id = {item["place"].id: item for item in results}
        results = [by_id[place_id] for place_id in order.place_ids]
        algorithm_version = order.algorithm_version
    return {
        "items": results[request.offset : request.offset + request.limit],
        "total": len(results),
        "algorithm_version": algorithm_version,
    }
