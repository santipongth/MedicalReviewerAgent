"""Plan 23d: the sources in the result-cache key, /status, the admin routes and paper search."""
import json
import uuid

from fastmcp import Client
from sqlalchemy import func, select

from app.db.models import AdminAudit, ConfigVersion
from app.schemas.review import compute_cache_key
from app.services.paper_search import PaperSearch
from app.services.sources import SOURCE_IDS, engine_fingerprint
from app.services.sources_store import NO_SEARXNG, SOURCES_KEY, SOURCES_KIND, WARN_THAIJO
from tests.admin_helpers import admin_headers
from tests.unit.test_papers_and_report import Epmc, Searx, hits
from tests.unit.test_runtime_api import TOPIC, apply

BASE = "/api/v1/admin"
ALL = "pubmed,europe pmc,openalex,semantic scholar,crossref,arxiv,doaj,openaire"
NO_OPENAIRE = "pubmed,europe pmc,openalex,semantic scholar,crossref,arxiv,doaj"


async def submit(app, client, body=TOPIC):
    created = (await client.post("/api/v1/reviews", json=body)).json()
    return created["review_id"], await app.state.deps.service.get(uuid.UUID(created["review_id"]))


def key(review, version: str) -> str:
    return compute_cache_key(review.topic, review.language, review.options, version)


async def audits(session_factory, action):
    async with session_factory() as s:
        return await s.scalar(select(func.count()).select_from(AdminAudit).where(AdminAudit.action == action))


async def test_the_cache_key_is_unchanged_while_no_sources_version_changes_the_set(app, client):
    pv = app.state.deps.service.settings.prompt_version
    first, review = await submit(app, client)
    assert review.cache_key == key(review, f"{pv}+llmfile")  # THAIJO_ENABLED=false: no part at all
    await apply(app, SOURCES_KIND, {"sources": {"openaire": True}})  # equal to env: stored as {} and changes nothing
    assert (await submit(app, client))[0] == first


async def test_a_saved_engine_set_or_thaijo_starts_its_own_cache_generation(app, client):
    pv = app.state.deps.service.settings.prompt_version
    first, _ = await submit(app, client)
    await apply(app, SOURCES_KIND, {"sources": {"openaire": False}})
    second, review = await submit(app, client)
    assert second != first and review.cache_key == key(review, f"{pv}+llmfile+src{engine_fingerprint(NO_OPENAIRE)}")
    await apply(app, SOURCES_KIND, {"sources": {}})  # back to env's set: back to the first generation
    assert (await submit(app, client))[0] == first
    await apply(app, SOURCES_KIND, {"sources": {"thaijo": True}})
    fourth, review = await submit(app, client)
    assert fourth not in (first, second) and review.cache_key == key(review, f"{pv}+llmfile+thaijo")


async def test_status_lists_the_sources_in_force(app, client):
    assert [s["id"] for s in (await client.get("/api/v1/status")).json()["sources"]] == list(SOURCE_IDS[:-1])
    await apply(app, SOURCES_KIND, {"sources": {"openaire": False, "thaijo": True}})
    after = (await client.get("/api/v1/status")).json()["sources"]
    assert [s["id"] for s in after] == [*SOURCE_IDS[:-2], "thaijo"]
    assert after[0] == {"id": "pubmed", "label": "PubMed"} and after[-1] == {"id": "thaijo", "label": "ThaiJO"}


async def test_sources_state_validate_and_save(client, session_factory, redis):
    h = await admin_headers(client, session_factory)
    state = (await client.get(f"{BASE}/sources", headers=h)).json()
    assert (state["source"], state["version"], state["extras"], state["error"], state["loaded"]) == (
        "env", None, [], None, [])
    rows = [(s["id"], s["kind"], s["env"], s["enabled"], s["overridden"]) for s in state["sources"]]
    assert rows[0] == ("pubmed", "searxng", True, True, False) and rows[-1] == ("thaijo", "direct", False, False, False)
    report = (await client.post(f"{BASE}/sources/validate", headers=h,
                                json={"sources": {"thaijo": True, "openaire": False, "pubmed": True}})).json()
    assert report["ok"] is True and report["warnings"] == [WARN_THAIJO]
    assert report["document"] == {"sources": {"openaire": False, "thaijo": True}}
    assert report["enabled"] == [*SOURCE_IDS[:-2], "thaijo"]
    off = dict.fromkeys(SOURCE_IDS[:-1], False)
    refused = (await client.post(f"{BASE}/sources/validate", headers=h, json={"sources": off})).json()
    assert refused == {"ok": False, "errors": [{"field": "sources", "message": NO_SEARXNG}], "warnings": [],
                       "document": None, "enabled": None}
    saved = await client.post(f"{BASE}/sources", headers=h,
                              json={"sources": {"openaire": False}, "base_version": None, "note": "openaire is slow"})
    assert saved.status_code == 201 and saved.json()["version"] == 1 and saved.json()["workers_notified"] is True
    assert saved.json()["changes"] == {"openaire": "env → off"}
    assert json.loads(await redis.get(SOURCES_KEY)) == {"version": 1, "sources": {"openaire": False}}
    state = (await client.get(f"{BASE}/sources", headers=h)).json()
    openaire = next(s for s in state["sources"] if s["id"] == "openaire")
    assert (state["source"], state["version"], openaire["enabled"], openaire["overridden"]) == ("db", 1, False, True)
    assert await audits(session_factory, "sources.save") == 1


