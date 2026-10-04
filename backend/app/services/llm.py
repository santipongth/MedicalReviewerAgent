from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel

from app.config import Settings
from app.graph.schemas import PaperCard, QueryPlan, ScreenBatch, Synthesis, TopicVerdict

# USD per million tokens (input, output). Source: claude-api skill model table, 2026-09.
PRICES_PER_MTOK: dict[str, tuple[float, float]] = {
    "claude-fable-5-1": (10.0, 50.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-haiku-4-5": (1.0, 5.0),
}


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    price_in, price_out = PRICES_PER_MTOK.get(model, (0.0, 0.0))
    return (input_tokens * price_in + output_tokens * price_out) / 1_000_000


class LLMError(Exception):
    pass


class LLMRefusal(LLMError):
    pass


class LLMOutputError(LLMError):
    pass


@dataclass
class LLMResult[T: BaseModel]:
    value: T
    cost_usd: float
    model: str
    input_tokens: int
    output_tokens: int


class StructuredLLM(Protocol):
    model: str

    async def ainvoke(self, system: str, user: str) -> LLMResult: ...


class AnthropicStructuredLLM[T: BaseModel]:
    def __init__(
        self,
        schema: type[T],
        *,
        model: str,
        api_key: str,
        max_tokens: int,
        effort: str | None = None,
        base_url: str | None = None,
        timeout: float = 300.0,
        max_retries: int = 2,
    ) -> None:
        self.model = model
        self.effort = effort
        self.max_tokens = max_tokens
        kwargs: dict[str, Any] = {
            "model": model, "api_key": api_key, "max_tokens": max_tokens,
            "timeout": timeout, "max_retries": max_retries,
        }
        if effort:
            kwargs["effort"] = effort
        if base_url:
            kwargs["base_url"] = base_url
        self._runnable = ChatAnthropic(**kwargs).with_structured_output(
            schema, method="json_schema", include_raw=True
        )

    async def ainvoke(self, system: str, user: str) -> LLMResult[T]:
        out = await self._runnable.ainvoke([SystemMessage(system), HumanMessage(user)])
        raw = out["raw"]
        stop = (raw.response_metadata or {}).get("stop_reason")
        if stop == "refusal":
            raise LLMRefusal(f"{self.model} declined the request")
        if out.get("parsing_error") is not None or out.get("parsed") is None:
            raise LLMOutputError(f"{self.model} returned unparseable output (stop_reason={stop}): {out.get('parsing_error')}")
        usage = raw.usage_metadata or {}
        in_tok, out_tok = int(usage.get("input_tokens", 0)), int(usage.get("output_tokens", 0))
        return LLMResult(
            value=out["parsed"], cost_usd=estimate_cost(self.model, in_tok, out_tok),
            model=self.model, input_tokens=in_tok, output_tokens=out_tok,
        )


class MissingKeyLLM:
    effort = None
    max_tokens = 0

    def __init__(self, model: str) -> None:
        self.model = model

    async def ainvoke(self, system: str, user: str) -> LLMResult:
        raise LLMError("ANTHROPIC_API_KEY is not configured on the worker")


@dataclass
class LLMs:
    guard: StructuredLLM
    planner: StructuredLLM
    screener: StructuredLLM
    extractor: StructuredLLM
    synthesizer: StructuredLLM


def build_llms(settings: Settings) -> LLMs:
    def make(schema, model, max_tokens, effort=None, timeout=300.0):
        if not settings.anthropic_api_key:
            return MissingKeyLLM(model)
        return AnthropicStructuredLLM(
            schema, model=model, api_key=settings.anthropic_api_key, max_tokens=max_tokens,
            effort=effort, base_url=settings.anthropic_base_url, timeout=timeout,
        )

    return LLMs(
        guard=make(TopicVerdict, settings.guard_model, 1024),
        planner=make(QueryPlan, settings.planner_model, 4096, settings.planner_effort),
        screener=make(ScreenBatch, settings.screen_model, 4096),
        extractor=make(PaperCard, settings.extract_model, 8192, settings.extract_effort),
        synthesizer=make(Synthesis, settings.synthesize_model, 20000, settings.synthesize_effort, 600.0),
    )
