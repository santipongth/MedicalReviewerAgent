# SPDX-License-Identifier: AGPL-3.0-or-later
"""`OpenAIRE Graph`_ research products (publications) for the MRA SearXNG instance.

Written for the Medical Reviewer Agent, following the structure of SearXNG's engines
(AGPL-3.0-or-later, https://github.com/searxng/searxng). The fork's
``openairepublications`` entry is a config-only ``json_engine`` on the legacy
``api.openaire.eu/search/publications`` endpoint, which timed out after 30 s on
2026-10-10 and cannot return DOI/date/journal; this module uses the Graph API v1
(``/graph/v1/researchProducts``), which answers in ~1.5 s with DOI, PMID, abstract,
date and journal. No key needed (anonymous limit reported as ~7200 requests/hour).

- ``url`` is the PubMed page when the record has a PMID, else the DOI link, else the
  first instance URL, else the OpenAIRE Explore page;
- ``content`` is the longest description (the abstract).

.. _OpenAIRE Graph: https://graph.openaire.eu/docs/apis/graph-api/

Configuration::

   - name: openaire
     engine: mra_openaire
     shortcut: oaire
     timeout: 8.0
"""

# SearXNG result dates are naive datetimes (as in the fork's own engines).
# ruff: noqa: DTZ007

from __future__ import annotations

import html
import re
import typing as t
from datetime import datetime
from urllib.parse import quote, urlencode

from searx.result_types import EngineResults  # type: ignore[import-not-found]

about = {
    "website": "https://explore.openaire.eu/",
    "wikidata_id": "Q25106053",
    "official_api_documentation": "https://graph.openaire.eu/docs/apis/graph-api/",
    "use_official_api": True,
    "require_api_key": False,
    "results": "JSON",
}

categories = ["science", "scientific publications"]
paging = True

api_url = "https://api.openaire.eu/graph/v1/researchProducts"
explore_url = "https://explore.openaire.eu/search/result?id="
pubmed_url = "https://pubmed.ncbi.nlm.nih.gov/"
page_size = 10

_TAG = re.compile(r"<[^>]+>")


def _clean(value: t.Any) -> str:
    if not value:
        return ""
    return " ".join(html.unescape(_TAG.sub(" ", str(value))).split())


def build_url(query: str, pageno: int) -> str:
    args = {"search": query, "type": "publication", "page": pageno, "pageSize": page_size}
    return f"{api_url}?{urlencode(args)}"


def request(query: str, params: dict[str, t.Any]) -> None:
    params["url"] = build_url(query, params["pageno"])


def _pid(item: dict[str, t.Any], scheme: str) -> str:
    for pid in item.get("pids") or []:
        if (pid or {}).get("scheme") == scheme and pid.get("value"):
            return str(pid["value"]).strip()
    for inst in item.get("instances") or []:
        for pid in (inst or {}).get("pids") or []:
            if (pid or {}).get("scheme") == scheme and pid.get("value"):
                return str(pid["value"]).strip()
    return ""


def parse(data: dict[str, t.Any]) -> list[dict[str, t.Any]]:
    papers: list[dict[str, t.Any]] = []
    for item in data.get("results") or []:
        title = _clean(item.get("mainTitle"))
        if not title:
            continue
        doi = _pid(item, "doi")
        pmid = _pid(item, "pmid")
        first_url = next((u for inst in item.get("instances") or [] for u in (inst or {}).get("urls") or []), "")
        if pmid:
            url = f"{pubmed_url}{pmid}/"
        elif doi:
            url = f"https://doi.org/{doi}"
        else:
            url = first_url or (explore_url + quote(str(item.get("id") or ""), safe=""))
        descriptions = sorted((_clean(d) for d in item.get("descriptions") or []), key=len, reverse=True)
        published = None
        try:
            published = datetime.strptime(str(item.get("publicationDate") or "")[:10], "%Y-%m-%d")
        except ValueError:
            pass
        container = item.get("container") or {}
        authors = sorted(item.get("authors") or [], key=lambda a: (a or {}).get("rank") or 0)
        papers.append({
            "url": url,
            "title": title,
            "content": descriptions[0] if descriptions else "",
            "journal": _clean(container.get("name")),
            "publisher": _clean(item.get("publisher")),
            "issn": [x for x in (container.get("issnPrinted"), container.get("issnOnline")) if x],
            "authors": [_clean(a.get("fullName")) for a in authors if (a or {}).get("fullName")],
            "doi": doi,
            "publishedDate": published,
            "volume": str(container.get("vol") or ""),
            "html_url": explore_url + quote(str(item.get("id") or ""), safe="") if item.get("id") else "",
        })
    return papers


def response(resp: t.Any) -> EngineResults:
    res = EngineResults()
    for kwargs in parse(resp.json()):
        res.add(res.types.Paper(**kwargs))
    return res
