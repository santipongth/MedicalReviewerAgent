"""Real SearXNG (compose) + Europe PMC (internet). Run: MRA_INTEGRATION=1 uv run pytest -m integration."""
import os

import pytest

from app.config import Settings
from app.graph.factory import build_graph_deps
from app.services.http import DEFAULT_MIN_INTERVAL, HttpClient

pytestmark = pytest.mark.integration


@pytest.fixture
async def deps():
    http = HttpClient(min_interval=DEFAULT_MIN_INTERVAL)
    settings = Settings(_env_file=None, searxng_url=os.environ.get("SEARXNG_URL", "http://localhost:8080"),
                        searxng_timeout_seconds=30.0)
    yield build_graph_deps(settings, http)
    await http.aclose()


async def test_live_searxng_returns_academic_candidates(deps):
    cands = await deps.searxng.search("metformin colorectal cancer")
    assert len(cands) >= 5 and any(c.doi for c in cands)


async def test_live_europepmc_lookup_has_abstracts(deps):
    recs = await deps.europepmc.lookup(dois=["10.3390/cancers18162537"], pmids=[])
    assert any(r.doi == "10.3390/cancers18162537" and r.pmcid and r.abstract for r in recs)
