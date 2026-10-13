from pathlib import Path

import pytest
from pydantic import ValidationError

from app.services.llm_config import (
    OPTIONAL_ROLES,
    ROLES,
    HarnessSpec,
    LLMConfigError,
    load_llm_config,
)

REPO_CONFIG = Path(__file__).parents[2] / "config" / "llm.yaml"

MINIMAL = """
active_preset: cheap
default_provider: openrouter
providers:
  openrouter: {base_url: https://openrouter.ai/api/v1, api_key_env: OPENROUTER_API_KEY, app_name: MRA}
  anthropic: {api_key_env: ANTHROPIC_API_KEY}
presets:
  cheap:
    guard:       {model: google/gemini-2.5-flash-lite, max_tokens: 1024, temperature: 0}
    planner:     {model: deepseek/deepseek-v4-pro}
    screener:    {model: google/gemini-2.5-flash-lite}
    extractor:   {model: deepseek/deepseek-v4-pro, max_tokens: 8192}
    synthesizer: {model: deepseek/deepseek-v4-pro, reasoning_effort: high, fallback_models: [google/gemini-3.5-flash]}
  direct:
    guard:       {model: claude-haiku-4-5, provider: anthropic}
    planner:     {model: claude-sonnet-5-5, provider: anthropic, reasoning_effort: medium}
    screener:    {model: claude-haiku-4-5, provider: anthropic}
    extractor:   {model: claude-sonnet-5-5, provider: anthropic}
    synthesizer: {model: claude-opus-5-5, provider: anthropic, reasoning_effort: high, max_tokens: 20000}
overrides:
  extractor: {temperature: 0.1}
"""


def write(tmp_path, text):
    p = tmp_path / "llm.yaml"
    p.write_text(text, encoding="utf-8")
    return p


def test_active_preset_resolves_every_role_with_defaults_and_overrides(tmp_path):
    cfg = load_llm_config(write(tmp_path, MINIMAL))
    assert cfg.preset == "cheap" and set(ROLES) <= set(cfg.roles)
    guard = cfg.roles["guard"]
    assert (guard.provider, guard.spec.model, guard.spec.max_tokens, guard.spec.temperature) == (
        "openrouter", "google/gemini-2.5-flash-lite", 1024, 0.0)
    assert cfg.roles["planner"].spec.max_tokens == 4096 and cfg.roles["planner"].spec.structured_output == "auto"
    assert cfg.roles["extractor"].spec.temperature == 0.1  # override applied on top of the preset
    assert cfg.roles["synthesizer"].spec.fallback_models == ["google/gemini-3.5-flash"]
    described = cfg.describe()
    assert described["guard"] == "openrouter:google/gemini-2.5-flash-lite"
    assert described["synthesizer"] == "openrouter:deepseek/deepseek-v4-pro"


def test_optional_roles_fall_back_or_stay_disabled_and_harness_defaults(tmp_path):
    cfg = load_llm_config(write(tmp_path, MINIMAL))
    assert cfg.roles["normalizer"].spec.model == cfg.roles["planner"].spec.model
    assert cfg.roles["conflict_explainer"].spec.model == cfg.roles["extractor"].spec.model
    assert cfg.roles["localizer"].spec.model == cfg.roles["planner"].spec.model
    for disabled in ("screener_secondary", "extractor_secondary", "escalation"):
        assert disabled not in cfg.roles
    assert cfg.harness.max_repairs == 2 and cfg.harness.screen_borderline == (35, 70)
    assert set(cfg.harness.escalate_on) == {"repair_failed", "verification_failed", "disagreement"}


def test_explicit_optional_roles_and_harness_section(tmp_path):
    text = MINIMAL.replace("  direct:", """    screener_secondary: {model: qwen/qwen3.8-flash}
    escalation: {model: qwen/qwen3.8-max-0902, reasoning_effort: medium}
  direct:""").replace("overrides:", """harness:
  max_repairs: 1
  dual_extraction: false
  screen_borderline: [40, 60]
overrides:""")
    cfg = load_llm_config(write(tmp_path, text))
    assert cfg.roles["screener_secondary"].spec.model == "qwen/qwen3.8-flash"
    assert cfg.roles["escalation"].spec.reasoning_effort == "medium"
    assert "extractor_secondary" not in cfg.roles
    assert (cfg.harness.max_repairs, cfg.harness.dual_extraction, cfg.harness.screen_borderline) == (1, False, (40, 60))
    assert set(OPTIONAL_ROLES) >= {"screener_secondary", "extractor_secondary", "escalation"}


