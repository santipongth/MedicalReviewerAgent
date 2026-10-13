from __future__ import annotations

import asyncio
import re
import time
from collections import Counter
from datetime import UTC, datetime

from app.graph.progress import progress_writer
from app.graph.schemas import Candidate
from app.graph.state import ReviewState
from app.harness.trials import trial_acronyms, trial_key
from app.logging import get_logger
from app.schemas.review import ReviewOptions
from app.services.dedupe import PaperIndex, merge_candidates

log = get_logger(__name__)

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


# ---- trial-name harvest (Plan 20 Task 10, meta-analysis recall) ----------------------------------------------
# The planner is asked for a trial-name query but often writes none (the SGLT2 re-run had five keyword queries), and
# the landmark trials then depend on keyword ranking. Their acronyms are, however, all over the first-round hits:
# reviews, sub-studies and commentaries name them ("the EMPEROR-Reduced trial", "DAPA-HF ClinicalTrials.gov number").
# An acronym counts only in a trial context (app.harness.trials) and when at least TRIAL_NAME_MIN_DOCS hits name it.
TRIAL_NAME_MIN_DOCS = 2
TRIAL_NAME_LIMIT = 12
TRIAL_NAME_FRONT = 10  # the name search's best hits that lead the candidate list


def harvest_trial_names(cands: list[Candidate], *, min_docs: int = TRIAL_NAME_MIN_DOCS,
                        limit: int = TRIAL_NAME_LIMIT) -> list[str]:
    """Trial acronyms named in a trial context by at least `min_docs` hits, most named first (ties: first seen),
    spelled as most often written."""
    docs: Counter[str] = Counter()
    spellings: dict[str, Counter[str]] = {}
    for c in cands:
        keys: dict[str, None] = {}  # in text order, so ties rank deterministically
        for name in trial_acronyms(c.title, c.abstract):
            keys[trial_key(name)] = None
            spellings.setdefault(trial_key(name), Counter())[name] += 1
        docs.update(list(keys))
    ranked = [k for k, n in docs.most_common() if n >= min_docs]
    return [spellings[k].most_common(1)[0][0] for k in ranked[:limit]]


def intervention_terms(question: dict | None, limit: int = 10) -> list[str]:
    """Phrases naming the review's intervention for a Europe PMC query: the key terms (with their MeSH heading and
    synonyms) that share a word with intervention_or_exposure, else its own comma/bracket-separated parts of at most
    four words. Empty without a refined question."""
    q = question or {}

    def words_of(text: str) -> set[str]:  # topic words: generic ones ("inhibitors", "therapy") never link a term
        return {w.removesuffix("s") for w in re.findall(r"[a-z0-9]+", text.lower()) if len(w) >= 4} - _FOCUS_STOP

    own = words_of(q.get("intervention_or_exposure") or "")
    if not own:
        return []
    out: list[str] = []
    for term in q.get("key_terms") or []:
        names = [term.get("term") or "", term.get("mesh") or "", *(term.get("synonyms") or [])]
        words = set().union(*(words_of(n) for n in names))
        if words & own:
            out += [n for n in names if n.strip()]
    if not out:
        parts = re.split(r"[,;()]|\be\.g\.|\bor\b", q.get("intervention_or_exposure") or "")
        out = [p.strip() for p in parts if p.strip() and len(p.split()) <= 4]
    return list(dict.fromkeys(out))[:limit]


# ---- topic focus of the candidate cut (Plan 20 Task 10) --------------------------------------------------------
def _norm(text: str) -> str:
    words = re.findall(r"[a-z0-9]+", (text or "").lower())
    return " " + " ".join(w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w
                          for w in words) + " "


def focus_terms(question: dict | None) -> list[str]:
    """Every key term, MeSH heading and synonym of the refined question, normalised (lower case, singular)."""
    out: list[str] = []
    for term in (question or {}).get("key_terms") or []:
        for name in [term.get("term") or "", term.get("mesh") or "", *(term.get("synonyms") or [])]:
            n = _norm(name).strip()
            if len(n) >= 3:
                out.append(n)
    return list(dict.fromkeys(out))


