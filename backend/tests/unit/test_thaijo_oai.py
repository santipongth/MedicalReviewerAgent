import xml.etree.ElementTree as ET

import fakeredis.aioredis
import httpx
import pytest
import respx

from app.services.http import HttpClient
from app.services.thaijo import ThaiJoClient, UnsafeXml, parse_oai_record
from tests.unit.thaijo_data import (
    API,
    OAI_BOMB,
    OAI_FULL,
    OAI_ID1,
    OAI_MISSING,
    OAI_NO_PAGES,
    OAI_URL1,
    URL1,
    oai_record,
)

FULL = {"volume": "17", "issue": "4", "pages": "1048-1066", "issn": ["3027-613X", "2985-1750"],
        "license": "https://creativecommons.org/licenses/by-nc-nd/4.0", "article_type": "Peer-reviewed article"}


async def _nosleep(_):
    return None


async def _public(_host):
    return ["1.1.1.1"]  # a fake resolver: no DNS lookups in tests


async def _private(_host):
    return ["10.0.0.5"]


def _client(cache=None, resolver=_public):
    return ThaiJoClient(HttpClient(retries=3, sleep=_nosleep), API, cache=cache, timeout=5.0, cache_ttl=600,
                        resolver=resolver)


def test_full_record_gives_volume_issue_pages_issn_licence_and_type():
    assert parse_oai_record(OAI_FULL, OAI_ID1) == FULL


def test_a_record_without_pages_or_type_keeps_what_it_has():
    assert parse_oai_record(OAI_NO_PAGES, OAI_ID1) == {
        "volume": "11", "issue": "2", "pages": None, "issn": ["2985-1750"],
        "license": "http://creativecommons.org/licenses/by-nc-nd/4.0", "article_type": None}


def test_missing_deleted_foreign_or_empty_records_give_none():
    assert parse_oai_record(OAI_MISSING, OAI_ID1) is None
    assert parse_oai_record(oai_record(status="deleted", sources="<dc:source>2985-1750</dc:source>"), OAI_ID1) is None
    assert parse_oai_record(OAI_FULL, "oai:he01.tci-thaijo.org:article/900002") is None  # not the record asked for
    assert parse_oai_record(oai_record(), OAI_ID1) is None  # nothing bibliographic in it


def test_a_dtd_or_an_oversized_answer_is_refused_before_parsing():
    with pytest.raises(UnsafeXml):
        parse_oai_record(OAI_BOMB, OAI_ID1)
    with pytest.raises(UnsafeXml):
        parse_oai_record(b"<!doctype x>" + OAI_FULL, OAI_ID1)
    with pytest.raises(UnsafeXml):
        parse_oai_record(OAI_FULL + b" " * 600_000, OAI_ID1)
    with pytest.raises(ET.ParseError):
        parse_oai_record(b"<OAI-PMH><unclosed></OAI-PMH>", OAI_ID1)


def test_markup_in_a_field_is_stripped_and_long_types_are_cut():
    types = '<dc:type xml:lang="en-US">&lt;b&gt;Research&lt;/b&gt; article ' + "x" * 200 + "</dc:type>"
    bib = parse_oai_record(oai_record(types=types), OAI_ID1)
    assert bib["article_type"].startswith("Research article") and len(bib["article_type"]) <= 82


@respx.mock
async def test_record_reads_the_journal_host_from_the_page_and_caches_the_answer():
    route = respx.get(OAI_URL1).mock(return_value=httpx.Response(200, content=OAI_FULL))
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    client = _client(redis)
    assert await client.record(URL1) == FULL
    assert await client.record(URL1) == FULL
    assert route.call_count == 1
    params = dict(route.calls[0].request.url.params)
    assert params == {"verb": "GetRecord", "metadataPrefix": "oai_dc", "identifier": OAI_ID1}
    assert await redis.ttl("mra:thaijo:oai:he01.tci-thaijo.org:900001") == 600


@respx.mock
async def test_a_missing_record_is_cached_as_none():
    route = respx.get(OAI_URL1).mock(return_value=httpx.Response(200, content=OAI_MISSING))
    client = _client(fakeredis.aioredis.FakeRedis(decode_responses=True))
    assert await client.record(URL1) is None and await client.record(URL1) is None
    assert route.call_count == 1


@respx.mock
async def test_record_never_calls_a_host_outside_thaijo_or_a_private_address():
    any_call = respx.route().mock(return_value=httpx.Response(200, content=OAI_FULL))
    for url in ["https://evil.example/index.php/demo/article/view/900001",
                "https://he01.tci-thaijo.org.evil.example/index.php/demo/article/view/900001",
                "http://he01.tci-thaijo.org/index.php/demo/article/view/900001",
                "https://he01.tci-thaijo.org/index.php/demo/article/view/900001/555"]:  # the PDF link
        assert await _client().record(url) is None
    assert any_call.call_count == 0
    with pytest.raises(PermissionError):
        await _client(resolver=_private).record(URL1)
    assert any_call.call_count == 0


@respx.mock
async def test_record_does_not_follow_redirects_and_raises_on_errors():
    respx.get(OAI_URL1).mock(return_value=httpx.Response(301, headers={"Location": "http://10.0.0.5/oai"}))
    inner = respx.get("http://10.0.0.5/oai").mock(return_value=httpx.Response(200, content=OAI_FULL))
    with pytest.raises(httpx.HTTPStatusError):
        await _client().record(URL1)
    assert inner.call_count == 0
    respx.get(OAI_URL1).mock(return_value=httpx.Response(200, content=OAI_BOMB))
    with pytest.raises(UnsafeXml):
        await _client().record(URL1)
