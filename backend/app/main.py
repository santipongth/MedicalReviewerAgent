from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app.api import events, health, reviews
from app.api.ratelimit import limiter
from app.config import Settings, get_settings
from app.logging import configure_logging
from app.runtime import AppDeps

__all__ = ["AppDeps", "app", "create_app"]


def create_app(settings: Settings | None = None, deps: AppDeps | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    def complete(d: AppDeps) -> AppDeps:
        from app.services.ratelimits import RateLimits
        from app.services.review_service import ReviewService

        d.limits = d.limits or RateLimits(settings.ratelimit_storage_uri)
        d.service = d.service or ReviewService(d.session_factory, d.queue, d.event_sink, settings, d.limits)
        return d

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if deps is not None:
            app.state.deps = complete(deps)
            yield
            return
        from app.infra import build_runtime_deps, close_runtime_deps

        runtime = complete(await build_runtime_deps(settings))
        app.state.deps = runtime
        try:
            yield
        finally:
            await close_runtime_deps(runtime)

    app = FastAPI(
        title="Medical Reviewer Agent API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )
    app.state.settings = settings
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_middleware(SlowAPIMiddleware)
    if deps is not None:
        app.state.deps = complete(deps)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["Mcp-Session-Id"],
    )
    app.include_router(health.router, prefix="/api/v1", tags=["system"])
    app.include_router(events.router, prefix="/api/v1", tags=["reviews"])
    app.include_router(reviews.router, prefix="/api/v1", tags=["reviews"])
    return app


app = create_app()
