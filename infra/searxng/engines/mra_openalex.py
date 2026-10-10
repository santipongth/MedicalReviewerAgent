# SPDX-License-Identifier: AGPL-3.0-or-later
"""OpenAlex engine for the MRA SearXNG instance (replaces the fork's ``openalex`` module).

Derived from SearXNG's ``searx/engines/openalex.py`` (AGPL-3.0-or-later,
https://github.com/searxng/searxng). Changes for the Medical Reviewer Agent:

- sends ``api_key`` when env ``OPENALEX_API_KEY`` is set (OpenAlex meters keyless use
  at about $0.10/day since 2026; a free key raises that), keeps the optional ``mailto``;
- ``journal`` comes from ``primary_location.source`` (``host_venue`` is gone from the API,
  so the fork always returned an empty journal);
- dependency-free parsing for the backend's unit tests.

Configuration::

   - name: openalex
     engine: mra_openalex
     timeout: 8.0
"""

# SearXNG result dates are naive datetimes (as in the fork's own engines).
# ruff: noqa: DTZ007

from __future__ import annotations

import os
import typing as t
from datetime import datetime
from urllib.parse import urlencode

from searx.result_types import EngineResults  # type: ignore[import-not-found]

about = {
    "website": "https://openalex.org/",
    "wikidata_id": "Q110718454",
    "official_api_documentation": "https://docs.openalex.org/how-to-use-the-api/api-overview",
    "use_official_api": True,
    "require_api_key": False,
    "results": "JSON",
}

categories = ["science", "scientific publications"]
paging = True
search_url = "https://api.openalex.org/works"
page_size = 10
mailto = ""


def build_url(query: str, pageno: int, language: str | None = None) -> str:
    args: dict[str, t.Any] = {
        "search": query,
        "page": pageno,
        "per-page": page_size,
        "sort": "relevance_score:desc",
    }
    if isinstance(language, str) and language != "all":
        iso2 = language.split("-")[0].split("_")[0]
        if len(iso2) == 2:
            args["filter"] = f"language:{iso2}"
    if mailto:
        args["mailto"] = mailto
    if key := os.environ.get("OPENALEX_API_KEY", "").strip():
        args["api_key"] = key
    return f"{search_url}?{urlencode(args)}"


def request(query: str, params: dict[str, t.Any]) -> None:
    params["url"] = build_url(query, params["pageno"], params.get("language"))


def reconstruct_abstract(index: dict[str, list[int]] | None) -> str:
    if not index:
        return ""
    positions = {pos: token for token, places in index.items() for pos in places}
    return " ".join(positions[i] for i in sorted(positions))


def _published(value: str | None) -> datetime | None:
    for fmt in ("%Y-%m-%d", "%Y-%m", "%Y"):
        try:
            return datetime.strptime(value or "", fmt)
        except ValueError:
            continue
    return None


def _pages(biblio: dict[str, t.Any]) -> str:
    first, last = biblio.get("first_page"), biblio.get("last_page")
    if first and last and first != last:
        return f"{first}-{last}"
    return str(first or last or "")


def parse(data: dict[str, t.Any]) -> list[dict[str, t.Any]]:
    papers: list[dict[str, t.Any]] = []
    for item in data.get("results") or []:
        title = item.get("title") or item.get("display_name") or ""
        if not title:
            continue
        primary = item.get("primary_location") or {}
        source = primary.get("source") or {}
        open_access = item.get("open_access") or {}
        biblio = item.get("biblio") or {}
        landing = primary.get("landing_page_url") or ""
        cited = item.get("cited_by_count")
        papers.append({
            "url": landing or item.get("id") or "",
            "title": title,
            "content": reconstruct_abstract(item.get("abstract_inverted_index")),
            "journal": source.get("display_name") or "",
            "publisher": source.get("host_organization_name") or "",
            "issn": list(source.get("issn") or []),
            "doi": (item.get("doi") or "").removeprefix("https://doi.org/"),
            "authors": [((a or {}).get("author") or {}).get("display_name") or ""
                        for a in item.get("authorships") or []
                        if ((a or {}).get("author") or {}).get("display_name")],
            "pdf_url": primary.get("pdf_url") or open_access.get("oa_url") or "",
            "html_url": landing,
            "publishedDate": _published(item.get("publication_date")),
            "pages": _pages(biblio),
            "volume": str(biblio.get("volume") or ""),
            "number": str(biblio.get("issue") or ""),
            "type": item.get("type") or "",
            "comments": f"{cited} citations" if isinstance(cited, int) else "",
        })
    return papers


def response(resp: t.Any) -> EngineResults:
    res = EngineResults()
    for kwargs in parse(resp.json()):
        res.add(res.types.Paper(**kwargs))
    return res
