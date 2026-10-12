"""Caller identity: client IP plus an optional API key (X-API-Key or Authorization: Bearer)."""
from __future__ import annotations

import uuid
from dataclasses import replace

from fastapi import Depends, HTTPException, Request

from app.api.deps import get_deps
from app.api.ratelimit import client_ip
from app.db.models import AdminUser
from app.runtime import AppDeps
from app.schemas.review import hash_ip
from app.services.admin_auth import AdminPrincipal
from app.services.admin_sessions import AdminSessions
from app.services.api_keys import resolve_key
from app.services.review_service import Identity


def presented_key(headers) -> str | None:
    key = headers.get("x-api-key")
    if not key:
        auth = headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            key = auth[7:]
    return key.strip() or None if key else None


async def identity_from(headers, ip: str, deps: AppDeps) -> Identity:
    """A key that is presented but invalid is an error, never a silent fallback to anonymous."""
    raw = presented_key(headers)
    if raw is None:
        return Identity(ip=ip)
    async with deps.session_factory() as session:
        info = await resolve_key(session, raw)
    if info is None:
        raise HTTPException(status_code=401, detail="invalid or revoked API key",
                            headers={"WWW-Authenticate": "Bearer"})
    return Identity(ip=ip, api_key=info)


async def get_identity(request: Request, deps: AppDeps = Depends(get_deps)) -> Identity:
    return await identity_from(request.headers, client_ip(request), deps)


async def require_key(identity: Identity = Depends(get_identity)) -> Identity:
    if identity.api_key is None:
        raise HTTPException(status_code=401, detail="an API key is required", headers={"WWW-Authenticate": "Bearer"})
    return identity


ADMIN_COOKIE = "mra_admin"
ADMIN_COOKIE_PATH = "/api/v1/admin"
CSRF_HEADER = "x-mra-admin"
WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


def require_csrf_header(request: Request) -> None:
    """Cookie-authenticated writes (and sign-in) must carry X-MRA-Admin: 1, which a cross-site form cannot send."""
    if request.headers.get(CSRF_HEADER) != "1":
        raise HTTPException(status_code=403, detail="the X-MRA-Admin: 1 header is required")


def admin_sessions(deps: AppDeps) -> AdminSessions:
    return AdminSessions(deps.redis, deps.service.settings.admin_session_ttl_seconds)


def ip_hash_of(identity: Identity, deps: AppDeps) -> str:
    return hash_ip(identity.ip, deps.service.settings.ip_hash_salt)


async def admin_from_cookie(request: Request, deps: AppDeps) -> AdminPrincipal:
    unauthorized = HTTPException(status_code=401, detail="sign in required")
    token = request.cookies.get(ADMIN_COOKIE, "")
    sessions = admin_sessions(deps)
    data = await sessions.load(token)
    if data is None:
        raise unauthorized
    async with deps.session_factory() as session:
        user = await session.get(AdminUser, uuid.UUID(data["user_id"]))
    if user is None or user.disabled_at is not None:
        await sessions.end(token)
        raise unauthorized
    return AdminPrincipal(kind="user", id=user.id, label=user.username)


async def require_admin(request: Request, deps: AppDeps = Depends(get_deps)) -> Identity:
    """An admin API key (scripts, as before) or the admin console's session cookie. A presented key decides on its
    own: an invalid key is 401 and a non-admin key 403, never a fallback to the cookie."""
    ip = client_ip(request)
    if presented_key(request.headers) is not None:
        identity = await identity_from(request.headers, ip, deps)
        key = identity.api_key
        if not key.is_admin:
            raise HTTPException(status_code=403, detail="an admin API key is required")
        return replace(identity, admin=AdminPrincipal(kind="key", id=key.id, label=key.key_prefix or key.name[:12]))
    principal = await admin_from_cookie(request, deps)
    if request.method in WRITE_METHODS:
        require_csrf_header(request)
    return Identity(ip=ip, admin=principal)
