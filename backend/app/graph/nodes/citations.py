"""Citation metadata for the review's selected papers, in parallel with reading (abstract-only: reference lists and
counts, never full text). Any failure is soft: coverage becomes null for every paper and the review carries on."""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.graph.progress import progress_writer
from app.harness.citations import NOTE_UNAVAILABLE, build_citations, empty_citations, paper_idents

log = logging.getLogger(__name__)
CONCURRENCY = 3


async def _gather(deps, idents: dict[str, dict[str, str | None]]):
    oa: dict[str, Any] = {}
    oa_failed = False
    try:
        found = await deps.openalex.works_by_ids(
            [i["doi"] for i in idents.values() if i["doi"]], [i["pmid"] for i in idents.values() if i["pmid"]])
        for ref, i in idents.items():
            oa[ref] = (found.get(f"doi:{i['doi']}") if i["doi"] else None) or \
                      (found.get(f"pmid:{i['pmid']}") if i["pmid"] else None)
    except Exception as exc:  # noqa: BLE001 - OpenAlex can fail in any way; Europe PMC may still answer
        oa_failed = True
        log.warning("citations: OpenAlex lookup failed: %s", type(exc).__name__)
    failures = 0
    epmc: dict[str, Any] = {}
    gate = asyncio.Semaphore(CONCURRENCY)

    async def one(ref: str, i: dict[str, str | None]) -> None:
        nonlocal failures
        source, rid = ("MED", i["pmid"]) if i["pmid"] else ("PMC", i["pmcid"])
        if not rid:
            return
        try:
            async with gate:
                epmc[ref] = await deps.europepmc.references(source, rid)
        except Exception as exc:  # noqa: BLE001
            failures += 1
            log.warning("citations: Europe PMC references failed for %s: %s", ref, type(exc).__name__)

    todo = [(r, i) for r, i in idents.items() if not (oa.get(r) and oa[r].referenced_works)]
    await asyncio.gather(*(one(r, i) for r, i in todo))
    return oa, epmc, oa_failed or failures > 0


def make_fetch_citations(deps):
    async def fetch_citations(payload: dict[str, Any]) -> dict:
        idents = paper_idents(payload.get("papers") or [])
        result = empty_citations(list(idents))
        try:
            oa, epmc, errored = await asyncio.wait_for(_gather(deps, idents), deps.settings.citations_timeout_seconds)
            result = build_citations(idents, oa, epmc)
            if errored and not any(result["coverage"].values()):
                result["source_note"] = NOTE_UNAVAILABLE
        except Exception as exc:  # noqa: BLE001 - includes TimeoutError; a citation failure never fails a review
            log.warning("citations unavailable: %s: %s", type(exc).__name__, str(exc)[:200])
            result["source_note"] = NOTE_UNAVAILABLE
        covered = sum(1 for v in result["coverage"].values() if v)
        progress_writer()({"type": "citations_fetched", "edges": len(result["edges"]), "covered": covered,
                           "total": len(idents)})
        return {"citations": result}

    return fetch_citations
