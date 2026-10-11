import httpx
import pytest

from app.evals.models import Manifest, Stratum
from app.evals.select import CochraneEligibility, cochrane_id, select
from tests.fakes import FakeStructuredLLM
from tests.unit.test_review_graph import make_deps


class FakeHttp:
    def __init__(self, records):
        self.records, self.calls = records, []

    async def get(self, url, params=None, **_):
        self.calls.append(params)
        body = {"resultList": {"result": self.records}, "nextCursorMark": params.get("cursorMark")}
        return httpx.Response(200, json=body, request=httpx.Request("GET", url))


def rec(i, abstract):
    return {"pmid": str(i), "doi": f"10.1002/14651858.CD00000{i}.pub2", "title": f"Review {i}", "abstractText": abstract}


def judge(system, user):
    if "no search date" in user:
        return CochraneEligibility(eligible=True, reason="", question="q", primary_outcome="death", search_date=None,
                                   review_type="slr", rct_count=5, grade_reported=True)
    return CochraneEligibility(eligible=True, reason="", question="In adults, does A reduce death?",
                               primary_outcome="death", search_date="2023-04-30", review_type="meta_analysis",
                               rct_count=12, grade_reported=True)


def test_cochrane_id():
    assert cochrane_id("10.1002/14651858.CD012345.pub3") == "CD012345"


@pytest.mark.asyncio
async def test_select_draws_per_stratum_and_never_guesses_dates():
    deps = make_deps()
    deps.llms.planner = FakeStructuredLLM("plan", judge)
    http = FakeHttp([rec(1, "Search up to April 2023 ..."), rec(2, "no search date stated"), rec(3, "Searched 2023")])
    m = Manifest(seed=3, per_stratum=3, strata=[Stratum(name="cv", query="heart")])
    out = await select(deps, http, "https://epmc", m)
    eligible = [r for r in out.reviews if r.status == "eligible"]
    excluded = [r for r in out.reviews if r.status == "excluded"]
    assert len(eligible) == 2 and all(r.year_to == 2023 for r in eligible)
    assert [r.exclusion_reason for r in excluded] == ["no search date"]
    assert all(not r.checked_by_owner for r in out.reviews)
    assert 'JOURNAL:"Cochrane Database Syst Rev"' in http.calls[0]["query"]


@pytest.mark.asyncio
async def test_same_seed_same_order():
    deps = make_deps()
    deps.llms.planner = FakeStructuredLLM("plan", judge)
    records = [rec(i, "Search up to 2023") for i in range(1, 6)]
    a = await select(deps, FakeHttp(records), "u", Manifest(seed=9, per_stratum=3, strata=[Stratum(name="cv", query="x")]))
    b = await select(deps, FakeHttp(records), "u", Manifest(seed=9, per_stratum=3, strata=[Stratum(name="cv", query="x")]))
    assert [r.id for r in a.reviews] == [r.id for r in b.reviews]


@pytest.mark.asyncio
async def test_non_eligibility_value_is_excluded_not_a_crash():
    deps = make_deps()
    deps.llms.planner = FakeStructuredLLM("plan", lambda s, u: "not a schema")
    http = FakeHttp([rec(1, "Search up to 2023")])
    out = await select(deps, http, "u", Manifest(seed=1, per_stratum=1, strata=[Stratum(name="cv", query="x")]))
    assert [(r.status, r.exclusion_reason) for r in out.reviews] == [("excluded", "model gave no answer")]
