import os

import httpx
import pytest

from app.config import Settings

pytestmark = pytest.mark.integration

ENGINES = Settings(_env_file=None).searxng_engines
SEARXNG_URL = os.environ.get("SEARXNG_URL", "http://localhost:8080")


async def test_search_json_returns_academic_results():
    async with httpx.AsyncClient(base_url=SEARXNG_URL, timeout=60) as client:
        resp = await client.get(
            "/search",
            params={"q": "metformin colorectal cancer", "format": "json", "engines": ENGINES},
        )
    assert resp.status_code == 200, resp.text[:300]
    body = resp.json()
    assert "results" in body
    assert len(body["results"]) > 0
    engines = {e for r in body["results"] for e in r.get("engines", [])}
    assert "pubmed" in engines, engines  # was 0 results before Plan 16
    assert len(engines & set(ENGINES.split(","))) >= 4, engines
    full = [r for r in body["results"] if "pubmed" in r.get("engines", []) and len(r.get("content") or "") >= 150]
    assert full, "pubmed returned no full abstracts"
