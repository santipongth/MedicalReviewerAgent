"""External MCP servers the agent may consult (operator-configured in config/mcp_servers.json).

Format: {"mcpServers": {"<name>": {"url": "https://.../mcp"} | {"command": "...", "args": [...]}}}.
The file is re-read whenever its modification time changes, so every worker picks up edits without a restart."""
from __future__ import annotations

import json
import warnings
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

with warnings.catch_warnings():
    warnings.simplefilter("ignore")  # langchain.mcp is marked beta
    from langchain.mcp import MCPAdapter


class McpConfigError(ValueError):
    pass


def load_config(path: str | Path) -> dict[str, Any]:
    p = Path(path)
    if not p.exists():
        return {"mcpServers": {}}
    try:
        data = json.loads(p.read_text(encoding="utf-8") or "{}")
    except json.JSONDecodeError as exc:
        raise McpConfigError(f"invalid JSON in {p.name}: {exc}") from exc
    servers = data.get("mcpServers", {}) if isinstance(data, dict) else None
    if not isinstance(servers, dict):
        raise McpConfigError('expected {"mcpServers": {"<name>": {...}}}')
    for name, spec in servers.items():
        if not isinstance(spec, dict) or not ("url" in spec or "command" in spec):
            raise McpConfigError(f"server '{name}' needs a 'url' (HTTP) or a 'command' (stdio)")
    return {"mcpServers": servers}


class McpRegistry:
    def __init__(self, path: str | Path | None, *, target: Any = None) -> None:
        self.path = Path(path) if path else None
        self.target = target  # an in-process server or client (tests); overrides the file
        self._mtime: float | None = None
        self._config: dict[str, Any] = {"mcpServers": {}}

    def config(self) -> dict[str, Any]:
        if self.path is None:
            return self._config
        mtime = self.path.stat().st_mtime if self.path.exists() else None
        if mtime != self._mtime:
            self._config = load_config(self.path)
            self._mtime = mtime
        return self._config

    def server_names(self) -> list[str]:
        return list(self.config()["mcpServers"])

    @property
    def enabled(self) -> bool:
        if self.target is not None:
            return True
        try:
            return bool(self.config()["mcpServers"])
        except McpConfigError:
            return False

    @asynccontextmanager
    async def tools(self):
        """Open the MCP session(s) and yield LangChain tools; the session stays open inside the block."""
        async with MCPAdapter(self.target if self.target is not None else self.config()) as adapter:
            yield await adapter.list_tools()
