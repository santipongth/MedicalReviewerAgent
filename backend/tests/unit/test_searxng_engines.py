"""Parsing tests for our SearXNG engine modules (infra/searxng/engines), run without SearXNG.

The modules import ``searx.result_types`` / ``searx.network``; a tiny stub stands in for them.
Fixtures are trimmed live responses recorded on 2026-10-10 (``tests/fixtures/searxng_engines``),
except ``s2_graph.json`` (hand-written to the Graph API schema: a keyed call is needed to record it).
"""

from __future__ import annotations

import importlib.util
import json
import sys
import types
from datetime import date
from pathlib import Path
from typing import Any

import pytest

ENGINES = Path(__file__).resolve().parents[3] / "infra" / "searxng" / "engines"
FIX = Path(__file__).parent.parent / "fixtures" / "searxng_engines"

pytestmark = pytest.mark.skipif(not ENGINES.is_dir(), reason="infra/searxng/engines not present")


class _Results(list):
    types = types.SimpleNamespace(Paper=lambda **kw: kw)

    def add(self, item: Any) -> None:
        self.append(item)


class _Resp:
    def __init__(self, status: int = 200, content: bytes = b"", url: str = "", search_params=None):
        self.status_code = status
        self.content = content
        self.url = url
        self.search_params = search_params or {"pageno": 1}

    def json(self) -> Any:
        return json.loads(self.content)


@pytest.fixture
def searx_stub(monkeypatch):
    calls: list[str] = []
    replies: list[_Resp] = []

    def get(url: str, **_kw: Any) -> _Resp:
        calls.append(url)
        return replies.pop(0)

    searx = types.ModuleType("searx")
    result_types = types.ModuleType("searx.result_types")
    result_types.EngineResults = _Results
    network = types.ModuleType("searx.network")
    network.get = get
    monkeypatch.setitem(sys.modules, "searx", searx)
    monkeypatch.setitem(sys.modules, "searx.result_types", result_types)
    monkeypatch.setitem(sys.modules, "searx.network", network)
    return types.SimpleNamespace(calls=calls, replies=replies)


