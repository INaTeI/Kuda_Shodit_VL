import os
import subprocess
import sys
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from app.main import app
from app.db.session import get_db
from app.seed import seed_categories


@pytest.fixture(scope="session", autouse=True)
def migrate_test_database():
    url = os.environ["DATABASE_URL"]
    if "vdk_test" not in url:
        raise RuntimeError(
            "Tests only run against a database explicitly named vdk_test"
        )
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], check=True)


@pytest_asyncio.fixture
async def client():
    # Fresh pool per test event loop; migrations are exercised, not create_all().
    engine = create_async_engine(os.environ["DATABASE_URL"])
    factory = async_sessionmaker(engine, expire_on_commit=False)
    async with factory() as session:
        await session.execute(
            text(
                "TRUNCATE place_photos, place_designs, "
                "interaction_events, recommendation_items, recommendation_runs, "
                "import_batches, place_states, profiles, place_categories, places, categories CASCADE"
            )
        )
        await session.commit()
        await seed_categories(session)

    async def override():
        async with factory() as session:
            yield session

    app.dependency_overrides[get_db] = override
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client
    app.dependency_overrides.clear()
    await engine.dispose()


@pytest.fixture
def admin():
    return {"X-Admin-Key": os.environ["ADMIN_API_KEY"]}


@pytest_asyncio.fixture
async def db_session():
    engine = create_async_engine(os.environ["DATABASE_URL"])
    try:
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            yield session
    finally:
        await engine.dispose()


@pytest.fixture
def place_payload():
    return dict(
        name="Тестовое место",
        description="Описание",
        activity="Прогулка",
        latitude=43.115,
        longitude=131.885,
        price_rub=100,
        price_note="На человека",
        source_url="https://example.com/place",
        checked_at="2026-01-01",
        category_slugs=["nature"],
        status="published",
    )


@pytest_asyncio.fixture
async def guest(client):
    response = await client.post("/api/v1/profiles")
    assert response.status_code == 201
    return {"Authorization": "Bearer " + response.json()["access_token"]}


@pytest_asyncio.fixture
async def place(client, admin, place_payload):
    response = await client.post(
        "/api/v1/admin/places", json=place_payload, headers=admin
    )
    assert response.status_code == 201, response.text
    return response.json()
