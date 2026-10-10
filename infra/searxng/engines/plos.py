# SPDX-License-Identifier: AGPL-3.0-or-later
"""`PLOS`_ search API (Solr): articles from the PLOS journals (PLOS ONE, PLOS
Medicine, ...). No key needed.

Written for the Medical Reviewer Agent's SearXNG instance, following the structure
of SearXNG's engines (AGPL-3.0-or-later, https://github.com/searxng/searxng).

PLOS limits the API to 10 requests per minute and 300 per hour (7200 per day). The
engine keeps a per-process sliding window and skips the request (no results, no
error) once the budget is spent, instead of getting the instance blocked.

.. _PLOS: https://api.plos.org/solr/faq/

Configuration::

   - name: plos
     engine: plos
     shortcut: plos
     timeout: 8.0
"""

# SearXNG result dates are naive datetimes (as in the fork's own engines).
# ruff: noqa: DTZ007

from __future__ import annotations

import logging
import re
import threading
import time
import typing as t
from collections import deque
from datetime import datetime
from urllib.parse import urlencode

from searx.engines.mra_markup import clean_markup as _clean  # type: ignore[import-not-found]
from searx.result_types import EngineResults  # type: ignore[import-not-found]

about = {
    "website": "https://plos.org/",
    "wikidata_id": "Q233358",
    "official_api_documentation": "https://api.plos.org/solr/faq/",
    "use_official_api": True,
    "require_api_key": False,
    "results": "JSON",
}

categories = ["science", "scientific publications"]
paging = True

search_url = "https://api.plos.org/search"
page_size = 10
fields = "id,title_display,abstract,publication_date,journal,author_display,article_type"
per_minute = 10
per_hour = 300

logger = logging.getLogger(__name__)  # replaced by SearXNG with the engine logger

# Real tags only: a literal "<" ("p<0.001") must survive. Inline markup joins ("CO<sub>2</sub>" -> "CO2"), other tags
# become a space.
# Solr query syntax characters; a plain topic should not become a syntax error.
_SOLR_SPECIAL = re.compile(r'[\\+\-!():^\[\]"{}~*?|&/]')
_lock = threading.Lock()
_calls: deque[float] = deque()


def allow_request(now: float | None = None) -> bool:
    """Record a call if it fits the PLOS budget (10/min, 300/h); False when it does not."""
    now = time.monotonic() if now is None else now
    with _lock:
        while _calls and now - _calls[0] > 3600:
            _calls.popleft()
        last_minute = sum(1 for ts in _calls if now - ts < 60)
        if last_minute >= per_minute or len(_calls) >= per_hour:
            return False
        _calls.append(now)
        return True


def build_url(query: str, pageno: int) -> str:
    terms = " ".join(_SOLR_SPECIAL.sub(" ", query).split())
    args = {
        "q": terms,
        "fl": fields,
        "fq": "doc_type:full",
        "start": (pageno - 1) * page_size,
        "rows": page_size,
        "wt": "json",
    }
    return f"{search_url}?{urlencode(args)}"


def request(query: str, params: dict[str, t.Any]) -> None:
    if not allow_request():
        logger.info("PLOS rate budget spent; skipping request")
        params["url"] = None
        return
    params["url"] = build_url(query, params["pageno"])


def parse(data: dict[str, t.Any]) -> list[dict[str, t.Any]]:
    papers: list[dict[str, t.Any]] = []
    for doc in (data.get("response") or {}).get("docs") or []:
        doi = str(doc.get("id") or "").strip()
        title = _clean(doc.get("title_display"))
        if not doi or not title:
            continue
        published = None
        date = str(doc.get("publication_date") or "")
        try:
            published = datetime.strptime(date[:10], "%Y-%m-%d")
        except ValueError:
            pass
        papers.append({
            "url": f"https://doi.org/{doi}",
            "title": title,
            "content": _clean(doc.get("abstract")),
            "journal": _clean(doc.get("journal")),
            "publisher": "Public Library of Science",
            "authors": [str(a) for a in doc.get("author_display") or []],
            "doi": doi,
            "publishedDate": published,
            "type": _clean(doc.get("article_type")),
        })
    return papers


def response(resp: t.Any) -> EngineResults:
    res = EngineResults()
    for kwargs in parse(resp.json()):
        res.add(res.types.Paper(**kwargs))
    return res
