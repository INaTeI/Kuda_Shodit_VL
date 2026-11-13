import asyncio
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select, update

from app.analytics.models import InteractionEvent, RecommendationRun, RecommendationRunItem
from app.analytics.service import cleanup
from app.db.models import PlaceState

P = "/api/v1"


async def run_for(client, guest, **filters):
    response = await client.post(P + "/recommendations", json=filters, headers=guest)
    assert response.status_code == 200, response.text
    return response.json()["recommendation_id"]


def event(run, place, kind="card_view", **values):
    return dict(event_id=str(uuid4()), recommendation_id=run, place_id=place,
                event_type=kind, **values)


async def send(client, guest, body, status=200):
    response = await client.post(P + "/me/events", headers=guest, json=body)
    assert response.status_code == status, response.text
    return response.json()


async def test_run_snapshot_is_not_an_impression(client, guest, place, admin, db_session):
    await client.put(P + "/me/preferences", headers=guest,
                     json={"interests": ["nature"], "budget_rub": 500})
    run_id = await run_for(client, guest, latitude=43.115, longitude=131.885, radius_km=2)
    run = await db_session.get(RecommendationRun, UUID(run_id))
    assert run.filters["budget_rub"] == 500 and run.interests == ["nature"]
    assert "latitude" not in run.filters and "longitude" not in run.filters
    item = await db_session.get(RecommendationRunItem, (run.id, UUID(place["id"])))
    assert item.position == 0
    summary = (await client.get(P + "/admin/analytics/summary", headers=admin)).json()
    assert summary["runs"] == summary["issued_cards"] == 1
    assert summary["card_views"] == summary["viewed_cards"] == 0
    empty = await run_for(client, guest, budget_rub=0)
    assert (await db_session.get(RecommendationRun, UUID(empty))).total == 0
    assert (await client.get(P + "/admin/analytics/summary")).status_code == 401
    assert (await client.get(P + "/admin/analytics/summary", headers=guest)).status_code == 401


async def test_discovery_run_and_pagination_snapshot(client, guest, place, admin, place_payload, db_session):
    await client.post(P + "/admin/places", headers=admin, json=place_payload | {"name": "Другой"})
    data = (await client.post(P + "/discovery", headers=guest,
                              json={"limit": 1, "offset": 1})).json()
    run = await db_session.get(RecommendationRun, UUID(data["recommendation_id"]))
    assert run.source == "discovery" and run.total == 2
    items = (await db_session.scalars(select(RecommendationRunItem))).all()
    assert len(items) == 1 and items[0].position == 1
    assert str(items[0].place_id) == data["items"][0]["place"]["id"]


async def test_idempotency_context_isolation_and_validation(client, guest, place):
    run = await run_for(client, guest)
    viewed = event(run, place["id"])
    first = await send(client, guest, viewed)
    repeat = await send(client, guest, viewed)
    assert not first["duplicate"] and repeat["duplicate"]
    assert first["received_at"] == repeat["received_at"]
    await send(client, guest, viewed | {"event_type": "place_open"}, 409)
    token = (await client.post(P + "/profiles")).json()["access_token"]
    other = {"Authorization": "Bearer " + token}
    await send(client, other, viewed, 404)
    await send(client, guest, event(run, str(uuid4())), 404)
    await send(client, guest, event(run, place["id"], "swipe", reaction="like"), 422)
    await send(client, guest, viewed | {"profile_id": str(uuid4())}, 422)
    await send(client, guest, viewed | {"event_type": "unknown"}, 422)
    assert (await client.post(P + "/me/events", json=viewed)).status_code == 401


async def test_swipe_undo_replay_and_summary(client, guest, place, admin, db_session):
    run = await run_for(client, guest)
    await send(client, guest, event(run, place["id"], "swipe", reaction="like",
                                   expected_reaction_revision=0), 409)
    await send(client, guest, event(run, place["id"]))
    await send(client, guest, event(run, place["id"]))  # Redisplay, not another unique card.
    await send(client, guest, event(run, place["id"], "place_open"))
    first = event(run, place["id"], "swipe", reaction="like", expected_reaction_revision=0)
    assert (await send(client, guest, first))["reaction_revision"] == 1
    personalized = (await client.post(P + "/recommendations", headers=guest, json={})).json()
    assert personalized["items"][0]["place"]["id"] == place["id"]
    assert personalized["items"][0]["score"] > 0
    await client.put(P + f"/me/known-places/{place['id']}", headers=guest, json={"is_known": True})
    second = event(run, place["id"], "swipe", reaction="dislike", expected_reaction_revision=1)
    assert (await send(client, guest, second))["reaction_revision"] == 2
    assert (await send(client, guest, first))["duplicate"]
    undo = event(run, place["id"], "swipe_undo", undo_event_id=second["event_id"],
                 expected_reaction_revision=2)
    result = await send(client, guest, undo)
    assert result["reaction"] == "like" and result["reaction_revision"] == 3
    assert (await send(client, guest, undo))["duplicate"]
    await send(client, guest, event(run, place["id"], "swipe_undo",
                                   undo_event_id=second["event_id"], expected_reaction_revision=3), 409)
    states = (await client.get(P + "/me/place-states", headers=guest)).json()
    assert states[0]["reaction"] == "like" and states[0]["is_known"]
    assert states[0]["reaction_revision"] == 3
    assert await db_session.scalar(select(func.count()).select_from(InteractionEvent)) == 6
    totals = (await client.get(P + "/admin/analytics/summary", headers=admin)).json()
    assert totals["card_views"] == 2 and totals["viewed_cards"] == 1
    assert totals["place_opens"] == 1 and totals["swipes"] == 2
    assert totals["likes"] == totals["dislikes"] == totals["swipe_undos"] == 1


