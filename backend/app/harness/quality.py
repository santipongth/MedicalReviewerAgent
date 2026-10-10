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
    # meta_analysis only: sentences the pooled-number post-check removed / kept as single-study quotes. Absent for
    # other types (no stage logged), so their result.quality keeps its shape.
    pooled = by_stage.get("pooled_numbers")
    extra: dict[str, Any] = {}
    if pooled:
        last = pooled[-1]  # a resumed run may log the stage again; the latest narrative is the one in the result
        extra["pooled_numbers"] = {"removed": int(last.get("removed", 0)),
                                   "kept_single_study": int(last.get("kept_single_study", 0))}
    # Plan 19 grounded prose: what the post-check changed in the summary/rationale (latest narrative) and in the
    # conflict explanations. Absent for results that never ran it.
    prose = by_stage.get("prose_check")
    if prose:
        last = prose[-1]
        conflicts = by_stage.get("conflict", [])
        extra["prose_check"] = {
            **{k: int(last.get(k, 0)) for k in ("numbers_removed", "measures_fixed", "measures_removed",
                                                 "population_removed", "certainty_added", "repairs")},
            "conflict_sentences_removed": sum(e.get("prose_numbers_removed", 0) + e.get("prose_population_removed", 0)
                                              + e.get("prose_measures_removed", 0) for e in conflicts),
            "conflict_measures_fixed": sum(e.get("prose_measures_fixed", 0) for e in conflicts),
            "conflict_repairs": sum(e.get("prose_repairs", 0) for e in conflicts),
            # how the evidence rationale was made to agree with the GRADE-lite factors: "replaced", "appended" or null
            "rationale_fixed": last.get("rationale_fixed"),
        }
        for k in ("answer_removed", "key_findings_removed"):  # Plan 20; absent for results stored before it
            if k in last:
                extra["prose_check"][k] = int(last[k])
        if last.get("check_failed") or any(e.get("prose_check_failed") for e in conflicts):
            extra["prose_check"]["check_failed"] = True  # the check crashed and failed closed (final review 9)
    # Plan 19 localisation completeness (non-English reviews only; absent when nothing was localized): translatable
    # strings still not in the user's language after the retry pass, how many were retried, and how many had their
    # [Pn] citations restored. Counted over the cards and the synthesis.
    localized = by_stage.get("localize", []) + by_stage.get("localize_cards", [])
    if localized:
        extra["localize"] = {k: sum(int(e.get(k, 0)) for e in localized)
                             for k in ("untranslated", "retried", "citations_restored")}
    # Plan 19 Task 6 (each absent when its stage did not log it, so older results keep their shape)
    narrative = by_stage.get("narrative") or []
    if narrative and "uncited" in narrative[-1]:  # analysed papers the summary never cites; null = no summary
        extra["summary_uncited"] = narrative[-1]["uncited"]
    if any(e.get("second_vote") == "same_model" for e in screen):  # second vote skipped: same model as screener
        extra["second_vote_skipped"] = True
    normalize = by_stage.get("normalize") or []
    if normalize and "pairs" in normalize[-1]:  # outcome pre-clustering: pairs found / sent to the model
        extra["normalization_pairs"] = {"pairs": normalize[-1]["pairs"], "sent": normalize[-1].get("sent", 0)}
    search = by_stage.get("search") or []
    if search and search[-1].get("trial_queries"):  # meta_analysis Europe PMC RCT search
        extra["trial_search"] = {"queries": search[-1]["trial_queries"], "hits": search[-1].get("trial_hits", 0)}
        if "trial_failed" in search[-1]:  # Plan 20 Task 10: failures after the retries; the trial-name search
            extra["trial_search"] |= {"failed": search[-1]["trial_failed"],
                                      "names": list(search[-1].get("trial_names") or []),
                                      "name_hits": search[-1].get("trial_name_hits", 0)}
    # Plan 20 Task 10: Europe PMC requests that still failed after their retries (trial searches + lookup batches);
    # absent when none failed
    epmc_failed = (search[-1].get("trial_failed", 0) if search else 0) + sum(
        e.get("europepmc_failed", 0) for e in by_stage.get("enrich", []))
    if epmc_failed:
        extra["europepmc_failures"] = epmc_failed
    enrich = by_stage.get("enrich") or []
    if enrich and "off_focus" in enrich[-1]:  # candidates naming no key term, moved behind the on-topic ones
        extra["off_focus_demoted"] = enrich[-1]["off_focus"]
    templated = [e["templated"] for e in by_stage.get("localize", []) if "templated" in e]
    if templated:  # consensus/conflict strings rendered from fixed Thai templates in code
        extra["localize_templated"] = templated[-1]
    return {
        **extra,
        "numbers_verified": verified,
        "numbers_total": total,
        "verification_rate": _r(verified / total) if total else None,
        "papers_uncertain": sum(1 for e in read if e.get("uncertain")),
        # Plan 19: outcomes kept on the cards as other comparisons (not the review's intervention vs comparator),
        # and how many of them the deterministic backstop flagged
        "other_comparisons": sum(e.get("other_comparisons", 0) for e in read),
        "comparison_backstop": sum(e.get("comparison_backstop", 0) for e in read),
        # Plan 19: design labels corrected in code by the consistency check (audit I-7)
        "design_corrections": [{"ref": e.get("ref"), **e["design_corrected"]} for e in read
                               if e.get("design_corrected")],
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
