"""FastAPI application factory."""

from __future__ import annotations

import logging
import logging.handlers
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from ..ai.providers import ProviderError
from ..config import get_config
from ..db import get_engine
from ..jobs.handlers import register_all
from ..jobs.queue import get_manager
from ..media.ffprobe import ProbeError
from ..transcribe.engines import TranscriptionUnavailable
from . import routes_edits, routes_projects, routes_render, routes_system

log = logging.getLogger("clipforge")

ALLOWED_HOSTS = {"127.0.0.1", "localhost", "[::1]", "testserver"}
CLIENT_HEADER = "x-clipforge-client"


def setup_logging() -> None:
    cfg = get_config()
    root = logging.getLogger()
    if any(getattr(h, "_clipforge", False) for h in root.handlers):
        return
    root.setLevel(cfg.log_level)
    fh = logging.handlers.RotatingFileHandler(cfg.logs_dir / "clipforge.log", maxBytes=5_000_000, backupCount=3)
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    fh._clipforge = True  # type: ignore[attr-defined]
    sh = logging.StreamHandler()
    sh.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
    sh._clipforge = True  # type: ignore[attr-defined]
    root.addHandler(fh)
    root.addHandler(sh)


class LocalOnlyMiddleware(BaseHTTPMiddleware):
    """Defend the localhost API against DNS rebinding and cross-site requests.

    * Host must be loopback (blocks DNS-rebinding attacks).
    * State-changing requests must carry the X-ClipForge-Client header. Browsers
      only send custom headers cross-origin after a CORS preflight, which our
      CORS policy rejects for foreign origins.
    """

    async def dispatch(self, request: Request, call_next):
        host = (request.headers.get("host") or "").rsplit(":", 1)[0] if not (request.headers.get("host") or "").startswith("[") else "[::1]"
        if host not in ALLOWED_HOSTS:
            return JSONResponse({"detail": "Host not allowed"}, status_code=403)
        if request.method not in ("GET", "HEAD", "OPTIONS") and request.url.path.startswith("/api/"):
            if request.headers.get(CLIENT_HEADER) != "1":
                return JSONResponse({"detail": "Missing client header"}, status_code=403)
        return await call_next(request)


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()
    get_engine()
    mgr = get_manager()
    register_all(mgr)
    if app.state.start_workers:
        mgr.start()
    log.info("ClipForge Studio backend ready at http://%s:%s (data: %s)", get_config().host, get_config().port, get_config().data_dir)
    yield
    mgr.stop()


def create_app(start_workers: bool = True) -> FastAPI:
    cfg = get_config()
    app = FastAPI(title="ClipForge Studio", version="0.1.0", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.state.start_workers = start_workers
    app.add_middleware(LocalOnlyMiddleware)
    app.add_middleware(CORSMiddleware, allow_origins=cfg.cors_origins, allow_methods=["*"], allow_headers=["*"], allow_credentials=False)

    @app.exception_handler(ProbeError)
    async def _probe_err(_req, exc: ProbeError):
        return JSONResponse({"detail": str(exc), "hint": exc.hint}, status_code=422)

    @app.exception_handler(TranscriptionUnavailable)
    async def _tr_err(_req, exc: TranscriptionUnavailable):
        return JSONResponse({"detail": str(exc), "hint": exc.hint}, status_code=503)

    @app.exception_handler(ProviderError)
    async def _prov_err(_req, exc: ProviderError):
        return JSONResponse({"detail": str(exc), "hint": exc.hint}, status_code=400)

    @app.exception_handler(ValueError)
    async def _val_err(_req, exc: ValueError):
        return JSONResponse({"detail": str(exc)}, status_code=400)

    @app.exception_handler(FileNotFoundError)
    async def _fnf(_req, exc: FileNotFoundError):
        return JSONResponse({"detail": str(exc), "hint": "The file may have been moved or deleted. Use Relink."}, status_code=404)

    for r in (routes_projects.router, routes_edits.router, routes_render.router, routes_system.router):
        app.include_router(r, prefix="/api")

    dist: Path = cfg.frontend_dist
    if cfg.serve_frontend and dist.exists():
        index = dist / "index.html"

        @app.get("/{full_path:path}", include_in_schema=False)
        async def spa(full_path: str):
            if full_path.startswith("api/"):
                return JSONResponse({"detail": "Not found"}, status_code=404)
            target = (dist / full_path).resolve()
            if full_path and target.is_file() and dist.resolve() in target.parents:
                return FileResponse(target)
            return FileResponse(index)

    return app
