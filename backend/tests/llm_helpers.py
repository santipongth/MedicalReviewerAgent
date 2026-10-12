"""A small valid LLM config document for Plan 23b tests (same shape as config/llm.yaml)."""
import copy
from pathlib import Path

import yaml

ROLES = ("guard", "planner", "screener", "extractor", "synthesizer")

MINIMAL: dict = {
    "active_preset": "cheap",
    "default_provider": "openrouter",
    "providers": {"openrouter": {"base_url": "https://openrouter.ai/api/v1", "api_key_env": "OPENROUTER_API_KEY"}},
    "presets": {
        "cheap": {r: {"model": "vendor/cheap"} for r in ROLES},
        "better": {r: {"model": "vendor/better"} for r in ROLES},
    },
}


def with_model(raw: dict, preset: str, role: str, model: str) -> dict:
    out = copy.deepcopy(raw)
    out["presets"][preset][role] = {**out["presets"][preset].get(role, {}), "model": model}
    return out


def write_yaml(path: Path, raw: dict) -> Path:
    path.write_text(yaml.safe_dump(raw, sort_keys=False), encoding="utf-8")
    return path
