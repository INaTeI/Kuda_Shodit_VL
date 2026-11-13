"""Remove expired pending uploads and reports older than 30 days."""

import asyncio
from datetime import datetime, timedelta, timezone
from sqlalchemy import delete, or_, and_
from app.db.session import SessionFactory, engine
from app.importing.models import ImportBatch


async def main():
    now = datetime.now(timezone.utc)
    async with SessionFactory() as db:
        async with db.begin():
            result = await db.execute(
                delete(ImportBatch).where(
                    or_(
                        and_(
                            ImportBatch.status == "ready", ImportBatch.expires_at < now
                        ),
                        ImportBatch.created_at < now - timedelta(days=30),
                    )
                )
            )
            print(f"Deleted import batches: {result.rowcount}")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
