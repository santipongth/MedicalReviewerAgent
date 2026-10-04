from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import httpx

from app.graph.schemas import Candidate
from app.logging import get_logger
from app.services.jats import extract_jats_text
from app.services.quality import looks_like_fulltext
from app.services.sections import extract_markdown_sections, pdf_markdown_text
from app.services.urlsafety import is_public_http_url

log = get_logger(__name__)
FULLTEXT_SOURCES = ("europepmc", "crawl_html", "crawl_pdf")


@dataclass(frozen=True)
class FullText:
    source: str  # europepmc | crawl_html | crawl_pdf | abstract | title_only
    text: str
    url: str | None = None


class FullTextFetcher:
    """Europe PMC JATS API → polite Crawl4AI crawl of legal OA copies → abstract."""

    def __init__(self, *, europepmc, unpaywall, crawler, policy, cache, max_chars: int,
                 max_urls: int = 3, concurrency: int = 3,
                 url_check: Callable[[str], Awaitable[bool]] = is_public_http_url) -> None:
        self.europepmc = europepmc
        self.unpaywall = unpaywall
        self.crawler = crawler
        self.policy = policy
        self.cache = cache
        self.max_chars = max_chars
        self.max_urls = max_urls
        self.url_check = url_check
        self._sem = asyncio.Semaphore(concurrency)

    async def fetch(self, c: Candidate) -> FullText:
        if self.cache and (hit := await self.cache.get(c.key)):
            return hit
        ft = await self._europepmc(c) or await self._crawl(c)
        if ft:
            if self.cache:
                await self.cache.put(c.key, ft)
            return ft
        if c.abstract:
            return FullText("abstract", c.abstract)
        return FullText("title_only", c.title)

    async def _europepmc(self, c: Candidate) -> FullText | None:
        if not (c.pmcid and c.is_open_access):
            return None
        try:
            xml = await self.europepmc.fulltext_xml(c.pmcid)
        except Exception as exc:  # noqa: BLE001 - degrade to the next source
            log.warning("jats_fetch_failed", pmcid=c.pmcid, error=str(exc))
            return None
        text = extract_jats_text(xml, max_chars=self.max_chars) if xml else None
        return FullText("europepmc", text, f"https://europepmc.org/article/PMC/{c.pmcid}") if text else None

    async def _oa_urls(self, c: Candidate) -> list[tuple[str, bool]]:
        urls: list[tuple[str, bool]] = []
        if c.arxiv_id:
            urls.append((f"https://arxiv.org/pdf/{c.arxiv_id}", True))
        if c.doi:
            try:
                for loc in await self.unpaywall.oa_locations(c.doi):
                    if loc.landing_url:
                        urls.append((loc.landing_url, False))
                    if loc.pdf_url:
                        urls.append((loc.pdf_url, True))
            except Exception as exc:  # noqa: BLE001 - degrade to the next source
                log.warning("unpaywall_failed", doi=c.doi, error=str(exc))
        if c.pdf_url and c.is_open_access:
            urls.append((c.pdf_url, True))
        seen: set[str] = set()
        unique = [(u, pdf) for u, pdf in urls if not (u in seen or seen.add(u))]
        return unique[: self.max_urls]

    async def _crawl(self, c: Candidate) -> FullText | None:
        if self.crawler is None or self.policy is None:
            return None
        if self.cache and await self.cache.is_miss(c.key):
            return None
        for url, is_pdf in await self._oa_urls(c):
            host = httpx.URL(url).host
            if await self.policy.cooling(host):
                log.info("crawl_skip_cooldown", host=host)
                continue
            if not await self.url_check(url):
                log.warning("crawl_skip_private_url", url=url)
                continue
            if not await self.policy.acquire(host):
                log.info("crawl_skip_busy_host", host=host)
                continue
            async with self._sem:
                page = await self.crawler.crawl(url, pdf=is_pdf)
            if page.blocked:
                await self.policy.penalize(host)
            if not page.ok:
                log.info("crawl_failed", url=url, status=page.status, error=page.error, robots=page.robots_denied)
                continue
            if not looks_like_fulltext(page.markdown, c.title, pdf=is_pdf):
                log.info("crawl_not_fulltext", url=url)
                continue
            if is_pdf:
                return FullText("crawl_pdf", pdf_markdown_text(page.markdown, max_chars=self.max_chars),
                                page.final_url or url)
            text = extract_markdown_sections(page.markdown, max_chars=self.max_chars) or pdf_markdown_text(
                page.markdown, max_chars=self.max_chars)
            return FullText("crawl_html", text, page.final_url or url)
        if self.cache:
            await self.cache.mark_miss(c.key)
        return None
