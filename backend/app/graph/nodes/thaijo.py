"""OAI-PMH bibliographic metadata for the selected ThaiJO papers (Plan 24), in parallel with reading: volume, issue,
pages, ISSN, licence and article type, for the papers actually read (at most max_papers), never the whole pool.
Metadata only, never text for a prompt. Any failure is soft: the paper keeps its search metadata."""
from __future__ import annotations

import asyncio
import time
from typing import Any

from app.logging import get_logger

log = get_logger(__name__)
CONCURRENCY = 2  # OAI-PMH requests in flight per review (the journal servers are small)


def thaijo_papers(selected: list[dict[str, Any]]) -> list[dict[str, str]]:
    """`{ref, thaijo_url}` of the selected papers that came from ThaiJO."""
    return [{"ref": s["ref"], "thaijo_url": url} for s in selected
            if (url := (s.get("candidate") or {}).get("thaijo_url"))]


def make_thaijo_metadata(deps):
    async def thaijo_metadata(payload: dict[str, Any]) -> dict:
        started = time.perf_counter()
        papers = payload.get("papers") or []
        found: dict[str, dict[str, Any]] = {}
        stats: dict[str, Any] = {"asked": len(papers), "failed": 0}
        gate = asyncio.Semaphore(CONCURRENCY)

        async def one(paper: dict[str, str]) -> None:
            try:
                async with gate:
                    bib = await deps.thaijo.record(paper["thaijo_url"])
            except Exception as exc:  # noqa: BLE001 - metadata only; the paper keeps its search metadata
                stats["failed"] += 1
                log.warning("thaijo_oai_failed", ref=paper["ref"], error=type(exc).__name__)
                return
            if bib:
                found[paper["ref"]] = bib

        try:
            await asyncio.wait_for(asyncio.gather(*(one(p) for p in papers)), deps.settings.thaijo_timeout_seconds)
        except TimeoutError:
            stats["timed_out"] = True
            log.warning("thaijo_oai_timed_out", asked=len(papers), found=len(found))
        return {"thaijo_bib": found,
                "quality": [{"stage": "thaijo_metadata", **stats, "found": len(found),
                             "seconds": round(time.perf_counter() - started, 3)}]}

    return thaijo_metadata
