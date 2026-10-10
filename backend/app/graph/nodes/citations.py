"""Citation metadata for the review's selected papers, in parallel with reading (abstract-only: reference lists and
counts, never full text). Any failure is soft: coverage becomes null where there is no data and the review carries on."""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.graph.progress import progress_writer
from app.harness.citations import NOTE_UNAVAILABLE, build_citations, empty_citations, paper_idents

log = logging.getLogger(__name__)
CONCURRENCY = 3


async def _gather(deps, idents: dict[str, dict[str, Any]], oa: dict[str, Any], epmc: dict[str, Any],
                  flags: dict[str, bool]) -> None:
    """Fills `oa`, `epmc` and `flags["errored"]` in place, so a timeout still leaves the partial data behind."""
    try:
        # PMIDs only for papers without a DOI: one lookup per paper.
        found = await deps.openalex.works_by_ids(
            [i["doi"] for i in idents.values() if i["doi"]],
            [i["pmid"] for i in idents.values() if i["pmid"] and not i["doi"]])
        for ref, i in idents.items():
            oa[ref] = (found.get(f"doi:{i['doi']}") if i["doi"] else None) or \
                      (found.get(f"pmid:{i['pmid']}") if i["pmid"] else None)
    except Exception as exc:  # noqa: BLE001 - OpenAlex can fail in any way; Europe PMC may still answer
        flags["errored"] = True
        log.warning("citations: OpenAlex lookup failed: %s", type(exc).__name__)
    gate = asyncio.Semaphore(CONCURRENCY)

    async def one(ref: str, i: dict[str, Any]) -> None:
        source, rid = ("MED", i["pmid"]) if i["pmid"] else ("PMC", i["pmcid"])
        if not rid:
            return
        try:
            async with gate:
                epmc[ref] = await deps.europepmc.references(source, rid, max_pages=1)
        except Exception as exc:  # noqa: BLE001
            flags["errored"] = True
            log.warning("citations: Europe PMC references failed for %s: %s", ref, type(exc).__name__)

    todo = [(r, i) for r, i in idents.items() if not (oa.get(r) and oa[r].referenced_works)]
    await asyncio.gather(*(one(r, i) for r, i in todo))


def make_fetch_citations(deps):
    async def fetch_citations(payload: dict[str, Any]) -> dict:
        idents = paper_idents(payload.get("papers") or [])
        oa: dict[str, Any] = {}
        epmc: dict[str, Any] = {}
        flags = {"errored": False}
        timed_out = False
        try:
            await asyncio.wait_for(_gather(deps, idents, oa, epmc, flags), deps.settings.citations_timeout_seconds)
        except TimeoutError:
            timed_out = True
            log.warning("citations: timed out after %ss; using partial data", deps.settings.citations_timeout_seconds)
        except Exception as exc:  # noqa: BLE001 - a citation failure never fails a review
            flags["errored"] = True
            log.warning("citations unavailable: %s: %s", type(exc).__name__, str(exc)[:200])
        try:
            result = build_citations(idents, oa, epmc)
        except Exception as exc:  # noqa: BLE001
            log.warning("citations: build failed: %s", type(exc).__name__)
            result = empty_citations(list(idents))
        if (flags["errored"] or timed_out) and not any(result["coverage"].values()):
            result["source_note"] = NOTE_UNAVAILABLE
        elif timed_out:
            result["source_note"] += "; partial: the lookup timed out"
        covered = sum(1 for v in result["coverage"].values() if v)
        progress_writer()({"type": "citations_fetched", "edges": len(result["edges"]), "covered": covered,
                           "total": len(idents)})
        return {"citations": result}

    return fetch_citations
