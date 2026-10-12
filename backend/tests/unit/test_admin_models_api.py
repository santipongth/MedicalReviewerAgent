import copy
import json
import time

import pytest
import yaml
from sqlalchemy import func, select

from app.db.models import AdminAudit, LlmConfigVersion
from app.services.llm_store import LLM_VERSION_KEY
from app.services.model_catalog import ModelInfo
from tests.admin_helpers import admin_headers
from tests.llm_helpers import MINIMAL, with_model

BASE = "/api/v1/admin"
CHEAP = ModelInfo("vendor/cheap", 100_000, 1e-7, 4e-7, frozenset({"structured_outputs"}))


@pytest.fixture(autouse=True)
def fake_catalog(monkeypatch):
    async def load():
        return {CHEAP.id: CHEAP}

    monkeypatch.setattr("app.api.admin_models.load_live_catalog", load)


async def count(session_factory, action):
    async with session_factory() as s:
        return await s.scalar(select(func.count()).select_from(AdminAudit).where(AdminAudit.action == action))


async def test_state_shows_the_file_then_the_db(client, session_factory):
    h = await admin_headers(client, session_factory)
    state = (await client.get(f"{BASE}/llm-config", headers=h)).json()
    assert state["source"] == "file" and state["version"] is None and state["config"]["active_preset"]
    assert isinstance(state["keys_present"], dict) and state["loaded"] == []
    saved = await client.post(f"{BASE}/llm-config", json={"config": MINIMAL, "base_version": None}, headers=h)
    assert saved.status_code == 201
    state = (await client.get(f"{BASE}/llm-config", headers=h)).json()
    assert (state["source"], state["version"], state["active_preset"]) == ("db", saved.json()["id"], "cheap")


async def test_save_publishes_the_version_and_a_stale_base_is_409(client, session_factory, redis):
    h = await admin_headers(client, session_factory)
    first = (await client.post(f"{BASE}/llm-config", json={"config": MINIMAL, "base_version": None}, headers=h)).json()
    assert first["workers_notified"] is True
    assert await redis.get(LLM_VERSION_KEY) == str(first["id"])
    stale = await client.post(f"{BASE}/llm-config", json={"config": MINIMAL, "base_version": None}, headers=h)
    assert stale.status_code == 409 and "reload" in stale.json()["detail"]
    assert await count(session_factory, "llm_config.save") == 1


async def test_save_still_succeeds_when_workers_could_not_be_told(client, session_factory, monkeypatch):
    h = await admin_headers(client, session_factory)

    async def redis_down(redis, version_id):
        return False

    monkeypatch.setattr("app.api.admin_models.publish_version", redis_down)
    r = await client.post(f"{BASE}/llm-config", json={"config": MINIMAL, "base_version": None}, headers=h)
    assert r.status_code == 201 and r.json()["workers_notified"] is False
    async with session_factory() as s:
        assert await s.scalar(select(func.count()).select_from(LlmConfigVersion)) == 1


async def test_invalid_and_non_mapping_bodies_are_422(client, session_factory):
    h = await admin_headers(client, session_factory)
    for body in ({"config": {**MINIMAL, "active_preset": "missing"}, "base_version": None},
                 {"yaml": "- a\n- list\n", "base_version": None},
                 {"yaml": "just text", "base_version": None},
                 {"yaml": "", "base_version": None},
                 {"yaml": "presets: [unclosed", "base_version": None},
                 {"config": MINIMAL, "yaml": "x: 1", "base_version": None},
                 {"base_version": None}):
        r = await client.post(f"{BASE}/llm-config", json=body, headers=h)
        assert r.status_code == 422, (body, r.text)
    async with session_factory() as s:
        assert await s.scalar(select(func.count()).select_from(LlmConfigVersion)) == 0


async def test_validate_reports_errors_warnings_cost_and_yaml(client, session_factory):
    h = await admin_headers(client, session_factory)
    ok = (await client.post(f"{BASE}/llm-config/validate", json={"config": MINIMAL}, headers=h)).json()
    assert ok["ok"] is True and ok["errors"] == [] and ok["config"] == MINIMAL
    assert yaml.safe_load(ok["yaml"]) == MINIMAL
    assert ok["cost"]["cheap"]["total_usd"] > 0 and ok["cost"]["better"]["unknown_models"]
    assert any("vendor/better" in w for w in ok["warnings"])  # not in the catalog
    bad = (await client.post(f"{BASE}/llm-config/validate", json={"yaml": "active_preset: x"}, headers=h)).json()
    assert bad["ok"] is False and bad["errors"] and bad["config"] is None


