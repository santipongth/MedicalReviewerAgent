"""Plan 22a: replay one frozen pool through the eval graph and record the result, cost, citation tally and the
engine's verdict on the Cochrane primary outcome."""
from __future__ import annotations

import time
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel

from app.evals.leakage import drop_target
from app.evals.models import Fixture, PrimaryMatch, RunRecord
from app.graph.graph import build_eval_graph, initial_state
from app.graph.nodes.intake import harness_runner
from app.harness.citation_tally import CitationTally, use_tally
from app.harness.matrix import classify_row
from app.schemas.review import ReviewOptions
from app.services.budget import ReviewBudget, review_cost_cap, use_budget


class OutcomeMatch(BaseModel):
    index: int | None  # 0-based index of the matching outcome row, or null when none matches


MATCH_SYSTEM = ("You match outcome names. Given a target outcome from a Cochrane review and a numbered list of "
                "outcome rows from another review, return the index of the row that measures the same outcome "
                "(same construct; wording and abbreviations may differ), or null when none does.")


def eval_state(fixture: Fixture, options: dict[str, Any], language: str = "th") -> dict[str, Any]:
    state = dict(initial_state(f"eval-{fixture.id}", fixture.topic, language, options))
    candidates, _ = drop_target(fixture.candidates, fixture.id, fixture.pmid)  # belt and braces for old fixtures
    state.update(english_topic=fixture.english_topic, question=fixture.question, plan=fixture.plan,
                 candidates=candidates, search_stats=fixture.search_stats, eval_year_to=fixture.year_to)
    return state


async def match_primary(deps, result: dict[str, Any], primary_outcome: str) -> tuple[PrimaryMatch, float]:
    rows = ((result.get("synthesis_en") or {}).get("comparison") or [])
    if not primary_outcome or not rows:
        return PrimaryMatch(row_index=None, outcome=None, verdict="none", direction=None), 0.0
    listing = "\n".join(f"{i}: {r['outcome']}" for i, r in enumerate(rows))
    user = f"Target outcome: {primary_outcome}\nRows:\n{listing}"

    def validate(m: OutcomeMatch) -> list[str]:
        if not isinstance(m, OutcomeMatch):  # a wrong-schema answer is "no match", never a crash
            return ["answer is not an OutcomeMatch"]
        return [] if m.index is None or 0 <= m.index < len(rows) else [f"index must be null or 0..{len(rows) - 1}"]

    res = await harness_runner(deps).call(deps.llms.with_schema("planner", OutcomeMatch), MATCH_SYSTEM, user,
                                          schema=OutcomeMatch, validate=validate)
    index = res.value.index if isinstance(res.value, OutcomeMatch) else None  # no valid answer: no match
    if index is None:
        return PrimaryMatch(row_index=None, outcome=None, verdict="none", direction=None), res.cost
    verdict = classify_row(rows[index].get("cells") or [])
    return PrimaryMatch(row_index=index, outcome=rows[index]["outcome"], verdict=verdict["verdict"],
                        direction=verdict.get("direction")), res.cost


async def replay(deps, fixture: Fixture, *, options: dict[str, Any], repeat: int, run_id: str, git_sha: str,
                 language: str = "th", primary_outcome: str = "") -> RunRecord:
    started_at = datetime.now(UTC).isoformat(timespec="seconds")
    t0 = time.monotonic()
    tally = CitationTally()
    budget = ReviewBudget(cap_usd=review_cost_cap(deps.settings, ReviewOptions.clamped(options)))
    common = {"id": fixture.id, "repeat": repeat, "run_id": run_id, "prompt_version": deps.settings.prompt_version,
              "git_sha": git_sha, "pool_version": fixture.pool_version,
              "fixture_frozen_at": fixture.frozen_at, "preset": getattr(deps.llms, "preset", ""),
              "models": dict(getattr(deps.llms, "models", {}) or {}), "started_at": started_at}
    try:
        with use_budget(budget), use_tally(tally):
            graph = build_eval_graph(deps)
            values = await graph.ainvoke(eval_state(fixture, options, language),
                                         {"configurable": {"thread_id": f"{fixture.id}-{repeat}"}})
            result = values.get("result") or {}
            if not result:  # a graph that ends without a report is a failed review, never a "done" one
                return RunRecord(**common, elapsed_s=round(time.monotonic() - t0, 2),
                                 cost_usd=round(max(budget.spent, float(values.get("cost_usd", 0.0))), 6),
                                 status="error", error="empty result",
                                 citations={"proposed": tally.proposed, "stripped": tally.stripped})
            match, match_cost = await match_primary(deps, result, primary_outcome)
    except Exception as exc:  # noqa: BLE001 - a failed review is recorded and stays in every denominator
        return RunRecord(**common, elapsed_s=round(time.monotonic() - t0, 2), cost_usd=round(budget.spent, 6),
                         status="error", error=f"{type(exc).__name__}: {exc}",
                         citations={"proposed": tally.proposed, "stripped": tally.stripped})
    return RunRecord(**common, elapsed_s=round(time.monotonic() - t0, 2),
                     cost_usd=round(float(values.get("cost_usd", 0.0)) + match_cost, 6), status="done",
                     citations={"proposed": tally.proposed, "stripped": tally.stripped}, primary_match=match,
                     result=result)
