from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.api.auth import require_admin
from app.api.deps import get_deps
from app.runtime import AppDeps
from app.services.mcp_client import McpConfigError, load_config
from app.services.review_service import Identity

router = APIRouter()


@router.post("/admin/mcp/reload")
async def reload_mcp_servers(deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)):
    """Validate config/mcp_servers.json. Workers re-read the file automatically when it changes, so a valid
    file is live for the next review."""
    try:
        config = load_config(deps.service.settings.mcp_servers_path)
    except McpConfigError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"servers": list(config["mcpServers"]), "path": deps.service.settings.mcp_servers_path}
