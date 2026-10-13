"""Plan 23e Task 4: the provider-key routes. A key is write-only: no answer, audit row, log line or Redis value carries
it, a refused key is never quoted, and every write moves mra:llm:keys_version."""
import copy
import json

import pytest
from cryptography.fernet import Fernet
from pydantic import SecretStr
from sqlalchemy import select

from app.db.models import AdminAudit, LlmProviderKey
from app.services.llm_store import KEYS_VERSION_KEY
from app.services.model_catalog import ModelInfo
from tests.admin_helpers import CSRF, admin_headers
from tests.llm_helpers import MINIMAL

BASE = "/api/v1/admin"
KEY = "sk-test-0000000000000000abcd"
NEW_KEY = "sk-test-1111111111111111efgh"
SECRET = Fernet.generate_key().decode()
CHEAP = ModelInfo("vendor/cheap", 100_000, 1e-7, 4e-7, frozenset({"structured_outputs"}))


def with_deepseek(base_url="https://api.deepseek.com/v1") -> dict:
    raw = copy.deepcopy(MINIMAL)
    raw["providers"]["deepseek"] = {"kind": "openai_compatible", "base_url": base_url, "require_parameters": False}
    raw["presets"]["cheap"]["extractor"] = {"model": "deepseek-chat", "provider": "deepseek", "price_in": 0.27,
                                            "price_out": 1.1}
    return raw


@pytest.fixture(autouse=True)
def fake_catalog(monkeypatch):
    async def load():
        return {CHEAP.id: CHEAP}

    monkeypatch.setattr("app.api.admin_models.load_live_catalog", load)


@pytest.fixture
def secret(app, monkeypatch):
    monkeypatch.setattr(app.state.deps.service.settings, "llm_keys_secret", SecretStr(SECRET))


@pytest.fixture
def probe_calls(monkeypatch):
    calls = []

    async def fake_probe(role, settings, catalog=None, keys=None):
        calls.append((role, keys))
        return {"ok": True, "latency_ms": 5, "cost_usd": 0.0001, "model": role.spec.model, "error": None}

    monkeypatch.setattr("app.api.admin_models.probe", fake_probe)
    return calls


async def save(client, h, raw, base=None):
    r = await client.post(f"{BASE}/llm-config", json={"config": raw, "base_version": base}, headers=h)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def provider(state, name):
    return next(p for p in state["providers"] if p["name"] == name)


async def audit_rows(session_factory):
    async with session_factory() as s:
        return list((await s.execute(select(AdminAudit).order_by(AdminAudit.id))).scalars())


async def redis_dump(redis) -> str:
    out = []
    for key in await redis.keys("*"):
        kind = await redis.type(key)
        if kind == "string":
            out.append(f"{key}={await redis.get(key)}")
        elif kind == "hash":
            out.append(f"{key}={await redis.hgetall(key)}")
        else:
            out.append(key)
    return "\n".join(out)


async def test_the_state_lists_each_provider_without_any_key(client, session_factory, secret):
    h = await admin_headers(client, session_factory)
    await save(client, h, with_deepseek())
    state = (await client.get(f"{BASE}/llm-keys", headers=h)).json()
    assert (state["writable"], state["reason"], state["keys_version"], state["orphans"]) == (True, None, None, [])
    deepseek = provider(state, "deepseek")
    assert deepseek["kind"] == "openai_compatible" and deepseek["origin"] == "https://api.deepseek.com"
    assert deepseek["used_by"] == ["extractor", "conflict_explainer"]  # conflict_explainer copies the extractor
    assert deepseek["key"]["source"] == "none" and deepseek["key"]["last4"] is None and deepseek["keyless"] is False
    assert deepseek["env"] == {"name": "LLM_KEY_DEEPSEEK", "set": False, "origin_ok": False}
    assert provider(state, "openrouter")["env"]["name"] == "OPENROUTER_API_KEY"


