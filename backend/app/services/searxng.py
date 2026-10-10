from __future__ import annotations

import re
from typing import Any

from app.graph.schemas import Candidate
from app.services.http import HttpClient
from app.services.text import arxiv_id_from_url, normalize_doi, pmid_from_url, strip_markup

# Engines whose `content` is the paper's full abstract (arXiv: the summary). Other engines return a search snippet,
# which is often truncated and only counts as an abstract when it looks complete (see retrieval.usable_abstract).
FULL_ABSTRACT_ENGINES = frozenset({"pubmed", "europe pmc", "doaj", "plos", "openaire"})
_PMCID_URL = re.compile(r"europepmc\.org/article/PMC/(?:PMC)?(\d+)", re.IGNORECASE)
_PMCID_TEXT = re.compile(r"\bPMCID:\s*(?:PMC)?(\d+)", re.IGNORECASE)


def pmcid_from_result(r: dict[str, Any]) -> str | None:
    """PMCID from the Europe PMC engine: html_url (/article/PMC/<id>) or the `comments` field ("PMCID: PMC...")."""
    match = _PMCID_URL.search(str(r.get("html_url") or "")) or _PMCID_TEXT.search(str(r.get("comments") or ""))
    return f"PMC{match.group(1)}" if match else None


def abstract_source_for(engines: list[str], has_abstract: bool) -> str | None:
    if not has_abstract:
        return None
    if "arxiv" in engines:
        return "arxiv"
    return "engine" if FULL_ABSTRACT_ENGINES.intersection(engines) else "snippet"


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
    abstract = strip_markup(r.get("content")) or None
    source = abstract_source_for(engines, abstract is not None)
    return Candidate(
        title=title,
        abstract=abstract,
        abstract_source=source,
        doi=normalize_doi(r.get("doi")),
        pmid=pmid_from_url(url),
        pmcid=pmcid_from_result(r),
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
        # One retry only: a slow query must not wait out several full timeouts (HttpClient retries default to 3).
        resp = await self.http.get(
            f"{self.base_url}/search",
            params={"q": query, "format": "json", "engines": self.engines, "pageno": pageno},
            timeout=self.timeout,
            retries=1,
        )
        resp.raise_for_status()
        return [c for r in resp.json().get("results", []) if (c := parse_searxng_result(r))]
