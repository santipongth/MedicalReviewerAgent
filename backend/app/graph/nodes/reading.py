"""Evidence-grounded reading: abstract → quote-anchored extraction → verification → dual-model cross-check."""
from __future__ import annotations

import asyncio
import time
from typing import Any

from app.graph import prompts
from app.graph.nodes.intake import harness_runner, harness_spec
from app.graph.progress import progress_writer
from app.graph.schemas import Candidate, PaperCard
from app.harness.design import design_problems, settle_design_category
from app.harness.runner import HarnessResult
from app.harness.verify import card_problems, compare_cards, null_unverified_numbers
from app.services.llm import LLMError


def paper_text(cand: Candidate) -> str | None:
    """The only text a paper is read from: its title and abstract (no full-text fetching)."""
    abstract = (cand.abstract or "").strip()
    return f"{cand.title}\n\n{abstract}" if abstract else None


def _blanked(before: PaperCard, after: PaperCard) -> list[dict[str, Any]]:
    """Values the verifier blanked, so the UI can show "not verified" instead of "not reported"."""
    out: list[dict[str, Any]] = []
    for b, a in zip(before.outcomes, after.outcomes, strict=True):
        had = any(v is not None for v in (b.effect_value, b.ci_lower, b.ci_upper, b.p_value))
        if had and all(v is None for v in (a.effect_value, a.ci_lower, a.ci_upper, a.p_value)):
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
            writer({"type": "extracted", "ref": paper["ref"], "ok": False, "verified": 0, "uncertain": False})
            return {"papers": [{**entry, "error": "no abstract"}], "errors": [f"no abstract for {paper['ref']}"],
                    "quality": [{"stage": "read", "ref": paper["ref"], "source": "abstract", "skipped": "no abstract",
                                 "seconds": round(time.perf_counter() - started, 3)}]}
        text = source_text[: spec.extraction_chars]
        outcomes = ((payload.get("question_detail") or {}).get("outcomes")
                    or (payload.get("plan") or {}).get("outcomes") or [])
        system = prompts.extract_system()
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
                esc = await runner.escalate(system, user, schema=PaperCard, validate=validate, reason="disagreement")
                if esc is not None:
                    cost += esc.cost
                if esc is not None and esc.ok and esc.value is not None:
                    card, escalated = esc.value, True
                else:
                    uncertain = True

        verified = total = 0
        unverified: list[dict[str, Any]] = []
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
            entry["card"] = settle_design_category(card, pub_types).model_dump()
        if isinstance(primary, BaseException) and not isinstance(primary, LLMError):
            raise primary
        entry["verification"] = {"numbers_verified": verified, "numbers_total": total, "agreement": agreement,
                                 "escalated": escalated, "repaired": repaired, "uncertain": uncertain,
                                 "unverified": unverified}
        quality = {"stage": "read", "ref": paper["ref"], "source": "abstract",
                   **{k: v for k, v in entry["verification"].items() if k != "unverified"},
                   "seconds": round(time.perf_counter() - started, 3)}
        writer({"type": "extracted", "ref": paper["ref"], "ok": entry["card"] is not None,
                "verified": verified, "uncertain": uncertain})
        return {"papers": [entry], "cost_usd": cost, "errors": errors, "quality": [quality]}

    return read_paper