async def test_set_replace_and_delete_never_echo_the_key_anywhere(client, app, session_factory, redis, secret,
                                                                  caplog, capsys):
    h = await admin_headers(client, session_factory)
    await save(client, h, with_deepseek())
    bodies = []
    r = await client.put(f"{BASE}/llm-keys/deepseek", json={"key": f"  {KEY}\n"}, headers=h)
    assert r.status_code == 200
    bodies.append(r.text)
    state = r.json()
    key = provider(state, "deepseek")["key"]
    assert (key["source"], key["last4"], key["bound_origin"], key["updated_by"]) == (
        "console", "abcd", "https://api.deepseek.com", "owner")
    assert state["keys_version"] == 1 and state["workers_notified"] is True and await redis.get(KEYS_VERSION_KEY) == "1"
    r = await client.put(f"{BASE}/llm-keys/deepseek", json={"key": NEW_KEY}, headers=h)
    bodies.append(r.text)
    assert provider(r.json(), "deepseek")["key"]["last4"] == "efgh" and r.json()["keys_version"] == 2
    for url in (f"{BASE}/llm-keys", f"{BASE}/llm-config", f"{BASE}/audit"):
        bodies.append((await client.get(url, headers=h)).text)
    bodies.append((await client.post(f"{BASE}/llm-config/validate", json={"config": with_deepseek()}, headers=h)).text)
    r = await client.delete(f"{BASE}/llm-keys/deepseek", headers=h)
    assert r.status_code == 200 and provider(r.json(), "deepseek")["key"]["source"] == "none"
    assert r.json()["keys_version"] == 3 and await redis.get(KEYS_VERSION_KEY) == "3"
    bodies.append(r.text)
    rows = await audit_rows(session_factory)
    actions = [row.action for row in rows if row.action.startswith("llm_key.")]
    assert actions == ["llm_key.set", "llm_key.replace", "llm_key.delete"]
    first = next(row for row in rows if row.action == "llm_key.set")
    assert first.after == {"provider": "deepseek", "kind": "openai_compatible", "origin": "https://api.deepseek.com",
                           "revision": 1} and first.target_id == "deepseek"
    async with session_factory() as s:
        stored = (await s.execute(select(LlmProviderKey))).scalar_one()
    everything = "\n".join([*bodies, json.dumps([[r.before, r.after] for r in rows]), await redis_dump(redis),
                            caplog.text, *capsys.readouterr(), stored.ciphertext or ""])
    for secret_text in (KEY, NEW_KEY, KEY[:-4], NEW_KEY[:-4]):
        assert secret_text not in everything


@pytest.mark.parametrize("payload", [{"key": "short"}, {"key": "sk-has a space-000000"}, {"key": 42},
                                     {"key": "x" * 600}, {"key": "sk-thái-00000000"}])
async def test_a_refused_key_is_never_quoted(client, session_factory, secret, payload):
    h = await admin_headers(client, session_factory)
    r = await client.put(f"{BASE}/llm-keys/openrouter", json=payload, headers=h)
    assert r.status_code == 422
    assert r.json() == {"detail": "the key must be 8 to 512 visible characters without spaces"}
    assert str(payload["key"]) not in r.text


@pytest.mark.parametrize("content", [b"not json", b"[]", b'{"nokey": 1}', b'{"key": "' + b"a" * 5000 + b'"}'])
async def test_a_body_that_is_not_a_small_key_object_is_a_fixed_422(client, session_factory, secret, content):
    h = await admin_headers(client, session_factory)
    r = await client.put(f"{BASE}/llm-keys/openrouter", content=content,
                         headers={**h, "Content-Type": "application/json"})
    assert r.status_code == 422 and r.json()["detail"].startswith("the body must be a JSON object")
    assert "aaaa" not in r.text and "not json" not in r.text


