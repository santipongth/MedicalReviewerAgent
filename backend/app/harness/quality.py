"""Per-review quality telemetry: what the harness had to do, and how long each stage took.
Without an eval set this is the proxy for output quality (and the raw material for one later)."""
from __future__ import annotations

import time
from collections import defaultdict
from typing import Any

SINGLE_STAGES = ("refine", "plan", "search", "enrich", "normalize", "narrative", "localize_cards", "localize")


def _r(x: float | None) -> float | None:
    return None if x is None else round(x, 3)


def summarize_quality(entries: list[dict[str, Any]], started_at: float | None) -> dict[str, Any]:
    by_stage: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for e in entries:
        by_stage[e.get("stage", "?")].append(e)

    def seconds(stage: str) -> list[float]:
        return [e["seconds"] for e in by_stage.get(stage, []) if e.get("seconds") is not None]

    timings: dict[str, float | None] = {}
    for stage in SINGLE_STAGES:
        values = seconds(stage)
        timings[stage] = _r(max(values)) if values else None
    for stage in ("screen", "conflict"):  # parallel branches: the slowest one is the stage time
        values = seconds(stage)
        timings[stage] = _r(max(values)) if values else None
    reads = seconds("read")
    timings["read_max"] = _r(max(reads)) if reads else None
    timings["read_mean"] = _r(sum(reads) / len(reads)) if reads else None
    timings["total"] = _r(time.time() - started_at) if started_at else None

    read = by_stage.get("read", [])
    verified = sum(e.get("numbers_verified", 0) for e in read)
    total = sum(e.get("numbers_total", 0) for e in read)
    agreements = [e["agreement"] for e in read if e.get("agreement") is not None]
    screen = by_stage.get("screen", [])
    refine = (by_stage.get("refine") or [{}])[-1]
    return {
        "numbers_verified": verified,
        "numbers_total": total,
        "verification_rate": _r(verified / total) if total else None,
        "papers_uncertain": sum(1 for e in read if e.get("uncertain")),
        "agreement_mean": _r(sum(agreements) / len(agreements)) if agreements else None,
        "extraction_escalations": sum(1 for e in read if e.get("escalated")),
        "extraction_repairs": sum(1 for e in read if e.get("repaired")),
        "snippet_only_excluded": sum(e.get("snippet_only", 0) for e in by_stage.get("enrich", [])),
        "screen_borderline": sum(e.get("borderline", 0) for e in screen),
        "screen_disagreements": sum(e.get("disagreements", 0) for e in screen),
        "screen_escalations": sum(e.get("escalated", 0) for e in screen),
        "question_refined": bool(refine) and not refine.get("skipped") and not refine.get("fallback"),
        "question_critique_applied": bool(refine.get("critique_applied")),
        "outcome_normalization_fallback": any(e.get("fallback") for e in by_stage.get("normalize", [])),
        "normalization_corrections": sum(e.get("corrections", 0) for e in by_stage.get("normalize", [])),
        "conflict_fallbacks": sum(1 for e in by_stage.get("conflict", []) if e.get("fallback")),
        "citation_fixes": sum(e.get("citation_fixes", 0) for e in by_stage.get("narrative", [])),
        "localization_kept_english": sum(e.get("kept_english", 0) for stage in ("localize", "localize_cards")
                                         for e in by_stage.get(stage, [])),
        "timings": timings,
    }
