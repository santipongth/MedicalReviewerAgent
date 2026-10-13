"""Plan 23e Task 3: clients built with the console's keys. A key goes only to its origin, an OpenAI-compatible server is
spoken to in OpenAI's dialect and charged at the role's price, and a provider error never carries the key."""
import asyncio
import copy
import json

import pytest

from app.cli.eval import eval_keys
from app.config import Settings
from app.graph.factory import build_graph_deps
from app.graph.schemas import QueryPlan, TopicVerdict
from app.services.budget import ReviewBudget, use_budget
from app.services.llm import (
    LimitedLLM,
    LLMError,
    MissingKeyLLM,
    OpenAICompatibleStructuredLLM,
    build_llms,
    build_role_llm,
    estimate_cost,
    redact,
)
from app.services.llm_config import parse_llm_config, resolve_llm_config
from app.services.llm_keys import KeyRing, StoredKey
from app.services.llm_probe import probe
from app.services.model_catalog import FixedPrice
from tests.fake_openai import FakeOpenAIServer, completion_body
from tests.llm_helpers import MINIMAL

KEY = "sk-test-0000000000000000abcd"
ENV_KEY = "sk-env-1111111111111111wxyz"
OK = json.dumps({"allowed": True, "reason": "medical", "english_topic": "metformin"})
SETTINGS = Settings(_env_file=None, openrouter_api_key=ENV_KEY)


@pytest.fixture
def fake_openai():
    server = FakeOpenAIServer().start()
    yield server
    server.stop()


def config(name="local", base_url="http://127.0.0.1:9/api/v1", **role) -> dict:
    raw = copy.deepcopy(MINIMAL)
    raw["providers"][name] = {"kind": "openai_compatible", "base_url": base_url, "require_parameters": False}
    raw["presets"]["cheap"]["guard"] = {"model": "deepseek-chat", "provider": name, "price_in": 1.0,
                                        "price_out": 2.0, **role}
    return raw


def guard(raw: dict):
    return resolve_llm_config(parse_llm_config(raw)).roles["guard"]


def ring(**keys: tuple[str, str]) -> KeyRing:
    return KeyRing({name: StoredKey(value, origin, value[-4:]) for name, (value, origin) in keys.items()}, revision=1)


async def test_a_console_key_reaches_its_server_in_openai_dialect_and_the_role_price_is_charged(fake_openai):
    fake_openai.replies.append(completion_body(OK, cost=99.0, prompt_tokens=1_000_000, completion_tokens=500_000))
    role = guard(config(base_url=fake_openai.url, reasoning_effort="high", fallback_models=["other-model"]))
    llm = build_role_llm(role, SETTINGS, None, keys=ring(local=(KEY, f"http://127.0.0.1:{fake_openai.port}")))
    budget = ReviewBudget(cap_usd=10.0)
    with use_budget(budget):
        res = await LimitedLLM(llm, asyncio.Semaphore(1)).ainvoke("s", "u")
    assert fake_openai.headers[0]["authorization"] == f"Bearer {KEY}"
    body = fake_openai.requests[0]
    assert body["reasoning_effort"] == "high"
    for field in ("reasoning", "models", "provider"):  # OpenRouter-only fields stay at home
        assert field not in body
    assert res.cost_usd == pytest.approx(1.0 + 1.0)  # 1M in at $1 + 0.5M out at $2; the server's "cost" is ignored
    assert budget.spent == pytest.approx(2.0)


async def test_openrouter_keeps_its_reported_cost_and_falls_back_to_the_role_price(fake_openai):
    fake_openai.replies += [completion_body(OK, cost=0.000294), completion_body(OK, cost=None, prompt_tokens=1_000_000,
                                                                                 completion_tokens=0)]
    base = {"model": "m", "api_key": "sk-or-x", "base_url": fake_openai.url, "max_tokens": 64, "max_retries": 0}
    reported = await OpenAICompatibleStructuredLLM(TopicVerdict, price=FixedPrice(5, 5), **base).ainvoke("s", "u")
    assert reported.cost_usd == pytest.approx(0.000294)
    priced = await OpenAICompatibleStructuredLLM(TopicVerdict, price=FixedPrice(5, 5), **base).ainvoke("s", "u")
    assert priced.cost_usd == pytest.approx(5.0)
    raw = copy.deepcopy(MINIMAL)
    raw["presets"]["cheap"]["guard"].update(price_in=5, price_out=5)
    built = build_role_llm(guard(raw), SETTINGS, {})  # not in the catalog: the role's price
    assert built.price == FixedPrice(5, 5) and built.reported_cost is True


