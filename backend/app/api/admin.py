from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator

from app.api.auth import (
    ADMIN_COOKIE,
    ADMIN_COOKIE_PATH,
    admin_sessions,
    ip_hash_of,
    require_admin,
    require_csrf_header,
)
from app.api.deps import get_deps
from app.api.ratelimit import client_ip
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
    signed_in: AdminPrincipal | None = None
    async with deps.session_factory() as session, session.begin():
        user = await find_user(session, username)
        known_id = user.id if user is not None else None
        active = user is not None and user.disabled_at is None
        ok, new_hash = await verify_password(user.password_hash if active else None, body.password)
        if ok:
            if new_hash:
                user.password_hash = new_hash
            user.last_login_at = datetime.now(UTC)
            signed_in = AdminPrincipal(kind="user", id=user.id, label=user.username)
            await record(session, signed_in, "admin.login", target_type="admin", target_id=user.id, ip_hash=ip_hash)
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
                        httponly=True, samesite="strict", secure=settings.admin_cookie_is_secure)
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
                           secure=deps.service.settings.admin_cookie_is_secure)
    return response


@router.get("/admin/me")
async def me(identity: Identity = Depends(require_admin)) -> dict:
    return {"kind": identity.admin.kind, "label": identity.admin.label}
