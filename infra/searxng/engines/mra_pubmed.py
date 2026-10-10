# SPDX-License-Identifier: AGPL-3.0-or-later
"""PubMed engine for the MRA SearXNG instance (replaces the fork's ``pubmed`` module).

Derived from SearXNG's ``searx/engines/pubmed.py`` (AGPL-3.0-or-later,
https://github.com/searxng/searxng). Changes for the Medical Reviewer Agent:

- the esearch call honours the engine ``timeout`` (the fork hard-codes 3 s, which made
  the engine time out and get suspended);
- ``api_key`` (env ``NCBI_API_KEY``), ``tool`` and ``email`` are sent when set;
- requests are spaced per process (under 3 req/s without a key, 10 with); an HTTP 429 is
  retried twice and never reaches SearXNG's error handling (which suspends the engine for
  an hour);
- the whole structured abstract is returned (the fork kept only its first section);
- ``publishedDate`` falls back through ArticleDate, PubDate and the PubMed history
  (the fork used only the "accepted" date, often missing).

Configuration (``infra/searxng/settings.yml``)::

   - name: pubmed
     engine: mra_pubmed
     timeout: 12.0

Parsing lives in dependency-free helpers (stdlib ``xml.etree``) so the backend's unit
tests can exercise it without SearXNG installed.
"""

# SearXNG result dates are naive datetimes (as in the fork's own engines).
# ruff: noqa: DTZ001

from __future__ import annotations

import json
import logging
import os
import threading
import time
import typing as t
import xml.etree.ElementTree as ET
from datetime import datetime
from urllib.parse import urlencode

from searx.network import get  # type: ignore[import-not-found]
from searx.result_types import EngineResults  # type: ignore[import-not-found]

about = {
    "website": "https://pubmed.ncbi.nlm.nih.gov/",
    "wikidata_id": "Q1540899",
    "official_api_documentation": "https://www.ncbi.nlm.nih.gov/books/NBK25501/",
    "use_official_api": True,
    "require_api_key": False,
    "results": "XML",
}

categories = ["science", "scientific publications"]
paging = True

eutils_api = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
pubmed_url = "https://pubmed.ncbi.nlm.nih.gov/"
number_of_results = 10
tool = "medical-reviewer-agent"
email = ""
max_wait = 8.0  # seconds of queueing/backoff for esearch + efetch together; the engine timeout is 12 s

_MONTHS = {m: i for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], start=1)}

logger = logging.getLogger(__name__)  # replaced by SearXNG with the engine logger

_lock = threading.Lock()
_next_slot = 0.0


def _api_key() -> str:
    return os.environ.get("NCBI_API_KEY", "").strip()


def _throttle(deadline: float) -> bool:
    """Space E-utilities calls: NCBI allows 3 req/s without a key, 10 with one.

    Returns False (and reserves nothing) when the turn would come after ``deadline`` (a
    ``time.monotonic()`` value shared by one search's esearch and efetch), i.e. into the engine
    timeout; the caller then skips the call.
    """
    global _next_slot  # pylint: disable=global-statement
    interval = 0.12 if _api_key() else 0.45  # a little under the limit: arrival times jitter
    with _lock:
        now = time.monotonic()
        wait = max(0.0, _next_slot - now)
        if now + wait > deadline:
            return False
        _next_slot = max(now, _next_slot) + interval
    if wait:
        time.sleep(wait)
    return True


def common_args() -> dict[str, str]:
    args = {"tool": tool}
    if email:
        args["email"] = email
    if key := _api_key():
        args["api_key"] = key
    return args


def esearch_url(query: str, pageno: int) -> str:
    args = {
        "db": "pubmed",
        "term": query,
        "retstart": (pageno - 1) * number_of_results,
        "retmax": number_of_results,
        "sort": "relevance",
        "retmode": "json",
        **common_args(),
    }
    return f"{eutils_api}/esearch.fcgi?{urlencode(args)}"


def efetch_url(pmids: list[str]) -> str:
    args = {"db": "pubmed", "retmode": "xml", "id": ",".join(pmids), **common_args()}
    return f"{eutils_api}/efetch.fcgi?{urlencode(args)}"


def parse_esearch(payload: str | bytes) -> list[str]:
    data = json.loads(payload)
    return [str(i) for i in (data.get("esearchresult") or {}).get("idlist") or []]


def _get_with_retry(url: str, deadline: float) -> t.Any:
    """GET with the per-process spacing; up to two retries (after 1 s, then 2 s) on HTTP 429,
    none of which may start after ``deadline``."""
    resp = None
    for backoff in (1.0, 2.0, None):
        if not _throttle(deadline):
            logger.warning("PubMed request queue past the deadline; skipping this call")
            return None
        resp = get(url, raise_for_httperror=False)
        if resp.status_code != 429 or backoff is None or time.monotonic() + backoff > deadline:
            break
        time.sleep(backoff)
    return resp


