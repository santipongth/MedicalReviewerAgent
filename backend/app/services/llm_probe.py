"""One small real call to a role's model (Plan 23b "ทดสอบ"): proves the model, provider, key and structured output
work together. Output tokens and time are capped (the time cap bounds the whole call, retries included), fallback
models are dropped so the primary is what gets tested, an extra_body cannot lift the caps, and the call runs inside a
tiny budget; it never raises."""
from __future__ import annotations

import asyncio
import time
from typing import Any

from pydantic import BaseModel, Field

from app.config import Settings
from app.services.budget import ReviewBudget, use_budget
from app.services.llm import LimitedLLM, build_role_llm, redact
from app.services.llm_config import ResolvedRole
from app.services.llm_keys import KeyRing, resolve_key
from app.services.llm_validate import role_unpriced

PROBE_MAX_TOKENS = 512  # reasoning models need some room before they answer
PROBE_TIMEOUT_SECONDS = 60.0
PROBE_BUDGET_USD = 0.05
# extra_body is merged over the request and would lift the output cap or bring the fallback models back
UNCAPPED_EXTRA_BODY_KEYS = frozenset({"max_tokens", "max_completion_tokens", "models"})
PROBE_SYSTEM = "You are a connectivity check for a structured-output API. Set ok to true and word to one English word."
PROBE_USER = "Answer now."


class ProbeAnswer(BaseModel):
    ok: bool
    word: str = Field(default="", max_length=40)


async def probe(role: ResolvedRole, settings: Settings, catalog=None, *, build=build_role_llm,
                keys: KeyRing | None = None) -> dict[str, Any]:
    """`keys` (Plan 23e): the console's key ring, resolved by origin as a worker would (None: env keys only). The error
    text is redacted with the key the call used."""
    capped = role.with_spec(max_tokens=min(role.spec.max_tokens, PROBE_MAX_TOKENS),
                            timeout_seconds=min(role.spec.timeout_seconds, PROBE_TIMEOUT_SECONDS),
                            fallback_models=[],
                            extra_body={k: v for k, v in role.spec.extra_body.items()
                                        if k not in UNCAPPED_EXTRA_BODY_KEYS})
    budget = ReviewBudget(cap_usd=PROBE_BUDGET_USD)
    priced = not role_unpriced(role, catalog)  # an unpriced role is charged 0: its cost is unknown, not zero

    def cost(value: float) -> float | None:
        return round(value, 6) if priced else None

    started = time.monotonic()

    def elapsed() -> int:
        return int((time.monotonic() - started) * 1000)

    # The clients' own timeout is per HTTP attempt and they retry (honouring Retry-After), so bound the whole call.
    deadline = asyncio.timeout(PROBE_TIMEOUT_SECONDS)
    built = {"keys": keys} if keys is not None else {}
    try:  # the key the call will use, read before it so the error path cannot fail on its own
        used = resolve_key(role.provider, role.provider_spec, keys, settings).value
    except Exception:  # noqa: BLE001 - a draft the build will refuse anyway; nothing to redact with
        used = None
    try:
        llm = LimitedLLM(build(capped, settings, catalog, schema=ProbeAnswer, **built), asyncio.Semaphore(1))
        with use_budget(budget):
            async with deadline:
                res = await llm.ainvoke(PROBE_SYSTEM, PROBE_USER)
    except Exception as exc:  # noqa: BLE001 - the console shows the reason; nothing else depends on it
        error = (f"timed out after {PROBE_TIMEOUT_SECONDS:g} s" if deadline.expired()
                 else redact(f"{type(exc).__name__}: {exc}", used)[:300])
        return {"ok": False, "latency_ms": elapsed(), "cost_usd": cost(budget.spent), "priced": priced,
                "model": role.spec.model, "error": error}
    ok = isinstance(res.value, ProbeAnswer) and res.value.ok
    return {"ok": ok, "latency_ms": elapsed(), "cost_usd": cost(res.cost_usd), "priced": priced,
            "model": res.model or role.spec.model, "error": None if ok else "the model did not confirm"}
