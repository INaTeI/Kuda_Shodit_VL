from fastapi import HTTPException
from sqlalchemy import select

from app.db.models import Profile


async def lock_profile(db, profile_id):
    """One write at a time per guest, including legacy reaction endpoints."""
    found = await db.scalar(select(Profile.id).where(Profile.id == profile_id).with_for_update())
    if found is None:
        raise HTTPException(401, "Профиль удалён")