def request(query: str, params: dict[str, t.Any]) -> None:
    # A 429 must not reach SearXNG's error handling: it suspends the engine for an hour.
    params["raise_for_httperror"] = False
    deadline = time.monotonic() + max_wait  # one budget for esearch and efetch
    resp = _get_with_retry(esearch_url(query, params["pageno"]), deadline)
    if resp is None or resp.status_code != 200:
        logger.warning("PubMed esearch HTTP %s", getattr(resp, "status_code", "?"))
        params["url"] = None
        return
    pmids = parse_esearch(resp.content)
    if not pmids:
        params["url"] = None  # nothing found: skip the efetch request
        return
    if not _throttle(deadline):
        logger.warning("PubMed request queue past the deadline; skipping efetch")
        params["url"] = None
        return
    params["url"] = efetch_url(pmids)


def _text(elem: ET.Element | None) -> str:
    if elem is None:
        return ""
    return " ".join("".join(elem.itertext()).split())


def _date_from(elem: ET.Element | None) -> datetime | None:
    if elem is None:
        return None
    year = _text(elem.find("Year"))
    if not year.isdigit():
        medline = _text(elem.find("MedlineDate"))  # e.g. "2019 Jul-Aug"
        year = medline[:4]
        if not year.isdigit():
            return None
    month_raw = _text(elem.find("Month")).lower()
    month = int(month_raw) if month_raw.isdigit() else _MONTHS.get(month_raw[:3], 1)
    day_raw = _text(elem.find("Day"))
    day = int(day_raw) if day_raw.isdigit() else 1
    try:
        return datetime(int(year), month, day)
    except ValueError:
        return datetime(int(year), 1, 1)


def _abstract(citation: ET.Element) -> str:
    parts = []
    for node in citation.findall("./Article/Abstract/AbstractText"):
        text = _text(node)
        if not text:
            continue
        label = (node.get("Label") or "").strip()
        parts.append(f"{label}: {text}" if label else text)
    return " ".join(parts)


def _published(article: ET.Element) -> datetime | None:
    citation = article.find("./MedlineCitation")
    for path in ("./Article/ArticleDate", "./Article/Journal/JournalIssue/PubDate"):
        if (found := _date_from(citation.find(path))) is not None:
            return found
    for status in ("pubmed", "entrez", "accepted"):
        found = _date_from(article.find(f"./PubmedData/History/PubMedPubDate[@PubStatus='{status}']"))
        if found is not None:
            return found
    return None


def parse_efetch(payload: str | bytes) -> list[dict[str, t.Any]]:
    """Paper keyword arguments for each PubmedArticle in an efetch XML document."""
    root = ET.fromstring(payload)
    papers: list[dict[str, t.Any]] = []
    for article in root.iter("PubmedArticle"):
        citation = article.find("./MedlineCitation")
        if citation is None:
            continue
        pmid = _text(citation.find("./PMID"))
        title = _text(citation.find("./Article/ArticleTitle"))
        if not pmid or not title:
            continue
        doi = _text(citation.find("./Article/ELocationID[@EIdType='doi']")) or _text(
            article.find("./PubmedData/ArticleIdList/ArticleId[@IdType='doi']"))
        pmcid = _text(article.find("./PubmedData/ArticleIdList/ArticleId[@IdType='pmc']"))
        authors = []
        for author in citation.findall("./Article/AuthorList/Author"):
            name = " ".join(x for x in (_text(author.find("ForeName")), _text(author.find("LastName"))) if x)
            name = name or _text(author.find("CollectiveName"))
            if name:
                authors.append(name)
        issn = _text(citation.find("./Article/Journal/ISSN"))
        papers.append({
            "url": f"{pubmed_url}{pmid}/",
            "title": title,
            "content": _abstract(citation),
            "journal": _text(citation.find("./Article/Journal/Title")),
            "issn": [issn] if issn else [],
            "authors": authors,
            "doi": doi,
            "publishedDate": _published(article),
            "type": ", ".join(_text(p) for p in citation.findall("./Article/PublicationTypeList/PublicationType")),
            "html_url": f"https://pmc.ncbi.nlm.nih.gov/articles/{pmcid}/" if pmcid else "",
        })
    return papers


def response(resp: t.Any) -> EngineResults:
    res = EngineResults()
    content = resp.content
    if resp.status_code == 429:
        retry = _get_with_retry(str(resp.url), time.monotonic() + 2.0)
        content = retry.content if retry is not None and retry.status_code == 200 else b""
    elif resp.status_code != 200:
        content = b""
    if not content:
        logger.warning("PubMed efetch HTTP %s; no results this time", resp.status_code)
        return res
    for kwargs in parse_efetch(content):
        res.add(res.types.Paper(**kwargs))
    return res
