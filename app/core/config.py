from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = "postgresql+asyncpg://vdk:local-development-change-me@localhost:5432/vdk_gid"
    admin_api_key: str = Field(min_length=12)
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:3000"]
    weatherapi_key: str = ""
    analytics_retention_days: int = Field(default=90, ge=1, le=365)
    public_site_url: str = "http://localhost:8080"
    editor_username: str = "admin"
    editor_password_hash: str = ""
    editor_session_hours: int = Field(default=12, ge=1, le=168)
    editor_cookie_secure: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
