"""Rough cost of one default review for an LLM preset (Plan 23b); shared by the models CLI and the admin console."""
from __future__ import annotations

from typing import Any

from app.schemas.review import ReviewOptions
from app.services.llm_config import ResolvedLLMConfig
from app.services.model_catalog import ModelInfo, role_price

_PAPERS = ReviewOptions.model_fields["max_papers"].default
_POOL = ReviewOptions.model_fields["candidate_limit"].default

# Rough token budget of one default review (a full pool screened, the default paper count analysed), used for the
# cost estimate in `check`.
TYPICAL_CALLS: dict[str, tuple[int, int, int]] = {  # role: (calls, input tokens, output tokens) per call
    "guard": (1, 400, 100),
    "refiner": (2, 1500, 1200),                 # draft + one self-critique round
    "planner": (1, 900, 700),
    "screener": (_POOL // 10, 6000, 900),       # the pool in parallel batches of 10
    "extractor": (_PAPERS, 1200, 700),           # one abstract per analysed paper
    "synthesizer": (1, 20000, 3000),
    "screener_secondary": (8, 3000, 500),       # only borderline papers get a second vote
    "extractor_secondary": (_PAPERS, 1200, 700),     # dual extraction
    "normalizer": (1, 6000, 2000),
    "conflict_explainer": (4, 6000, 600),
    "localizer": (8, 1500, 2000),               # small chunks, run in parallel
    "escalation": (4, 3000, 1000),              # expected ~10-20% of steps
    "enricher": (1, 3000, 400),                 # only when external MCP servers are configured
}


def estimate_review_cost(resolved: ResolvedLLMConfig, catalog: dict[str, ModelInfo]) -> dict[str, Any]:
    """Rough USD cost of one default review with this preset (a role's own price, Plan 23e, else OpenRouter's);
    models neither prices (other providers without a price, typos) are listed instead of priced."""
    per_role: dict[str, float] = {}
    unknown: list[str] = []
    total = 0.0
    for name, role in resolved.roles.items():
        calls, tokens_in, tokens_out = TYPICAL_CALLS.get(name, (0, 0, 0))
        info = role_price(role) or (catalog.get(role.spec.model) if role.kind == "openrouter" else None)
        if info is None:
            unknown.append(f"{name}: {role.provider}:{role.spec.model}")
            continue
        cost = calls * info.cost(tokens_in, tokens_out)
        per_role[name] = round(cost, 6)
        total += cost
    return {"total_usd": round(total, 4), "per_role": per_role, "unknown_models": unknown}
