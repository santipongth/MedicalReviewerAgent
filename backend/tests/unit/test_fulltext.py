from pathlib import Path

import httpx
import pytest
import respx

from app.graph.schemas import Candidate
from app.services.crawl_policy import DomainPolicy
from app.services.crawler import CrawlPage
from app.services.fulltext import FullTextFetcher
from app.services.fulltext_cache import FullTextCache
from app.services.http import HttpClient
from app.services.unpaywall import OALocation, UnpaywallClient
from app.services.urlsafety import is_public_http_url

FIX = Path(__file__).parent.parent / "fixtures"
ARTICLE_MD = ("# Metformin and colorectal cancer\n\n## Abstract\nWe studied metformin and colorectal cancer.\n\n"
              "## 2. Methods\n" + "Cohort of adults with diabetes. " * 60 + "\n\n## 3. Results\n" + "HR 0.8 for CRC. " * 60
              + "\n\n## 4. Discussion\n" + "Metformin colorectal findings. " * 40 + "\n\n## References\n1. A ref")
CONSENT_MD = "Accept All Cookies. Manage Preferences. " * 200


async def _nosleep(_):
    return None


class FakeEpmc:
    def __init__(self, xml=None):
        self.xml, self.calls = xml, 0

    async def fulltext_xml(self, pmcid):
        self.calls += 1
        return self.xml


class FakeUnpaywall:
    def __init__(self, locations=()):
        self.locations, self.calls = list(locations), 0

    async def oa_locations(self, doi):
        self.calls += 1
        return self.locations


class FakeCrawler:
    def __init__(self, pages):
        self.pages, self.calls = pages, []

    async def crawl(self, url, *, pdf):
        self.calls.append((url, pdf))
        return self.pages.get(url, CrawlPage(ok=False, error="not scripted"))


async def _allow(url):
    return True


def _fetcher(redis, *, epmc=None, unpaywall=None, crawler=None, url_check=_allow, policy=None):
    return FullTextFetcher(
        europepmc=epmc or FakeEpmc(), unpaywall=unpaywall or FakeUnpaywall(), crawler=crawler,
        policy=policy or DomainPolicy(redis, min_interval=0.0, sleep=_nosleep),
        cache=FullTextCache(redis), max_chars=60_000, max_urls=3, concurrency=2, url_check=url_check,
    )


def _cand(**kw):
    base = {"title": "Metformin and colorectal cancer", "abstract": "An abstract about metformin.", "doi": "10.1/a"}
    base.update(kw)
    return Candidate(**base)


async def test_europepmc_jats_first_and_cached(redis):
    xml = (FIX / "epmc_fulltext_PMC13352196.xml").read_text(encoding="utf-8")
    epmc = FakeEpmc(xml)
    crawler = FakeCrawler({})
    f = _fetcher(redis, epmc=epmc, crawler=crawler)
    c = _cand(pmcid="PMC13352196", is_open_access=True)
    first = await f.fetch(c)
    second = await f.fetch(c)
    assert first.source == "europepmc" and "## Results" in first.text and second == first
    assert epmc.calls == 1 and crawler.calls == []


async def test_crawls_unpaywall_landing_page_into_sections(redis):
    unpaywall = FakeUnpaywall([OALocation("https://journal.org/a", None, "cc-by", "publisher")])
    crawler = FakeCrawler({"https://journal.org/a": CrawlPage(ok=True, status=200, final_url="https://journal.org/a/full",
                                                              markdown=ARTICLE_MD)})
    ft = await _fetcher(redis, unpaywall=unpaywall, crawler=crawler).fetch(_cand())
    assert ft.source == "crawl_html" and ft.url == "https://journal.org/a/full"
    assert "## Methods" in ft.text and "## Results" in ft.text and "A ref" not in ft.text
    assert crawler.calls == [("https://journal.org/a", False)]


async def test_arxiv_pdf_is_tried_first(redis):
    crawler = FakeCrawler({"https://arxiv.org/pdf/2401.00001": CrawlPage(ok=True, status=200, markdown=ARTICLE_MD * 2)})
    ft = await _fetcher(redis, crawler=crawler).fetch(_cand(doi=None, arxiv_id="2401.00001"))
    assert ft.source == "crawl_pdf" and crawler.calls[0] == ("https://arxiv.org/pdf/2401.00001", True)


