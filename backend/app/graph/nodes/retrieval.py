from __future__ import annotations

import asyncio
import time

from app.graph.progress import progress_writer
from app.graph.schemas import Candidate
from app.graph.state import ReviewState
from app.schemas.review import ReviewOptions
from app.services.dedupe import merge_candidates

# Papers are analysed from their abstracts, so a candidate needs one long enough to hold a result.
MIN_ABSTRACT_CHARS = 150
# Publication types (Europe PMC) that never carry study results; a retraction notice excludes a paper outright.
NON_RESEARCH_TYPES = frozenset({"editorial", "letter", "comment", "news", "published erratum"})
RETRACTED_TYPES = frozenset({"retracted publication", "retraction of publication"})


def is_non_research(c: Candidate) -> bool:
    types = {t.strip().lower() for t in c.pub_types}
    return bool(types & RETRACTED_TYPES) or (bool(types) and types <= NON_RESEARCH_TYPES)


# A search-engine snippet only counts as the abstract when it is long and not visibly cut off.
MIN_SNIPPET_CHARS = 600


def already_enriched(c: Candidate) -> bool:
    return "europe pmc" in c.engines and c.abstract_source == "engine" and bool(c.pmcid)


def usable_abstract(c: Candidate) -> bool:
    text = (c.abstract or "").strip()
    if len(text) < MIN_ABSTRACT_CHARS:
        return False
    if c.abstract_source == "snippet":
        return len(text) >= MIN_SNIPPET_CHARS and not text.endswith(("…", "..."))
    return True


def make_search(deps):
    async def search(state: ReviewState) -> dict:
        started = time.perf_counter()
        queries = (state.get("plan") or {}).get("queries") or [state.get("english_topic") or state["topic"]]
        jobs = [(q, page) for q in queries for page in range(1, deps.settings.searxng_pages + 1)]
        results = await asyncio.gather(*(deps.searxng.search(q, pageno=p) for q, p in jobs),
                                       return_exceptions=True)
        per_query: dict[str, list[Candidate]] = {q: [] for q in queries}
        errors: list[str] = []
        for (q, page), res in zip(jobs, results, strict=True):
            if isinstance(res, BaseException):
                errors.append(f"search failed for '{q}' page {page}: {type(res).__name__}")
            else:
                per_query[q].extend(res)
        # Round-robin by rank across queries: the candidate cut keeps each query's best hits instead of
        # favouring the first query or highly cited (older) papers.
        found: list[Candidate] = []
        for rank in range(max((len(v) for v in per_query.values()), default=0)):
            found.extend(v[rank] for v in per_query.values() if rank < len(v))
        progress_writer()({"type": "searching", "found": len(found), "queries": len(queries),
                             "failed": len(errors)})
        return {"candidates": [c.model_dump() for c in found], "errors": errors,
                "search_stats": {"found": len(found)},
                "quality": [{"stage": "search", "queries": len(queries), "failed": len(errors),
                             "seconds": round(time.perf_counter() - started, 3)}]}

    return search


def make_enrich(deps):
    async def enrich(state: ReviewState) -> dict:
        started = time.perf_counter()
        options = ReviewOptions.clamped(state.get("options"))
        merged = merge_candidates(Candidate.model_validate(c) for c in state.get("candidates") or [])
        errors: list[str] = []
        # Hits that already carry the Europe PMC engine's full abstract and a PMCID have nothing left to gain from
        # the lookup (its pub types come with the hit); everything else is looked up and Europe PMC metadata wins.
        lookup = [c for c in merged if not already_enriched(c)]
        dois = [c.doi for c in lookup if c.doi]
        pmids = [c.pmid for c in lookup if c.pmid]
        records: list[Candidate] = []
        if dois or pmids:
            try:
                records = await deps.europepmc.lookup(dois=dois, pmids=pmids)
            except Exception as exc:  # noqa: BLE001 - enrichment is optional; keep search hits
                errors.append(f"Europe PMC enrichment failed: {type(exc).__name__}")
        # Europe PMC first so its curated metadata wins scalar fields.
        enriched = merge_candidates([*records, *merged]) if records else merged
        enriched = [c for c in enriched if c.engines != ["europepmc"]]
        unique = len(enriched)
        if options.year_from:
            enriched = [c for c in enriched if c.year is None or c.year >= options.year_from]
        non_research = sum(1 for c in enriched if is_non_research(c))
        enriched = [c for c in enriched if not is_non_research(c)]
        snippet_only = sum(1 for c in enriched if c.abstract_source == "snippet" and not usable_abstract(c)
                           and len((c.abstract or "").strip()) >= MIN_ABSTRACT_CHARS)
        enriched = [c for c in enriched if usable_abstract(c)]
        kept = enriched[: options.candidate_limit]  # search rank order is kept
        progress_writer()({"type": "enriching", "candidates": len(kept)})
        return {"candidates": [c.model_dump() for c in kept], "errors": errors,
                "search_stats": {**(state.get("search_stats") or {}), "unique": unique,
                                 "with_abstract": len(enriched), "non_research": non_research},
                "quality": [{"stage": "enrich", "snippet_only": snippet_only,
                             "looked_up": len(lookup), "skipped_lookup": len(merged) - len(lookup),
                             "seconds": round(time.perf_counter() - started, 3)}]}

    return enrich
