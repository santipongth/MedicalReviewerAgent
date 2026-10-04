"""MCP over real HTTP against the running stack (docker compose up; GRAPH_MODE=stub is enough).
Run: MRA_INTEGRATION=1 uv run pytest -m integration tests/integration/test_mcp_live.py"""
import asyncio
import json
import os
import uuid

import httpx
import pytest
from fastmcp import Client

pytestmark = pytest.mark.integration

BASE = os.environ.get("MRA_API_URL", "http://localhost:8000")


def data(result):
    return json.loads(result.content[0].text)


async def test_mcp_review_round_trip_matches_rest():
    async with Client(f"{BASE}/mcp/") as c:
        names = {t.name for t in await c.list_tools()}
        assert {"start_review", "get_review_status", "get_review_result", "search_papers"} <= names
        started = data(await c.call_tool("start_review", {"topic": f"mcp live check {uuid.uuid4().hex[:8]}",
                                                          "language": "en"}))
        rid = started["review_id"]
        for _ in range(60):
            status = data(await c.call_tool("get_review_status", {"review_id": rid}))["status"]
            if status not in ("queued", "running"):
                break
            await asyncio.sleep(1)
        result = data(await c.call_tool("get_review_result", {"review_id": rid}))
        report = await c.read_resource(f"review://{rid}/report.md")
    async with httpx.AsyncClient(base_url=BASE) as h:
        rest = (await h.get(f"/api/v1/reviews/{rid}")).json()
    assert status == "done" and result["status"] == rest["status"] == "done"
    assert result["result"] == rest["result"] and report[0].text.startswith("# Literature review")


async def test_mcp_search_papers_live():
    async with Client(f"{BASE}/mcp/") as c:
        found = data(await c.call_tool("search_papers", {"query": "metformin colorectal cancer", "limit": 5}))
    assert 1 <= len(found["papers"]) <= 5 and any(p["doi"] for p in found["papers"])
