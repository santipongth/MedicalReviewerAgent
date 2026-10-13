"""Operator-editable LLM configuration (config/llm.yaml): presets of per-role model settings."""
from __future__ import annotations

import ipaddress
import json
import math
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
# Plan 23e: a provider is a free name with a kind. The three legacy names keep their kind without saying so.
ProviderKind = Literal["openrouter", "anthropic", "openai_compatible"]
LEGACY_PROVIDERS: tuple[str, ...] = ("openrouter", "anthropic", "openai_compatible")
PROVIDER_NAME = re.compile(r"[a-z][a-z0-9_]{0,31}")
MAX_PROVIDERS = 12
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


def config_error_summary(exc: BaseException) -> str:
    """One line for a stored configuration that no longer loads (the state route's `error`): a pydantic error is
    rendered from its errors without the input values (field path and message only), and only the first line is kept,
    so no YAML snippet or stored value is echoed back."""
    text = config_error_text(exc)
    cause = exc.__cause__
    if isinstance(cause, ValidationError):
        detail = str(cause)
        prefix = text[:-len(detail)] if detail and text.endswith(detail) else ""
        errors = cause.errors(include_input=False, include_url=False, include_context=False)
        first = errors[0] if errors else {"loc": (), "msg": "invalid"}
        where = ".".join(str(part) for part in first["loc"]) or "config"
        more = f" (+{len(errors) - 1} more)" if len(errors) > 1 else ""
        text = f"{prefix}{where}: {first['msg']}{more}"
    lines = text.splitlines()
    return (lines[0] if lines else type(exc).__name__)[:300]


# A provider's key is read from the server's settings or environment by name, so a provider may only name its own
# variable: a draft cannot make the server send DATABASE_URL, or one provider's key to another's host. OpenRouter and
# Anthropic keys are only ever sent to those providers' own hosts; a local model server (openai_compatible) may be
# anywhere, but it gets only its own key. A provider with a free name (Plan 23e) may only name LLM_KEY_<NAME>.
PROVIDER_KEYS = {"openrouter": "OPENROUTER_API_KEY", "anthropic": "ANTHROPIC_API_KEY",
                 "openai_compatible": "OPENAI_COMPATIBLE_API_KEY"}
PINNED_HOSTS = {"openrouter": "openrouter.ai", "anthropic": "api.anthropic.com"}
# Where OpenRouter and Anthropic calls go when their base_url is left out (llm.py's OPENROUTER_BASE_URL, ChatAnthropic's
# default): the origin a stored key of theirs is bound to.
DEFAULT_ORIGINS = {"openrouter": "https://openrouter.ai", "anthropic": "https://api.anthropic.com"}
# A provider with a free name may use plain http only on this machine (a local model server, Ollama in docker).
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "host.docker.internal"})
VISIBLE_ASCII = re.compile(r"[!-~]+")  # the printable ASCII range without the space
# Visible words with single spaces between them: nothing that could end a header line, and no leading or trailing
# space (the HTTP client refuses a header value with one, and then every call fails).
HEADER_TEXT = re.compile(r"[!-~]+( [!-~]+)*")
MAX_FREEFORM_DEPTH = 8  # nesting of an extra_body or of one overrides entry
MERGED_EXTRA_BODY_KEYS = ("provider", "reasoning")  # llm.py adds require_parameters / effort to these
MAX_YAML_DEPTH = 20


def url_host(url: str | None) -> str | None:
    """The host of a base URL (lower case; no port, userinfo, path or query); None when there is no URL. Raises
    ValueError for a URL that does not parse."""
    if not url:
        return None
    parts = urlsplit(url)
    parts.port  # noqa: B018 - raises ValueError for a port out of range
    return parts.hostname


def _is_https_host(url: str, host: str) -> bool:
    """True only for an https URL whose whole authority is `host`: no userinfo, port or look-alike suffix."""
    if not VISIBLE_ASCII.fullmatch(url) or "\\" in url:  # nothing a URL parser might silently drop or reinterpret
        return False
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    return parts.scheme == "https" and parts.netloc.lower() == host


