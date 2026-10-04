"""Builds the graph's external services from settings (worker startup)."""
from __future__ import annotations

from app.config import Settings
from app.graph.graph import GraphDeps
from app.services.crawl_policy import DomainPolicy
from app.services.crawler import Crawl4AIClient
from app.services.europepmc import EuropePmcClient
from app.services.fulltext import FullTextFetcher
from app.services.fulltext_cache import FullTextCache
from app.services.http import HttpClient
from app.services.llm import build_llms
from app.services.mcp_client import McpRegistry
from app.services.searxng import SearxngClient
from app.services.unpaywall import UnpaywallClient


def build_graph_deps(settings: Settings, http: HttpClient, redis=None, catalog=None) -> GraphDeps:
    """Stub deps when graph_mode == "stub". Crawling needs crawl_enabled, a Crawl4AI token and Redis
    (domain spacing/cooldown is shared across workers through Redis); otherwise full text falls back
    to Europe PMC and abstracts."""
    if settings.graph_mode == "stub":
        return GraphDeps(settings=settings)
    europepmc = EuropePmcClient(http, settings.europepmc_url)
    crawl_on = settings.crawl_enabled and bool(settings.crawl4ai_token) and redis is not None
    crawler = (Crawl4AIClient(settings.crawl4ai_url, settings.crawl4ai_token,
                              timeout=settings.crawl_timeout_seconds, stealth=settings.crawl_stealth)
               if crawl_on else None)
    policy = (DomainPolicy(redis, min_interval=settings.crawl_domain_interval,
                           cooldown_minutes=settings.crawl_cooldown_minutes) if crawl_on else None)
    llms = build_llms(settings, catalog=catalog)
    return GraphDeps(
        settings=settings,
        llms=llms,
        mcp=McpRegistry(settings.mcp_servers_path),
        searxng=SearxngClient(http, settings.searxng_url, settings.searxng_engines,
                              timeout=settings.searxng_timeout_seconds),
        europepmc=europepmc,
        fulltext=FullTextFetcher(
            europepmc=europepmc,
            unpaywall=UnpaywallClient(http, settings.unpaywall_url, settings.contact_email),
            crawler=crawler,
            policy=policy,
            cache=FullTextCache(redis, ttl_days=settings.fulltext_cache_days) if redis is not None else None,
            # assemble sections at the extraction budget so nothing is head-cut later
            max_chars=min(settings.max_fulltext_chars, llms.harness.extraction_chars),
            max_urls=settings.max_crawl_urls_per_paper,
            concurrency=settings.crawl_concurrency,
        ),
    )


async def close_graph_deps(deps: GraphDeps) -> None:
    crawler = getattr(deps.fulltext, "crawler", None)
    if crawler is not None:
        await crawler.aclose()
