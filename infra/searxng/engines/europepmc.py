# SPDX-License-Identifier: AGPL-3.0-or-later
"""`Europe PMC`_ provides comprehensive access to life sciences literature from
trusted sources: PubMed/MEDLINE, PubMed Central, preprints (``SRC:PPR``), Agricola
and more.

Ported from SearXNG's ``searx/engines/europepmc.py`` (AGPL-3.0-or-later,
https://github.com/searxng/searxng); the SearXNG fork we run does not ship it.
Changes for the Medical Reviewer Agent:

- stateless paging (one request of ``page_size * pageno`` records, sliced) instead
  of a cursor cache, because the backend requests pages concurrently;
- the result ``url`` is the PubMed page when the record has a PMID (so PMIDs reach
  the backend and results merge with the PubMed engine), otherwise the Europe PMC
  article page; ``html_url`` is the Europe PMC page (``/article/PMC/<pmcid>`` when a
  PMCID exists);
- the PMCID and preprint status are kept in ``comments``;
- parsing is dependency-free so the backend's unit tests can run it.

.. _Europe PMC: https://europepmc.org/

Configuration::

   - name: europe pmc
     engine: europepmc
     shortcut: epmc
     timeout: 8.0
"""

# SearXNG result dates are naive datetimes (as in the fork's own engines).
# ruff: noqa: DTZ001, DTZ007

from __future__ import annotations

import typing as t
from datetime import datetime
from urllib.parse import urlencode

from searx.engines.mra_markup import clean_markup as _clean  # type: ignore[import-not-found]
from searx.result_types import EngineResults  # type: ignore[import-not-found]

about = {
    "website": "https://europepmc.org/",
    "wikidata_id": "Q5412157",
    "official_api_documentation": "https://europepmc.org/RestfulWebService",
    "use_official_api": True,
    "require_api_key": False,
    "results": "JSON",
}

categories = ["science", "scientific publications"]
paging = True

search_url = "https://www.ebi.ac.uk/europepmc/webservices/rest/search"
article_url = "https://europepmc.org/article/"
pubmed_url = "https://pubmed.ncbi.nlm.nih.gov/"
page_size = 20
max_page_size = 100  # Europe PMC caps pageSize at 1000; keep requests small

# Real tags only: a literal "<" ("p<0.001") must survive. Inline markup joins ("CO<sub>2</sub>" -> "CO2"), other tags
# become a space.


def request(query: str, params: dict[str, t.Any]) -> None:
    size = page_size * params["pageno"]
    if size > max_page_size:
        params["url"] = None
        return
    args = {"query": query, "format": "json", "resultType": "core", "pageSize": size}
    params["url"] = f"{search_url}?{urlencode(args)}"


def _published(item: dict[str, t.Any]) -> datetime | None:
    for key in ("firstPublicationDate", "electronicPublicationDate"):
        value = item.get(key) or ""
        try:
            return datetime.strptime(value[:10], "%Y-%m-%d")
        except ValueError:
            continue
    year = str(item.get("pubYear") or "")
    return datetime(int(year), 1, 1) if year.isdigit() else None


def _authors(item: dict[str, t.Any]) -> list[str]:
    names = [_clean(a.get("fullName")) for a in (item.get("authorList") or {}).get("author", [])]
    names = [n for n in names if n]
    if names:
        return names
    authors = item.get("authorString") or ""
    return [a.strip().rstrip(".") for a in authors.split(",") if a.strip()]


def parse(data: dict[str, t.Any], pageno: int = 1) -> list[dict[str, t.Any]]:
    """Paper keyword arguments for the records of page ``pageno``."""
    items = (data.get("resultList") or {}).get("result") or []
    items = items[page_size * (pageno - 1):]
    papers: list[dict[str, t.Any]] = []
    for item in items:
        title = _clean(item.get("title"))
        if not title:
            continue
        source = item.get("source") or ""
        identifier = item.get("id") or ""
        pmid = str(item.get("pmid") or "")
        pmcid = str(item.get("pmcid") or "")
        epmc_url = f"{article_url}{source}/{identifier}" if source and identifier else ""
        if pmcid:
            epmc_url = f"{article_url}PMC/{pmcid}"
        journal = ((item.get("journalInfo") or {}).get("journal") or {})
        journal_title = _clean(journal.get("title")) or _clean(
            (item.get("bookOrReportDetails") or {}).get("publisher"))
        issn = [x for x in (journal.get("issn"), journal.get("essn")) if x]
        pub_types = (item.get("pubTypeList") or {}).get("pubType") or []
        comments = []
        if pmcid:
            comments.append(f"PMCID: {pmcid}")
        if source == "PPR":
            comments.append("Preprint")
        papers.append({
            "url": f"{pubmed_url}{pmid}/" if pmid else epmc_url,
            "title": title,
            "content": _clean(item.get("abstractText")),
            "journal": journal_title,
            "issn": issn,
            "authors": _authors(item),
            "doi": item.get("doi") or "",
            "publishedDate": _published(item),
            "type": ", ".join(pub_types),
            "html_url": epmc_url,
            "comments": "; ".join(comments),
        })
        if len(papers) >= page_size:
            break
    return papers


def response(resp: t.Any) -> EngineResults:
    res = EngineResults()
    for kwargs in parse(resp.json(), resp.search_params["pageno"]):
        res.add(res.types.Paper(**kwargs))
    return res