async def test_history_restore_reset_and_yaml_download(client, session_factory):
    h = await admin_headers(client, session_factory)
    v1 = (await client.post(f"{BASE}/llm-config", json={"config": with_model(MINIMAL, "cheap", "guard", "vendor/a"),
                                                         "base_version": None}, headers=h)).json()
    v2 = (await client.post(f"{BASE}/llm-config", json={"config": MINIMAL, "base_version": v1["id"],
                                                         "note": "back to cheap"}, headers=h)).json()
    page = (await client.get(f"{BASE}/llm-config/versions", headers=h)).json()
    assert [v["id"] for v in page["items"]] == [v2["id"], v1["id"]] and page["next"] is None
    assert page["items"][0]["changes"] == {"roles": {"cheap.guard": "vendor/a → vendor/cheap"}}
    full = (await client.get(f"{BASE}/llm-config/versions/{v1['id']}", headers=h)).json()
    assert full["config"]["presets"]["cheap"]["guard"]["model"] == "vendor/a"
    dl = await client.get(f"{BASE}/llm-config/versions/{v1['id']}/yaml", headers=h)
    assert dl.status_code == 200 and "attachment" in dl.headers["content-disposition"]
    assert yaml.safe_load(dl.text)["presets"]["cheap"]["guard"]["model"] == "vendor/a"
    restored = await client.post(f"{BASE}/llm-config/versions/{v1['id']}/restore",
                                 json={"base_version": v2["id"]}, headers=h)
    assert restored.status_code == 201 and restored.json()["restored_from"] == v1["id"]
    assert restored.json()["workers_notified"] is True
    reset = await client.post(f"{BASE}/llm-config/reset", json={"base_version": restored.json()["id"]}, headers=h)
    assert reset.status_code == 201 and reset.json()["source"] == "file" and reset.json()["workers_notified"] is True
    assert (await client.post(f"{BASE}/llm-config/versions/999/restore", json={"base_version": reset.json()["id"]},
                              headers=h)).status_code == 404


async def test_catalog_route_filters_and_reports_availability(client, session_factory, monkeypatch, redis):
    h = await admin_headers(client, session_factory)
    rows = (await client.get(f"{BASE}/llm-models", params={"q": "cheap", "structured": "true"}, headers=h)).json()
    assert rows["available"] is True and [r["id"] for r in rows["items"]] == ["vendor/cheap"]
    await redis.delete("mra:llm:catalog")

    async def offline():
        raise OSError("offline")

    monkeypatch.setattr("app.api.admin_models.load_live_catalog", offline)
    assert (await client.get(f"{BASE}/llm-models", headers=h)).json() == {"items": [], "available": False}


async def test_test_call_resolves_the_draft_rate_limits_and_audits(client, session_factory, monkeypatch):
    h = await admin_headers(client, session_factory)
    seen = []

    async def fake_probe(role, settings, catalog=None):
        seen.append((role.role, role.spec.model))
        return {"ok": True, "latency_ms": 5, "cost_usd": 0.0001, "model": role.spec.model, "error": None}

    monkeypatch.setattr("app.api.admin_models.probe", fake_probe)
    draft = with_model(MINIMAL, "better", "synthesizer", "vendor/new")
    r = await client.post(f"{BASE}/llm-models/test", json={"config": draft, "preset": "better", "role": "synthesizer"},
                          headers=h)
    assert r.status_code == 200 and r.json()["ok"] is True and seen == [("synthesizer", "vendor/new")]
    assert (await client.post(f"{BASE}/llm-models/test", json={"config": draft, "role": "nope"},
                              headers=h)).status_code == 422
    for _ in range(8):  # hits 3-10: the refused "nope" call above also counted against the limit
        await client.post(f"{BASE}/llm-models/test", json={"config": draft, "role": "guard"}, headers=h)
    limited = await client.post(f"{BASE}/llm-models/test", json={"config": draft, "role": "guard"}, headers=h)
    assert limited.status_code == 429 and "retry-after" in limited.headers
    assert await count(session_factory, "llm.test") == 9  # 1 + 8 answered tests; the 422 and the 429 write none


