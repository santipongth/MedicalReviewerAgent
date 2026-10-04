from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from sqlalchemy import text

router = APIRouter()


@router.get("/healthz", summary="Liveness and dependencies",
            responses={503: {"description": "database or Redis unreachable: {status: degraded, db, redis}"}})
async def healthz(request: Request) -> JSONResponse:
    """{status, db, redis}; 503 when the database or Redis is unreachable."""
    deps = getattr(request.app.state, "deps", None)
    db_ok: bool | None = None
    redis_ok: bool | None = None
    if deps is not None:
        try:
            async with deps.session_factory() as session:
                await session.execute(text("SELECT 1"))
            db_ok = True
        except Exception:  # noqa: BLE001 - health must never raise
            db_ok = False
        try:
            redis_ok = bool(await deps.redis.ping())
        except Exception:  # noqa: BLE001
            redis_ok = False
    healthy = db_ok is not False and redis_ok is not False
    return JSONResponse(
        status_code=200 if healthy else 503,
        content={"status": "ok" if healthy else "degraded", "db": db_ok, "redis": redis_ok},
    )
