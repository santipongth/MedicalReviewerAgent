"""Screening with a borderline second vote (different model family) and escalation on disagreement."""
from __future__ import annotations

import time
from collections import Counter
from typing import Any

from langgraph.types import Send

from app.graph import prompts
from app.graph.nodes.intake import harness_runner, harness_spec, review_question
from app.graph.progress import progress_writer
from app.graph.schemas import ScreenBatch
from app.graph.state import ReviewState
from app.harness.study_types import allowed_designs, canonical_types, design_allowed
from app.schemas.review import SLR_LIKE, ReviewOptions, wants_qualitative
from app.services.llm import LLMError


def route_to_screening(state: ReviewState, batch_size: int = 10) -> list[Send] | str:
    cands = state.get("candidates") or []
    if not cands:
        return "normalize_outcomes"
    common = {"plan": state.get("plan") or {}, "question": review_question(state),
              "language": state.get("language", "th"),
              "review_type": ReviewOptions.clamped(state.get("options")).review_type,
              "qualitative": wants_qualitative(state.get("options")),
              "study_types": (canonical_types(state.get("options"))
                              if ReviewOptions.clamped(state.get("options")).review_type in SLR_LIKE else [])}
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
            reason = None if d.include else (d.exclusion_reason or "other")
            out[d.ref] = {"relevance": max(0, min(100, d.relevance)), "include": d.include, "reason": d.reason,
                          "design": d.design_guess, "exclusion_reason": reason}
    return out


