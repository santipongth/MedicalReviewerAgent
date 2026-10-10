import json
from pathlib import Path

import httpx
import pytest
import respx

from app.services.http import HttpClient
from app.services.searxng import SearxngClient, parse_searxng_result

FIX = Path(__file__).parent.parent / "fixtures"


class SleepRecorder:
    def __init__(self):
        self.calls: list[float] = []

    async def __call__(self, seconds: float) -> None:
        self.calls.append(seconds)


@respx.mock
async def test_get_retries_on_429_then_succeeds():
    route = respx.get("https://api.example.org/x").mock(
        side_effect=[httpx.Response(429), httpx.Response(503), httpx.Response(200, json={"ok": 1})]
    )
    sleep = SleepRecorder()
    client = HttpClient(retries=3, backoff=0.5, sleep=sleep)
    resp = await client.get("https://api.example.org/x")
    await client.aclose()
    assert resp.status_code == 200 and route.call_count == 3
    assert sleep.calls == [0.5, 1.0]


@respx.mock
async def test_get_returns_last_error_response_after_retries():
    respx.get("https://api.example.org/x").mock(return_value=httpx.Response(500))
    client = HttpClient(retries=2, backoff=0.1, sleep=SleepRecorder())
    resp = await client.get("https://api.example.org/x")
    await client.aclose()
    assert resp.status_code == 500


@respx.mock
async def test_404_is_not_retried():
    route = respx.get("https://api.example.org/x").mock(return_value=httpx.Response(404))
    client = HttpClient(retries=3, sleep=SleepRecorder())
    assert (await client.get("https://api.example.org/x")).status_code == 404
    await client.aclose()
    assert route.call_count == 1


@respx.mock
async def test_per_host_throttle_spaces_requests():
    respx.get(url__regex=r"https://slow\.example\.org/.*").mock(return_value=httpx.Response(200))
    respx.get("https://fast.example.org/a").mock(return_value=httpx.Response(200))
    sleep = SleepRecorder()
    client = HttpClient(min_interval={"slow.example.org": 0.2}, sleep=sleep)
    await client.get("https://slow.example.org/1")
    await client.get("https://fast.example.org/a")
    await client.get("https://slow.example.org/2")
    await client.aclose()
    assert len(sleep.calls) == 1 and 0.0 < sleep.calls[0] <= 0.2 + 1e-6  # clock granularity


def test_parse_searxng_fixture_maps_identifiers():
    data = json.loads((FIX / "searxng_search.json").read_text(encoding="utf-8"))
    cands = [c for r in data["results"] if (c := parse_searxng_result(r))]
    assert len(cands) == len(data["results"]) == 10
    pubmed = next(c for c in cands if "pubmed" in c.engines)
    assert pubmed.doi == "10.3390/cancers18162537" and pubmed.pmid == "42649852"
    assert pubmed.key == "doi:10.3390/cancers18162537" and pubmed.year == 2026
    arxiv = next(c for c in cands if c.arxiv_id == "2402.09476")
    assert arxiv.pdf_url == "https://arxiv.org/pdf/2402.09476v1" and arxiv.abstract
    assert arxiv.authors[0] == "Mahtab Darvish"
    crossref = next(c for c in cands if "crossref" in c.engines)
    assert crossref.abstract is None


def test_parse_searxng_skips_untitled_results():
    assert parse_searxng_result({"title": "  ", "url": "https://x"}) is None


@respx.mock
async def test_searxng_client_sends_engines_and_json_format():
    body = (FIX / "searxng_search.json").read_text(encoding="utf-8")
    route = respx.get("http://searxng:8080/search").mock(return_value=httpx.Response(200, text=body))
    http = HttpClient(sleep=SleepRecorder())
    client = SearxngClient(http, "http://searxng:8080", "pubmed,semantic scholar")
    cands = await client.search("metformin colorectal cancer", pageno=2)
    await http.aclose()
    params = route.calls[0].request.url.params
    assert params["format"] == "json" and params["engines"] == "pubmed,semantic scholar"
    assert params["pageno"] == "2" and "categories" not in params
    assert len(cands) == 10


@respx.mock
async def test_searxng_http_error_raises():
    respx.get("http://searxng:8080/search").mock(return_value=httpx.Response(403))
    http = HttpClient(retries=0, sleep=SleepRecorder())
    with pytest.raises(httpx.HTTPStatusError):
        await SearxngClient(http, "http://searxng:8080", "pubmed").search("x")
    await http.aclose()


async def test_searxng_client_passes_per_request_timeout():
    class RecordingHttp:
        def __init__(self):
            self.kwargs = None

        async def get(self, url, **kwargs):
            self.kwargs = kwargs
            return httpx.Response(200, json={"results": []}, request=httpx.Request("GET", url))

    http = RecordingHttp()
    await SearxngClient(http, "http://searxng:8080", "pubmed", timeout=8.0).search("q")
    assert http.kwargs["timeout"] == 8.0


