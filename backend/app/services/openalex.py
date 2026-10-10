from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass, field
from typing import Any

from app.services.http import HttpClient
from app.services.text import normalize_doi

SELECT = "id,doi,ids,publication_year,referenced_works,cited_by_count"
_DIGITS = re.compile(r"(\d+)\s*$")


@dataclass(frozen=True)
class OpenAlexWork:
    openalex_id: str  # https://openalex.org/W...
    referenced_works: list[str] = field(default_factory=list)  # raw OpenAlex work ids
    cited_by_count: int | None = None
    year: int | None = None


def parse_work(w: dict[str, Any]) -> tuple[OpenAlexWork, str | None, str | None]:
    """-> (work, normalized doi, pmid digits)."""
    ids = w.get("ids") or {}
    pm = _DIGITS.search(ids.get("pmid") or "")
    year = w.get("publication_year")
    cites = w.get("cited_by_count")
    work = OpenAlexWork(
        openalex_id=w.get("id") or "",
        referenced_works=[r for r in (w.get("referenced_works") or []) if isinstance(r, str)],
        cited_by_count=cites if isinstance(cites, int) else None,
        year=year if isinstance(year, int) else None,
    )
    return work, normalize_doi(w.get("doi") or ids.get("doi")), pm.group(1) if pm else None


class OpenAlexClient:
    """Citation metadata only (reference ids and counts). No full text.

    A batched filter call counts as one list call (~$0.0001). The key and mailto are never logged.
    """

    BATCH = 50
    CONCURRENCY = 3

    def __init__(
        self, http: HttpClient, base_url: str = "https://api.openalex.org", *,
        api_key: str = "", mailto: str = "", timeout: float = 6.0, retries: int = 0,
    ) -> None:
        self.http = http
        self.base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._mailto = mailto
        self.timeout = timeout
        self.retries = retries

    async def _batch(self, field_name: str, values: list[str], gate: asyncio.Semaphore) -> list[dict[str, Any]]:
        params: dict[str, Any] = {
            "filter": f"{field_name}:{'|'.join(values)}", "per_page": self.BATCH, "select": SELECT,
        }
        if self._api_key:
            params["api_key"] = self._api_key
        if self._mailto:
            params["mailto"] = self._mailto
        async with gate:
            resp = await self.http.get(f"{self.base_url}/works", params=params, timeout=self.timeout, retries=self.retries)
        resp.raise_for_status()
        return resp.json().get("results") or []

    async def works_by_ids(self, dois: list[str], pmids: list[str]) -> dict[str, OpenAlexWork]:
        """Keys are `doi:<normalized doi>` / `pmid:<digits>` for each input id OpenAlex knows.

        A work found by DOI that also reports a PMID is stored under both keys when the PMID was asked for."""
        # `,` and `|` are filter syntax; such DOIs are skipped rather than mis-parsed.
        ds = [d for d in dict.fromkeys(normalize_doi(x) for x in dois) if d and "," not in d and "|" not in d]
        ps = [p for p in dict.fromkeys(str(x).strip() for x in pmids) if p.isdigit()]
        gate = asyncio.Semaphore(self.CONCURRENCY)
        jobs = [self._batch("doi", ds[i : i + self.BATCH], gate) for i in range(0, len(ds), self.BATCH)]
        jobs += [self._batch("ids.pmid", ps[i : i + self.BATCH], gate) for i in range(0, len(ps), self.BATCH)]
        wanted_d, wanted_p = set(ds), set(ps)
        out: dict[str, OpenAlexWork] = {}
        results = await asyncio.gather(*jobs, return_exceptions=True)
        failed = [r for r in results if isinstance(r, BaseException)]
        if failed and len(failed) == len(results):
            raise failed[0]  # only when every batch failed; otherwise keep the batches that answered
        for batch in (r for r in results if not isinstance(r, BaseException)):
            for raw in batch:
                work, doi, pmid = parse_work(raw)
                if not work.openalex_id:
                    continue
                if doi in wanted_d:
                    out.setdefault(f"doi:{doi}", work)
                if pmid in wanted_p:
                    out.setdefault(f"pmid:{pmid}", work)
        return out
