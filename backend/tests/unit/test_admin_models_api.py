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
