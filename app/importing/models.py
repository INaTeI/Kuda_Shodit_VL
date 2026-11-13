from datetime import datetime
from uuid import UUID, uuid4
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Integer,
    JSON,
    LargeBinary,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column
from app.db.session import Base


class ImportBatch(Base):
    __tablename__ = "import_batches"
    __table_args__ = (
        CheckConstraint(
            "status IN ('ready','invalid','applied')", name="ck_import_status"
        ),
        CheckConstraint(
            "size_bytes > 0 AND size_bytes <= 5242880", name="ck_import_size"
        ),
        CheckConstraint(
            "status != 'ready' OR file_content IS NOT NULL", name="ck_import_ready_file"
        ),
    )
    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    file_name: Mapped[str] = mapped_column(String(255))
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    size_bytes: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16))
    file_content: Mapped[bytes | None] = mapped_column(LargeBinary)
    report: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