def load(name: str):
    spec = importlib.util.spec_from_file_location(f"mra_engine_{name}", ENGINES / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fixture_json(name: str) -> Any:
    return json.loads((FIX / name).read_text(encoding="utf-8"))


def params(pageno: int = 1) -> dict[str, Any]:
    return {"pageno": pageno, "headers": {}, "language": "all"}


# --- PubMed ---------------------------------------------------------------------------------

def test_pubmed_parses_whole_structured_abstract(searx_stub):
    m = load("mra_pubmed")
    papers = m.parse_efetch((FIX / "pubmed_efetch.xml").read_bytes())
    assert [p["url"] for p in papers] == [
        "https://pubmed.ncbi.nlm.nih.gov/29954001/",
        "https://pubmed.ncbi.nlm.nih.gov/32592092/",
        "https://pubmed.ncbi.nlm.nih.gov/31831021/",
    ]
    meta = papers[1]
    assert meta["doi"] == "10.1007/s00384-020-03676-x"
    assert meta["journal"] == "International journal of colorectal disease"
    assert meta["authors"][0] == "Cheng-Ann Winston Ng"
    assert meta["publishedDate"].date() == date(2020, 6, 26)  # ArticleDate (electronic)
    # Every section survives (the fork kept only the first text node), with its label.
    for label in ("PURPOSE:", "METHODS:", "RESULTS:", "CONCLUSION:"):
        assert label in meta["content"]
    assert "RR 0.76, CI 0.69-0.84" in meta["content"]
    assert "Meta-Analysis" in meta["type"]
    # No "accepted" history date: falls back to ArticleDate instead of None.
    assert papers[0]["publishedDate"].date() == date(2018, 6, 28)
    assert all(len(p["content"]) >= 150 for p in papers)


def test_pubmed_urls_carry_optional_key(searx_stub, monkeypatch):
    m = load("mra_pubmed")
    monkeypatch.delenv("NCBI_API_KEY", raising=False)
    url = m.esearch_url("metformin colorectal cancer", 2)
    assert "api_key" not in url and "tool=medical-reviewer-agent" in url
    assert "retstart=10" in url and "retmax=10" in url and "retmode=json" in url
    monkeypatch.setenv("NCBI_API_KEY", "k123")
    assert "api_key=k123" in m.efetch_url(["1", "2"]) and "id=1%2C2" in m.efetch_url(["1", "2"])


def test_pubmed_request_retries_429_and_skips_empty(searx_stub, monkeypatch):
    m = load("mra_pubmed")
    monkeypatch.setattr(m.time, "sleep", lambda _s: None)
    esearch = (FIX / "pubmed_esearch.json").read_text(encoding="utf-8")
    ids = m.parse_esearch(esearch)
    assert ids == ["29954001", "32592092", "31831021"]
    searx_stub.replies.extend([_Resp(429), _Resp(200, esearch.encode())])
    p = params()
    m.request("metformin", p)
    assert len(searx_stub.calls) == 2
    assert p["url"].startswith(m.eutils_api + "/efetch.fcgi") and p["raise_for_httperror"] is False

    searx_stub.replies.append(_Resp(200, b'{"esearchresult": {"idlist": []}}'))
    p = params()
    m.request("no such topic", p)
    assert p["url"] is None

    searx_stub.replies.extend([_Resp(429)] * 3)
    p = params()
    m.request("still limited", p)
    assert p["url"] is None  # gives up quietly: a 429 must never suspend the engine


def test_pubmed_response_retries_429(searx_stub, monkeypatch):
    m = load("mra_pubmed")
    monkeypatch.setattr(m.time, "sleep", lambda _s: None)
    efetch = (FIX / "pubmed_efetch.xml").read_bytes()
    searx_stub.replies.append(_Resp(200, efetch))
    res = m.response(_Resp(429, b"", url="https://eutils.example/efetch"))
    assert len(res) == 3 and searx_stub.calls == ["https://eutils.example/efetch"]
    assert len(m.response(_Resp(500, b"oops"))) == 0


# --- Europe PMC -----------------------------------------------------------------------------

def test_europepmc_parse(searx_stub):
    m = load("europepmc")
    papers = m.parse(fixture_json("europepmc.json"))
    preprint, pmc, med = papers
    assert preprint["url"] == "https://europepmc.org/article/PPR/PPR1307357"
    assert preprint["doi"] == "10.21203/rs.3.rs-10413213/v1"
    assert preprint["journal"] == "Research Square" and "Preprint" in preprint["comments"]
    assert preprint["publishedDate"].date() == date(2026, 8, 28)
    assert pmc["url"] == "https://pubmed.ncbi.nlm.nih.gov/42434155/"
    assert pmc["html_url"] == "https://europepmc.org/article/PMC/PMC13352196"
    assert "PMCID: PMC13352196" in pmc["comments"]
    assert pmc["journal"] == "Annals of gastroenterology" and pmc["authors"][0]
    assert pmc["content"].startswith("Background Metformin") and "<h4>" not in pmc["content"]
    assert med["url"] == "https://pubmed.ncbi.nlm.nih.gov/42628623/"
    assert med["html_url"] == "https://europepmc.org/article/MED/42628623"
    assert all(len(p["content"]) >= 150 for p in papers)


def test_europepmc_stateless_paging(searx_stub):
    m = load("europepmc")
    p = params(2)
    m.request("metformin", p)
    assert "pageSize=40" in p["url"] and "resultType=core" in p["url"]
    assert m.parse(fixture_json("europepmc.json"), pageno=2) == []  # fixture holds page 1 only
    p = params(6)
    m.request("metformin", p)
    assert p["url"] is None


# --- DOAJ -----------------------------------------------------------------------------------

def test_doaj_parse_and_url(searx_stub):
    m = load("doaj")
    papers = m.parse(fixture_json("doaj.json"))
    first = papers[0]
    assert first["doi"] == "10.1371/journal.pone.0097781"
    assert first["url"] == "https://doi.org/10.1371/journal.pone.0097781"
    assert first["journal"] == "PLoS ONE" and first["publishedDate"].date() == date(2014, 1, 1)
    assert papers[1]["publishedDate"].date() == date(2012, 3, 1)
    assert first["html_url"] == "https://doaj.org/article/0089b313f1ef4f52aab09e46d5f3318b"
    assert all(len(p["content"]) >= 150 for p in papers)
    url = m.build_url('metformin: "colorectal" (cancer)/', 2)
    assert url.startswith(m.search_url + "metformin%20colorectal%20cancer?")
    assert "page=2" in url


# --- PLOS -----------------------------------------------------------------------------------

def test_plos_parse(searx_stub):
    m = load("plos")
    papers = m.parse(fixture_json("plos.json"))
    first = papers[0]
    assert first["doi"] == "10.1371/journal.pone.0097781"
    assert first["url"] == "https://doi.org/10.1371/journal.pone.0097781"
    assert first["publishedDate"].date() == date(2014, 5, 21)
    assert first["journal"] == "PLoS ONE" and first["authors"][0] == "Xinbing Sui"
    assert all(len(p["content"]) >= 150 and not p["content"].startswith("\n") for p in papers)


def test_plos_rate_budget(searx_stub):
    m = load("plos")
    assert all(m.allow_request(now=100.0 + i) for i in range(10))
    assert m.allow_request(now=110.0) is False  # 11th call inside one minute
    assert m.allow_request(now=161.0) is True  # the window slid
    p = params()
    m._calls.extend([1e12] * 300)
    m.request("metformin", p)
    assert p["url"] is None


# --- OpenAlex -------------------------------------------------------------------------------

def test_openalex_parse_and_key(searx_stub, monkeypatch):
    m = load("mra_openalex")
    papers = m.parse(fixture_json("openalex.json"))
    first = papers[0]
    assert first["doi"] == "10.3389/fendo.2018.00622"
    assert first["journal"] == "Frontiers in Endocrinology"  # fork read the removed host_venue
    assert first["publishedDate"].date() == date(2018, 10, 23)
    assert len(first["content"]) >= 150 and first["authors"]
    monkeypatch.delenv("OPENALEX_API_KEY", raising=False)
    assert "api_key" not in m.build_url("metformin", 1)
    monkeypatch.setenv("OPENALEX_API_KEY", "oa-key")
    url = m.build_url("metformin", 1)
    assert "api_key=oa-key" in url and "sort=relevance_score%3Adesc" in url
    assert m.reconstruct_abstract({"b": [1], "a": [0], "c": [2]}) == "a b c"


# --- OpenAIRE -------------------------------------------------------------------------------

def test_openaire_parse(searx_stub):
    m = load("mra_openaire")
    papers = m.parse(fixture_json("openaire.json"))
    first, handle_only, letter = papers
    assert first["url"] == "https://pubmed.ncbi.nlm.nih.gov/37195082/"
    assert first["doi"] == "10.1158/0008-5472.can-22-3042"
    assert first["journal"] == "Cancer Research" and first["publishedDate"].date() == date(2023, 5, 17)
    assert len(first["content"]) >= 150
    assert handle_only["doi"] == "" and len(handle_only["content"]) > 1000  # longest description
    assert handle_only["url"].startswith("http")
    assert letter["journal"] == "Cancer Epidemiology, Biomarkers & Prevention"
    assert "type=publication" in m.build_url("metformin", 1)


# --- Semantic Scholar -----------------------------------------------------------------------

def test_semantic_scholar_key_switches_to_graph_api(searx_stub, monkeypatch):
    m = load("mra_semantic_scholar")
    delegated: list[str] = []
    m._fork = types.SimpleNamespace(request=lambda q, p: delegated.append(q),
                                    response=lambda r: "fork-results")
    monkeypatch.delenv("S2_API_KEY", raising=False)
    p = params()
    m.request("metformin", p)
    assert delegated == ["metformin"] and "x-api-key" not in p["headers"]
    assert m.response(_Resp(search_params=p)) == "fork-results"

    monkeypatch.setenv("S2_API_KEY", "s2-key")
    p = params()
    m.request("metformin", p)
    assert p["headers"]["x-api-key"] == "s2-key" and p["url"].startswith(m.graph_url)
    body = (FIX / "s2_graph.json").read_bytes()
    res = m.response(_Resp(content=body, search_params=p))
    assert res[0]["doi"] == "10.1007/s00384-020-03676-x"
    assert res[0]["publishedDate"].date() == date(2020, 6, 26)
    assert res[0]["journal"] == "International Journal of Colorectal Disease"
    assert res[1]["publishedDate"].date() == date(2019, 1, 1) and res[1]["doi"] == ""


# --- throttle cap ---------------------------------------------------------------------------

def test_throttle_skips_instead_of_queueing_past_the_timeout(searx_stub, monkeypatch):
    pubmed = load("mra_pubmed")
    monkeypatch.setattr(pubmed.time, "sleep", lambda _s: None)
    pubmed._next_slot = pubmed.time.monotonic() + pubmed.max_wait + 5  # queue already too long
    p = params()
    pubmed.request("metformin", p)
    assert p["url"] is None and searx_stub.calls == []  # no request sent, nothing queued
    assert pubmed._next_slot > pubmed.time.monotonic() + pubmed.max_wait  # slot not reserved

    doaj = load("doaj")
    doaj._next_slot = doaj.time.monotonic() + doaj.max_wait + 5
    p = params()
    doaj.request("metformin", p)
    assert p["url"] is None
    doaj._next_slot = 0.0
    doaj.request("metformin", p)
    assert p["url"].startswith(doaj.search_url)
