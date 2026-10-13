import asyncio
import json

import fakeredis.aioredis
import httpx
import pytest
import respx

from app.services.http import HttpClient
from app.services.thaijo import (
    USER_AGENT,
    ThaiJoClient,
    article_link,
    english_abstract,
    gregorian_year,
    parse_hit,
    query_words,
)
from tests.unit.thaijo_data import (
    ABSTRACT1,
    ABSTRACT2,
    API,
    DETAILS,
    HITS,
    NOT_FOUND,
    SEARCH,
    URL1,
    URL2,
    detail,
    hit,
)


async def _nosleep(_):
    return None


def _client(cache=None):
    return ThaiJoClient(HttpClient(retries=3, sleep=_nosleep), API, cache=cache, timeout=5.0, cache_ttl=600)


def _details_route():
    def answer(request):
        article_id = request.url.path.rsplit("/", 1)[1]
        return (httpx.Response(200, json=DETAILS[article_id]) if article_id in DETAILS
                else httpx.Response(404, json=NOT_FOUND))
    return respx.get(url__regex=rf"{API}/articles/[\w-]+$").mock(side_effect=answer)


def test_years_in_the_buddhist_era_become_gregorian():
    assert gregorian_year(2567) == 2024 and gregorian_year("2546") == 2003 and gregorian_year(2024) == 2024
    assert gregorian_year(None) is None and gregorian_year("n/a") is None and gregorian_year(99999) is None


def test_article_links_are_checked_against_the_host_the_path_and_the_id():
    assert article_link(URL1) == ("he01.tci-thaijo.org", "demo", "900001")
    assert article_link(URL1, "health01-900001") == ("he01.tci-thaijo.org", "demo", "900001")
    assert article_link(URL1, "health01-900002") is None  # the page names another submission
    for bad in ["http://he01.tci-thaijo.org/index.php/demo/article/view/1",
                "https://evil.example/index.php/demo/article/view/1",
                "https://he01.tci-thaijo.org.evil.example/index.php/demo/article/view/1",
                "https://he01.tci-thaijo.org/index.php/demo/article/view/1?x=1",
                "https://he01.tci-thaijo.org/index.php/demo/article/download/1/2",
                "https://he01.tci-thaijo.org/index.php/../oai/article/view/1", None, 7]:
        assert article_link(bad) is None, bad


def test_parse_hit_keeps_health_hits_with_a_valid_page_only():
    parsed = [parse_hit(h) for h in HITS]
    assert [p.id if p else None for p in parsed] == ["health01-900001", "health02-900002", None, None,
                                                    "health03-900005", None]
    first, second, _, _, thai_only, _ = parsed
    assert first.authors == ["Somchai Demo", "Malee Example"] and first.journal == "Journal of Demo Health Sciences"
    assert second.year == 2024 and second.doi == "10.9999/demo.2"
    assert thai_only.title == "ผลของโปรแกรมส่งเสริมสุขภาพต่อพฤติกรรมการออกกำลังกาย"  # no English title: the Thai one
    assert parse_hit(hit("health01-900001", URL1, en="x", category="Health01")) is None
    assert parse_hit({"id": "health01-1"}) is None and parse_hit("x") is None


def test_english_abstract_needs_150_latin_characters():
    assert english_abstract(DETAILS["health01-900001"]) == ABSTRACT1
    assert english_abstract(DETAILS["health02-900002"]) == ABSTRACT2  # markup stripped, entities unescaped
    assert english_abstract(DETAILS["health03-900005"]) is None  # "-"
    assert english_abstract(detail(HITS[0], "บทคัดย่อ " * 40)) is None  # Thai text filed as English
    assert english_abstract(detail(HITS[0], "word " * 2000)).endswith(" …")  # capped at 6,000 characters
    assert english_abstract(None) is None and english_abstract({"abstracts": None}) is None


def test_query_words_drop_syntax():
    assert query_words('metformin "type 2" (diabetes) OR x:y') == "metformin type 2 diabetes OR x y"
    assert query_words("") == ""


@respx.mock
async def test_search_posts_the_words_with_an_identifying_agent_and_no_retry():
    route = respx.post(f"{API}/articles/search").mock(return_value=httpx.Response(200, json=SEARCH))
    hits = await _client().search("adherence; hypertension!")
    assert [h.id for h in hits] == ["health01-900001", "health02-900002", "health03-900005"]
    sent = route.calls[0].request
    assert json.loads(sent.content) == {"q": "adherence hypertension", "page": 1, "per_page": 20,
                                        "highlight": False, "facets": False}
    assert sent.headers["user-agent"] == USER_AGENT
    respx.post(f"{API}/articles/search").mock(return_value=httpx.Response(503))
    with pytest.raises(httpx.HTTPStatusError):
        await _client().search("adherence")
    assert respx.calls.call_count == 2  # the 503 was not retried


def test_unusable_years_and_thai_digit_ids_are_refused():
    assert gregorian_year("²") is None and gregorian_year("9" * 5000) is None and gregorian_year("๒๕๖๗") is None
    assert parse_hit(hit("health01-๙๐๐๐๐๑", URL1, en="x")) is None
    assert article_link(URL1, "health01-๙๐๐๐๐๑") is None


