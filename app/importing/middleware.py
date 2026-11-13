from fastapi import HTTPException
from starlette.responses import JSONResponse
from app.importing.uploads import MAX_UPLOAD_BYTES


class ImportBodyLimitMiddleware:
    """Bound multipart traffic before Starlette spools the complete request to disk."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if (
            scope["type"] != "http"
            or scope["method"] != "POST"
            or scope["path"] != "/api/v1/admin/imports/preview"
        ):
            return await self.app(scope, receive, send)
        limit = (
            MAX_UPLOAD_BYTES + 65536
        )  # Multipart headers/boundaries in addition to file bytes.
        headers = dict(scope.get("headers", []))
        try:
            length = int(headers.get(b"content-length", b"0"))
        except ValueError:
            length = limit + 1
        if length < 0 or length > limit:
            return await JSONResponse(
                status_code=413, content={"detail": "Превышен размер загрузки Excel"}
            )(scope, receive, send)
        consumed = 0

        async def bounded_receive():
            nonlocal consumed
            message = await receive()
            if message["type"] == "http.request":
                consumed += len(message.get("body", b""))
                if consumed > limit:
                    raise HTTPException(413, "Превышен размер загрузки Excel")
            return message

        await self.app(scope, bounded_receive, send)
