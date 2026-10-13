"""Plan 27: the quick answer outside the web page: quick_view, the Markdown export, the MCP quick_answer tool, and the
stub graph's quick shape."""
import json
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

from fastmcp import Client

from app.db.repositories import ReviewRepository
from app.graph.nodes.stub_result import stub_result
from app.schemas.review import ReviewOptions
from app.services.report import quick_view, render_markdown
from tests.unit.test_stub_timeline import run as run_stub

PAPERS = [
    {"ref": "P1", "title": "Metformin and colorectal cancer in a cohort", "authors": ["Lee A"], "year": 2020,
     "journal": "Gut", "doi": "10.1000/p1", "pmid": "111"},
    {"ref": "P2", "title": "Not cited", "year": 2019},
    {"ref": "P3", "title": "บทความวารสารไทย", "year": 2022,
     "thaijo_url": "https://so01.tci-thaijo.org/index.php/jmed/article/view/12345"},
]
QUICK_RESULT = {
    "mode": "quick", "quick": {"refs": ["P3", "P1"], "papers_read": 3}, "papers": PAPERS,
    "summary": "ผลลดลง [P3] และสอดคล้องกัน [P1, P3]",
    "synthesis": {"executive_summary": "ผลลดลง [P3] และสอดคล้องกัน [P1, P3]", "evidence_strength": "low",
                  "answer": "ความเชื่อมั่นต่ำ"},
    "question": {"refined_question": "Does metformin lower colorectal cancer risk?"},
}


def data(result):
    return json.loads(result.content[0].text)


def test_quick_view_numbers_the_references_by_first_citation_with_their_links():
    view = quick_view(QUICK_RESULT)
    assert view["answer"] == "ผลลดลง [1] และสอดคล้องกัน [2, 1]"
    assert (view["closing"], view["certainty"], view["papers_read"]) == ("ความเชื่อมั่นต่ำ", "low", 3)
    assert [(r["n"], r["ref"]) for r in view["references"]] == [(1, "P3"), (2, "P1")]
    assert view["references"][0]["links"] == [{"label": "ThaiJO", "url": PAPERS[2]["thaijo_url"]}]
    assert view["references"][1]["links"] == [{"label": "doi", "url": "https://doi.org/10.1000/p1"},
                                              {"label": "PMID", "url": "https://pubmed.ncbi.nlm.nih.gov/111/"}]
    assert view["references"][1]["citation"].startswith("Lee A. Metformin and colorectal cancer in a cohort.")


def test_quick_view_drops_a_ref_it_cannot_number():
    result = {**QUICK_RESULT, "summary": "ผล [P2] และ [P1, P9]"}
    assert quick_view(result)["answer"] == "ผล  และ [2]"


def test_the_markdown_export_of_a_quick_answer_is_the_answer_and_its_references():
    review = SimpleNamespace(topic="เมตฟอร์มิน", status="done", error=None, result=QUICK_RESULT)
    md = render_markdown(review)
    assert md.startswith("# Quick answer: เมตฟอร์มิน\n")
    assert "ผลลดลง [1] และสอดคล้องกัน [2, 1]" in md and "ความเชื่อมั่นต่ำ" in md
    assert "abstracts of 3 studies" in md and "not a full systematic review" in md
    assert "1. บทความวารสารไทย. 2022. ThaiJO: [" in md and "2. Lee A." in md
    assert "## Summary" not in md and "## Comparison" not in md


def test_a_full_review_keeps_its_markdown():
    review = SimpleNamespace(topic="t", status="done", error=None,
                             result={"mode": "full", "summary": "S [P1].", "synthesis": {}, "papers": []})
    assert render_markdown(review).startswith("# Literature review: t\n")


# ---- MCP ----------------------------------------------------------------------------------------------------------
async def test_quick_answer_is_a_listed_tool_with_its_bounds(app):
    from app.mcp.server import INSTRUCTIONS, QUICK_WAIT_MAX
    async with Client(app.state.mcp) as c:
        tool = next(t for t in await c.list_tools() if t.name == "quick_answer")
    assert "8" in tool.description and "30" in tool.description and str(QUICK_WAIT_MAX) in tool.description
    assert "quick_answer" in INSTRUCTIONS


async def test_quick_answer_without_waiting_starts_a_quick_review(app, client, queue):
    async with Client(app.state.mcp) as c:
        out = data(await c.call_tool("quick_answer", {"topic": "metformin and colorectal cancer",
                                                      "language": "en", "wait_seconds": 0}))
    assert out["status"] == "queued" and "still running" in out["message"]
    assert queue.enqueued == [out["review_id"]]
    options = (await client.get(f"/api/v1/reviews/{out['review_id']}")).json()["options"]
    assert (options["mode"], options["max_papers"], options["candidate_limit"]) == ("quick", 8, 30)


