"""Operator-editable LLM configuration (config/llm.yaml): presets of per-role model settings."""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

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


# What a bad document can raise anywhere between parsing and dumping: LLMConfigError, pydantic's ValidationError and
# serialization errors are all ValueErrors. Callers that must answer 422 and never 500 catch these.
CONFIG_ERRORS = (ValueError, RecursionError)


def config_error_text(exc: BaseException) -> str:
    if isinstance(exc, RecursionError):
        return "the config is nested too deeply"
    return str(exc) or type(exc).__name__


# A provider key is read from the server's settings or environment by name, so the name is restricted to the shape of
# a provider key (a draft must not be able to name DATABASE_URL, IP_HASH_SALT, ...), and OpenRouter / Anthropic keys
# are only ever sent to those providers' own hosts. A local model server (openai_compatible) may be anywhere, but
# then it gets only its own key.
API_KEY_ENV = re.compile(r"[A-Z][A-Z0-9_]*_API_KEY")
PINNED_HOSTS = {"openrouter": "openrouter.ai", "anthropic": "api.anthropic.com"}
FREE_HOST_KEYS = {"openai_compatible": "OPENAI_COMPATIBLE_API_KEY"}
VISIBLE_ASCII = re.compile(r"[\x21-\x7e]+")
MAX_FREEFORM_DEPTH = 8  # nesting of an extra_body or of one overrides entry
MAX_YAML_DEPTH = 20


def _is_https_host(url: str, host: str) -> bool:
    """True only for an https URL whose whole authority is `host`: no userinfo, port or look-alike suffix."""
    if not VISIBLE_ASCII.fullmatch(url) or "\\" in url:  # nothing a URL parser might silently drop or reinterpret
        return False
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    return parts.scheme == "https" and parts.netloc.lower() == host


def _nesting(value: Any) -> int:
    """Levels of nested dicts and lists in value (a scalar is 0), measured without recursion and cut short once the
    cap is passed."""
    deepest, stack = 0, [(value, 0)]
    while stack:
        item, level = stack.pop()
        if isinstance(item, dict):
            children = list(item.values())
        elif isinstance(item, list | tuple):
            children = list(item)
        else:
            continue
        deepest = max(deepest, level + 1)
        if deepest > MAX_FREEFORM_DEPTH:
            break
        stack.extend((child, level + 1) for child in children)
    return deepest


def has_bad_text(value: Any) -> bool:
    """True when a string anywhere in value (a dict key too) holds a NUL or cannot be encoded as UTF-8 (a lone
    surrogate): Postgres refuses both, so they are stopped before anything is stored or paid for."""
    seen: set[int] = set()
    stack = [value]
    while stack:
        item = stack.pop()
        if isinstance(item, str):
            if "\x00" in item:
                return True
            try:
                item.encode("utf-8")
            except UnicodeEncodeError:
                return True
        elif isinstance(item, dict | list | tuple) and id(item) not in seen:
            seen.add(id(item))
            if isinstance(item, dict):
                stack.extend(item.keys())
                stack.extend(item.values())
            else:
                stack.extend(item)
    return False


def _check_depth(value: dict[str, Any], what: str) -> dict[str, Any]:
    if _nesting(value) > MAX_FREEFORM_DEPTH:
        raise ValueError(f"{what} is nested more than {MAX_FREEFORM_DEPTH} levels deep")
    return value


class ProviderSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    base_url: str | None = None
    api_key_env: str
    app_name: str | None = None
    app_url: str | None = None
    require_parameters: bool = True

    @field_validator("api_key_env")
    @classmethod
    def _key_name(cls, value: str) -> str:
        if not API_KEY_ENV.fullmatch(value):
            raise ValueError(f"api_key_env '{value}' must look like OPENROUTER_API_KEY (capital letters, digits and "
                             "underscores, ending in _API_KEY)")
        return value


class RoleSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

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

    @field_validator("extra_body")
    @classmethod
    def _extra_body_depth(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _check_depth(value, "extra_body")


class HarnessSpec(BaseModel):
    """Quality harness for smaller/open models: repairs, voting, verification, escalation, localization."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

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
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    active_preset: str
    default_provider: ProviderName = "openrouter"
    providers: dict[ProviderName, ProviderSpec]
    presets: dict[str, dict[Role, RoleSpec]]
    harness: HarnessSpec = Field(default_factory=HarnessSpec)
    overrides: dict[Role, dict[str, Any]] = Field(default_factory=dict)

    @field_validator("overrides")
    @classmethod
    def _overrides_depth(cls, value: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
        for role, override in value.items():
            _check_depth(override, f"overrides.{role}")
        return value

    @model_validator(mode="after")
    def _check(self) -> LLMConfig:
        for name, provider_spec in self.providers.items():
            host = PINNED_HOSTS.get(name)
            if host and provider_spec.base_url and not _is_https_host(provider_spec.base_url, host):
                raise ValueError(f"providers.{name}.base_url must be an https://{host}/ address "
                                 f"(the {name} key is only sent there)")
            own_key = FREE_HOST_KEYS.get(name)
            if own_key and provider_spec.api_key_env != own_key:
                raise ValueError(f"providers.{name}.api_key_env must be {own_key}: a server of your choosing "
                                 "only receives its own key")
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


class _DocumentLoader(yaml.SafeLoader):
    """A SafeLoader for a document an admin typed: no anchors or aliases (a few hundred characters of aliases expand
    to millions of values once the document is dumped) and a nesting cap, so a deep document cannot recurse."""

    _depth = 0

    def compose_node(self, parent, index):
        if self.check_event(yaml.AliasEvent) or getattr(self.peek_event(), "anchor", None) is not None:
            raise yaml.YAMLError("YAML anchors (&name) and aliases (*name) are not allowed in the config")
        self._depth += 1
        try:
            if self._depth > MAX_YAML_DEPTH:
                raise yaml.YAMLError(f"the YAML is nested more than {MAX_YAML_DEPTH} levels deep")
            return super().compose_node(parent, index)
        finally:
            self._depth -= 1


def parse_yaml_text(text: str) -> Any:
    """The value of an admin-supplied YAML document; anything that does not load is an LLMConfigError."""
    try:
        return yaml.load(text, Loader=_DocumentLoader)
    except (yaml.YAMLError, ValueError, RecursionError) as exc:  # ValueError: a date like 2020-13-45, a huge integer
        raise LLMConfigError(f"invalid YAML: {exc}") from exc


def parse_llm_config(raw: Any, *, where: str = "llm config") -> LLMConfig:
    if not isinstance(raw, dict):
        raise LLMConfigError(f"{where}: the config must be a mapping")
    if has_bad_text(raw):
        raise LLMConfigError(f"{where}: the config contains a NUL or an invalid character")
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
            try:
                spec = RoleSpec(model=config.overrides[role]["model"])  # enabled purely via overrides
            except ValidationError as exc:
                raise LLMConfigError(f"{where}: overrides.{role}: {exc}") from exc
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
