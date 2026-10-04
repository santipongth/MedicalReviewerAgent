import json
from pathlib import Path

import pytest

from app.config import Settings
from app.graph.schemas import TopicVerdict
from app.services.llm import (
    AnthropicStructuredLLM,
    LLMError,
    LLMOutputError,
    LLMRefusal,
    MissingKeyLLM,
    OpenAICompatibleStructuredLLM,
    build_llms,
)
from app.services.model_catalog import parse_models
from tests.fake_openai import FakeOpenAIServer, completion_body

FIX = Path(__file__).parent.parent / "fixtures"
REPO_CONFIG = str(Path(__file__).parents[2] / "config" / "llm.yaml")
OK = json.dumps({"allowed": True, "reason": "medical", "english_topic": "metformin and CRC"})


@pytest.fixture
def fake_openai():
    server = FakeOpenAIServer().start()
    yield server
    server.stop()


def make(server, **kw):
    params = {"model": "deepseek/deepseek-v4-pro", "api_key": "sk-or-test", "base_url": server.url,
              "max_tokens": 512, "max_retries": 0}
    params.update(kw)
    return OpenAICompatibleStructuredLLM(TopicVerdict, **params)


async def test_openrouter_request_shape_and_cost_from_usage(fake_openai):
    fake_openai.replies.append(completion_body(OK, cost=0.000294))
    llm = make(fake_openai, temperature=0.2, reasoning_effort="high", require_parameters=True,
               fallback_models=["google/gemini-3.5-flash"], method="json_schema",
               headers={"HTTP-Referer": "http://localhost", "X-Title": "Medical Reviewer Agent"})
    res = await llm.ainvoke("You are a filter.", "<topic>เมตฟอร์มิน</topic>")
    assert res.value == TopicVerdict(allowed=True, reason="medical", english_topic="metformin and CRC")
    assert res.cost_usd == pytest.approx(0.000294) and (res.input_tokens, res.output_tokens) == (1000, 200)
    body = fake_openai.requests[0]
    assert body["model"] == "deepseek/deepseek-v4-pro" and body["temperature"] == 0.2
    assert body["response_format"]["type"] == "json_schema"
    assert body["response_format"]["json_schema"]["strict"] is True
    assert body["reasoning"] == {"effort": "high"}
    assert body["provider"] == {"require_parameters": True}
    assert body["models"] == ["deepseek/deepseek-v4-pro", "google/gemini-3.5-flash"]
    assert body["messages"][0] == {"role": "system", "content": "You are a filter."}
    assert fake_openai.headers[0]["x-title"] == "Medical Reviewer Agent"
    assert fake_openai.headers[0]["authorization"] == "Bearer sk-or-test"


async def test_cost_falls_back_to_catalog_prices(fake_openai):
    fake_openai.replies.append(completion_body(OK, cost=None, prompt_tokens=2_000_000, completion_tokens=0))
    price = parse_models(json.loads((FIX / "openrouter_models.json").read_text(encoding="utf-8")))[
        "google/gemini-2.5-flash-lite"]
    res = await make(fake_openai, model="google/gemini-2.5-flash-lite", price=price).ainvoke("s", "u")
    assert res.cost_usd == pytest.approx(0.2)


async def test_optional_params_are_omitted(fake_openai):
    fake_openai.replies.append(completion_body(OK))
    await make(fake_openai).ainvoke("s", "u")
    body = fake_openai.requests[0]
    for key in ("temperature", "top_p", "reasoning", "provider", "models"):
        assert key not in body


async def test_refusal_bad_json_and_http_errors_become_typed_errors(fake_openai):
    fake_openai.replies += [
        completion_body(None, refusal="I can't help with that"),
        completion_body("not json"),
        completion_body(OK, finish_reason="content_filter"),
        (402, {"error": {"message": "Insufficient credits", "code": 402}}),
    ]
    llm = make(fake_openai)
    with pytest.raises(LLMRefusal):
        await llm.ainvoke("s", "u")
    with pytest.raises(LLMOutputError):
        await llm.ainvoke("s", "u")
    with pytest.raises(LLMRefusal):
        await llm.ainvoke("s", "u")
    with pytest.raises(LLMError, match="402"):
        await llm.ainvoke("s", "u")


