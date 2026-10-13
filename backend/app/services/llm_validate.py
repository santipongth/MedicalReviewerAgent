"""Check a draft LLM configuration for the admin console (Plan 23b): schema errors block a save; catalog problems and
missing API key variables are warnings; each preset gets a per-review cost estimate. Plan 23e: a role off OpenRouter
without a price, and a default_provider that is not configured, are errors too (document_errors), at validate and save
but never when a stored version is loaded."""
from __future__ import annotations

from typing import Any

import yaml

from app.config import Settings
from app.services.llm import PRICES_PER_MTOK
from app.services.llm_config import (
    CONFIG_ERRORS,
    FALLBACK_ROLES,
    LLMConfig,
    ResolvedLLMConfig,
    config_error_text,
    ensure_storable,
    is_local_origin,
    key_env,
    parse_llm_config,
    provider_kind,
    provider_origin,
    resolve_llm_config,
)
from app.services.llm_cost import estimate_review_cost
from app.services.llm_keys import KeyRing, resolve_key
from app.services.model_catalog import ModelInfo, validate_role

MAX_SAVE_ERRORS = 3


def to_yaml(raw: dict[str, Any]) -> str:
    return yaml.safe_dump(raw, sort_keys=False, allow_unicode=True)


def validate_document(raw: Any, settings: Settings, catalog: dict[str, ModelInfo] | None,
                      keys: KeyRing | None = None) -> dict[str, Any]:
    """`keys` (Plan 23e): the console's key ring, so the missing-key warnings follow the keys the workers would use and
    a draft that moves a provider with a stored key to another origin is warned about before it is saved."""
    try:
        return _validate(raw, settings, catalog, keys)
    except CONFIG_ERRORS as exc:  # a bad document is a result to show, never a server error
        return {"ok": False, "errors": [config_error_text(exc)], "warnings": [], "cost": {}, "config": None,
                "yaml": None}


def unpriced_roles(resolved: ResolvedLLMConfig, catalog: dict[str, ModelInfo] | None) -> list[str]:
    """Roles whose calls the review cost cap cannot count (Plan 23c, carried from the 23b review): a role off OpenRouter
    without a price of its own (Plan 23e: an openai_compatible role, or a direct Anthropic model missing from
    PRICES_PER_MTOK), or an OpenRouter model the catalog does not list and no role price covers (counted only when
    OpenRouter reports the call's cost). Without a catalog the OpenRouter check is skipped (validate already says so)."""
    return [name for name, role in resolved.roles.items()
            if role.spec.price_in is None and (
                role.kind == "openai_compatible"
                or (role.kind == "anthropic" and role.spec.model not in PRICES_PER_MTOK)
                or (role.kind == "openrouter" and catalog is not None and role.spec.model not in catalog))]


def price_errors(config: LLMConfig) -> list[str]:
    """Every role of every preset (overrides applied) whose calls the review cost cap could not count: off OpenRouter
    no catalog prices a call, so the role must carry price_in and price_out (an Anthropic model in PRICES_PER_MTOK is
    priced already; 0 is a valid price for a local server). A role that only copies another (FALLBACK_ROLES) is not
    listed again when the role it copies is listed: pricing that one prices both."""
    out: list[str] = []
    for preset in config.presets:
        resolved = resolve_llm_config(config, preset, where="config")
        unpriced = [name for name, role in resolved.roles.items() if role.spec.price_in is None and (
            role.kind == "openai_compatible" or (role.kind == "anthropic" and role.spec.model not in PRICES_PER_MTOK))]
        for name in unpriced:
            copied = name not in config.presets[preset] and name not in config.overrides
            if copied and FALLBACK_ROLES.get(name) in unpriced:
                continue
            role = resolved.roles[name]
            out.append(f"presets.{preset}.{name}: price_in and price_out (USD per 1M tokens) are required for "
                       f"provider '{role.provider}' ({role.kind}); the review cost cap cannot count its calls "
                       "otherwise")
    return out


def document_errors(config: LLMConfig) -> list[str]:
    """What validate and save refuse beyond the schema (Plan 23e). Loading a stored version never checks these, so a
    version saved before them still runs (and an unpriced role still charges 0, as before)."""
    out: list[str] = []
    if config.default_provider not in config.providers:
        out.append(f"default_provider '{config.default_provider}' is not configured in providers")
    return out + price_errors(config)


def save_error_text(errors: list[str]) -> str:
    more = f" (+{len(errors) - MAX_SAVE_ERRORS} more)" if len(errors) > MAX_SAVE_ERRORS else ""
    return "; ".join(errors[:MAX_SAVE_ERRORS]) + more


def is_keyless(name: str, spec) -> bool:
    """A provider that needs no key: the legacy local server, or an openai_compatible one on a local http origin."""
    return provider_kind(name, spec) == "openai_compatible" and (
        name == "openai_compatible" or is_local_origin(provider_origin(name, spec)))


def key_status(name: str, spec, keys: KeyRing | None, settings: Settings) -> str:
    """One word for a provider's key (Plan 23e): console, env, not_needed (a keyless local server), or the problem
    (origin_mismatch, unreadable, env_origin_missing), else none."""
    choice = resolve_key(name, spec, keys, settings)
    if choice.value:
        return choice.source
    if choice.problem is None and is_keyless(name, spec):
        return "not_needed"
    return choice.problem or "none"


def _validate(raw: Any, settings: Settings, catalog: dict[str, ModelInfo] | None,
              keys: KeyRing | None = None) -> dict[str, Any]:
    config = parse_llm_config(raw, where="config")
    resolve_llm_config(config, None, where="config")
    normalized = config.model_dump(mode="json", exclude_unset=True)
    ensure_storable(normalized)  # what save would refuse is not "ok" here either
    if errors := document_errors(config):
        return {"ok": False, "errors": errors, "warnings": [], "cost": {}, "config": None, "yaml": None}
    warnings: list[str] = []
    cost: dict[str, Any] = {}
    if catalog is None:
        warnings.append("OpenRouter catalog unavailable: model checks and cost estimates were skipped")
    used_providers: set[str] = set()
    for preset in config.presets:
        resolved = resolve_llm_config(config, preset, where="config")
        for role in resolved.roles.values():
            used_providers.add(role.provider)
            if catalog is not None:
                warnings += [f"{preset}: {p}" for p in validate_role(role, catalog)]
            if role.kind != "openrouter" and role.spec.fallback_models:
                warnings.append(f"{preset}: {role.role}: fallback_models apply only to OpenRouter and are not sent "
                                f"to {role.provider}")
        if catalog is not None:
            cost[preset] = estimate_review_cost(resolved, catalog)
        if unpriced := unpriced_roles(resolved, catalog):
            warnings.append(f"{preset}: no known price for {', '.join(unpriced)}: the review cost cap cannot count "
                            "their calls")
    for name, spec in config.providers.items():
        choice = resolve_key(name, spec, keys, settings)
        if choice.problem == "origin_mismatch":
            warnings.append(f"providers.{name}: the stored key belongs to {choice.bound_origin}; after saving, {name} "
                            f"gets no key until one is entered for {provider_origin(name, spec)}")
        if name not in used_providers or is_keyless(name, spec) or choice.value:
            continue
        if choice.problem in ("unreadable", "env_origin_missing"):
            warnings.append(f"{name}: no usable key ({choice.problem}): the {name} roles cannot run")
        elif choice.problem is None:
            warnings.append(f"{key_env(name)} is not set: the {name} roles cannot run")
    return {"ok": True, "errors": [], "warnings": warnings, "cost": cost, "config": normalized,
            "yaml": to_yaml(normalized)}
