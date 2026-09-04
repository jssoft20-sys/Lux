"""FastAPI application factory: security headers, routers, static admin panel."""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from . import __version__
from .api import admin_routes, auth_routes, public_routes, webhook_routes
from .config import get_settings

logger = logging.getLogger("onoipay")

CSP = (
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
    "font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; "
    "manifest-src 'self'; worker-src 'self'"
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=(), payment=()"
        response.headers["X-Robots-Tag"] = "noindex, nofollow, noarchive"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        if request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").lower() == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        if "/api/" in path:
            response.headers["Cache-Control"] = response.headers.get("Cache-Control", "no-store")
        else:
            response.headers.setdefault("Content-Security-Policy", CSP)
        return response


def create_app() -> FastAPI:
    settings = get_settings()
    base = settings.base_path
    app = FastAPI(title="OnoiPay", version=__version__, docs_url=None, redoc_url=None, openapi_url=None)
    app.add_middleware(SecurityHeadersMiddleware)

    prefixed = FastAPI(title="OnoiPay API", docs_url=None, redoc_url=None, openapi_url=None)
    prefixed.include_router(auth_routes.router)
    prefixed.include_router(admin_routes.router)
    prefixed.include_router(webhook_routes.router)
    prefixed.include_router(public_routes.router)

    frontend = Path(settings.frontend_dir)
    if frontend.exists():
        prefixed.mount("/static", StaticFiles(directory=frontend / "static"), name="static")
        prefixed.mount("/brand", StaticFiles(directory=frontend / "brand"), name="brand")
    uploads = settings.uploads_dir()
    prefixed.mount("/uploads", StaticFiles(directory=uploads), name="uploads")

    @prefixed.exception_handler(HTTPException)
    async def _http_error(request: Request, exc: HTTPException):
        return JSONResponse({"ok": False, "error": exc.detail}, status_code=exc.status_code, headers=getattr(exc, "headers", None))

    @prefixed.get("/sw.js", include_in_schema=False)
    async def service_worker():
        path = frontend / "sw.js"
        if not path.exists():
            raise HTTPException(404)
        return FileResponse(str(path), media_type="application/javascript", headers={"Cache-Control": "no-cache", "Service-Worker-Allowed": (base or "") + "/"})

    @prefixed.get("/manifest.webmanifest", include_in_schema=False)
    async def manifest():
        path = frontend / "manifest.webmanifest"
        if not path.exists():
            raise HTTPException(404)
        return FileResponse(str(path), media_type="application/manifest+json")

    @prefixed.get("/", include_in_schema=False)
    @prefixed.get("/{path:path}", include_in_schema=False)
    async def spa(path: str = ""):
        if path.startswith("api/") or path.startswith("static/") or path.startswith("uploads/"):
            raise HTTPException(404)
        index = frontend / "index.html"
        if not index.exists():
            return JSONResponse({"ok": False, "error": "frontend not installed"}, status_code=404)
        return FileResponse(str(index), headers={"Cache-Control": "no-store"})

    @app.get("/healthz", include_in_schema=False)
    async def healthz():
        from .db import ping

        ok = ping()
        return JSONResponse({"ok": ok, "service": "onoipay", "version": __version__}, status_code=200 if ok else 503)

    if base:
        app.mount(base, prefixed)

        @app.get("/", include_in_schema=False)
        async def root():
            return JSONResponse({"ok": True, "service": "onoipay", "admin": base + "/"})
    else:
        app.mount("/", prefixed)
    return app


app = create_app() if __name__ != "__main__" else None
