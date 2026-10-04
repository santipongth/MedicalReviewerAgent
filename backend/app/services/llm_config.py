"""Operator-editable LLM configuration (config/llm.yaml): presets of per-role model settings."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

Role = Literal["guard", "planner", "screener", "extractor", "synthesizer"]
ROLES: tuple[str, ...] = ("guard", "planner", "screener", "extractor", "synthesizer")
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


class LLMConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    active_preset: str
    default_provider: ProviderName = "openrouter"
    providers: dict[ProviderName, ProviderSpec]
    presets: dict[str, dict[Role, RoleSpec]]
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

    def describe(self) -> dict[str, str]:
        return {role: f"{r.provider}:{r.spec.model}" for role, r in self.roles.items()}


def load_llm_config(path: str | Path, preset: str | None = None) -> ResolvedLLMConfig:
    path = Path(path)
    if not path.is_file():
        raise LLMConfigError(f"LLM config not found: {path}")
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        config = LLMConfig.model_validate(raw)
    except yaml.YAMLError as exc:
        raise LLMConfigError(f"{path}: invalid YAML: {exc}") from exc
    except ValidationError as exc:
        raise LLMConfigError(f"{path}: {exc}") from exc

    name = preset or config.active_preset
    if name not in config.presets:
        raise LLMConfigError(f"Unknown preset '{name}'. Available: {', '.join(config.presets)}")

    roles: dict[str, ResolvedRole] = {}
    for role in ROLES:
        spec = config.presets[name][role]
        if role in config.overrides:
            try:
                spec = RoleSpec.model_validate({**spec.model_dump(), **config.overrides[role]})
            except ValidationError as exc:
                raise LLMConfigError(f"{path}: overrides.{role}: {exc}") from exc
        provider = spec.provider or config.default_provider
        if provider not in config.providers:
            raise LLMConfigError(f"Provider '{provider}' is not configured (overrides.{role})")
        roles[role] = ResolvedRole(role, provider, config.providers[provider], spec)
    return ResolvedLLMConfig(preset=name, roles=roles)
