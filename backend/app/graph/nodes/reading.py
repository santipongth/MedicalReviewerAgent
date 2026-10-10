"""Evidence-grounded reading: abstract → quote-anchored extraction → verification → dual-model cross-check."""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from app.graph import prompts
from app.graph.nodes.intake import harness_runner, harness_spec
from app.graph.progress import progress_writer
from app.graph.schemas import Candidate, PaperCard
from app.harness.comparison import settle_comparisons
from app.harness.design import (
    check_design_consistency,
    design_problems,
    settle_design_category,
    strip_non_quantitative,
)
from app.harness.runner import HarnessResult
from app.harness.verify import NUMERIC_FIELDS, card_problems, compare_cards, null_unverified_numbers
from app.services.llm import LLMError

log = logging.getLogger(__name__)


def paper_text(cand: Candidate) -> str | None:
    """The only text a paper is read from: its title and abstract (no full-text fetching)."""
    abstract = (cand.abstract or "").strip()
    return f"{cand.title}\n\n{abstract}" if abstract else None


def _blanked(before: PaperCard, after: PaperCard) -> list[dict[str, Any]]:
    """Values the verifier blanked, so the UI can show "not verified" instead of "not reported".

    Fields are blanked one at a time, so an outcome is listed when its estimate was blanked: its effect_value, or,
    for an outcome without one, all of its numbers. A blanked p-value or CI next to a verified effect is not listed
    (the effect is still verified). This mirrors the unit counts of `null_unverified_numbers`."""
    out: list[dict[str, Any]] = []
    for b, a in zip(before.outcomes, after.outcomes, strict=True):
        had = any(getattr(b, k) is not None for k in NUMERIC_FIELDS)
        lost_effect = b.effect_value is not None and a.effect_value is None
        if had and (lost_effect or all(getattr(a, k) is None for k in NUMERIC_FIELDS)):
            out.append({"field": "effect", "outcome": b.outcome})
    if before.sample_size is not None and after.sample_size is None:
        out.append({"field": "sample_size", "outcome": None})
    return out


def _ok_value(result: Any) -> PaperCard | None:
    if isinstance(result, HarnessResult) and result.value is not None:
        return result.value
    return None


