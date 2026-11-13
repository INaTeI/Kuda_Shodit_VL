import copy

import pytest

from app.core.config import get_settings
from app.editor import security

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x01" * 64
CSRF = {"X-VDK-Editor": "1"}

BLOCK = {"bg": "white", "text": "auto", "size": "M", "width": "full", "hidden": False}
PAGE = {
    "preset": "classic",
    "order": ["gallery", "title", "price", "address", "description"],
    "blocks": {k: dict(BLOCK) for k in ("gallery", "title", "price", "address", "description")},
}
CARD = {"preset": "teal", "bg": "teal", "framed": False, "items": ["wave", "seaview"]}


@pytest.fixture(autouse=True)
def editor_password(monkeypatch):
    settings = get_settings()
    monkeypatch.setattr(settings, "editor_username", "admin")
    monkeypatch.setattr(
        settings, "editor_password_hash", security.hash_password("admin1234", iterations=100_000)
    )
    security.limiter.reset()
    yield
    security.limiter.reset()


async def login(client, password="admin1234", username="admin", headers=CSRF):
    return await client.post(
        "/api/v1/editor/login", json={"username": username, "password": password}, headers=headers
    )


def body(revision=0, **extra):
    data = {
        "expected_revision": revision,
        "name": "Тестовое место у моря",
        "description": "Новое описание",
        "address": "Набережная, 1",
        "title_accent": 2,
        "page": copy.deepcopy(PAGE),
        "card": copy.deepcopy(CARD),
        "photos": [],
    }
    data.update(extra)
    return data


def test_password_hash_roundtrip():
    encoded = security.hash_password("admin1234", iterations=100_000)
    assert "$" not in encoded and "admin1234" not in encoded
    assert security.verify_password("admin1234", encoded)
    assert not security.verify_password("admin12345", encoded)
    assert not security.verify_password("admin1234", "garbage")


async def test_login_session_logout(client):
    assert (await client.get("/api/v1/editor/session")).status_code == 401
    assert (await login(client, headers={})).status_code == 403
    assert (await login(client, password="wrong")).status_code == 401
    assert (await login(client, username="root")).status_code == 401
    response = await login(client)
    assert response.status_code == 200
    cookie = response.headers["set-cookie"]
    assert "HttpOnly" in cookie and "samesite=strict" in cookie.lower() and "Path=/api/v1" in cookie
    assert (await client.get("/api/v1/editor/session")).json()["username"] == "admin"
    assert (await client.post("/api/v1/editor/logout")).status_code == 403
    assert (await client.get("/api/v1/editor/session")).status_code == 200
    assert (await client.post("/api/v1/editor/logout", headers=CSRF)).status_code == 204
    assert (await client.get("/api/v1/editor/session")).status_code == 401


async def test_login_disabled_without_hash(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "editor_password_hash", "")
    assert (await login(client)).status_code == 503


async def test_login_rate_limited(client):
    for _ in range(5):
        assert (await login(client, password="nope")).status_code == 401
    blocked = await login(client)
    assert blocked.status_code == 429 and int(blocked.headers["retry-after"]) > 0


async def test_password_change_revokes_session(client, monkeypatch):
    await login(client)
    monkeypatch.setattr(
        get_settings(), "editor_password_hash", security.hash_password("other-pass", iterations=100_000)
    )
    assert (await client.get("/api/v1/editor/session")).status_code == 401


async def test_editor_routes_require_session_and_csrf(client, place):
    pid = place["id"]
    assert (await client.get("/api/v1/editor/places")).status_code == 401
    assert (await client.put(f"/api/v1/editor/places/{pid}", json=body(), headers=CSRF)).status_code == 401
    await login(client)
    assert (await client.put(f"/api/v1/editor/places/{pid}", json=body())).status_code == 403
    listed = (await client.get("/api/v1/editor/places")).json()
    assert [p["id"] for p in listed] == [pid] and listed[0]["has_design"] is False


