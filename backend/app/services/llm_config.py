"""Operator-editable LLM configuration (config/llm.yaml): presets of per-role model settings."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

Role = Literal[
    "guard", "planner", "screener", "extractor", "synthesizer",
    "normalizer", "conflict_explainer", "localizer", "screener_secondary", "extractor_secondary", "escalation",
    "refiner", "enricher",
]
# Every preset must define these.
ROLES: tuple[str, ...] = ("guard", "planner", "screener", "extractor", "synthesizer")
# Harness roles: the first three fall back to another role's settings when omitted; the last three are
# simply disabled when omitted (no second vote / no dual extraction / no escalation).
FALLBACK_ROLES: dict[str, str] = {
    "normalizer": "planner", "conflict_explainer": "extractor", "localizer": "planner", "refiner": "planner",
    "enricher": "planner",
}
OPTIONAL_ROLES: tuple[str, ...] = (*FALLBACK_ROLES, "screener_secondary", "extractor_secondary", "escalation")
EscalationTrigger = Literal["repair_failed", "verification_failed", "disagreement"]
ProviderName = Literal["openrouter", "anthropic", "openai_compatible"]
Effort = Literal["none", "minimal", "low", "medium", "high", "xhigh", "max"]
StructuredMethod = Literal["auto", "json_schema", "tool_calling", "json_mode"]


class LLMConfigError(ValueError):
    pass


class ProviderSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_url: str | None = None
    api_key_env: str
    app_name: str | None = None
    app_url: str | None = None
    require_parameters: bool = True


class RoleSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model: str = Field(min_length=1)
    provider: ProviderName | None = None
    max_tokens: int = Field(4096, ge=1, le=128_000)
    temperature: float | None = Field(None, ge=0, le=2)
    top_p: float | None = Field(None, ge=0, le=1)
    reasoning_effort: Effort | None = None
    structured_output: StructuredMethod = "auto"
    timeout_seconds: float = Field(300.0, gt=0)
    fallback_models: list[str] = Field(default_factory=list)
    extra_body: dict[str, Any] = Field(default_factory=dict)


class HarnessSpec(BaseModel):
    """Quality harness for smaller/open models: repairs, voting, verification, escalation, localization."""

    model_config = ConfigDict(extra="forbid")

    max_repairs: int = Field(2, ge=0, le=5)
    refine_critique: bool = True  # one self-critique/revise round on the interpreted question
    screen_borderline: tuple[int, int] = (35, 70)
    dual_extraction: bool = True
    verify_quotes: bool = True
    quote_match_threshold: int = Field(90, ge=50, le=100)
    escalate_on: list[EscalationTrigger] = Field(
        default_factory=lambda: ["repair_failed", "verification_failed", "disagreement"]
    )
    localize: bool = True
    extraction_chars: int = Field(30_000, ge=2_000, le=200_000)


class LLMConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active_preset: str
    default_provider: ProviderName = "openrouter"
    providers: dict[ProviderName, ProviderSpec]
    presets: dict[str, dict[Role, RoleSpec]]
    harness: HarnessSpec = Field(default_factory=HarnessSpec)
    overrides: dict[Role, dict[str, Any]] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check(self) -> LLMConfig:
        for name, roles in self.presets.items():
            missing = [r for r in ROLES if r not in roles]
            if missing:
                raise ValueError(f"preset '{name}' is missing roles: {', '.join(missing)}")
            for role, spec in roles.items():
                provider = spec.provider or self.default_provider
                if provider not in self.providers:
                    raise ValueError(f"Provider '{provider}' is not configured (preset '{name}', role '{role}')")
        return self


@dataclass(frozen=True)
class ResolvedRole:
    role: str
    provider: str
    provider_spec: ProviderSpec
    spec: RoleSpec

    def with_spec(self, **changes: Any) -> ResolvedRole:
        return ResolvedRole(self.role, self.provider, self.provider_spec, self.spec.model_copy(update=changes))


@dataclass(frozen=True)
class ResolvedLLMConfig:
    preset: str
    roles: dict[str, ResolvedRole]
    harness: HarnessSpec

    def describe(self) -> dict[str, str]:
        return {role: f"{r.provider}:{r.spec.model}" for role, r in self.roles.items()}


def read_llm_yaml(path: str | Path) -> dict[str, Any]:
    path = Path(path)
    if not path.is_file():
        raise LLMConfigError(f"LLM config not found: {path}")
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise LLMConfigError(f"{path}: invalid YAML: {exc}") from exc
    if not isinstance(raw, dict):
        raise LLMConfigError(f"{path}: the config must be a mapping")
    return raw


def parse_llm_config(raw: Any, *, where: str = "llm config") -> LLMConfig:
    if not isinstance(raw, dict):
        raise LLMConfigError(f"{where}: the config must be a mapping")
    try:
        return LLMConfig.model_validate(raw)
    except ValidationError as exc:
        raise LLMConfigError(f"{where}: {exc}") from exc


def resolve_llm_config(config: LLMConfig, preset: str | None = None, *,
                       where: str = "llm config") -> ResolvedLLMConfig:
    name = preset or config.active_preset
    if name not in config.presets:
        raise LLMConfigError(f"Unknown preset '{name}'. Available: {', '.join(config.presets)}")
    roles: dict[str, ResolvedRole] = {}
    preset_roles = config.presets[name]
    for role in (*ROLES, *OPTIONAL_ROLES):
        if role in preset_roles:
            spec = preset_roles[role]
        elif role in FALLBACK_ROLES:
            spec = preset_roles[FALLBACK_ROLES[role]]
        elif role in config.overrides and "model" in config.overrides[role]:
            spec = RoleSpec(model=config.overrides[role]["model"])  # enabled purely via overrides
        else:
            continue
        if role in config.overrides:
            try:
                spec = RoleSpec.model_validate({**spec.model_dump(), **config.overrides[role]})
            except ValidationError as exc:
                raise LLMConfigError(f"{where}: overrides.{role}: {exc}") from exc
        provider = spec.provider or config.default_provider
        if provider not in config.providers:
            raise LLMConfigError(f"Provider '{provider}' is not configured (overrides.{role})")
        roles[role] = ResolvedRole(role, provider, config.providers[provider], spec)
    return ResolvedLLMConfig(preset=name, roles=roles, harness=config.harness)


def load_llm_config(path: str | Path, preset: str | None = None) -> ResolvedLLMConfig:
    return resolve_llm_config(parse_llm_config(read_llm_yaml(path), where=str(path)), preset, where=str(path))
