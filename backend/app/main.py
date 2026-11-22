"""FastAPI application factory.

    uvicorn app.main:app --port 8000          (real providers, data in ./data)
    python -m app.serve                         (same, with sensible defaults)
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from nba_fantasy_shared.providers.base import CallRunner, RetryPolicy
from nba_fantasy_shared.providers.nba_api_provider import NbaApiProvider
from nba_fantasy_shared.providers.sleeper_provider import SleeperProvider
from nba_fantasy_shared.storage import JsonStore

from . import auth, calculations, config, notify
from .core.api import data, leagues, players
from .core.engine.draft_state import DraftError
from .core.services.app_state import AppState, PullAlreadyRunning
from .core.services.league_repository import LeagueNotFound
from .draft import api as draft
from .lockin import api as season

log = logging.getLogger(__name__)

API_VERSION = "0.1.0"
DEFAULT_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000", "http://127.0.0.1:3000"]
# Scripts only from this site (no inline or injected script can run even if some text slipped through unescaped), no
# framing (clickjacking), no Referer (the sign-in link carries its token in the URL). Images, fonts and stream lookups
# come from other sites (Sleeper / ESPN / CDNs, Google Fonts), so those stay open to https.
SECURITY_HEADERS = {
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
                               "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' https:; "
                               "media-src 'self' https:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
}
STATIC_DIR = Path(os.environ.get("STATIC_DIR", config.BACKEND_ROOT.parent / "frontend" / "dist"))


def build_default_state(data_dir=None) -> AppState:
    """Build the application state with the real providers (nba_api and Sleeper) and a JSON store in `data_dir` (default: the configured data directory)."""
    store = JsonStore(data_dir or config.DEFAULT_DATA_DIR)
    policy = RetryPolicy()
    stats = NbaApiProvider(CallRunner(policy))
    platform = SleeperProvider(store, CallRunner(policy))
    return AppState(store, stats, platform)


def create_app(state: AppState | None = None) -> FastAPI:
    """Build the FastAPI app: the CSRF guard and security headers, the auth and admin routers, the data (admin only) / players / leagues /
    draft / season / notify routers under /api behind sign-in (and league ownership, auth.current_user), the public calculators, a health check, error handlers (draft errors 400, unknown league 404, pull already running 409), and the built frontend at / when STATIC_DIR exists."""
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        """Create the real application state on startup when none was injected (tests inject one)."""
        if getattr(app.state, "app_state", None) is None:
            notify.load_env()
            app.state.app_state = build_default_state()
            log.info("AppState initialised from %s", app.state.app_state.store.root)
            notify.start_watcher(app.state.app_state)
        yield

    # The interactive API docs (/docs, /openapi.json) map every route for an attacker: local dev only, off on the https site.
    dev = not auth.app_url().startswith("https://")
    app = FastAPI(title="NBA Fantasy Tool API", version=API_VERSION, lifespan=lifespan,
                  docs_url="/docs" if dev else None, redoc_url="/redoc" if dev else None, openapi_url="/openapi.json" if dev else None)
    app.state.app_state = state

    @app.middleware("http")
    async def guard(request: Request, call_next):
        """Two protections on every request. (1) A request that changes something (POST / PUT / PATCH / DELETE) from a
        browser must come from this site: its Origin must be this host, APP_URL or a local dev server, so another site
        can't make a signed-in visitor's browser act for them (CSRF; the SameSite=Lax cookie already blocks most of it).
        Clients that send no Origin (curl, tests) aren't browsers and pass. (2) Security headers on every response
        (SECURITY_HEADERS); API answers are also never cached."""
        origin = request.headers.get("origin")
        if request.method not in ("GET", "HEAD", "OPTIONS") and origin is not None:
            allowed = {request.headers.get("host", ""), urlsplit(auth.app_url()).netloc} | {urlsplit(o).netloc for o in DEFAULT_ORIGINS}
            if urlsplit(origin).netloc not in allowed:
                return JSONResponse(status_code=403, content={"detail": "Cross-site request refused"})
        response = await call_next(request)
        response.headers.update(SECURITY_HEADERS)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    signed_in, admin, telegram = [Depends(auth.current_user)], [Depends(auth.require_admin)], [Depends(auth.require_telegram)]
    app.include_router(auth.router, prefix="/api")
    app.include_router(auth.admin_router, prefix="/api")
    app.include_router(data.router, prefix="/api", dependencies=admin)
    app.include_router(players.router, prefix="/api", dependencies=signed_in)
    app.include_router(leagues.router, prefix="/api", dependencies=signed_in)
    app.include_router(draft.router, prefix="/api", dependencies=signed_in)
    app.include_router(season.router, prefix="/api", dependencies=signed_in)
    app.include_router(notify.router, prefix="/api", dependencies=telegram)
    app.include_router(calculations.router, prefix="/api")

    @app.get("/api/health")
    def health() -> dict:
        """Health check: API version and the number of players loaded."""
        st = app.state.app_state
        return {"ok": True, "version": API_VERSION, "players": len(st.players) if st else 0}

    @app.exception_handler(DraftError)
    async def draft_error(_: Request, exc: DraftError) -> JSONResponse:
        """Turn a DraftError into a 400 response."""
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    @app.exception_handler(LeagueNotFound)
    async def league_not_found(_: Request, exc: LeagueNotFound) -> JSONResponse:
        """Turn an unknown league into a 404 response."""
        return JSONResponse(status_code=404, content={"detail": f"unknown league {exc}"})

    @app.exception_handler(PullAlreadyRunning)
    async def pull_running(_: Request, exc: PullAlreadyRunning) -> JSONResponse:
        """Turn a second concurrent pull into a 409 response."""
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    if STATIC_DIR.is_dir():
        app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")
    return app


app = create_app()
