from uuid import uuid4
from xml.etree import ElementTree
import pytest

P = "/api/v1"


async def test_health_docs_categories(client):
    assert (await client.get("/health/live")).json() == {"status": "ok"}
    assert (await client.get("/health/ready")).status_code == 200
    assert (await client.get("/docs")).status_code == 200
    spec = (await client.get("/openapi.json")).json()
    assert len(spec["paths"]) >= 15
    assert "HTTPBearer" in spec["components"]["securitySchemes"]
    assert len((await client.get(P + "/categories")).json()) == 8


@pytest.mark.parametrize("headers", [{}, {"X-Admin-Key": "wrong"}])
async def test_editor_requires_key(client, place_payload, headers):
    assert (await client.post(P + "/admin/places", json=place_payload, headers=headers)).status_code == 401
    assert (await client.get(P + "/admin/places", headers=headers)).status_code == 401


async def test_editor_lifecycle_and_public_visibility(client, admin, place_payload):
    place_payload["status"] = "draft"
    created = await client.post(P + "/admin/places", json=place_payload, headers=admin)
    place_id = created.json()["id"]
    assert (await client.get(P + "/places/" + place_id)).status_code == 404
    assert (await client.get(P + "/places")).json()["total"] == 0
    assert (await client.get(P + "/admin/places", headers=admin)).json()["total"] == 1
    place_payload.update(status="published", name="Обновлено")
    updated = await client.put(P + "/admin/places/" + place_id, json=place_payload, headers=admin)
    assert updated.json()["name"] == "Обновлено"
    detail = (await client.get(P + "/places/" + place_id)).json()
    assert detail["photo_url"] is None
    assert detail["categories"][0]["slug"] == "nature"
    assert (await client.delete(P + "/admin/places/" + place_id, headers=admin)).status_code == 204
    assert (await client.get(P + "/places/" + place_id)).status_code == 410
    assert (await client.get(P + "/places")).json()["total"] == 0


async def test_web_sitemap_and_place_status_follow_publication(client, admin, place_payload):
    robots = await client.get("/robots.txt")
    assert robots.status_code == 200
    assert robots.headers["content-type"].startswith("text/plain")
    origin = robots.text.split("Sitemap: ", 1)[1].strip().removesuffix("/sitemap.xml")

    async def sitemap_urls():
        response = await client.get("/sitemap.xml")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/xml")
        root = ElementTree.fromstring(response.content)
        return {loc.text for loc in root.findall("./{*}url/{*}loc")}

    place_payload["status"] = "draft"
    created = await client.post(P + "/admin/places", json=place_payload, headers=admin)
    place_id = created.json()["id"]
    web_path = f"/web/places/{place_id}"
    public_url = f"{origin}/places/{place_id}"
    static_urls = {f"{origin}/", f"{origin}/catalog"}

    assert await sitemap_urls() == static_urls
    assert (await client.get(web_path)).status_code == 404
    assert (await client.get(f"/web/places/{uuid4()}")).status_code == 404
    updated = await client.put(
        P + f"/admin/places/{place_id}",
        json={**place_payload, "status": "published"},
        headers=admin,
    )
    assert updated.status_code == 200
    assert await sitemap_urls() == static_urls | {public_url}
    published = await client.head(web_path)
    assert published.status_code == 200
    assert published.headers["x-accel-redirect"] == "/index.html"
    assert (await client.delete(P + f"/admin/places/{place_id}", headers=admin)).status_code == 204
    assert await sitemap_urls() == static_urls
    assert (await client.get(web_path)).status_code == 410


@pytest.mark.parametrize(
    "change",
    [
        {"latitude": 91},
        {"longitude": -181},
        {"price_rub": -1},
        {"name": "   "},
        {"category_slugs": ["missing"]},
        {"category_slugs": []},
        {"category_slugs": ["nature", "nature"]},
        {"source_url": "bad"},
        {"checked_at": "2999-01-01"},
        {"status": "wrong"},
        {"surprise": True},
    ],
)
async def test_place_validation(client, admin, place_payload, change):
    place_payload.update(change)
    assert (await client.post(P + "/admin/places", json=place_payload, headers=admin)).status_code == 422


