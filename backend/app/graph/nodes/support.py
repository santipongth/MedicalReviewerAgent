"""Plan 25: the sentence-support check. It runs after write_synthesis, beside localize, on the English synthesis:
claims and candidate sentences in code (app.harness.support), then one judge call for the whole review on the
screener's model bound to SupportBatch, through the harness runner (validate → repair → escalate).

Soft: a judge that fails, answers garbage or is skipped for the budget leaves the labels null (unknown); a crash of
the check leaves `support` null. Neither ever fails the review or removes a citation."""
from __future__ import annotations

import logging
import time
from collections import Counter

from app.graph import prompts
from app.graph.nodes.intake import harness_runner
from app.graph.nodes.synthesis import (
    _narrative_papers,
    _prose_context,
    _review_type,
    design_excluded,
    related,
    unique_papers,
)
from app.graph.schemas import SupportBatch
from app.graph.state import ReviewState
from app.harness import support as sp
from app.harness.meta import pooled_number_strings
from app.services.budget import current_budget
from app.services.llm import LLMError

log = logging.getLogger(__name__)

JUDGE_ROLE = "screener"
MIN_BUDGET_USD = 0.01  # the judge is skipped when less than this is left of the review's cost cap


def budget_left() -> float | None:
    budget = current_budget()
    return None if budget is None else budget.cap_usd - budget.spent


async def _judge(deps, pairs: list[sp.Pair]) -> tuple[dict[str, tuple[str, int | None]], str, float]:
    """(verdicts, judge status, cost). Status: ok | incomplete | failed | skipped_budget | none."""
    if not pairs:
        return {}, "none", 0.0
    left = budget_left()
    if left is not None and left < MIN_BUDGET_USD:
        return {}, "skipped_budget", 0.0
    try:
        llm = deps.llms.with_schema(JUDGE_ROLE, SupportBatch)
        res = await harness_runner(deps).call(
            llm, prompts.SUPPORT_SYSTEM, prompts.support_user(items=sp.judge_items(pairs)), schema=SupportBatch,
            validate=lambda v: sp.verdict_problems(v, pairs), trigger="repair_failed")
    except LLMError as exc:
        log.warning("sentence-support judge failed: %s", exc)
        return {}, "failed", 0.0
    found = sp.verdicts(res.value, pairs)
    status = "ok" if res.ok and len(found) == len(pairs) else "incomplete" if found else "failed"
    return found, status, res.cost


def make_check_support(deps):
    async def check_support(state: ReviewState) -> dict:
        started = time.perf_counter()
        try:
            synthesis = state.get("synthesis") or {}
            summary = synthesis.get("executive_summary") or ""
            claims = sp.summary_claims(summary) + sp.finding_claims(synthesis.get("key_findings"))
            meta = state.get("meta_analysis") if _review_type(state) == "meta_analysis" else None
            prose = _prose_context(state, _narrative_papers(state), state.get("matrix") or {}, meta)
            pooled = sp.pooled_keys(pooled_number_strings(meta))
            checks = {c.id: sp.claim_checks(c, prose, pooled) for c in claims}
            not_evidence = set(design_excluded(state)) | set(related(state))
            abstracts = {p["ref"]: (p.get("candidate") or {}).get("abstract") for p in unique_papers(state)}
            computed = {c.id for c in claims if checks[c.id][1]}
            pairs = sp.build_pairs(claims, abstracts, not_evidence | computed)
            judged, over = pairs[: sp.MAX_PAIRS], pairs[sp.MAX_PAIRS:]
            found, status, cost = await _judge(deps, judged)
        except Exception as exc:  # the check is optional: the review goes on without it
            log.exception("sentence-support check failed")
            return {"support": None, "errors": [f"sentence-support check failed: {type(exc).__name__}"],
                    "quality": [{"stage": "support", "judge": "crashed",
                                 "seconds": round(time.perf_counter() - started, 3)}]}
        by_pair = {(p.claim.id, p.ref): p for p in pairs}
        records = []
        for c in claims:
            numbers_checked, is_computed = checks[c.id]
            cites = []
            for ref in c.refs:
                pair = by_pair.get((c.id, ref))
                cites.append(sp.citation(pair, ref, found.get(pair.id) if pair else None,
                                         numbers_checked=numbers_checked, computed=is_computed,
                                         not_evidence=ref in not_evidence))
            records.append(sp.claim_record(c, cites, numbers_checked=numbers_checked, computed=is_computed))
        labels = Counter(label for label, _ in found.values())
        entry = {"stage": "support", "judge": status, "claims": len(claims), "pairs": len(pairs),
                 "judged": len(found), "over_cap": len(over), "computed": len(computed),
                 **{label: labels[label] for label in sp.LABELS},
                 "verified": sum(c["verified"] for r in records for c in r["citations"]),
                 "seconds": round(time.perf_counter() - started, 3)}
        errors = ["sentence-support check failed: no usable verdict, support is unknown"] if status == "failed" else []
        return {"support": {"judge": status, "markers": sp.markers(summary), "claims": records},
                "cost_usd": cost, "errors": errors, "quality": [entry]}

    return check_support