def make_read_paper(deps):
    async def read_paper(payload: dict[str, Any]) -> dict:
        started = time.perf_counter()
        paper = payload["paper"]
        cand = Candidate.model_validate(paper["candidate"])
        writer = progress_writer()
        writer({"type": "reading", "ref": paper["ref"], "title": cand.title})
        spec, runner = harness_spec(deps), harness_runner(deps)

        entry: dict[str, Any] = {"ref": paper["ref"], "candidate": paper["candidate"], "relevance": paper["relevance"],
                                 "screen_reason": paper.get("reason"), "card": None, "error": None}
        source_text = paper_text(cand)
        if source_text is None:
            writer({"type": "extracted", "ref": paper["ref"], "ok": False, "verified": 0, "uncertain": False,
                    "direction": None, "design": None})
            return {"papers": [{**entry, "error": "no abstract"}], "errors": [f"no abstract for {paper['ref']}"],
                    "quality": [{"stage": "read", "ref": paper["ref"], "source": "abstract", "skipped": "no abstract",
                                 "seconds": round(time.perf_counter() - started, 3)}]}
        text = source_text[: spec.extraction_chars]
        outcomes = ((payload.get("question_detail") or {}).get("outcomes")
                    or (payload.get("plan") or {}).get("outcomes") or [])
        system = prompts.extract_system(payload.get("review_type") or "slr", bool(payload.get("qualitative")))
        user = prompts.extract_user(question=payload["question"], outcomes=outcomes, candidate=paper["candidate"],
                                    source="abstract", text=text)
        threshold = spec.quote_match_threshold

        pub_types = cand.pub_types

        def validate(card: PaperCard) -> list[str]:
            problems = card_problems(card, text, threshold) if spec.verify_quotes else []
            return problems + design_problems(card, pub_types)

        calls = [runner.call(deps.llms.extractor, system, user, schema=PaperCard, validate=validate,
                             trigger="verification_failed")]
        secondary_llm = getattr(deps.llms, "extractor_secondary", None) if spec.dual_extraction else None
        if secondary_llm is not None and getattr(secondary_llm, "model", None) == getattr(deps.llms.extractor, "model", 0):
            secondary_llm = None  # the same model twice is extra cost, not an independent cross-check
        if secondary_llm is not None:  # runs in parallel: costs money, not time
            calls.append(runner.call(secondary_llm, system, user, schema=PaperCard, validate=validate,
                                     trigger="secondary"))
        results = await asyncio.gather(*calls, return_exceptions=True)
        primary, secondary = results[0], (results[1] if len(results) > 1 else None)

        cost = sum(r.cost for r in results if isinstance(r, HarnessResult))
        errors: list[str] = []
        p_card, s_card = _ok_value(primary), _ok_value(secondary)
        card = p_card or s_card
        repaired = isinstance(primary, HarnessResult) and primary.repaired
        escalated = isinstance(primary, HarnessResult) and primary.escalated
        agreement: float | None = None
        uncertain = bool(paper.get("uncertain"))

        if p_card is not None and s_card is not None:
            agreement, disagreements = compare_cards(p_card, s_card)
            if any("direction" in d for d in disagreements):
                esc = await runner.escalate(system, user, schema=PaperCard, validate=validate, reason="disagreement",
                                            already_asked=(deps.llms.extractor, secondary_llm))
                if esc is not None:
                    cost += esc.cost
                if esc is not None and esc.ok and esc.value is not None:
                    card, escalated = esc.value, True
                else:
                    uncertain = True

        verified = total = 0
        design_correction: dict[str, str] | None = None
        unverified: list[dict[str, Any]] = []
        comparison_counts: dict[str, int] = {}
        if card is None:
            failure = primary if isinstance(primary, BaseException) else None
            message = (f"{type(failure).__name__}: {failure}" if failure else
                       "; ".join(primary.problems) if isinstance(primary, HarnessResult) else "no output")
            entry["error"] = message
            errors.append(f"extraction failed for {paper['ref']}: {message}")
        else:
            if spec.verify_quotes:
                before = card
                card, verified, total = null_unverified_numbers(card, text, threshold)
                unverified = _blanked(before, card)
            # an estimate of another comparison stays on the card, flagged, and never becomes evidence (Plan 19).
            # The deterministic post-checks are extras: a crash keeps the card as it was (the model's own flags and
            # label) and is logged, never failing the paper or the review (final review finding 9).
            try:
                card, flipped = settle_comparisons(card, payload.get("question_detail"),
                                                   payload.get("review_type") or "slr")
            except Exception as exc:
                log.exception("settle_comparisons failed for %s", paper["ref"])
                errors.append(f"comparison check failed for {paper['ref']}: {type(exc).__name__}")
                flipped = 0
            comparison_counts = {"other_comparisons": sum(1 for o in card.outcomes if not o.matches_question),
                                 "comparison_backstop": flipped}
            # after verification: a qualitative/mixed card never carries effect numbers or a direction
            settled = settle_design_category(card, pub_types)
            # a label the pub types, design text, title or abstract clearly contradict is corrected in code (I-7)
            try:
                settled, design_correction = check_design_consistency(settled, pub_types, cand.title, text)
            except Exception as exc:
                log.exception("check_design_consistency failed for %s", paper["ref"])
                errors.append(f"design check failed for {paper['ref']}: {type(exc).__name__}")
            stripped = strip_non_quantitative(settled)
            if stripped is not settled:  # recount: only the numbers that remain (a verified sample size, if any)
                kept = int(spec.verify_quotes and stripped.sample_size is not None)
                verified = total = kept
                unverified = [u for u in unverified if u["field"] != "effect"]
            entry["card"] = stripped.model_dump()
        if isinstance(primary, BaseException) and not isinstance(primary, LLMError):
            raise primary
        entry["verification"] = {"numbers_verified": verified, "numbers_total": total, "agreement": agreement,
                                 "escalated": escalated, "repaired": repaired, "uncertain": uncertain,
                                 "unverified": unverified}
        if paper.get("design_mismatch"):  # kept although its design is outside the ticked study types (relaxed)
            entry["verification"]["design_mismatch"] = True
            entry["design_mismatch"] = True
        quality = {"stage": "read", "ref": paper["ref"], "source": "abstract",
                   **{k: v for k, v in entry["verification"].items() if k != "unverified"},
                   **comparison_counts, "seconds": round(time.perf_counter() - started, 3)}
        if design_correction:
            quality["design_corrected"] = design_correction
        extracted = {"type": "extracted", "ref": paper["ref"], "ok": entry["card"] is not None,
                     "verified": verified, "uncertain": uncertain,
                     "direction": entry["card"]["overall_direction"] if entry["card"] else None,
                     "design": entry["card"]["design_category"] if entry["card"] else None}
        if (payload.get("review_type") or "slr") == "scoping":  # a scoping review shows no direction anywhere
            del extracted["direction"]
        writer(extracted)
        return {"papers": [entry], "cost_usd": cost, "errors": errors, "quality": [quality]}

    return read_paper
