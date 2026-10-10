"""validate → repair → escalate loop around any StructuredLLM."""
from __future__ import annotations

from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel

from app.services.llm import LLMError, LLMOutputError, LLMRefusal, StructuredLLM

Validator = Callable[[Any], list[str]]
EscalationFactory = Callable[[type[BaseModel]], StructuredLLM | None]
ALL_TRIGGERS = ("repair_failed", "verification_failed", "disagreement")


def repair_suffix(problems: list[str]) -> str:
    lines = "\n".join(f"- {p}" for p in problems[:20])
    return ("\n\n<previous_attempt_problems>\n" + lines + "\n</previous_attempt_problems>\n"
            "Your previous answer had the problems above. Fix every one of them and answer again "
            "with the complete JSON object.")


@dataclass
class HarnessResult:
    value: Any
    cost: float = 0.0
    attempts: int = 0
    repaired: bool = False
    escalated: bool = False
    problems: list[str] = field(default_factory=list)
    ok: bool = False


class HarnessRunner:
    def __init__(self, *, max_repairs: int = 2, escalation: EscalationFactory | None = None,
                 escalate_on: Iterable[str] = ALL_TRIGGERS) -> None:
        self.max_repairs = max_repairs
        self.escalation = escalation
        self.escalate_on = frozenset(escalate_on)

    async def call(self, llm: StructuredLLM, system: str, user: str, *, schema: type[BaseModel],
                   validate: Validator | None = None, escalation_llm: StructuredLLM | None = None,
                   trigger: str = "repair_failed") -> HarnessResult:
        cost, attempts, problems = 0.0, 0, []
        last_value = None
        prompt = user
        for attempt in range(self.max_repairs + 1):
            attempts += 1
            try:
                res = await llm.ainvoke(system, prompt)
            except LLMRefusal:
                raise
            except LLMOutputError as exc:
                problems = [f"the answer was not valid JSON for the schema: {exc}"]
            else:
                cost += res.cost_usd
                last_value = res.value
                problems = validate(res.value) if validate else []
                if not problems:
                    return HarnessResult(res.value, cost, attempts, attempt > 0, False, [], True)
            prompt = user + repair_suffix(problems)

        if trigger in self.escalate_on:
            esc = escalation_llm or (self.escalation(schema) if self.escalation else None)
            if esc is not None and getattr(esc, "model", None) == getattr(llm, "model", object()):
                esc = None  # the same model already failed here: escalating to it only repeats the cost
            if esc is not None:
                escalated = await self._run_escalation(esc, system, user, validate)
                escalated.cost += cost
                escalated.attempts += attempts
                escalated.repaired = True
                if escalated.ok or escalated.value is not None:
                    return escalated
                return HarnessResult(last_value, escalated.cost, escalated.attempts, True, True,
                                     escalated.problems or problems, False)
        return HarnessResult(last_value, cost, attempts, attempts > 1, False, problems, False)

    async def escalate(self, system: str, user: str, *, schema: type[BaseModel],
                       validate: Validator | None = None, reason: str,
                       already_asked: Iterable[StructuredLLM | None] = ()) -> HarnessResult | None:
        """Escalate directly (e.g. two models disagree). None when not configured for this reason, or when the
        escalation model is one of `already_asked` (the models that produced the disagreement): asking the same
        model again only repeats the cost (audit I-10)."""
        if reason not in self.escalate_on or self.escalation is None:
            return None
        esc = self.escalation(schema)
        if esc is None:
            return None
        asked = {getattr(m, "model", None) for m in already_asked if m is not None} - {None}
        if getattr(esc, "model", None) in asked:
            return None
        return await self._run_escalation(esc, system, user, validate)

    async def _run_escalation(self, esc: StructuredLLM, system: str, user: str,
                              validate: Validator | None) -> HarnessResult:
        try:
            res = await esc.ainvoke(system, user)
        except LLMError as exc:  # incl. refusal: the caller keeps its own answer and flags it
            return HarnessResult(None, 0.0, 1, False, True, [f"escalation failed: {type(exc).__name__}: {exc}"],
                                 False)
        problems = validate(res.value) if validate else []
        return HarnessResult(res.value, res.cost_usd, 1, False, True, problems, not problems)