async def test_routes_need_an_admin_and_are_hidden(client):
    assert (await client.get(f"{BASE}/llm-config")).status_code == 401
    paths = (await client.get("/api/openapi.json")).json()["paths"]
    assert not [p for p in paths if "llm" in p]


# --- Plan 23b task 8 fix round 1 ---------------------------------------------------------------------------------


def provider_draft(name="openrouter", **fields):
    out = copy.deepcopy(MINIMAL)
    out["providers"].setdefault(name, {"api_key_env": f"{name.upper()}_API_KEY"}).update(fields)
    return out


def nested(depth):
    top, inner = {}, {}
    top["a"] = inner
    for _ in range(depth):
        inner["a"] = {}
        inner = inner["a"]
    return top


@pytest.fixture
def probe_calls(monkeypatch):
    calls = []

    async def fake_probe(role, settings, catalog=None):
        calls.append((role.role, role.spec.model))
        return {"ok": True, "latency_ms": 5, "cost_usd": 0.0001, "model": role.spec.model, "error": None}

    monkeypatch.setattr("app.api.admin_models.probe", fake_probe)
    return calls


async def version_count(session_factory):
    async with session_factory() as s:
        return await s.scalar(select(func.count()).select_from(LlmConfigVersion))


JSON_BODY = {"Content-Type": "application/json"}
HOSTILE_PROVIDERS = {
    "secret-env-database": provider_draft(api_key_env="DATABASE_URL"),
    "secret-env-salt": provider_draft(api_key_env="IP_HASH_SALT"),
    "secret-env-lowercase": provider_draft(api_key_env="turnstile_secret"),
    "openrouter-foreign-host": provider_draft(base_url="https://evil.example/v1"),
    "openrouter-http": provider_draft(base_url="http://openrouter.ai/api/v1"),
    "openrouter-lookalike": provider_draft(base_url="https://openrouter.ai.evil.example/api/v1"),
    "openrouter-userinfo": provider_draft(base_url="https://openrouter.ai@evil.example/"),
    "anthropic-lookalike": provider_draft("anthropic", base_url="https://api.anthropic.com.evil.example"),
    "anthropic-foreign-host": provider_draft("anthropic", base_url="https://evil.example"),
    "free-host-with-another-key": provider_draft("openai_compatible", base_url="https://evil.example/v1",
                                                 api_key_env="OPENROUTER_API_KEY"),
}


@pytest.mark.parametrize("draft", HOSTILE_PROVIDERS.values(), ids=HOSTILE_PROVIDERS.keys())
async def test_a_draft_cannot_aim_a_server_secret_at_another_host(client, session_factory, probe_calls, draft):
    h = await admin_headers(client, session_factory)
    checked = (await client.post(f"{BASE}/llm-config/validate", json={"config": draft}, headers=h)).json()
    assert checked["ok"] is False and checked["errors"]
    saved = await client.post(f"{BASE}/llm-config", json={"config": draft, "base_version": None}, headers=h)
    assert saved.status_code == 422
    tested = await client.post(f"{BASE}/llm-models/test", json={"config": draft, "role": "guard"}, headers=h)
    assert tested.status_code == 422
    assert probe_calls == [] and await version_count(session_factory) == 0
    assert await count(session_factory, "llm.test") == 0


async def test_provider_settings_that_stay_with_their_own_host_still_pass(client, session_factory):
    h = await admin_headers(client, session_factory)
    draft = provider_draft("anthropic", base_url="https://api.anthropic.com/v1")
    draft["providers"]["openai_compatible"] = {"base_url": "http://host.docker.internal:11434/v1",
                                               "api_key_env": "OPENAI_COMPATIBLE_API_KEY"}
    assert (await client.post(f"{BASE}/llm-config/validate", json={"config": draft}, headers=h)).json()["ok"] is True


