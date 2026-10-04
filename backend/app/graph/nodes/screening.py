"""Screening with a borderline second vote (different model family) and escalation on disagreement."""
from __future__ import annotations

import time
from typing import Any

from langgraph.types import Send

from app.graph import prompts
from app.graph.nodes.intake import harness_runner, harness_spec, review_question
from app.graph.progress import progress_writer
from app.graph.schemas import ScreenBatch
from app.graph.state import ReviewState
from app.schemas.review import ReviewOptions
from app.services.llm import LLMError


def route_to_screening(state: ReviewState, batch_size: int = 10) -> list[Send] | str:
    cands = state.get("candidates") or []
    if not cands:
        return "normalize_outcomes"
    common = {"plan": state.get("plan") or {}, "question": review_question(state),
              "language": state.get("language", "th")}
    return [Send("screen_batch", {"batch": cands[i : i + batch_size], **common})
            for i in range(0, len(cands), batch_size)]


def _coverage(refs: list[str]):
    def validate(batch: ScreenBatch) -> list[str]:
        got = [d.ref for d in batch.decisions]
        problems = [f"missing decision for {r}" for r in refs if r not in got]
        problems += [f"unknown ref {r} (only {', '.join(refs)} exist)" for r in got if r not in refs]
        problems += [f"more than one decision for {r}" for r in set(got) if got.count(r) > 1]
        return problems
    return validate


def _decisions(batch: ScreenBatch | None, refs: list[str]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for d in (batch.decisions if batch else []):
        if d.ref in refs and d.ref not in out:
            out[d.ref] = {"relevance": max(0, min(100, d.relevance)), "include": d.include, "reason": d.reason,
                          "design": d.design_guess}
    return out


def make_screen_batch(deps):
    async def screen_batch(payload: dict[str, Any]) -> dict:
        started = time.perf_counter()
        batch = payload["batch"]
        spec, runner = harness_spec(deps), harness_runner(deps)
        writer = progress_writer()
        writer({"type": "screening", "batch": len(batch)})
        items = {f"C{i + 1}": c for i, c in enumerate(batch)}
        refs = list(items)

        def user_for(subset: list[str]) -> str:
            return prompts.screen_user(english_topic=payload["question"], plan=payload["plan"],
                                       items=[(r, items[r]) for r in subset])

        cost, errors = 0.0, []
        quality: dict[str, Any] = {"stage": "screen", "batch": len(batch), "borderline": 0, "disagreements": 0,
                                   "escalated": 0, "repaired": False}
        try:
            res = await runner.call(deps.llms.screener, prompts.SCREEN_SYSTEM, user_for(refs),
                                    schema=ScreenBatch, validate=_coverage(refs), trigger="screen")
            cost += res.cost
            quality["repaired"] = res.repaired
            decisions = _decisions(res.value, refs)
        except LLMError as exc:
            errors.append(f"screening batch failed: {type(exc).__name__}: {exc}")
            decisions = {}

        uncertain: set[str] = set()
        low, high = spec.screen_borderline
        borderline = [r for r in refs if r in decisions and low <= decisions[r]["relevance"] <= high]
        secondary = getattr(deps.llms, "screener_secondary", None)
        if borderline and secondary is not None:
            quality["borderline"] = len(borderline)
            try:
                second = await runner.call(secondary, prompts.SCREEN_SYSTEM, user_for(borderline),
                                           schema=ScreenBatch, validate=_coverage(borderline), trigger="screen")
                cost += second.cost
                votes = _decisions(second.value, borderline)
            except LLMError as exc:
                errors.append(f"second screening vote failed: {type(exc).__name__}")
                votes = {}
            disputed = []
            for r in borderline:
                if r not in votes:
                    continue
                if votes[r]["include"] == decisions[r]["include"]:
                    decisions[r]["relevance"] = (decisions[r]["relevance"] + votes[r]["relevance"]) // 2
                else:
                    disputed.append(r)
            quality["disagreements"] = len(disputed)
            if disputed:
                esc = await runner.escalate(prompts.SCREEN_SYSTEM, user_for(disputed), schema=ScreenBatch,
                                            validate=_coverage(disputed), reason="disagreement")
                resolved = _decisions(esc.value, disputed) if esc and esc.ok else {}
                if esc:
                    cost += esc.cost
                    quality["escalated"] = len(resolved)
                for r in disputed:
                    if r in resolved:
                        decisions[r] = resolved[r]
                    else:  # unresolved disagreement: keep the paper (recall first) and flag it
                        decisions[r]["include"] = True
                        uncertain.add(r)

        screened = [{"key": c["key"], **decisions.get(ref, {"relevance": 0, "include": False,
                                                              "reason": "not screened"}),
                     "uncertain": ref in uncertain}
                    for ref, c in items.items()]
        quality["seconds"] = round(time.perf_counter() - started, 3)
        return {"screened": screened, "cost_usd": cost, "errors": errors, "quality": [quality]}

    return screen_batch


MIN_PRIMARY_FOR_NO_REVIEWS = 3


def make_select_top(deps):
    async def select_top(state: ReviewState) -> dict:
        options = ReviewOptions.clamped(state.get("options"))
        best: dict[str, dict[str, Any]] = {}
        for d in state.get("screened") or []:
            if d["key"] not in best or d["relevance"] > best[d["key"]]["relevance"]:
                best[d["key"]] = d
        by_key = {c["key"]: c for c in state.get("candidates") or []}
        included = [d for d in best.values() if d["include"] and d["key"] in by_key]
        primary = [d for d in included if d.get("design") != "narrative_review"]
        # Narrative reviews restate other studies: leave them out when enough original or pooled evidence exists.
        narrative_excluded = len(included) - len(primary) if len(primary) >= MIN_PRIMARY_FOR_NO_REVIEWS else 0
        pool = primary if narrative_excluded else included
        chosen = sorted(pool, key=lambda d: -d["relevance"])[: options.max_papers]
        selected = [{"ref": f"P{i + 1}", "relevance": d["relevance"], "reason": d["reason"],
                     "uncertain": d.get("uncertain", False), "candidate": by_key[d["key"]]}
                    for i, d in enumerate(chosen)]
        progress_writer()({"type": "screened", "kept": len(selected), "total": len(best)})
        return {"selected": selected, "quality": [{"stage": "select", "narrative_excluded": narrative_excluded}]}

    return select_top


def route_to_reading(state: ReviewState, external_enabled=None) -> list[Send] | str:
    """One read_paper per selected paper, plus one external_enrich when external MCP tools are configured
    (same superstep, so it adds no latency)."""
    selected = state.get("selected") or []
    if not selected:
        return "normalize_outcomes"
    common = {"plan": state.get("plan") or {}, "question": review_question(state),
              "question_detail": state.get("question"), "language": state.get("language", "th")}
    sends = [Send("read_paper", {"paper": s, **common}) for s in selected]
    if external_enabled is not None and external_enabled():
        sends.append(Send("external_enrich", {"question": common["question"], "plan": common["plan"]}))
    return sends

