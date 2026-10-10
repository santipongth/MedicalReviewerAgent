from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import Any

import httpx

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


_TRIAL_NAME = re.compile(r"[A-Z][A-Z0-9]+(?:-[A-Za-z0-9]+)*|[A-Z]+-[A-Za-z0-9-]+")


def trial_names(words: str) -> list[str]:
    """The trial names or acronyms of a query that is a list of them (at least 2, and at least half of its words),
    else []. Europe PMC ANDs plain words, so such a list must be searched as alternatives."""
    tokens = words.split()
    names = [t for t in tokens if len(t) >= 3 and _TRIAL_NAME.fullmatch(t)]
    return list(dict.fromkeys(names)) if len(names) >= 2 and 2 * len(names) >= len(tokens) else []


# Europe PMC answers 429/5xx under load (measured 2026-10-10: the trial searches and the enrichment lookup of two
# concurrent reviews failed with HTTPStatusError, a 503 "temporarily unavailable", while the same requests succeeded
# moments later).
RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})


def _phrase(text: str) -> str:
    """Words, spaces and hyphens only: a quoted Europe PMC phrase never carries user syntax."""
    return " ".join(re.sub(r"[^\w\s-]", " ", text).split())


class EuropePmcClient:
    BATCH = 40
    CONCURRENCY = 3  # batches in flight; HttpClient's per-host spacing still applies
    TRIAL_TIMEOUT = 8.0  # seconds per trial-search attempt
    # Bounded backoff before each retry (Plan 20 Task 10): at most 3 attempts (two retries after a 429/5xx answer, at
    # most one after a timeout or connection error). Worst case for a trial search: 3 x TRIAL_TIMEOUT + 1 s + 2 s,
    # about 27 s (a timeout, a slow 5xx, then another timeout). A lookup batch keeps its concurrency slot while it
    # waits.
    RETRY_DELAYS = (1.0, 2.0)
    TRANSPORT_RETRIES = 1

    def __init__(self, http: HttpClient, base_url: str, *, sleep=asyncio.sleep) -> None:
        self.http = http
        self.base_url = base_url.rstrip("/")
        self._sleep = sleep

    async def _get(self, url: str, params: dict[str, Any], *, timeout: float | None = None,
                   last_params: dict[str, Any] | None = None) -> httpx.Response:
        """GET with the bounded retry above; the shared HttpClient's own retries are off here, so this backoff is the
        only one. `last_params` replaces the params on the final attempt (the trial search drops its citation sort,
        the expensive part, when the sorted query keeps failing). Raises HTTPStatusError, or the transport error,
        when every attempt failed."""
        attempts = len(self.RETRY_DELAYS) + 1
        transport_failures = 0
        for attempt in range(attempts):
            final = attempt == attempts - 1
            kwargs: dict[str, Any] = {"params": last_params if final and last_params is not None else params,
                                      "retries": 0}
            if timeout is not None:
                kwargs["timeout"] = timeout
            try:
                resp = await self.http.get(url, **kwargs)
            except httpx.TransportError:
                transport_failures += 1
                if final or transport_failures > self.TRANSPORT_RETRIES:
                    raise
            else:
                if resp.status_code not in RETRY_STATUSES or final:
                    resp.raise_for_status()
                    return resp
            await self._sleep(self.RETRY_DELAYS[attempt])
        raise AssertionError("unreachable")

    async def _batch(self, terms: list[str], gate: asyncio.Semaphore) -> list[Candidate]:
        async with gate:
            resp = await self._get(
                f"{self.base_url}/search",
                {"query": " OR ".join(terms), "format": "json", "resultType": "core", "pageSize": 100},
            )
        return [parse_epmc_result(r) for r in resp.json().get("resultList", {}).get("result", [])]

    async def lookup(self, *, dois: list[str], pmids: list[str],
                     failures: list[str] | None = None) -> list[Candidate]:
        """Europe PMC records for the identifiers, in batch order. A batch that still fails after its retries is
        skipped and its error name is appended to `failures` (when given); only when every batch failed is the error
        raised."""
        terms = [f'DOI:"{d}"' for d in dict.fromkeys(dois)] + [
            f"(EXT_ID:{p} AND SRC:MED)" for p in dict.fromkeys(pmids)
        ]
        gate = asyncio.Semaphore(self.CONCURRENCY)
        batches = await asyncio.gather(
            *(self._batch(terms[i : i + self.BATCH], gate) for i in range(0, len(terms), self.BATCH)),
            return_exceptions=True,
        )
        errors = [b for b in batches if isinstance(b, BaseException)]
        for exc in errors:
            if not isinstance(exc, Exception):  # cancellation and the like are never swallowed
                raise exc
        if errors and len(errors) == len(batches):
            raise errors[-1]
        if failures is not None:
            failures += [type(e).__name__ for e in errors]
        return [c for batch in batches if not isinstance(batch, BaseException) for c in batch]  # batch order kept

    async def _rct_search(self, query: str, page_size: int) -> list[Candidate]:
        params = {"query": f'{query} AND PUB_TYPE:"Randomized Controlled Trial" AND HAS_ABSTRACT:y',
                  "format": "json", "resultType": "core", "pageSize": page_size, "sort": "CITED desc"}
        unsorted = {k: v for k, v in params.items() if k != "sort"}
        # a recall extra: a slow Europe PMC must not hold the search node for minutes (the searches run in parallel)
        resp = await self._get(f"{self.base_url}/search", params, timeout=self.TRIAL_TIMEOUT, last_params=unsorted)
        out = []
        for r in resp.json().get("resultList", {}).get("result", []):
            c = parse_epmc_result(r)
            out.append(c.model_copy(update={"engines": ["europe pmc"]}))
        return out

    async def search_trial_names(self, names: list[str], terms: list[str], *,
                                 page_size: int = 25) -> list[Candidate]:
        """RCTs that name any of `names` (trial acronyms harvested from the first search round) and any of `terms`
        (the review's intervention), most cited first (Plan 20 Task 10). Acronyms such as DELIVER or CANVAS are also
        English words, so the intervention terms are required. Measured 2026-10-10 on the SGLT2 / heart-failure
        question: the first 13 hits include EMPA-REG OUTCOME, CANVAS, DAPA-HF, DECLARE-TIMI 58, EMPEROR-Reduced,
        EMPEROR-Preserved, DELIVER, SOLOIST-WHF, VERTIS-CV and EMPULSE; without the terms the first hits were
        unrelated landmark trials (COVID-19 vaccines, melanoma)."""
        names = [n for n in dict.fromkeys(_phrase(n) for n in names) if n]
        terms = [t for t in dict.fromkeys(_phrase(t) for t in terms) if t]
        if not names or not terms:
            return []
        quoted = " OR ".join(f'"{n}"' for n in names)
        scope = " OR ".join(f'"{t}"' for t in terms)
        return await self._rct_search(f"({quoted}) AND ({scope})", page_size)

    async def search_trials(self, query: str, *, page_size: int = 25) -> list[Candidate]:
        """Randomized controlled trials with an abstract that match the keyword query, most cited first (meta-analysis
        recall, audit I-9: the landmark trials of a topic are its most cited RCTs; measured 2026-10-10, "SGLT2
        inhibitors heart failure hospitalization" returns DAPA-HF, EMPEROR-Reduced, DELIVER, SOLOIST and EMPULSE in
        the first 20, while the default order is newest first). The hits carry the SearXNG engine name "europe pmc"
        so they are treated as search hits, not as lookup records. Words only: the query never carries user syntax."""
        words = " ".join(re.sub(r"[^\w\s-]", " ", query).split())
        if not words:
            return []
        names = trial_names(words)
        if names:  # a list of trial names ("DAPA-HF EMPEROR-Reduced DELIVER"): any of them, not all at once
            words = " OR ".join(f'"{n}"' for n in names)
        return await self._rct_search(f"({words})", page_size)

    REF_PAGE = 1000
    REF_MAX_PAGES = 3

    async def references(self, source: str, id: str, *, max_pages: int | None = None) -> list[EpmcReference]:
        """Reference list (metadata only) of one Europe PMC record; [] when it has none or is unknown."""
        out: list[EpmcReference] = []
        for page in range(1, (max_pages or self.REF_MAX_PAGES) + 1):
            try:
                resp = await self._get(f"{self.base_url}/{source}/{id}/references",
                                       {"format": "json", "pageSize": self.REF_PAGE, "page": page})
            except httpx.HTTPStatusError as exc:
                if exc.response.status_code == 404:
                    return out
                raise
            data = resp.json()
            items = (data.get("referenceList") or {}).get("reference") or []
            out += [ref for ref in map(parse_epmc_reference, items) if ref]
            if len(items) < self.REF_PAGE or len(out) >= (data.get("hitCount") or 0):
                break
        return out
