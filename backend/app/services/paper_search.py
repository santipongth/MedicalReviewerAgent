"""Literature search without LLMs (SearXNG + Europe PMC metadata)."""
from __future__ import annotations

from app.graph.schemas import Candidate
from app.logging import get_logger
from app.services.dedupe import merge_candidates
from app.services.review_service import ServiceError

log = get_logger(__name__)


class SearchUnavailable(ServiceError):
    status_code = 502


class PaperSearch:
    def __init__(self, searxng, europepmc) -> None:
        self.searxng = searxng
        self.europepmc = europepmc

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
