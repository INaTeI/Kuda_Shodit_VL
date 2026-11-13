from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from sqlalchemy import delete, distinct, func, select, tuple_
from sqlalchemy.dialects.postgresql import insert

from app.analytics.models import InteractionEvent, RecommendationRun, RecommendationRunItem
from app.catalog.service import get_public
from app.core.config import get_settings
from app.db.models import PlaceState
from app.profiles.service import lock_profile


async def record_run(db, profile, request, effective, items, total, algorithm_version, exploration):
    await lock_profile(db, profile.id)
    # Exact user coordinates and credentials are deliberately not retained in analytics.
    filters = effective.model_dump(mode="json", exclude={"latitude", "longitude"})
    run = RecommendationRun(
        profile_id=profile.id, source="discovery" if exploration else "recommendations",
        algorithm_version=algorithm_version, filters=filters,
        interests=list(profile.interests), total=total,
    )
    db.add(run)
    await db.flush()
    db.add_all([
        RecommendationRunItem(recommendation_id=run.id, place_id=item["place"].id,
                              position=request.offset + position)
        for position, item in enumerate(items)
    ])
    await db.commit()
    return run.id


def event_response(event, duplicate):
    return dict(event_id=event.event_id, event_type=event.event_type,
                received_at=event.received_at, duplicate=duplicate,
                reaction=event.reaction, reaction_revision=event.reaction_revision)


async def record_event(db, profile, data):
    await lock_profile(db, profile.id)
    run = await db.scalar(select(RecommendationRun).where(
        RecommendationRun.id == data.recommendation_id,
        RecommendationRun.profile_id == profile.id,
    ).with_for_update())
    if run is None:
        raise HTTPException(404, "Подборка не найдена")
    cutoff = datetime.now(timezone.utc) - timedelta(days=get_settings().analytics_retention_days)
    if run.created_at < cutoff:
        raise HTTPException(410, "Срок хранения подборки истёк")
    payload = data.model_dump(mode="json")
    existing = await db.get(InteractionEvent, data.event_id)
    if existing is not None:
        if existing.request_payload != payload:
            raise HTTPException(409, "event_id уже использован с другим содержимым")
        return event_response(existing, True)
    item = await db.get(RecommendationRunItem, (run.id, data.place_id))
    if item is None:
        raise HTTPException(404, "Место отсутствует в этой подборке")
    if data.event_type != "card_view":
        viewed = await db.scalar(select(InteractionEvent.event_id).where(
            InteractionEvent.recommendation_id == run.id,
            InteractionEvent.place_id == data.place_id,
            InteractionEvent.event_type == "card_view",
        ).limit(1))
        if viewed is None:
            raise HTTPException(409, "Сначала отправьте card_view")
    # Reserve the UUID before mutating preferences. A concurrent request in another
    # profile cannot turn a unique-key race into a partially applied swipe.
    event = await db.scalar(insert(InteractionEvent).values(
        event_id=data.event_id, recommendation_id=run.id, place_id=data.place_id,
        event_type=data.event_type, request_payload=payload,
    ).on_conflict_do_nothing(index_elements=["event_id"]).returning(InteractionEvent))
    if event is None:
        raise HTTPException(409, "event_id уже использован")
    if data.event_type in {"swipe", "swipe_undo"}:
        state = await db.get(PlaceState, (profile.id, data.place_id))
        revision = state.reaction_revision if state else 0
        if revision != data.expected_reaction_revision:
            raise HTTPException(409, "Реакция изменилась: обновите /me/place-states")
        if data.event_type == "swipe":
            await get_public(db, data.place_id)
            reaction = data.reaction
        else:
            target = await db.get(InteractionEvent, data.undo_event_id)
            if (target is None or target.event_type != "swipe"
                    or target.recommendation_id != run.id or target.place_id != data.place_id
                    or target.reaction_revision != revision):
                raise HTTPException(409, "Можно отменить только последнюю актуальную реакцию")
            reaction = target.previous_reaction
            event.undo_event_id = data.undo_event_id
        if state is None:
            state = PlaceState(profile_id=profile.id, place_id=data.place_id,
                               is_known=False, reaction_revision=0)
            db.add(state)
        event.previous_reaction = state.reaction
        state.reaction = reaction
        state.reaction_revision = revision + 1
        event.reaction = reaction
        event.reaction_revision = state.reaction_revision
    db.add(event)
    await db.commit()
    return event_response(event, False)


async def summary(db, days):
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    runs = await db.execute(select(
        func.count(RecommendationRun.id),
        func.count(RecommendationRun.id).filter(RecommendationRun.total == 0),
    ).where(RecommendationRun.created_at >= cutoff))
    count, empty = runs.one()
    issued = await db.scalar(select(func.count()).select_from(RecommendationRunItem).join(
        RecommendationRun, RecommendationRun.id == RecommendationRunItem.recommendation_id
    ).where(RecommendationRun.created_at >= cutoff))
    measures = {"card_views": ("card_view", None), "place_opens": ("place_open", None),
                "swipes": ("swipe", None), "likes": ("swipe", "like"),
                "dislikes": ("swipe", "dislike"), "neutrals": ("swipe", "neutral"),
                "swipe_undos": ("swipe_undo", None)}
    columns = []
    for event_type, reaction in measures.values():
        condition = InteractionEvent.event_type == event_type
        if reaction:
            condition = condition & (InteractionEvent.reaction == reaction)
        columns.append(func.count(InteractionEvent.event_id).filter(condition))
    columns.append(func.count(distinct(tuple_(InteractionEvent.recommendation_id,
                                             InteractionEvent.place_id))).filter(
        InteractionEvent.event_type == "card_view"))
    counts = (await db.execute(select(*columns).where(InteractionEvent.received_at >= cutoff))).one()
    return dict(days=days, runs=count, empty_runs=empty, issued_cards=issued,
                viewed_cards=counts[-1], **dict(zip(measures, counts[:-1])))


async def cleanup(db):
    cutoff = datetime.now(timezone.utc) - timedelta(days=get_settings().analytics_retention_days)
    result = await db.execute(delete(RecommendationRun).where(RecommendationRun.created_at < cutoff))
    await db.commit()
    return result.rowcount
