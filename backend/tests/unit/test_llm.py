import json

import pytest

from app.graph.schemas import TopicVerdict
from app.services.llm import (
    AnthropicStructuredLLM,
    LLMError,
    LLMOutputError,
    LLMRefusal,
    MissingKeyLLM,
    estimate_cost,
)
from tests.fake_anthropic import message_body


def test_estimate_cost_uses_per_model_prices():
    assert estimate_cost("claude-opus-5-5", 1_000_000, 100_000) == pytest.approx(4.0 + 2.0)
    assert estimate_cost("claude-haiku-4-5", 2000, 1000) == pytest.approx(0.002 + 0.005)
    assert estimate_cost("unknown-model", 10, 10) == 0.0


async def test_anthropic_llm_sends_json_schema_and_effort_and_parses(fake_anthropic):
    fake_anthropic.replies.append(message_body(
        json.dumps({"allowed": True, "reason": "medical", "english_topic": "metformin and colorectal cancer"}),
        model="claude-sonnet-5-5", input_tokens=2000, output_tokens=100,
    ))
    llm = AnthropicStructuredLLM(TopicVerdict, model="claude-sonnet-5-5", api_key="sk-test",
                                 max_tokens=1024, effort="medium", base_url=fake_anthropic.url, max_retries=0)
    res = await llm.ainvoke("You are a filter.", "<topic>เมตฟอร์มิน</topic>")
    assert res.value == TopicVerdict(allowed=True, reason="medical", english_topic="metformin and colorectal cancer")
    assert res.cost_usd == pytest.approx(estimate_cost("claude-sonnet-5-5", 2000, 100))
    req = fake_anthropic.requests[0]
    assert req["model"] == "claude-sonnet-5-5" and req["system"] == "You are a filter."
    assert req["output_config"]["effort"] == "medium"
    assert req["output_config"]["format"]["type"] == "json_schema"
    assert "tool_choice" not in req and "tools" not in req
    assert req["messages"][0]["content"] == "<topic>เมตฟอร์มิน</topic>"


async def test_haiku_gets_no_effort(fake_anthropic):
    fake_anthropic.replies.append(message_body(json.dumps({"allowed": False, "reason": "x", "english_topic": "y"})))
    llm = AnthropicStructuredLLM(TopicVerdict, model="claude-haiku-4-5", api_key="sk-test",
                                 max_tokens=512, base_url=fake_anthropic.url, max_retries=0)
    await llm.ainvoke("s", "u")
    assert "effort" not in fake_anthropic.requests[0].get("output_config", {})


async def test_refusal_and_bad_json_raise_typed_errors(fake_anthropic):
    fake_anthropic.replies += [message_body("", stop_reason="refusal"), message_body("not json")]
    llm = AnthropicStructuredLLM(TopicVerdict, model="claude-sonnet-5-5", api_key="sk-test",
                                 max_tokens=512, base_url=fake_anthropic.url, max_retries=0)
    with pytest.raises(LLMRefusal):
        await llm.ainvoke("s", "u")
    with pytest.raises(LLMOutputError):
        await llm.ainvoke("s", "u")


async def test_missing_key_llm_raises_clear_error():
    with pytest.raises(LLMError, match="ANTHROPIC_API_KEY"):
        await MissingKeyLLM("claude-haiku-4-5").ainvoke("s", "u")
