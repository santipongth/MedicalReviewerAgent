"""Admin console: the dashboard (Plan 23a)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.auth import require_admin
from app.api.deps import get_deps
from app.runtime import AppDeps
from app.services.admin_dashboard import build_dashboard
from app.services.review_service import Identity

router = APIRouter()


@router.get("/admin/dashboard")
async def admin_dashboard(days: int = Query(30, ge=1, le=90), deps: AppDeps = Depends(get_deps),
                          _: Identity = Depends(require_admin)) -> dict:
    return await build_dashboard(deps.session_factory, deps.service.capacity, await deps.service.effective(), days=days)