def test_searxng_full_abstract_engines_are_not_snippets():
    def parse(engines, **extra):
        return parse_searxng_result({"title": "A cohort study", "content": "Some text. " * 20, "engines": engines, **extra})

    arxiv = parse_searxng_result({"title": "A preprint", "content": "Full summary", "engines": ["arxiv"],
                                  "url": "https://arxiv.org/abs/2401.00001"})
    assert arxiv.abstract_source == "arxiv"
    for engine in ("pubmed", "europe pmc", "doaj", "plos", "openaire"):
        assert parse([engine]).abstract_source == "engine", engine
    for engine in ("crossref", "openalex", "semantic scholar"):
        assert parse([engine]).abstract_source == "snippet", engine
    # a paper found by several engines keeps the strongest label, and every engine stays attributed
    multi = parse(["crossref", "pubmed", "semantic scholar"])
    assert multi.abstract_source == "engine" and multi.engines == ["crossref", "pubmed", "semantic scholar"]
    assert parse(["pubmed"], content="").abstract_source is None
    # short or visibly truncated engine content stays a snippet
    assert parse(["pubmed"], content="Too short").abstract_source == "snippet"
    assert parse(["pubmed"], content="x" * 300 + "…").abstract_source == "snippet"
    assert parse(["doaj"], content="x" * 300 + "...").abstract_source == "snippet"


def test_europe_pmc_med_urls_give_a_pmid():
    c = parse_searxng_result({"title": "T", "engines": ["europe pmc"], "url": "https://europepmc.org/article/MED/36862776"})
    assert c.pmid == "36862776"
    for url in ("https://europepmc.org/article/PPR/PPR1307357", "https://europepmc.org/article/PMC/PMC111",
                "https://europepmc.org/article/MED/abc"):
        assert parse_searxng_result({"title": "T", "url": url}).pmid is None


@pytest.mark.parametrize(("raw", "clean"), [
    ("p<0.001) in patients aged >65", "p<0.001) in patients aged >65"),
    ("HR<1 and >0.5", "HR<1 and >0.5"),
    ("a < b > c", "a < b > c"),
    ("CO<sub>2</sub> rose", "CO2 rose"),
    ("10<sup>-3</sup> mol", "10-3 mol"),
    ("<i>In vitro</i> and <b>in vivo</b>", "In vitro and in vivo"),
    ("<p>Methods</p><p>Results</p>", "Methods Results"),
    ("<jats:p>Background</jats:p>", "Background"),
    ("x &lt;0.05 and y &gt; 3", "x <0.05 and y > 3"),
    ("&lt;sub&gt;kept&lt;/sub&gt; p&lt;0.01", "<sub>kept</sub> p<0.01"),
])
def test_strip_markup_keeps_literal_angle_brackets(raw, clean):
    from app.services.text import strip_markup
    assert strip_markup(raw) == clean


def test_searxng_pmcid_from_europe_pmc_fields():
    base = {"title": "T", "engines": ["europe pmc"]}
    a = parse_searxng_result({**base, "url": "https://pubmed.ncbi.nlm.nih.gov/123/",
                              "html_url": "https://europepmc.org/article/PMC/PMC9876543"})
    assert (a.pmid, a.pmcid) == ("123", "PMC9876543")
    b = parse_searxng_result({**base, "url": "https://europepmc.org/article/MED/5", "comments": "PMCID: PMC111"})
    assert b.pmid == "5" and b.pmcid == "PMC111"
    # preprints: no PMID, no PMCID, identified by DOI only
    c = parse_searxng_result({**base, "url": "https://europepmc.org/article/PPR/PPR1307357",
                              "doi": "10.21203/rs.3.rs-10413213/v1", "comments": "Preprint"})
    assert c.pmid is None and c.pmcid is None and c.key == "doi:10.21203/rs.3.rs-10413213/v1"


def test_new_engine_result_shapes_parse():
    doaj = parse_searxng_result({"title": "T1", "content": "a" * 200, "engines": ["doaj"],
                                 "url": "https://doi.org/10.1371/journal.pone.0097781", "doi": "10.1371/journal.pone.0097781",
                                 "journal": "PLOS ONE", "publishedDate": "2014-01-01T00:00:00",
                                 "authors": ["A B", "C D"]})
    assert doaj.doi == "10.1371/journal.pone.0097781" and doaj.pmid is None and doaj.year == 2014
    assert doaj.journal == "PLOS ONE" and doaj.abstract_source == "engine"
    openaire = parse_searxng_result({"title": "T2", "content": "b" * 200, "engines": ["openaire"],
                                     "url": "https://pubmed.ncbi.nlm.nih.gov/36862776/",
                                     "doi": "https://doi.org/10.1158/0008-5472.CAN-22-3042"})
    assert openaire.pmid == "36862776" and openaire.doi == "10.1158/0008-5472.can-22-3042"


def test_merged_candidates_keep_all_engines_and_prefer_full_abstracts():
    from app.services.dedupe import merge_candidates
    snippet = parse_searxng_result({"title": "Same paper about metformin", "doi": "10.1/x", "engines": ["crossref"],
                                    "content": "s" * 400, "url": "https://doi.org/10.1/x"})
    full = parse_searxng_result({"title": "Same paper about metformin", "doi": "10.1/x", "engines": ["pubmed"],
                                 "content": "f" * 300, "url": "https://pubmed.ncbi.nlm.nih.gov/9/"})
    (m,) = merge_candidates([snippet, full])
    assert m.engines == ["crossref", "pubmed"] and m.pmid == "9"
    assert m.abstract_source == "engine" and m.abstract == "f" * 300


@respx.mock
async def test_searxng_client_retries_once_only():
    route = respx.get("http://searxng:8080/search").mock(return_value=httpx.Response(503))
    http = HttpClient(retries=3, sleep=SleepRecorder())
    with pytest.raises(httpx.HTTPStatusError):
        await SearxngClient(http, "http://searxng:8080", "pubmed").search("x")
    await http.aclose()
    assert route.call_count == 2
