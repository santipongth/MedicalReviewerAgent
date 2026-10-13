from __future__ import annotations

import json
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from app import __version__
from app.api import (
    admin,
    admin_dashboard,
    admin_harness,
    admin_keys,
    admin_models,
    admin_reviews,
    admin_runtime,
    events,
    health,
    papers,
    reviews,
    status,
)
from app.api.ratelimit import limiter
from app.config import Settings, get_settings
from app.logging import configure_logging
from app.mcp.server import build_mcp, transport_security
from app.runtime import AppDeps
from app.schemas.review import ReviewOptions

__all__ = ["AppDeps", "app", "create_app"]


class McpPathMiddleware:
    """Serve /mcp as /mcp/ (the documented endpoint) instead of answering POST /mcp with a 307 redirect."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["path"] == "/mcp":
            scope = {**scope, "path": "/mcp/", "raw_path": b"/mcp/"}
        await self.app(scope, receive, send)


EXTRA_KEY_TOKEN = "<extra>"


def _safe_loc(error: dict) -> list:
    """An error's location, with an unexpected key replaced: for extra_forbidden the last element is the submitted key,
    which is unbounded text of the sender's choosing."""
    loc = list(error["loc"])
    if error["type"] == "extra_forbidden" and loc:
        loc[-1] = EXTRA_KEY_TOKEN
    return loc


async def admin_validation_errors(request: Request, exc: RequestValidationError) -> Response:
    """The admin console's 422 never echoes the request back (FastAPI's default does): a lone surrogate in a JSON
    string makes the echoed error unencodable, and a deeply nested body overflows the encoder; both would be a 500."""
    if not request.url.path.startswith("/api/v1/admin"):
        return await request_validation_exception_handler(request, exc)
    errors = [{"type": e["type"], "loc": _safe_loc(e), "msg": e["msg"]} for e in exc.errors()]
    return Response(json.dumps({"detail": errors}), status_code=422, media_type="application/json")


_PAPERS = (ReviewOptions.bound("max_papers", "ge"), ReviewOptions.bound("max_papers", "le"),
           ReviewOptions.model_fields["max_papers"].default)
API_DESCRIPTION = f"""Automated rapid literature reviews of published medical research.

Submit a topic (POST /api/v1/reviews), follow it live (GET /api/v1/reviews/{{id}}/events, Server-Sent Events) and read
or download the result. The agent refines the question, screens about {ReviewOptions.model_fields["candidate_limit"].default}
candidate papers that have abstracts, analyses the abstracts of the {_PAPERS[0]}-{_PAPERS[1]} you choose (default
{_PAPERS[2]}; no full-text fetching) and checks every number against the abstract; numbers it
cannot verify are left empty, never estimated.

Limits and capacity are published at GET /api/v1/status. Refusals always say why and when to retry: 429 (rate limit,
key quota, too many event streams) and 503 (queue full, daily capacity, verification unavailable) carry a
Retry-After header; 503 bodies also carry a reason. API keys (X-API-Key or Authorization: Bearer) raise limits and
unlock webhooks and cancellation. The same service is available to AI agents over MCP at /mcp.

Full reference: docs/api.md in the repository. Results are an automated review, not medical advice."""


def create_app(settings: Settings | None = None, deps: AppDeps | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level)

    def complete(d: AppDeps) -> AppDeps:
        from app.services.ratelimits import RateLimits
        from app.services.review_service import ReviewService

        d.limits = d.limits or RateLimits(settings.ratelimit_storage_uri)
        if d.runtime is None:
            from app.services.runtime_config import RuntimeConfig
            d.runtime = RuntimeConfig(settings, d.session_factory, d.redis)
        if d.service is None:
            from app.services.capacity import Capacity
            from app.services.llm_store import active_version_id
            d.service = ReviewService(d.session_factory, d.queue, d.event_sink, settings, d.limits,
                                      capacity=Capacity(d.redis, settings),
                                      llm_version=lambda: active_version_id(d.session_factory, d.redis),
                                      runtime=d.runtime)
        return d

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async with app.state.mcp.session_manager.run():
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
        version=__version__,
        description=API_DESCRIPTION,
        lifespan=lifespan,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )
    app.state.settings = settings
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.add_exception_handler(RequestValidationError, admin_validation_errors)
    app.add_middleware(SlowAPIMiddleware)
    app.add_middleware(McpPathMiddleware)
    if deps is not None:
        app.state.deps = complete(deps)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["*", "Mcp-Protocol-Version", "Mcp-Session-Id", "Authorization", "X-API-Key"],
        expose_headers=["Mcp-Session-Id", "Retry-After"],
    )
    app.include_router(health.router, prefix="/api/v1", tags=["system"])
    app.include_router(status.router, prefix="/api/v1", tags=["system"])
    app.include_router(events.router, prefix="/api/v1", tags=["reviews"])
    app.include_router(reviews.router, prefix="/api/v1", tags=["reviews"])
    app.include_router(papers.router, prefix="/api/v1", tags=["papers"])
    # Admin console routes (Plan 23a) are documented in docs/api.md, not in the public OpenAPI.
    app.include_router(admin.router, prefix="/api/v1", tags=["admin"], include_in_schema=False)
    app.include_router(admin_reviews.router, prefix="/api/v1", tags=["admin"], include_in_schema=False)
    app.include_router(admin_keys.router, prefix="/api/v1", tags=["admin"], include_in_schema=False)
    app.include_router(admin_dashboard.router, prefix="/api/v1", tags=["admin"], include_in_schema=False)
    app.include_router(admin_models.router, prefix="/api/v1", tags=["admin"], include_in_schema=False)
    app.include_router(admin_runtime.router, prefix="/api/v1", tags=["admin"], include_in_schema=False)
    app.include_router(admin_harness.router, prefix="/api/v1", tags=["admin"], include_in_schema=False)
    mcp = build_mcp(lambda: app.state.deps, settings)
    app.state.mcp = mcp
    app.mount("/mcp", mcp.streamable_http_app(stateless_http=True, json_response=True, streamable_http_path="/",
                                              transport_security=transport_security(settings)))
    return app


app = create_app()
