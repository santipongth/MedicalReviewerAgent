"""Structured LLM calls behind one interface, for every provider configured in config/llm.yaml.

- openrouter / openai_compatible → langchain-openai ChatOpenAI (OpenAI chat-completions API)
- anthropic                      → langchain-anthropic ChatAnthropic (json_schema output_config)
Every call returns an LLMResult (parsed value + cost) or raises an LLMError subclass. Plan 23e: a provider's key comes
from resolve_key (a console key bound to the provider's origin, else env); a provider error's text is redacted with the
key before it leaves this module."""
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
from app.services.budget import current_budget
from app.services.llm_config import (
    HarnessSpec,
    ResolvedLLMConfig,
    ResolvedRole,
    is_local_origin,
    key_env,
    load_llm_config,
    provider_origin,
)
from app.services.llm_keys import KeyChoice, KeyRing, resolve_key
from app.services.model_catalog import FixedPrice, ModelInfo, choose_structured_method, role_price

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


REDACTED = "[redacted]"
REDACT_MIN = 12  # any slice of the key this long or longer is redacted


def estimate_cost(model: str, input_tokens: int, output_tokens: int, price: FixedPrice | None = None) -> float:
    """A direct Anthropic call's cost: the role's own price (Plan 23e), else PRICES_PER_MTOK, else 0."""
    if price is not None:
        return price.cost(input_tokens, output_tokens)
    price_in, price_out = PRICES_PER_MTOK.get(model, (0.0, 0.0))
    return (input_tokens * price_in + output_tokens * price_out) / 1_000_000


def redact(text: str, key: str | None) -> str:
    """text with the key, and every slice of it of REDACT_MIN or more characters, replaced by [redacted] (Plan 23e): a
    provider may echo the Authorization header, whole or cut, in its error text."""
    if not key or not text:
        return text
    if len(key) < REDACT_MIN:
        return text.replace(key, REDACTED)
    grams = {key[i:i + REDACT_MIN] for i in range(len(key) - REDACT_MIN + 1)}
    covered = [False] * len(text)
    for i in range(len(text) - REDACT_MIN + 1):
        if text[i:i + REDACT_MIN] in grams:
            covered[i:i + REDACT_MIN] = [True] * REDACT_MIN
    out: list[str] = []
    i = 0
    while i < len(text):
        if covered[i]:
            while i < len(text) and covered[i]:
                i += 1
            out.append(REDACTED)
        else:
            out.append(text[i])
            i += 1
    return "".join(out)


class LLMError(Exception):
    pass


class LLMNotConfigured(LLMError):
    """The role has no usable key or price. Its text names providers and hosts, so it is for logs and the admin
    console only; anything a visitor can read uses public_reason (Plan 31)."""


NOT_CONFIGURED_ERROR = (
    "LLMNotConfigured: the service's model provider is not set up; an administrator must fix the model settings"
)


def public_reason(exc: BaseException) -> str:
    """The text of a failure that may leave the worker (review error, event, result note)."""
    if isinstance(exc, LLMNotConfigured):
        return NOT_CONFIGURED_ERROR
    return f"{type(exc).__name__}: {exc}"


class LLMRefusal(LLMError):
    pass


class LLMOutputError(LLMError):
    pass


