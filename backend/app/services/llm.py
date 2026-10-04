"""Structured LLM calls behind one interface, for every provider configured in config/llm.yaml.

- openrouter / openai_compatible → langchain-openai ChatOpenAI (OpenAI chat-completions API)
- anthropic                      → langchain-anthropic ChatAnthropic (json_schema output_config)
Every call returns an LLMResult (parsed value + cost) or raises an LLMError subclass."""
from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, ClassVar, Protocol

import anthropic
import openai
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, ValidationError

from app.config import Settings
from app.graph.schemas import (
    ConflictNote,
    OutcomeClusters,
    PaperCard,
    QueryPlan,
    QuestionCritique,
    ReviewQuestion,
    ScreenBatch,
    SynthesisNarrative,
    ToolPlan,
    TopicVerdict,
    TranslationBatch,
)
from app.services.llm_config import HarnessSpec, ResolvedRole, load_llm_config
from app.services.model_catalog import ModelInfo, choose_structured_method

# USD per million tokens (input, output) for direct Anthropic calls. Source: claude-api skill, 2026-09.
PRICES_PER_MTOK: dict[str, tuple[float, float]] = {
    "claude-fable-5-1": (10.0, 50.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-haiku-4-5": (1.0, 5.0),
}
SCHEMAS: dict[str, type[BaseModel]] = {
    "guard": TopicVerdict, "planner": QueryPlan, "screener": ScreenBatch, "extractor": PaperCard,
    "synthesizer": SynthesisNarrative, "normalizer": OutcomeClusters, "conflict_explainer": ConflictNote,
    "localizer": TranslationBatch, "screener_secondary": ScreenBatch, "extractor_secondary": PaperCard,
    "refiner": ReviewQuestion, "enricher": ToolPlan,
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
        try:
            out = await self._runnable.ainvoke([SystemMessage(system), HumanMessage(user)])
        except anthropic.APIError as exc:
            raise LLMError(f"{self.model}: provider error: {exc}") from exc
        raw = out["raw"]
        stop = (raw.response_metadata or {}).get("stop_reason")
        if stop == "refusal":
            raise LLMRefusal(f"{self.model} declined the request")
        if out.get("parsing_error") is not None or out.get("parsed") is None:
            raise LLMOutputError(
                f"{self.model} returned unparseable output (stop_reason={stop}): {out.get('parsing_error')}"
            )
        usage = raw.usage_metadata or {}
        in_tok, out_tok = int(usage.get("input_tokens", 0)), int(usage.get("output_tokens", 0))
        return LLMResult(
            value=out["parsed"], cost_usd=estimate_cost(self.model, in_tok, out_tok),
            model=self.model, input_tokens=in_tok, output_tokens=out_tok,
        )


class OpenAICompatibleStructuredLLM[T: BaseModel]:
    """OpenRouter or any OpenAI-compatible endpoint. method: json_schema | tool_calling | json_mode."""

    METHODS: ClassVar[dict[str, str]] = {
        "json_schema": "json_schema", "tool_calling": "function_calling",
        "function_calling": "function_calling", "json_mode": "json_mode",
    }

    def __init__(
        self,
        schema: type[T],
        *,
        model: str,
        api_key: str,
        base_url: str,
        max_tokens: int,
        temperature: float | None = None,
        top_p: float | None = None,
        reasoning_effort: str | None = None,
        method: str = "json_schema",
        timeout: float = 300.0,
        max_retries: int = 2,
        headers: dict[str, str] | None = None,
        require_parameters: bool = False,
        fallback_models: list[str] | tuple[str, ...] = (),
        extra_body: dict[str, Any] | None = None,
        price: ModelInfo | None = None,
    ) -> None:
        self.model = model
        self.schema = schema
        self.max_tokens = max_tokens
        self.reasoning_effort = reasoning_effort
        self.method = "tool_calling" if method == "function_calling" else method
        self.price = price
        body: dict[str, Any] = dict(extra_body or {})
        if reasoning_effort:
            body["reasoning"] = {**body.get("reasoning", {}), "effort": reasoning_effort}
        if require_parameters:
            body["provider"] = {**body.get("provider", {}), "require_parameters": True}
        if fallback_models:
            body["models"] = [model, *fallback_models]
        kwargs: dict[str, Any] = {
            "model": model, "api_key": api_key, "base_url": base_url, "max_tokens": max_tokens,
            "timeout": timeout, "max_retries": max_retries,
        }
        if temperature is not None:
            kwargs["temperature"] = temperature
        if top_p is not None:
            kwargs["top_p"] = top_p
        if headers:
            kwargs["default_headers"] = headers
        if body:
            kwargs["extra_body"] = body
        lc_method = self.METHODS[method]
        extra = {"strict": True} if lc_method in ("json_schema", "function_calling") else {}
        self._runnable = ChatOpenAI(**kwargs).with_structured_output(
            schema, method=lc_method, include_raw=True, **extra
        )
        self._json_hint = (
            "\n\nRespond with only a JSON object that conforms to this JSON schema:\n"
            + json.dumps(schema.model_json_schema(), ensure_ascii=False)
            if lc_method == "json_mode" else ""
        )

    async def ainvoke(self, system: str, user: str) -> LLMResult[T]:
        try:
            hint = self._json_hint
            if not hint and "json" not in (system + user).lower():
                # Alibaba (Qwen) rejects response_format unless the messages mention JSON; harmless elsewhere.
                hint = "\n\nReturn the answer as JSON."
            out = await self._runnable.ainvoke([SystemMessage(system + hint), HumanMessage(user)])
        except (ValidationError, json.JSONDecodeError) as exc:
            raise LLMOutputError(f"{self.model} returned output that does not match the schema: {exc}") from exc
        except openai.ContentFilterFinishReasonError as exc:
            raise LLMRefusal(f"{self.model} declined the request (content filter)") from exc
        except openai.LengthFinishReasonError as exc:
            raise LLMOutputError(f"{self.model} hit max_tokens before finishing the JSON output") from exc
        except openai.APIError as exc:
            status = getattr(exc, "status_code", "")
            raise LLMError(f"{self.model}: provider error {status}: {exc}") from exc
        raw = out["raw"]
        meta = raw.response_metadata or {}
        if (raw.additional_kwargs or {}).get("refusal") or meta.get("finish_reason") == "content_filter":
            raise LLMRefusal(f"{self.model} declined the request")
        error = out.get("parsing_error")
        if error is not None or out.get("parsed") is None:
            if type(error).__name__ == "OpenAIRefusalError":
                raise LLMRefusal(f"{self.model} declined the request")
            raise LLMOutputError(f"{self.model} returned unparseable output: {error}")
        usage = meta.get("token_usage") or {}
        in_tok = int(usage.get("prompt_tokens") or (raw.usage_metadata or {}).get("input_tokens", 0))
        out_tok = int(usage.get("completion_tokens") or (raw.usage_metadata or {}).get("output_tokens", 0))
        cost = usage.get("cost")
        if cost is None:
            cost = self.price.cost(in_tok, out_tok) if self.price else 0.0
        return LLMResult(value=out["parsed"], cost_usd=float(cost), model=self.model,
                         input_tokens=in_tok, output_tokens=out_tok)


class MissingKeyLLM:
    effort = None
    reasoning_effort = None
    max_tokens = 0
    method = None

    def __init__(self, model: str, env_name: str = "ANTHROPIC_API_KEY") -> None:
        self.model = model
        self.env_name = env_name

    async def ainvoke(self, system: str, user: str) -> LLMResult:
        raise LLMError(f"{self.env_name} is not configured on the worker (needed for model {self.model})")


class LimitedLLM:
    """Runs the wrapped model's calls under a semaphore shared by every role of one worker process, so a
    review's fan-out (30 papers x 2 extractors, parallel localization) stays under provider rate limits."""

    def __init__(self, inner: StructuredLLM, sem: asyncio.Semaphore) -> None:
        self.inner = inner
        self.sem = sem

    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)

    async def ainvoke(self, system: str, user: str) -> LLMResult:
        async with self.sem:
            return await self.inner.ainvoke(system, user)


@dataclass
class LLMs:
    guard: StructuredLLM
    planner: StructuredLLM
    screener: StructuredLLM
    extractor: StructuredLLM
    synthesizer: StructuredLLM
    # Harness roles (None → that harness step falls back to a deterministic path or is skipped).
    normalizer: StructuredLLM | None = None
    conflict_explainer: StructuredLLM | None = None
    localizer: StructuredLLM | None = None
    screener_secondary: StructuredLLM | None = None
    extractor_secondary: StructuredLLM | None = None
    refiner: StructuredLLM | None = None
    enricher: StructuredLLM | None = None  # plans external MCP tool calls (falls back to planner settings)
    refiner_critic: StructuredLLM | None = None  # same model as refiner, QuestionCritique schema, effort ≤ low
    # escalation(schema) → a bigger model bound to that output schema, or None when not configured
    escalation: Callable[[type[BaseModel]], StructuredLLM | None] | None = None
    harness: HarnessSpec = field(default_factory=HarnessSpec)
    preset: str = ""
    models: dict[str, str] = field(default_factory=dict)


def _api_key(settings: Settings, env_name: str) -> str:
    return str(getattr(settings, env_name.lower(), "") or os.environ.get(env_name, ""))


def build_role_llm(role: ResolvedRole, settings: Settings, catalog: dict[str, ModelInfo] | None = None,
                   schema: type[BaseModel] | None = None):
    schema = schema or SCHEMAS[role.role]
    spec, ps = role.spec, role.provider_spec
    key = _api_key(settings, ps.api_key_env)
    effort = None if spec.reasoning_effort in (None, "none") else spec.reasoning_effort
    if role.provider == "anthropic":
        if not key:
            return MissingKeyLLM(spec.model, ps.api_key_env)
        return AnthropicStructuredLLM(schema, model=spec.model, api_key=key, max_tokens=spec.max_tokens,
                                      effort=effort, base_url=ps.base_url, timeout=spec.timeout_seconds)
    if not key and role.provider == "openrouter":
        return MissingKeyLLM(spec.model, ps.api_key_env)
    info = (catalog or {}).get(spec.model) if role.provider == "openrouter" else None
    headers = {}
    if role.provider == "openrouter":
        headers = {k: v for k, v in (("HTTP-Referer", ps.app_url), ("X-Title", ps.app_name)) if v}
    return OpenAICompatibleStructuredLLM(
        schema, model=spec.model, api_key=key or "not-needed", base_url=ps.base_url or "",
        max_tokens=spec.max_tokens, temperature=spec.temperature, top_p=spec.top_p, reasoning_effort=effort,
        method=choose_structured_method(spec.structured_output, info), timeout=spec.timeout_seconds,
        headers=headers or None, require_parameters=ps.require_parameters and role.provider == "openrouter",
        fallback_models=spec.fallback_models, extra_body=spec.extra_body, price=info,
    )


def build_llms(settings: Settings, catalog: dict[str, ModelInfo] | None = None) -> LLMs:
    config = load_llm_config(settings.llm_config_path, settings.llm_preset)
    sem = asyncio.Semaphore(max(1, settings.llm_concurrency))
    built = {role: LimitedLLM(build_role_llm(r, settings, catalog), sem) for role, r in config.roles.items()
             if role in SCHEMAS}
    if "refiner" in config.roles:
        refiner_role = config.roles["refiner"]
        if refiner_role.spec.reasoning_effort not in (None, "none", "minimal", "low"):
            refiner_role = refiner_role.with_spec(reasoning_effort="low")
        built["refiner_critic"] = LimitedLLM(
            build_role_llm(refiner_role, settings, catalog, schema=QuestionCritique), sem)
    escalation = None
    if "escalation" in config.roles:
        esc_role = config.roles["escalation"]
        cache: dict[type[BaseModel], StructuredLLM] = {}

        def escalation(schema: type[BaseModel]) -> StructuredLLM:
            if schema not in cache:
                cache[schema] = LimitedLLM(build_role_llm(esc_role, settings, catalog, schema=schema), sem)
            return cache[schema]

    return LLMs(**built, escalation=escalation, harness=config.harness, preset=config.preset,
                models=config.describe())
