"""Plan 20 Task 10, items 1-2: meta-analysis recall (trial-name harvest, on-focus candidate cut) and Europe PMC
retries with backoff."""
import httpx
import pytest
import respx

from app.config import Settings
from app.graph.graph import GraphDeps
from app.graph.nodes.retrieval import (
    TRIAL_NAME_FRONT,
    focus_terms,
    harvest_trial_names,
    intervention_terms,
    make_enrich,
    make_search,
    on_focus,
)
from app.graph.schemas import Candidate
from app.harness.quality import summarize_quality
from app.services.europepmc import EuropePmcClient
from app.services.http import HttpClient

BASE = "https://epmc.test"
ABSTRACT = "Background. " + "Empagliflozin reduced hospitalization for heart failure in this trial. " * 4
QUESTION = {
    "intervention_or_exposure": "SGLT2 inhibitors (e.g., empagliflozin, dapagliflozin)",
    "key_terms": [
        {"term": "SGLT2 inhibitors", "mesh": "Sodium-Glucose Transporter 2 Inhibitors",
         "synonyms": ["gliflozins", "empagliflozin", "dapagliflozin"]},
        {"term": "hospitalization for heart failure", "mesh": "Heart Failure", "synonyms": ["HF hospitalization"]},
    ],
}


async def _nosleep(_):
    return None


def _ok(results=()):
    return httpx.Response(200, json={"resultList": {"result": list(results)}})


def _record(i):
    return {"id": str(i), "source": "MED", "pmid": str(i), "title": f"Trial {i}.", "abstractText": ABSTRACT,
            "pubYear": "2020", "pubTypeList": {"pubType": ["Randomized Controlled Trial"]}}


# ---- item 2: Europe PMC retries --------------------------------------------------------------------------------
@respx.mock
async def test_trial_search_retries_a_503_with_backoff():
    route = respx.get(f"{BASE}/search").mock(side_effect=[httpx.Response(503), _ok([_record(1)])])
    slept: list[float] = []

    async def sleep(s):
        slept.append(s)

    http = HttpClient(timeout=5, sleep=_nosleep)
    try:
        hits = await EuropePmcClient(http, BASE, sleep=sleep).search_trials("SGLT2 heart failure")
    finally:
        await http.aclose()
    assert route.call_count == 2 and len(hits) == 1
    assert slept == [EuropePmcClient.RETRY_DELAYS[0]]


@respx.mock
async def test_trial_search_drops_the_citation_sort_on_its_last_attempt_then_fails_soft_upstream():
    route = respx.get(f"{BASE}/search").mock(side_effect=[httpx.Response(503), httpx.Response(503),
                                                          _ok([_record(2)])])
    http = HttpClient(timeout=5, sleep=_nosleep)
    try:
        hits = await EuropePmcClient(http, BASE, sleep=_nosleep).search_trials("SGLT2 heart failure")
    finally:
        await http.aclose()
    assert route.call_count == 3 and [h.pmid for h in hits] == ["2"]
    assert [c.request.url.params.get("sort") for c in route.calls] == ["CITED desc", "CITED desc", None]


@respx.mock
async def test_trial_search_gives_up_after_two_retries():
    route = respx.get(f"{BASE}/search").mock(return_value=httpx.Response(503))
    http = HttpClient(timeout=5, sleep=_nosleep)
    try:
        with pytest.raises(httpx.HTTPStatusError):
            await EuropePmcClient(http, BASE, sleep=_nosleep).search_trials("SGLT2 heart failure")
    finally:
        await http.aclose()
    assert route.call_count == 3  # bounded: the first attempt plus two retries


async def test_a_timeout_is_retried_once_only():
    calls = []

    class Http:
        async def get(self, url, *, params=None, timeout=None, retries=None):
            calls.append(timeout)
            raise httpx.ReadTimeout("slow")

    with pytest.raises(httpx.ReadTimeout):
        await EuropePmcClient(Http(), BASE, sleep=_nosleep).search_trials("SGLT2 heart failure")
    assert len(calls) == 2


@respx.mock
async def test_a_client_error_is_not_retried():
    route = respx.get(f"{BASE}/search").mock(return_value=httpx.Response(400))
    http = HttpClient(timeout=5, sleep=_nosleep)
    try:
        with pytest.raises(httpx.HTTPStatusError):
            await EuropePmcClient(http, BASE, sleep=_nosleep).search_trials("SGLT2 heart failure")
    finally:
        await http.aclose()
    assert route.call_count == 1


@respx.mock
async def test_lookup_retries_and_skips_a_batch_that_keeps_failing():
    calls = {"n": 0}

    def answer(request):
        calls["n"] += 1
        if 'DOI:"10.1/0"' in request.url.params["query"]:  # the first batch is down for good
            return httpx.Response(503)
        return _ok([_record(7)])

    respx.get(f"{BASE}/search").mock(side_effect=answer)
    http = HttpClient(timeout=5, sleep=_nosleep)
    failures: list[str] = []
    try:
        out = await EuropePmcClient(http, BASE, sleep=_nosleep).lookup(
            dois=[f"10.1/{i}" for i in range(45)], pmids=[], failures=failures)
    finally:
        await http.aclose()
    assert [c.pmid for c in out] == ["7"]
    assert failures == ["HTTPStatusError"] and calls["n"] == 3 + 1


