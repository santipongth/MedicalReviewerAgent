from pathlib import Path

import httpx
import respx

from app.services.europepmc import EuropePmcClient
from app.services.http import HttpClient
from app.services.openalex import OpenAlexClient

FIX = Path(__file__).parent.parent / "fixtures"
EPMC = "https://www.ebi.ac.uk/europepmc/webservices/rest"
OA = "https://api.openalex.org"


async def _nosleep(_):
    return None


def _oa(http, **kw):
    return OpenAlexClient(http, OA, **kw)


@respx.mock
async def test_works_by_ids_maps_both_id_kinds_and_sends_credentials():
    body = (FIX / "openalex_works.json").read_text(encoding="utf-8")
    route = respx.get(f"{OA}/works").mock(return_value=httpx.Response(200, text=body))
    http = HttpClient(sleep=_nosleep)
    out = await _oa(http, api_key="k-secret", mailto="me@example.org").works_by_ids(
        dois=["https://doi.org/10.1000/EXAMPLE.2", "10.20524/aog.2026.1078", "10.9/zz"], pmids=["11111111", "x"]
    )
    await http.aclose()
    assert route.call_count == 2  # one doi batch + one pmid batch
    p = route.calls[0].request.url.params
    assert p["filter"] == "doi:10.1000/example.2|10.20524/aog.2026.1078|10.9/zz"
    assert p["api_key"] == "k-secret" and p["mailto"] == "me@example.org" and p["per_page"] == "50"
    assert "referenced_works" in p["select"] and "cited_by_count" in p["select"]
    assert route.calls[1].request.url.params["filter"] == "ids.pmid:11111111"
    w = out["doi:10.1000/example.2"]
    assert out["pmid:11111111"] is w
    assert (w.openalex_id, w.cited_by_count, w.year) == ("https://openalex.org/W2000000001", 87, 2019)
    assert w.referenced_works == ["https://openalex.org/W1000000001", "https://openalex.org/W1000000002"]
    assert out["doi:10.20524/aog.2026.1078"].referenced_works == []
    assert "doi:10.9/zz" not in out and "pmid:42434155" not in out  # only asked-for ids are keyed


@respx.mock
async def test_works_by_ids_omits_empty_credentials_and_splits_batches():
    route = respx.get(f"{OA}/works").mock(return_value=httpx.Response(200, json={"results": []}))
    http = HttpClient(sleep=_nosleep)
    client = _oa(http)
    assert await client.works_by_ids([], []) == {} and route.call_count == 0
    await client.works_by_ids([f"10.1/{i}" for i in range(120)] + ["10.1/a,b"], [])
    await http.aclose()
    assert route.call_count == 3  # 50 + 50 + 20; the comma DOI is skipped
    q = route.calls[0].request.url.params
    assert "api_key" not in q and "mailto" not in q


@respx.mock
async def test_works_by_ids_raises_on_http_error_so_callers_can_soft_fail():
    respx.get(f"{OA}/works").mock(return_value=httpx.Response(403))
    http = HttpClient(sleep=_nosleep)
    try:
        await _oa(http).works_by_ids(["10.1/a"], [])
        raise AssertionError("expected HTTPStatusError")
    except httpx.HTTPStatusError:
        pass
    finally:
        await http.aclose()


@respx.mock
async def test_epmc_references_parse_fixture():
    body = (FIX / "epmc_references.json").read_text(encoding="utf-8")
    route = respx.get(f"{EPMC}/MED/42434155/references").mock(return_value=httpx.Response(200, text=body))
    http = HttpClient(sleep=_nosleep)
    refs = await EuropePmcClient(http, EPMC).references("MED", "42434155")
    await http.aclose()
    q = route.calls[0].request.url.params
    assert q["pageSize"] == "1000" and q["format"] == "json"
    assert len(refs) == 6 and refs[0].id == "16378901" and refs[0].pmid == "16378901"
    assert refs[0].title == "Biologic basis for combining drugs with radiation" and refs[0].year == 2006


@respx.mock
async def test_epmc_references_robust_to_odd_items_non_med_sources_and_404():
    items = [
        {"source": "MED", "id": "5"}, {"source": "agr", "id": "AGR1", "doi": "https://doi.org/10.1/X"},
        {"title": "no id"}, "junk", None, {"id": "7", "pubYear": "n/a"},
    ]
    respx.get(f"{EPMC}/PMC/PMC1/references").mock(
        return_value=httpx.Response(200, json={"hitCount": 6, "referenceList": {"reference": items}})
    )
    respx.get(f"{EPMC}/MED/1/references").mock(return_value=httpx.Response(200, json={"hitCount": 0}))
    respx.get(f"{EPMC}/MED/2/references").mock(return_value=httpx.Response(404))
    http = HttpClient(sleep=_nosleep)
    c = EuropePmcClient(http, EPMC)
    refs = await c.references("PMC", "PMC1")
    assert [(r.source, r.id, r.doi, r.pmid, r.year) for r in refs] == [
        ("MED", "5", None, "5", None), ("AGR", "AGR1", "10.1/x", None, None), (None, "7", None, None, None),
    ]
    assert await c.references("MED", "1") == [] and await c.references("MED", "2") == []
    await http.aclose()


@respx.mock
async def test_epmc_references_pages_when_list_is_larger_than_one_page():
    def page(request):
        n = int(request.url.params["page"])
        items = [{"source": "MED", "id": str(n * 10000 + i)} for i in range(1000 if n == 1 else 5)]
        return httpx.Response(200, json={"hitCount": 1005, "referenceList": {"reference": items}})

    route = respx.get(f"{EPMC}/MED/9/references").mock(side_effect=page)
    http = HttpClient(sleep=_nosleep)
    refs = await EuropePmcClient(http, EPMC).references("MED", "9")
    await http.aclose()
    assert len(refs) == 1005 and route.call_count == 2


@respx.mock
async def test_works_by_ids_keeps_answered_batches_when_one_fails_and_raises_if_all_fail():
    body = (FIX / "openalex_works.json").read_text(encoding="utf-8")

    def reply(request):
        if request.url.params["filter"].startswith("ids.pmid"):
            return httpx.Response(500)
        return httpx.Response(200, text=body)

    respx.get(f"{OA}/works").mock(side_effect=reply)
    http = HttpClient(sleep=_nosleep, retries=0)
    out = await _oa(http).works_by_ids(["10.1000/example.2"], ["99"])
    assert "doi:10.1000/example.2" in out
    respx.get(f"{OA}/works").mock(return_value=httpx.Response(500))
    try:
        await _oa(http).works_by_ids(["10.1000/example.2"], ["99"])
        raise AssertionError("expected HTTPStatusError")
    except httpx.HTTPStatusError:
        pass
    finally:
        await http.aclose()


@respx.mock
async def test_openalex_request_url_with_api_key_is_not_logged_at_info(caplog):
    import logging

    from app.logging import configure_logging

    configure_logging("INFO")  # sets the httpx/httpcore loggers to WARNING
    route = respx.get(f"{OA}/works").mock(return_value=httpx.Response(200, json={"results": []}))
    http = HttpClient(sleep=_nosleep)
    with caplog.at_level(logging.INFO):
        await _oa(http, api_key="k-secret-123", mailto="me@example.org").works_by_ids(["10.1/a"], [])
    await http.aclose()
    assert route.call_count == 1
    assert "k-secret-123" not in caplog.text and "me%40example.org" not in caplog.text
    assert logging.getLogger("httpx").level == logging.WARNING
    assert logging.getLogger("httpcore").level == logging.WARNING