async def test_not_found_and_invalid_uuid(client, admin, place_payload):
    missing = str(uuid4())
    assert (await client.get(P + "/places/" + missing)).status_code == 404
    assert (await client.get(P + "/places/not-a-uuid")).status_code == 422
    assert (
        await client.put(P + "/admin/places/" + missing, json=place_payload, headers=admin)
    ).status_code == 404
    assert (await client.delete(P + "/admin/places/" + missing, headers=admin)).status_code == 404


async def test_budget_radius_categories_pagination(client, admin, place_payload):
    for changes in [{}, {"price_rub": None}, {"latitude": 44}, {"category_slugs": ["food"]}]:
        payload = place_payload | changes
        assert (await client.post(P + "/admin/places", json=payload, headers=admin)).status_code == 201
    result = (
        await client.get(
            P + "/places",
            params={
                "categories": "nature",
                "budget_rub": 100,
                "latitude": 43.115,
                "longitude": 131.885,
                "radius_km": 1,
            },
        )
    ).json()
    assert result["total"] == 1
    assert result["items"][0]["price_rub"] == 100
    assert (await client.get(P + "/places", params={"limit": 1, "offset": 1})).json()["total"] == 4
    assert len((await client.get(P + "/places", params={"limit": 1, "offset": 1})).json()["items"]) == 1
    assert (await client.get(P + "/places", params={"offset": 999})).json()["items"] == []
    assert (await client.get(P + "/places", params={"budget_rub": 0})).json()["total"] == 0


@pytest.mark.parametrize(
    "params",
    [
        {"latitude": 43},
        {"radius_km": 1},
        {"limit": 0},
        {"limit": 101},
        {"offset": -1},
        {"categories": "missing"},
        {"radius_km": 0},
        {"latitude": "nan"},
        {"budget_rub": -1},
    ],
)
async def test_bad_filters(client, params):
    assert (await client.get(P + "/places", params=params)).status_code == 422


@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer bad"}])
async def test_guest_auth_required(client, headers):
    assert (await client.get(P + "/me", headers=headers)).status_code == 401
    assert (await client.post(P + "/recommendations", json={}, headers=headers)).status_code == 401


async def test_preferences_and_profile_deletion(client, guest):
    original = (await client.get(P + "/me", headers=guest)).json()
    assert "token_hash" not in original
    result = await client.put(
        P + "/me/preferences", json={"interests": ["nature"], "budget_rub": 0}, headers=guest
    )
    assert result.json()["budget_rub"] == 0
    assert (
        await client.put(P + "/me/preferences", json={"interests": ["unknown"]}, headers=guest)
    ).status_code == 422
    assert (await client.delete(P + "/me", headers=guest)).status_code == 204
    assert (await client.get(P + "/me", headers=guest)).status_code == 401


async def test_reaction_known_undo_isolation(client, guest, place):
    place_id = place["id"]
    reaction_url = P + "/me/reactions/" + place_id
    state = await client.put(reaction_url, json={"reaction": "like"}, headers=guest)
    assert state.json()["reaction"] == "like"
    state = await client.put(P + "/me/known-places/" + place_id, json={"is_known": True}, headers=guest)
    assert state.json()["reaction"] == "like" and state.json()["is_known"]
    assert (await client.post(P + "/recommendations", json={}, headers=guest)).json()["items"] == []
    restored = await client.post(P + "/recommendations", json={"exclude_known": False}, headers=guest)
    assert restored.json()["items"][0]["place"]["id"] == place_id
    second = (await client.post(P + "/profiles")).json()
    other = {"Authorization": "Bearer " + second["access_token"]}
    assert (await client.get(P + "/me/place-states", headers=other)).json() == []
    assert (await client.post(P + "/recommendations", json={}, headers=other)).json()["total"] == 1
    assert (await client.delete(reaction_url, headers=guest)).status_code == 204
    states = (await client.get(P + "/me/place-states", headers=guest)).json()
    assert states[0]["reaction"] is None and states[0]["is_known"]
    await client.put(P + "/me/known-places/" + place_id, json={"is_known": False}, headers=guest)
    for value in ["dislike", "neutral"]:
        response = await client.put(reaction_url, json={"reaction": value}, headers=guest)
        assert response.json()["reaction"] == value
    assert (await client.put(reaction_url, json={"reaction": "wrong"}, headers=guest)).status_code == 422
    assert (
        await client.put(P + "/me/reactions/" + str(uuid4()), json={"reaction": "like"}, headers=guest)
    ).status_code == 404


