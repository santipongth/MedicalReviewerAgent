"""Builds the graph's external services from settings (worker startup)."""
from __future__ import annotations

from app.config import Settings
from app.graph.graph import GraphDeps
from app.services.europepmc import EuropePmcClient
from app.services.http import HttpClient
from app.services.llm import build_llms
from app.services.mcp_client import McpRegistry
from app.services.openalex import OpenAlexClient
from app.services.searxng import SearxngClient
from app.services.sources import ActiveSources, effective_sources
from app.services.thaijo import ThaiJoClient


def build_graph_deps(settings: Settings, http: HttpClient, redis=None, catalog=None, *, resolved=None, sem=None,
                     config_version: str = "file", glossary=None, sources: ActiveSources | None = None) -> GraphDeps:
    """Stub deps when graph_mode == "stub". Papers are read from their abstracts only (no full-text fetching).
    `sources` (Plan 23d): the search sources in force; env's when None."""
    sources = sources if sources is not None else effective_sources(settings, {})
    if settings.graph_mode == "stub":
        return GraphDeps(settings=settings, glossary=glossary, sources=sources)
    return GraphDeps(
        settings=settings,
        glossary=glossary,
        sources=sources,
        llms=build_llms(settings, catalog=catalog, resolved=resolved, sem=sem, config_version=config_version),
        mcp=McpRegistry(settings.mcp_servers_path),
        searxng=SearxngClient(http, settings.searxng_url, settings.searxng_engines,
                              timeout=settings.searxng_timeout_seconds),
        europepmc=EuropePmcClient(http, settings.europepmc_url),
        openalex=OpenAlexClient(http, settings.openalex_url, api_key=settings.openalex_api_key,
                                mailto=settings.openalex_mailto, timeout=settings.openalex_timeout_seconds),
        thaijo=build_thaijo(settings, http, redis),
    )


def build_thaijo(settings: Settings, http: HttpClient, redis=None) -> ThaiJoClient:
    """The ThaiJO client (Plan 24), built in live mode whatever THAIJO_ENABLED says (construction does no I/O): the
    search node and the OAI-PMH step ask the sources in force (Plan 23d), where THAIJO_ENABLED is the default.
    `redis` (decode_responses=True) caches abstracts and OAI records by article; without it nothing is cached."""
    return ThaiJoClient(http, settings.thaijo_url, cache=redis, timeout=settings.thaijo_request_timeout_seconds,
                        cache_ttl=settings.thaijo_cache_ttl_seconds)


async def close_graph_deps(deps: GraphDeps) -> None:
    """Nothing to close since the crawler was removed; kept so callers need not change."""