async def test_stale_swipe_and_legacy_changes_cannot_be_undone(client, guest, place, db_session):
    run = await run_for(client, guest)
    await send(client, guest, event(run, place["id"]))
    swipe = event(run, place["id"], "swipe", reaction="like", expected_reaction_revision=0)
    await send(client, guest, swipe)
    await client.put(P + f"/me/reactions/{place['id']}", headers=guest, json={"reaction": "dislike"})
    await send(client, guest, event(run, place["id"], "swipe", reaction="neutral",
                                   expected_reaction_revision=1), 409)
    await send(client, guest, event(run, place["id"], "swipe_undo",
                                   undo_event_id=swipe["event_id"], expected_reaction_revision=2), 409)
    states = (await client.get(P + "/me/place-states", headers=guest)).json()
    assert states[0]["reaction"] == "dislike" and states[0]["reaction_revision"] == 2
    assert await db_session.scalar(select(func.count()).select_from(InteractionEvent)) == 2


async def test_concurrent_swipes_only_apply_one_revision(client, guest, place, db_session):
    run = await run_for(client, guest)
    await send(client, guest, event(run, place["id"]))
    responses = await asyncio.gather(*[
        client.post(P + "/me/events", headers=guest, json=event(
            run, place["id"], "swipe", reaction=reaction, expected_reaction_revision=0))
        for reaction in ("like", "dislike")
    ])
    assert sorted(response.status_code for response in responses) == [200, 409]
    assert await db_session.scalar(select(func.count()).select_from(InteractionEvent)) == 2


async def test_concurrent_same_uuid_in_different_profiles_is_conflict(client, guest, place, db_session):
    first_run = await run_for(client, guest)
    token = (await client.post(P + "/profiles")).json()["access_token"]
    other = {"Authorization": "Bearer " + token}
    second_run = await run_for(client, other)
    await send(client, guest, event(first_run, place["id"]))
    await send(client, other, event(second_run, place["id"]))
    body = event(first_run, place["id"], "swipe", reaction="like", expected_reaction_revision=0)
    responses = await asyncio.gather(
        client.post(P + "/me/events", headers=guest, json=body),
        client.post(P + "/me/events", headers=other, json=body | {"recommendation_id": second_run}),
    )
    assert sorted(response.status_code for response in responses) == [200, 409]
    assert await db_session.scalar(select(func.count()).select_from(PlaceState)) == 1
    assert await db_session.scalar(select(func.count()).select_from(InteractionEvent)) == 3


@pytest.mark.parametrize("delete_profile", [True, False])
async def test_retention_and_profile_deletion_cascade(client, guest, place, db_session, delete_profile):
    run = await run_for(client, guest)
    await send(client, guest, event(run, place["id"]))
    swipe = event(run, place["id"], "swipe", reaction="like", expected_reaction_revision=0)
    await send(client, guest, swipe)
    await send(client, guest, event(run, place["id"], "swipe_undo", undo_event_id=swipe["event_id"],
                                   expected_reaction_revision=1))
    if delete_profile:
        assert (await client.delete(P + "/me", headers=guest)).status_code == 204
    else:
        await db_session.execute(update(RecommendationRun).values(
            created_at=datetime.now(timezone.utc) - timedelta(days=91)))
        await db_session.commit()
        await send(client, guest, event(run, place["id"]), 410)
        assert await cleanup(db_session) == 1
        assert await db_session.scalar(select(func.count()).select_from(PlaceState)) == 1
    for model in (RecommendationRun, RecommendationRunItem, InteractionEvent):
        assert await db_session.scalar(select(func.count()).select_from(model)) == 0
