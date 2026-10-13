import json

from sqlalchemy import func, select

from app.db.models import AdminAudit, ConfigVersion
from app.services.glossary_store import GLOSSARY_KEY
from app.services.runtime_settings import SETTINGS_KEY
from tests.admin_helpers import admin_headers

BASE = "/api/v1/admin"
PLACEBO = {"en": "placebo", "th": "ยาหลอก", "abbr": None, "note": None}


async def count(session_factory, action):
    async with session_factory() as s:
        return await s.scalar(select(func.count()).select_from(AdminAudit).where(AdminAudit.action == action))


async def test_settings_state_save_and_status(client, session_factory, redis):
    h = await admin_headers(client, session_factory)
    state = (await client.get(f"{BASE}/settings", headers=h)).json()
    assert (state["source"], state["version"], state["overrides"]) == ("env", None, {})
    assert state["values"]["max_queued_reviews"] == state["env"]["max_queued_reviews"] == 50
    assert {s["name"] for s in state["specs"]} >= {"review_rate_limit", "llm_concurrency"} and state["loaded"] == []
    status = "/api/v1/status"
    assert (await client.get(status)).json()["limits"]["max_queued_reviews"] == 50  # warms this process's 5 s cache
    saved = await client.post(f"{BASE}/settings", headers=h,
                              json={"values": {"max_queued_reviews": 80}, "base_version": None, "note": "busier"})
    assert saved.status_code == 201 and saved.json()["version"] == 1 and saved.json()["workers_notified"] is True
    assert json.loads(await redis.get(SETTINGS_KEY)) == {"version": 1, "values": {"max_queued_reviews": 80}}
    state = (await client.get(f"{BASE}/settings", headers=h)).json()
    assert (state["source"], state["version"], state["values"]["max_queued_reviews"]) == ("db", 1, 80)
    assert (await client.get(status)).json()["limits"]["max_queued_reviews"] == 80  # this process: at once, not in 5 s
    assert await count(session_factory, "settings.save") == 1


async def test_settings_validate_conflict_and_bad_values(client, session_factory):
    h = await admin_headers(client, session_factory)
    report = (await client.post(f"{BASE}/settings/validate", headers=h,
                                json={"values": {"max_queued_reviews": 0, "turnstile_secret": "x"}})).json()
    assert report["ok"] is False
    assert [e["field"] for e in report["errors"]] == ["max_queued_reviews", "turnstile_secret"]
    ok = (await client.post(f"{BASE}/settings/validate", headers=h, json={"values": {"llm_concurrency": 8}})).json()
    assert ok["ok"] is True and ok["values"]["llm_concurrency"] == 8 and ok["worst_case_review_usd"] > 0
    bad = await client.post(f"{BASE}/settings", headers=h, json={"values": {"sse_max_per_ip": 0}, "base_version": None})
    assert bad.status_code == 422 and bad.json()["errors"][0]["field"] == "sse_max_per_ip"
    assert (await client.post(f"{BASE}/settings", headers=h,
                              json={"values": {}, "base_version": None})).status_code == 201
    stale = await client.post(f"{BASE}/settings", headers=h, json={"values": {}, "base_version": None})
    assert stale.status_code == 409 and "reload" in stale.json()["detail"]
    async with session_factory() as s:
        assert await s.scalar(select(func.count()).select_from(ConfigVersion)) == 1


async def test_restore_reset_and_history(client, session_factory):
    h = await admin_headers(client, session_factory)
    await client.post(f"{BASE}/settings", headers=h, json={"values": {"max_queued_reviews": 80}, "base_version": None})
    await client.post(f"{BASE}/settings", headers=h, json={"values": {"max_queued_reviews": 90}, "base_version": 1})
    restored = await client.post(f"{BASE}/settings/versions/1/restore", headers=h, json={"base_version": 2})
    assert restored.status_code == 201 and restored.json()["restored_from"] == 1
    reset = await client.post(f"{BASE}/settings/reset", headers=h, json={"base_version": 3})
    assert reset.status_code == 201 and reset.json()["source"] == "reset"
    page = (await client.get(f"{BASE}/settings/versions?limit=2", headers=h)).json()
    assert [v["version"] for v in page["items"]] == [4, 3] and page["next"] == 3
    one = (await client.get(f"{BASE}/settings/versions/2", headers=h)).json()
    assert one["document"] == {"values": {"max_queued_reviews": 90}}
    assert one["changes"] == {"max_queued_reviews": "80 → 90"}
    assert (await client.get(f"{BASE}/settings/versions/9", headers=h)).status_code == 404
    assert (await client.get(f"{BASE}/settings", headers=h)).json()["values"]["max_queued_reviews"] == 50