@respx.mock
async def test_lookup_raises_when_every_batch_failed():
    respx.get(f"{BASE}/search").mock(return_value=httpx.Response(503))
    http = HttpClient(timeout=5, sleep=_nosleep)
    try:
        with pytest.raises(httpx.HTTPStatusError):
            await EuropePmcClient(http, BASE, sleep=_nosleep).lookup(dois=["10.1/a"], pmids=[])
    finally:
        await http.aclose()


class FailingLookup:
    def __init__(self, mode):
        self.mode = mode

    async def lookup(self, *, dois, pmids, failures=None):
        if self.mode == "all":
            raise httpx.HTTPStatusError("503", request=httpx.Request("GET", BASE), response=httpx.Response(503))
        failures.append("HTTPStatusError")
        return []


@pytest.mark.parametrize("mode", ["all", "some"])
async def test_enrich_fails_soft_and_logs_europe_pmc_failures(mode):
    raw = [Candidate(title="Empagliflozin trial in heart failure", doi="10.1/x", abstract=ABSTRACT,
                     abstract_source="engine", engines=["pubmed"]).model_dump()]
    deps = GraphDeps(settings=Settings(_env_file=None), europepmc=FailingLookup(mode))
    out = await make_enrich(deps)({"candidates": raw, "options": {}})
    assert len(out["candidates"]) == 1  # the search hit is kept
    assert any("Europe PMC enrichment failed" in e for e in out["errors"])
    assert out["quality"][0]["europepmc_failed"] == 1
    assert summarize_quality(out["quality"], None)["europepmc_failures"] == 1


# ---- item 1: trial-name harvest ----------------------------------------------------------------------------------
def _cand(title, abstract="", **kw):
    return Candidate(title=title, abstract=abstract or None, **kw)


def test_harvest_trial_names_needs_a_trial_context_and_two_papers():
    cands = [
        _cand("Insights from the EMPEROR-Reduced trial", "In the DAPA-HF trial and the EMPA-REG OUTCOME trial ..."),
        _cand("Pooled analysis", "Data from EMPEROR-Reduced and DAPA-HF trials (DECLARE-TIMI 58 trial excluded)."),
        _cand("Review", "Large trials (EMPA-REG OUTCOME, CANVAS) ... the DECLARE-TIMI 58 study and the "
                        "Empagliflozin outcome trial (EMPA-REG OUTCOME)."),
        _cand("COVID-19 study of GLP-1 users", "The COVID-19 study and the NHANES study; HFPEF trials; OUTCOME trial."),
        _cand("Another COVID-19 study", "A COVID-19 study; CVOT trials; NCT01234567 study."),
    ]
    names = harvest_trial_names(cands)
    # two papers each; ties keep first-seen order. EMPEROR-Reduced is named in a trial context by one paper only,
    # CANVAS never; COVID-19, NHANES, HFPEF, OUTCOME, CVOT and registry numbers are no trial names.
    assert names == ["DAPA-HF", "EMPA-REG OUTCOME", "DECLARE-TIMI 58"]
    assert harvest_trial_names(cands, min_docs=1)[3] == "EMPEROR-Reduced"
    assert harvest_trial_names(cands, limit=1) == ["DAPA-HF"]


def test_intervention_terms_come_from_the_matching_key_terms():
    terms = intervention_terms(QUESTION)
    assert terms[:2] == ["SGLT2 inhibitors", "Sodium-Glucose Transporter 2 Inhibitors"]
    assert "empagliflozin" in terms and "Heart Failure" not in terms
    assert intervention_terms({"intervention_or_exposure": "metformin, sulfonylurea (glipizide)"}) == [
        "metformin", "sulfonylurea", "glipizide"]
    assert intervention_terms(None) == []


@respx.mock
async def test_trial_name_search_requires_the_intervention_terms():
    route = respx.get(f"{BASE}/search").mock(return_value=_ok())
    http = HttpClient(timeout=5, sleep=_nosleep)
    try:
        client = EuropePmcClient(http, BASE, sleep=_nosleep)
        assert await client.search_trial_names(["DAPA-HF"], []) == []
        await client.search_trial_names(['DAPA-HF"', "DELIVER"], ["SGLT2 inhibitors", "dapagliflozin"])
    finally:
        await http.aclose()
    assert route.call_count == 1
    assert route.calls[0].request.url.params["query"] == (
        '("DAPA-HF" OR "DELIVER") AND ("SGLT2 inhibitors" OR "dapagliflozin") AND '
        'PUB_TYPE:"Randomized Controlled Trial" AND HAS_ABSTRACT:y')


class Searx:
    def __init__(self, hits):
        self.hits = hits

    async def search(self, query, pageno=1):
        return self.hits if pageno == 1 else []


