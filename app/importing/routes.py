from typing import Annotated
from uuid import UUID
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.exc import IntegrityError
from app.api.dependencies import DB, require_admin
from app.importing import batches
from app.importing.schemas import ImportBatchOut
from app.importing.uploads import MAX_UPLOAD_BYTES

router = APIRouter(
    prefix="/admin/imports",
    tags=["Импорт Excel"],
    dependencies=[Depends(require_admin)],
)


@router.post(
    "/preview",
    response_model=ImportBatchOut,
    status_code=201,
    summary="Загрузить Excel и проверить без записи мест",
    description="Выберите .xlsx/.xlsm до 5 МБ. Места не создаются. "
    "Если status=ready, подтвердите загрузку по id в течение часа. "
    "Если status=invalid, смотрите report.errors и исправьте Excel.",
)
async def preview(
    db: DB, file: Annotated[UploadFile, File(description="Книга с листом Места")]
):
    try:
        file_name = (file.filename or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
        if not file_name or len(file_name) > 255:
            raise HTTPException(422, "Укажите имя Excel-файла длиной до 255 символов")
        content = bytearray()
        while chunk := await file.read(65536):
            content.extend(chunk)
            if len(content) > MAX_UPLOAD_BYTES:
                raise HTTPException(413, "Размер файла превышает 5 МБ")
        return await batches.create_preview(db, bytes(content), file_name)
    finally:
        await file.close()


@router.get(
    "/{import_id}", response_model=ImportBatchOut, summary="Получить отчёт загрузки"
)
async def detail(import_id: UUID, db: DB):
    return await batches.get_batch(db, import_id)


@router.post(
    "/{import_id}/apply",
    response_model=ImportBatchOut,
    summary="Подтвердить импорт проверенного Excel",
    description="Создаёт только новые черновики одной транзакцией. Существующие места пропускаются. "
    "Повторное подтверждение возвращает сохранённый результат и не повторяет запись.",
)
async def apply(import_id: UUID, db: DB):
    try:
        return await batches.apply_batch(db, import_id)
    except IntegrityError as error:
        await db.rollback()
        raise HTTPException(
            409, "Конфликт данных. Обновите предварительную проверку файла."
        ) from error