class BudgetExceeded(LLMError):
    """The review's cost cap is spent: the step is skipped like any failed LLM step."""


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
        price: FixedPrice | None = None,
    ) -> None:
        self.model = model
        self.effort = effort
        self.max_tokens = max_tokens
        self.price = price
        self._key = api_key  # kept only to redact provider errors
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
        failed = None
        try:
            out = await self._runnable.ainvoke([SystemMessage(system), HumanMessage(user)])
        except anthropic.APIError as exc:
            failed = redact(f"{self.model}: provider error: {exc}", self._key)
        if failed is not None:  # raised outside the except: the unredacted error is neither cause nor context
            raise LLMError(failed)
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
            value=out["parsed"], cost_usd=estimate_cost(self.model, in_tok, out_tok, self.price),
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
        price: ModelInfo | FixedPrice | None = None,
        reported_cost: bool = True,
        effort_field: str = "reasoning",
        follow_redirects: bool = True,
    ) -> None:
        """`price` charges a call whose cost the provider does not report, or (reported_cost=False, Plan 23e: any
        server that is not OpenRouter) every call. `effort_field` "reasoning" sends OpenRouter's reasoning object;
        "reasoning_effort" sends OpenAI's top-level field."""
        self.model = model
        self.schema = schema
        self.max_tokens = max_tokens
        self.reasoning_effort = reasoning_effort
        self.method = "tool_calling" if method == "function_calling" else method
        self.price = price
        self.reported_cost = reported_cost
        self.follow_redirects = follow_redirects
        self._key = api_key  # kept only to redact provider errors
        body: dict[str, Any] = dict(extra_body or {})
        if reasoning_effort and effort_field == "reasoning":
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
        if reasoning_effort and effort_field == "reasoning_effort":
            kwargs["reasoning_effort"] = reasoning_effort
        if headers:
            kwargs["default_headers"] = headers
        if body:
            kwargs["extra_body"] = body
        if not follow_redirects:  # the key travels in a header: a server must not forward it elsewhere
            kwargs["http_async_client"] = openai.DefaultAsyncHttpxClient(follow_redirects=False)
        lc_method = self.METHODS[method]
        extra = {"strict": True} if lc_method in ("json_schema", "function_calling") else {}
        self._runnable = ChatOpenAI(**kwargs).with_structured_output(
            schema, method=lc_method, include_raw=True, **extra
        )
        # Always spell the schema out in the prompt, whatever the method: some providers (Alibaba/Qwen) accept
        # response_format without enforcing it and reject it unless the prompt mentions JSON. Measured 2026-10-05 on
        # Qwen3.5 Flash: 0/5 valid answers without this hint, 5/5 with it.
        self._json_hint = (
            "\n\nRespond with only a JSON object that conforms to this JSON schema:\n"
            + json.dumps(schema.model_json_schema(), ensure_ascii=False)
        )

    async def ainvoke(self, system: str, user: str) -> LLMResult[T]:
        failed = None
        try:
            out = await self._runnable.ainvoke([SystemMessage(system + self._json_hint), HumanMessage(user)])
        except (ValidationError, json.JSONDecodeError) as exc:
            raise LLMOutputError(f"{self.model} returned output that does not match the schema: {exc}") from exc
        except openai.ContentFilterFinishReasonError as exc:
            raise LLMRefusal(f"{self.model} declined the request (content filter)") from exc
        except openai.LengthFinishReasonError as exc:
            raise LLMOutputError(f"{self.model} hit max_tokens before finishing the JSON output") from exc
        except openai.APIError as exc:
            status = getattr(exc, "status_code", "")
            failed = redact(f"{self.model}: provider error {status}: {exc}", self._key)
        if failed is not None:  # raised outside the except: the unredacted error is neither cause nor context
            raise LLMError(failed)
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
        cost = usage.get("cost") if self.reported_cost else None  # an arbitrary server's own figure is not trusted
        if cost is None:
            cost = self.price.cost(in_tok, out_tok) if self.price else 0.0
        return LLMResult(value=out["parsed"], cost_usd=float(cost), model=self.model,
                         input_tokens=in_tok, output_tokens=out_tok)


class MissingKeyLLM:
    effort = None
    reasoning_effort = None
    max_tokens = 0
    method = None

    def __init__(self, model: str, env_name: str = "ANTHROPIC_API_KEY", reason: str | None = None) -> None:
        self.model = model
        self.env_name = env_name
        self.reason = reason

    async def ainvoke(self, system: str, user: str) -> LLMResult:
        raise LLMNotConfigured(self.reason or f"{self.env_name} is not configured on the worker (needed for model {self.model})")