def _is_http_url_with_host(url: str) -> bool:
    if not VISIBLE_ASCII.fullmatch(url) or "\\" in url:
        return False
    try:
        return urlsplit(url).scheme in ("http", "https") and url_host(url) is not None
    except ValueError:
        return False


def _is_open_provider_url(url: str) -> bool:
    """A base URL for a provider with a free name (Plan 23e): https to a host name or a global IP address, or plain
    http to this machine only; no userinfo, query or fragment. Host names are not resolved here (DNS can change between
    this check and the call), so the IP rule only stops literals: private, link-local and metadata addresses."""
    if not VISIBLE_ASCII.fullmatch(url) or "\\" in url:
        return False
    try:
        parts = urlsplit(url)
        parts.port  # noqa: B018 - raises ValueError for a port out of range
        host = parts.hostname
    except ValueError:
        return False
    if not host or "@" in parts.netloc or parts.query or parts.fragment:
        return False
    if parts.scheme == "http":
        return host in LOCAL_HOSTS
    if parts.scheme != "https":
        return False
    try:
        return ipaddress.ip_address(host).is_global
    except ValueError:
        return True  # a host name


def url_origin(url: str) -> str:
    """scheme://host[:port] of a URL, lower case, without a default port: the unit a stored key is bound to (Plan 23e).
    A path change keeps the origin; another host, scheme or port is another origin. Raises ValueError for a URL that
    does not parse."""
    parts = urlsplit(url)
    scheme, host, port = parts.scheme.lower(), parts.hostname or "", parts.port
    if ":" in host:
        host = f"[{host}]"
    default = {"http": 80, "https": 443}.get(scheme)
    return f"{scheme}://{host}" + (f":{port}" if port is not None and port != default else "")


def is_local_origin(origin: str) -> bool:
    """An http origin on this machine: a local model server, which needs no key."""
    try:
        parts = urlsplit(origin)
        return parts.scheme == "http" and parts.hostname in LOCAL_HOSTS
    except ValueError:
        return False


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


def _leaves(value: Any):
    """Every scalar anywhere in value, dict keys included, found without recursion (a cycle is visited once)."""
    seen: set[int] = set()
    stack = [value]
    while stack:
        item = stack.pop()
        if isinstance(item, dict | list | tuple | set | frozenset):
            if id(item) in seen:
                continue
            seen.add(id(item))
            if isinstance(item, dict):
                stack.extend(item.keys())
                stack.extend(item.values())
            else:
                stack.extend(item)
        else:
            yield item


def _bad_text(item: Any) -> bool:
    if isinstance(item, bytes | bytearray):
        return True
    if isinstance(item, str):
        if "\x00" in item:
            return True
        try:
            item.encode("utf-8")
        except UnicodeEncodeError:
            return True
    return False


def has_bad_text(value: Any) -> bool:
    """True when anywhere in value (a dict key too) there is a string holding a NUL or one that cannot be encoded as
    UTF-8 (a lone surrogate), or any bytes: Postgres refuses the first two, and bytes (YAML !!binary) would reach a
    typed field as a str with the NUL intact. They are stopped before anything is stored or paid for."""
    return any(_bad_text(item) for item in _leaves(value))


def has_non_finite_number(value: Any) -> bool:
    """True when anywhere in value (a dict key too) there is a float that is NaN or infinite: YAML .nan and .inf, or a
    JSON number such as 1e400. The typed fields refuse them, but extra_body and overrides take any value, and the JSON
    dump would turn them into null."""
    return any(isinstance(item, float) and not math.isfinite(item) for item in _leaves(value))


def ensure_storable(value: Any) -> None:
    """The JSON column must be able to hold value: no NaN or infinity, no integer json.dumps will not print (over
    4300 digits, e.g. a long YAML hex number), nothing that is not JSON. Otherwise the INSERT fails in a way that
    depends on the driver."""
    try:
        json.dumps(value, allow_nan=False)
    except (ValueError, OverflowError, TypeError, RecursionError) as exc:
        raise LLMConfigError(f"config: cannot be stored as JSON: {exc}") from exc