# Words of the key terms that say nothing about the topic on their own.
_FOCUS_STOP = frozenset({"with", "without", "from", "type", "due", "the", "and", "for", "patient", "people", "adult",
                         "disease", "risk", "study", "effect", "outcome", "use", "therapy", "treatment", "inhibitor",
                         "care", "non", "dependent", "based", "related", "level", "factor", "health", "clinical",
                         "agonist", "antagonist", "agent", "drug", "medication", "standard", "blocker", "receptor",
                         "usual", "placebo", "control"})
MIN_FOCUS_WORDS = 2


def _stem(word: str) -> str:
    return word[:6] if len(word) >= 6 else word


def on_focus(c: Candidate, terms: list[str]) -> bool:
    """Whether the title or abstract names a key term: as a phrase (for a term with a digit also with its spaces and
    hyphens removed: "SGLT-2" = "SGLT2"), or by at least MIN_FOCUS_WORDS distinct topic words of the key terms in
    any order ("beliefs about insulin ... a qualitative study" names "insulin" and "qualitative"). Lenient on
    purpose: it only reorders the candidate cut, so a paper the screener should see must not fall behind."""
    letters = [ch for ch in c.title if ch.isalpha()]
    if letters and sum(ch.isascii() for ch in letters) * 2 < len(letters):
        return True  # a title in another script (Cyrillic, Thai, ...): English key terms cannot judge it
    text = _norm(f"{c.title} {c.abstract or ''}")
    squashed = text.replace(" ", "")
    if any(f" {t} " in text or (any(ch.isdigit() for ch in t) and t.replace(" ", "") in squashed) for t in terms):
        return True
    topic = {_stem(w) for t in terms for w in t.split() if len(w) >= 4 and w not in _FOCUS_STOP}
    found = {_stem(w) for w in text.split()} & topic
    return len(found) >= MIN_FOCUS_WORDS


# ---- ThaiJO (Plan 24) ------------------------------------------------------------------------------------------
THAIJO_SHARE = 8  # ThaiJO may fill at most 1/8 of the candidate pool