async def test_the_test_call_audit_row_records_the_provider_and_the_host(client, session_factory, probe_calls):
    h = await admin_headers(client, session_factory)
    r = await client.post(f"{BASE}/llm-models/test", json={"config": MINIMAL, "role": "guard"}, headers=h)
    assert r.status_code == 200
    async with session_factory() as s:
        row = (await s.execute(select(AdminAudit).where(AdminAudit.action == "llm.test"))).scalar_one()
    assert row.after["provider"] == "openrouter" and row.after["base_url_host"] == "openrouter.ai"
    assert row.target_id == "vendor/cheap" and "api/v1" not in json.dumps(row.after)


def laughing_yaml(levels):
    lines = ["a0: &a0 [lol, lol, lol, lol, lol, lol, lol, lol, lol]"]
    for i in range(1, levels):
        lines.append(f"a{i}: &a{i} [{', '.join([f'*a{i - 1}'] * 9)}]")
    return "\n".join(lines) + "\n"


@pytest.mark.parametrize("url", [f"{BASE}/llm-config/validate", f"{BASE}/llm-config"])
async def test_yaml_aliases_and_deep_nesting_are_422_not_expanded(client, session_factory, url):
    h = await admin_headers(client, session_factory)
    bodies = [laughing_yaml(8), "a: &x 1\n", "[" * 900, "a: " + "[" * 900 + "]" * 900,
              "k: " + "{a: " * 60 + "1" + "}" * 60, "active_preset: 2020-13-45", "x: " + "9" * 5000]
    for text in bodies:
        started = time.monotonic()
        r = await client.post(url, json={"yaml": text, "base_version": None}, headers=h)
        assert r.status_code == 422, (text[:40], r.status_code)
        assert isinstance(r.json()["detail"], str) and time.monotonic() - started < 2
    assert await version_count(session_factory) == 0


async def test_free_form_sections_and_numbers_that_break_serialisation_are_422(client, session_factory, probe_calls):
    h = await admin_headers(client, session_factory)
    deep = copy.deepcopy(MINIMAL)
    deep["presets"]["cheap"]["guard"]["extra_body"] = nested(250)
    drafts = (deep, {**MINIMAL, "overrides": {"guard": nested(250)}},
              {**MINIMAL, "overrides": {"escalation": {"model": ""}}})
    for draft in drafts:
        checked = (await client.post(f"{BASE}/llm-config/validate", json={"config": draft}, headers=h)).json()
        assert checked["ok"] is False and checked["errors"]
        saved = await client.post(f"{BASE}/llm-config", json={"config": draft, "base_version": None}, headers=h)
        assert saved.status_code == 422
        tested = await client.post(f"{BASE}/llm-models/test", json={"config": draft, "role": "guard"}, headers=h)
        assert tested.status_code == 422
    infinite = copy.deepcopy(MINIMAL)
    infinite["presets"]["cheap"]["guard"]["timeout_seconds"] = "__INF__"
    body = json.dumps({"config": infinite, "base_version": None}).replace('"__INF__"', "1e400")
    assert (await client.post(f"{BASE}/llm-config", content=body, headers={**h, **JSON_BODY})).status_code == 422
    checked = await client.post(f"{BASE}/llm-config/validate", content=body, headers={**h, **JSON_BODY})
    assert checked.status_code == 200 and checked.json()["ok"] is False
    inf_yaml = "presets:\n  cheap:\n    guard: {model: m, timeout_seconds: .inf}\n"
    for text in (inf_yaml, "x: " + "[" * 300):
        r = await client.post(f"{BASE}/llm-config", json={"yaml": text, "base_version": None}, headers=h)
        assert r.status_code == 422
    assert probe_calls == [] and await version_count(session_factory) == 0


@pytest.mark.parametrize("error", [ValueError("Circular reference detected (depth exceeded)"), RecursionError()])
async def test_an_unexpected_config_failure_is_a_422_never_a_500(client, session_factory, monkeypatch, error):
    h = await admin_headers(client, session_factory)

    def boom(*args, **kwargs):
        raise error

    monkeypatch.setattr("app.api.admin_models.save_version", boom)
    r = await client.post(f"{BASE}/llm-config", json={"config": MINIMAL, "base_version": None}, headers=h)
    assert r.status_code == 422 and isinstance(r.json()["detail"], str)
    monkeypatch.setattr("app.services.llm_validate.to_yaml", boom)
    checked = await client.post(f"{BASE}/llm-config/validate", json={"config": MINIMAL}, headers=h)
    assert checked.status_code == 200 and checked.json()["ok"] is False and checked.json()["errors"]