@pytest.mark.parametrize("value,code", [("", "no_secret"), ("not-a-key", "bad_secret")])
async def test_without_a_good_secret_the_tab_is_read_only_but_delete_works(client, app, session_factory, monkeypatch,
                                                                           value, code):
    h = await admin_headers(client, session_factory)
    monkeypatch.setattr(app.state.deps.service.settings, "llm_keys_secret", SecretStr(SECRET))
    assert (await client.put(f"{BASE}/llm-keys/openrouter", json={"key": KEY}, headers=h)).status_code == 200
    monkeypatch.setattr(app.state.deps.service.settings, "llm_keys_secret", SecretStr(value))
    state = (await client.get(f"{BASE}/llm-keys", headers=h)).json()
    assert (state["writable"], state["reason"]) == (False, code)
    assert provider(state, "openrouter")["key"]["problem"] == "unreadable"
    r = await client.put(f"{BASE}/llm-keys/openrouter", json={"key": NEW_KEY}, headers=h)
    assert r.status_code == 409 and r.json()["code"] == code and NEW_KEY not in r.text
    assert (await client.delete(f"{BASE}/llm-keys/openrouter", headers=h)).status_code == 200


async def test_delete_falls_back_to_the_env_key(client, app, session_factory, secret, monkeypatch):
    h = await admin_headers(client, session_factory)
    monkeypatch.setattr(app.state.deps.service.settings, "openrouter_api_key", "sk-or-from-env-0000")
    assert provider((await client.get(f"{BASE}/llm-keys", headers=h)).json(), "openrouter")["key"]["source"] == "env"
    await client.put(f"{BASE}/llm-keys/openrouter", json={"key": KEY}, headers=h)
    assert (await client.get(f"{BASE}/llm-config", headers=h)).json()["key_status"]["openrouter"] == "console"
    r = await client.delete(f"{BASE}/llm-keys/openrouter", headers=h)
    assert provider(r.json(), "openrouter")["key"]["source"] == "env"
    assert (await client.delete(f"{BASE}/llm-keys/openrouter", headers=h)).status_code == 404  # nothing left


async def test_unknown_providers_and_bad_names(client, session_factory, secret):
    h = await admin_headers(client, session_factory)
    r = await client.put(f"{BASE}/llm-keys/groq", json={"key": KEY}, headers=h)
    assert r.status_code == 404 and KEY not in r.text
    assert (await client.put(f"{BASE}/llm-keys/Bad-Name", json={"key": KEY}, headers=h)).status_code == 422
    assert (await client.delete(f"{BASE}/llm-keys/groq", headers=h)).status_code == 404


async def test_the_routes_need_an_admin_the_csrf_header_and_stay_out_of_openapi(client, app, session_factory, secret):
    assert (await client.get(f"{BASE}/llm-keys")).status_code == 401
    h = await admin_headers(client, session_factory)
    no_csrf = {k: v for k, v in h.items() if k not in CSRF}
    assert (await client.put(f"{BASE}/llm-keys/openrouter", json={"key": KEY}, headers=no_csrf)).status_code == 403
    assert (await client.delete(f"{BASE}/llm-keys/openrouter", headers=no_csrf)).status_code == 403
    assert not any("llm-keys" in path for path in app.openapi()["paths"])


async def test_key_changes_are_rate_limited(client, session_factory, secret):
    h = await admin_headers(client, session_factory)
    for _ in range(20):
        assert (await client.put(f"{BASE}/llm-keys/openrouter", json={"key": KEY}, headers=h)).status_code == 200
    r = await client.put(f"{BASE}/llm-keys/openrouter", json={"key": KEY}, headers=h)
    assert r.status_code == 429 and int(r.headers["Retry-After"]) >= 1


async def test_a_key_left_by_a_removed_provider_is_an_orphan_that_can_be_deleted(client, session_factory, secret):
    h = await admin_headers(client, session_factory)
    first = await save(client, h, with_deepseek())
    await client.put(f"{BASE}/llm-keys/deepseek", json={"key": KEY}, headers=h)
    await save(client, h, MINIMAL, base=first)
    state = (await client.get(f"{BASE}/llm-keys", headers=h)).json()
    assert [p["name"] for p in state["providers"]] == ["openrouter"]
    assert state["orphans"][0]["name"] == "deepseek" and state["orphans"][0]["last4"] == "abcd"
    r = await client.delete(f"{BASE}/llm-keys/deepseek", headers=h)
    assert r.status_code == 200 and r.json()["orphans"] == []