async def test_quick_answer_returns_the_numbered_answer_once_done(app, session_factory):
    async with Client(app.state.mcp) as c:
        first = data(await c.call_tool("quick_answer", {"topic": "metformin and colorectal cancer",
                                                        "wait_seconds": 0}))
        async with session_factory() as s, s.begin():
            await ReviewRepository(s).update(uuid.UUID(first["review_id"]), status="done", result=QUICK_RESULT,
                                             finished_at=datetime.now(UTC))
        again = data(await c.call_tool("quick_answer", {"topic": "metformin and colorectal cancer",
                                                        "wait_seconds": 5}))
    assert again["review_id"] == first["review_id"] and again["cached"] is True and again["status"] == "done"
    assert again["answer"] == "ผลลดลง [1] และสอดคล้องกัน [2, 1]"
    assert [r["ref"] for r in again["references"]] == ["P3", "P1"]


async def test_quick_answer_waits_until_the_review_finishes(app, session_factory, monkeypatch):
    from app.mcp import server
    slept = []

    async def finish(seconds):  # the worker finishes the review while the tool waits
        slept.append(seconds)
        async with session_factory() as s, s.begin():
            await ReviewRepository(s).update(rid[0], status="done", result=QUICK_RESULT,
                                             finished_at=datetime.now(UTC))

    rid: list[uuid.UUID] = []
    real_create = app.state.deps.service.create

    async def remember(req, **kw):
        created = await real_create(req, **kw)
        rid.append(created.review_id)
        return created

    monkeypatch.setattr(app.state.deps.service, "create", remember)
    monkeypatch.setattr(server, "_sleep", finish)
    async with Client(app.state.mcp) as c:
        out = data(await c.call_tool("quick_answer", {"topic": "statins and dementia risk", "wait_seconds": 30}))
    assert slept == [server.QUICK_POLL_SECONDS] and out["status"] == "done" and out["references"]


async def test_quick_answer_refuses_an_emergency_like_start_review(app, queue):
    async with Client(app.state.mcp) as c:
        out = data(await c.call_tool("quick_answer", {"topic": "I want to kill myself", "language": "en"}))
    assert out["status"] == "refused" and out["code"] == "emergency" and out["review_id"] is None
    assert queue.enqueued == []


# ---- the stub --------------------------------------------------------------------------------------------------
def test_the_stub_result_has_the_quick_shape():
    r = stub_result("statins", "en", "slr", ReviewOptions(mode="quick"))
    assert r["mode"] == "quick" and r["quick"] == {"refs": ["P1", "P3", "P4"], "papers_read": 5}
    assert r["summary"].endswith("[P4].") and r["synthesis"]["answer"].startswith("The certainty of the evidence")
    assert r["synthesis"]["key_findings"] == [] and r["citations"] is None and r["support"] is None
    assert (r["stats"]["candidates"], r["stats"]["excluded_selection"]["requested"]) == (30, 8)
    full = stub_result("statins", "en", "slr", ReviewOptions())
    assert full["mode"] == "full" and full["quick"] is None and full["citations"] is not None


async def test_the_timed_stub_runs_a_quick_answer_without_citation_events():
    events, _elapsed, state = await run_stub(options={"mode": "quick"}, delay=0.2)
    types = [e["type"] for _t, e in events]
    assert "citations_fetched" not in types and "finalizing" in types
    assert state.values["result"]["mode"] == "quick"


async def test_the_plain_stub_marks_a_quick_answer():
    _events, _elapsed, state = await run_stub(options={"mode": "quick"}, delay=0)
    assert state.values["result"]["mode"] == "quick" and state.values["result"]["quick"]["refs"] == []


def test_a_quick_answer_without_papers_has_no_closing_and_no_certainty():
    result = {"mode": "quick", "quick": {"refs": [], "papers_read": 0}, "papers": [],
              "summary": "No relevant papers were found.",
              "synthesis": {"executive_summary": "No relevant papers were found.", "evidence_strength": None,
                            "answer": ""}}
    view = quick_view(result)
    assert (view["closing"], view["certainty"], view["references"]) == ("", None, [])
    md = render_markdown(SimpleNamespace(topic="t", status="done", error=None, result=result))
    assert md.count("No relevant papers were found.") == 1 and "very_low" not in md