async def test_save_publishes_design_for_everyone(client, place, guest):
    pid = place["id"]
    assert (await client.get(f"/api/v1/places/{pid}/design")).status_code == 404
    await login(client)
    first = await client.post(f"/api/v1/editor/places/{pid}/photos", content=PNG, headers=CSRF)
    second = await client.post(f"/api/v1/editor/places/{pid}/photos", content=JPEG, headers=CSRF)
    assert first.status_code == second.status_code == 201
    a, b = first.json()["id"], second.json()["id"]
    # До сохранения фото видно только редактору.
    assert (await client.get(f"/api/v1/photos/{a}")).status_code == 200
    saved = await client.put(
        f"/api/v1/editor/places/{pid}",
        json=body(photos=[{"id": b, "alt": "Вид"}, {"id": a, "alt": "Вход"}], main_photo_id=a),
        headers=CSRF,
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["revision"] == 1
    await client.post("/api/v1/editor/logout", headers=CSRF)

    design = (await client.get(f"/api/v1/places/{pid}/design")).json()
    assert design["revision"] == 1 and design["title_accent"] == 2
    assert [p["id"] for p in design["photos"]] == [b, a]
    assert design["photos"][0]["alt"] == "Вид"
    detail = (await client.get(f"/api/v1/places/{pid}")).json()
    assert detail["name"] == "Тестовое место у моря" and detail["address"] == "Набережная, 1"
    assert detail["photo_url"] == f"/api/v1/photos/{a}"
    assert detail["card_style"]["items"] == ["wave", "seaview"]
    image = await client.get(f"/api/v1/photos/{a}")
    assert image.status_code == 200 and image.headers["content-type"] == "image/png"
    assert image.content == PNG and "public" in image.headers["cache-control"]
    assert (await client.get(f"/api/v1/photos/{a}", headers={"If-None-Match": image.headers["etag"]})).status_code == 304
    listing = (await client.get("/api/v1/places", params={"limit": 10})).json()
    assert listing["items"][0]["photo_url"] == f"/api/v1/photos/{a}"
    recs = await client.post("/api/v1/recommendations", json={}, headers=guest)
    assert recs.status_code == 200, recs.text
    styled = [i["place"] for i in recs.json()["items"] if i["place"]["id"] == pid]
    assert not styled or styled[0]["card_style"]["bg"] == "teal"


async def test_removed_and_pending_photos_are_not_public(client, place):
    pid = place["id"]
    await login(client)
    kept = (await client.post(f"/api/v1/editor/places/{pid}/photos", content=PNG, headers=CSRF)).json()["id"]
    dropped = (await client.post(f"/api/v1/editor/places/{pid}/photos", content=PNG, headers=CSRF)).json()["id"]
    await client.put(f"/api/v1/editor/places/{pid}", json=body(photos=[{"id": kept}]), headers=CSRF)
    pending = (await client.post(f"/api/v1/editor/places/{pid}/photos", content=PNG, headers=CSRF)).json()["id"]
    await client.post("/api/v1/editor/logout", headers=CSRF)
    assert (await client.get(f"/api/v1/photos/{kept}")).status_code == 200
    assert (await client.get(f"/api/v1/photos/{dropped}")).status_code == 404
    assert (await client.get(f"/api/v1/photos/{pending}")).status_code == 404


async def test_revision_conflict(client, place):
    pid = place["id"]
    await login(client)
    url = f"/api/v1/editor/places/{pid}"
    assert (await client.put(url, json=body(0), headers=CSRF)).status_code == 200
    assert (await client.put(url, json=body(0), headers=CSRF)).status_code == 409
    again = await client.put(url, json=body(1, name="Другое", title_accent=None), headers=CSRF)
    assert again.status_code == 200 and again.json()["revision"] == 2


@pytest.mark.parametrize(
    "patch",
    [
        {"page": {**PAGE, "order": ["title", "title", "price", "address", "description"]}},
        {"page": {**PAGE, "blocks": {**PAGE["blocks"], "title": {**BLOCK, "hidden": True}}}},
        # Белый текст на белом фоне нечитаем.
        {"page": {**PAGE, "blocks": {**PAGE["blocks"], "price": {**BLOCK, "text": "white"}}}},
        {"page": {**PAGE, "blocks": {**PAGE["blocks"], "price": {**BLOCK, "bg": "#ff0000"}}}},
        {"card": {**CARD, "items": ["gem", "trophy", "star"]}},
        {"card": {**CARD, "items": ["wave", "wave"]}},
        {"card": {**CARD, "items": ["<script>"]}},
        {"name": "   "},
        {"title_accent": 9},
        {"photos": [{"id": "00000000-0000-0000-0000-000000000001"}] * 2},
        {"extra": 1},
    ],
)
async def test_invalid_design_rejected(client, place, patch):
    await login(client)
    response = await client.put(f"/api/v1/editor/places/{place['id']}", json=body(**patch), headers=CSRF)
    assert response.status_code == 422


async def test_foreign_photo_rejected(client, place, admin, place_payload):
    other = (await client.post("/api/v1/admin/places", json=place_payload, headers=admin)).json()
    await login(client)
    photo = (await client.post(f"/api/v1/editor/places/{other['id']}/photos", content=PNG, headers=CSRF)).json()
    response = await client.put(
        f"/api/v1/editor/places/{place['id']}", json=body(photos=[{"id": photo["id"]}]), headers=CSRF
    )
    assert response.status_code == 422


async def test_upload_validation(client, place):
    pid = place["id"]
    await login(client)
    url = f"/api/v1/editor/places/{pid}/photos"
    assert (await client.post(url, content=b"<svg onload=alert(1)>", headers=CSRF)).status_code == 415
    assert (await client.post(url, content=b"", headers=CSRF)).status_code == 422
    big = PNG + b"\x00" * (4 * 1024 * 1024)
    assert (await client.post(url, content=big, headers=CSRF)).status_code == 413
    missing = "/api/v1/editor/places/00000000-0000-0000-0000-000000000000/photos"
    assert (await client.post(missing, content=PNG, headers=CSRF)).status_code == 404


async def test_draft_place_design_hidden(client, admin, place_payload):
    draft = (
        await client.post("/api/v1/admin/places", json={**place_payload, "status": "draft"}, headers=admin)
    ).json()
    await login(client)
    photo = (await client.post(f"/api/v1/editor/places/{draft['id']}/photos", content=PNG, headers=CSRF)).json()
    saved = await client.put(
        f"/api/v1/editor/places/{draft['id']}", json=body(photos=[{"id": photo["id"]}]), headers=CSRF
    )
    assert saved.status_code == 200
    await client.post("/api/v1/editor/logout", headers=CSRF)
    assert (await client.get(f"/api/v1/places/{draft['id']}/design")).status_code == 404
    assert (await client.get(f"/api/v1/photos/{photo['id']}")).status_code == 404