class LimitedLLM:
    """Runs the wrapped model's calls under a semaphore shared by every role of one worker process, so a
    review's fan-out (up to 50 papers x 2 extractors, parallel localization) stays under provider rate limits."""

    def __init__(self, inner: StructuredLLM, sem: asyncio.Semaphore) -> None:
        self.inner = inner
        self.sem = sem

    def __getattr__(self, name: str) -> Any:
        return getattr(self.inner, name)

    async def ainvoke(self, system: str, user: str) -> LLMResult:
        budget = current_budget()
        if budget is not None and budget.exhausted:
            raise BudgetExceeded(f"cost cap of ${budget.cap_usd:.2f} per review reached; step skipped")
        async with self.sem:
            # Re-check after the wait: calls queued on the semaphore must not start once an earlier call has
            # spent the cap. Only calls already in flight (at most the semaphore size) can still run past it.
            if budget is not None and budget.exhausted:
                raise BudgetExceeded(f"cost cap of ${budget.cap_usd:.2f} per review reached; step skipped")
            res = await self.inner.ainvoke(system, user)
        if budget is not None:
            budget.charge(res.cost_usd)
        return res


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
    # for_schema(role, schema) → that role's model bound to another output schema (the eval harness's own calls)
    for_schema: Callable[[str, type[BaseModel]], StructuredLLM] | None = None
    harness: HarnessSpec = field(default_factory=HarnessSpec)
    preset: str = ""
    models: dict[str, str] = field(default_factory=dict)
    config_version: str = ""

    def with_schema(self, role: str, schema: type[BaseModel]) -> StructuredLLM:
        """A role LLM is built for one schema (SCHEMAS): passing `planner` to a call that wants another schema only
        ever returns a QueryPlan. Never falls back to the role's own LLM."""
        if self.for_schema is None:
            raise LLMError(f"no schema factory: cannot bind {role} to {schema.__name__}")
        return self.for_schema(role, schema)


OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


def _api_key(settings: Settings, env_name: str) -> str:
    return str(getattr(settings, env_name.lower(), "") or os.environ.get(env_name, ""))


def missing_key_reason(role: ResolvedRole, choice: KeyChoice) -> str | None:
    """Why a provider has no key (Plan 23e), naming the provider and the problem; None for the plain "variable not
    set" of a legacy name, whose message stays as before."""
    name, env_name, origin = role.provider, key_env(role.provider), provider_origin(role.provider, role.provider_spec)
    if choice.problem == "origin_mismatch":
        return f"no key for provider {name} (the stored key belongs to {choice.bound_origin}; enter one for {origin})"
    if choice.problem == "unreadable":
        return (f"no key for provider {name} (the stored key cannot be read: LLM_KEYS_SECRET is missing or changed; "
                "enter the key again)")
    if choice.problem == "env_origin_missing":
        return f"no key for provider {name} ({env_name} is set, but {env_name}_ORIGIN is not {origin})"
    if role.provider != role.kind and role.provider != "openai_compatible":
        return f"no key for provider {name}: enter one in the admin console, or set {env_name} and {env_name}_ORIGIN"
    return None


def unpriced_reason(role: ResolvedRole) -> str | None:
    """Why a review must not call this role: a provider with a free name on a public host and no price would be
    charged $0, so the per-review cost cap would never count it. Save and validate refuse such a document; this stops
    a hand-edited llm.yaml too. A local server (price 0 is right) and the legacy names keep their old behaviour."""
    if role.provider in (role.kind, "openai_compatible") or role_price(role) is not None:
        return None
    if is_local_origin(provider_origin(role.provider, role.provider_spec)):
        return None
    return (f"no price for model {role.spec.model} on provider {role.provider}: set price_in and price_out "
            "(USD per 1M tokens) in the admin console so the cost cap counts its calls")


