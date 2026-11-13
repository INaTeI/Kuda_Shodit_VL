import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
from fastapi import HTTPException
from sqlalchemy import select, text
from app.importing.models import ImportBatch
from app.importing.service import import_plan
from app.importing.uploads import parse_upload


async def create_preview(db, content, file_name):
    try:
        plan = await asyncio.to_thread(parse_upload, content, file_name)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    if plan.nonempty == 0:
        raise HTTPException(422, "Лист Места не содержит записей")
    async with db.begin():
        if plan.errors:
            report = dict(
                file=plan.file_name,
                sha256=plan.sha256,
                mode="rejected",
                filled_rows=plan.nonempty,
                blank_rows=plan.blank,
                unique_places=len(plan.places),
                errors=plan.errors,
                duplicates_in_file=plan.duplicates,
            )
        else:
            report = await import_plan(db, plan, apply=False)
        batch = ImportBatch(
            file_name=file_name,
            sha256=plan.sha256,
            size_bytes=len(content),
            status="invalid" if plan.errors else "ready",
            file_content=None if plan.errors else content,
            report=report,
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
        )
        db.add(batch)
        await db.flush()
    return batch


def check_expiration(batch):
    if batch.status == "ready" and batch.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(410, "Срок подтверждения истёк. Загрузите Excel заново.")


async def get_batch(db, import_id):
    batch = await db.get(ImportBatch, import_id)
    if batch is None:
        raise HTTPException(404, "Загрузка не найдена")
    check_expiration(batch)
    return batch


async def apply_batch(db, import_id):
    async with db.begin():
        # Same global lock as the CLI; always acquire it before the batch row lock.
        await db.execute(text("SELECT pg_advisory_xact_lock(70693421)"))
        batch = await db.scalar(
            select(ImportBatch).where(ImportBatch.id == import_id).with_for_update()
        )
        if batch is None:
            raise HTTPException(404, "Загрузка не найдена")
        if batch.status == "applied":
            return batch  # Retrying confirmation returns the saved result.
        if batch.status == "invalid":
            raise HTTPException(
                409, "В файле есть ошибки строк. Исправьте файл и загрузите заново."
            )
        check_expiration(batch)
        if hashlib.sha256(batch.file_content).hexdigest() != batch.sha256:
            raise HTTPException(
                409, "Проверенный файл изменился. Загрузите его заново."
            )
        try:
            plan = await asyncio.to_thread(
                parse_upload, batch.file_content, batch.file_name
            )
        except ValueError as error:
            raise HTTPException(
                409, "Проверенный файл больше не может быть импортирован"
            ) from error
        if plan.errors:
            raise HTTPException(
                409, "Файл не прошёл повторную проверку. Загрузите его заново."
            )
        batch.report = await import_plan(db, plan, apply=True)
        batch.status = "applied"
        batch.applied_at = datetime.now(timezone.utc)
        batch.file_content = None
        await db.flush()
    return batch
