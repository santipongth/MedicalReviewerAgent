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


def build_graph_deps(settings: Settings, http: HttpClient, redis=None, catalog=None) -> GraphDeps:
    """Stub deps when graph_mode == "stub". Papers are read from their abstracts only (no full-text fetching)."""
    if settings.graph_mode == "stub":
        return GraphDeps(settings=settings)
    return GraphDeps(
        settings=settings,
        llms=build_llms(settings, catalog=catalog),
        mcp=McpRegistry(settings.mcp_servers_path),
        searxng=SearxngClient(http, settings.searxng_url, settings.searxng_engines,
                              timeout=settings.searxng_timeout_seconds),
        europepmc=EuropePmcClient(http, settings.europepmc_url),
        openalex=OpenAlexClient(http, settings.openalex_url, api_key=settings.openalex_api_key,
                                mailto=settings.openalex_mailto, timeout=settings.openalex_timeout_seconds),
    )


async def close_graph_deps(deps: GraphDeps) -> None:
    """Nothing to close since the crawler was removed; kept so callers need not change."""
