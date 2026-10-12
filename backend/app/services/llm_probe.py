"""One small real call to a role's model (Plan 23b "ทดสอบ"): proves the model, provider, key and structured output
work together. Output tokens and time are capped and the call runs inside a tiny budget; it never raises."""
from __future__ import annotations

import asyncio
import time
from typing import Any

from pydantic import BaseModel, Field

from app.config import Settings
from app.services.budget import ReviewBudget, use_budget
from app.services.llm import LimitedLLM, build_role_llm
from app.services.llm_config import ResolvedRole

PROBE_MAX_TOKENS = 512  # reasoning models need some room before they answer
PROBE_TIMEOUT_SECONDS = 60.0
PROBE_BUDGET_USD = 0.05
PROBE_SYSTEM = "You are a connectivity check for a structured-output API. Set ok to true and word to one English word."
PROBE_USER = "Answer now."


class ProbeAnswer(BaseModel):
    ok: bool
    word: str = Field(default="", max_length=40)


async def probe(role: ResolvedRole, settings: Settings, catalog=None, *, build=build_role_llm) -> dict[str, Any]:
    capped = role.with_spec(max_tokens=min(role.spec.max_tokens, PROBE_MAX_TOKENS),
                            timeout_seconds=min(role.spec.timeout_seconds, PROBE_TIMEOUT_SECONDS))
    budget = ReviewBudget(cap_usd=PROBE_BUDGET_USD)
    started = time.monotonic()

    def elapsed() -> int:
        return int((time.monotonic() - started) * 1000)

    try:
        llm = LimitedLLM(build(capped, settings, catalog, schema=ProbeAnswer), asyncio.Semaphore(1))
        with use_budget(budget):
            res = await llm.ainvoke(PROBE_SYSTEM, PROBE_USER)
    except Exception as exc:  # noqa: BLE001 - the console shows the reason; nothing else depends on it
        return {"ok": False, "latency_ms": elapsed(), "cost_usd": round(budget.spent, 6), "model": role.spec.model,
                "error": f"{type(exc).__name__}: {exc}"[:300]}
    ok = isinstance(res.value, ProbeAnswer) and res.value.ok
    return {"ok": ok, "latency_ms": elapsed(), "cost_usd": round(res.cost_usd, 6), "model": res.model or role.spec.model,
            "error": None if ok else "the model did not confirm"}
