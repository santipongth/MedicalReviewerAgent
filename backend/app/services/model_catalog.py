"""OpenRouter model catalog: prices, context windows and supported parameters."""
from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from app.logging import get_logger
from app.services.http import HttpClient
from app.services.llm_config import ResolvedRole

log = get_logger(__name__)
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"
CATALOG_KEY = "mra:llm:catalog"
CATALOG_TTL_SECONDS = 3600


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


async def load_live_catalog() -> dict[str, ModelInfo]:
    http = HttpClient(timeout=30)
    try:
        return await OpenRouterCatalog(http).load()
    finally:
        await http.aclose()


def _to_json(catalog: dict[str, ModelInfo]) -> str:
    return json.dumps([{"id": m.id, "context_length": m.context_length, "price_in": m.price_in,
                        "price_out": m.price_out, "supported_parameters": sorted(m.supported_parameters)}
                       for m in catalog.values()])


def _from_json(text: str) -> dict[str, ModelInfo]:
    return {m["id"]: ModelInfo(id=m["id"], context_length=m["context_length"], price_in=m["price_in"],
                               price_out=m["price_out"], supported_parameters=frozenset(m["supported_parameters"]))
            for m in json.loads(text)}


async def cached_catalog(redis, load: Callable[[], Awaitable[dict[str, ModelInfo]]] = load_live_catalog
                         ) -> dict[str, ModelInfo] | None:
    """The OpenRouter catalog, cached in Redis for an hour; None when it cannot be fetched (checks are then skipped)."""
    try:
        cached = await redis.get(CATALOG_KEY)
    except Exception:  # noqa: BLE001
        cached = None
    if cached:
        return _from_json(cached)
    try:
        catalog = await load()
    except Exception as exc:  # noqa: BLE001 - an offline catalog only skips the checks
        log.warning("openrouter_catalog_unavailable", error=str(exc))
        return None
    try:
        await redis.set(CATALOG_KEY, _to_json(catalog), ex=CATALOG_TTL_SECONDS)
    except Exception as exc:  # noqa: BLE001 - an uncached catalog is only fetched again next time
        log.warning("openrouter_catalog_cache_failed", error=str(exc))
    return catalog


def catalog_rows(catalog: dict[str, ModelInfo], *, q: str | None = None, structured: bool = False,
                 reasoning: bool = False, max_price: float | None = None, limit: int = 100) -> list[dict]:
    """Catalog entries for the console, cheapest first; max_price is the input price in USD per 1M tokens."""
    rows = sorted(catalog.values(), key=lambda m: (m.price_in, m.id))
    if q:
        rows = [m for m in rows if q.lower() in m.id.lower()]
    if structured:
        rows = [m for m in rows if m.supports("structured_outputs")]
    if reasoning:
        rows = [m for m in rows if m.supports("reasoning")]
    if max_price is not None:
        rows = [m for m in rows if m.price_in * 1_000_000 <= max_price]
    return [{"id": m.id, "context_length": m.context_length, "price_in_per_m": round(m.price_in * 1_000_000, 6),
             "price_out_per_m": round(m.price_out * 1_000_000, 6), "structured": m.supports("structured_outputs"),
             "tools": m.supports("tools"), "reasoning": m.supports("reasoning")} for m in rows[:limit]]


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
