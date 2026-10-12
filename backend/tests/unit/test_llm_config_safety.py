"""Hostile or malformed LLM config documents (Plan 23b task 8 fix round 1): secrets stay with their provider, YAML
cannot blow up memory, and every bad document is an LLMConfigError, never another exception type."""
import copy
from pathlib import Path

import pytest
import yaml

from app.services.llm_config import (
    LLMConfigError,
    ensure_storable,
    has_bad_text,
    load_llm_config,
    parse_llm_config,
    parse_yaml_text,
    read_llm_yaml,
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


# --- fix round 2 -------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("name,env", [
    ("openrouter", "ANTHROPIC_API_KEY"),
    ("openrouter", "OPENALEX_API_KEY"),
    ("openrouter", "OPENAI_COMPATIBLE_API_KEY"),
    ("anthropic", "OPENROUTER_API_KEY"),
    ("openai_compatible", "OPENROUTER_API_KEY"),
    ("openai_compatible", "ANTHROPIC_API_KEY"),
])
def test_each_provider_may_only_name_its_own_key(name, env):
    with pytest.raises(LLMConfigError, match=f"providers.{name}.api_key_env must be {name.upper()}_API_KEY"):
        parse_llm_config(provider(MINIMAL, name, api_key_env=env))


@pytest.mark.parametrize("url", [
    "http://[evil", "http://[::1", "http://a]b/", "http://ex℀ample.com/v1", "http://", "http:///v1",
    "ftp://models.example.org/v1", "javascript:alert(1)", "models.example.org/v1", "http://localhost:99999/v1",
    "http://local host/v1", "http://models.example.org/v1\n", "http://modéls.example.org/v1",
])
def test_a_local_model_server_url_must_be_a_plain_http_url_with_a_host(url):
    ok = {"api_key_env": "OPENAI_COMPATIBLE_API_KEY"}
    with pytest.raises(LLMConfigError, match="openai_compatible.base_url"):
        parse_llm_config(provider(MINIMAL, "openai_compatible", base_url=url, **ok))


@pytest.mark.parametrize("url", ["http://localhost:11434/v1", "http://host.docker.internal:11434/v1",
                                 "https://models.example.org/v1", "http://127.0.0.1:8080", "http://[::1]:11434/v1"])
def test_ordinary_local_model_server_urls_pass(url):
    parse_llm_config(provider(MINIMAL, "openai_compatible", base_url=url, api_key_env="OPENAI_COMPATIBLE_API_KEY"))


def test_binary_scalars_cannot_smuggle_a_nul_past_the_text_check():
    # base64 of "ch\0eap": the YAML loader would hand pydantic bytes, which it turns into a str holding the NUL
    for text in ("a: !!binary Y2gAZWFw", "? !!binary Y2gAZWFw\n: 1", "a: [!!binary Y2gAZWFw]"):
        with pytest.raises(LLMConfigError, match="binary"):
            parse_yaml_text(text)
    assert yaml.safe_load("a: !!binary Y2gAZWFw") == {"a": b"ch\x00eap"}  # the shared SafeLoader is left alone
    assert has_bad_text(b"ch\x00eap") and has_bad_text({b"k": 1}) and has_bad_text([bytearray(b"x")])
    raw = copy.deepcopy(MINIMAL)
    raw["presets"]["cheap"]["guard"]["model"] = b"vendor/a\x00b"
    with pytest.raises(LLMConfigError, match="NUL"):
        parse_llm_config(raw)
    assert has_bad_text({"a\x00": 1}) and has_bad_text([{"a\x00"}, 1]) and has_bad_text(frozenset({b"x"}))  # and sets
    assert not has_bad_text({"a": [1, 2.5, None, True, "ok"], "b": {"c": "d"}})


def test_values_the_json_column_cannot_store_are_refused():
    big = int("f" * 4000, 16)  # about 4800 decimal digits: json.dumps refuses to print it
    ensure_storable({"a": 1})
    for bad in ({"a": big}, {"a": float("nan")}, {"a": float("inf")}, {"a": object()}):
        with pytest.raises(LLMConfigError, match="stored"):
            ensure_storable(bad)


# --- fix round 3 -------------------------------------------------------------------------------------------------

MISMATCHED_TAGS = [
    'a: !!bool maybe', 'a: !!bool ""', "? !!bool maybe\n: 1",  # KeyError in SafeConstructor
    "a: !!timestamp abc", 'a: !!timestamp ""', "a: !!timestamp 2020-01-01 1:2:3 +5", "a: [!!timestamp x]",  # AttributeError
    'a: !!int ""', 'a: !!int "-"', 'a: !!int "+"', "a: !!int _", 'a: !!int "-_"', 'a: !!float ""', "a: !!float _",  # IndexError
]


@pytest.mark.parametrize("text", MISMATCHED_TAGS)
def test_a_tag_that_does_not_fit_its_value_is_a_bad_document_not_a_crash(text):
    with pytest.raises(LLMConfigError, match="invalid YAML"):
        parse_yaml_text(text)


def test_the_operators_file_gets_the_same_treatment(tmp_path):
    bad = tmp_path / "llm.yaml"
    bad.write_text("a: !!bool maybe\n", encoding="utf-8")
    with pytest.raises(LLMConfigError, match="invalid YAML"):
        read_llm_yaml(bad)
    bad.write_bytes(b"a: \xff\xfe\n")
    with pytest.raises(LLMConfigError, match="not valid UTF-8"):
        read_llm_yaml(bad)


@pytest.mark.parametrize("field,value", [
    ("app_name", "Reviewer\r\nX-Evil: 1"), ("app_name", "Reviewer\n"), ("app_name", "tab\there"),
    ("app_name", "Réviewer"), ("app_name", "bell\x07"),
    ("app_url", "javascript:alert(1)"), ("app_url", "http://[x"), ("app_url", "http://host.example.org\r\nX-Evil: 1"),
    ("app_url", "http://hôst.example.org"), ("app_url", "http://"), ("app_url", "ftp://host.example.org/"),
])
def test_header_values_are_visible_ascii_and_the_app_url_is_a_url(field, value):
    with pytest.raises(LLMConfigError, match=field):
        parse_llm_config(provider(MINIMAL, **{field: value}))


def test_ordinary_header_values_pass():
    parse_llm_config(provider(MINIMAL, app_name="Medical Reviewer Agent v1.2 (prod)", app_url="http://localhost"))
    parse_llm_config(provider(MINIMAL, app_name="", app_url=""))
    load_llm_config(REPO_CONFIG)