def nul_drafts():
    in_model = with_model(MINIMAL, "cheap", "guard", "vendor/a\x00b")
    in_preset = copy.deepcopy(MINIMAL)
    in_preset["presets"]["ch\x00eap"] = in_preset["presets"].pop("cheap")
    in_preset["active_preset"] = "better"
    return {"model": in_model, "preset-name": in_preset}


@pytest.mark.parametrize("name", ["model", "preset-name"])
async def test_nul_in_a_config_is_refused_before_the_probe_or_any_write(client, session_factory, probe_calls, name):
    h = await admin_headers(client, session_factory)
    draft = nul_drafts()[name]
    saved = await client.post(f"{BASE}/llm-config", json={"config": draft, "base_version": None}, headers=h)
    assert saved.status_code == 422
    tested = await client.post(f"{BASE}/llm-models/test",
                               json={"config": draft, "role": "guard", "preset": "better"}, headers=h)
    assert tested.status_code == 422
    checked = (await client.post(f"{BASE}/llm-config/validate", json={"config": draft}, headers=h)).json()
    assert checked["ok"] is False
    assert probe_calls == [] and await version_count(session_factory) == 0
    assert await count(session_factory, "llm.test") == 0 and await count(session_factory, "llm_config.save") == 0


async def test_nul_and_unencodable_text_in_yaml_or_a_note_is_422(client, session_factory):
    h = await admin_headers(client, session_factory)
    in_yaml = {"yaml": 'active_preset: "x\\0y"\n', "base_version": None}  # the YAML escape \0 is a NUL
    assert (await client.post(f"{BASE}/llm-config", json=in_yaml, headers=h)).status_code == 422
    for bad in ("a\\u0000b", "x\\ud800"):  # a NUL, and a lone surrogate that Postgres cannot store
        save = f'{{"config": {json.dumps(MINIMAL)}, "base_version": null, "note": "{bad}"}}'
        assert (await client.post(f"{BASE}/llm-config", content=save, headers={**h, **JSON_BODY})).status_code == 422
        other = f'{{"base_version": null, "note": "{bad}"}}'
        for url in (f"{BASE}/llm-config/versions/1/restore", f"{BASE}/llm-config/reset"):
            assert (await client.post(url, content=other, headers={**h, **JSON_BODY})).status_code == 422, (url, bad)
    assert await version_count(session_factory) == 0


async def test_a_test_call_without_a_draft_uses_the_effective_preset(client, app, session_factory, tmp_path,
                                                                     probe_calls):
    h = await admin_headers(client, session_factory)
    settings = app.state.deps.service.settings
    path = tmp_path / "llm.yaml"
    path.write_text(yaml.safe_dump(with_model(MINIMAL, "better", "guard", "vendor/env-preset")), encoding="utf-8")
    settings.llm_config_path, settings.llm_preset = str(path), "better"
    r = await client.post(f"{BASE}/llm-models/test", json={"role": "guard"}, headers=h)
    assert r.status_code == 200 and probe_calls == [("guard", "vendor/env-preset")]  # LLM_PRESET beats active_preset
    await client.post(f"{BASE}/llm-models/test", json={"role": "guard", "preset": "cheap"}, headers=h)
    assert probe_calls[-1] == ("guard", "vendor/cheap")  # an explicit preset is what was asked for
    saved = await client.post(f"{BASE}/llm-config", json={"config": MINIMAL, "base_version": None}, headers=h)
    assert saved.status_code == 201
    await client.post(f"{BASE}/llm-models/test", json={"role": "guard"}, headers=h)
    assert probe_calls[-1] == ("guard", "vendor/cheap")  # a DB version ignores LLM_PRESET


