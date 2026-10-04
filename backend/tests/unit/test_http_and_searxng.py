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
    assert len(sleep.calls) == 1 and 0.0 < sleep.calls[0] <= 0.2


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
