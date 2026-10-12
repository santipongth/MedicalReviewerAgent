"""The settings and glossary in force (Plan 23c). API processes ask RuntimeConfig: it reads both Redis mirrors (the
DB on a miss) at most every RUNTIME_TTL_SECONDS, and keeps the last values it knew while Redis and the DB are both
unreachable (env values until it knows any), so the hot path never fails on them. Workers, the harness job and the
eval CLI call load_runtime, which reads the DB."""
from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from dataclasses import dataclass

from app.config import Settings
from app.harness.glossary import SEED_GLOSSARY, ActiveGlossary
from app.logging import get_logger
from app.services.config_store import newest, read_active
from app.services.glossary_store import GLOSSARY_KIND, active_glossary_from
from app.services.runtime_settings import SETTINGS_KIND, apply_overrides

log = get_logger(__name__)
RUNTIME_TTL_SECONDS = 5.0


@dataclass(frozen=True)
class Runtime:
    settings: Settings
    settings_version: str  # "env" while no settings version exists, else the version as text
    glossary: ActiveGlossary


async def load_runtime(session_factory, base: Settings) -> Runtime:
    async with session_factory() as session:
        settings_row = await newest(session, SETTINGS_KIND)
        glossary_row = await newest(session, GLOSSARY_KIND)
    settings = apply_overrides(base, (settings_row.document or {}).get("values") or {}) if settings_row else base
    glossary = active_glossary_from(glossary_row) if glossary_row else SEED_GLOSSARY
    return Runtime(settings, str(settings_row.version) if settings_row else "env", glossary)


class RuntimeConfig:
    def __init__(self, base: Settings, session_factory, redis, *, ttl: float = RUNTIME_TTL_SECONDS,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.base, self.session_factory, self.redis = base, session_factory, redis
        self.ttl, self.clock = ttl, clock
        self._settings: Settings = base
        self._settings_version: int | None = None
        self._glossary = "file"
        self._expires = float("-inf")
        self._lock = asyncio.Lock()

    async def _fresh(self) -> None:
        if self.clock() < self._expires:
            return
        async with self._lock:
            if self.clock() < self._expires:
                return
            try:
                settings = await read_active(self.session_factory, self.redis, SETTINGS_KIND)
                glossary = await read_active(self.session_factory, self.redis, GLOSSARY_KIND)
            except Exception as exc:  # noqa: BLE001 - keep the last values (env until any are known)
                log.warning("runtime_config_unavailable", error=type(exc).__name__)
            else:
                self._settings = apply_overrides(self.base, settings.mirror.get("values") or {})
                self._settings_version = settings.version
                self._glossary = "file" if glossary.version is None else str(glossary.version)
            self._expires = self.clock() + self.ttl

    async def settings(self) -> Settings:
        await self._fresh()
        return self._settings

    async def settings_version(self) -> int | None:
        await self._fresh()
        return self._settings_version

    async def glossary_label(self) -> str:
        await self._fresh()
        return self._glossary

    def invalidate(self) -> None:
        """The saving process reads again at once; other processes follow within the TTL."""
        self._expires = float("-inf")
