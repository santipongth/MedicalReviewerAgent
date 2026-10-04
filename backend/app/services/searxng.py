from __future__ import annotations

from typing import Any

from app.graph.schemas import Candidate
from app.services.http import HttpClient
from app.services.text import arxiv_id_from_url, normalize_doi, pmid_from_url, strip_markup


def parse_searxng_result(r: dict[str, Any]) -> Candidate | None:
    title = strip_markup(r.get("title"))
    if not title:
        return None
    url = r.get("url") or ""
    published = str(r.get("publishedDate") or r.get("pubdate") or "")
    authors = r.get("authors") or []
    if isinstance(authors, str):
        authors = [a.strip() for a in authors.split(",") if a.strip()]
    engines = list(r.get("engines") or ([r["engine"]] if r.get("engine") else []))
    return Candidate(
        title=title,
        abstract=strip_markup(r.get("content")) or None,
        doi=normalize_doi(r.get("doi")),
        pmid=pmid_from_url(url),
        arxiv_id=arxiv_id_from_url(url),
        year=int(published[:4]) if published[:4].isdigit() else None,
        journal=(r.get("journal") or r.get("publisher") or None),
        authors=[str(a) for a in authors][:20],
        url=url or None,
        pdf_url=r.get("pdf_url") or None,
        engines=engines,
    )


class SearxngClient:
    def __init__(self, http: HttpClient, base_url: str, engines: str, timeout: float | None = None) -> None:
        self.http = http
        self.base_url = base_url.rstrip("/")
        self.engines = engines
        self.timeout = timeout

    async def search(self, query: str, pageno: int = 1) -> list[Candidate]:
        # engines= only: passing categories= as well would union in non-academic engines.
        resp = await self.http.get(
            f"{self.base_url}/search",
            params={"q": query, "format": "json", "engines": self.engines, "pageno": pageno},
            timeout=self.timeout,
        )
        resp.raise_for_status()
        return [c for r in resp.json().get("results", []) if (c := parse_searxng_result(r))]
