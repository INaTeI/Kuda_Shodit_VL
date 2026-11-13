import hashlib
import hmac
import secrets
import time
from typing import Annotated
from fastapi import Depends, HTTPException, Cookie
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


async def require_admin(
    key: Annotated[str | None, Depends(admin_header)],
    token: str | None = Cookie(default=None, alias="vdk_admin"),
):
    if key and secrets.compare_digest(key, get_settings().admin_api_key):
        return
    if admin_session_valid(token):
        return
    raise HTTPException(401, "Требуется вход администратора")


def admin_session_valid(token: str | None) -> bool:
    if not token:
        return False
    try:
        expires, signature = token.split(".", 1)
        if int(expires) < int(time.time()):
            return False
        expected = hmac.new(
            get_settings().admin_api_key.encode(), expires.encode(), hashlib.sha256
        ).hexdigest()
        return secrets.compare_digest(signature, expected)
    except (ValueError, TypeError):
        return False


async def require_admin_session(
    token: str | None = Cookie(default=None, alias="vdk_admin"),
):
    if not admin_session_valid(token):
        raise HTTPException(401, "Неверный ключ редактора")


async def require_admin_or_session(
    key: Annotated[str | None, Depends(admin_header)],
    token: str | None = Cookie(default=None, alias="vdk_admin"),
):
    if key and secrets.compare_digest(key, get_settings().admin_api_key):
        return
    if admin_session_valid(token):
        return
    raise HTTPException(401, "Требуется вход администратора")
