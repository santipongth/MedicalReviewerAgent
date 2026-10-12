"""Hostile or malformed LLM config documents (Plan 23b task 8 fix round 1): secrets stay with their provider, YAML
cannot blow up memory, and every bad document is an LLMConfigError, never another exception type."""
import copy
from pathlib import Path

import pytest

from app.services.llm_config import (
    LLMConfigError,
    load_llm_config,
    parse_llm_config,
    parse_yaml_text,
    resolve_llm_config,
)
from tests.llm_helpers import MINIMAL

REPO_CONFIG = Path(__file__).parents[2] / "config" / "llm.yaml"


def provider(raw: dict, name: str = "openrouter", **fields) -> dict:
    out = copy.deepcopy(raw)
    out["providers"].setdefault(name, {"api_key_env": f"{name.upper()}_API_KEY"}).update(fields)
    return out


def nested(depth: int):
    inner: dict = {}
    top = {"a": inner}
    for _ in range(depth):
        inner["a"] = {}
        inner = inner["a"]
    return top


def test_the_seed_config_and_a_local_model_server_stay_valid():
    load_llm_config(REPO_CONFIG)
    for name in ("budget", "balanced", "claude", "gemini", "claude_direct"):
        load_llm_config(REPO_CONFIG, preset=name)
    ok = provider(MINIMAL, "anthropic", base_url="https://api.anthropic.com/v1")
    ok = provider(ok, "openai_compatible", base_url="http://host.docker.internal:11434/v1",
                  api_key_env="OPENAI_COMPATIBLE_API_KEY")
    parse_llm_config(ok)


@pytest.mark.parametrize("env", ["DATABASE_URL", "IP_HASH_SALT", "TURNSTILE_SECRET", "openrouter_api_key",
                                 "OPENROUTER_API_KEY\n", "API_KEY", "_API_KEY", "1_API_KEY", "OPENROUTER_API_KEY_X"])
def test_the_key_variable_must_be_a_provider_key_name(env):
    with pytest.raises(LLMConfigError, match="api_key_env"):
        parse_llm_config(provider(MINIMAL, api_key_env=env))


@pytest.mark.parametrize("name,url", [
    ("openrouter", "https://evil.example/v1"),
    ("openrouter", "http://openrouter.ai/api/v1"),
    ("openrouter", "https://openrouter.ai.evil.example/api/v1"),
    ("openrouter", "https://openrouter.ai@evil.example/"),
    ("openrouter", "https://openrouter.ai\\@evil.example/"),
    ("openrouter", "https://openrouter.ai:8443/api/v1"),
    ("openrouter", "https://openrouter.ai\t.evil.example/"),
    ("anthropic", "https://evil.example"),
    ("anthropic", "https://api.anthropic.com.evil.example"),
    ("anthropic", "http://api.anthropic.com"),
])
def test_openrouter_and_anthropic_keys_only_go_to_their_own_host(name, url):
    with pytest.raises(LLMConfigError, match="base_url"):
        parse_llm_config(provider(MINIMAL, name, base_url=url))


def test_a_free_base_url_only_gets_its_own_key():
    free = {"base_url": "https://models.example.org/v1", "api_key_env": "OPENAI_COMPATIBLE_API_KEY"}
    parse_llm_config(provider(MINIMAL, "openai_compatible", **free))
    for env in ("OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "OPENALEX_API_KEY"):
        with pytest.raises(LLMConfigError, match="OPENAI_COMPATIBLE_API_KEY"):
            parse_llm_config(provider(MINIMAL, "openai_compatible", **{**free, "api_key_env": env}))


def test_aliases_anchors_and_deep_nesting_are_refused_before_anything_expands():
    laughs = "a: &a [x, x, x, x, x, x, x, x, x]\nb: [*a, *a, *a, *a]\n"
    with pytest.raises(LLMConfigError, match="alias"):
        parse_yaml_text(laughs)
    with pytest.raises(LLMConfigError, match="anchor"):
        parse_yaml_text("a: &a 1\n")
    with pytest.raises(LLMConfigError, match="nested"):
        parse_yaml_text("[" * 900)
    with pytest.raises(LLMConfigError, match="nested"):
        parse_yaml_text("k: " + "{a: " * 40 + "1" + "}" * 40)
    assert parse_yaml_text("a: {b: [1, 2, {c: d}]}") == {"a": {"b": [1, 2, {"c": "d"}]}}


@pytest.mark.parametrize("text", ["a: 2020-13-45", "a: " + "9" * 5000, "a: [unclosed", "a: !!python/object:os.system x"])
def test_yaml_that_does_not_load_is_an_llm_config_error(text):
    with pytest.raises(LLMConfigError):
        parse_yaml_text(text)


def test_free_form_sections_have_a_depth_cap():
    deep = copy.deepcopy(MINIMAL)
    deep["presets"]["cheap"]["guard"]["extra_body"] = nested(250)
    with pytest.raises(LLMConfigError, match="nested"):
        parse_llm_config(deep)
    deep_overrides = {**MINIMAL, "overrides": {"guard": nested(250)}}
    with pytest.raises(LLMConfigError, match="nested"):
        parse_llm_config(deep_overrides)
    fine = copy.deepcopy(MINIMAL)
    fine["presets"]["cheap"]["guard"]["extra_body"] = {"provider": {"order": ["a"], "sort": {"by": "price"}}}
    parse_llm_config(fine)


def test_numbers_must_be_finite():
    for bad in (float("inf"), float("nan")):
        raw = copy.deepcopy(MINIMAL)
        raw["presets"]["cheap"]["guard"]["timeout_seconds"] = bad
        with pytest.raises(LLMConfigError):
            parse_llm_config(raw)
    raw = copy.deepcopy(MINIMAL)
    raw["presets"]["cheap"]["guard"]["temperature"] = float("nan")
    with pytest.raises(LLMConfigError):
        parse_llm_config(raw)


def test_an_override_that_enables_a_role_with_a_bad_model_is_an_llm_config_error():
    config = parse_llm_config({**MINIMAL, "overrides": {"escalation": {"model": ""}}})
    with pytest.raises(LLMConfigError, match="escalation"):
        resolve_llm_config(config)


@pytest.mark.parametrize("path", ["key", "value", "preset", "list", "provider"])
def test_nul_and_unencodable_text_anywhere_is_refused(path):
    raw = copy.deepcopy(MINIMAL)
    if path == "key":
        raw["presets"]["cheap"]["guard"]["extra_body"] = {"a\x00b": 1}
    elif path == "value":
        raw["presets"]["cheap"]["guard"]["model"] = "vendor/a\x00b"
    elif path == "preset":
        raw["presets"]["ch\x00eap"] = raw["presets"].pop("cheap")
        raw["active_preset"] = "better"
    elif path == "list":
        raw["presets"]["cheap"]["guard"]["fallback_models"] = ["ok", "bad\ud800"]
    else:
        raw["providers"]["openrouter"]["app_name"] = "x\x00"
    with pytest.raises(LLMConfigError, match="NUL"):
        parse_llm_config(raw)
