"""Plan 30: a personal medical refusal never echoes its question, an escalation model's refusal is one, and two more
red flags."""
import json
import uuid

import pytest
from fastmcp import Client

from app.db.repositories import EventRepository, ReviewRepository
from app.graph.nodes.intake import make_topic_guard
from app.graph.schemas import TopicVerdict
from app.harness.runner import HarnessRunner
from app.services import safety
from app.services.llm import LLMOutputError, LLMRefusal
from app.services.report import render_markdown
from tests.fakes import FakeStructuredLLM
from tests.unit.test_nodes_intake import _deps, _llms
from tests.unit.test_sse import _parse_sse

QUESTION = "my mother is 80, should she keep taking aspirin"


async def _rejected(session_factory, error: str, topic: str = QUESTION):
    async with session_factory() as s, s.begin():
        review = await ReviewRepository(s).create(topic=topic, language="en", options={}, cache_key=f"k-{error[:5]}")
    async with session_factory() as s, s.begin():
        await ReviewRepository(s).update(review.id, status="rejected", error=error)
    async with session_factory() as s:
        return await ReviewRepository(s).get(review.id)


async def test_rest_returns_no_topic_for_a_personal_refusal_and_keeps_it_otherwise(client, session_factory):
    personal = await _rejected(session_factory, safety.rejection_error("personal_medical"))
    declined = await _rejected(session_factory, "The topic is not a biomedical research question.", topic="pizza")
    got = (await client.get(f"/api/v1/reviews/{personal.id}")).json()
    assert got["topic"] is None and got["refusal_code"] == "personal_medical"
    assert QUESTION not in json.dumps(got)
    assert (await client.get(f"/api/v1/reviews/{declined.id}")).json()["topic"] == "pizza"


async def test_mcp_resource_and_markdown_report_leave_the_question_out(app, session_factory):
    personal = await _rejected(session_factory, safety.rejection_error("personal_medical"))
    async with Client(app.state.mcp) as c:
        resource = json.loads((await c.read_resource(f"review://{personal.id}"))[0].text)
        md = (await c.read_resource(f"review://{personal.id}/report.md"))[0].text
    assert resource["topic"] is None and resource["refusal_code"] == "personal_medical"
    assert md.startswith("# Literature review\n") and QUESTION not in md
    declined = await _rejected(session_factory, "Not medical.", topic="best pizza in town")
    assert render_markdown(declined).startswith("# Literature review: best pizza in town")


async def test_the_queued_event_carries_no_topic_and_a_replay_drops_an_old_one(client, session_factory, app):
    created = (await client.post("/api/v1/reviews", json={"topic": "statins and dementia", "language": "en"})).json()
    async with session_factory() as s:
        [queued] = await EventRepository(s).list_since(uuid.UUID(created["review_id"]), 0)
    assert queued.type == "queued" and queued.payload == {}
    personal = await _rejected(session_factory, safety.rejection_error("personal_medical"))
    sink = app.state.deps.event_sink
    await sink.emit(personal.id, "queued", {"topic": QUESTION})  # as stored before Plan 30
    await sink.emit(personal.id, "rejected", {"reason": "x", "code": "personal_medical"})
    async with client.stream("GET", f"/api/v1/reviews/{personal.id}/events") as resp:
        body = (await resp.aread()).decode()
    events = _parse_sse(body)
    assert [e["event"] for e in events] == ["queued", "rejected"] and json.loads(events[0]["data"]) == {}
    assert QUESTION not in body


async def test_an_escalation_refusal_is_flagged_by_the_harness():
    broken = FakeStructuredLLM("small", lambda s, u: LLMOutputError("not JSON"))
    refusing = FakeStructuredLLM("big", lambda s, u: LLMRefusal("declined"))
    res = await HarnessRunner(max_repairs=0, escalation=lambda schema: refusing).call(
        broken, "sys", "user", schema=TopicVerdict)
    assert res.value is None and res.refused is True
    failing = FakeStructuredLLM("big", lambda s, u: LLMOutputError("still not JSON"))
    res2 = await HarnessRunner(max_repairs=0, escalation=lambda schema: failing).call(
        broken, "sys", "user", schema=TopicVerdict)
    assert res2.value is None and res2.refused is False


async def test_the_guard_turns_an_escalation_refusal_into_the_personal_message():
    broken = FakeStructuredLLM("small", lambda s, u: LLMOutputError("not JSON"))
    refusing = FakeStructuredLLM("big", lambda s, u: LLMRefusal("declined"))
    llms = _llms(guard=broken)
    llms.escalation = lambda schema: refusing
    out = await make_topic_guard(_deps(llms))({"topic": QUESTION, "language": "en"})
    assert out["rejected"] == safety.rejection_error("personal_medical")
    assert safety.refusal_code_of("rejected", out["rejected"]) == "personal_medical"
    assert "1669" in out["rejected"] and "1323" in out["rejected"] and "aspirin" not in out["rejected"]


async def test_an_escalation_that_only_fails_still_fails_the_review():
    broken = FakeStructuredLLM("small", lambda s, u: LLMOutputError("not JSON"))
    llms = _llms(guard=broken)
    llms.escalation = lambda schema: FakeStructuredLLM("big", lambda s, u: LLMOutputError("not JSON either"))
    with pytest.raises(LLMOutputError):
        await make_topic_guard(_deps(llms))({"topic": "statins", "language": "en"})


@pytest.mark.parametrize("topic", [
    "help my son swallowed a coin", "my kid ate rat poison", "my daughter swallowed 2 coins",
    "dog ate rat bait and my toddler too help", "my husband drank rat poison",
])
def test_a_swallowed_coin_or_rat_poison_is_an_emergency(topic):
    assert safety.red_flag(topic) == safety.Emergency("medical"), topic


@pytest.mark.parametrize("topic", [
    "coin ingestion in children", "swallowed coins in children: endoscopy or observation",
    "rat poison ingestion in children", "children who swallowed a coin", "brodifacoum rat poison exposure",
    "dogs that ate rat poison", "coin battery versus coin ingestion outcomes",
])
def test_coin_and_rat_poison_research_titles_are_not_refused(topic):
    assert safety.red_flag(topic) is None, topic
