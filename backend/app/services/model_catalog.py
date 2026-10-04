"""OpenRouter model catalog: prices, context windows and supported parameters."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.services.http import HttpClient
from app.services.llm_config import ResolvedRole

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"


@dataclass(frozen=True)
class ModelInfo:
    id: str
    context_length: int | None
    price_in: float  # USD per input token
    price_out: float  # USD per output token
    supported_parameters: frozenset[str]

    def supports(self, parameter: str) -> bool:
        return parameter in self.supported_parameters

    def cost(self, input_tokens: int, output_tokens: int) -> float:
        return input_tokens * self.price_in + output_tokens * self.price_out


def _price(value: Any) -> float:
    try:
        return max(float(value), 0.0)
    except (TypeError, ValueError):
        return 0.0


def parse_models(data: dict[str, Any]) -> dict[str, ModelInfo]:
    out: dict[str, ModelInfo] = {}
    for m in data.get("data", []):
        pricing = m.get("pricing") or {}
        out[m["id"]] = ModelInfo(
            id=m["id"], context_length=m.get("context_length"),
            price_in=_price(pricing.get("prompt")), price_out=_price(pricing.get("completion")),
            supported_parameters=frozenset(m.get("supported_parameters") or []),
        )
    return out


class OpenRouterCatalog:
    def __init__(self, http: HttpClient, url: str = OPENROUTER_MODELS_URL) -> None:
        self.http = http
        self.url = url

    async def load(self) -> dict[str, ModelInfo]:
        resp = await self.http.get(self.url)
        resp.raise_for_status()
        return parse_models(resp.json())


def choose_structured_method(configured: str, info: ModelInfo | None) -> str:
    """Map llm.yaml's structured_output to a langchain method: json_schema | function_calling | json_mode."""
    if configured == "tool_calling":
        return "function_calling"
    if configured in ("json_schema", "json_mode"):
        return configured
    if info is None:
        return "json_schema"
    if info.supports("structured_outputs"):
        return "json_schema"
    if info.supports("tools"):
        return "function_calling"
    return "json_mode"


def validate_role(role: ResolvedRole, catalog: dict[str, ModelInfo]) -> list[str]:
    """Problems with one role's settings against the OpenRouter catalog (OpenRouter roles only)."""
    if role.provider != "openrouter":
        return []
    spec = role.spec
    info = catalog.get(spec.model)
    if info is None:
        return [f"{role.role}: model '{spec.model}' not found on OpenRouter"]
    problems: list[str] = []
    if spec.reasoning_effort not in (None, "none") and not info.supports("reasoning"):
        problems.append(f"{role.role}: '{spec.model}' does not support reasoning (remove reasoning_effort)")
    if spec.structured_output == "json_schema" and not info.supports("structured_outputs"):
        problems.append(f"{role.role}: '{spec.model}' does not support structured_outputs (use auto)")
    if spec.structured_output == "tool_calling" and not info.supports("tools"):
        problems.append(f"{role.role}: '{spec.model}' does not support tools (use auto)")
    if info.context_length and spec.max_tokens > info.context_length:
        problems.append(f"{role.role}: max_tokens {spec.max_tokens} exceeds the model context {info.context_length}")
    for fallback in spec.fallback_models:
        if fallback not in catalog:
            problems.append(f"{role.role}: fallback model '{fallback}' not found on OpenRouter")
    return problems
