from datetime import date
from pathlib import Path

import pytest
from openpyxl import Workbook
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.db.models import Place
from app.importing.excel import HEADERS, read_plan, place_id_for
from app.importing.service import import_plan


def write_workbook(path: Path, rows, headers=None):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Места"
    sheet.append(headers or HEADERS)
    for row in rows:
        sheet.append(row)
    workbook.save(path)
    workbook.close()


def sample(**changes):
    row = [
        "Место",
        "Краткое описание",
        "Полный текст",
        "https://2gis.ru/vladivostok/geo/70030077135101601",
        "43,142608",
        "131.918763",
        "Сквер ",
        "прогулка; история; спокойный отдых",
        "Особенность места",
        "бесплатно",
        0,
        0,
        None,
        None,
        None,
        None,
        "неизвестно",
        "Условия посещения",
        None,
        None,
        None,
        "https://2gis.ru/vladivostok/geo/70030077135101601; другой источник",
        None,
        "Черновик",
    ]
    for index, value in changes.items():
        row[int(index)] = value
    return row


def test_excel_preserves_values_and_does_not_invent_costs_or_date(tmp_path):
    file = tmp_path / "places.xlsx"
    write_workbook(file, [sample()])
    before = file.read_bytes()
    plan = read_plan(file)
    assert file.read_bytes() == before
    assert plan.errors == []
    place = plan.places[0]
    assert place.values["latitude"] == 43.142608
    assert place.values["price_rub"] is None  # Free entrance != free total visit.
    assert place.values["checked_at"] is None
    assert place.values["status"] == "draft"
    assert place.values["interest_tags"] == ["прогулка", "история", "спокойный отдых"]
    assert place.categories == ["culture", "nature", "relax"]
    assert (
        place.values["source_data"]["rows"][0]["cells"]["Примечание (необяз.)"]
        == "Черновик"
    )


def test_duplicate_canonical_id_and_alias_keep_all_source_rows(tmp_path):
    file = tmp_path / "duplicates.xlsx"
    alias = sample(
        **{
            "2": "Объект 70030077135101601, другая ссылка",
            "3": "https://go.2gis.com/alias",
            "21": "https://go.2gis.com/alias",
        }
    )
    write_workbook(file, [sample(), alias, sample()])
    plan = read_plan(file)
    assert len(plan.places) == 1
    assert len(plan.duplicates) == 2
    assert len(plan.places[0].values["source_data"]["rows"]) == 3


def test_same_name_different_objects_are_not_merged(tmp_path):
    file = tmp_path / "names.xlsx"
    write_workbook(
        file,
        [
            sample(),
            sample(
                **{
                    "3": "https://2gis.ru/vladivostok/geo/70030077135101602",
                    "21": "https://2gis.ru/vladivostok/geo/70030077135101602",
                }
            ),
        ],
    )
    assert len(read_plan(file).places) == 2


def test_budget_uses_upper_bound_preserves_range_and_missing_coordinates(tmp_path):
    file = tmp_path / "costs.xlsx"
    write_workbook(
        file,
        [
            sample(
                **{
                    "4": None,
                    "5": None,
                    "9": "платно",
                    "10": 300,
                    "11": 500,
                    "12": 300,
                    "13": 500,
                    "22": "12.11.2026",
                }
            )
        ],
    )
    place = read_plan(file).places[0]
    assert place.values["latitude"] is None
    assert place.values["price_rub"] == 500
    assert place.values["cost_details"]["per_person_min_rub"] == 300
    assert place.values["checked_at"] == date(2026, 11, 12)


@pytest.mark.parametrize(
    "changes",
    [
        {"4": "nan"},
        {"4": 100},
        {"4": None},
        {"10": -1},
        {"12": 500, "13": 300},
        {"22": "2999-01-01"},
        {"22": "wrong"},
        {"0": ""},
        {"7": ""},
        {"6": "Новый тип"},
        {"9": "бесплатно", "10": 100},
        {"13": "=SUM(1,2)"},
        {"5": '=HYPERLINK("file:///test")'},
    ],
)
def test_invalid_rows_report_errors(tmp_path, changes):
    file = tmp_path / "invalid.xlsx"
    write_workbook(file, [sample(**changes)])
    assert len(read_plan(file).errors) == 1


def test_headers_are_mapped_by_name_not_position(tmp_path):
    file = tmp_path / "reordered.xlsx"
    write_workbook(file, [list(reversed(sample()))], list(reversed(HEADERS)))
    assert read_plan(file).places[0].values["name"] == "Место"


def test_missing_header_fails_before_import(tmp_path):
    file = tmp_path / "headers.xlsx"
    write_workbook(file, [], HEADERS[:-1])
    with pytest.raises(ValueError, match="Отсутствуют столбцы"):
        read_plan(file)


async def test_postgres_dry_run_atomic_import_and_idempotent_rerun(
    client, admin, tmp_path
):
    import os

    file = tmp_path / "places.xlsx"
    write_workbook(file, [sample(**{"4": None, "5": None})])
    plan = read_plan(file)
    engine = create_async_engine(os.environ["DATABASE_URL"])
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with factory() as db:
            async with db.begin():
                dry_run = await import_plan(db, plan)
            assert dry_run["would_create"] == 1
            assert await db.scalar(select(func.count()).select_from(Place)) == 0
            await db.rollback()
            # Transaction rollback really leaves no half-imported places.
            with pytest.raises(RuntimeError):
                async with db.begin():
                    await import_plan(db, plan, apply=True)
                    raise RuntimeError("cancel transaction")
            assert await db.scalar(select(func.count()).select_from(Place)) == 0
            await db.rollback()
            async with db.begin():
                report = await import_plan(db, plan, apply=True)
            assert report["created"] == 1
            async with db.begin():
                rerun = await import_plan(db, plan, apply=True)
            assert rerun["created"] == 0 and rerun["skipped_existing"] == 1
        response = await client.get("/api/v1/admin/places", headers=admin)
        imported = response.json()["items"][0]
        assert imported["latitude"] is None and imported["checked_at"] is None
        assert imported["source_data"]["sheet"] == "Места"
        assert imported["id"] == str(place_id_for(plan.places[0].key))
        assert (await client.get("/api/v1/places")).json()["total"] == 0
        # DB invariant prevents bypassing API validation to publish incomplete drafts.
        async with factory() as db:
            place = await db.get(Place, place_id_for(plan.places[0].key))
            place.status = "published"
            with pytest.raises(IntegrityError):
                await db.commit()
    finally:
        await engine.dispose()


async def test_file_errors_cancel_entire_import(client, tmp_path):
    import os

    file = tmp_path / "partly-invalid.xlsx"
    write_workbook(file, [sample(), sample(**{"0": ""})])
    plan = read_plan(file)
    engine = create_async_engine(os.environ["DATABASE_URL"])
    factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with factory() as db:
            with pytest.raises(ValueError, match="отменён целиком"):
                await import_plan(db, plan, apply=True)
            assert await db.scalar(select(func.count()).select_from(Place)) == 0
    finally:
        await engine.dispose()


async def test_api_rejects_publication_without_required_fields(
    client, admin, place_payload
):
    for field in ["latitude", "longitude", "checked_at", "source_url"]:
        payload = place_payload | {field: None}
        assert (
            await client.post("/api/v1/admin/places", json=payload, headers=admin)
        ).status_code == 422
