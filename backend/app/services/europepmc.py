from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import Any

from app.graph.schemas import Candidate
from app.services.http import HttpClient
from app.services.text import normalize_doi, strip_markup


def parse_epmc_result(r: dict[str, Any]) -> Candidate:
    urls = (r.get("fullTextUrlList") or {}).get("fullTextUrl") or []
    free = [u for u in urls if u.get("availabilityCode") in ("OA", "F")]
    pdf = next((u.get("url") for u in free if u.get("documentStyle") == "pdf"), None)
    html_url = next((u.get("url") for u in free if u.get("documentStyle") == "html"), None)
    pub_types = (r.get("pubTypeList") or {}).get("pubType") or []
    if isinstance(pub_types, str):
        pub_types = [pub_types]
    year = str(r.get("pubYear") or "")
    authors = [
        a["fullName"] for a in (r.get("authorList") or {}).get("author", []) if a.get("fullName")
    ]
    journal = ((r.get("journalInfo") or {}).get("journal") or {}).get("title")
    return Candidate(
        title=strip_markup(r.get("title")).rstrip("."),
        abstract=strip_markup(r.get("abstractText")) or None,
        abstract_source="europepmc" if r.get("abstractText") else None,
        doi=normalize_doi(r.get("doi")),
        pmid=r.get("pmid"),
        pmcid=r.get("pmcid"),
        year=int(year) if year.isdigit() else None,
        journal=journal,
        authors=authors[:20],
        url=html_url or f"https://europepmc.org/article/{r.get('source')}/{r.get('id')}",
        pdf_url=pdf,
        is_open_access=r.get("isOpenAccess") == "Y",
        pub_types=list(pub_types),
        cited_by=r.get("citedByCount"),
        engines=["europepmc"],
    )


@dataclass(frozen=True)
class EpmcReference:
    source: str | None
    id: str | None
    doi: str | None = None
    pmid: str | None = None
    title: str | None = None
    year: int | None = None


def parse_epmc_reference(r: Any) -> EpmcReference | None:
    if not isinstance(r, dict):
        return None
    source = str(r["source"]).upper() if r.get("source") else None
    rid = str(r["id"]) if r.get("id") else None
    doi = normalize_doi(r.get("doi"))
    if not (rid or doi):
        return None
    year = r.get("pubYear")
    return EpmcReference(
        source=source, id=rid, doi=doi,
        pmid=rid if source == "MED" and rid and rid.isdigit() else None,
        title=strip_markup(r.get("title")).rstrip(".") or None,
        year=int(year) if str(year).isdigit() else None,
    )


class EuropePmcClient:
    BATCH = 40
    CONCURRENCY = 3  # batches in flight; HttpClient's per-host spacing still applies

    def __init__(self, http: HttpClient, base_url: str) -> None:
        self.http = http
        self.base_url = base_url.rstrip("/")

    async def _batch(self, terms: list[str], gate: asyncio.Semaphore) -> list[Candidate]:
        async with gate:
            resp = await self.http.get(
                f"{self.base_url}/search",
                params={"query": " OR ".join(terms), "format": "json", "resultType": "core", "pageSize": 100},
            )
        resp.raise_for_status()
        return [parse_epmc_result(r) for r in resp.json().get("resultList", {}).get("result", [])]

    async def lookup(self, *, dois: list[str], pmids: list[str]) -> list[Candidate]:
        terms = [f'DOI:"{d}"' for d in dict.fromkeys(dois)] + [
            f"(EXT_ID:{p} AND SRC:MED)" for p in dict.fromkeys(pmids)
        ]
        gate = asyncio.Semaphore(self.CONCURRENCY)
        batches = await asyncio.gather(
            *(self._batch(terms[i : i + self.BATCH], gate) for i in range(0, len(terms), self.BATCH))
        )
        return [c for batch in batches for c in batch]  # batch order kept

    async def search_trials(self, query: str, *, page_size: int = 25) -> list[Candidate]:
        """Randomized controlled trials with an abstract that match the keyword query, most cited first (meta-analysis
        recall, audit I-9: the landmark trials of a topic are its most cited RCTs; measured 2026-10-10, "SGLT2
        inhibitors heart failure hospitalization" returns DAPA-HF, EMPEROR-Reduced, DELIVER, SOLOIST and EMPULSE in
        the first 20, while the default order is newest first). The hits carry the SearXNG engine name "europe pmc"
        so they are treated as search hits, not as lookup records. Words only: the query never carries user syntax."""
        words = " ".join(re.sub(r"[^\w\s-]", " ", query).split())
        if not words:
            return []
        resp = await self.http.get(
            f"{self.base_url}/search",
            params={"query": f'({words}) AND PUB_TYPE:"Randomized Controlled Trial" AND HAS_ABSTRACT:y',
                    "format": "json", "resultType": "core", "pageSize": page_size, "sort": "CITED desc"},
        )
        resp.raise_for_status()
        out = []
        for r in resp.json().get("resultList", {}).get("result", []):
            c = parse_epmc_result(r)
            out.append(c.model_copy(update={"engines": ["europe pmc"]}))
        return out

    REF_PAGE = 1000
    REF_MAX_PAGES = 3

    async def references(self, source: str, id: str, *, max_pages: int | None = None) -> list[EpmcReference]:
        """Reference list (metadata only) of one Europe PMC record; [] when it has none or is unknown."""
        out: list[EpmcReference] = []
        for page in range(1, (max_pages or self.REF_MAX_PAGES) + 1):
            resp = await self.http.get(
                f"{self.base_url}/{source}/{id}/references",
                params={"format": "json", "pageSize": self.REF_PAGE, "page": page},
            )
            if resp.status_code == 404:
                return out
            resp.raise_for_status()
            data = resp.json()
            items = (data.get("referenceList") or {}).get("reference") or []
            out += [ref for ref in map(parse_epmc_reference, items) if ref]
            if len(items) < self.REF_PAGE or len(out) >= (data.get("hitCount") or 0):
                break
        return out