async def test_moving_a_providers_origin_silences_its_key_and_validate_says_so_first(client, session_factory, secret):
    h = await admin_headers(client, session_factory)
    first = await save(client, h, with_deepseek())
    await client.put(f"{BASE}/llm-keys/deepseek", json={"key": KEY}, headers=h)
    moved = with_deepseek("https://api.other.example/v1")
    report = (await client.post(f"{BASE}/llm-config/validate", json={"config": moved}, headers=h)).json()
    assert report["ok"] is True
    assert ("providers.deepseek: the stored key belongs to https://api.deepseek.com; after saving, deepseek gets no "
            "key until one is entered for https://api.other.example") in report["warnings"]
    await save(client, h, moved, base=first)
    state = (await client.get(f"{BASE}/llm-keys", headers=h)).json()
    key = provider(state, "deepseek")["key"]
    assert (key["source"], key["problem"], key["bound_origin"]) == ("none", "origin_mismatch",
                                                                   "https://api.deepseek.com")
    config_state = (await client.get(f"{BASE}/llm-config", headers=h)).json()
    assert config_state["key_status"]["deepseek"] == "origin_mismatch"
    assert config_state["keys_present"]["LLM_KEY_DEEPSEEK"] is False


async def test_the_config_state_reports_key_status_and_known_prices(client, session_factory):
    h = await admin_headers(client, session_factory)
    raw = with_deepseek()
    raw["providers"]["ollama"] = {"kind": "openai_compatible", "base_url": "http://localhost:11434/v1"}
    await save(client, h, raw)
    state = (await client.get(f"{BASE}/llm-config", headers=h)).json()
    assert state["key_status"] == {"openrouter": "none", "deepseek": "none", "ollama": "not_needed"}
    assert state["known_prices"]["claude-haiku-4-5"] == [1.0, 5.0]
    assert state["keys_present"] == {"OPENROUTER_API_KEY": False, "LLM_KEY_DEEPSEEK": False, "LLM_KEY_OLLAMA": False}


async def test_a_provider_can_be_tested_with_a_model_before_any_preset_uses_it(client, session_factory, secret,
                                                                               probe_calls):
    h = await admin_headers(client, session_factory)
    raw = with_deepseek()
    raw["presets"]["cheap"]["extractor"] = {"model": "vendor/cheap"}  # nothing uses deepseek now
    await save(client, h, raw)
    await client.put(f"{BASE}/llm-keys/deepseek", json={"key": KEY}, headers=h)
    r = await client.post(f"{BASE}/llm-models/test", headers=h,
                          json={"provider": "deepseek", "model": "deepseek-chat", "price_in": 0.27, "price_out": 1.1})
    assert r.status_code == 200 and r.json()["ok"] is True
    [(role, keys)] = probe_calls
    assert (role.provider, role.kind, role.spec.model, role.spec.price_in) == (
        "deepseek", "openai_compatible", "deepseek-chat", 0.27)
    assert set(keys.entries) == {"deepseek"}
    row = next(r for r in await audit_rows(session_factory) if r.action == "llm.test")
    assert row.after["kind"] == "openai_compatible" and row.after["key_source"] == "console"
    assert row.after["base_url_host"] == "api.deepseek.com" and KEY not in json.dumps(row.after)
    for body in ({"provider": "deepseek"}, {"provider": "groq", "model": "m"}, {"role": "guard", "provider": "deepseek",
                                                                               "model": "m"}, {}):
        assert (await client.post(f"{BASE}/llm-models/test", json=body, headers=h)).status_code == 422
    assert len(probe_calls) == 1


async def test_a_draft_that_moves_the_origin_tests_without_the_stored_key(client, session_factory, secret,
                                                                         probe_calls):
    h = await admin_headers(client, session_factory)
    await save(client, h, with_deepseek())
    await client.put(f"{BASE}/llm-keys/deepseek", json={"key": KEY}, headers=h)
    moved = with_deepseek("https://api.other.example/v1")
    r = await client.post(f"{BASE}/llm-models/test", json={"config": moved, "role": "extractor"}, headers=h)
    assert r.status_code == 200
    row = next(r for r in await audit_rows(session_factory) if r.action == "llm.test")
    assert row.after["key_source"] == "none" and row.after["base_url_host"] == "api.other.example"
