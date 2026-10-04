"""Caller identity: client IP plus an optional API key (X-API-Key or Authorization: Bearer)."""
from __future__ import annotations

from fastapi import Depends, HTTPException, Request

from app.api.deps import get_deps
from app.api.ratelimit import client_ip
from app.runtime import AppDeps
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


async def require_admin(identity: Identity = Depends(require_key)) -> Identity:
    if not identity.api_key.is_admin:
        raise HTTPException(status_code=403, detail="an admin API key is required")
    return identity