def test_preset_argument_and_per_role_provider(tmp_path):
    cfg = load_llm_config(write(tmp_path, MINIMAL), preset="direct")
    assert cfg.preset == "direct"
    assert cfg.roles["synthesizer"].provider == "anthropic"
    assert cfg.roles["synthesizer"].provider_spec.api_key_env == "ANTHROPIC_API_KEY"
    assert cfg.roles["extractor"].spec.temperature == 0.1  # overrides apply to every preset


@pytest.mark.parametrize(
    "mutation,message",
    [
        (lambda t: t.replace("active_preset: cheap", "active_preset: nope"), "Unknown preset 'nope'"),
        (lambda t: t.replace("reasoning_effort: high, fallback", "reasoning_effort: extreme, fallback"), "reasoning_effort"),
        (lambda t: t.replace("    screener:    {model: google/gemini-2.5-flash-lite}\n", "", 1), "missing roles: screener"),
        (lambda t: t.replace("provider: anthropic}", "provider: bedrock}", 1), "Provider 'bedrock' is not configured"),
        (lambda t: t.replace("  anthropic: {api_key_env: ANTHROPIC_API_KEY}\n", ""), "Provider 'anthropic' is not configured"),
        (lambda t: t.replace("temperature: 0}", "temperature: 5}"), "temperature"),
    ],
)
def test_invalid_configs_raise_clear_errors(tmp_path, mutation, message):
    # every preset is validated up front, so a broken preset fails even when another one is active
    with pytest.raises(LLMConfigError, match=message):
        load_llm_config(write(tmp_path, mutation(MINIMAL)))


def test_missing_file_is_a_clear_error(tmp_path):
    with pytest.raises(LLMConfigError, match="not found"):
        load_llm_config(tmp_path / "absent.yaml")


def test_repo_config_has_budget_default_and_all_presets_valid():
    cfg = load_llm_config(REPO_CONFIG)
    assert cfg.preset == "budget"
    # user decision 2026-10-05: every primary budget role runs on Qwen3.5 Flash. Plan 19 (audit I-10): the second
    # vote / cross-check and the escalation are other model families, so "two models vote" is true and escalation
    # never re-asks a model that already answered.
    second_opinion = {"screener_secondary", "extractor_secondary", "escalation"}
    qwen = {name: r for name, r in cfg.roles.items() if name not in second_opinion}
    assert {r.spec.model for r in qwen.values()} == {"qwen/qwen3.5-flash-02-23"}
    assert {r.spec.reasoning_effort for r in qwen.values()} == {"none"}  # Qwen3.5 Flash breaks JSON when reasoning
    models = {name: cfg.roles[name].spec.model for name in second_opinion}
    assert models["screener_secondary"].split("/")[0] != "qwen" and models["extractor_secondary"].split("/")[0] != "qwen"
    assert models["escalation"] not in {cfg.roles["screener"].spec.model, models["screener_secondary"]}
    claude = load_llm_config(REPO_CONFIG, preset="claude")
    assert claude.roles["screener_secondary"].spec.model != claude.roles["screener"].spec.model
    for name in ("budget", "balanced", "claude", "gemini", "claude_direct"):
        resolved = load_llm_config(REPO_CONFIG, preset=name)
        assert set(resolved.roles) == set(ROLES) | set(OPTIONAL_ROLES)  # every repo preset sets all roles
    budget = load_llm_config(REPO_CONFIG)
    assert budget.harness.dual_extraction is True and budget.harness.localize is True
    direct = load_llm_config(REPO_CONFIG, preset="claude_direct")
    assert {r.provider for r in direct.roles.values()} == {"anthropic"}


@pytest.mark.parametrize("band", [(70, 35), (-1, 50), (40, 101), (10**9, 10**9)])
def test_screen_borderline_is_an_ordered_band_of_relevance_scores(band):
    with pytest.raises(ValidationError, match="screen_borderline"):
        HarnessSpec(screen_borderline=band)
    assert HarnessSpec(screen_borderline=(0, 100)).screen_borderline == (0, 100)
    assert HarnessSpec(screen_borderline=(50, 50)).screen_borderline == (50, 50)