def make_screen_batch(deps):
    async def screen_batch(payload: dict[str, Any]) -> dict:
        started = time.perf_counter()
        batch = payload["batch"]
        spec, runner = harness_spec(deps), harness_runner(deps)
        system = prompts.screen_system(payload.get("review_type") or "slr", bool(payload.get("qualitative")))
        writer = progress_writer()
        writer({"type": "screening", "batch": len(batch)})
        items = {f"C{i + 1}": c for i, c in enumerate(batch)}
        refs = list(items)

        def user_for(subset: list[str]) -> str:
            return prompts.screen_user(english_topic=payload["question"], plan=payload["plan"],
                                       items=[(r, items[r]) for r in subset],
                                       study_types=payload.get("study_types") or None)

        cost, errors = 0.0, []
        quality: dict[str, Any] = {"stage": "screen", "batch": len(batch), "borderline": 0, "disagreements": 0,
                                   "escalated": 0, "repaired": False}
        try:
            res = await runner.call(deps.llms.screener, system, user_for(refs),
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
        if secondary is not None and getattr(secondary, "model", None) == getattr(deps.llms.screener, "model", 0):
            secondary = None  # the same model at temperature 0 is no second opinion, only a second bill (audit I-10)
            quality["second_vote"] = "same_model"
        if borderline and secondary is not None:
            quality["borderline"] = len(borderline)
            try:
                second = await runner.call(secondary, system, user_for(borderline),
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
                esc = await runner.escalate(system, user_for(disputed), schema=ScreenBatch,
                                            validate=_coverage(disputed), reason="disagreement",
                                            already_asked=(deps.llms.screener, secondary))
                resolved = _decisions(esc.value, disputed) if esc and esc.ok else {}
                if esc:
                    cost += esc.cost
                    quality["escalated"] = len(resolved)
                for r in disputed:
                    if r in resolved:
                        decisions[r] = resolved[r]
                    else:  # unresolved disagreement: keep the paper (recall first) and flag it
                        decisions[r]["include"] = True
                        decisions[r]["exclusion_reason"] = None
                        uncertain.add(r)

        screened = [{"key": c["key"], **decisions.get(ref, {"relevance": 0, "include": False,
                                                              "reason": "not screened",
                                                              "exclusion_reason": "other",
                                                              "screen_failed": True}),
                     "uncertain": ref in uncertain}
                    for ref, c in items.items()]
        quality["seconds"] = round(time.perf_counter() - started, 3)
        return {"screened": screened, "cost_usd": cost, "errors": errors, "quality": [quality]}

    return screen_batch


MIN_PRIMARY_FOR_NO_REVIEWS = 3
MIN_MATCHING_DESIGNS = 3
MIN_INCLUDE_RELEVANCE = 35  # default floor; the configured borderline band's lower edge wins


def make_select_top(deps):
    async def select_top(state: ReviewState) -> dict:
        options = ReviewOptions.clamped(state.get("options"))
        keep_narrative = options.review_type not in SLR_LIKE  # narrative/scoping reviews welcome narrative reviews
        best: dict[str, dict[str, Any]] = {}
        for d in state.get("screened") or []:
            if d["key"] not in best or d["relevance"] > best[d["key"]]["relevance"]:
                best[d["key"]] = d
        by_key = {c["key"]: c for c in state.get("candidates") or []}
        included = [d for d in best.values() if d["include"] and d["key"] in by_key]
        # Relevance floor (audit I-21): an "include" at relevance 10 contradicts itself. The floor is the bottom of the
        # borderline band (35), so includes the second vote agreed on are kept; disputed papers kept for recall
        # (uncertain) are exempt, and the floor never leaves fewer than MIN_MATCHING_DESIGNS papers.
        floor = min(harness_spec(deps).screen_borderline or (MIN_INCLUDE_RELEVANCE,))
        above = [d for d in included if d["relevance"] >= floor or d.get("uncertain")]
        low_relevance = 0
        if len(above) >= MIN_MATCHING_DESIGNS:
            low_relevance, included = len(included) - len(above), above
        # Ticked study types are enforced here only (the screener just labels designs): a paper whose design maps to none of them is excluded (PRISMA reason
        # study_design). Unknown designs stay. If fewer than MIN_MATCHING_DESIGNS remain, the mismatches are kept
        # after the matches (and flagged) rather than leaving the review empty.
        allowed = allowed_designs(state.get("options"), options.review_type)
        design_excluded = relaxed = 0
        if allowed:
            fit_keys = {d["key"] for d in included if design_allowed(d.get("design"), allowed)}
            fits = [d for d in included if d["key"] in fit_keys]
            misfits = [d for d in included if d["key"] not in fit_keys]
            if len(fits) >= MIN_MATCHING_DESIGNS or not misfits:
                design_excluded = len(misfits)
                included = fits
            else:
                relaxed = len(misfits)
                included = fits + [{**d, "design_mismatch": True} for d in misfits]  # copies: state stays untouched
        primary = [d for d in included if d.get("design") != "narrative_review"]
        # Narrative reviews restate other studies: leave them out when enough original or pooled evidence exists.
        narrative_excluded = (len(included) - len(primary)
                              if not keep_narrative and len(primary) >= MIN_PRIMARY_FOR_NO_REVIEWS else 0)
        pool = primary if narrative_excluded else included
        ranked = sorted(pool, key=lambda d: (bool(d.get("design_mismatch")), -d["relevance"]))
        chosen = ranked[: options.max_papers]
        # Technical failures are not exclusion decisions: keep them out of the PRISMA reason tallies.
        excluded_screening = Counter(d.get("exclusion_reason") or "other" for d in best.values()
                                     if not d["include"] and not d.get("screen_failed"))
        if design_excluded:
            excluded_screening["study_design"] += design_excluded
        screening_failed = sum(1 for d in best.values() if d.get("screen_failed") and not d["include"])
        selected = [{"ref": f"P{i + 1}", "relevance": d["relevance"], "reason": d["reason"],
                     "uncertain": d.get("uncertain", False) or bool(d.get("design_mismatch")),
                     "candidate": by_key[d["key"]]}
                    for i, d in enumerate(chosen)]
        progress_writer()({"type": "screened", "kept": len(selected), "total": len(best)})
        stats = {"excluded_screening": dict(excluded_screening), "narrative_excluded": narrative_excluded,
                 "over_limit": len(ranked) - len(chosen)}
        if relaxed:
            stats["study_design_relaxed"] = relaxed
        if screening_failed:
            stats["screening_failed"] = screening_failed
        if low_relevance:
            stats["low_relevance"] = low_relevance
        return {"selected": selected, "selection_stats": stats,
                "quality": [{"stage": "select", "narrative_excluded": narrative_excluded,
                             "study_design_excluded": design_excluded, "study_design_relaxed": relaxed,
                             "low_relevance": low_relevance}]}

    return select_top


def route_to_reading(state: ReviewState, external_enabled=None, citations_enabled=None) -> list[Send] | str:
    """One read_paper per selected paper, plus one external_enrich when external MCP tools are configured
    (same superstep, so it adds no latency)."""
    selected = state.get("selected") or []
    if not selected:
        return "normalize_outcomes"
    common = {"plan": state.get("plan") or {}, "question": review_question(state),
              "question_detail": state.get("question"), "language": state.get("language", "th"),
              "review_type": ReviewOptions.clamped(state.get("options")).review_type,
              "qualitative": wants_qualitative(state.get("options"))}
    sends = [Send("read_paper", {"paper": s, **common}) for s in selected]
    if external_enabled is not None and external_enabled():
        sends.append(Send("external_enrich", {"question": common["question"], "plan": common["plan"]}))
    if citations_enabled is not None and citations_enabled():
        sends.append(Send("fetch_citations", {"papers": [{"ref": s["ref"], "candidate": s.get("candidate") or {}}
                                                          for s in selected]}))
    return sends

