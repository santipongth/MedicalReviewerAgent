"""Check a draft LLM configuration for the admin console (Plan 23b): schema errors block a save; catalog problems and
missing API key variables are warnings; each preset gets a per-review cost estimate."""
from __future__ import annotations

from typing import Any

import yaml

from app.config import Settings
from app.services.llm import _api_key
from app.services.llm_config import (
    CONFIG_ERRORS,
    config_error_text,
    ensure_storable,
    parse_llm_config,
    resolve_llm_config,
)
from app.services.llm_cost import estimate_review_cost
from app.services.model_catalog import ModelInfo, validate_role


def to_yaml(raw: dict[str, Any]) -> str:
    return yaml.safe_dump(raw, sort_keys=False, allow_unicode=True)


def validate_document(raw: Any, settings: Settings, catalog: dict[str, ModelInfo] | None) -> dict[str, Any]:
    try:
        return _validate(raw, settings, catalog)
    except CONFIG_ERRORS as exc:  # a bad document is a result to show, never a server error
        return {"ok": False, "errors": [config_error_text(exc)], "warnings": [], "cost": {}, "config": None,
                "yaml": None}


def _validate(raw: Any, settings: Settings, catalog: dict[str, ModelInfo] | None) -> dict[str, Any]:
    config = parse_llm_config(raw, where="config")
    resolve_llm_config(config, None, where="config")
    normalized = config.model_dump(mode="json", exclude_unset=True)
    ensure_storable(normalized)  # what save would refuse is not "ok" here either
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
        if catalog is not None:
            cost[preset] = estimate_review_cost(resolved, catalog)
    for name in sorted(used_providers):
        env_name = config.providers[name].api_key_env
        if not _api_key(settings, env_name) and name != "openai_compatible":
            warnings.append(f"{env_name} is not set: the {name} roles cannot run")
    return {"ok": True, "errors": [], "warnings": warnings, "cost": cost, "config": normalized,
            "yaml": to_yaml(normalized)}
