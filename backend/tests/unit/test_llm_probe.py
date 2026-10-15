import asyncio
import copy
import json

from app.config import Settings
from app.services import llm_probe
from app.services.budget import current_budget
from app.services.llm import LLMResult
from app.services.llm_config import parse_llm_config, resolve_llm_config
from app.services.llm_probe import PROBE_MAX_TOKENS, ProbeAnswer, probe
from tests.fake_openai import FakeOpenAIServer, completion_body
from tests.llm_helpers import MINIMAL, with_model

SETTINGS = Settings(_env_file=None, openrouter_api_key="sk-or-x")


def role(model="vendor/cheap", max_tokens=8192, timeout=300, fallback_models=()):
    raw = with_model(MINIMAL, "cheap", "synthesizer", model)
    raw["presets"]["cheap"]["synthesizer"].update(max_tokens=max_tokens, timeout_seconds=timeout,
                                                  fallback_models=list(fallback_models))
    return resolve_llm_config(parse_llm_config(raw)).roles["synthesizer"]


class FakeLLM:
    def __init__(self, answer, cost=0.0001, error=None, delay=0.0):
        self.model, self.answer, self.cost, self.error, self.delay = "vendor/cheap", answer, cost, error, delay

    async def ainvoke(self, system, user):
        if self.delay:
            await asyncio.sleep(self.delay)
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


async def test_failures_come_back_as_text_never_raise(monkeypatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)  # the real builder falls back to the environment
    out = await probe(role(), SETTINGS, None,
                      build=lambda *a, **k: FakeLLM(None, error=RuntimeError("model not found")))
    assert out["ok"] is False and "model not found" in out["error"] and out["cost_usd"] == 0
    missing_key = await probe(role(), Settings(_env_file=None, openrouter_api_key=""), None)  # real builder
    assert missing_key["ok"] is False and "OPENROUTER_API_KEY" in missing_key["error"]


async def test_an_unexpected_answer_is_not_ok():
    out = await probe(role(), SETTINGS, None, build=lambda *a, **k: FakeLLM(ProbeAnswer(ok=False, word="no")))
    assert out["ok"] is False and out["error"] == "the model did not confirm"


async def test_the_whole_call_is_bounded_not_just_one_http_attempt(monkeypatch):
    monkeypatch.setattr(llm_probe, "PROBE_TIMEOUT_SECONDS", 0.05)
    started = asyncio.get_running_loop().time()
    out = await probe(role(), SETTINGS, None, build=lambda *a, **k: FakeLLM(ProbeAnswer(ok=True), delay=5))
    assert out["ok"] is False and out["error"] == "timed out after 0.05 s" and out["cost_usd"] == 0
    assert asyncio.get_running_loop().time() - started < 2


async def test_fallback_models_are_dropped_so_the_primary_is_what_is_tested():
    seen = {}

    def build(r, settings, catalog, schema=None):
        seen["fallbacks"] = r.spec.fallback_models
        return FakeLLM(ProbeAnswer(ok=True, word="x"))

    configured = role(fallback_models=["vendor/other"])
    assert configured.spec.fallback_models == ["vendor/other"]
    await probe(configured, SETTINGS, None, build=build)
    assert seen == {"fallbacks": []}


def role_with_extra_body(extra_body, provider="openrouter", base_url=None):
    raw = copy.deepcopy(MINIMAL)
    if provider == "openai_compatible":
        raw["providers"]["openai_compatible"] = {"base_url": base_url, "api_key_env": "OPENAI_COMPATIBLE_API_KEY"}
        raw["presets"]["cheap"]["synthesizer"]["provider"] = "openai_compatible"
    raw["presets"]["cheap"]["synthesizer"].update(max_tokens=8192, extra_body=extra_body)
    return resolve_llm_config(parse_llm_config(raw)).roles["synthesizer"]