@respx.mock
async def test_one_malformed_hit_never_drops_the_rest_of_the_page():
    bad = [{**HITS[0], "year": "²"}, {**HITS[0], "year": "9" * 5000}]
    respx.post(f"{API}/articles/search").mock(
        return_value=httpx.Response(200, json={**SEARCH, "hits": [*bad, HITS[1]]}))
    hits = await _client().search("adherence")
    assert [h.id for h in hits] == ["health01-900001", "health01-900001", "health02-900002"]
    assert hits[0].year is None and hits[1].year is None


@respx.mock
async def test_search_never_follows_a_redirect():
    respx.post(f"{API}/articles/search").mock(
        return_value=httpx.Response(302, headers={"Location": "http://10.0.0.1/"}))
    inner = respx.post("http://10.0.0.1/").mock(return_value=httpx.Response(200, json=SEARCH))
    with pytest.raises(httpx.HTTPStatusError):
        await _client().search("adherence")
    assert inner.call_count == 0


@respx.mock
async def test_abstracts_are_cached_by_id_including_the_ones_that_are_missing():
    route = _details_route()
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    client, stats = _client(redis), {}
    assert await client.abstract("health01-900001", stats) == ABSTRACT1
    assert await client.abstract("health01-424242", stats) is None  # 404: unknown
    assert await client.abstract("health01-900001", stats) == ABSTRACT1
    assert await client.abstract("health01-424242", stats) is None
    assert route.call_count == 2 and stats["cache_hits"] == 2
    assert await redis.ttl("mra:thaijo:abs:health01-900001") == 600
    assert await client.abstract("../admin", stats) is None and route.call_count == 2  # never asked


@respx.mock
async def test_a_dead_cache_costs_a_request_and_nothing_else():
    class DeadRedis:
        async def get(self, *_):
            raise ConnectionError("down")

        async def set(self, *_, **__):
            raise ConnectionError("down")

    route = _details_route()
    assert await _client(DeadRedis()).abstract("health01-900001") == ABSTRACT1 and route.call_count == 1


@respx.mock
async def test_collect_keeps_rank_order_dedupes_and_stops_at_the_limit():
    first = {**SEARCH, "hits": [HITS[0], HITS[4]]}
    second = {**SEARCH, "hits": [HITS[1], HITS[0]]}

    def answer(request):
        return httpx.Response(200, json=first if json.loads(request.content)["q"] == "q one" else second)

    respx.post(f"{API}/articles/search").mock(side_effect=answer)
    details = _details_route()
    out, stats = [], {}
    await _client().collect(["q one", "q two", "q one"], limit=5, out=out, stats=stats)
    assert [c.thaijo_url for c in out] == [URL1, URL2]  # 900001, 900002; 900005 has no English abstract
    assert out[1].year == 2024 and out[1].abstract_source == "thaijo" and out[1].engines == ["thaijo"]
    assert out[0].url == URL1 and out[0].pdf_url is None
    assert stats == {"hits": 3, "detailed": 3, "no_abstract": 1, "search_failed": 0, "detail_failed": 0,
                     "cache_hits": 0}
    assert details.call_count == 3
    out, stats = [], {}
    await _client().collect(["q one", "q two"], limit=1, out=out, stats=stats)
    assert len(out) == 1 and stats["detailed"] == 1


@respx.mock
async def test_collect_survives_one_failed_search_and_counts_failed_details():
    def answer(request):
        if json.loads(request.content)["q"] == "bad":
            return httpx.Response(500)
        return httpx.Response(200, json=SEARCH)

    respx.post(f"{API}/articles/search").mock(side_effect=answer)
    respx.get(f"{API}/articles/health01-900001").mock(return_value=httpx.Response(502))
    respx.get(f"{API}/articles/health02-900002").mock(return_value=httpx.Response(200, json=DETAILS["health02-900002"]))
    respx.get(f"{API}/articles/health03-900005").mock(return_value=httpx.Response(200, json=DETAILS["health03-900005"]))
    out, stats = [], {}
    await _client().collect(["good", "bad"], limit=15, out=out, stats=stats)
    assert [c.thaijo_url for c in out] == [URL2]
    assert stats["search_failed"] == 1 and stats["detail_failed"] == 1 and stats["no_abstract"] == 1


@respx.mock
async def test_collect_raises_when_every_search_failed():
    respx.post(f"{API}/articles/search").mock(return_value=httpx.Response(500))
    with pytest.raises(httpx.HTTPStatusError):
        await _client().collect(["a", "b"], limit=5, out=[], stats={})


async def test_collect_with_no_room_or_no_words_asks_nothing():
    out, stats = [], {}
    await _client().collect(["a"], limit=0, out=out, stats=stats)
    await _client().collect(["!!!"], limit=5, out=out, stats=stats)
    assert out == [] and stats["hits"] == 0


@respx.mock
async def test_a_timeout_keeps_the_candidates_already_collected(monkeypatch):
    monkeypatch.setattr("app.services.thaijo.CONCURRENCY", 1)  # one detail per batch
    respx.post(f"{API}/articles/search").mock(return_value=httpx.Response(200, json=SEARCH))
    respx.get(f"{API}/articles/health01-900001").mock(return_value=httpx.Response(200, json=DETAILS["health01-900001"]))

    async def slow(_request):
        await asyncio.sleep(5)
        return httpx.Response(200, json=DETAILS["health02-900002"])

    respx.get(f"{API}/articles/health02-900002").mock(side_effect=slow)
    out, stats = [], {}
    with pytest.raises(TimeoutError):
        await asyncio.wait_for(_client().collect(["q"], limit=5, out=out, stats=stats), 0.5)
    assert [c.thaijo_url for c in out] == [URL1]
