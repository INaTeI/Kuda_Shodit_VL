"""Пароль редактора, подписанная сессия и ограничение попыток входа.

Пароль хранится только как PBKDF2-SHA256 в EDITOR_PASSWORD_HASH. Формат без «$»,
чтобы docker compose не пытался подставлять переменные из env-файла:
``pbkdf2_sha256:<итерации>:<соль base64url>:<хеш base64url>``.

Сессия — HMAC-подписанный токен в HttpOnly-cookie. Ключ подписи выводится из
ADMIN_API_KEY и хеша пароля, поэтому смена пароля отзывает все сессии.
"""

import base64
import hashlib
import hmac
import secrets
import time
from collections import deque
from dataclasses import dataclass

from app.core.config import get_settings

ALGORITHM = "pbkdf2_sha256"
ITERATIONS = 600_000
COOKIE_NAME = "vdk_editor"
COOKIE_PATH = "/api/v1"


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def hash_password(password: str, *, iterations: int = ITERATIONS, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return f"{ALGORITHM}:{iterations}:{_b64(salt)}:{_b64(digest)}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt, expected = encoded.split(":")
        if algorithm != ALGORITHM or not 100_000 <= int(iterations) <= 5_000_000:
            return False
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), _unb64(salt), int(iterations))
        return hmac.compare_digest(digest, _unb64(expected))
    except (ValueError, TypeError):
        return False


def login_configured() -> bool:
    return bool(get_settings().editor_password_hash)


def _signing_key() -> bytes:
    s = get_settings()
    return hashlib.sha256(
        b"vdk-editor-session\0" + s.admin_api_key.encode() + b"\0" + s.editor_password_hash.encode()
    ).digest()


@dataclass(frozen=True)
class EditorSession:
    username: str
    expires_at: int


def issue_session(username: str, now: float | None = None) -> tuple[str, EditorSession]:
    expires = int((now or time.time()) + get_settings().editor_session_hours * 3600)
    payload = _b64(f"{username}\n{expires}\n{secrets.token_hex(8)}".encode())
    signature = _b64(hmac.new(_signing_key(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{signature}", EditorSession(username, expires)


def read_session(token: str | None, now: float | None = None) -> EditorSession | None:
    if not token or not login_configured() or token.count(".") != 1 or len(token) > 400:
        return None
    payload, signature = token.split(".")
    expected = _b64(hmac.new(_signing_key(), payload.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        username, expires, _ = _unb64(payload).decode().split("\n")
        expires_at = int(expires)
    except (ValueError, UnicodeDecodeError):
        return None
    if expires_at <= (now or time.time()) or username != get_settings().editor_username:
        return None
    return EditorSession(username, expires_at)


class LoginLimiter:
    """Неудачные попытки в окне: на адрес и на весь сервис (один процесс uvicorn)."""

    def __init__(self, per_client: int = 5, overall: int = 50, window: int = 900):
        self.per_client, self.overall, self.window = per_client, overall, window
        self.failures: dict[str, deque[float]] = {}
        self.all: deque[float] = deque()

    def _trim(self, items: deque[float], now: float) -> None:
        while items and items[0] <= now - self.window:
            items.popleft()

    def retry_after(self, client: str, now: float | None = None) -> int:
        now = now or time.monotonic()
        self._trim(self.all, now)
        own = self.failures.get(client)
        if own is not None:
            self._trim(own, now)
            if not own:
                self.failures.pop(client, None)
        blocked = []
        if own and len(own) >= self.per_client:
            blocked.append(own[0] + self.window - now)
        if len(self.all) >= self.overall:
            blocked.append(self.all[0] + self.window - now)
        return max(1, int(max(blocked)) + 1) if blocked else 0

    def fail(self, client: str, now: float | None = None) -> None:
        now = now or time.monotonic()
        if len(self.failures) > 10_000:
            self.failures.clear()
        self.failures.setdefault(client, deque()).append(now)
        self.all.append(now)

    def succeed(self, client: str) -> None:
        self.failures.pop(client, None)

    def reset(self) -> None:
        self.failures.clear()
        self.all.clear()


limiter = LoginLimiter()