async def test_extra_body_cannot_lift_the_probes_caps():
    seen = {}

    def build(r, settings, catalog, schema=None):
        seen.update(r.spec.extra_body)
        return FakeLLM(ProbeAnswer(ok=True, word="x"))

    extra = {"max_tokens": 99999, "max_completion_tokens": 99999, "models": ["vendor/a", "vendor/b"],
             "provider": {"order": ["acme"]}, "top_k": 5}
    configured = role_with_extra_body(extra)
    await probe(configured, SETTINGS, None, build=build)
    assert seen == {"provider": {"order": ["acme"]}, "top_k": 5}  # the caps and the fallback list are gone
    assert configured.spec.extra_body == extra  # the configured role itself is untouched


async def test_the_request_on_the_wire_still_asks_for_at_most_the_probe_tokens():
    server = FakeOpenAIServer().start()
    try:
        server.replies.append(completion_body(json.dumps({"ok": True, "word": "hi"})))
        configured = role_with_extra_body({"max_tokens": 99999, "max_completion_tokens": 99999, "models": ["x/y"]},
                                          provider="openai_compatible", base_url=server.url)
        out = await probe(configured, SETTINGS, None)
    finally:
        server.stop()
    assert out["ok"] is True, out
    body = server.requests[0]
    limits = [body[k] for k in ("max_tokens", "max_completion_tokens") if k in body]
    assert limits and set(limits) == {PROBE_MAX_TOKENS} and "models" not in body


class CountingLLM(FakeLLM):
    calls = 0

    async def ainvoke(self, system, user):
        type(self).calls += 1
        return await super().ainvoke(system, user)


async def test_the_budget_is_a_gate_before_the_call_and_the_call_itself_is_bounded_by_its_tokens(monkeypatch):
    CountingLLM.calls = 0
    expensive = CountingLLM(ProbeAnswer(ok=True, word="x"), cost=0.2)  # more than PROBE_BUDGET_USD
    out = await probe(role(), SETTINGS, None, build=lambda *a, **k: expensive)
    assert out["ok"] is True and out["cost_usd"] == 0.2 and CountingLLM.calls == 1  # charged after: the one call ran
    monkeypatch.setattr(llm_probe, "PROBE_BUDGET_USD", 0.0)  # a spent budget refuses the call before it is made
    out = await probe(role(), SETTINGS, None, build=lambda *a, **k: expensive)
    assert out["ok"] is False and "cost cap" in out["error"] and out["cost_usd"] == 0 and CountingLLM.calls == 1


async def test_the_probes_budget_does_not_leak_into_the_caller():
    await probe(role(), SETTINGS, None, build=lambda *a, **k: FakeLLM(ProbeAnswer(ok=True)))
    assert current_budget() is None


def unpriced_role():
    raw = copy.deepcopy(MINIMAL)
    raw["providers"]["deepseek"] = {"kind": "openai_compatible", "base_url": "https://api.deepseek.com/v1"}
    raw["presets"]["cheap"]["synthesizer"] = {"model": "deepseek-chat", "provider": "deepseek"}
    return resolve_llm_config(parse_llm_config(raw)).roles["synthesizer"]


async def test_an_unpriced_role_reports_an_unknown_cost_not_zero():
    ok = await probe(unpriced_role(), SETTINGS, None,
                     build=lambda *a, **k: FakeLLM(ProbeAnswer(ok=True), cost=0.0))
    assert ok["ok"] is True and ok["priced"] is False and ok["cost_usd"] is None
    failed = await probe(unpriced_role(), SETTINGS, None,
                         build=lambda *a, **k: FakeLLM(ProbeAnswer(ok=True), error=RuntimeError("down")))
    assert failed["ok"] is False and failed["priced"] is False and failed["cost_usd"] is None


async def test_a_priced_role_reports_its_cost_on_success_and_failure():
    ok = await probe(role(), SETTINGS, None, build=lambda *a, **k: FakeLLM(ProbeAnswer(ok=True)))
    assert ok["priced"] is True and ok["cost_usd"] == 0.0001
    failed = await probe(role(), SETTINGS, None,
                         build=lambda *a, **k: FakeLLM(ProbeAnswer(ok=True), error=RuntimeError("down")))
    assert failed["priced"] is True and failed["cost_usd"] == 0
