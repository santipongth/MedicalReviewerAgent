"""Regression tests for the Plan 3 final-review findings."""
import asyncio
import uuid
from contextlib import asynccontextmanager

from app.db.repositories import EventRepository, ReviewRepository
from app.graph.nodes.external import make_external_enrich
from app.services.api_keys import mint_key
from app.services.mcp_client import McpRegistry
from tests.fakes import FakeStructuredLLM
from tests.unit.test_external_mcp import PAYLOAD, deps


# ---- I1: a server that accepts but never answers initialize/tools/list is bounded -----------------
async def test_hanging_session_setup_is_bounded():
    class Hanging(McpRegistry):
        @asynccontextmanager
        async def tools(self):
            await asyncio.sleep(30)
            yield []

    d = deps(FakeStructuredLLM("e", lambda s, u: AssertionError("not reached")), Hanging(None, target=object()))
    d.settings.mcp_session_timeout_seconds = 0.2
    out = await asyncio.wait_for(make_external_enrich(d)(PAYLOAD), timeout=5)
    assert out["external_context"] == [] and "external tools unavailable: TimeoutError" in out["errors"][0]


# ---- I2: callbacks on cache hits ----------------------------------------------------------------------
async def mint(session_factory, name="lab"):
    async with session_factory() as s, s.begin():
        raw, _ = await mint_key(s, name)
        return raw


async def test_callback_is_reported_not_scheduled_on_a_cache_hit(client, session_factory):
    body = {"topic": "metformin and colorectal cancer"}
    first = await client.post("/api/v1/reviews", json=body)  # anonymous browser user starts it
    assert first.json()["callback_scheduled"] is False
    raw = await mint(session_factory)
    hook = {**body, "callback_url": "https://hooks.example.org/x"}
    hit = await client.post("/api/v1/reviews", json=hook, headers={"X-API-Key": raw})
    assert hit.status_code == 202 and hit.json()["cached"] is True and hit.json()["callback_scheduled"] is False
    fresh = await client.post("/api/v1/reviews", json={**hook, "topic": "statins and dementia"},
                              headers={"X-API-Key": raw})
    assert fresh.json()["cached"] is False and fresh.json()["callback_scheduled"] is True


async def test_anonymous_callback_is_forbidden_even_on_a_cache_hit(client):
    body = {"topic": "metformin and colorectal cancer"}
    await client.post("/api/v1/reviews", json=body)
    r = await client.post("/api/v1/reviews", json={**body, "callback_url": "https://hooks.example.org/x"})
    assert r.status_code == 403


# ---- key names never reach public review data -------------------------------------------------------
async def test_cancellation_does_not_expose_the_key_name(client, session_factory):
    raw = await mint(session_factory, name="Acme Hospital Research")
    rid = (await client.post("/api/v1/reviews", json={"topic": "aspirin and stroke"},
                             headers={"X-API-Key": raw})).json()["review_id"]
    assert (await client.delete(f"/api/v1/reviews/{rid}", headers={"X-API-Key": raw})).status_code == 200
    async with session_factory() as s:
        review = await ReviewRepository(s).get(uuid.UUID(rid))
        events = await EventRepository(s).list_since(uuid.UUID(rid), 0)
    public = str(review.error) + str([e.payload for e in events])
    assert "Acme" not in public and "owner" in review.error


# ---- /mcp without the trailing slash works ---------------------------------------------------------------
async def test_mcp_path_without_trailing_slash(app):
    import httpx
    transport = httpx.ASGITransport(app=app)
    async with app.state.mcp.session_manager.run(), httpx.AsyncClient(transport=transport,
                                                                      base_url="http://localhost") as h:
            r = await h.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize",
                                           "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                                                      "clientInfo": {"name": "t", "version": "1"}}},
                             headers={"accept": "application/json, text/event-stream"})
    assert r.status_code == 200 and r.json()["result"]["serverInfo"]["name"] == "medical-reviewer-agent"
