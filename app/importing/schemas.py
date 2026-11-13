from datetime import datetime
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class RowError(BaseModel):
    row: int
    error: str


class DuplicateRow(BaseModel):
    row: int
    same_as_row: int
    name: str
    key: str


class ImportPlaceResult(BaseModel):
    row: int
    name: str
    key: str
    place_id: UUID
    action: Literal["created", "would_create", "skipped_existing"]
    categories: list[str]
    warnings: list[str]


class ImportReport(BaseModel):
    file: str
    sha256: str
    mode: Literal["dry-run", "apply", "rejected"]
    filled_rows: int
    blank_rows: int = 0
    unique_places: int = 0
    duplicates_in_file: list[DuplicateRow] = Field(default_factory=list)
    errors: list[RowError] = Field(default_factory=list)
    created: int = 0
    would_create: int = 0
    skipped_existing: int = 0
    places: list[ImportPlaceResult] = Field(default_factory=list)


class ImportBatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID = Field(
        description="ID загрузки; используйте в GET и POST /{import_id}/apply"
    )
    file_name: str
    sha256: str
    size_bytes: int
    status: Literal["ready", "invalid", "applied"]
    created_at: datetime
    expires_at: datetime
    applied_at: datetime | None
    report: ImportReport
