import hashlib
import secrets
from typing import Annotated
from fastapi import Depends, HTTPException
from fastapi.security import APIKeyHeader, HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import get_settings
from app.db.models import Profile
from app.db.session import get_db

DB = Annotated[AsyncSession, Depends(get_db)]
bearer = HTTPBearer(auto_error=False)
admin_header = APIKeyHeader(name="X-Admin-Key", auto_error=False)


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


async def current_profile(
    db: DB, credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]
):
    if credentials:
        profile = await db.scalar(
            select(Profile).where(Profile.token_hash == hash_token(credentials.credentials))
        )
        if profile:
            return profile
    raise HTTPException(401, "Требуется токен гостевого профиля", headers={"WWW-Authenticate": "Bearer"})


CurrentProfile = Annotated[Profile, Depends(current_profile)]


async def require_admin(key: Annotated[str | None, Depends(admin_header)]):
    if not key or not secrets.compare_digest(key, get_settings().admin_api_key):
        raise HTTPException(401, "Неверный ключ редактора")
