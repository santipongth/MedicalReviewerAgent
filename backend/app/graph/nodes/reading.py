"""Evidence-grounded reading: full text → quote-anchored extraction → verification → dual-model cross-check."""
from __future__ import annotations

import asyncio
import time
from typing import Any

from app.graph import prompts
from app.graph.nodes.intake import harness_runner, harness_spec
from app.graph.progress import progress_writer
from app.graph.schemas import Candidate, PaperCard
from app.harness.runner import HarnessResult
from app.harness.verify import card_problems, compare_cards, null_unverified_numbers
from app.services.fulltext import FullText
from app.services.llm import LLMError


def _fallback(cand: Candidate) -> FullText:
    return FullText("abstract", cand.abstract) if cand.abstract else FullText("title_only", cand.title)


async def _fetch(deps, cand: Candidate) -> tuple[FullText, bool, str | None]:
    """(text, timed_out, error). Full text is optional: every failure falls back to the abstract."""
    try:
        ft = await asyncio.wait_for(deps.fulltext.fetch(cand), timeout=deps.settings.fulltext_timeout_seconds)
        return ft, False, None
    except TimeoutError:
        return _fallback(cand), True, None
    except Exception as exc:  # noqa: BLE001 - cache/policy/crawler faults must not fail the review
        return _fallback(cand), False, f"{type(exc).__name__}: {exc}"


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

        fetch_started = time.perf_counter()
        fulltext, timed_out, fetch_error = await _fetch(deps, cand)
        fulltext_seconds = round(time.perf_counter() - fetch_started, 3)

        text = fulltext.text[: spec.extraction_chars]
        outcomes = ((payload.get("question_detail") or {}).get("outcomes")
                    or (payload.get("plan") or {}).get("outcomes") or [])
        system = prompts.extract_system()
        user = prompts.extract_user(question=payload["question"], outcomes=outcomes, candidate=paper["candidate"],
                                    source=fulltext.source, text=text)
        threshold = spec.quote_match_threshold

        def validate(card: PaperCard) -> list[str]:
            return card_problems(card, text, threshold) if spec.verify_quotes else []

        calls = [runner.call(deps.llms.extractor, system, user, schema=PaperCard, validate=validate,
                             trigger="verification_failed")]
        secondary_llm = getattr(deps.llms, "extractor_secondary", None) if spec.dual_extraction else None
        if secondary_llm is not None:  # runs in parallel: costs money, not time
            calls.append(runner.call(secondary_llm, system, user, schema=PaperCard, validate=validate,
                                     trigger="secondary"))
        results = await asyncio.gather(*calls, return_exceptions=True)
        primary, secondary = results[0], (results[1] if len(results) > 1 else None)

        cost = sum(r.cost for r in results if isinstance(r, HarnessResult))
        errors: list[str] = [f"full text failed for {paper['ref']}: {fetch_error}"] if fetch_error else []
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

        entry: dict[str, Any] = {"ref": paper["ref"], "candidate": paper["candidate"], "relevance": paper["relevance"],
                                 "screen_reason": paper.get("reason"), "fulltext_source": fulltext.source,
                                 "fulltext_url": fulltext.url, "card": None, "error": None}
        verified = total = 0
        if card is None:
            failure = primary if isinstance(primary, BaseException) else None
            message = (f"{type(failure).__name__}: {failure}" if failure else
                       "; ".join(primary.problems) if isinstance(primary, HarnessResult) else "no output")
            entry["error"] = message
            errors.append(f"extraction failed for {paper['ref']}: {message}")
        else:
            if spec.verify_quotes:
                card, verified, total = null_unverified_numbers(card, text, threshold)
            entry["card"] = card.model_dump()
        if isinstance(primary, BaseException) and not isinstance(primary, LLMError):
            raise primary
        entry["verification"] = {"numbers_verified": verified, "numbers_total": total, "agreement": agreement,
                                 "escalated": escalated, "repaired": repaired, "uncertain": uncertain}
        quality = {"stage": "read", "ref": paper["ref"], "source": fulltext.source,
                   "fulltext_seconds": fulltext_seconds, "fulltext_timed_out": timed_out,
                   **entry["verification"], "seconds": round(time.perf_counter() - started, 3)}
        writer({"type": "extracted", "ref": paper["ref"], "ok": entry["card"] is not None,
                "source": fulltext.source, "verified": verified, "uncertain": uncertain})
        return {"papers": [entry], "cost_usd": cost, "errors": errors, "quality": [quality]}

    return read_paper