async def test_recommendation_ranking_dislike_and_discovery(client, admin, guest, place_payload):
    items = []
    for slug in ["food", "nature", "nature"]:
        response = await client.post(
            P + "/admin/places", json=place_payload | {"category_slugs": [slug]}, headers=admin
        )
        items.append(response.json())
    await client.put(P + "/me/preferences", json={"interests": ["nature"]}, headers=guest)
    result = (await client.post(P + "/recommendations", json={}, headers=guest)).json()
    assert result["items"][0]["place"]["categories"][0]["slug"] == "nature"
    assert "Совпадает с интересами" in result["items"][0]["reasons"][0]
    await client.put(P + "/me/reactions/" + items[1]["id"], json={"reaction": "like"}, headers=guest)
    await client.put(P + "/me/reactions/" + items[2]["id"], json={"reaction": "dislike"}, headers=guest)
    result = (await client.post(P + "/recommendations", json={}, headers=guest)).json()
    assert result["total"] == 2
    assert result["items"][0]["place"]["id"] == items[1]["id"]
    explore = (await client.post(P + "/discovery", json={}, headers=guest)).json()
    assert [x["place"]["id"] for x in explore["items"]] == [items[0]["id"]]
    await client.put(P + "/me/reactions/" + items[0]["id"], json={"reaction": "neutral"}, headers=guest)
    assert (await client.post(P + "/discovery", json={}, headers=guest)).json()["items"] == []


async def test_profile_budget_override_and_no_silent_filter_relaxation(client, guest, place):
    await client.put(P + "/me/preferences", json={"budget_rub": 0}, headers=guest)
    assert (await client.post(P + "/recommendations", json={}, headers=guest)).json()["total"] == 0
    result = (await client.post(P + "/recommendations", json={"budget_rub": None}, headers=guest)).json()
    assert result["total"] == 1
    result = await client.post(
        P + "/recommendations",
        headers=guest,
        json={"budget_rub": 100, "latitude": 43.115, "longitude": 131.885, "radius_km": 1},
    )
    assert result.json()["items"][0]["distance_km"] == 0
    assert (await client.post(P + "/recommendations", json={"categories": ["food"]}, headers=guest)).json()[
        "total"
    ] == 0


async def test_cors_for_react(client):
    response = await client.options(
        P + "/recommendations",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"

async def test_reset_interests_keeps_budget_known_and_other_profiles(client, admin, place_payload):
    place_id = (await client.post(P + "/admin/places", json=place_payload, headers=admin)).json()["id"]
    async def guest():
        data = (await client.post(P + "/profiles")).json()
        return {"Authorization": "Bearer " + data["access_token"]}
    owner, other = await guest(), await guest()
    for auth in [owner, other]:
        await client.put(P + "/me/preferences", headers=auth, json={"interests": ["nature"], "budget_rub": 1000})
        await client.put(P + f"/me/reactions/{place_id}", headers=auth, json={"reaction": "like"})
        await client.put(P + f"/me/known-places/{place_id}", headers=auth, json={"is_known": True})
    assert (await client.post(P + "/me/interests/reset")).status_code == 401
    reset = await client.post(P + "/me/interests/reset", headers=owner)
    assert reset.status_code == 200
    assert reset.json()["interests"] == []
    assert reset.json()["budget_rub"] == 1000
    state = (await client.get(P + "/me/place-states", headers=owner)).json()[0]
    assert state["reaction"] is None and state["is_known"] is True
    assert state["reaction_revision"] == 2
    await client.post(P + "/me/interests/reset", headers=owner)
    assert (await client.get(P + "/me/place-states", headers=owner)).json()[0]["reaction_revision"] == 2
    assert (await client.get(P + "/me", headers=other)).json()["interests"] == ["nature"]
    assert (await client.get(P + "/me/place-states", headers=other)).json()[0]["reaction"] == "like"
