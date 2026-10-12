import httpx
import pytest

from app.evals import models
from app.evals.models import Manifest, Stratum
from app.evals.select import CochraneEligibility, cochrane_id, select
from tests.fakes import FakeStructuredLLM
from tests.unit.test_review_graph import make_deps


@pytest.fixture(autouse=True)
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    return tmp_path


class FakeHttp:
    def __init__(self, records):
        self.records, self.calls = records, []

    async def get(self, url, params=None, **_):
        self.calls.append(params)
        body = {"hitCount": len(self.records), "resultList": {"result": self.records},
                "nextCursorMark": params.get("cursorMark")}
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


def bind(deps, responder):
    """The eligibility call asks for the planner's model bound to CochraneEligibility; record what was asked."""
    fake, asked = FakeStructuredLLM("plan", responder), []

    def for_schema(role, schema):
        asked.append((role, schema))
        return fake

    deps.llms.for_schema = for_schema
    return asked


def test_cochrane_id():
    assert cochrane_id("10.1002/14651858.CD012345.pub3") == "CD012345"


@pytest.mark.asyncio
async def test_select_draws_per_stratum_and_never_guesses_dates():
    deps = make_deps()
    bind(deps, judge)
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
    bind(deps, judge)
    records = [rec(i, "Search up to 2023") for i in range(1, 6)]
    a = await select(deps, FakeHttp(records), "u", Manifest(seed=9, per_stratum=3, strata=[Stratum(name="cv", query="x")]))
    b = await select(deps, FakeHttp(records), "u", Manifest(seed=9, per_stratum=3, strata=[Stratum(name="cv", query="x")]))
    assert [r.id for r in a.reviews] == [r.id for r in b.reviews]


@pytest.mark.asyncio
async def test_non_eligibility_value_is_excluded_not_a_crash():
    deps = make_deps()
    bind(deps, lambda s, u: "not a schema")
    http = FakeHttp([rec(1, "Search up to 2023")])
    out = await select(deps, http, "u", Manifest(seed=1, per_stratum=1, strata=[Stratum(name="cv", query="x")]))
    assert [(r.status, r.exclusion_reason) for r in out.reviews] == [("excluded", "model gave no answer")]


def rec_doi(doi, abstract="Search up to 2023"):
    return {"pmid": "p", "doi": doi, "title": "Review", "abstractText": abstract}


@pytest.mark.asyncio
async def test_two_versions_of_one_review_give_one_entry_with_the_newer_doi():
    deps = make_deps()
    bind(deps, judge)
    records = [rec_doi("10.1002/14651858.CD000001.pub2"), rec_doi("10.1002/14651858.CD000001.pub3")]
    out = await select(deps, FakeHttp(records), "u", Manifest(seed=1, per_stratum=3, strata=[Stratum(name="cv", query="x OR y")]))
    assert [(r.id, r.doi) for r in out.reviews] == [("CD000001", "10.1002/14651858.CD000001.pub3")]


@pytest.mark.asyncio
async def test_same_review_in_two_strata_lands_once_in_the_first_stratum():
    deps = make_deps()
    bind(deps, judge)
    http = FakeHttp([rec_doi("10.1002/14651858.CD000001.pub1")])
    m = Manifest(seed=1, per_stratum=1, strata=[Stratum(name="cv", query="heart"), Stratum(name="lung", query="lung")])
    out = await select(deps, http, "u", m)
    assert [(r.id, r.stratum) for r in out.reviews] == [("CD000001", "cv")]
    assert 'AND (heart)' in http.calls[0]["query"]


@pytest.mark.asyncio
async def test_draw_does_not_depend_on_input_order():
    deps = make_deps()
    bind(deps, judge)
    records = [rec(i, "Search up to 2023") for i in range(1, 7)]

    def m():
        return Manifest(seed=5, per_stratum=3, strata=[Stratum(name="cv", query="x")])

    a = await select(deps, FakeHttp(records), "u", m())
    b = await select(deps, FakeHttp(list(reversed(records))), "u", m())
    assert [r.id for r in a.reviews] == [r.id for r in b.reviews]


@pytest.mark.asyncio
async def test_frame_file_is_written_with_hit_count_and_draw_order(root):
    import json
    deps = make_deps()
    bind(deps, judge)
    records = [rec(i, "Search up to 2023") for i in range(1, 5)]
    out = await select(deps, FakeHttp(records), "u", Manifest(seed=2, per_stratum=2, strata=[Stratum(name="cv", query="x")]))
    data = json.loads((root / "frames" / "cv.json").read_text(encoding="utf-8"))
    assert data["hit_count"] == 4 and data["collected"] == 4 and data["run_date"]
    assert 'JOURNAL:"Cochrane' in data["query"]
    assert len(data["ids_in_draw_order"]) == 4 and data["ids_in_draw_order"][:2] == [r.id for r in out.reviews]


@pytest.mark.asyncio
async def test_continue_tops_up_only_the_missing_count():
    from app.evals.models import ManifestEntry
    deps = make_deps()
    bind(deps, judge)
    kept = [ManifestEntry(id=f"CD00000{i}", stratum="cv", title="t") for i in (1, 2)]
    kept.append(ManifestEntry(id="CD000003", stratum="cv", title="t", status="excluded", exclusion_reason="x"))
    records = [rec(i, "Search up to 2023") for i in range(1, 8)]
    m = Manifest(seed=4, per_stratum=3, strata=[Stratum(name="cv", query="x")], reviews=kept)
    out = await select(deps, FakeHttp(records), "u", m)
    assert [r.id for r in out.reviews[:3]] == ["CD000001", "CD000002", "CD000003"]
    new = out.reviews[3:]
    assert len(new) == 1 and new[0].status == "eligible"
    assert new[0].id not in {"CD000001", "CD000002", "CD000003"}


