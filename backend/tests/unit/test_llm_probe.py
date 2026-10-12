from app.config import Settings
from app.services.llm import LLMResult
from app.services.llm_config import parse_llm_config, resolve_llm_config
from app.services.llm_probe import PROBE_MAX_TOKENS, ProbeAnswer, probe
from tests.llm_helpers import MINIMAL, with_model

SETTINGS = Settings(_env_file=None, openrouter_api_key="sk-or-x")


def role(model="vendor/cheap", max_tokens=8192, timeout=300):
    raw = with_model(MINIMAL, "cheap", "synthesizer", model)
    raw["presets"]["cheap"]["synthesizer"].update(max_tokens=max_tokens, timeout_seconds=timeout)
    return resolve_llm_config(parse_llm_config(raw)).roles["synthesizer"]


class FakeLLM:
    def __init__(self, answer, cost=0.0001, error=None):
        self.model, self.answer, self.cost, self.error = "vendor/cheap", answer, cost, error

    async def ainvoke(self, system, user):
        if self.error:
            raise self.error
        return LLMResult(value=self.answer, cost_usd=self.cost, model=self.model, input_tokens=20, output_tokens=5)


async def test_a_working_model_reports_ok_cost_and_latency():
    seen = {}

    def build(r, settings, catalog, schema=None):
        seen.update(max_tokens=r.spec.max_tokens, timeout=r.spec.timeout_seconds, schema=schema)
        return FakeLLM(ProbeAnswer(ok=True, word="hello"))

    out = await probe(role(), SETTINGS, None, build=build)
    assert out["ok"] is True and out["error"] is None and out["cost_usd"] == 0.0001
    assert out["model"] == "vendor/cheap" and out["latency_ms"] >= 0
    assert seen == {"max_tokens": PROBE_MAX_TOKENS, "timeout": 60.0, "schema": ProbeAnswer}


async def test_small_limits_are_kept():
    seen = {}

    def build(r, settings, catalog, schema=None):
        seen.update(max_tokens=r.spec.max_tokens, timeout=r.spec.timeout_seconds)
        return FakeLLM(ProbeAnswer(ok=True, word="x"))

    await probe(role(max_tokens=100, timeout=10), SETTINGS, None, build=build)
    assert seen == {"max_tokens": 100, "timeout": 10}


async def test_failures_come_back_as_text_never_raise():
    out = await probe(role(), SETTINGS, None,
                      build=lambda *a, **k: FakeLLM(None, error=RuntimeError("model not found")))
    assert out["ok"] is False and "model not found" in out["error"] and out["cost_usd"] == 0
    missing_key = await probe(role(), Settings(_env_file=None, openrouter_api_key=""), None)  # real builder
    assert missing_key["ok"] is False and "OPENROUTER_API_KEY" in missing_key["error"]


async def test_an_unexpected_answer_is_not_ok():
    out = await probe(role(), SETTINGS, None, build=lambda *a, **k: FakeLLM(ProbeAnswer(ok=False, word="no")))
    assert out["ok"] is False and out["error"] == "the model did not confirm"
