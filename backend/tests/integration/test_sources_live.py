"""Real SearXNG (compose) + Europe PMC (internet). Run: MRA_INTEGRATION=1 uv run pytest -m integration."""
import os

import pytest

from app.config import Settings
from app.graph.factory import build_graph_deps
from app.graph.schemas import Candidate
from app.services.http import DEFAULT_MIN_INTERVAL, HttpClient

pytestmark = pytest.mark.integration


@pytest.fixture
async def deps():
    http = HttpClient(min_interval=DEFAULT_MIN_INTERVAL)
    settings = Settings(_env_file=None, searxng_url=os.environ.get("SEARXNG_URL", "http://localhost:8080"),
                        contact_email=os.environ.get("CONTACT_EMAIL", ""), searxng_timeout_seconds=30.0)
    yield build_graph_deps(settings, http)
    await http.aclose()


async def test_live_searxng_returns_academic_candidates(deps):
    cands = await deps.searxng.search("metformin colorectal cancer")
    assert len(cands) >= 5 and any(c.doi for c in cands)


async def test_live_europepmc_lookup_and_fulltext(deps):
    recs = await deps.europepmc.lookup(dois=["10.3390/cancers18162537"], pmids=[])
    assert any(r.doi == "10.3390/cancers18162537" and r.pmcid for r in recs)
    ft = await deps.fulltext.fetch(Candidate(title="t", pmcid="PMC13352196", is_open_access=True))
    assert ft.source == "europepmc" and "## Results" in ft.text