class NamesEpmc:
    def __init__(self, landmark, fail=False):
        self.landmark, self.fail, self.name_calls = landmark, fail, []

    async def search_trials(self, query, *, page_size=25):
        return []

    async def search_trial_names(self, names, terms, *, page_size=25):
        self.name_calls.append((list(names), list(terms)))
        if self.fail:
            raise httpx.ConnectError("down")
        return self.landmark


async def test_search_front_loads_the_trial_name_hits_for_a_meta_analysis():
    sx = [_cand(f"Secondary analysis {i} of the DAPA-HF trial", ABSTRACT, doi=f"10.1/s{i}", engines=["pubmed"])
          for i in range(20)]
    landmark = [_cand(f"Landmark trial {i}", ABSTRACT, doi=f"10.1/l{i}", engines=["europe pmc"])
                for i in range(TRIAL_NAME_FRONT + 2)]
    epmc = NamesEpmc(landmark)
    deps = GraphDeps(settings=Settings(_env_file=None), searxng=Searx(sx), europepmc=epmc)
    out = await make_search(deps)({"plan": {"queries": ["SGLT2 heart failure"]}, "question": QUESTION,
                                   "options": {"review_type": "meta_analysis", "study_types": ["RCT"]}})
    titles = [c["title"] for c in out["candidates"]]
    assert titles[:TRIAL_NAME_FRONT] == [f"Landmark trial {i}" for i in range(TRIAL_NAME_FRONT)]
    assert "Landmark trial 11" in titles  # the rest joins the round-robin
    assert epmc.name_calls == [(["DAPA-HF"], intervention_terms(QUESTION))]
    q = out["quality"][0]
    assert q["trial_names"] == ["DAPA-HF"] and q["trial_name_hits"] == TRIAL_NAME_FRONT + 2
    assert out["search_stats"]["per_source"]["europe pmc (rct search)"] == TRIAL_NAME_FRONT + 2
    summary = summarize_quality(out["quality"], None)["trial_search"]
    assert summary["names"] == ["DAPA-HF"] and summary["failed"] == 0


async def test_a_failed_trial_name_search_is_logged_and_the_search_goes_on():
    sx = [_cand(f"Secondary analysis {i} of the DAPA-HF trial", ABSTRACT, doi=f"10.1/s{i}", engines=["pubmed"])
          for i in range(3)]
    deps = GraphDeps(settings=Settings(_env_file=None), searxng=Searx(sx), europepmc=NamesEpmc([], fail=True))
    out = await make_search(deps)({"plan": {"queries": ["SGLT2 heart failure"]}, "question": QUESTION,
                                   "options": {"review_type": "meta_analysis"}})
    assert len(out["candidates"]) == 3
    assert out["errors"] == ["Europe PMC trial-name search failed: ConnectError"]
    assert summarize_quality(out["quality"], None)["europepmc_failures"] == 1


async def test_no_trial_name_search_outside_meta_analysis():
    sx = [_cand("Secondary analysis of the DAPA-HF trial", ABSTRACT, engines=["pubmed"]),
          _cand("Another DAPA-HF trial analysis", ABSTRACT, engines=["pubmed"])]
    epmc = NamesEpmc([])
    deps = GraphDeps(settings=Settings(_env_file=None), searxng=Searx(sx), europepmc=epmc)
    out = await make_search(deps)({"plan": {"queries": ["q"]}, "question": QUESTION,
                                   "options": {"review_type": "slr"}})
    assert epmc.name_calls == [] and "trial_names" not in out["quality"][0]


# ---- item 1: on-focus candidate cut ------------------------------------------------------------------------------
def test_on_focus_matches_key_terms_with_plurals_and_digit_spacing():
    terms = focus_terms(QUESTION)
    assert on_focus(_cand("SGLT-2 inhibitor use and outcomes"), terms)
    assert on_focus(_cand("Outcomes", "Patients admitted with heart failures were ..."), terms)
    assert not on_focus(_cand("Call admission control for HF radio networks", "Wireless networks ..."), terms)
    assert focus_terms(None) == []


async def test_enrich_moves_off_focus_hits_behind_the_on_topic_ones():
    class NoLookup:
        async def lookup(self, *, dois, pmids, failures=None):
            return []

    raw = [Candidate(title="Admission control in wireless networks", doi="10.1/w", abstract=ABSTRACT.replace(
        "Empagliflozin reduced hospitalization for heart failure", "A scheduler improved throughput"),
        abstract_source="engine", engines=["arxiv"]).model_dump(),
        Candidate(title="Dapagliflozin in heart failure", doi="10.1/d", abstract=ABSTRACT, abstract_source="engine",
                  engines=["pubmed"]).model_dump()]
    deps = GraphDeps(settings=Settings(_env_file=None), europepmc=NoLookup())
    out = await make_enrich(deps)({"candidates": raw, "question": QUESTION, "options": {"candidate_limit": 20}})
    assert [c["doi"] for c in out["candidates"]] == ["10.1/d", "10.1/w"]  # demoted, never dropped
    assert out["quality"][0]["off_focus"] == 1
    out = await make_enrich(deps)({"candidates": raw, "options": {"candidate_limit": 20}})  # no refined question
    assert [c["doi"] for c in out["candidates"]] == ["10.1/w", "10.1/d"]
