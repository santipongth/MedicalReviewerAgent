# SPDX-License-Identifier: AGPL-3.0-or-later
"""Semantic Scholar engine for the MRA SearXNG instance (wraps the fork's module).

Written for the Medical Reviewer Agent, following SearXNG's ``semantic_scholar``
engine (AGPL-3.0-or-later, https://github.com/searxng/searxng).

The fork's ``semantic_scholar`` module calls the semanticscholar.org web-app endpoint,
which cannot take an API key. This module:

- without env ``S2_API_KEY``: delegates to the fork's module unchanged (behaviour as
  before; the keyless official API answers 429 under any load);
- with ``S2_API_KEY``: calls the official Graph API ``/graph/v1/paper/search`` with
  the ``x-api-key`` header (dedicated rate limit).

Configuration::

   - name: semantic scholar
     engine: mra_semantic_scholar
     timeout: 8.0
"""

# SearXNG result dates are naive datetimes (as in the fork's own engines).
# ruff: noqa: DTZ001, DTZ007

from __future__ import annotations

import importlib
import os
import typing as t
from datetime import datetime
from urllib.parse import urlencode

from searx.result_types import EngineResults  # type: ignore[import-not-found]

about = {
    "website": "https://www.semanticscholar.org/",
    "wikidata_id": "Q22908627",
    "official_api_documentation": "https://api.semanticscholar.org/api-docs/graph",
    "use_official_api": True,
    "require_api_key": False,
    "results": "JSON",
}

categories = ["science", "scientific publications"]
paging = True

graph_url = "https://api.semanticscholar.org/graph/v1/paper/search"
paper_url = "https://www.semanticscholar.org/paper/"
page_size = 10
fields = "title,abstract,externalIds,publicationDate,year,venue,journal,authors,url,openAccessPdf"

_fork: t.Any = None


def _api_key() -> str:
    return os.environ.get("S2_API_KEY", "").strip()


def setup(engine_settings: dict[str, t.Any]) -> bool:
    global _fork  # pylint: disable=global-statement
    _fork = importlib.import_module("searx.engines.semantic_scholar")
    if not hasattr(_fork, "logger"):  # SearXNG sets engine loggers before setup() runs
        _fork.logger = globals().get("logger")
    _fork.setup(engine_settings)
    return True


def build_graph_request(query: str, pageno: int, key: str) -> tuple[str, dict[str, str]]:
    args = {"query": query, "offset": (pageno - 1) * page_size, "limit": page_size, "fields": fields}
    return f"{graph_url}?{urlencode(args)}", {"x-api-key": key}


def request(query: str, params: dict[str, t.Any]) -> None:
    key = _api_key()
    if not key:
        params["mra_mode"] = "webapp"
        _fork.request(query, params)
        return
    params["mra_mode"] = "graph"
    url, headers = build_graph_request(query, params["pageno"], key)
    params["url"] = url
    params["headers"].update(headers)


def parse_graph(data: dict[str, t.Any]) -> list[dict[str, t.Any]]:
    papers: list[dict[str, t.Any]] = []
    for item in data.get("data") or []:
        title = item.get("title") or ""
        if not title:
            continue
        ids = item.get("externalIds") or {}
        published = None
        try:
            published = datetime.strptime(str(item.get("publicationDate") or "")[:10], "%Y-%m-%d")
        except ValueError:
            year = str(item.get("year") or "")
            published = datetime(int(year), 1, 1) if year.isdigit() else None
        journal = (item.get("journal") or {}).get("name") or item.get("venue") or ""
        papers.append({
            "url": item.get("url") or (paper_url + str(item.get("paperId") or "")),
            "title": title,
            "content": item.get("abstract") or "",
            "journal": journal,
            "doi": ids.get("DOI") or "",
            "authors": [a.get("name") for a in item.get("authors") or [] if (a or {}).get("name")],
            "pdf_url": (item.get("openAccessPdf") or {}).get("url") or "",
            "publishedDate": published,
        })
    return papers


def response(resp: t.Any) -> EngineResults:
    if resp.search_params.get("mra_mode") != "graph":
        return _fork.response(resp)
    res = EngineResults()
    for kwargs in parse_graph(resp.json()):
        res.add(res.types.Paper(**kwargs))
    return res
