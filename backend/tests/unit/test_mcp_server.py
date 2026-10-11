import json
import uuid

import httpx
import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from app.db.repositories import ReviewRepository
from app.services.paper_search import PaperSearch
from tests.unit.test_papers_and_report import Epmc, Searx, hits

HDR = {"accept": "application/json, text/event-stream", "content-type": "application/json",
       "mcp-protocol-version": "2025-06-18"}


def data(result):
    return json.loads(result.content[0].text)


@pytest.fixture
def mcp(app):
    app.state.deps.papers = PaperSearch(Searx(hits()), Epmc())
    return app.state.mcp


async def test_tools_resources_and_prompt_are_listed(mcp):
    async with Client(mcp) as c:
        names = {t.name for t in await c.list_tools()}
        templates = {t.uri_template for t in await c.list_resource_templates()}
        prompt = await c.get_prompt("literature_review", {"topic": "metformin"})
    assert names == {"search_papers", "start_review", "get_review_status", "get_review_result"}
    assert templates == {"review://{review_id}", "review://{review_id}/report.md"}
    assert "start_review" in prompt.messages[0].content.text


async def test_start_status_result_match_rest(mcp, client, session_factory, queue):
    async with Client(mcp) as c:
        started = data(await c.call_tool("start_review", {"topic": "metformin and colorectal cancer",
                                                          "language": "en", "max_papers": 5}))
        rid = started["review_id"]
        assert started["status"] == "queued" and queue.enqueued == [rid]
        status = data(await c.call_tool("get_review_status", {"review_id": rid}))
        assert status["status"] == "queued"
        pending = data(await c.call_tool("get_review_result", {"review_id": rid}))
        assert pending["result"] is None and "still" in pending["message"]
        result = {"summary": "Metformin lowers risk [P1].", "papers": [], "synthesis": {"comparison": []}}
        async with session_factory() as s, s.begin():
            await ReviewRepository(s).update(uuid.UUID(rid), status="done", result=result)
        done = data(await c.call_tool("get_review_result", {"review_id": rid}))
        md = await c.read_resource(f"review://{rid}/report.md")
        res = await c.read_resource(f"review://{rid}")
    rest = (await client.get(f"/api/v1/reviews/{rid}")).json()
    assert done["result"] == rest["result"] == result and done["status"] == rest["status"] == "done"
    assert "Metformin lowers risk" in md[0].text and json.loads(res[0].text)["status"] == "done"


async def test_bad_ids_and_search_tools(mcp):
    async with Client(mcp) as c:
        with pytest.raises(ToolError, match="not found"):
            await c.call_tool("get_review_status", {"review_id": str(uuid.uuid4())})
        with pytest.raises(ToolError, match="review_id"):
            await c.call_tool("get_review_result", {"review_id": "nope"})
        papers = data(await c.call_tool("search_papers", {"query": "metformin", "limit": 2}))["papers"]
        assert papers[0]["doi"] == "10.1/a" and papers[0]["pmcid"] == "PMC123"


async def rpc(h, method, params, headers=None, rid=1):
    r = await h.post("/mcp/", json={"jsonrpc": "2.0", "id": rid, "method": method, "params": params},
                     headers={**HDR, **(headers or {})})
    assert r.status_code == 200, r.text
    return r.json()


async def test_http_transport_shares_rate_limits_and_rejects_bad_keys(app, monkeypatch):
    app.state.deps.service.settings.review_rate_limit = "1/minute"
    async with app.state.mcp.session_manager.run():
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://localhost") as h:
            init = await rpc(h, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                               "clientInfo": {"name": "t", "version": "1"}})
            assert init["result"]["serverInfo"]["name"] == "medical-reviewer-agent"
            assert (await h.post("/api/v1/reviews", json={"topic": "rest topic on statins"})).status_code == 202
            limited = await rpc(h, "tools/call", {"name": "start_review", "arguments": {"topic": "mcp topic"}})
            assert limited["result"]["isError"] and "rate limit" in limited["result"]["content"][0]["text"]
            bad = await rpc(h, "tools/call", {"name": "start_review", "arguments": {"topic": "another topic"}},
                            headers={"x-api-key": "mra_invalid"})
            assert bad["result"]["isError"] and "API key" in bad["result"]["content"][0]["text"]


async def test_start_review_uses_the_abstract_only_paper_range(mcp, client):
    from app.schemas.review import ReviewOptions
    lo, hi = ReviewOptions.bound("max_papers", "ge"), ReviewOptions.bound("max_papers", "le")
    default = ReviewOptions.model_fields["max_papers"].default
    async with Client(mcp) as c:
        asked = {}
        for topic, n in (("statins and dementia risk", 1), ("aspirin and colorectal adenoma", hi),
                         ("sglt2 inhibitors and heart failure", None), ("warfarin and atrial fibrillation", 99)):
            args = {"topic": topic, "language": "en"} | ({"max_papers": n} if n is not None else {})
            rid = data(await c.call_tool("start_review", args))["review_id"]
            asked[n] = (await client.get(f"/api/v1/reviews/{rid}")).json()["options"]["max_papers"]
    assert asked == {1: lo, hi: hi, None: default, 99: hi}  # clamped into the bounds, not rejected
    assert (lo, hi, default) == (5, 50, 30)


async def test_tool_description_and_instructions_show_the_bounds_from_review_options(mcp):
    from app.mcp.server import INSTRUCTIONS
    from app.schemas.review import ReviewOptions
    lo, hi = ReviewOptions.bound("max_papers", "ge"), ReviewOptions.bound("max_papers", "le")
    pool = ReviewOptions.model_fields["candidate_limit"].default
    async with Client(mcp) as c:
        tool = next(t for t in await c.list_tools() if t.name == "start_review")
    for text in (INSTRUCTIONS, tool.description):
        assert str(lo) in text and str(hi) in text and str(pool) in text
        assert "5-30" not in text and "~60" not in text and "about 60" not in text


async def test_instructions_and_prompt_describe_the_current_service(mcp):
    from app.mcp.server import INSTRUCTIONS
    for text in (INSTRUCTIONS,):
        assert all(s in text for s in ("done", "error", "rejected", "cancelled"))  # every terminal status
        assert "abstract" in text and "1-3 minutes" in text
    async with Client(mcp) as c:
        prompt = await c.get_prompt("literature_review", {"topic": "statins"})
    body = prompt.messages[0].content.text
    assert "1-3 minutes" in body and "rejected" in body and "about a minute" not in body


def test_capacity_errors_keep_reason_and_retry_time():
    from app.mcp.server import _error
    from app.services.review_service import Unavailable
    msg = str(_error(Unavailable("the review queue is full", 60, "queue_full")))
    assert "queue_full" in msg and "retry after 60 seconds" in msg


async def test_start_review_passes_review_type_through(mcp, client):
    async with Client(mcp) as c:
        rid = data(await c.call_tool("start_review", {"topic": "statins and dementia risk", "language": "en",
                                                      "review_type": "scoping"}))["review_id"]
        default = data(await c.call_tool("start_review", {"topic": "aspirin and colorectal adenoma"}))["review_id"]
        with pytest.raises(ToolError):
            await c.call_tool("start_review", {"topic": "statins and stroke", "review_type": "umbrella"})
    assert (await client.get(f"/api/v1/reviews/{rid}")).json()["options"]["review_type"] == "scoping"
    assert (await client.get(f"/api/v1/reviews/{default}")).json()["options"]["review_type"] == "slr"
