"""Plan 27: the quick answer mode as a request option: fixed sizes, the cache key, the cost cap, /status and MCP."""
import json

import pytest
from fastmcp import Client

from app.config import Settings
from app.schemas.review import (
    QUICK_CANDIDATE_LIMIT,
    QUICK_MAX_PAPERS,
    REVIEW_MODES,
    CreateReviewRequest,
    ReviewOptions,
    compute_cache_key,
    is_quick,
)
from app.services.budget import review_cost_cap, worst_case_review_cap
from tests.unit.test_review_service import ANON, service


def data(result):
    return json.loads(result.content[0].text)


def test_the_quick_sizes_are_eight_of_thirty_and_full_is_the_default():
    assert (QUICK_MAX_PAPERS, QUICK_CANDIDATE_LIMIT) == (8, 30)
    assert REVIEW_MODES == ("full", "quick")
    assert ReviewOptions().mode == "full"
    assert ReviewOptions.bound("max_papers", "ge") <= QUICK_MAX_PAPERS <= ReviewOptions.bound("max_papers")
    assert ReviewOptions.bound("candidate_limit", "ge") <= QUICK_CANDIDATE_LIMIT <= ReviewOptions.bound("candidate_limit")


def test_a_quick_request_gets_the_fixed_sizes_and_a_graded_type_whatever_it_sends():
    o = ReviewOptions.model_validate({"mode": "quick", "max_papers": 50, "candidate_limit": 120,
                                      "review_type": "meta_analysis", "year_from": 2015, "study_types": ["rct"]})
    assert (o.mode, o.max_papers, o.candidate_limit, o.review_type) == ("quick", 8, 30, "slr")
    assert (o.year_from, o.study_types) == (2015, ["RCT"])  # the user's eligibility still applies


def test_a_full_request_keeps_what_it_sends():
    o = ReviewOptions.model_validate({"mode": "full", "max_papers": 12, "review_type": "scoping"})
    assert (o.mode, o.max_papers, o.candidate_limit, o.review_type) == ("full", 12, 120, "scoping")


def test_an_unknown_mode_is_rejected_by_rest_and_clamped_from_old_state():
    with pytest.raises(ValueError):
        ReviewOptions.model_validate({"mode": "instant"})
    assert ReviewOptions.clamped({"max_papers": 3}).mode == "full"  # graph state from before Plan 27
    assert ReviewOptions.clamped({"mode": "quick", "max_papers": 3}).max_papers == QUICK_MAX_PAPERS


def test_is_quick_reads_the_stored_options():
    assert is_quick({"mode": "quick"}) and not is_quick({"mode": "full"})
    assert not is_quick({}) and not is_quick(None)


def test_the_mode_is_part_of_the_cache_key():
    full = CreateReviewRequest(topic="statins and dementia").options.model_dump()
    quick = CreateReviewRequest(topic="statins and dementia", options={"mode": "quick"}).options.model_dump()
    assert full["mode"] == "full" and quick["mode"] == "quick"
    assert compute_cache_key("statins and dementia", "th", full, "v") != \
        compute_cache_key("statins and dementia", "th", quick, "v")


def test_the_quick_cost_cap_comes_from_the_same_formula_with_the_quick_sizes():
    s = Settings(_env_file=None)
    quick = review_cost_cap(s, ReviewOptions(mode="quick"))
    assert quick == pytest.approx(s.review_cost_base_usd + s.review_cost_per_paper_usd * QUICK_MAX_PAPERS
                                  + s.review_cost_per_candidate_usd * QUICK_CANDIDATE_LIMIT)
    assert quick == pytest.approx(0.103)
    assert quick < review_cost_cap(s, ReviewOptions()) < worst_case_review_cap(s)


async def test_a_quick_request_is_stored_with_its_mode_and_fixed_sizes(session_factory, redis):
    svc = service(session_factory, redis)
    created = await svc.create(CreateReviewRequest(topic="statins and dementia", options={"mode": "quick"}),
                               identity=ANON)
    review = await svc.get(created.review_id)
    assert review.options["mode"] == "quick"
    assert (review.options["max_papers"], review.options["candidate_limit"]) == (8, 30)


async def test_quick_and_full_answers_to_one_topic_are_separate_reviews(session_factory, redis):
    svc = service(session_factory, redis, review_rate_limit="10/minute")
    full = await svc.create(CreateReviewRequest(topic="statins and dementia"), identity=ANON)
    quick = await svc.create(CreateReviewRequest(topic="statins and dementia", options={"mode": "quick"}),
                             identity=ANON)
    again = await svc.create(CreateReviewRequest(topic="statins and dementia", options={"mode": "quick"}),
                             identity=ANON)
    assert quick.review_id != full.review_id and quick.cached is False
    assert again.cached is True and again.review_id == quick.review_id


async def test_a_quick_request_counts_against_the_same_hourly_limit(session_factory, redis):
    from app.services.review_service import RateLimited
    svc = service(session_factory, redis, review_rate_limit="1/minute")
    await svc.create(CreateReviewRequest(topic="statins and dementia", options={"mode": "quick"}), identity=ANON)
    with pytest.raises(RateLimited):
        await svc.create(CreateReviewRequest(topic="aspirin and stroke"), identity=ANON)


async def test_status_lists_the_modes_and_the_quick_sizes(client):
    limits = (await client.get("/api/v1/status")).json()["limits"]
    assert limits["modes"] == ["full", "quick"]
    assert limits["quick"] == {"max_papers": 8, "candidate_limit": 30, "review_type": "slr"}


async def test_rest_accepts_a_quick_request(client):
    res = await client.post("/api/v1/reviews", json={"topic": "statins and dementia", "options": {"mode": "quick"}})
    assert res.status_code == 202
    got = (await client.get(f"/api/v1/reviews/{res.json()['review_id']}")).json()
    assert got["options"]["mode"] == "quick" and got["options"]["max_papers"] == 8
    bad = await client.post("/api/v1/reviews", json={"topic": "statins and stroke", "options": {"mode": "fast"}})
    assert bad.status_code == 422


async def test_mcp_start_review_takes_the_mode(app, client):
    async with Client(app.state.mcp) as c:
        tool = next(t for t in await c.list_tools() if t.name == "start_review")
        quick = data(await c.call_tool("start_review", {"topic": "statins and dementia risk", "mode": "quick",
                                                        "max_papers": 40, "review_type": "scoping"}))
        full = data(await c.call_tool("start_review", {"topic": "aspirin and colorectal adenoma"}))
    assert tool.input_schema["properties"]["mode"]["enum"] == ["full", "quick"]
    assert "quick" in tool.description and str(QUICK_MAX_PAPERS) in tool.description
    q = (await client.get(f"/api/v1/reviews/{quick['review_id']}")).json()["options"]
    f = (await client.get(f"/api/v1/reviews/{full['review_id']}")).json()["options"]
    assert (q["mode"], q["max_papers"], q["review_type"]) == ("quick", 8, "slr")
    assert (f["mode"], f["max_papers"]) == ("full", 30)