async def test_glossary_state_validate_save_and_reset(client, session_factory, redis):
    h = await admin_headers(client, session_factory)
    state = (await client.get(f"{BASE}/glossary", headers=h)).json()
    assert state["source"] == "file" and len(state["terms"]) == 24 and state["max_chars"] == 4000
    report = (await client.post(f"{BASE}/glossary/validate", headers=h,
                                json={"terms": [PLACEBO, {**PLACEBO, "en": "Placebo"}]})).json()
    assert report["ok"] is False and report["errors"][0]["field"] == "terms.1.en"
    ok = (await client.post(f"{BASE}/glossary/validate", headers=h, json={"terms": [PLACEBO]})).json()
    assert ok == {"ok": True, "errors": [], "warnings": [], "preview": "placebo = ยาหลอก", "chars": 16}
    saved = await client.post(f"{BASE}/glossary", headers=h, json={"terms": [PLACEBO], "base_version": None})
    assert saved.status_code == 201 and saved.json()["version"] == 1
    assert json.loads(await redis.get(GLOSSARY_KEY)) == {"version": 1}
    state = (await client.get(f"{BASE}/glossary", headers=h)).json()
    assert (state["source"], state["version"], state["terms"]) == ("db", 1, [PLACEBO])
    reset = await client.post(f"{BASE}/glossary/reset", headers=h, json={"base_version": 1})
    assert reset.status_code == 201 and len((await client.get(f"{BASE}/glossary", headers=h)).json()["terms"]) == 24
    assert await count(session_factory, "glossary.save") == 1 and await count(session_factory, "glossary.reset") == 1


async def test_bad_bodies_are_422_never_500(client, session_factory):
    h = await admin_headers(client, session_factory)
    json_headers = {**h, "Content-Type": "application/json"}
    lone_surrogate = r'{"terms":[{"en":"\ud800","th":"ยา"}],"base_version":null}'.encode()
    r = await client.post(f"{BASE}/glossary", headers=json_headers, content=lone_surrogate)
    assert r.status_code == 422 and "ud800" not in r.text.lower()  # json.dumps would echo it as \ud800
    for path, body in ((f"{BASE}/glossary", {"terms": "x", "base_version": None}),
                       (f"{BASE}/glossary", {"terms": [PLACEBO] * 1001, "base_version": None}),
                       (f"{BASE}/settings", {"values": {"max_queued_reviews": {"deep": [1]}}, "base_version": None}),
                       (f"{BASE}/settings", {"values": [], "base_version": None}),
                       (f"{BASE}/settings", {"values": {}, "base_version": None, "note": "a\x00b"})):
        r = await client.post(path, headers=h, json=body)
        assert r.status_code == 422, (path, r.text)


async def test_routes_need_an_admin_and_the_csrf_header_and_stay_out_of_openapi(client, session_factory, app):
    for path in (f"{BASE}/settings", f"{BASE}/glossary", f"{BASE}/glossary/versions"):
        assert (await client.get(path)).status_code == 401
    h = await admin_headers(client, session_factory)
    no_csrf = {k: v for k, v in h.items() if k != "X-MRA-Admin"}
    r = await client.post(f"{BASE}/settings", headers=no_csrf, json={"values": {}, "base_version": None})
    assert r.status_code == 403
    paths = app.openapi()["paths"]
    assert not any(p.startswith(("/api/v1/admin/settings", "/api/v1/admin/glossary")) for p in paths)


async def test_deep_bodies_are_refused_and_never_echoed(client, session_factory):
    h = await admin_headers(client, session_factory)
    json_headers = {**h, "Content-Type": "application/json"}
    deep = "[" * 400 + "]" * 400
    cases = ((f"{BASE}/settings", '{"values": ' + deep + ', "base_version": null}', 422),
             (f"{BASE}/glossary", '{"terms": [' + deep + '], "base_version": null}', 422),
             (f"{BASE}/settings/validate", '{"values": {"sse_max_per_ip": ' + deep + '}}', 200),
             (f"{BASE}/glossary/validate", '{"terms": [' + deep + ']}', 200))
    for path, body, status in cases:
        r = await client.post(path, headers=json_headers, content=body.encode())
        assert r.status_code == status and "[[[" not in r.text, (path, r.status_code)
        if status == 200:
            assert r.json()["ok"] is False
    async with session_factory() as s:
        assert await s.scalar(select(func.count()).select_from(ConfigVersion)) == 0


