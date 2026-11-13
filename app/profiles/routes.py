import secrets
from fastapi import APIRouter, Response
from sqlalchemy import case, select, update
from sqlalchemy.dialects.postgresql import insert
from app.api.dependencies import DB, CurrentProfile, hash_token
from app.catalog.service import get_public, validate_categories
from app.db.models import Profile, PlaceState
from app.profiles.schemas import Preferences, ProfileOut, ProfileCreated, ReactionIn, KnownIn, StateOut
from app.profiles.service import lock_profile
from uuid import UUID

router = APIRouter(tags=["Профиль и реакции"])


@router.post("/profiles", response_model=ProfileCreated, status_code=201, summary="Создать гостевой профиль")
async def create_profile(db: DB):
    token = secrets.token_urlsafe(32)
    profile = Profile(token_hash=hash_token(token), interests=[])
    db.add(profile)
    await db.commit()
    return {"profile": profile, "access_token": token}


@router.get("/me", response_model=ProfileOut, summary="Мой профиль")
async def me(profile: CurrentProfile):
    return profile


@router.put("/me/preferences", response_model=ProfileOut, summary="Заменить интересы и бюджет")
async def preferences(data: Preferences, db: DB, profile: CurrentProfile):
    await lock_profile(db, profile.id)
    await validate_categories(db, data.interests)
    profile.interests = list(dict.fromkeys(data.interests))
    profile.budget_rub = data.budget_rub
    await db.commit()
    return profile


@router.post("/me/interests/reset", response_model=ProfileOut, summary="Сбросить интересы и оценки мест")
async def reset_interests(db: DB, profile: CurrentProfile):
    await lock_profile(db, profile.id)
    profile.interests = []
    await db.execute(update(PlaceState).where(
        PlaceState.profile_id == profile.id, PlaceState.reaction.is_not(None)
    ).values(reaction=None, reaction_revision=PlaceState.reaction_revision + 1))
    await db.commit()
    return profile


async def upsert_state(db, profile, place_id, values):
    await lock_profile(db, profile.id)
    await get_public(db, place_id)
    updates = dict(values)
    initial_revision = 0
    if "reaction" in values:
        initial_revision = 1
        updates["reaction_revision"] = case(
            (PlaceState.reaction.is_distinct_from(values["reaction"]), PlaceState.reaction_revision + 1),
            else_=PlaceState.reaction_revision,
        )
    statement = insert(PlaceState).values(
        profile_id=profile.id, place_id=place_id, reaction_revision=initial_revision, **values
    )
    await db.execute(statement.on_conflict_do_update(index_elements=["profile_id", "place_id"], set_=updates))
    await db.commit()
    return await db.get(PlaceState, (profile.id, place_id), populate_existing=True)


@router.get("/me/place-states", response_model=list[StateOut], summary="Мои реакции и знакомые места")
async def states(db: DB, profile: CurrentProfile):
    return (await db.scalars(select(PlaceState).where(PlaceState.profile_id == profile.id))).all()


@router.put("/me/reactions/{place_id}", response_model=StateOut, summary="Оценить место")
async def react(place_id: UUID, data: ReactionIn, db: DB, profile: CurrentProfile):
    return await upsert_state(db, profile, place_id, {"reaction": data.reaction})


@router.delete("/me/reactions/{place_id}", status_code=204, summary="Отменить реакцию")
async def undo(place_id: UUID, db: DB, profile: CurrentProfile):
    await lock_profile(db, profile.id)
    state = await db.get(PlaceState, (profile.id, place_id))
    if state and state.reaction is not None:
        state.reaction = None
        state.reaction_revision += 1
        await db.commit()
    return Response(status_code=204)


@router.put("/me/known-places/{place_id}", response_model=StateOut, summary="Отметить знакомое место")
async def known(place_id: UUID, data: KnownIn, db: DB, profile: CurrentProfile):
    return await upsert_state(db, profile, place_id, {"is_known": data.is_known})


@router.delete("/me", status_code=204, summary="Удалить профиль и все его реакции")
async def delete_profile(db: DB, profile: CurrentProfile):
    await db.delete(profile)
    await db.commit()
    return Response(status_code=204)
