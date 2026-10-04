import json
from pathlib import Path

import httpx
import pytest
import respx

from app.services.http import HttpClient
from app.services.llm_config import load_llm_config
from app.services.model_catalog import (
    OPENROUTER_MODELS_URL,
    OpenRouterCatalog,
    choose_structured_method,
    parse_models,
    validate_role,
)

FIX = Path(__file__).parent.parent / "fixtures"
REPO_CONFIG = Path(__file__).parents[2] / "config" / "llm.yaml"


def catalog():
    return parse_models(json.loads((FIX / "openrouter_models.json").read_text(encoding="utf-8")))


def test_parse_models_prices_per_token_and_capabilities():
    models = catalog()
    lite = models["google/gemini-2.5-flash-lite"]
    assert lite.price_in == pytest.approx(0.1e-6) and lite.price_out == pytest.approx(0.4e-6)
    assert lite.supports("structured_outputs") and lite.context_length >= 1_000_000
    assert lite.cost(1_000_000, 1_000_000) == pytest.approx(0.5)
    assert models["meta-llama/llama-4-scout"].supports("reasoning") is False


def test_auto_structured_method_follows_capabilities():
    models = catalog()
    assert choose_structured_method("auto", models["deepseek/deepseek-v4-pro"]) == "json_schema"
    assert choose_structured_method("auto", models["deepseek/deepseek-r1"]) == "function_calling"  # tools, no strict SO
    assert choose_structured_method("auto", models["tencent/hy-mt2-1.8b"]) == "json_mode"
    assert choose_structured_method("auto", None) == "json_schema"
    assert choose_structured_method("tool_calling", models["deepseek/deepseek-v4-pro"]) == "function_calling"
    assert choose_structured_method("json_mode", None) == "json_mode"


def test_repo_presets_on_openrouter_validate_against_the_catalog():
    models = catalog()
    for name in ("budget", "balanced", "claude", "gemini"):
        cfg = load_llm_config(REPO_CONFIG, preset=name)
        problems = [p for r in cfg.roles.values() for p in validate_role(r, models)]
        assert problems == [], (name, problems)


def test_validate_role_reports_unknown_model_and_unsupported_reasoning(tmp_path):
    text = REPO_CONFIG.read_text(encoding="utf-8")
    cfg = load_llm_config(REPO_CONFIG)
    models = catalog()
    synth = cfg.roles["synthesizer"]
    bad_model = synth.with_spec(model="vendor/does-not-exist")
    assert any("not found on OpenRouter" in p for p in validate_role(bad_model, models))
    no_reasoning = synth.with_spec(model="meta-llama/llama-4-scout", reasoning_effort="high")
    assert any("reasoning" in p for p in validate_role(no_reasoning, models))
    too_long = synth.with_spec(model="tencent/hy-mt2-1.8b", max_tokens=10_000_000)
    assert any("context" in p for p in validate_role(too_long, models))
    assert text  # repo config readable


@respx.mock
async def test_catalog_loads_from_openrouter():
    body = (FIX / "openrouter_models.json").read_text(encoding="utf-8")
    respx.get(OPENROUTER_MODELS_URL).mock(return_value=httpx.Response(200, text=body))
    http = HttpClient(retries=0)
    models = await OpenRouterCatalog(http).load()
    await http.aclose()
    assert "deepseek/deepseek-v4-pro" in models and len(models) == 16
