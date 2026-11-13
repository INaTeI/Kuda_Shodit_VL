"""Persistent preview and confirmation of Excel uploads."""

from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "import_batches",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("file_name", sa.String(255), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("file_content", sa.LargeBinary()),
        sa.Column("report", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("applied_at", sa.DateTime(timezone=True)),
        sa.CheckConstraint(
            "status IN ('ready','invalid','applied')", name="ck_import_status"
        ),
        sa.CheckConstraint(
            "size_bytes > 0 AND size_bytes <= 5242880", name="ck_import_size"
        ),
        sa.CheckConstraint(
            "status != 'ready' OR file_content IS NOT NULL", name="ck_import_ready_file"
        ),
    )
    op.create_index("ix_import_batches_sha256", "import_batches", ["sha256"])
    op.create_index("ix_import_batches_expires_at", "import_batches", ["expires_at"])


def downgrade():
    op.drop_table("import_batches")