async def test_a_body_that_fails_validation_is_a_422_that_does_not_echo_it_back(client, session_factory):
    h = await admin_headers(client, session_factory)
    every_route = (f"{BASE}/llm-config", f"{BASE}/llm-config/validate", f"{BASE}/llm-models/test")
    cases = [('{"config": ' + "[" * 400 + "]" * 400 + ', "base_version": null, "role": "guard"}', every_route),
             # a deeply nested body overflows the error encoder; a lone surrogate cannot be written back
             (r'{"yaml": "x\ud800", "base_version": null, "role": "guard"}', every_route),
             (r'{"config": {}, "base_version": null, "note": ["x\ud800"]}', (f"{BASE}/llm-config",)),
             (r'{"config": {}, "base_version": "x\ud800"}', (f"{BASE}/llm-config",))]
    for body, urls in cases:
        for url in urls:
            r = await client.post(url, content=body, headers={**h, **JSON_BODY})
            assert r.status_code == 422, (url, body[:30], r.status_code)
            assert "input" not in r.text
    public = await client.post("/api/v1/reviews", json={"topic": 5})  # outside /admin the default error is unchanged
    assert public.status_code == 422 and "input" in public.json()["detail"][0]


# --- fix round 2 -------------------------------------------------------------------------------------------------

BINARY_MODEL_YAML = """\
active_preset: cheap
default_provider: openrouter
providers:
  openrouter: {base_url: "https://openrouter.ai/api/v1", api_key_env: OPENROUTER_API_KEY}
presets:
  cheap:
    guard: {model: !!binary YS8AYg==}
    planner: {model: a/b}
    screener: {model: a/b}
    extractor: {model: a/b}
    synthesizer: {model: a/b}
"""
BINARY_PRESET_YAML = """\
active_preset: !!binary Y2gAZWFw
default_provider: openrouter
providers:
  openrouter: {base_url: "https://openrouter.ai/api/v1", api_key_env: OPENROUTER_API_KEY}
presets:
  ? !!binary Y2gAZWFw
  : {guard: {model: a/b}, planner: {model: a/b}, screener: {model: a/b}, extractor: {model: a/b},
     synthesizer: {model: a/b}}
"""


@pytest.mark.parametrize("text", [BINARY_MODEL_YAML, BINARY_PRESET_YAML], ids=["model", "preset-name"])
async def test_yaml_binary_cannot_carry_a_nul_into_a_config(client, session_factory, probe_calls, text):
    h = await admin_headers(client, session_factory)
    body = {"yaml": text, "base_version": None, "role": "guard"}
    for url in (f"{BASE}/llm-config/validate", f"{BASE}/llm-config", f"{BASE}/llm-models/test"):
        r = await client.post(url, json=body, headers=h)
        assert r.status_code == 422 and "binary" in r.json()["detail"], (url, r.text)
    assert probe_calls == [] and await version_count(session_factory) == 0
    assert await count(session_factory, "llm.test") == 0 and await count(session_factory, "llm_config.save") == 0


BAD_LOCAL_URLS = ["http://[evil", "http://[::1", "http://a]b/", "http://ex℀ample.com/v1", "ftp://x.example.org/v1"]


@pytest.mark.parametrize("url", BAD_LOCAL_URLS)
async def test_a_local_model_server_url_that_does_not_parse_is_a_422_before_the_probe(client, session_factory,
                                                                                       probe_calls, url):
    h = await admin_headers(client, session_factory)
    draft = provider_draft("openai_compatible", base_url=url)
    draft["presets"]["cheap"]["guard"] = {"model": "local/m", "provider": "openai_compatible"}
    checked = (await client.post(f"{BASE}/llm-config/validate", json={"config": draft}, headers=h)).json()
    assert checked["ok"] is False and "base_url" in checked["errors"][0]
    saved = await client.post(f"{BASE}/llm-config", json={"config": draft, "base_version": None}, headers=h)
    assert saved.status_code == 422
    tested = await client.post(f"{BASE}/llm-models/test", json={"config": draft, "role": "guard"}, headers=h)
    assert tested.status_code == 422
    assert probe_calls == [] and await version_count(session_factory) == 0
    assert await count(session_factory, "llm.test") == 0