def _check_depth(value: dict[str, Any], what: str) -> dict[str, Any]:
    if _nesting(value) > MAX_FREEFORM_DEPTH:
        raise ValueError(f"{what} is nested more than {MAX_FREEFORM_DEPTH} levels deep")
    return value


class ProviderSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    kind: ProviderKind | None = None  # may be left out only under the three legacy names, where it is the name
    base_url: str | None = None
    api_key_env: str | None = None
    app_name: str | None = None
    app_url: str | None = None
    require_parameters: bool = True

    @field_validator("app_name")
    @classmethod
    def _app_name_is_header_safe(cls, value: str | None) -> str | None:
        if value and not HEADER_TEXT.fullmatch(value):  # sent as the X-Title request header; empty means none
            raise ValueError("app_name may only hold visible ASCII characters, with single spaces between words")
        return value

    @field_validator("app_url")
    @classmethod
    def _app_url_is_a_url(cls, value: str | None) -> str | None:
        if value and not _is_http_url_with_host(value):  # sent as the HTTP-Referer request header
            raise ValueError("app_url must be an http(s) URL with a host, in visible ASCII")
        return value


class RoleSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    model: str = Field(min_length=1)
    provider: str | None = Field(None, max_length=32)
    max_tokens: int = Field(4096, ge=1, le=128_000)
    temperature: float | None = Field(None, ge=0, le=2)
    top_p: float | None = Field(None, ge=0, le=1)
    reasoning_effort: Effort | None = None
    structured_output: StructuredMethod = "auto"
    timeout_seconds: float = Field(300.0, gt=0)
    fallback_models: list[str] = Field(default_factory=list)
    extra_body: dict[str, Any] = Field(default_factory=dict)
    # Plan 23e: USD per 1M tokens, both or neither. Required (at validate and save) off OpenRouter, where no catalog
    # prices a call: the review cost cap charges these.
    price_in: float | None = Field(None, ge=0, le=1000)
    price_out: float | None = Field(None, ge=0, le=1000)

    @field_validator("extra_body")
    @classmethod
    def _extra_body_depth(cls, value: dict[str, Any]) -> dict[str, Any]:
        for key in MERGED_EXTRA_BODY_KEYS:  # the client merges its own settings into these two, so they must be maps
            if key in value and not isinstance(value[key], dict):
                raise ValueError(f"extra_body.{key} must be a mapping")
        return _check_depth(value, "extra_body")

    @model_validator(mode="after")
    def _both_prices_or_neither(self) -> RoleSpec:
        if (self.price_in is None) != (self.price_out is None):
            raise ValueError("price_in and price_out go together: set both or neither")
        return self


def provider_kind(name: str, spec: ProviderSpec) -> str:
    """The provider's kind: its `kind`, or its name for the three legacy names. The only way code asks for a kind."""
    return spec.kind or name


def key_env(name: str) -> str:
    """The one variable a provider's env key may come from: the fixed name of a legacy provider, else LLM_KEY_<NAME>."""
    return PROVIDER_KEYS.get(name) or f"LLM_KEY_{name.upper()}"


def provider_origin(name: str, spec: ProviderSpec) -> str:
    """The origin the provider's calls go to, which a stored key is bound to: its base_url's, else the default host of
    OpenRouter or Anthropic."""
    if spec.base_url:
        return url_origin(spec.base_url)
    return DEFAULT_ORIGINS.get(provider_kind(name, spec), "")