async def test_tool_calling_and_json_mode_paths(fake_openai):
    fake_openai.replies += [completion_body(tool_name="TopicVerdict", tool_args=OK), completion_body(OK)]
    tool = await make(fake_openai, method="tool_calling").ainvoke("s", "u")
    assert tool.value.allowed is True
    assert [t["function"]["name"] for t in fake_openai.requests[0]["tools"]] == ["TopicVerdict"]
    jm = await make(fake_openai, method="json_mode").ainvoke("Be a filter.", "u")
    assert jm.value.english_topic == "metformin and CRC"
    body = fake_openai.requests[1]
    assert body["response_format"] == {"type": "json_object"}
    assert "english_topic" in body["messages"][0]["content"]  # schema appended to the system prompt


def test_build_llms_uses_budget_preset_on_openrouter():
    settings = Settings(_env_file=None, llm_config_path=REPO_CONFIG, openrouter_api_key="sk-or-x")
    llms = build_llms(settings)
    assert isinstance(llms.guard.inner, OpenAICompatibleStructuredLLM)  # every role runs under the shared limit
    assert llms.guard.model == "qwen/qwen3.5-flash-02-23"
    assert llms.synthesizer.model == "qwen/qwen3.5-flash-02-23" and llms.synthesizer.reasoning_effort == "medium"
    assert llms.preset == "budget"
    assert llms.models["synthesizer"] == "openrouter:qwen/qwen3.5-flash-02-23"


def test_build_llms_catalog_chooses_structured_method():
    catalog = parse_models(json.loads((FIX / "openrouter_models.json").read_text(encoding="utf-8")))
    settings = Settings(_env_file=None, llm_config_path=REPO_CONFIG, openrouter_api_key="sk-or-x")
    llms = build_llms(settings, catalog=catalog)
    assert llms.extractor.method == "json_schema"


def test_build_llms_missing_key_names_the_env_var():
    llms = build_llms(Settings(_env_file=None, llm_config_path=REPO_CONFIG, openrouter_api_key=""))
    assert isinstance(llms.guard.inner, MissingKeyLLM) and llms.guard.env_name == "OPENROUTER_API_KEY"


def test_build_llms_claude_direct_preset():
    settings = Settings(_env_file=None, llm_config_path=REPO_CONFIG, llm_preset="claude_direct",
                        anthropic_api_key="sk-ant-x")
    llms = build_llms(settings)
    assert isinstance(llms.synthesizer.inner, AnthropicStructuredLLM)
    assert llms.synthesizer.model == "claude-opus-5-5" and llms.synthesizer.effort == "high"
    assert llms.guard.effort is None


async def test_missing_key_llm_message():
    with pytest.raises(LLMError, match="OPENROUTER_API_KEY"):
        await MissingKeyLLM("m", "OPENROUTER_API_KEY").ainvoke("s", "u")


def test_build_llms_wires_harness_roles_and_escalation_factory():
    from app.graph.schemas import ConflictNote, PaperCard, SynthesisNarrative

    settings = Settings(_env_file=None, llm_config_path=REPO_CONFIG, openrouter_api_key="sk-or-x")
    llms = build_llms(settings)
    assert llms.normalizer.model == llms.localizer.model == llms.extractor_secondary.model == "qwen/qwen3.5-flash-02-23"
    assert llms.synthesizer.schema is SynthesisNarrative and llms.conflict_explainer.schema is ConflictNote
    esc = llms.escalation(PaperCard)
    assert esc.model == "qwen/qwen3.5-flash-02-23" and esc.schema is PaperCard
    assert llms.escalation(PaperCard) is esc  # cached per schema
    assert llms.harness.dual_extraction is True and llms.harness.max_repairs == 2
