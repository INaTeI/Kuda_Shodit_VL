"""Delete expired analytics runs and their events; preserve current preferences."""
import asyncio

from app.analytics.service import cleanup
from app.db.session import SessionFactory, engine


async def main():
    try:
        async with SessionFactory() as db:
            print({"deleted_runs": await cleanup(db)})
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