def test_an_anthropic_role_price_beats_the_table():
    assert estimate_cost("claude-haiku-4-5", 1_000_000, 0) == pytest.approx(1.0)
    assert estimate_cost("claude-haiku-4-5", 1_000_000, 0, FixedPrice(3, 15)) == pytest.approx(3.0)
    assert estimate_cost("claude-new-9", 1_000_000, 0) == 0.0


def test_the_console_key_beats_env_and_a_moved_origin_gets_none():
    raw = copy.deepcopy(MINIMAL)
    console = ring(openrouter=(KEY, "https://openrouter.ai"))
    assert build_role_llm(guard(raw), SETTINGS, None, keys=console)._key == KEY
    assert build_role_llm(guard(raw), SETTINGS, None)._key == ENV_KEY  # no ring: env, as before
    moved = config("deepseek", "https://api.deepseek.com/v1")
    elsewhere = ring(deepseek=(KEY, "https://api.other.example"))
    llm = build_role_llm(guard(moved), SETTINGS, None, keys=elsewhere)
    assert isinstance(llm, MissingKeyLLM)
    assert llm.reason == ("no key for provider deepseek (the stored key belongs to https://api.other.example; enter "
                          "one for https://api.deepseek.com)")


async def test_a_public_server_never_gets_an_anonymous_call_but_a_local_one_may():
    public = build_role_llm(guard(config("deepseek", "https://api.deepseek.com/v1")), SETTINGS, None)
    assert isinstance(public, MissingKeyLLM) and "LLM_KEY_DEEPSEEK" in public.reason
    with pytest.raises(LLMError, match="no key for provider deepseek"):
        await public.ainvoke("s", "u")
    local = build_role_llm(guard(config("ollama", "http://localhost:11434/v1")), SETTINGS, None)
    assert isinstance(local, OpenAICompatibleStructuredLLM) and local._key == "not-needed"
    legacy = copy.deepcopy(MINIMAL)
    legacy["providers"]["openai_compatible"] = {"base_url": "http://10.0.0.5:11434/v1"}
    legacy["presets"]["cheap"]["guard"] = {"model": "m", "provider": "openai_compatible", "price_in": 0, "price_out": 0}
    assert build_role_llm(guard(legacy), SETTINGS, None)._key == "not-needed"  # the legacy entry as before


async def test_a_review_never_calls_an_unpriced_public_server_but_a_test_call_may():
    unpriced = config("deepseek", "https://api.deepseek.com/v1")
    del unpriced["presets"]["cheap"]["guard"]["price_in"], unpriced["presets"]["cheap"]["guard"]["price_out"]
    console = ring(deepseek=(KEY, "https://api.deepseek.com"))
    resolved = resolve_llm_config(parse_llm_config(unpriced))  # a hand-edited llm.yaml: loading never checks prices
    llms = build_llms(SETTINGS, None, resolved=resolved, keys=console)
    assert isinstance(llms.guard.inner, MissingKeyLLM)
    with pytest.raises(LLMError, match="no price for model deepseek-chat on provider deepseek"):
        await llms.guard.ainvoke("s", "u")
    assert isinstance(llms.with_schema("guard", QueryPlan).inner, MissingKeyLLM)
    assert build_role_llm(guard(unpriced), SETTINGS, None, keys=console)._key == KEY  # the console's capped probe
    local = config("ollama", "http://localhost:11434/v1")
    del local["presets"]["cheap"]["guard"]["price_in"], local["presets"]["cheap"]["guard"]["price_out"]
    built = build_llms(SETTINGS, None, resolved=resolve_llm_config(parse_llm_config(local)))
    assert isinstance(built.guard.inner, OpenAICompatibleStructuredLLM)  # a local server costs nothing


