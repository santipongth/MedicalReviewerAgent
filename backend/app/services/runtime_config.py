"""The settings, glossary and (Plan 23d) search sources in force (Plan 23c). API processes ask RuntimeConfig: it reads
the three Redis mirrors (the DB on a miss) at most every RUNTIME_TTL_SECONDS, and keeps the last values it knew while Redis and the DB are both
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
from app.services.sources import ActiveSources, effective_sources
from app.services.sources_store import SOURCES_KIND

log = get_logger(__name__)
RUNTIME_TTL_SECONDS = 5.0
RUNTIME_READ_TIMEOUT_SECONDS = 2.0  # the app sets no Redis or DB client timeouts: one hung read must not stall every caller


@dataclass(frozen=True)
class Runtime:
    settings: Settings
    settings_version: str  # "env" while no settings version exists, else the version as text
    glossary: ActiveGlossary
    sources: ActiveSources  # Plan 23d; .label is "env" while no sources version exists


async def load_runtime(session_factory, base: Settings) -> Runtime:
    async with session_factory() as session:
        settings_row = await newest(session, SETTINGS_KIND)
        glossary_row = await newest(session, GLOSSARY_KIND)
        sources_row = await newest(session, SOURCES_KIND)
    settings = apply_overrides(base, (settings_row.document or {}).get("values") or {}) if settings_row else base
    glossary = active_glossary_from(glossary_row) if glossary_row else SEED_GLOSSARY
    sources = (effective_sources(base, (sources_row.document or {}).get("sources") or {}, sources_row.version)
               if sources_row else effective_sources(base, {}))
    return Runtime(settings, str(settings_row.version) if settings_row else "env", glossary, sources)


class RuntimeConfig:
    def __init__(self, base: Settings, session_factory, redis, *, ttl: float = RUNTIME_TTL_SECONDS,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.base, self.session_factory, self.redis = base, session_factory, redis
        self.ttl, self.clock = ttl, clock
        self._settings: Settings = base
        self._settings_version: int | None = None
        self._glossary = "file"
        self._sources: ActiveSources = effective_sources(base, {})
        self._expires = float("-inf")
        self._lock = asyncio.Lock()
        self._generation = 0  # bumped by invalidate(): a refresh that began earlier must not store what it read

    async def _fresh(self) -> None:
        if self.clock() < self._expires:
            return
        async with self._lock:
            if self.clock() < self._expires:
                return
            generation = self._generation
            loaded: tuple[Settings, int | None, str, ActiveSources] | None = None
            try:
                async with asyncio.timeout(RUNTIME_READ_TIMEOUT_SECONDS):  # a timeout is a failed read (TimeoutError)
                    settings = await read_active(self.session_factory, self.redis, SETTINGS_KIND)
                    glossary = await read_active(self.session_factory, self.redis, GLOSSARY_KIND)
                    sources = await read_active(self.session_factory, self.redis, SOURCES_KIND)
                    loaded = (apply_overrides(self.base, settings.mirror.get("values")), settings.version,
                              "file" if glossary.version is None else str(glossary.version),
                              effective_sources(self.base, sources.mirror.get("sources"), sources.version))
            except Exception as exc:  # noqa: BLE001 - keep the last values (env until any are known)
                log.warning("runtime_config_unavailable", error=type(exc).__name__)
            if generation != self._generation:
                return  # invalidate() ran during the read, which may predate the save: read again next time
            if loaded is not None:
                self._settings, self._settings_version, self._glossary, self._sources = loaded
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

    async def sources(self) -> ActiveSources:
        """The search sources in force (Plan 23d): env's until a version is known, the last known while Redis and the
        DB are down."""
        await self._fresh()
        return self._sources

    def invalidate(self) -> None:
        """The saving process reads again at once; other processes follow within the TTL. A refresh already under way
        is dropped, not stored: what it read may be from before the save."""
        self._generation += 1
        self._expires = float("-inf")