async def test_a_stale_base_is_409_and_a_bad_document_is_422_without_echo(client, session_factory):
    h = await admin_headers(client, session_factory)
    assert (await client.post(f"{BASE}/sources", headers=h, json={"sources": {}, "base_version": None})).status_code == 201
    stale = await client.post(f"{BASE}/sources", headers=h, json={"sources": {}, "base_version": None})
    assert stale.status_code == 409 and "reload" in stale.json()["detail"]
    unknown = await client.post(f"{BASE}/sources", headers=h, json={"sources": {"scopus": True}, "base_version": 1})
    assert unknown.status_code == 422 and unknown.json()["errors"] == [{"field": "sources",
                                                                        "message": "sources: unknown source"}]
    assert "scopus" not in unknown.text
    not_bool = await client.post(f"{BASE}/sources", headers=h, json={"sources": {"pubmed": "no"}, "base_version": 1})
    assert not_bool.status_code == 422 and not_bool.json()["errors"][0]["field"] == "sources.pubmed"
    for body in ({"base_version": 1}, {"sources": [], "base_version": 1}):  # no document: never "env everywhere"
        assert (await client.post(f"{BASE}/sources", headers=h, json=body)).status_code == 422
    async with session_factory() as s:
        assert await s.scalar(select(func.count()).select_from(ConfigVersion)) == 1


async def test_history_restore_and_reset(client, session_factory):
    h = await admin_headers(client, session_factory)
    await client.post(f"{BASE}/sources", headers=h, json={"sources": {"openaire": False}, "base_version": None})
    reset = await client.post(f"{BASE}/sources/reset", headers=h, json={"base_version": 1})
    assert reset.status_code == 201 and reset.json()["source"] == "reset"
    page = (await client.get(f"{BASE}/sources/versions", headers=h)).json()
    assert [v["version"] for v in page["items"]] == [2, 1] and page["items"][0]["changes"] == {"openaire": "off → env"}
    assert (await client.get(f"{BASE}/sources/versions/1", headers=h)).json()["document"] == {
        "sources": {"openaire": False}}
    restored = await client.post(f"{BASE}/sources/versions/1/restore", headers=h, json={"base_version": 2})
    assert restored.status_code == 201 and restored.json()["restored_from"] == 1
    state = (await client.get(f"{BASE}/sources", headers=h)).json()
    assert state["version"] == 3 and not next(s for s in state["sources"] if s["id"] == "openaire")["enabled"]
    assert await audits(session_factory, "sources.reset") == 1 and await audits(session_factory, "sources.restore") == 1


async def test_routes_need_an_admin_and_the_csrf_header_and_stay_out_of_openapi(client, session_factory, app):
    for path in (f"{BASE}/sources", f"{BASE}/sources/versions"):
        assert (await client.get(path)).status_code == 401
    h = await admin_headers(client, session_factory)
    no_csrf = {k: v for k, v in h.items() if k != "X-MRA-Admin"}
    assert (await client.post(f"{BASE}/sources", headers=no_csrf,
                              json={"sources": {}, "base_version": None})).status_code == 403
    assert not any(p.startswith("/api/v1/admin/sources") for p in app.openapi()["paths"])


async def test_a_stored_version_that_no_longer_fits_env_is_reported_never_a_500(app, client, session_factory):
    h = await admin_headers(client, session_factory)
    app.state.deps.service.settings.searxng_engines = "pubmed"  # an env change after the save
    async with session_factory() as s, s.begin():
        s.add(ConfigVersion(kind="sources", version=1, created_by="old", source="edit", changes={},
                            document={"sources": {"pubmed": False, "scopus": True, "thaijo": "yes"}}))
    state = (await client.get(f"{BASE}/sources", headers=h)).json()
    assert state["error"] and "SEARXNG_ENGINES" in state["error"]
    assert [s["id"] for s in state["sources"] if s["enabled"]] == ["pubmed"]
    status = await client.get("/api/v1/status")
    assert status.status_code == 200 and status.json()["sources"] == [{"id": "pubmed", "label": "PubMed"}]


async def test_paper_search_asks_the_enabled_engines_in_rest_and_mcp(app, client):
    searx = Searx(hits())
    app.state.deps.papers = PaperSearch(searx, Epmc())
    assert (await client.get("/api/v1/papers/search?q=metformin")).status_code == 200
    await apply(app, SOURCES_KIND, {"sources": {"openaire": False}})
    assert (await client.get("/api/v1/papers/search?q=metformin")).status_code == 200
    async with Client(app.state.mcp) as c:
        await c.call_tool("search_papers", {"query": "metformin", "limit": 1})
    assert searx.engines == [ALL, NO_OPENAIRE, NO_OPENAIRE]