async def test_the_audit_row_names_the_host_of_a_local_model_server(client, session_factory, probe_calls):
    h = await admin_headers(client, session_factory)
    draft = provider_draft("openai_compatible", base_url="http://Localhost:11434/v1?x=1")
    draft["presets"]["cheap"]["guard"] = {"model": "local/m", "provider": "openai_compatible"}
    r = await client.post(f"{BASE}/llm-models/test", json={"config": draft, "role": "guard"}, headers=h)
    assert r.status_code == 200 and probe_calls == [("guard", "local/m")]
    async with session_factory() as s:
        row = (await s.execute(select(AdminAudit).where(AdminAudit.action == "llm.test"))).scalar_one()
    assert (row.after["provider"], row.after["base_url_host"]) == ("openai_compatible", "localhost")
    assert "11434" not in json.dumps(row.after) and "x=1" not in json.dumps(row.after)


@pytest.mark.parametrize("name,env", [("openrouter", "ANTHROPIC_API_KEY"), ("openrouter", "OPENALEX_API_KEY"),
                                      ("anthropic", "OPENROUTER_API_KEY"),
                                      ("openai_compatible", "OPENROUTER_API_KEY")])
async def test_a_provider_cannot_name_another_providers_key(client, session_factory, probe_calls, name, env):
    h = await admin_headers(client, session_factory)
    draft = provider_draft(name, api_key_env=env)
    assert (await client.post(f"{BASE}/llm-config/validate", json={"config": draft}, headers=h)).json()["ok"] is False
    assert (await client.post(f"{BASE}/llm-config", json={"config": draft, "base_version": None},
                              headers=h)).status_code == 422
    assert (await client.post(f"{BASE}/llm-models/test", json={"config": draft, "role": "guard"},
                              headers=h)).status_code == 422
    assert probe_calls == [] and await version_count(session_factory) == 0


async def test_a_value_the_json_column_cannot_store_is_422_not_a_server_error(client, session_factory):
    h = await admin_headers(client, session_factory)
    draft = copy.deepcopy(MINIMAL)
    draft["presets"]["cheap"]["guard"]["extra_body"] = {"n": "__BIG__"}
    text = yaml.safe_dump(draft, sort_keys=False).replace("__BIG__", "0x" + "f" * 4000)
    assert "0x" + "f" * 4000 in text
    saved = await client.post(f"{BASE}/llm-config", json={"yaml": text, "base_version": None}, headers=h)
    assert saved.status_code == 422 and "stored" in saved.json()["detail"]
    checked = await client.post(f"{BASE}/llm-config/validate", json={"yaml": text}, headers=h)
    assert checked.status_code == 200 and checked.json()["ok"] is False
    assert await version_count(session_factory) == 0


# --- fix round 3 -------------------------------------------------------------------------------------------------


@pytest.mark.parametrize("text", ["a: !!bool maybe", "a: !!timestamp abc", "a: !!int _"])
async def test_a_yaml_tag_that_does_not_fit_its_value_is_422_never_a_500(client, session_factory, probe_calls, text):
    h = await admin_headers(client, session_factory)
    body = {"yaml": text, "base_version": None, "role": "guard"}
    for url in (f"{BASE}/llm-config/validate", f"{BASE}/llm-config", f"{BASE}/llm-models/test"):
        r = await client.post(url, json=body, headers=h)
        assert r.status_code == 422 and "invalid YAML" in r.json()["detail"], (url, r.text)
    assert probe_calls == [] and await version_count(session_factory) == 0


@pytest.mark.parametrize("field,value", [("app_name", "Reviewer\r\nX-Evil: 1"), ("app_url", "javascript:alert(1)")])
async def test_header_values_with_control_characters_or_a_bad_url_are_422(client, session_factory, probe_calls,
                                                                            field, value):
    h = await admin_headers(client, session_factory)
    draft = provider_draft(**{field: value})
    checked = (await client.post(f"{BASE}/llm-config/validate", json={"config": draft}, headers=h)).json()
    assert checked["ok"] is False and field in checked["errors"][0]
    assert (await client.post(f"{BASE}/llm-config", json={"config": draft, "base_version": None},
                              headers=h)).status_code == 422
    assert (await client.post(f"{BASE}/llm-models/test", json={"config": draft, "role": "guard"},
                              headers=h)).status_code == 422
    assert probe_calls == [] and await version_count(session_factory) == 0
