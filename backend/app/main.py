"""FastAPI application factory."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import routes
from .api.deps import Services
from .config import Settings, get_settings
from .db import Database
from .services.events import EventBus
from .services.jobs import JobManager
from .services.library import Library

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("haul")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    settings.ensure_dirs()
    routes.DEFAULT_PREFS["max_concurrent"] = settings.max_concurrent_downloads

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        db = Database(settings.db_path())
        bus = EventBus()
        bus.bind(asyncio.get_running_loop())
        library = Library(db, settings.resolved_media_dir(), settings.thumbs_dir())
        jobs = JobManager(db, library, bus, temp_root=settings.resolved_temp_dir(),
                          default_concurrency=settings.max_concurrent_downloads,
                          max_auto_retries=settings.max_auto_retries)
        app.state.services = Services(settings, db, bus, library, jobs)
        await asyncio.to_thread(library.rescan)
        jobs.cleanup_orphan_temp()
        await jobs.start()
        log.info("Haul ready. Media folder: %s", library.media_root)
        try:
            yield
        finally:
            await jobs.stop()
            db.close()

    app = FastAPI(title="Haul API", version="1.0.0", lifespan=lifespan,
                  docs_url="/api/docs", openapi_url="/api/openapi.json", redoc_url=None)
    app.add_middleware(GZipMiddleware, minimum_size=1024)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        return response

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse({"detail": "Internal server error."}, status_code=500)

    app.include_router(routes.router)

    dist = settings.frontend_dist
    if dist and Path(dist).is_dir():
        dist = Path(dist).resolve()
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            if path.startswith("api/"):
                return JSONResponse({"detail": "Not found."}, status_code=404)
            candidate = (dist / path).resolve()
            if path and dist in candidate.parents and candidate.is_file():
                headers = {"Cache-Control": "no-cache"} if candidate.name in ("sw.js", "manifest.webmanifest") else None
                return FileResponse(candidate, headers=headers)
            return FileResponse(dist / "index.html", headers={"Cache-Control": "no-cache"})

    return app


app = create_app()
