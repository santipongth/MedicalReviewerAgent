"""Plan 22a: the Cochrane review under test (and every other version of it) must never be in its own candidate pool."""
from __future__ import annotations

from typing import Any

from app.evals.select import cochrane_id
from app.services.text import normalize_title


def drop_target(candidates: list[dict[str, Any]], review_id: str, pmid: str,
                title: str = "") -> tuple[list[dict[str, Any]], int]:
    """Remove every candidate that is a version of the target review (same Cochrane id) or has the target's PMID, or
    (Plan 31) has no DOI and no PMID and carries the target's title."""
    wanted = normalize_title(title)
    kept = [c for c in candidates
            if not ((review_id and cochrane_id(c.get("doi") or "") == review_id.upper())
                    or (pmid and str(c.get("pmid") or "") == pmid)
                    or (wanted and not c.get("doi") and not c.get("pmid")
                        and normalize_title(c.get("title")) == wanted))]
    return kept, len(candidates) - len(kept)
