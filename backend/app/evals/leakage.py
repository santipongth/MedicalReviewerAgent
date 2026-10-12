"""Plan 22a: the Cochrane review under test (and every other version of it) must never be in its own candidate pool."""
from __future__ import annotations

from typing import Any

from app.evals.select import cochrane_id


def drop_target(candidates: list[dict[str, Any]], review_id: str, pmid: str) -> tuple[list[dict[str, Any]], int]:
    """Remove every candidate that is a version of the target review (same Cochrane id) or has the target's PMID."""
    kept = [c for c in candidates
            if not ((review_id and cochrane_id(c.get("doi") or "") == review_id.upper())
                    or (pmid and str(c.get("pmid") or "") == pmid))]
    return kept, len(candidates) - len(kept)
