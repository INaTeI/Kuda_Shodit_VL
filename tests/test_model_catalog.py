from pathlib import Path
from sqlalchemy import select
from app.db.models import Place
from app.importing.model_catalog import load_catalog, import_catalog

CATALOG = Path(__file__).resolve().parents[1] / "recommender/data/catalog.json"


def test_model_catalog_retains_source_and_unknown_values():
    rows = load_catalog(CATALOG)
    assert len(rows) == 188
    assert len({r.values["import_key"] for r in rows}) == 188
    assert all(r.values["status"] == "draft" for r in rows)
    assert sum(r.values["latitude"] is None for r in rows) == 106
    supra = next(r for r in rows if r.values["name"] == "Supra")
    assert supra.values["price_rub"] == 1500
    assert supra.values["checked_at"].isoformat() == "2026-11-10"
    assert supra.values["source_data"]["model_place_id"].startswith("place_")
    assert "food" in supra.categories


async def test_catalog_import_is_repeatable_and_preserves_editor_changes(client, db_session):
    report = await import_catalog(db_session, CATALOG, publish_complete=True)
    assert report["created"] == 188
    assert (await db_session.scalars(select(Place))).all() == []
    report = await import_catalog(db_session, CATALOG, apply=True, publish_complete=True)
    await db_session.commit()
    assert report["published"] == 42 and report["draft"] == 146
    places = (await db_session.scalars(select(Place))).all()
    assert len(places) == 188
    place = places[0]
    place.name = "Правка редактора"
    await db_session.commit()
    again = await import_catalog(db_session, CATALOG, apply=True, publish_complete=True)
    await db_session.commit()
    assert again["skipped"] == 188 and again["created"] == 0
    assert (await db_session.get(Place, place.id)).name == "Правка редактора"
