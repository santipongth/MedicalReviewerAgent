from __future__ import annotations

import asyncio
import re
import time
from collections import Counter
from datetime import UTC, datetime

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
    """A hit that already carries Europe PMC's own abstract and metadata: the SearXNG Europe PMC engine (with a
    PMCID), or the direct trial search (abstract_source "europepmc")."""
    return "europe pmc" in c.engines and (c.abstract_source == "europepmc"
                                          or (c.abstract_source == "engine" and bool(c.pmcid)))


def usable_abstract(c: Candidate) -> bool:
    text = (c.abstract or "").strip()
    if len(text) < MIN_ABSTRACT_CHARS:
        return False
    if c.abstract_source == "snippet":
        return len(text) >= MIN_SNIPPET_CHARS and not text.endswith(("…", "..."))
    return True


# SearXNG requests in flight per review (a meta review issues up to 10): smooths the burst on SearXNG's limiter.
SEARXNG_CONCURRENCY = 4
_DESIGN_WORDS = re.compile(r"\b(randomi[sz]ed|controlled|clinical|trials?|rcts?|studies|study)\b", re.IGNORECASE)


def wants_trial_search(options: ReviewOptions) -> bool:
    """Meta-analysis only, and only when RCTs are acceptable (no ticked study types, or RCT among them)."""
    return options.review_type == "meta_analysis" and (not options.study_types or "RCT" in options.study_types)


def trial_search_queries(queries: list[str], limit: int) -> list[str]:
    """The planner's queries without design words (the Europe PMC filter supplies the design), deduplicated."""
    out: dict[str, str] = {}
    for q in queries:
        words = " ".join(_DESIGN_WORDS.sub(" ", q).split())
        if words and words.lower() not in out:
            out[words.lower()] = words
    return list(out.values())[: max(0, limit)]


def make_search(deps):
    async def search(state: ReviewState) -> dict:
        started = time.perf_counter()
        options = ReviewOptions.clamped(state.get("options"))
        settings = deps.settings
        queries = (state.get("plan") or {}).get("queries") or [state.get("english_topic") or state["topic"]]
        pages = settings.searxng_pages_meta if options.review_type == "meta_analysis" else settings.searxng_pages
        jobs = [(q, page) for q in queries for page in range(1, max(1, pages) + 1)]
        trial_queries = (trial_search_queries(queries, settings.trial_search_queries)
                         if wants_trial_search(options) and getattr(deps, "europepmc", None) is not None else [])
        gate = asyncio.Semaphore(SEARXNG_CONCURRENCY)

        async def searx(q: str, page: int) -> list[Candidate]:
            async with gate:
                return await deps.searxng.search(q, pageno=page)

        results = await asyncio.gather(
            *(searx(q, p) for q, p in jobs),
            *(deps.europepmc.search_trials(q, page_size=settings.trial_search_page_size) for q in trial_queries),
            return_exceptions=True)
        per_query: dict[str, list[Candidate]] = {q: [] for q in queries}
        errors: list[str] = []
        for (q, page), res in zip(jobs, results[: len(jobs)], strict=True):
            if isinstance(res, BaseException):
                errors.append(f"search failed for '{q}' page {page}: {type(res).__name__}")
            else:
                per_query[q].extend(res)
        trial_hits = 0
        for q, res in zip(trial_queries, results[len(jobs):], strict=True):
            if isinstance(res, BaseException):
                errors.append(f"Europe PMC trial search failed for '{q}': {type(res).__name__}")
            else:  # its own list in the round-robin, after the SearXNG queries
                per_query[f"trials:{q}"] = list(res)
                trial_hits += len(res)
        # Round-robin by rank across queries: the candidate cut keeps each query's best hits instead of
        # favouring the first query or highly cited (older) papers.
        found: list[Candidate] = []
        for rank in range(max((len(v) for v in per_query.values()), default=0)):
            found.extend(v[rank] for v in per_query.values() if rank < len(v))
        progress_writer()({"type": "searching", "found": len(found), "queries": len(queries),
                             "failed": len(errors)})
        # Plan 20 Methods: records identified per source, before deduplication. A SearXNG hit merged from several
        # engines counts once for each, so the per-source counts can sum to more than `found`.
        per_source: Counter[str] = Counter()
        for q, hits in per_query.items():
            for c in hits:
                if q.startswith("trials:"):
                    per_source["europe pmc (rct search)"] += 1
                else:
                    per_source.update(set(c.engines) or {"unknown"})
        searched_at = datetime.now(UTC).isoformat(timespec="seconds")
        return {"candidates": [c.model_dump() for c in found], "errors": errors,
                "search_stats": {"found": len(found), "per_source": dict(per_source), "searched_at": searched_at},
                "quality": [{"stage": "search", "queries": len(queries), "failed": len(errors), "pages": pages,
                             "trial_queries": len(trial_queries), "trial_hits": trial_hits,
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
        # Europe PMC first so its curated metadata wins scalar fields; the order stays the search rank order
        # (rank_from), so the candidate cut below keeps the best-ranked hits (audit I-8).
        enriched = merge_candidates([*records, *merged], rank_from=len(records)) if records else merged
        enriched = [c for c in enriched if c.engines != ["europepmc"]]
        unique = len(enriched)
        year_excluded = 0
        if options.year_from:
            before = len(enriched)
            enriched = [c for c in enriched if c.year is None or c.year >= options.year_from]
            year_excluded = before - len(enriched)
        non_research = sum(1 for c in enriched if is_non_research(c))
        enriched = [c for c in enriched if not is_non_research(c)]
        snippet_only = sum(1 for c in enriched if c.abstract_source == "snippet" and not usable_abstract(c)
                           and len((c.abstract or "").strip()) >= MIN_ABSTRACT_CHARS)
        no_abstract = sum(1 for c in enriched if not usable_abstract(c))
        enriched = [c for c in enriched if usable_abstract(c)]
        kept = enriched[: options.candidate_limit]  # search rank order is kept
        progress_writer()({"type": "enriching", "candidates": len(kept)})
        return {"candidates": [c.model_dump() for c in kept], "errors": errors,
                "search_stats": {**(state.get("search_stats") or {}), "unique": unique,
                                 "with_abstract": len(enriched), "non_research": non_research,
                                 "year_excluded": year_excluded, "no_abstract": no_abstract},
                "quality": [{"stage": "enrich", "snippet_only": snippet_only,
                             "looked_up": len(lookup), "skipped_lookup": len(merged) - len(lookup),
                             "seconds": round(time.perf_counter() - started, 3)}]}

    return enrich
