from __future__ import annotations

import asyncio
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
