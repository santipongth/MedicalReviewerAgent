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
from app.services.thaijo import ThaiJoClient


def build_graph_deps(settings: Settings, http: HttpClient, redis=None, catalog=None, *, resolved=None, sem=None,
                     config_version: str = "file", glossary=None) -> GraphDeps:
    """Stub deps when graph_mode == "stub". Papers are read from their abstracts only (no full-text fetching)."""
    if settings.graph_mode == "stub":
        return GraphDeps(settings=settings, glossary=glossary)
    return GraphDeps(
        settings=settings,
        glossary=glossary,
        llms=build_llms(settings, catalog=catalog, resolved=resolved, sem=sem, config_version=config_version),
        mcp=McpRegistry(settings.mcp_servers_path),
        searxng=SearxngClient(http, settings.searxng_url, settings.searxng_engines,
                              timeout=settings.searxng_timeout_seconds),
        europepmc=EuropePmcClient(http, settings.europepmc_url),
        openalex=OpenAlexClient(http, settings.openalex_url, api_key=settings.openalex_api_key,
                                mailto=settings.openalex_mailto, timeout=settings.openalex_timeout_seconds),
        thaijo=build_thaijo(settings, http, redis),
    )


def build_thaijo(settings: Settings, http: HttpClient, redis=None) -> ThaiJoClient | None:
    """The ThaiJO client when THAIJO_ENABLED (Plan 24), else None. `redis` (decode_responses=True) caches abstracts
    and OAI records by article; without it nothing is cached."""
    if not settings.thaijo_enabled:
        return None
    return ThaiJoClient(http, settings.thaijo_url, cache=redis, timeout=settings.thaijo_request_timeout_seconds,
                        cache_ttl=settings.thaijo_cache_ttl_seconds)


async def close_graph_deps(deps: GraphDeps) -> None:
    """Nothing to close since the crawler was removed; kept so callers need not change."""
