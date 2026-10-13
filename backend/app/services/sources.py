"""The search sources the admin console can turn on or off (Plan 23d). Pure: no I/O.

Nine fixed sources: eight SearXNG engines and ThaiJO (the direct client, Plan 24). The environment gives each one its
default (a SearXNG source is on when its engine is in SEARXNG_ENGINES, ThaiJO when THAIJO_ENABLED is true); a saved
version of the `sources` document kind holds only the sources that differ from it ({"sources": {id: bool}}) and wins in
both directions. Engines in SEARXNG_ENGINES that the catalog does not know (an opted-in `plos`) are kept as they are
and cannot be toggled. Reading never fails: an entry that no longer validates is skipped with a log line, and a set
that would leave no SearXNG source falls back to env's engines (`fallback`)."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any, Literal

from app.logging import get_logger

log = get_logger(__name__)


@dataclass(frozen=True)
class Source:
    id: str  # a slug, so error fields read sources.semantic_scholar
    label: str
    kind: Literal["searxng", "direct"]
    engine: str | None  # the SearXNG engine name; None for a direct client


SOURCES: tuple[Source, ...] = (
    Source("pubmed", "PubMed", "searxng", "pubmed"),
    Source("europepmc", "Europe PMC", "searxng", "europe pmc"),
    Source("openalex", "OpenAlex", "searxng", "openalex"),
    Source("semantic_scholar", "Semantic Scholar", "searxng", "semantic scholar"),
    Source("crossref", "Crossref", "searxng", "crossref"),
    Source("arxiv", "arXiv", "searxng", "arxiv"),
    Source("doaj", "DOAJ", "searxng", "doaj"),
    Source("openaire", "OpenAIRE", "searxng", "openaire"),
    Source("thaijo", "ThaiJO", "direct", None),
)
SOURCE_IDS = tuple(s.id for s in SOURCES)
BY_ID = {s.id: s for s in SOURCES}
_BY_ENGINE = {s.engine: s for s in SOURCES if s.engine}
EXTRA_LABELS = {"plos": "PLOS"}  # env-only engines on /status; any other shows its engine name


def env_engines(settings) -> list[str]:
    return [e.strip() for e in str(settings.searxng_engines).split(",") if e.strip()]


def env_defaults(settings) -> dict[str, bool]:
    """Each catalog source's state when no version is saved."""
    engines = set(env_engines(settings))
    return {s.id: (s.engine in engines) if s.engine else bool(settings.thaijo_enabled) for s in SOURCES}


def env_extras(settings) -> list[str]:
    """Engines in SEARXNG_ENGINES that the catalog does not know, in env order."""
    return [e for e in env_engines(settings) if e not in _BY_ENGINE]


@dataclass(frozen=True)
class ActiveSources:
    version: int | None  # None: no saved version, env is in use
    enabled: tuple[str, ...]  # the enabled catalog ids, in catalog order
    engines: str  # the SearXNG `engines=` value
    thaijo: bool
    extras: tuple[str, ...] = ()
    fallback: bool = False  # the stored set left no SearXNG source, so env's engines are used

    @property
    def label(self) -> str:
        return "env" if self.version is None else str(self.version)

    @property
    def has_europepmc(self) -> bool:
        return "europepmc" in self.enabled


def clean_overrides(overrides: Any) -> dict[str, bool]:
    """The entries that still validate; anything else is skipped with a log line (a hand-edited row or mirror)."""
    if not isinstance(overrides, dict):
        if overrides:
            log.warning("sources_not_a_mapping", got=type(overrides).__name__)
        return {}
    out: dict[str, bool] = {}
    for key, value in overrides.items():
        if key not in BY_ID:
            log.warning("source_unknown", name=str(key)[:64])
        elif not isinstance(value, bool):
            log.warning("source_invalid", name=key)
        else:
            out[key] = value
    return out


def _searxng_on(on: dict[str, bool]) -> bool:
    return any(on[s.id] for s in SOURCES if s.kind == "searxng")


def effective_sources(base, overrides: Any, version: int | None = None) -> ActiveSources:
    """The sources in force: env defaults with the saved overrides. With nothing overridden the engines string is
    exactly SEARXNG_ENGINES; otherwise env's engines in env order without the ones turned off (extras kept), then the
    catalog engines env lacks that are turned on, in catalog order."""
    env = env_defaults(base)
    on = {**env, **clean_overrides(overrides)}
    fallback = not _searxng_on(on) and _searxng_on(env)
    if fallback:  # an env change after the save left no SearXNG source: env's engines, reported by the admin read
        log.warning("sources_fallback_to_env_engines", version=version)
        on = {**env, "thaijo": on["thaijo"]}
    listed = env_engines(base)
    if on == env:
        engines = str(base.searxng_engines)
    else:
        kept = [e for e in listed if e not in _BY_ENGINE or on[_BY_ENGINE[e].id]]
        added = [s.engine for s in SOURCES if s.engine and on[s.id] and s.engine not in listed]
        engines = ",".join([*kept, *added])
    return ActiveSources(version=version, enabled=tuple(s.id for s in SOURCES if on[s.id]), engines=engines,
                         thaijo=on["thaijo"], extras=tuple(env_extras(base)), fallback=fallback)


def engine_fingerprint(engines: str) -> str:
    """The first 8 hex digits of sha256 over the sorted engine names joined by ','."""
    names = sorted({e.strip() for e in engines.split(",") if e.strip()})
    return hashlib.sha256(",".join(names).encode()).hexdigest()[:8]


def cache_part(active: ActiveSources, base) -> str:
    """The sources' part of the result-cache key. While no sources version exists it is Plan 24's rule (`+thaijo` while
    THAIJO_ENABLED), so the key is unchanged. With a version, `+thaijo` follows the ThaiJO state in force, and
    `+src{fingerprint}` is added when the SearXNG engine set differs from env's: turning ThaiJO off in the console gives
    the key of turning it off in env, and restoring an older set returns to its cache generation."""
    if active.version is None:
        return "+thaijo" if base.thaijo_enabled else ""
    part = "+thaijo" if active.thaijo else ""
    if engine_fingerprint(active.engines) != engine_fingerprint(str(base.searxng_engines)):
        part += f"+src{engine_fingerprint(active.engines)}"
    return part


def public_list(active: ActiveSources) -> list[dict[str, str]]:
    """/status `sources`: the enabled sources in catalog order, then the env-only engines."""
    return [{"id": i, "label": BY_ID[i].label} for i in active.enabled] + [
        {"id": e, "label": EXTRA_LABELS.get(e, e)} for e in active.extras]
