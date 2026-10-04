import json
from pathlib import Path

import httpx
import respx

from app.services.crawler import FORBIDDEN_KEYS, Crawl4AIClient

FIX = Path(__file__).parent.parent / "fixtures"
BASE = "http://crawl4ai:11235"


def recorded(name: str) -> httpx.Response:
    data = json.loads((FIX / f"crawl4ai_{name}.json").read_text(encoding="utf-8"))
    return httpx.Response(data["http_status"], json=data["body"])


def all_keys(obj) -> set[str]:
    if isinstance(obj, dict):
        return set(obj) | {k for v in obj.values() for k in all_keys(v)}
    if isinstance(obj, list):
        return {k for v in obj for k in all_keys(v)}
    return set()


@respx.mock
async def test_html_crawl_sends_safe_payload_and_parses_markdown():
    route = respx.post(f"{BASE}/crawl").mock(return_value=recorded("mdpi_html"))
    client = Crawl4AIClient(BASE, "tok", stealth=True)
    page = await client.crawl("https://www.mdpi.com/2072-6694/18/16/2537", pdf=False)
    await client.aclose()
    request = route.calls[0].request
    body = json.loads(request.content)
    assert request.headers["authorization"] == "Bearer tok"
    assert body["urls"] == ["https://www.mdpi.com/2072-6694/18/16/2537"]
    assert body["browser_config"] == {"type": "BrowserConfig", "params": {"headless": True, "enable_stealth": True}}
    params = body["crawler_config"]["params"]
    assert params["check_robots_txt"] is True and params["cache_mode"] == "bypass"
    assert "scraping_strategy" not in params
    assert not (all_keys(body) & FORBIDDEN_KEYS)
    assert page.ok and page.status == 200 and "## Abstract" in page.markdown


@respx.mock
async def test_pdf_crawl_uses_pdf_strategy():
    route = respx.post(f"{BASE}/crawl").mock(return_value=recorded("frontiers_pdf"))
    client = Crawl4AIClient(BASE, "tok", stealth=False)
    page = await client.crawl("https://www.frontiersin.org/articles/10.3389/fendo.2018.00622/pdf", pdf=True)
    await client.aclose()
    body = json.loads(route.calls[0].request.content)
    assert body["crawler_config"]["params"]["scraping_strategy"] == {"type": "PDFContentScrapingStrategy", "params": {}}
    assert body["browser_config"]["params"]["enable_stealth"] is False
    assert not (all_keys(body) & FORBIDDEN_KEYS)
    assert page.ok and len(page.markdown) > 30_000


@respx.mock
async def test_robots_denied_is_flagged_and_not_blocked():
    respx.post(f"{BASE}/crawl").mock(return_value=recorded("bmc_robots"))
    client = Crawl4AIClient(BASE, "tok")
    page = await client.crawl("https://jeccr.biomedcentral.com/track/pdf/x", pdf=True)
    await client.aclose()
    assert (page.ok, page.robots_denied, page.blocked) == (False, True, False)


@respx.mock
async def test_ssrf_rejection_and_auth_failure_and_unreachable():
    respx.post(f"{BASE}/crawl").mock(side_effect=[recorded("ssrf_blocked"), httpx.Response(401, json={"detail": "x"}),
                                                  httpx.ConnectError("down")])
    client = Crawl4AIClient(BASE, "tok")
    ssrf = await client.crawl("http://127.0.0.1/x", pdf=False)
    unauth = await client.crawl("https://example.org", pdf=False)
    down = await client.crawl("https://example.org", pdf=False)
    await client.aclose()
    assert not ssrf.ok and "SSRF" in ssrf.error
    assert not unauth.ok and "401" in unauth.error
    assert not down.ok and "unreachable" in down.error


@respx.mock
async def test_site_429_is_marked_blocked():
    respx.post(f"{BASE}/crawl").mock(return_value=httpx.Response(200, json={"success": True, "results": [
        {"url": "https://x.org/a", "success": False, "status_code": 429, "error_message": "Too Many Requests",
         "markdown": {"raw_markdown": "", "fit_markdown": ""}}]}))
    client = Crawl4AIClient(BASE, "tok")
    page = await client.crawl("https://x.org/a", pdf=False)
    await client.aclose()
    assert not page.ok and page.blocked and page.status == 429