@pytest.mark.asyncio
async def test_eligibility_uses_the_planner_model_bound_to_the_eligibility_schema():
    deps = make_deps()
    asked = bind(deps, judge)
    await select(deps, FakeHttp([rec(1, "Search up to 2023")]), "u",
                 Manifest(seed=1, per_stratum=1, strata=[Stratum(name="cv", query="x")]))
    assert asked and set(asked) == {("planner", CochraneEligibility)}
    assert deps.llms.planner.calls == []  # the role's own LLM answers with a QueryPlan, never an eligibility verdict


def judge_every_third_excluded(system, user):
    n = int(user.split("Title: Review ")[1].split("\n")[0])
    if n % 3 == 0:
        return CochraneEligibility(eligible=False, reason="protocol", question="", primary_outcome="",
                                   search_date=None, review_type="slr", rct_count=None, grade_reported=False)
    return judge(system, user)


@pytest.mark.asyncio
async def test_a_resumed_select_gives_the_same_entries_as_an_uninterrupted_one():
    deps = make_deps()
    bind(deps, judge_every_third_excluded)
    records = [rec(i, "Search up to 2023") for i in range(1, 10)]

    def m(reviews=()):
        return Manifest(seed=7, per_stratum=4, reviews=list(reviews),
                        strata=[Stratum(name="cv", query="x"), Stratum(name="lung", query="y")])

    full = await select(deps, FakeHttp(records), "u", m())
    saved = []
    await select(deps, FakeHttp(records), "u", m(), on_entry=lambda manifest, entry: saved.append(manifest))
    assert len(saved) == len(full.reviews) and saved[-1].reviews == full.reviews  # saved after every judged record
    for k in range(len(full.reviews)):  # crashed after k records, in either stratum
        resumed = await select(deps, FakeHttp(records), "u", m(full.reviews[:k]))
        assert [(r.id, r.stratum, r.status) for r in resumed.reviews] == [
            (r.id, r.stratum, r.status) for r in full.reviews], k


@pytest.mark.asyncio
async def test_continue_refuses_when_the_draw_changed_since_the_stratum_started(root):
    deps = make_deps()
    bind(deps, judge)

    def m(reviews=()):
        return Manifest(seed=7, per_stratum=3, reviews=list(reviews), strata=[Stratum(name="cv", query="x")])

    first = await select(deps, FakeHttp([rec(i, "Search up to 2023") for i in range(1, 6)]), "u", m())
    partial = first.reviews[:1]
    same = await select(deps, FakeHttp([rec(i, "Search up to 2023") for i in range(1, 6)]), "u", m(partial))
    assert [r.id for r in same.reviews] == [r.id for r in first.reviews]
    frame_before = (root / "frames" / "cv.json").read_bytes()
    with pytest.raises(ValueError, match="draw order of cv changed"):  # Europe PMC added a record meanwhile
        await select(deps, FakeHttp([rec(i, "Search up to 2023") for i in range(1, 7)]), "u", m(partial))
    assert (root / "frames" / "cv.json").read_bytes() == frame_before  # the original draw stays on record


@pytest.mark.asyncio
async def test_a_fresh_run_over_a_stale_frame_file_passes_and_rewrites_it(root):
    import json
    deps = make_deps()
    bind(deps, judge)
    (root / "frames").mkdir()
    (root / "frames" / "cv.json").write_text(json.dumps({"ids_in_draw_order": ["CD999999"]}), encoding="utf-8")
    out = await select(deps, FakeHttp([rec(i, "Search up to 2023") for i in range(1, 4)]), "u",
                       Manifest(seed=1, per_stratum=2, strata=[Stratum(name="cv", query="x")]))  # select --force
    assert len([r for r in out.reviews if r.status == "eligible"]) == 2
    assert "CD999999" not in json.loads((root / "frames" / "cv.json").read_text(encoding="utf-8"))["ids_in_draw_order"]


@pytest.mark.asyncio
async def test_continue_leaves_a_full_stratum_alone_even_if_its_draw_drifted(root):
    deps = make_deps()
    bind(deps, judge)
    strata = [Stratum(name="cv", query="x"), Stratum(name="lung", query="y")]
    first = await select(deps, FakeHttp([rec(i, "Search up to 2023") for i in range(1, 6)]), "u",
                         Manifest(seed=3, per_stratum=2, strata=strata))
    cv_frame = (root / "frames" / "cv.json").read_bytes()
    partial = [r for r in first.reviews if r.stratum == "cv"] + [r for r in first.reviews if r.stratum == "lung"][:1]
    drifted = FakeHttp([rec(i, "Search up to 2023") for i in range(1, 8)])  # Europe PMC added records meanwhile
    with pytest.raises(ValueError, match="draw order of lung changed"):  # the stratum being topped up is guarded
        await select(deps, drifted, "u", Manifest(seed=3, per_stratum=2, strata=strata, reviews=partial))
    assert len(drifted.calls) == 1  # only lung was fetched
    assert (root / "frames" / "cv.json").read_bytes() == cv_frame  # the full stratum keeps its committed draw
