from app.config import Settings
from app.graph.factory import build_graph_deps, close_graph_deps
from app.services.crawler import Crawl4AIClient
from app.services.fulltext import FullTextFetcher
from app.services.http import HttpClient
from app.services.llm import LLMs
from app.services.searxng import SearxngClient


async def test_real_mode_builds_all_services(redis):
    http = HttpClient()
    settings = Settings(_env_file=None, openrouter_api_key="sk-or-x", contact_email="a@b.c", crawl4ai_token="tok",
                        searxng_timeout_seconds=7.5)
    deps = build_graph_deps(settings, http, redis)
    assert isinstance(deps.llms, LLMs) and isinstance(deps.searxng, SearxngClient)
    assert deps.searxng.timeout == 7.5
    assert isinstance(deps.fulltext, FullTextFetcher) and deps.fulltext.unpaywall.email == "a@b.c"
    assert isinstance(deps.fulltext.crawler, Crawl4AIClient) and deps.fulltext.policy is not None
    assert deps.fulltext.cache is not None
    await close_graph_deps(deps)
    await http.aclose()


async def test_crawling_disabled_without_token_or_redis(redis):
    http = HttpClient()
    no_token = build_graph_deps(Settings(_env_file=None, crawl4ai_token=""), http, redis)
    no_redis = build_graph_deps(Settings(_env_file=None, crawl4ai_token="tok"), http, None)
    disabled = build_graph_deps(Settings(_env_file=None, crawl4ai_token="tok", crawl_enabled=False), http, redis)
    assert no_token.fulltext.crawler is None and no_redis.fulltext.crawler is None
    assert disabled.fulltext.crawler is None and no_redis.fulltext.cache is None
    await http.aclose()


async def test_stub_mode_has_no_llms():
    http = HttpClient()
    assert build_graph_deps(Settings(_env_file=None, graph_mode="stub"), http).llms is None
    await http.aclose()
