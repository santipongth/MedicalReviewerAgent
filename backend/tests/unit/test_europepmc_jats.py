import json
from pathlib import Path

import httpx
import respx

from app.services.europepmc import EuropePmcClient, parse_epmc_result
from app.services.http import HttpClient
from app.services.jats import extract_jats_text

FIX = Path(__file__).parent.parent / "fixtures"
BASE = "https://www.ebi.ac.uk/europepmc/webservices/rest"


async def _nosleep(_):
    return None


def _records():
    data = json.loads((FIX / "epmc_core.json").read_text(encoding="utf-8"))
    return {r["id"]: parse_epmc_result(r) for r in data["resultList"]["result"]}


def test_parse_open_access_article():
    c = _records()["42434155"]
    assert c.title == "Impact of p53 mutations on the synergistic effects of metformin and radiation on colorectal cancer cells"
    assert (c.pmid, c.pmcid, c.doi) == ("42434155", "PMC13352196", "10.20524/aog.2026.1078")
    assert c.is_open_access is True and c.year == 2026
    assert c.journal == "Annals of gastroenterology"
    assert c.authors[0] == "Sakamoto K"
    assert c.abstract.startswith("Background Metformin has been reported")
    assert "<h4>" not in c.abstract
    assert c.url == "https://europepmc.org/articles/PMC13352196"
    assert "Journal Article" in c.pub_types and c.engines == ["europepmc"]
    assert c.key == "doi:10.20524/aog.2026.1078"


def test_parse_preprint_without_pmid():
    c = _records()["PPR1307357"]
    assert c.pmid is None and c.pmcid is None and c.is_open_access is False
    assert c.doi == "10.21203/rs.3.rs-10413213/v1" and c.pub_types == ["Preprint"]


@respx.mock
async def test_lookup_builds_batched_or_query():
    body = (FIX / "epmc_core.json").read_text(encoding="utf-8")
    route = respx.get(f"{BASE}/search").mock(return_value=httpx.Response(200, text=body))
    http = HttpClient(sleep=_nosleep)
    client = EuropePmcClient(http, BASE)
    out = await client.lookup(dois=["10.1/a", "10.1/a", "10.1/b"], pmids=["42434155"])
    await http.aclose()
    q = route.calls[0].request.url.params["query"]
    assert q == 'DOI:"10.1/a" OR DOI:"10.1/b" OR (EXT_ID:42434155 AND SRC:MED)'
    assert route.calls[0].request.url.params["resultType"] == "core"
    assert len(out) == 3


@respx.mock
async def test_lookup_splits_large_batches_and_skips_empty():
    route = respx.get(f"{BASE}/search").mock(
        return_value=httpx.Response(200, json={"resultList": {"result": []}})
    )
    http = HttpClient(sleep=_nosleep)
    client = EuropePmcClient(http, BASE)
    assert await client.lookup(dois=[], pmids=[]) == []
    assert route.call_count == 0
    await client.lookup(dois=[f"10.1/{i}" for i in range(85)], pmids=[])
    await http.aclose()
    assert route.call_count == 3  # 40 + 40 + 5


@respx.mock
async def test_fulltext_xml_404_returns_none():
    respx.get(f"{BASE}/PMC1/fullTextXML").mock(return_value=httpx.Response(404))
    http = HttpClient(sleep=_nosleep)
    assert await EuropePmcClient(http, BASE).fulltext_xml("PMC1") is None
    await http.aclose()


def test_extract_jats_keeps_abstract_methods_results_discussion():
    xml = (FIX / "epmc_fulltext_PMC13352196.xml").read_text(encoding="utf-8")
    text = extract_jats_text(xml, max_chars=60_000)
    for heading in ("## Abstract", "## Methods", "## Results", "## Discussion"):
        assert heading in text
    assert "## Introduction" not in text
    assert "HCT116" in text
    assert text.index("## Methods") < text.index("## Results") < text.index("## Discussion")


def test_extract_jats_respects_budget():
    xml = (FIX / "epmc_fulltext_PMC13352196.xml").read_text(encoding="utf-8")
    text = extract_jats_text(xml, max_chars=6000)
    assert len(text) <= 6000
    assert "## Results" in text  # every kept section gets a share of the budget


def test_extract_jats_handles_garbage():
    assert extract_jats_text("<not-xml", max_chars=1000) is None
    assert extract_jats_text("<article><body/></article>", max_chars=1000) is None
