from app.config import Settings
from app.graph.factory import build_graph_deps, close_graph_deps
from app.services.europepmc import EuropePmcClient
from app.services.http import HttpClient
from app.services.llm import LLMs
from app.services.searxng import SearxngClient


async def test_real_mode_builds_all_services(redis):
    http = HttpClient()
    settings = Settings(_env_file=None, openrouter_api_key="sk-or-x", searxng_timeout_seconds=7.5)
    deps = build_graph_deps(settings, http, redis)
    assert isinstance(deps.llms, LLMs) and isinstance(deps.searxng, SearxngClient)
    assert deps.searxng.timeout == 7.5 and isinstance(deps.europepmc, EuropePmcClient)
    assert not hasattr(deps, "fulltext")  # abstract-only: no full-text fetcher exists
    await close_graph_deps(deps)
    await http.aclose()


async def test_stub_mode_has_no_llms():
    http = HttpClient()
    assert build_graph_deps(Settings(_env_file=None, graph_mode="stub"), http).llms is None
    await http.aclose()
