from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import get_deps
from app.runtime import AppDeps

router = APIRouter()


@router.get("/status", summary="Service status and public limits")
async def service_status(deps: AppDeps = Depends(get_deps)) -> dict:
    """Whether new reviews are accepted right now (and if not, why and when to retry), the queue depth, and the
    limits every caller must respect. The web app and the docs read their numbers from here."""
    return await deps.service.status()
