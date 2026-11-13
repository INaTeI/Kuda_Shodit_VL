import asyncio
from datetime import datetime, timedelta, timezone
from io import BytesIO
import os
from uuid import uuid4
from zipfile import ZIP_DEFLATED, ZipFile

from openpyxl import Workbook
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from app.db.models import Place
from app.importing.models import ImportBatch
from app.importing.uploads import MAX_UPLOAD_BYTES, MAX_UNPACKED_BYTES
from test_excel_import import sample

PATH = "/api/v1/admin/imports"


def excel_bytes(rows=None):
    from app.importing.excel import HEADERS

    book = Workbook()
    sheet = book.active
    sheet.title = "Места"
    sheet.append(HEADERS)
    for row in rows if rows is not None else [sample()]:
        sheet.append(row)
    buffer = BytesIO()
    book.save(buffer)
    book.close()
    return buffer.getvalue()


async def upload(client, admin, content=None, filename="places.xlsx"):
    return await client.post(
        PATH + "/preview",
        headers=admin,
        files={
            "file": (
                filename,
                excel_bytes() if content is None else content,
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )


async def test_preview_apply_and_retry_contract(client, admin):
    preview = await upload(client, admin)
    assert preview.status_code == 201, preview.text
    data = preview.json()
    assert data["status"] == "ready"
    assert data["report"]["would_create"] == 1
    assert data["report"]["created"] == 0
    assert data["report"]["file"] == "places.xlsx"
    assert "file_content" not in data
    assert (await client.get("/api/v1/admin/places", headers=admin)).json()[
        "total"
    ] == 0
    saved = await client.get(PATH + "/" + data["id"], headers=admin)
    assert saved.json() == data
    applied = await client.post(PATH + "/" + data["id"] + "/apply", headers=admin)
    assert applied.status_code == 200, applied.text
    result = applied.json()
    assert result["status"] == "applied" and result["report"]["created"] == 1
    repeated = await client.post(PATH + "/" + data["id"] + "/apply", headers=admin)
    assert repeated.json() == result
    places = (await client.get("/api/v1/admin/places", headers=admin)).json()
    assert places["total"] == 1 and places["items"][0]["status"] == "draft"
    assert places["items"][0]["source_data"]["file_name"] == "places.xlsx"
    assert (await client.get("/api/v1/places")).json()["total"] == 0


@pytest.mark.parametrize("headers", [{}, {"X-Admin-Key": "invalid"}])
async def test_import_routes_require_editor_key(client, headers):
    assert (await upload(client, headers)).status_code == 401
    batch_id = str(uuid4())
    assert (await client.get(PATH + "/" + batch_id, headers=headers)).status_code == 401
    assert (
        await client.post(PATH + "/" + batch_id + "/apply", headers=headers)
    ).status_code == 401


@pytest.mark.parametrize(
    "content, filename",
    [
        (b"", "places.xlsx"),
        (b"not a workbook", "places.xlsx"),
        (b"not a workbook", "places.xls"),
        (b"not a workbook", "places.txt"),
    ],
)
async def test_bad_file_returns_validation_error(client, admin, content, filename):
    assert (await upload(client, admin, content, filename)).status_code == 422


async def test_empty_sheet_and_missing_file(client, admin):
    assert (await upload(client, admin, excel_bytes([]))).status_code == 422
    assert (await client.post(PATH + "/preview", headers=admin)).status_code == 422


async def test_row_errors_are_reported_and_block_apply(client, admin):
    data = (
        await upload(client, admin, excel_bytes([sample(), sample(**{"4": 100})]))
    ).json()
    assert data["status"] == "invalid"
    assert data["report"]["errors"][0]["row"] == 3
    assert (
        await client.post(PATH + "/" + data["id"] + "/apply", headers=admin)
    ).status_code == 409
    assert (await client.get("/api/v1/admin/places", headers=admin)).json()[
        "total"
    ] == 0


async def test_field_length_is_a_row_error_not_database_error(client, admin):
    data = (
        await upload(client, admin, excel_bytes([sample(**{"15": "x" * 501})]))
    ).json()
    assert data["status"] == "invalid"
    assert "opening_hours" in data["report"]["errors"][0]["error"]


async def test_oversized_file_and_request_return_413_with_cors(client, admin):
    headers = admin | {"Origin": "http://localhost:5173"}
    response = await upload(client, headers, b"x" * (MAX_UPLOAD_BYTES + 1))
    assert response.status_code == 413
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    response = await client.post(
        PATH + "/preview",
        headers=admin | {"Content-Length": str(MAX_UPLOAD_BYTES + 100000)},
    )
    assert response.status_code == 413


async def test_chunked_request_limit(client, admin):
    async def content():
        yield b"x" * (MAX_UPLOAD_BYTES + 100000)

    response = await client.post(
        PATH + "/preview",
        content=content(),
        headers=admin | {"Content-Type": "multipart/form-data; boundary=boundary"},
    )
    assert response.status_code == 413


async def test_zip_expansion_limit(client, admin):
    buffer = BytesIO()
    with ZipFile(buffer, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", "<Types/>")
        archive.writestr("xl/workbook.xml", "x" * (MAX_UNPACKED_BYTES + 1))
    assert (await upload(client, admin, buffer.getvalue())).status_code == 422


async def test_get_and_apply_missing_or_invalid_ids(client, admin):
    for suffix, status in [(str(uuid4()), 404), ("invalid", 422)]:
        assert (
            await client.get(PATH + "/" + suffix, headers=admin)
        ).status_code == status
        assert (
            await client.post(PATH + "/" + suffix + "/apply", headers=admin)
        ).status_code == status


async def test_apply_rechecks_existing_places(client, admin):
    first = (await upload(client, admin)).json()
    second = (await upload(client, admin)).json()
    assert first["report"]["would_create"] == second["report"]["would_create"] == 1
    one = (await client.post(PATH + "/" + first["id"] + "/apply", headers=admin)).json()
    two = (
        await client.post(PATH + "/" + second["id"] + "/apply", headers=admin)
    ).json()
    assert one["report"]["created"] == 1
    assert two["report"]["created"] == 0 and two["report"]["skipped_existing"] == 1


async def test_expiration_and_discard_raw_bytes_after_apply(client, admin):
    from uuid import UUID

    batch = (await upload(client, admin)).json()
    engine = create_async_engine(os.environ["DATABASE_URL"])
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as db:
            stored = await db.get(ImportBatch, UUID(batch["id"]))
            assert stored.file_content
            stored.expires_at = datetime.now(timezone.utc) - timedelta(seconds=1)
            await db.commit()
        assert (
            await client.get(PATH + "/" + batch["id"], headers=admin)
        ).status_code == 410
        assert (
            await client.post(PATH + "/" + batch["id"] + "/apply", headers=admin)
        ).status_code == 410
        fresh = (await upload(client, admin)).json()
        assert (
            await client.post(PATH + "/" + fresh["id"] + "/apply", headers=admin)
        ).status_code == 200
        async with sessions() as db:
            stored = await db.get(ImportBatch, UUID(fresh["id"]))
            assert stored.file_content is None
    finally:
        await engine.dispose()


async def test_parallel_apply_serializes_and_returns_same_result(client, admin):
    data = (await upload(client, admin)).json()
    responses = await asyncio.gather(
        *[
            client.post(PATH + "/" + data["id"] + "/apply", headers=admin)
            for _ in range(2)
        ]
    )
    assert all(response.status_code == 200 for response in responses)
    assert responses[0].json() == responses[1].json()
    assert (await client.get("/api/v1/admin/places", headers=admin)).json()[
        "total"
    ] == 1


async def test_failed_apply_rolls_back_places_and_batch(client, admin, monkeypatch):
    import app.importing.batches as batches
    from uuid import UUID

    data = (await upload(client, admin)).json()
    original = batches.import_plan

    async def fail_after_flush(db, plan, apply):
        await original(db, plan, apply=apply)
        raise RuntimeError("simulated database failure before commit")

    monkeypatch.setattr(batches, "import_plan", fail_after_flush)
    with pytest.raises(RuntimeError, match="simulated"):
        await client.post(PATH + "/" + data["id"] + "/apply", headers=admin)
    engine = create_async_engine(os.environ["DATABASE_URL"])
    sessions = async_sessionmaker(engine)
    try:
        async with sessions() as db:
            assert await db.scalar(select(func.count()).select_from(Place)) == 0
            assert (await db.get(ImportBatch, UUID(data["id"]))).status == "ready"
    finally:
        await engine.dispose()


async def test_swagger_contains_upload_field(client):
    schema = (await client.get("/openapi.json")).json()
    body = schema["paths"][PATH + "/preview"]["post"]["requestBody"]["content"]
    assert "multipart/form-data" in body
    assert "APIKeyHeader" in schema["components"]["securitySchemes"]