def build_role_llm(role: ResolvedRole, settings: Settings, catalog: dict[str, ModelInfo] | None = None,
                   schema: type[BaseModel] | None = None, keys: KeyRing | None = None):
    """`keys` is the console's key ring (Plan 23e); None means env keys only (tests, CLIs without a DB)."""
    schema = schema or SCHEMAS[role.role]
    spec, ps = role.spec, role.provider_spec
    env_name = key_env(role.provider)
    choice = resolve_key(role.provider, ps, keys, settings)
    key = choice.value or ""
    effort = None if spec.reasoning_effort in (None, "none") else spec.reasoning_effort
    if role.kind == "anthropic":
        if not key:
            return MissingKeyLLM(spec.model, env_name, missing_key_reason(role, choice))
        return AnthropicStructuredLLM(schema, model=spec.model, api_key=key, max_tokens=spec.max_tokens,
                                      effort=effort, base_url=ps.base_url, timeout=spec.timeout_seconds,
                                      price=role_price(role))
    if not key and role.kind == "openrouter":
        return MissingKeyLLM(spec.model, env_name, missing_key_reason(role, choice))
    if not key and role.provider != "openai_compatible" and not is_local_origin(provider_origin(role.provider, ps)):
        # a free name on a public host: never an anonymous call (the legacy local server keeps "not-needed")
        return MissingKeyLLM(spec.model, env_name, missing_key_reason(role, choice))
    openrouter = role.kind == "openrouter"
    info = (catalog or {}).get(spec.model) if openrouter else None
    if spec.reasoning_effort == "none" and role.kind == "openrouter" and (info is None or info.supports("reasoning")):
        # Some models reason by default (Qwen3.5 Flash on Alibaba) and then break structured output; an explicit
        # "none" turns that off. Never sent to models without reasoning support (require_parameters would 404).
        effort = "none"
    base_url = ps.base_url or (OPENROUTER_BASE_URL if role.kind == "openrouter" else "")
    headers = {}
    if role.kind == "openrouter":
        headers = {k: v for k, v in (("HTTP-Referer", ps.app_url), ("X-Title", ps.app_name)) if v}
    return OpenAICompatibleStructuredLLM(
        schema, model=spec.model, api_key=key or "not-needed", base_url=base_url,
        max_tokens=spec.max_tokens, temperature=spec.temperature, top_p=spec.top_p, reasoning_effort=effort,
        method=choose_structured_method(spec.structured_output, info), timeout=spec.timeout_seconds,
        headers=headers or None, require_parameters=ps.require_parameters and openrouter,
        # fallback models are OpenRouter's `models` field: another server would refuse the request
        fallback_models=spec.fallback_models if openrouter else (), extra_body=spec.extra_body,
        # OpenRouter: its reported cost, else the catalog, else the role's price; any other server: the role's price
        price=(info or role_price(role)) if openrouter else role_price(role), reported_cost=openrouter,
        effort_field="reasoning" if openrouter else "reasoning_effort",
        follow_redirects=openrouter,
    )


def build_llms(settings: Settings, catalog: dict[str, ModelInfo] | None = None, *,
               resolved: ResolvedLLMConfig | None = None, sem: asyncio.Semaphore | None = None,
               config_version: str = "file", keys: KeyRing | None = None) -> LLMs:
    """`resolved` defaults to config/llm.yaml. `sem` is the semaphore every role (and escalation) shares: a reload
    passes the worker's current one (Plan 23b), and an llm_concurrency change passes a new one for the reviews that
    start afterwards (Plan 23c); without it a new semaphore of settings.llm_concurrency is made. `keys` is the console's
    key ring (Plan 23e); None means env keys only."""
    config = resolved or load_llm_config(settings.llm_config_path, settings.llm_preset)
    sem = sem or asyncio.Semaphore(max(1, settings.llm_concurrency))

    def build(r: ResolvedRole, schema: type[BaseModel] | None = None):
        reason = unpriced_reason(r)
        if reason:
            return MissingKeyLLM(r.spec.model, key_env(r.provider), reason)
        return build_role_llm(r, settings, catalog, schema=schema, keys=keys)

    built = {role: LimitedLLM(build(r), sem) for role, r in config.roles.items() if role in SCHEMAS}
    if "refiner" in config.roles:
        refiner_role = config.roles["refiner"]
        if refiner_role.spec.reasoning_effort not in (None, "none", "minimal", "low"):
            refiner_role = refiner_role.with_spec(reasoning_effort="low")
        built["refiner_critic"] = LimitedLLM(build(refiner_role, QuestionCritique), sem)
    escalation = None
    if "escalation" in config.roles:
        esc_role = config.roles["escalation"]
        cache: dict[type[BaseModel], StructuredLLM] = {}

        def escalation(schema: type[BaseModel]) -> StructuredLLM:
            if schema not in cache:
                cache[schema] = LimitedLLM(build(esc_role, schema), sem)
            return cache[schema]

    bound: dict[tuple[str, type[BaseModel]], StructuredLLM] = {}

    def for_schema(role: str, schema: type[BaseModel]) -> StructuredLLM:
        if role not in config.roles:
            raise LLMError(f"preset {config.preset} has no {role} role to bind to {schema.__name__}")
        if (role, schema) not in bound:
            bound[role, schema] = LimitedLLM(build(config.roles[role], schema), sem)
        return bound[role, schema]

    return LLMs(**built, escalation=escalation, for_schema=for_schema, harness=config.harness, preset=config.preset,
                models=config.describe(), config_version=config_version)