async def test_robots_denied_and_consent_page_fall_through_to_next_url_then_abstract(redis):
    unpaywall = FakeUnpaywall([OALocation("https://a.org/x", "https://b.org/x.pdf", None, "repository"),
                               OALocation("https://c.org/x", None, None, "publisher")])
    crawler = FakeCrawler({
        "https://a.org/x": CrawlPage(ok=False, status=403, error="Access denied by robots.txt", robots_denied=True),
        "https://b.org/x.pdf": CrawlPage(ok=True, status=200, markdown=CONSENT_MD),
        "https://c.org/x": CrawlPage(ok=True, status=200, markdown=CONSENT_MD),
    })
    f = _fetcher(redis, unpaywall=unpaywall, crawler=crawler)
    ft = await f.fetch(_cand())
    assert ft.source == "abstract"
    assert [u for u, _ in crawler.calls] == ["https://a.org/x", "https://b.org/x.pdf", "https://c.org/x"]
    again = await f.fetch(_cand())  # negative cache: no second round of crawling
    assert again.source == "abstract" and len(crawler.calls) == 3


async def test_rate_limited_domain_is_cooled_down_for_other_papers(redis):
    loc = [OALocation("https://slow.org/p1", None, None, "publisher")]
    crawler = FakeCrawler({"https://slow.org/p1": CrawlPage(ok=False, status=429, error="Too Many", blocked=True)})
    f = _fetcher(redis, unpaywall=FakeUnpaywall(loc), crawler=crawler)
    await f.fetch(_cand(doi="10.1/p1"))
    f.unpaywall.locations = [OALocation("https://slow.org/p2", None, None, "publisher")]
    ft = await f.fetch(_cand(doi="10.1/p2", title="Second paper on metformin"))
    assert ft.source == "abstract" and [u for u, _ in crawler.calls] == ["https://slow.org/p1"]


async def test_private_urls_never_reach_the_crawler(redis):
    async def deny(url):
        return False
    crawler = FakeCrawler({})
    unpaywall = FakeUnpaywall([OALocation("http://postgres:5432/x", None, None, "publisher")])
    ft = await _fetcher(redis, unpaywall=unpaywall, crawler=crawler, url_check=deny).fetch(_cand())
    assert ft.source == "abstract" and crawler.calls == []


async def test_non_open_access_pdf_link_is_not_crawled_and_crawler_optional(redis):
    crawler = FakeCrawler({})
    ft = await _fetcher(redis, crawler=crawler).fetch(_cand(doi=None, pdf_url="https://pub.org/a.pdf", is_open_access=False))
    assert ft.source == "abstract" and crawler.calls == []
    no_crawler = await _fetcher(redis, crawler=None).fetch(_cand(doi="10.1/zz"))
    assert no_crawler.source == "abstract"
    bare = await _fetcher(redis, crawler=None).fetch(Candidate(title="Only a title"))
    assert (bare.source, bare.text) == ("title_only", "Only a title")


@respx.mock
async def test_unpaywall_oa_locations():
    base = "https://api.unpaywall.org/v2"
    fixture = (FIX / "unpaywall_cancers18162537.json").read_text(encoding="utf-8")
    respx.get(f"{base}/10.3390/cancers18162537").mock(return_value=httpx.Response(200, text=fixture))
    respx.get(f"{base}/10.1/closed").mock(return_value=httpx.Response(200, json={"is_oa": False, "oa_locations": []}))
    respx.get(f"{base}/10.1/missing").mock(return_value=httpx.Response(404))
    http = HttpClient(sleep=_nosleep)
    client = UnpaywallClient(http, base, "me@example.org")
    locs = await client.oa_locations("10.3390/cancers18162537")
    assert locs and locs[0].landing_url == "https://doi.org/10.3390/cancers18162537" and locs[0].license == "cc-by"
    assert len({(loc.landing_url, loc.pdf_url) for loc in locs}) == len(locs)
    assert await client.oa_locations("10.1/closed") == []
    assert await client.oa_locations("10.1/missing") == []
    assert await UnpaywallClient(http, base, "").oa_locations("10.3390/cancers18162537") == []
    await http.aclose()


def _resolver(mapping):
    async def resolve(host):
        return mapping[host]
    return resolve


@pytest.mark.parametrize(
    "url,ips,expected",
    [
        ("https://arxiv.org/pdf/1", ["151.101.1.42"], True),
        ("http://127.0.0.1:8000/x", ["127.0.0.1"], False),
        ("http://postgres:5432/", ["172.18.0.3"], False),
        ("http://169.254.169.254/latest", ["169.254.169.254"], False),
        ("ftp://example.org/a.pdf", ["93.184.216.34"], False),
        ("https://mixed.example/a", ["93.184.216.34", "192.168.1.5"], False),
    ],
)
async def test_is_public_http_url(url, ips, expected):
    host = httpx.URL(url).host
    assert await is_public_http_url(url, resolver=_resolver({host: ips})) is expected


async def test_is_public_http_url_unresolvable_is_false():
    async def boom(host):
        raise OSError("nxdomain")
    assert await is_public_http_url("https://nope.invalid/x", resolver=boom) is False
