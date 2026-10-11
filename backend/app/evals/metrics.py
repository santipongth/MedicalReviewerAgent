"""Plan 22a metrics from run files. Pure: no network, no LLM. Failed runs stay in every denominator."""
from __future__ import annotations

import math
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass, field

from app.evals.models import RunRecord
from app.graph.nodes.synthesis import _synthesis_strings
from app.harness.glossary_check import check_pair, default_terms
from app.harness.localize import MIN_THAI_SHARE, thai_share


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return (max(0.0, centre - half), min(1.0, centre + half))


@dataclass
class ReviewMetrics:
    id: str
    stratum: str
    repeat: int
    status: str
    error: str = ""
    cost_usd: float = 0.0
    elapsed_s: float = 0.0
    numbers_verified: int = 0
    numbers_total: int = 0
    citations_proposed: int = 0
    citations_stripped: int = 0
    thai_share_mean: float | None = None
    thai_share_min: float | None = None
    untranslated: int = 0
    numbers_rejected: int = 0
    citations_rejected: int = 0
    glossary: list[tuple[str, bool]] = field(default_factory=list)
    answer_present: bool = False
    papers_analysed: int = 0
    primary_direction: str = "none"


def review_metrics(rec: RunRecord, stratum: str) -> ReviewMetrics:
    m = ReviewMetrics(id=rec.id, stratum=stratum, repeat=rec.repeat, status=rec.status, error=rec.error,
                      cost_usd=rec.cost_usd, elapsed_s=rec.elapsed_s,
                      citations_proposed=rec.citations.get("proposed", 0),
                      citations_stripped=rec.citations.get("stripped", 0))
    pm = rec.primary_match
    if pm is not None and pm.row_index is not None:
        m.primary_direction = f"{pm.verdict}:{pm.direction or '-'}"
    result = rec.result or {}
    if rec.status != "done" or not result:
        return m
    q = result.get("quality") or {}
    loc = q.get("localize") or {}
    m.numbers_verified, m.numbers_total = int(q.get("numbers_verified", 0)), int(q.get("numbers_total", 0))
    m.untranslated = int(loc.get("untranslated", 0))
    m.numbers_rejected = int(loc.get("numbers_rejected", 0))
    m.citations_rejected = int(loc.get("citations_rejected", 0))
    en = _synthesis_strings(result.get("synthesis_en") or {})
    th = _synthesis_strings(result.get("synthesis") or {})
    shares = [thai_share(th[k], en[k]) for k in en if k in th and en[k].strip()]
    if shares:
        m.thai_share_mean, m.thai_share_min = statistics.fmean(shares), min(shares)
    terms = default_terms()
    m.glossary = [hit for k in en if k in th for hit in check_pair(en[k], th[k], terms)]
    m.answer_present = bool(((result.get("synthesis_en") or {}).get("answer") or "").strip())
    m.papers_analysed = len(result.get("papers") or [])
    return m


def _rate(k: int, n: int) -> tuple[float, float, float]:
    lo, hi = wilson(k, n)
    return (k / n if n else 0.0, lo, hi)


def aggregate(rows: list[ReviewMetrics]) -> dict:
    done = [r for r in rows if r.status == "done"]
    costs = [r.cost_usd for r in rows]
    glossary = [ok for r in done for _, ok in r.glossary]
    misses = Counter(term for r in done for term, ok in r.glossary if not ok)
    shares = [r.thai_share_min for r in done if r.thai_share_min is not None]
    means = [r.thai_share_mean for r in done if r.thai_share_mean is not None]
    by_id: dict[str, dict[int, str]] = defaultdict(dict)
    for r in rows:
        by_id[r.id][r.repeat] = r.primary_direction
    pairs = [(d[1], d[2]) for d in by_id.values() if 1 in d and 2 in d]
    verified, total = sum(r.numbers_verified for r in done), sum(r.numbers_total for r in done)
    proposed, stripped = sum(r.citations_proposed for r in rows), sum(r.citations_stripped for r in rows)
    return {
        "n_runs": len(rows), "n_failed": len(rows) - len(done),
        "failures": [(r.id, r.repeat, r.status, r.error) for r in rows if r.status != "done"],
        "verification_rate": verified / total if total else None,
        "citation_strip_rate": stripped / proposed if proposed else None,
        "thai_share_mean": statistics.fmean(means) if means else None,
        "thai_share_min": min(shares) if shares else None,
        "below_min_share": _rate(sum(1 for s in shares if s < MIN_THAI_SHARE), len(rows)),
        "numbers_rejected": sum(r.numbers_rejected for r in done),
        "citations_rejected": sum(r.citations_rejected for r in done),
        "glossary_consistency": _rate(sum(glossary), len(glossary)),
        "glossary_top_misses": misses.most_common(10),
        "answer_rate": _rate(sum(1 for r in done if r.answer_present), len(rows)),
        "cost_mean": statistics.fmean(costs) if costs else 0.0,
        "cost_median": statistics.median(costs) if costs else 0.0,
        "cost_max": max(costs) if costs else 0.0, "cost_total": sum(costs),
        "elapsed_mean": statistics.fmean([r.elapsed_s for r in done]) if done else 0.0,
        "stability": _rate(sum(1 for a, b in pairs if a == b), len(pairs)), "stability_pairs": len(pairs),
    }