def test_missing_key_messages_name_the_problem(monkeypatch):
    unreadable = KeyRing(unreadable=frozenset({"deepseek"}), state="bad_secret")
    llm = build_role_llm(guard(config("deepseek", "https://api.deepseek.com/v1")), SETTINGS, None, keys=unreadable)
    assert "cannot be read: LLM_KEYS_SECRET" in llm.reason
    monkeypatch.setenv("LLM_KEY_DEEPSEEK", ENV_KEY)
    llm = build_role_llm(guard(config("deepseek", "https://api.deepseek.com/v1")), SETTINGS, None)
    assert llm.reason == ("no key for provider deepseek (LLM_KEY_DEEPSEEK is set, but LLM_KEY_DEEPSEEK_ORIGIN is not "
                          "https://api.deepseek.com)")
    monkeypatch.setenv("LLM_KEY_DEEPSEEK_ORIGIN", "https://api.deepseek.com")
    assert build_role_llm(guard(config("deepseek", "https://api.deepseek.com/v1")), SETTINGS, None)._key == ENV_KEY
    plain = build_role_llm(guard(MINIMAL), Settings(_env_file=None), None)
    assert plain.reason is None and plain.env_name == "OPENROUTER_API_KEY"  # the legacy message is unchanged


def test_redact_hides_the_key_and_any_long_slice_of_it():
    assert redact(f"bad key {KEY} sent", KEY) == "bad key [redacted] sent"
    assert redact(f"key starts {KEY[:14]}… ends …{KEY[-13:]}", KEY) == "key starts [redacted]… ends …[redacted]"
    assert redact("nothing to hide here", KEY) == "nothing to hide here"
    assert redact(f"short {KEY[:11]} stays", KEY) == f"short {KEY[:11]} stays"  # under 12: could be anything
    assert redact("k=sk-short1", "sk-short1") == "k=[redacted]"
    assert redact("text", None) == "text" and redact("", KEY) == ""


async def test_a_provider_error_that_echoes_the_key_is_redacted(fake_openai):
    fake_openai.replies.append((401, {"error": {"message": f"Incorrect API key provided: {KEY}", "code": 401}}))
    role = guard(config(base_url=fake_openai.url))
    llm = build_role_llm(role, SETTINGS, None, keys=ring(local=(KEY, f"http://127.0.0.1:{fake_openai.port}")))
    with pytest.raises(LLMError) as caught:
        await llm.ainvoke("s", "u")
    assert KEY not in str(caught.value) and "[redacted]" in str(caught.value)
    assert caught.value.__cause__ is None and caught.value.__context__ is None


async def test_the_probe_uses_the_ring_and_redacts_what_it_reports():
    seen = {}

    def build(role, settings, catalog, schema=None, keys=None):
        seen["keys"] = keys
        raise RuntimeError(f"connection refused while sending {KEY}")

    console = ring(openrouter=(KEY, "https://openrouter.ai"))
    out = await probe(guard(MINIMAL), SETTINGS, None, build=build, keys=console)
    assert seen["keys"] is console and out["ok"] is False
    assert KEY not in out["error"] and "[redacted]" in out["error"]


def test_every_role_and_the_graph_deps_are_built_with_the_ring():
    console = ring(openrouter=(KEY, "https://openrouter.ai"))
    llms = build_llms(SETTINGS, None, resolved=resolve_llm_config(parse_llm_config(MINIMAL)), keys=console)
    assert llms.guard.inner._key == KEY and llms.refiner_critic.inner._key == KEY
    assert llms.with_schema("planner", QueryPlan).inner._key == KEY
    deps = build_graph_deps(SETTINGS, http=None, resolved=resolve_llm_config(parse_llm_config(MINIMAL)), keys=console)
    assert deps.llms.synthesizer.inner._key == KEY


async def test_an_eval_run_reads_the_ring_unless_given_a_config_file(session_factory, tmp_path):
    assert await eval_keys(SETTINGS, str(tmp_path / "llm.yaml"), lambda: session_factory) is None
    loaded = await eval_keys(SETTINGS, None, lambda: session_factory)
    assert isinstance(loaded, KeyRing) and loaded.revision is None
