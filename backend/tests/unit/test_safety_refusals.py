"""Plan 26: an emergency topic is refused before any spend, the same way on REST and MCP; a rejected review carries
its refusal code."""
import json
import uuid

import pytest
from fastmcp import Client
from sqlalchemy import func, select

from app.db.models import Review
from app.db.repositories import ReviewRepository
from app.services import safety
from app.services.review_service import Refused
from tests.unit.test_review_service import ANON, req, service

EMERGENCY = "my father cannot breathe"


async def _rows(session_factory) -> int:
    async with session_factory() as s:
        return (await s.execute(select(func.count()).select_from(Review))).scalar_one()


async def test_an_emergency_is_refused_before_the_cache_the_rate_limit_and_the_queue(session_factory, redis):
    svc = service(session_factory, redis, review_rate_limit="1/minute")
    with pytest.raises(Refused) as exc:
        await svc.create(req(EMERGENCY), identity=ANON)
    assert exc.value.status_code == 422 and exc.value.code == "emergency"
    assert exc.value.kind == "medical" and exc.value.hotlines == ["1669"]
    assert exc.value.detail == safety.MESSAGES["emergency"]["en"]
    assert exc.value.message_th == safety.MESSAGES["emergency"]["th"]
    assert svc.queue.enqueued == [] and await _rows(session_factory) == 0
    created = await svc.create(req(), identity=ANON)  # the refusal used no part of the hourly limit
    assert created.status == "queued"


async def test_self_harm_lists_the_mental_health_hotline_first(session_factory, redis):
    svc = service(session_factory, redis)
    with pytest.raises(Refused) as exc:
        await svc.create(req("I want to kill myself"), identity=ANON)
    assert exc.value.kind == "self_harm" and exc.value.hotlines == ["1323", "1669"]
    assert "kill" not in exc.value.detail and "kill" not in exc.value.message_th


async def test_rest_answers_422_with_the_code_and_creates_nothing(client, queue, session_factory):
    resp = await client.post("/api/v1/reviews", json={"topic": "ผมเจ็บหน้าอกมาก ตอนนี้", "language": "th"})
    assert resp.status_code == 422
    body = resp.json()
    assert body == {"detail": safety.MESSAGES["emergency"]["en"], "code": "emergency", "kind": "medical",
                    "hotlines": ["1669"], "message_th": safety.MESSAGES["emergency"]["th"]}
    assert queue.enqueued == [] and await _rows(session_factory) == 0


async def test_a_rejected_review_reports_its_refusal_code(client, session_factory):
    async with session_factory() as s, s.begin():
        personal = await ReviewRepository(s).create(topic="t1", language="th", options={}, cache_key="a")
        declined = await ReviewRepository(s).create(topic="t2", language="th", options={}, cache_key="b")
        done = await ReviewRepository(s).create(topic="t3", language="th", options={}, cache_key="c")
    async with session_factory() as s, s.begin():
        repo = ReviewRepository(s)
        await repo.update(personal.id, status="rejected", error=safety.rejection_error("personal_medical"))
        await repo.update(declined.id, status="rejected", error="The topic is not a biomedical research question.")
        await repo.update(done.id, status="done", result={"summary": "s"})
    got = {rid: (await client.get(f"/api/v1/reviews/{rid}")).json()["refusal_code"]
           for rid in (personal.id, declined.id, done.id)}
    assert got == {personal.id: "personal_medical", declined.id: "declined", done.id: None}


def _data(result):
    return json.loads(result.content[0].text)


async def test_mcp_returns_the_refusal_instead_of_starting_a_review(app, queue, session_factory):
    async with Client(app.state.mcp) as c:
        out = _data(await c.call_tool("start_review", {"topic": "I want to kill myself", "language": "en"}))
    assert out == {"review_id": None, "status": "refused", "code": "emergency", "kind": "self_harm",
                   "hotlines": ["1323", "1669"], "message": safety.MESSAGES["self_harm"]["en"],
                   "message_th": safety.MESSAGES["self_harm"]["th"]}
    assert queue.enqueued == [] and await _rows(session_factory) == 0


async def test_mcp_status_and_result_carry_the_refusal_code(app, session_factory):
    async with session_factory() as s, s.begin():
        review = await ReviewRepository(s).create(topic="t", language="en", options={}, cache_key="k")
    async with session_factory() as s, s.begin():
        await ReviewRepository(s).update(review.id, status="rejected",
                                         error=safety.rejection_error("personal_medical"))
    async with Client(app.state.mcp) as c:
        status = _data(await c.call_tool("get_review_status", {"review_id": str(review.id)}))
        result = _data(await c.call_tool("get_review_result", {"review_id": str(review.id)}))
    assert status["status"] == "rejected" and status["refusal_code"] == "personal_medical"
    assert result["result"] is None and result["refusal_code"] == "personal_medical"
    assert str(uuid.UUID(status["review_id"])) == str(review.id)
    async with Client(app.state.mcp) as c:  # the resource carries the code too (Plan 26 final fix B3)
        res = await c.read_resource(f"review://{review.id}")
    assert json.loads(res[0].text)["refusal_code"] == "personal_medical"


def test_the_frontend_thai_copy_equals_the_backend_messages():  # Plan 26 final fix B2
    import re
    from pathlib import Path

    path = Path(__file__).resolve().parents[3] / "frontend" / "src" / "lib" / "refusal-copy.ts"
    if not path.exists():
        pytest.skip("frontend folder absent (backend image)")
    text = path.read_text(encoding="utf-8")
    bodies = {key: re.search(rf"\b{key}: \{{\s*title: \"[^\"]*\",\s*body: \"([^\"]*)\"", text) for key in
              ("medical", "self_harm")}
    personal = re.search(r"PERSONAL_MEDICAL_COPY = \{\s*title: \"[^\"]*\",\s*body: \"([^\"]*)\"", text)
    assert all(bodies.values()) and personal
    assert bodies["medical"].group(1) == safety.MESSAGES["emergency"]["th"]
    assert bodies["self_harm"].group(1) == safety.MESSAGES["self_harm"]["th"]
    assert personal.group(1) == safety.MESSAGES["personal_medical"]["th"]
