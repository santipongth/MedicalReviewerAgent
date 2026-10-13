import uuid

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from app.schemas.review import compute_cache_key
from app.services.admin_auth import AdminPrincipal
from app.services.config_store import newest, publish, save_version
from app.services.glossary_store import GLOSSARY_KIND
from app.services.paper_search import PaperSearch
from app.services.runtime_settings import SETTINGS_KIND
from tests.admin_helpers import admin_headers
from tests.unit.test_papers_and_report import Epmc, Searx, hits

OWNER = AdminPrincipal(kind="user", id=None, label="owner")
TOPIC = {"topic": "metformin and colorectal cancer"}


async def apply(app, kind, raw):
    """Save a version as the console does, and make this process read it now."""
    deps = app.state.deps
    async with deps.session_factory() as s, s.begin():
        current = await newest(s, kind)
        row = await save_version(s, OWNER, kind, raw, settings=deps.service.settings,
                                 base_version=current.version if current else None)
    await publish(deps.redis, kind, row)
    deps.runtime.invalidate()
    return row


async def test_status_reports_the_values_in_force(app, client):
    before = (await client.get("/api/v1/status")).json()["limits"]
    assert before["max_queued_reviews"] == 50 and before["review_rate_limit"] == "5/hour"
    await apply(app, SETTINGS_KIND, {"values": {"max_queued_reviews": 80, "review_rate_limit": "9/hour",
                                                "sse_max_per_ip": 2}})
    after = (await client.get("/api/v1/status")).json()["limits"]
    assert (after["max_queued_reviews"], after["review_rate_limit"], after["sse_max_per_ip"]) == (80, "9/hour", 2)


async def test_review_creation_uses_the_live_rate_limit(app, client):
    await apply(app, SETTINGS_KIND, {"values": {"review_rate_limit": "1/hour"}})
    assert (await client.post("/api/v1/reviews", json=TOPIC)).status_code == 202
    assert (await client.post("/api/v1/reviews", json={"topic": "statins and dementia risk"})).status_code == 429


async def test_review_creation_uses_the_live_queue_cap(app, client):
    await apply(app, SETTINGS_KIND, {"values": {"max_queued_reviews": 1, "review_rate_limit": "100/hour"}})
    assert (await client.post("/api/v1/reviews", json=TOPIC)).status_code == 202
    refused = await client.post("/api/v1/reviews", json={"topic": "statins and dementia risk"})
    assert refused.status_code == 503 and refused.json()["reason"] == "queue_full"


async def test_the_cache_key_is_unchanged_until_a_glossary_is_saved(app, client):
    deps = app.state.deps
    first = (await client.post("/api/v1/reviews", json=TOPIC)).json()
    review = await deps.service.get(uuid.UUID(first["review_id"]))
    assert review.cache_key == compute_cache_key(review.topic, review.language, review.options,
                                                 f"{deps.service.settings.prompt_version}+llmfile")
    assert (await client.post("/api/v1/reviews", json=TOPIC)).json()["review_id"] == first["review_id"]
    await apply(app, GLOSSARY_KIND, {"terms": [{"en": "placebo", "th": "ยาหลอก"}]})
    assert (await client.post("/api/v1/reviews", json=TOPIC)).json()["review_id"] != first["review_id"]


async def test_event_streams_use_the_live_limit(app, client):
    await apply(app, SETTINGS_KIND, {"values": {"sse_max_per_ip": 1}})
    created = (await client.post("/api/v1/reviews", json=TOPIC)).json()
    deps = app.state.deps
    await deps.redis.set(f"mra:sse:{deps.service.sse_key('127.0.0.1')}", 1)  # one stream already open
    r = await client.get(f"/api/v1/reviews/{created['review_id']}/events")
    assert r.status_code == 429 and "max 1 per client" in r.json()["detail"]


async def test_paper_search_uses_the_live_limit_in_rest_and_mcp(app, client):
    app.state.deps.papers = PaperSearch(Searx(hits()), Epmc())
    await apply(app, SETTINGS_KIND, {"values": {"paper_search_rate_limit": "1/minute"}})
    assert (await client.get("/api/v1/papers/search?q=metformin")).status_code == 200
    assert (await client.get("/api/v1/papers/search?q=metformin")).status_code == 429
    async with Client(app.state.mcp) as c:
        await c.call_tool("search_papers", {"query": "metformin", "limit": 1})
        with pytest.raises(ToolError, match="rate limit"):
            await c.call_tool("search_papers", {"query": "metformin", "limit": 1})


async def test_dashboard_capacity_shows_the_values_in_force(app, client, session_factory):
    h = await admin_headers(client, session_factory)
    await apply(app, SETTINGS_KIND, {"values": {"max_reviews_per_day": 7}})
    capacity = (await client.get("/api/v1/admin/dashboard?days=7", headers=h)).json()["capacity"]
    assert capacity["max_reviews_per_day"] == 7
