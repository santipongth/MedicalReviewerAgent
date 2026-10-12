from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from app.api.auth import (
    ADMIN_COOKIE,
    ADMIN_COOKIE_PATH,
    admin_cookie_secure,
    admin_sessions,
    ip_hash_of,
    require_admin,
    require_csrf_header,
)
from app.api.deps import get_deps
from app.api.ratelimit import client_ip
from app.db.models import AdminUser
from app.runtime import AppDeps
from app.schemas.review import hash_ip
from app.services.admin_auth import (
    PASSWORD_MAX,
    AdminPrincipal,
    find_user,
    normalize_username,
    verify_password,
)
from app.services.admin_sessions import LoginThrottle
from app.services.audit import record
from app.services.mcp_client import McpConfigError, load_config
from app.services.review_service import Identity

router = APIRouter()

# Password checks (argon2id with the library defaults: tens of milliseconds of CPU and 64 MiB each) on this
# unauthenticated route queue for a few slots, so a burst of sign-ins cannot take every core, the memory or the default
# thread pool. Module-level is one per process, which is right: uvicorn runs one event loop per process (the unit tests
# give each test a fresh semaphore, since each test has its own loop).
VERIFY_CONCURRENCY = 4
VERIFY_SLOTS = asyncio.Semaphore(VERIFY_CONCURRENCY)


@router.post("/admin/mcp/reload", summary="Validate the external MCP server config",
             responses={401: {"description": "sign in or an admin API key required"},
                        403: {"description": "admin API key required"},
                        422: {"description": "invalid mcp_servers.json"}})
async def reload_mcp_servers(deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)):
    """Validate config/mcp_servers.json. Workers re-read the file automatically when it changes, so a valid
    file is live for the next review. Signed-in admins and admin API keys may call it."""
    try:
        config = load_config(deps.service.settings.mcp_servers_path)
    except McpConfigError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"servers": list(config["mcpServers"]), "path": deps.service.settings.mcp_servers_path}


class SignIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=PASSWORD_MAX)

    @field_validator("username")
    @classmethod
    def no_control_characters(cls, value: str) -> str:
        """NUL and the other control characters (U+0000-U+001F, U+007F) are never in a username; Postgres raises on a
        NUL in a string literal, so it must be refused here, before the lookup."""
        if any(ord(ch) < 0x20 or ord(ch) == 0x7F for ch in value):
            raise ValueError("username must not contain control characters")
        return value


async def _record_sign_in(deps: AppDeps, user_id: uuid.UUID, verified_hash: str, new_hash: str | None,
                          ip_hash: str) -> AdminPrincipal | None:
    """The success write, in its own short transaction. The account is read again, so one that was disabled, removed
    or given a new password while its password was being checked does not get in (None)."""
    async with deps.session_factory() as session, session.begin():
        user = await session.get(AdminUser, user_id)
        if user is None or user.disabled_at is not None or user.password_hash != verified_hash:
            return None
        if new_hash:
            user.password_hash = new_hash  # the stored hash used older parameters
        user.last_login_at = datetime.now(UTC)
        principal = AdminPrincipal(kind="user", id=user.id, label=user.username)
        await record(session, principal, "admin.login", target_type="admin", target_id=user.id, ip_hash=ip_hash)
    return principal


@router.post("/admin/session", status_code=204)
async def sign_in(body: SignIn, request: Request, deps: AppDeps = Depends(get_deps)) -> Response:
    """Sign in to the admin console: sets the mra_admin session cookie. Each attempt is counted before the password is
    checked; after admin_login_max_failures failures the username and the address are locked for
    admin_lockout_seconds (429 with Retry-After)."""
    require_csrf_header(request)
    settings = deps.service.settings
    username = normalize_username(body.username)
    ip_hash = hash_ip(client_ip(request), settings.ip_hash_salt)
    throttle = LoginThrottle(deps.redis, settings.admin_login_max_failures, settings.admin_lockout_seconds)
    wait, last_allowed = await throttle.begin_attempt(username, ip_hash)  # counts this attempt before any lookup
    if wait is not None:
        return JSONResponse(status_code=429, content={"detail": "too many failed sign-ins; try again later"},
                            headers={"Retry-After": str(wait)})
    # A short read, closed before the password check: the slow argon2 step holds no connection and no transaction.
    async with deps.session_factory() as session:
        user = await find_user(session, username)
        known_id = user.id if user is not None else None
        stored = user.password_hash if user is not None and user.disabled_at is None else None
    async with VERIFY_SLOTS:
        # an unknown or disabled admin is checked against a dummy hash, so the answer takes as long either way
        ok, new_hash = await verify_password(stored, body.password)
    signed_in = await _record_sign_in(deps, known_id, stored, new_hash, ip_hash) if ok else None
    if signed_in is None:
        if last_allowed:
            async with deps.session_factory() as session, session.begin():
                await record(session, AdminPrincipal(kind="user", id=known_id, label=username[:64]), "admin.lockout",
                             target_type="admin", target_id=username, ip_hash=ip_hash)
        raise HTTPException(status_code=401, detail="invalid username or password")
    await throttle.succeeded(username, ip_hash)
    token = await admin_sessions(deps).create(signed_in.id, signed_in.label)
    response = Response(status_code=204)
    response.set_cookie(ADMIN_COOKIE, token, max_age=settings.admin_session_ttl_seconds, path=ADMIN_COOKIE_PATH,
                        httponly=True, samesite="strict", secure=admin_cookie_secure(request, settings))
    return response


@router.delete("/admin/session", status_code=204)
async def sign_out(request: Request, deps: AppDeps = Depends(get_deps),
                   identity: Identity = Depends(require_admin)) -> Response:
    if identity.admin.kind == "user":
        await admin_sessions(deps).end(request.cookies.get(ADMIN_COOKIE, ""))
        async with deps.session_factory() as session, session.begin():
            await record(session, identity.admin, "admin.logout", target_type="admin", target_id=identity.admin.id,
                         ip_hash=ip_hash_of(identity, deps))
    response = Response(status_code=204)
    response.delete_cookie(ADMIN_COOKIE, path=ADMIN_COOKIE_PATH, httponly=True, samesite="strict",
                           secure=admin_cookie_secure(request, deps.service.settings))
    return response


@router.get("/admin/me")
async def me(identity: Identity = Depends(require_admin)) -> dict:
    return {"kind": identity.admin.kind, "label": identity.admin.label}
