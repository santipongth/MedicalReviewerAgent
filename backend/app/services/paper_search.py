"""Literature search without LLMs (SearXNG + Europe PMC metadata) and open-access full text from Europe PMC."""
from __future__ import annotations

import re

from app.graph.schemas import Candidate
from app.logging import get_logger
from app.services.dedupe import merge_candidates
from app.services.jats import extract_jats_text
from app.services.review_service import NotFound, ServiceError, Unprocessable

log = get_logger(__name__)
PMCID = re.compile(r"^PMC\d{1,10}$")


class SearchUnavailable(ServiceError):
    status_code = 502


class PaperSearch:
    def __init__(self, searxng, europepmc, *, max_fulltext_chars: int = 60_000) -> None:
        self.searxng = searxng
        self.europepmc = europepmc
        self.max_fulltext_chars = max_fulltext_chars

    async def search(self, query: str, limit: int = 10) -> list[Candidate]:
        try:
            hits = await self.searxng.search(query)
        except Exception as exc:
            raise SearchUnavailable(f"literature search is unavailable: {type(exc).__name__}") from exc
        merged = merge_candidates(hits)
        dois = [c.doi for c in merged if c.doi]
        pmids = [c.pmid for c in merged if c.pmid]
        if dois or pmids:
            try:
                records = await self.europepmc.lookup(dois=dois, pmids=pmids)
            except Exception as exc:  # noqa: BLE001 - metadata enrichment is optional
                log.warning("paper_search_enrich_failed", error=type(exc).__name__)
                records = []
            if records:  # Europe PMC first so its curated metadata wins; drop records that matched nothing
                merged = [c for c in merge_candidates([*records, *merged]) if c.engines != ["europepmc"]]
        return merged[:limit]

    async def fulltext(self, pmcid: str) -> dict:
        pmcid = pmcid.strip().upper()
        if not PMCID.match(pmcid):
            raise Unprocessable("pmcid must look like PMC1234567")
        xml = await self.europepmc.fulltext_xml(pmcid)
        text = extract_jats_text(xml, max_chars=self.max_fulltext_chars) if xml else None
        if not text:
            raise NotFound(f"no open-access full text for {pmcid} in Europe PMC")
        return {"pmcid": pmcid, "source": "europepmc", "text": text}