def thaijo_cap(settings, options: ReviewOptions) -> int:
    """The most ThaiJO candidates one review takes: thaijo_max_candidates, and at most 1/8 of candidate_limit, so Thai
    studies add to the international evidence and never displace it (120 -> 15, 60 -> 7, 20 -> 2)."""
    return max(0, min(settings.thaijo_max_candidates, options.candidate_limit // THAIJO_SHARE))


async def thaijo_search(deps, queries: list[str], options: ReviewOptions) -> tuple[list[Candidate], dict]:
    """ThaiJO candidates for the planner's queries and the search entry's `thaijo` block. Never raises (cancellation
    aside): a failure or a timeout leaves what arrived, and the block says what went wrong."""
    started = time.perf_counter()
    cap = thaijo_cap(deps.settings, options)
    out: list[Candidate] = []
    stats: dict = {}
    try:
        await asyncio.wait_for(deps.thaijo.collect(queries, limit=cap, out=out, stats=stats),
                               deps.settings.thaijo_timeout_seconds)
    except TimeoutError:
        stats["timed_out"] = True
    except Exception as exc:  # noqa: BLE001 - an optional source: the review goes on without it
        stats["failed"] = type(exc).__name__
    return out, {**stats, "cap": cap, "kept": len(out), "seconds": round(time.perf_counter() - started, 3)}


def thaijo_errors(entry: dict, timeout: float) -> list[str]:
    """`errors` lines for a ThaiJO search that failed, timed out or lost requests (none when it went well)."""
    out = []
    if entry.get("failed"):
        out.append(f"ThaiJO search failed: {entry['failed']}")
    if entry.get("timed_out"):
        out.append(f"ThaiJO search timed out after {timeout:g} s; kept {entry['kept']} candidate(s)")
    lost = [f"{entry[k]} {name}" for k, name in (("search_failed", "search(es)"),
                                                 ("detail_failed", "abstract lookup(s)")) if entry.get(k)]
    if lost:
        out.append(f"ThaiJO: {' and '.join(lost)} failed")
    return out


def make_search(deps):
    async def search(state: ReviewState) -> dict:
        started = time.perf_counter()
        options = ReviewOptions.clamped(state.get("options"))
        settings = deps.settings
        queries = (state.get("plan") or {}).get("queries") or [state.get("english_topic") or state["topic"]]
        pages = search_pages(settings, options)
        jobs = [(q, page) for q in queries for page in range(1, pages + 1)]
        trial_queries = (trial_search_queries(queries, settings.trial_search_queries)
                         if wants_trial_search(options) and getattr(deps, "europepmc", None) is not None else [])
        gate = asyncio.Semaphore(SEARXNG_CONCURRENCY)

        async def searx(q: str, page: int) -> list[Candidate]:
            async with gate:
                return await deps.searxng.search(q, pageno=page)

        # Plan 24: ThaiJO runs alongside SearXNG (its own timeout is shorter), only when enabled
        thaijo = (asyncio.ensure_future(thaijo_search(deps, queries, options))
                  if getattr(deps, "thaijo", None) is not None else None)
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
        trial_hits = trial_failed = 0
        for q, res in zip(trial_queries, results[len(jobs):], strict=True):
            if isinstance(res, BaseException):
                trial_failed += 1
                errors.append(f"Europe PMC trial search failed for '{q}': {type(res).__name__}")
            else:  # its own list in the round-robin, after the SearXNG queries
                per_query[f"trials:{q}"] = list(res)
                trial_hits += len(res)
        thaijo_entry: dict | None = None
        if thaijo is not None:  # its own list in the round-robin too, after the trial searches
            thaijo_hits, thaijo_entry = await thaijo
            per_query["thaijo:"] = thaijo_hits
            if failures := thaijo_errors(thaijo_entry, deps.settings.thaijo_timeout_seconds):
                errors.extend(failures)
                log.warning("thaijo_search_degraded", failed=thaijo_entry.get("failed"),
                            timed_out=bool(thaijo_entry.get("timed_out")), kept=thaijo_entry["kept"],
                            search_failed=thaijo_entry.get("search_failed", 0),
                            detail_failed=thaijo_entry.get("detail_failed", 0))
        # Plan 20 Task 10: one more Europe PMC RCT search for the trial acronyms the first round names, scoped to the
        # review's intervention; its best hits lead the candidate list (they are the landmark trials of the question).
        names: list[str] = []
        name_hits: list[Candidate] = []
        if trial_queries and hasattr(deps.europepmc, "search_trial_names"):
            names = harvest_trial_names([c for hits in per_query.values() for c in hits])
            terms = intervention_terms(state.get("question"))
            if names and terms:
                try:
                    name_hits = list(await deps.europepmc.search_trial_names(
                        names, terms, page_size=settings.trial_search_page_size))
                except Exception as exc:  # noqa: BLE001 - a recall extra; the search hits stand
                    trial_failed += 1
                    errors.append(f"Europe PMC trial-name search failed: {type(exc).__name__}")
        per_query["trials:names"] = name_hits[TRIAL_NAME_FRONT:]
        # Round-robin by rank across queries: the candidate cut keeps each query's best hits instead of
        # favouring the first query or highly cited (older) papers.
        found: list[Candidate] = list(name_hits[:TRIAL_NAME_FRONT])
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
        if name_hits[:TRIAL_NAME_FRONT]:
            per_source["europe pmc (rct search)"] += len(name_hits[:TRIAL_NAME_FRONT])
        searched_at = datetime.now(UTC).isoformat(timespec="seconds")
        entry = {"stage": "search", "queries": len(queries), "failed": len(errors), "pages": pages,
                 "trial_queries": len(trial_queries), "trial_hits": trial_hits,
                 "seconds": round(time.perf_counter() - started, 3)}
        if trial_queries:  # Plan 20 Task 10: Europe PMC failures after the retries, and the trial-name search
            entry |= {"trial_failed": trial_failed, "trial_names": names, "trial_name_hits": len(name_hits)}
        if thaijo_entry is not None:  # Plan 24
            entry["thaijo"] = thaijo_entry
        return {"candidates": [c.model_dump() for c in found], "errors": errors,
                "search_stats": {"found": len(found), "per_source": dict(per_source), "searched_at": searched_at},
                "quality": [entry]}

    return search


def search_pages(settings, options: ReviewOptions) -> int:
    """SearXNG result pages the search node reads per planner query."""
    return max(1, settings.searxng_pages_meta if options.review_type == "meta_analysis" else settings.searxng_pages)


def topup_pages(settings, options: ReviewOptions) -> list[int]:
    """The further pages enrich may read once when the pool is short (Plan 21): up to searxng_pages_max; a
    meta-analysis, which already reads searxng_pages_meta pages, reads at least one more."""
    first = search_pages(settings, options)
    last = settings.searxng_pages_max
    if options.review_type == "meta_analysis":
        last = max(first + 1, last)
    return list(range(first + 1, last + 1))


def _filter_pool(cands: list[Candidate], options: ReviewOptions, terms: list[str],
                 year_to: int | None = None) -> tuple[list[Candidate], dict]:
    """Year, non-research, abstract and focus filters, in that order; the search rank order is kept. `year_to` is set
    only by the Plan 22a eval (a Cochrane review's search year); unknown years are kept, as for `year_from`."""
    year_excluded = 0
    if options.year_from:
        before = len(cands)
        cands = [c for c in cands if c.year is None or c.year >= options.year_from]
        year_excluded = before - len(cands)
    after_cutoff = 0
    if year_to is not None:
        before = len(cands)
        cands = [c for c in cands if c.year is None or c.year <= year_to]
        after_cutoff = before - len(cands)
    non_research = sum(1 for c in cands if is_non_research(c))
    cands = [c for c in cands if not is_non_research(c)]
    snippet_only = sum(1 for c in cands if c.abstract_source == "snippet" and not usable_abstract(c)
                       and len((c.abstract or "").strip()) >= MIN_ABSTRACT_CHARS)
    no_abstract = sum(1 for c in cands if not usable_abstract(c))
    cands = [c for c in cands if usable_abstract(c)]
    # Plan 20 Task 10: hits that name none of the question's key terms (an arXiv paper on call admission control
    # for "HF admission", a veterinary trial) move behind the on-topic ones, so they no longer take slots of the
    # candidate cut; their order is kept and nothing is dropped. Skipped without a refined question.
    off_focus = 0
    if terms:
        focused = [c for c in cands if on_focus(c, terms)]
        off_focus = len(cands) - len(focused)
        cands = focused + [c for c in cands if not on_focus(c, terms)]
    return cands, {"year_excluded": year_excluded, "after_cutoff": after_cutoff, "non_research": non_research,
                   "snippet_only": snippet_only, "no_abstract": no_abstract, "off_focus": off_focus}


async def _lookup(deps, lookup: list[Candidate], errors: list[str], failures: list[str],
                  label: str = "") -> list[Candidate]:
    """Europe PMC metadata for the hits that lack it; each batch is retried with backoff and a batch that still fails
    is skipped (Plan 20 Task 10). Failures are soft: the search hits stand."""
    dois = [c.doi for c in lookup if c.doi]
    pmids = [c.pmid for c in lookup if c.pmid]
    if not (dois or pmids):
        return []
    batch_failures: list[str] = []
    try:
        records = await deps.europepmc.lookup(dois=dois, pmids=pmids, failures=batch_failures)
    except Exception as exc:  # noqa: BLE001 - enrichment is optional; keep search hits
        failures.append(type(exc).__name__)
        errors.append(f"Europe PMC enrichment{label} failed: {type(exc).__name__}")
        return []
    if batch_failures:
        failures.extend(batch_failures)
        errors.append(f"Europe PMC enrichment{label} failed for {len(batch_failures)} batch(es): "
                      f"{', '.join(sorted(set(batch_failures)))}")
    return list(records)


def _with_records(records: list[Candidate], cands: list[Candidate]) -> list[Candidate]:
    # Europe PMC first so its curated metadata wins scalar fields; the order stays the search rank order
    # (rank_from), so the candidate cut keeps the best-ranked hits (audit I-8). Lookup-only records are dropped.
    out = merge_candidates([*records, *cands], rank_from=len(records)) if records else cands
    return [c for c in out if c.engines != ["europepmc"]]


async def _topup_search(deps, queries: list[str], pages: list[int], errors: list[str]) -> list[Candidate]:
    """The next pages of every planner query, under the same SearXNG gate as the search node; hits come out
    round-robin by rank across queries, page by page. A failed page is an error, never fatal."""
    gate = asyncio.Semaphore(SEARXNG_CONCURRENCY)
    jobs = [(q, p) for p in pages for q in queries]

    async def searx(q: str, page: int) -> list[Candidate]:
        async with gate:
            return await deps.searxng.search(q, pageno=page)

    results = await asyncio.gather(*(searx(q, p) for q, p in jobs), return_exceptions=True)
    hits: list[Candidate] = []
    for page in pages:
        lists: list[list[Candidate]] = []
        for (q, p), res in zip(jobs, results, strict=True):
            if p != page:
                continue
            if isinstance(res, BaseException):
                errors.append(f"search failed for '{q}' page {p}: {type(res).__name__}")
            else:
                lists.append(list(res))
        for rank in range(max((len(v) for v in lists), default=0)):
            hits.extend(v[rank] for v in lists if rank < len(v))
    return hits


def make_enrich(deps):
    async def enrich(state: ReviewState) -> dict:
        started = time.perf_counter()
        options = ReviewOptions.clamped(state.get("options"))
        merged = merge_candidates(Candidate.model_validate(c) for c in state.get("candidates") or [])
        errors: list[str] = []
        failures: list[str] = []
        # Hits that already carry the Europe PMC engine's full abstract and a PMCID have nothing left to gain from
        # the lookup (its pub types come with the hit); everything else is looked up and Europe PMC metadata wins.
        lookup = [c for c in merged if not already_enriched(c)]
        enriched = _with_records(await _lookup(deps, lookup, errors, failures), merged)
        terms = focus_terms(state.get("question"))
        year_to = state.get("eval_year_to")
        pool, counts = _filter_pool(enriched, options, terms, year_to)
        search_stats = dict(state.get("search_stats") or {})
        topup: dict[str, int] = {"topup_pages": 0, "topup_found": 0}
        looked_up, skipped = len(lookup), len(merged) - len(lookup)
        # Plan 21: a short pool is topped up once from the next SearXNG pages of the planner's queries; the new hits
        # are merged behind the first-round ones, looked up, and the whole pool is filtered again.
        pages = topup_pages(deps.settings, options)
        topic = state.get("english_topic") or state.get("topic")
        queries = (state.get("plan") or {}).get("queries") or ([topic] if topic else [])
        if len(pool) < options.candidate_limit and pages and queries and getattr(deps, "searxng", None) is not None:
            hits = await _topup_search(deps, queries, pages, errors)
            known = PaperIndex([*merged, *enriched])  # shared ids or a near-identical title, as merge_candidates
            new = [c for c in merge_candidates(hits) if c not in known]
            lookup_new = [c for c in new if not already_enriched(c)]
            records = await _lookup(deps, lookup_new, errors, failures, " (top-up)")
            enriched = _with_records(records, merge_candidates([*enriched, *new]))
            pool, counts = _filter_pool(enriched, options, terms, year_to)
            looked_up, skipped = looked_up + len(lookup_new), skipped + len(new) - len(lookup_new)
            topup = {"topup_pages": len(pages), "topup_found": len(hits), "topup_new": len(new)}
            # PRISMA "identified": the top-up hits are identified records too (per source, before deduplication)
            per_source = Counter(search_stats.get("per_source") or {})
            for c in hits:
                per_source.update(set(c.engines) or {"unknown"})
            search_stats |= {"found": search_stats.get("found", 0) + len(hits), "per_source": dict(per_source)}
        kept = pool[: options.candidate_limit]  # search rank order is kept
        progress_writer()({"type": "enriching", "candidates": len(kept)})
        entry = {"stage": "enrich", "snippet_only": counts["snippet_only"], "looked_up": looked_up,
                 "skipped_lookup": skipped, "off_focus": counts["off_focus"], **topup,
                 "seconds": round(time.perf_counter() - started, 3)}
        if failures:
            entry["europepmc_failed"] = len(failures)
        return {"candidates": [c.model_dump() for c in kept], "errors": errors,
                "search_stats": {**search_stats, "unique": len(enriched),
                                 "with_abstract": len(pool), "non_research": counts["non_research"],
                                 "year_excluded": counts["year_excluded"], "after_cutoff": counts["after_cutoff"],
                                 "no_abstract": counts["no_abstract"]},
                "quality": [entry]}

    return enrich
