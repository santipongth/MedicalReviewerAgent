"""Plan 30: MCP quick_answer waits are bounded per client, like event streams."""
import json
import uuid
from datetime import UTC, datetime

from fastmcp import Client

from app.db.repositories import ReviewRepository
from app.mcp import server
from app.services.review_service import Identity
from app.services.sse_slots import SseSlots
from tests.unit.test_quick_outputs import QUICK_RESULT

TOPIC = {"topic": "statins and dementia risk", "language": "en"}


def data(result):
    return json.loads(result.content[0].text)


def local_waiter(app) -> str:
    """The in-process MCP client has no HTTP request: its address is "mcp-local"."""
    return server.waiter_key(Identity(ip="mcp-local"), app.state.deps)


def test_the_waiter_key_never_holds_a_raw_address(app):
    key = server.waiter_key(Identity(ip="203.0.113.9"), app.state.deps)
    assert key.startswith("mcpwait:ip:") and "203.0.113.9" not in key


async def test_a_client_at_its_wait_cap_gets_the_answer_at_once(app, redis, monkeypatch):
    slept = []

    async def sleep(seconds):
        slept.append(seconds)

    monkeypatch.setattr(server, "_sleep", sleep)
    held = SseSlots(redis, limit=5)
    for _ in range(app.state.deps.service.settings.sse_max_per_ip):  # every wait slot of this client is taken
        assert await held.acquire(local_waiter(app))
    async with Client(app.state.mcp) as c:
        out = data(await c.call_tool("quick_answer", TOPIC | {"wait_seconds": 30}))
    assert out["status"] == "queued" and "still running" in out["message"] and slept == []
    assert int(await redis.get(f"mra:sse:{local_waiter(app)}")) == 5  # nothing taken, nothing released


async def test_a_wait_takes_one_slot_and_gives_it_back(app, redis, session_factory, monkeypatch):
    seen = []
    rid: list[uuid.UUID] = []
    real_create = app.state.deps.service.create

    async def remember(req, **kw):
        created = await real_create(req, **kw)
        rid.append(created.review_id)
        return created

    async def finish(seconds):  # while the tool waits, its slot is held; then the review finishes
        seen.append(await redis.get(f"mra:sse:{local_waiter(app)}"))
        async with session_factory() as s, s.begin():
            await ReviewRepository(s).update(rid[0], status="done", result=QUICK_RESULT, finished_at=datetime.now(UTC))

    monkeypatch.setattr(app.state.deps.service, "create", remember)
    monkeypatch.setattr(server, "_sleep", finish)
    async with Client(app.state.mcp) as c:
        out = data(await c.call_tool("quick_answer", TOPIC | {"wait_seconds": 30}))
    assert out["status"] == "done" and seen == ["1"]
    assert await redis.get(f"mra:sse:{local_waiter(app)}") is None  # released


async def test_a_failing_slot_store_returns_at_once_instead_of_failing_the_call(app, monkeypatch):
    slept = []

    async def sleep(seconds):
        slept.append(seconds)

    async def broken(self, key):
        raise ConnectionError("redis down")

    monkeypatch.setattr(server, "_sleep", sleep)
    monkeypatch.setattr(SseSlots, "acquire", broken)
    async with Client(app.state.mcp) as c:
        out = data(await c.call_tool("quick_answer", TOPIC | {"wait_seconds": 30}))
    assert out["review_id"] and out["status"] == "queued" and "still running" in out["message"] and slept == []
