# SPDX-License-Identifier: AGPL-3.0-or-later
"""`DOAJ`_ (Directory of Open Access Journals): article search over peer-reviewed
open access journals, via the public API v4 (no key needed for search).

Written for the Medical Reviewer Agent's SearXNG instance, following the structure
of SearXNG's engines (AGPL-3.0-or-later, https://github.com/searxng/searxng).

- DOAJ asks for at most 2 requests per second: calls are spaced per process.
- Returns metadata + abstract only (``content``); ``url`` is the DOI link when the
  record has a DOI, otherwise the DOAJ article page.

.. _DOAJ: https://doaj.org/api/v4/docs

Configuration::

   - name: doaj
     engine: doaj
     shortcut: doaj
     timeout: 8.0
"""

# SearXNG result dates are naive datetimes (as in the fork's own engines).
# ruff: noqa: DTZ001

from __future__ import annotations

import logging
import re
import threading
import time
import typing as t
from datetime import datetime
from urllib.parse import quote, urlencode

from searx.engines.mra_markup import clean_markup as _clean  # type: ignore[import-not-found]
from searx.result_types import EngineResults  # type: ignore[import-not-found]

about = {
    "website": "https://doaj.org/",
    "wikidata_id": "Q1227538",
    "official_api_documentation": "https://doaj.org/api/v4/docs",
    "use_official_api": True,
    "require_api_key": False,
    "results": "JSON",
}

categories = ["science", "scientific publications"]
paging = True

search_url = "https://doaj.org/api/v4/search/articles/"
article_url = "https://doaj.org/article/"
page_size = 10
min_interval = 0.5  # DOAJ: <= 2 requests per second
max_wait = 5.0  # seconds; the engine timeout is 8 s

logger = logging.getLogger(__name__)  # replaced by SearXNG with the engine logger

# Real tags only: a literal "<" ("p<0.001") must survive. Inline markup joins ("CO<sub>2</sub>" -> "CO2"), other tags
# become a space.
# Elasticsearch query-string syntax characters that would turn a plain topic into a parse error.
_ES_SPECIAL = re.compile(r'[\\/:!^~{}\[\]()"]')
_DOI_PREFIX = re.compile(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", re.IGNORECASE)
_lock = threading.Lock()
_next_slot = 0.0


def _throttle() -> bool:
    """Space calls by ``min_interval``; False (nothing reserved) if the wait would exceed ``max_wait``."""
    global _next_slot  # pylint: disable=global-statement
    with _lock:
        now = time.monotonic()
        wait = max(0.0, _next_slot - now)
        if wait > max_wait:
            return False
        _next_slot = max(now, _next_slot) + min_interval
    if wait:
        time.sleep(wait)
    return True


def build_url(query: str, pageno: int) -> str:
    terms = " ".join(_ES_SPECIAL.sub(" ", query).split())
    return f"{search_url}{quote(terms, safe='')}?{urlencode({'page': pageno, 'pageSize': page_size})}"


def request(query: str, params: dict[str, t.Any]) -> None:
    if not _throttle():
        logger.warning("DOAJ request queue longer than %.0f s; skipping this call", max_wait)
        params["url"] = None
        return
    params["url"] = build_url(query, params["pageno"])


def _published(bib: dict[str, t.Any]) -> datetime | None:
    year = str(bib.get("year") or "")
    if not year.isdigit():
        return None
    month = str(bib.get("month") or "")
    month_n = int(month) if month.isdigit() and 1 <= int(month) <= 12 else 1
    return datetime(int(year), month_n, 1)


def normalize_doi(value: str) -> str:
    """DOAJ stores some DOIs as URLs or with a "doi:" prefix; keep only a bare "10." DOI."""
    doi = _DOI_PREFIX.sub("", value.strip()).strip()
    return doi if doi.startswith("10.") else ""


def parse(data: dict[str, t.Any]) -> list[dict[str, t.Any]]:
    papers: list[dict[str, t.Any]] = []
    for record in data.get("results") or []:
        bib = record.get("bibjson") or {}
        title = _clean(bib.get("title"))
        if not title:
            continue
        doi = normalize_doi(next((str(i.get("id") or "") for i in bib.get("identifier") or []
                                  if str(i.get("type") or "").lower() == "doi"), ""))
        journal = bib.get("journal") or {}
        fulltext = next((ln.get("url") for ln in bib.get("link") or [] if ln.get("type") == "fulltext"), "")
        doaj_page = f"{article_url}{record['id']}" if record.get("id") else ""
        papers.append({
            "url": f"https://doi.org/{doi}" if doi else (doaj_page or fulltext or ""),
            "title": title,
            "content": _clean(bib.get("abstract")),
            "journal": _clean(journal.get("title")),
            "publisher": _clean(journal.get("publisher")),
            "issn": list(journal.get("issns") or []),
            "authors": [_clean(a.get("name")) for a in bib.get("author") or [] if a.get("name")],
            "doi": doi,
            "publishedDate": _published(bib),
            "volume": str(journal.get("volume") or ""),
            "number": str(journal.get("number") or ""),
            "tags": [_clean(s.get("term")) for s in bib.get("subject") or [] if s.get("term")],
            "html_url": doaj_page,
        })
    return papers


def response(resp: t.Any) -> EngineResults:
    res = EngineResults()
    for kwargs in parse(resp.json()):
        res.add(res.types.Paper(**kwargs))
    return res