async def test_a_draft_is_checked_against_env_not_against_the_overrides_in_force(client, session_factory):
    h = await admin_headers(client, session_factory)
    first = await client.post(f"{BASE}/settings", headers=h,
                              json={"values": {"max_usd_per_day": 0.5}, "base_version": None})
    assert first.status_code == 201
    # A draft replaces the saved overrides, so it is judged on top of env values. Judged on top of the 0.5 in force, its
    # largest per-review cap ($0.60) would exceed the daily budget; on env (10.0) it is fine.
    draft = {"values": {"review_cost_per_paper_usd": 0.01}}
    report = (await client.post(f"{BASE}/settings/validate", headers=h, json=draft)).json()
    assert report["ok"] is True and report["errors"] == []
    assert report["values"]["max_usd_per_day"] == 10.0 and report["worst_case_review_usd"] == 0.6
    saved = await client.post(f"{BASE}/settings", headers=h, json={**draft, "base_version": 1})
    assert saved.status_code == 201 and saved.json()["version"] == 2
    # And the reverse: a draft that is only too low on its own is refused whatever else is in force.
    low = (await client.post(f"{BASE}/settings/validate", headers=h, json={"values": {"max_usd_per_day": 0.2}})).json()
    assert low["ok"] is False and low["errors"][0]["field"] == "max_usd_per_day"


async def test_glossary_history_restore_and_a_stored_version_that_no_longer_validates(client, session_factory, redis):
    h = await admin_headers(client, session_factory)
    other = {"en": "nocebo", "th": "ยาหลอกเชิงลบ", "abbr": None, "note": None}
    for body in ({"terms": [PLACEBO], "base_version": None}, {"terms": [PLACEBO, other], "base_version": 1}):
        assert (await client.post(f"{BASE}/glossary", headers=h, json=body)).status_code == 201
    page = (await client.get(f"{BASE}/glossary/versions", headers=h)).json()
    assert [v["version"] for v in page["items"]] == [2, 1] and page["next"] is None
    assert page["items"][0]["changes"] == {"added": ["nocebo"]}
    one = (await client.get(f"{BASE}/glossary/versions/1", headers=h)).json()
    assert one["document"] == {"terms": [PLACEBO]}
    restored = await client.post(f"{BASE}/glossary/versions/1/restore", headers=h, json={"base_version": 2})
    assert restored.status_code == 201 and restored.json()["restored_from"] == 1
    assert (await client.get(f"{BASE}/glossary", headers=h)).json()["terms"] == [PLACEBO]
    assert json.loads(await redis.get(GLOSSARY_KEY)) == {"version": 3}
    assert await count(session_factory, "glossary.restore") == 1
    # a version that is not there is a 404, and one the current rules refuse is a 422; neither writes anything
    missing = await client.post(f"{BASE}/settings/versions/7/restore", headers=h, json={"base_version": None})
    assert missing.status_code == 404
    async with session_factory() as s, s.begin():
        s.add(ConfigVersion(kind="settings", version=1, created_by="old", source="edit",
                            document={"values": {"max_queued_reviews": 0}}, changes={}))
    refused = await client.post(f"{BASE}/settings/versions/1/restore", headers=h, json={"base_version": 1})
    assert refused.status_code == 422 and refused.json()["errors"][0]["field"] == "max_queued_reviews"
    async with session_factory() as s:
        assert await s.scalar(select(func.count()).select_from(ConfigVersion)
                              .where(ConfigVersion.kind == "settings")) == 1
    assert await count(session_factory, "settings.restore") == 0


async def test_a_save_without_values_is_422_and_writes_nothing(client, session_factory):
    h = await admin_headers(client, session_factory)
    for body in ({"base_version": None}, {"base_version": None, "note": "x"}):
        r = await client.post(f"{BASE}/settings", headers=h, json=body)
        assert r.status_code == 422, r.text
    # the validate body keeps its default: nothing typed yet means env everywhere
    assert (await client.post(f"{BASE}/settings/validate", headers=h, json={})).json()["ok"] is True
    async with session_factory() as s:
        assert await s.scalar(select(func.count()).select_from(ConfigVersion)) == 0
    assert await count(session_factory, "settings.save") == 0


