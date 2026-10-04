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
    assert names == {"search_papers", "start_review", "get_review_status", "get_review_result", "get_fulltext"}
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
        ft = data(await c.call_tool("get_fulltext", {"pmcid": "PMC123"}))
        assert "## Results" in ft["text"]


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
