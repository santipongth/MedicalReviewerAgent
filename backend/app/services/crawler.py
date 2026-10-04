from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

# Never sent: these fields enabled RCE/SSRF in older Crawl4AI servers (CVE-2026-26216,
# CVE-2026-53755, CVE-2026-57572) and are not needed for polite crawling.
FORBIDDEN_KEYS = frozenset({"proxy", "proxy_config", "extra_args", "hooks"})
SITE_BLOCK_STATUSES = {403, 429, 503}


@dataclass(frozen=True)
class CrawlPage:
    ok: bool
    status: int | None = None
    final_url: str | None = None
    markdown: str = ""
    error: str | None = None
    robots_denied: bool = False
    blocked: bool = False  # the site refused us (403/429/503) → cool the domain down


class Crawl4AIClient:
    """Client for a self-hosted Crawl4AI >= 0.9 server (POST /crawl, Bearer token)."""

    def __init__(self, base_url: str, token: str, *, timeout: float = 120.0, stealth: bool = True,
                 transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.stealth = stealth
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"), timeout=timeout,
            headers={"Authorization": f"Bearer {token}"}, transport=transport,
        )

    def build_payload(self, url: str, *, pdf: bool) -> dict[str, Any]:
        params: dict[str, Any] = {"cache_mode": "bypass", "check_robots_txt": True, "page_timeout": 45_000}
        if pdf:
            params["scraping_strategy"] = {"type": "PDFContentScrapingStrategy", "params": {}}
        return {
            "urls": [url],
            "browser_config": {"type": "BrowserConfig", "params": {"headless": True, "enable_stealth": self.stealth}},
            "crawler_config": {"type": "CrawlerRunConfig", "params": params},
        }

    async def crawl(self, url: str, *, pdf: bool) -> CrawlPage:
        try:
            resp = await self._client.post("/crawl", json=self.build_payload(url, pdf=pdf))
        except httpx.HTTPError as exc:
            return CrawlPage(ok=False, error=f"crawler unreachable: {type(exc).__name__}")
        if resp.status_code != 200:
            try:
                detail = resp.json().get("detail")
            except ValueError:
                detail = resp.text[:200]
            return CrawlPage(ok=False, error=f"crawler HTTP {resp.status_code}: {detail}")
        results = resp.json().get("results") or []
        if not results:
            return CrawlPage(ok=False, error="crawler returned no results")
        r = results[0]
        status = r.get("status_code")
        error = r.get("error_message") or None
        if error and "robots.txt" in error:
            return CrawlPage(ok=False, status=status, error=error, robots_denied=True)
        md = r.get("markdown") or {}
        text = (md.get("raw_markdown") or md.get("fit_markdown") or "") if isinstance(md, dict) else str(md)
        if not r.get("success") or not text.strip():
            return CrawlPage(ok=False, status=status, error=error or "no content",
                             blocked=status in SITE_BLOCK_STATUSES)
        return CrawlPage(ok=True, status=status, final_url=r.get("redirected_url") or r.get("url"), markdown=text)

    async def aclose(self) -> None:
        await self._client.aclose()