async def test_lone_surrogates_are_never_echoed(client, session_factory):
    h = await admin_headers(client, session_factory)
    json_headers = {**h, "Content-Type": "application/json"}
    cases = ((f"{BASE}/settings", r'{"values":{"x\ud800":1},"base_version":null}', 422),
             (f"{BASE}/settings", r'{"values":{"max_queued_reviews":"\ud800"},"base_version":null}', 422),
             (f"{BASE}/settings", r'{"values":{},"base_version":null,"note":"\ud800"}', 422),
             (f"{BASE}/settings/validate", r'{"values":{"x\ud800":1}}', 200),
             (f"{BASE}/settings/validate", r'{"values":{"max_queued_reviews":"\ud800"}}', 200),
             (f"{BASE}/glossary", r'{"terms":[{"en":"a","th":"\ud800ยา"}],"base_version":null}', 422),
             (f"{BASE}/glossary/validate", r'{"terms":[{"en":"\ud800","th":"ยา"}]}', 200),
             (f"{BASE}/glossary/validate", r'{"terms":[{"en":"a","th":"ยา","note":"\ud800"}]}', 200))
    for path, body, status in cases:
        r = await client.post(path, headers=json_headers, content=body.encode())
        assert r.status_code == status and "ud800" not in r.text.lower(), (path, body, r.status_code)
        if status == 200:
            assert r.json()["ok"] is False
    async with session_factory() as s:
        assert await s.scalar(select(func.count()).select_from(ConfigVersion)) == 0


async def test_a_save_still_succeeds_when_redis_could_not_be_updated(client, session_factory, redis, monkeypatch):
    h = await admin_headers(client, session_factory)

    def redis_down(*args, **kwargs):
        raise ConnectionError("redis is down")

    monkeypatch.setattr(redis, "pipeline", redis_down)  # publish() goes through a WATCH/MULTI pipeline
    status = "/api/v1/status"
    assert (await client.get(status)).json()["limits"]["max_queued_reviews"] == 50
    saved = await client.post(f"{BASE}/settings", headers=h,
                              json={"values": {"max_queued_reviews": 80}, "base_version": None})
    assert saved.status_code == 201 and saved.json()["workers_notified"] is False
    assert await redis.get(SETTINGS_KEY) is None  # the mirror was not raised; the workers' poll repairs it
    async with session_factory() as s:
        assert await s.scalar(select(func.count()).select_from(ConfigVersion)
                              .where(ConfigVersion.kind == "settings")) == 1
    assert await count(session_factory, "settings.save") == 1
    # this process still shows the save at once: it dropped its cache and reads the DB when the mirror is missing
    assert (await client.get(status)).json()["limits"]["max_queued_reviews"] == 80
    glossary = await client.post(f"{BASE}/glossary", headers=h, json={"terms": [PLACEBO], "base_version": None})
    assert glossary.status_code == 201 and glossary.json()["workers_notified"] is False
    assert await count(session_factory, "glossary.save") == 1


HUGE = 2**31  # one past Postgres INTEGER: a lookup with it raises in the driver, which would be a 500


async def test_version_numbers_beyond_postgres_integer_are_422_never_500(client, session_factory):
    h = await admin_headers(client, session_factory)
    for kind in ("settings", "glossary"):
        base = f"{BASE}/{kind}"
        assert (await client.get(f"{base}/versions/{HUGE}", headers=h)).status_code == 422
        assert (await client.get(f"{base}/versions?before={HUGE}", headers=h)).status_code == 422
        restore = await client.post(f"{base}/versions/{HUGE}/restore", headers=h, json={"base_version": None})
        assert restore.status_code == 422
        assert (await client.get(f"{base}/versions/0", headers=h)).status_code == 422
        # the largest INTEGER is an ordinary lookup
        assert (await client.get(f"{base}/versions/{HUGE - 1}", headers=h)).status_code == 404
        page = await client.get(f"{base}/versions?before={HUGE - 1}", headers=h)
        assert page.json() == {"items": [], "next": None}
        restore = await client.post(f"{base}/versions/{HUGE - 1}/restore", headers=h, json={"base_version": None})
        assert restore.status_code == 404
    async with session_factory() as s:
        assert await s.scalar(select(func.count()).select_from(ConfigVersion)) == 0
