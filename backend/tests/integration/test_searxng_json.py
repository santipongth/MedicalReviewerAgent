import os

import httpx
import pytest

pytestmark = pytest.mark.integration

SEARXNG_URL = os.environ.get("SEARXNG_URL", "http://localhost:8080")


async def test_search_json_returns_academic_results():
    async with httpx.AsyncClient(base_url=SEARXNG_URL, timeout=60) as client:
        resp = await client.get(
            "/search",
            params={"q": "metformin colorectal cancer", "format": "json", "engines": "pubmed,arxiv"},
        )
    assert resp.status_code == 200, resp.text[:300]
    body = resp.json()
    assert "results" in body
    assert len(body["results"]) > 0
    engines = {e for r in body["results"] for e in r.get("engines", [])}
    assert engines & {"pubmed", "arxiv"}