def _check_provider(name: str, spec: ProviderSpec) -> None:
    if not PROVIDER_NAME.fullmatch(name):
        raise ValueError(f"providers: {name[:40]!r} is not a provider name (a lower-case letter, then up to 31 "
                         "lower-case letters, digits or _)")
    kind = spec.kind or (name if name in LEGACY_PROVIDERS else None)
    if kind is None:
        raise ValueError(f"providers.{name}.kind is required: openrouter, anthropic or openai_compatible")
    if (kind in PINNED_HOSTS or name in PINNED_HOSTS) and kind != name:
        raise ValueError(f"providers.{name}.kind: the openrouter and anthropic kinds exist only under their own names")
    expected = key_env(name)
    if spec.api_key_env is not None and spec.api_key_env != expected:
        raise ValueError(f"providers.{name}.api_key_env must be {expected} or left out: a provider's key is only "
                         "sent to that provider")
    host = PINNED_HOSTS.get(name)
    if host and spec.base_url and not _is_https_host(spec.base_url, host):
        raise ValueError(f"providers.{name}.base_url must be an https://{host}/ address "
                         f"(the {name} key is only sent there)")
    if name == "openai_compatible" and not spec.base_url:
        raise ValueError("providers.openai_compatible.base_url is required, e.g. http://localhost:11434/v1")
    if name == "openai_compatible" and not _is_http_url_with_host(spec.base_url):
        raise ValueError("providers.openai_compatible.base_url must be an http(s) URL with a host, "
                         "e.g. http://localhost:11434/v1")
    if kind == "openai_compatible" and name != "openai_compatible" and not (
            spec.base_url and _is_open_provider_url(spec.base_url)):
        raise ValueError(f"providers.{name}.base_url must be an https:// URL with a public host (or http:// to "
                         "localhost, 127.0.0.1, ::1 or host.docker.internal), without a user, query or fragment")


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

    @field_validator("screen_borderline")
    @classmethod
    def _borderline_band(cls, value: tuple[int, int]) -> tuple[int, int]:
        # relevance scores run 0-100; the band's low end is also the screening relevance floor
        low, high = value
        if not 0 <= low <= high <= 100:
            raise ValueError("screen_borderline must be [low, high] with 0 <= low <= high <= 100")
        return value


class LLMConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    active_preset: str
    default_provider: str = Field("openrouter", max_length=32)
    providers: dict[str, ProviderSpec]
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
        if len(self.providers) > MAX_PROVIDERS:
            raise ValueError(f"providers: at most {MAX_PROVIDERS} providers")
        for name, provider_spec in self.providers.items():
            _check_provider(name, provider_spec)
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
    kind: str = ""  # Plan 23e: filled from the provider when left empty

    def __post_init__(self) -> None:
        if not self.kind:
            object.__setattr__(self, "kind", provider_kind(self.provider, self.provider_spec))

    def with_spec(self, **changes: Any) -> ResolvedRole:
        return ResolvedRole(self.role, self.provider, self.provider_spec, self.spec.model_copy(update=changes),
                            self.kind)


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
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise LLMConfigError(f"{path}: not valid UTF-8") from exc
    try:
        raw = yaml.safe_load(text) or {}
    except Exception as exc:
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


def _refuse_binary(loader: yaml.SafeLoader, node: yaml.Node) -> None:
    # !!binary loads as bytes, which pydantic turns into a str with any NUL intact: past the text check on str values
    raise yaml.YAMLError("YAML !!binary values are not allowed in the config")


_DocumentLoader.add_constructor("tag:yaml.org,2002:binary", _refuse_binary)  # on the subclass: SafeLoader is untouched


def parse_yaml_text(text: str) -> Any:
    """The value of an admin-supplied YAML document; anything that does not load is an LLMConfigError."""
    try:
        return yaml.load(text, Loader=_DocumentLoader)
    except Exception as exc:  # the loader does no I/O, so whatever it raises means the document is bad
        # YAMLError and ValueError (2020-13-45, a huge integer) say what is wrong; SafeConstructor raises KeyError,
        # AttributeError and IndexError for a tag that does not fit its value (!!bool maybe, !!timestamp x, !!int _)
        detail = (str(exc) if isinstance(exc, yaml.YAMLError | ValueError | RecursionError)
                  else f"a value does not match its tag ({type(exc).__name__})")
        raise LLMConfigError(f"invalid YAML: {detail}") from exc


def parse_llm_config(raw: Any, *, where: str = "llm config") -> LLMConfig:
    if not isinstance(raw, dict):
        raise LLMConfigError(f"{where}: the config must be a mapping")
    if has_bad_text(raw):
        raise LLMConfigError(f"{where}: the config contains a NUL or an invalid character")
    if has_non_finite_number(raw):
        raise LLMConfigError(f"{where}: the config contains a number that is NaN or infinity")
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
