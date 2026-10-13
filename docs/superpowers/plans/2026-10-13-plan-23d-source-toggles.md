# Plan 23d: Search Source Toggles in the Admin Console — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin turns each of the nine search sources (the eight SearXNG engines and ThaiJO) off or on at `/admin/sources`, checks the draft before saving, can restore any version or go back to env, and never edits `.env` or restarts a container. Every API process follows a save within 5 s and every worker at its next job or within 30 s; a review keeps the sources it started with. While no sources version is saved, behaviour, the result-cache key and every existing test are unchanged.

**Architecture:**
- **Catalog and the sources in force** (`app/services/sources.py`, pure): `SOURCES` (nine ids, landing order), `env_defaults` and `env_extras` from `SEARXNG_ENGINES`/`THAIJO_ENABLED`, `effective_sources(base, overrides, version) -> ActiveSources(version, enabled, engines, thaijo, extras, fallback)` (the engines string is exactly `SEARXNG_ENGINES` when nothing differs from env; a set with no SearXNG source falls back to env's engines), `cache_part` (`+thaijo`, `+src<8 hex>`), `public_list`.
- **Document kind** (`app/services/sources_store.py`): `SOURCES_KIND` (`kind` `sources` in 23c's `config_versions`, mirror `mra:sources:active`); `validate_sources` (unknown ids and non-bools refused without echo, at least one SearXNG source, three warnings, entries equal to env dropped), `summarize_sources` (`{id: "env → off"}`). No migration.
- **Propagation** (Task 2): `RuntimeConfig.sources()` (5 s, last known when Redis and the DB are down) and `Runtime.sources` (`load_runtime`); the worker's `runtime_reload` gains the third kind and puts the set into `GraphDeps.sources`, so a running review keeps its set; `llm_reload` keeps it and reports it in `mra:llm:loaded`. The search node asks SearXNG with `engines=` from the set (search and top-up), runs the Europe PMC RCT searches only while Europe PMC is on and ThaiJO (search and OAI step) only while ThaiJO is on; `build_thaijo` builds the client whenever the graph is live. `SearxngClient.search` and `PaperSearch.search` take `engines` per call; `freeze_engines(deps)` records the set a pool was frozen with; `result.quality.sources` lists the ids a review used.
- **API** (Task 3): `ReviewService.sources()`; `_version()` replaces Plan 24's `+thaijo` line with `cache_part`; `/status` gains top-level `sources`; `/admin/sources` routes in `app/api/admin_runtime.py` (state, validate, save, and 23c's history, restore and reset); REST `/papers/search` and MCP `search_papers` pass the enabled engines.
- **Frontend** (Tasks 4–5): `SourcesView` at `/admin/sources` (nav "แหล่งค้น" after "ตั้งค่า") on 23c's versioned-page helpers, one `role="switch"` per source; the landing band (`Capabilities`) and the developers page list the sources from `/status` (`src/lib/search-sources.ts`), falling back to the static eight.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy, Redis (fakeredis in tests), LangGraph, the MCP server; Next.js 16, React, Vitest, Testing Library, Playwright and axe.

**Spec:** `docs/superpowers/specs/2026-10-13-plan-23d-source-toggles-design.md`

**Worktree:** `D:\MRA-plan-23d` (branch `plan-23d-sources`).
- It is based on master `8cccaee` (Plan 27 quick answer merged: `aaf7054` and the `CLAUDE.md` line `8cccaee`; `prompt_version` `2026-10-13.3`; ThaiJO on by default, pinned off in `tests/conftest.py`). Its first commits hold the spec (`64849f9`), then this plan and the pre-flight scan (`docs/superpowers/plans/2026-10-13-plan-23d-preflight.md`).
- The Bash cwd resets between calls, so every command starts with `cd /d/MRA-plan-23d/backend` or `cd /d/MRA-plan-23d/frontend`.
- The frontend needs `npm ci` once (Task 4).
- **The spec's rebase points on Plan 27 (section 10), resolved against `8cccaee`:**
  - `/status`: 23d adds the top-level `sources` before `limits`; Plan 27's `limits.modes` and `limits.quick` are untouched. `ServiceStatus` gains `sources?` beside them.
  - Cache key: Plan 27 put the mode into the stored options (`compute_cache_key`), not into `ReviewService._version()`; 23d replaces only the `+thaijo` line at the end of `_version()` with `cache_part(...)`, so the mode stays where 27 put it.
  - Quick-mode search path: a quick answer runs the same `search` and `enrich` nodes as a full review (it diverges only after `select_top`), so the helpers `engine_args`, `trial_search_on` and `thaijo_on` in `retrieval.py` cover it; no second path exists.
  - `docs/api.md`: 23d's edits land after 27's (Task 6).
- **Existing interfaces this plan uses**, checked against master `8cccaee` on 2026-10-13:
  - `DocKind`, `DocumentError`, `save_version`, `restore_version`, `reset_to_seed`, `newest`, `publish`, `read_active`, `reconcile_mirror`, `mirror_version`, `version_out` (`app/services/config_store.py`); `SETTINGS_KIND` (`runtime_settings.py`); `GLOSSARY_KIND` (`glossary_store.py`); `Runtime`, `load_runtime`, `RuntimeConfig` (`_fresh`, `invalidate`) (`runtime_config.py`); `loaded_workers`, `report_loaded`, `LOADED_KEY` (`llm_store.py`); `ReviewService.effective`, `_version`, `status` (`review_service.py`); `_write`, `_history_routes`, `BaseBody`, `Note`, `ip_hash_of`, `require_admin` (`app/api/admin_runtime.py`, `admin_models.py`, `auth.py`);
  - `init_runtime`, `_wanted`, `_PartialRead`, `_rebuild`, `refresh_runtime` (`app/worker/runtime_reload.py`); `report_state`, `_wire`, `init_llms`, `refresh_llms` (`app/worker/llm_reload.py`); `build_graph_deps`, `build_thaijo` (`app/graph/factory.py`); `GraphDeps`, `_add_review_nodes` (`app/graph/graph.py`); `make_search`, `make_enrich`, `_topup_search`, `thaijo_search` (`app/graph/nodes/retrieval.py`); `summarize_quality` (`app/harness/quality.py`); `SearxngClient.search` (`searxng.py`); `PaperSearch.search` (`paper_search.py`); the `/papers/search` route (`app/api/papers.py`) and the MCP `search_papers` tool (`app/mcp/server.py`); `freeze_engines` (`app/evals/freeze.py`), `eval_runtime`, `eval_main` (`app/cli/eval.py`);
  - test helpers `admin_headers` (`tests/admin_helpers.py`), `apply`, `TOPIC` (`tests/unit/test_runtime_api.py`), `make_ctx`, `save`, `save_and_publish`, `FakeGraph`, `build_graph_fn`, `OWNER` (`tests/unit/test_runtime_reload.py`), `FakeThaiJo`, `thai` (`tests/unit/test_thaijo_search_node.py`), `ABSTRACT`, `FakeEpmc` (`tests/unit/test_nodes_retrieval.py`), `Searx`, `Epmc`, `hits` (`tests/unit/test_papers_and_report.py`), `MINIMAL` (`tests/llm_helpers.py`), the `app`, `client`, `redis`, `session_factory` fixtures (`tests/conftest.py`);
  - frontend `useVersionedPage`, `VersionedSpec`, `DraftStatus` (`versioned-page.tsx`), `VersionHistory`, `WorkerVersions`, `ConfirmButton`, `STALE_TEXT` (`settings-view.tsx`), `BUTTON_GHOST`, `BUTTON_PRIMARY`, `INPUT` (`ui.ts`), `adminApi`, `AdminApiError`, `WORKERS_NOT_NOTIFIED`, `mockAdminFetch`, `renderAdmin` (`src/test/admin-fetch.tsx`), `getServerStatus` (`server-api.ts`), `Capabilities`, `ServiceStatus`, e2e `mockApi`.
- When master differs from what is quoted here, follow master and note it in the task report.

## Global Constraints

- **Dependencies and schema:** none new, backend or frontend. No migration: `config_versions.kind` is `varchar(16)` with no check constraint, and `sources` fits.
- **No spend:** no LLM call and no real SearXNG, ThaiJO or Europe PMC call anywhere in this plan, tests included (fakes and `httpx.MockTransport` only). The controller's smoke check starts no review.
- **Prompts:** none change. `prompt_version` stays `2026-10-13.3`; the SLR pins and every other pin are untouched.
- **Catalog (exact):** ids `pubmed`, `europepmc`, `openalex`, `semantic_scholar`, `crossref`, `arxiv`, `doaj`, `openaire` (kind `searxng`, engines `pubmed`, `europe pmc`, `openalex`, `semantic scholar`, `crossref`, `arxiv`, `doaj`, `openaire`) and `thaijo` (kind `direct`), in that order; labels PubMed, Europe PMC, OpenAlex, Semantic Scholar, Crossref, arXiv, DOAJ, OpenAIRE, ThaiJO; `plos` → PLOS for an env-only extra.
- **Store:** document `{"sources": {id: bool}}`, sparse (entries equal to env dropped); seed and reset `{"sources": {}}`; Redis mirror `mra:sources:active` = `{"version": N, "sources": {...}}`; audit `sources.save|restore|reset`, `target_type` `sources`. API cache 5 s, worker poll 30 s (23c's values, unchanged).
- **Cache key:** with no sources version the pipeline version is today's (`+thaijo` while `THAIJO_ENABLED`). With a version: `+thaijo` while ThaiJO is on in the set, then `+src` + the first 8 hex digits of sha256 over the sorted engine names joined by `,`, only when the SearXNG engine set differs from env's.
- **Rules:** at least one SearXNG source on (an error, field `sources`); unknown id → field `sources`, message `sources: unknown source` (never the key); non-bool → field `sources.<id>`. Warnings (exact strings in `sources_store.py`): PubMed and Europe PMC both off; Europe PMC off (its RCT search too); ThaiJO on while `THAIJO_ENABLED=false`.
- **Tests stay offline:** `tests/conftest.py` keeps `THAIJO_ENABLED=false`; no test needs a real ThaiJO or SearXNG response.
- **Python files** are written with LF line endings (`newline="\n"`). Do not paste file contents through a Bash heredoc on this host: it collapses `\\` to `\`. Use the editor tools.
- **Commits:** each message is written with the Write tool to `D:\MRA-plan-23d\.superpowers\commit-msg.txt` (the folder is git-ignored) and committed with `git commit -F .superpowers/commit-msg.txt`. Every message ends with exactly `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Known flaky tests:** `tests/unit/test_capacity.py::test_queue_position` (about 1 run in 3) and the e2e `admin-runtime.spec.ts` "settings: edit, check and save as version 3…" (a 30 s timeout under load). Under host load, `src/lib/agent-layout.test.ts` "keeps everything inside the viewBox and nodes apart" and `team-stage.test.tsx` "Plan 21 fix round 1 …" can pass the 5 s vitest timeout; they pass alone and this plan touches neither. If one fails, rerun it alone once and report both results.
- **e2e port:** `npm run e2e` serves the build on port 3100 (`playwright.config.ts`, `reuseExistingServer`); check that nothing else holds 3100 first (another worktree's e2e run would be reused and test the wrong code), and wait rather than stop it.
- **Do not touch** `D:\MedicalReviewerAgent` until the controller's merge step, and there never `CLAUDE.md`'s working-tree edits, `frontend/CLAUDE.md` or `infra/searxng/limiter.toml.new`.

## Review Focus

1. **No version, no change** (Tasks 1, 3): `test_no_overrides_give_the_env_engines_string_exactly`, `test_the_cache_part_keeps_today_s_key_until_a_version_exists` and `test_the_cache_key_is_unchanged_while_no_sources_version_changes_the_set`; the existing suite passes with only the two ThaiJO tests and the `Searx` fake changed (Task 2).
2. **Validation** (Task 1): `test_at_least_one_searxng_source_must_stay_on`, `test_validation_drops_entries_equal_to_env_and_warns`, `test_bad_documents_name_the_field_and_never_echo_what_was_sent`.
3. **One review, one set** (Task 2): `test_a_sources_change_rebuilds_deps_and_a_running_graph_keeps_its_set`, `test_a_lost_publish_is_picked_up_by_the_poll`, `test_a_model_reload_keeps_the_sources`, `test_the_api_reads_the_sources_on_a_mirror_hit_a_miss_and_keeps_them_while_both_are_down`.
4. **The search follows the switches** (Tasks 2, 3): `test_the_search_asks_only_the_enabled_engines_in_search_and_top_up`, `test_europepmc_off_also_turns_the_rct_search_off`, `test_thaijo_follows_the_sources_not_thaijo_enabled`, `test_paper_search_asks_the_enabled_engines_in_rest_and_mcp`.
5. **Cache generations and the admin surface** (Tasks 3, 4): `test_a_saved_engine_set_or_thaijo_starts_its_own_cache_generation`, `test_a_stored_version_that_no_longer_fits_env_is_reported_never_a_500`, the 409/422/CSRF/OpenAPI route tests, `sources-view.test.tsx` and `e2e/admin-sources.spec.ts` (axe and no sideways scroll at 1440 and 390 px, light and dark).

---

### Task 1: The source catalog, the sources in force and the sources document kind

**Files:**
- Create: `backend/app/services/sources.py`
- Create: `backend/app/services/sources_store.py`
- Test (create): `backend/tests/unit/test_sources.py`

**Interfaces:**
- Consumes: `DocKind`, `DocumentError`, `save_version`, `restore_version`, `reset_to_seed`, `publish` (`config_store.py`); `Settings.searxng_engines`, `Settings.thaijo_enabled`.
- Produces:
  - `app/services/sources.py`: `Source(id, label, kind, engine)`, `SOURCES`, `SOURCE_IDS`, `BY_ID`, `EXTRA_LABELS`, `env_engines(settings)`, `env_defaults(settings) -> dict[str, bool]`, `env_extras(settings) -> list[str]`, `ActiveSources(version, enabled, engines, thaijo, extras=(), fallback=False)` with `.label` (`"env"` or the version) and `.has_europepmc`, `clean_overrides(overrides) -> dict[str, bool]`, `effective_sources(base, overrides, version=None) -> ActiveSources`, `engine_fingerprint(engines) -> str`, `cache_part(active, base) -> str`, `public_list(active) -> list[{id, label}]`.
  - `app/services/sources_store.py`: `SOURCES_KEY = "mra:sources:active"`, `NO_SEARXNG`, `WARN_BIOMEDICAL`, `WARN_EUROPEPMC`, `WARN_THAIJO`, `validate_sources(raw, settings) -> (document, warnings)`, `summarize_sources(old, new)`, `SOURCES_KIND`.

- [ ] **Step 1: Write the failing tests**

**New file** `backend/tests/unit/test_sources.py` (complete):

```python
"""Plan 23d: the search-source catalog, the sources in force and the `sources` document kind."""
import json

import pytest
from sqlalchemy import select

from app.config import Settings
from app.db.models import AdminAudit
from app.services.admin_auth import AdminPrincipal
from app.services.config_store import (
    DocumentError,
    publish,
    reset_to_seed,
    restore_version,
    save_version,
)
from app.services.sources import (
    SOURCE_IDS,
    cache_part,
    effective_sources,
    engine_fingerprint,
    env_defaults,
    env_extras,
    public_list,
)
from app.services.sources_store import (
    NO_SEARXNG,
    SOURCES_KEY,
    SOURCES_KIND,
    WARN_BIOMEDICAL,
    WARN_EUROPEPMC,
    WARN_THAIJO,
    summarize_sources,
    validate_sources,
)

OWNER = AdminPrincipal(kind="user", id=None, label="owner")
ENV = Settings(_env_file=None)  # tests/conftest.py pins THAIJO_ENABLED=false
ENV_ON = Settings(_env_file=None, thaijo_enabled=True)
WITH_PLOS = Settings(_env_file=None, searxng_engines="pubmed,plos,europe pmc,openalex")


def test_the_catalog_holds_the_nine_sources_in_landing_order():
    assert SOURCE_IDS == ("pubmed", "europepmc", "openalex", "semantic_scholar", "crossref", "arxiv", "doaj",
                          "openaire", "thaijo")


def test_env_gives_each_source_its_default_and_keeps_the_extras():
    assert env_defaults(ENV) == {**dict.fromkeys(SOURCE_IDS, True), "thaijo": False}
    assert env_defaults(ENV_ON)["thaijo"] is True
    plos = env_defaults(WITH_PLOS)
    assert [i for i, on in plos.items() if on] == ["pubmed", "europepmc", "openalex"]
    assert env_extras(WITH_PLOS) == ["plos"] and env_extras(ENV) == []


def test_no_overrides_give_the_env_engines_string_exactly():
    for base in (ENV, ENV_ON, WITH_PLOS, Settings(_env_file=None, searxng_engines=" pubmed , arxiv")):
        active = effective_sources(base, {})
        assert active.engines == base.searxng_engines and active.version is None and active.label == "env"
        assert active.thaijo is base.thaijo_enabled and not active.fallback
    assert effective_sources(ENV, {"openaire": True}, 2).engines == ENV.searxng_engines  # equal to env: no change


def test_overrides_turn_sources_off_and_on_in_both_directions():
    off = effective_sources(ENV_ON, {"openaire": False, "thaijo": False}, 3)
    assert off.engines == "pubmed,europe pmc,openalex,semantic scholar,crossref,arxiv,doaj"
    assert "openaire" not in off.enabled and off.thaijo is False and off.label == "3"
    on = effective_sources(ENV, {"thaijo": True}, 1)  # console wins over THAIJO_ENABLED=false
    assert on.thaijo is True and on.enabled[-1] == "thaijo" and on.engines == ENV.searxng_engines
    mixed = effective_sources(WITH_PLOS, {"europepmc": False, "doaj": True, "crossref": True}, 4)
    assert mixed.engines == "pubmed,plos,openalex,crossref,doaj"  # env order (extras kept), then catalog order
    assert mixed.extras == ("plos",) and not mixed.has_europepmc and effective_sources(ENV, {}).has_europepmc


def test_entries_that_no_longer_validate_are_skipped():
    active = effective_sources(ENV, {"pubmed": False, "scopus": False, "arxiv": "no", "doaj": 0}, 5)
    assert active.enabled == tuple(i for i in SOURCE_IDS if i not in ("pubmed", "thaijo"))
    assert effective_sources(ENV, ["pubmed"], 5).engines == ENV.searxng_engines  # not a mapping: env


def test_a_set_with_no_searxng_source_falls_back_to_env_engines():
    only_pubmed = Settings(_env_file=None, searxng_engines="pubmed")
    active = effective_sources(only_pubmed, {"pubmed": False, "thaijo": True}, 2)
    assert active.fallback and active.engines == "pubmed" and active.enabled == ("pubmed", "thaijo")


def test_the_cache_part_keeps_today_s_key_until_a_version_exists():
    assert cache_part(effective_sources(ENV, {}), ENV) == ""
    assert cache_part(effective_sources(ENV_ON, {}), ENV_ON) == "+thaijo"
    # a version that changes nothing (a reset, or overrides env already agrees with) keeps the generation
    assert cache_part(effective_sources(ENV_ON, {}, 7), ENV_ON) == "+thaijo"
    # turning ThaiJO off in the console gives the key of turning it off in env
    assert cache_part(effective_sources(ENV_ON, {"thaijo": False}, 2), ENV_ON) == cache_part(effective_sources(ENV, {}), ENV)
    off = cache_part(effective_sources(ENV_ON, {"openaire": False}, 3), ENV_ON)
    assert off == "+thaijo+src" + engine_fingerprint("pubmed,europe pmc,openalex,semantic scholar,crossref,arxiv,doaj")
    assert cache_part(effective_sources(ENV_ON, {"openaire": False}, 9), ENV_ON) == off  # restoring: same generation


def test_the_fingerprint_ignores_order_and_spacing():
    assert engine_fingerprint("arxiv, pubmed") == engine_fingerprint("pubmed,arxiv") != engine_fingerprint("pubmed")
    assert len(engine_fingerprint("pubmed")) == 8


def test_the_public_list_is_the_enabled_sources_then_the_extras():
    assert public_list(effective_sources(ENV_ON, {"crossref": False}, 1)) == [
        {"id": "pubmed", "label": "PubMed"}, {"id": "europepmc", "label": "Europe PMC"},
        {"id": "openalex", "label": "OpenAlex"}, {"id": "semantic_scholar", "label": "Semantic Scholar"},
        {"id": "arxiv", "label": "arXiv"}, {"id": "doaj", "label": "DOAJ"}, {"id": "openaire", "label": "OpenAIRE"},
        {"id": "thaijo", "label": "ThaiJO"}]
    extras = public_list(effective_sources(Settings(_env_file=None, searxng_engines="pubmed,plos,other"), {}))
    assert extras[-2:] == [{"id": "plos", "label": "PLOS"}, {"id": "other", "label": "other"}]


def test_validation_drops_entries_equal_to_env_and_warns():
    document, warnings = validate_sources({"sources": {"openaire": False, "pubmed": True, "thaijo": False}}, ENV)
    assert document == {"sources": {"openaire": False}} and warnings == []
    document, warnings = validate_sources({"sources": {"europepmc": False, "pubmed": False, "thaijo": True}}, ENV)
    assert document == {"sources": {"pubmed": False, "europepmc": False, "thaijo": True}}
    assert warnings == [WARN_BIOMEDICAL, WARN_EUROPEPMC, WARN_THAIJO]
    assert validate_sources({"sources": {"thaijo": True}}, ENV_ON) == ({"sources": {}}, [])
    assert validate_sources({}, ENV) == ({"sources": {}}, [])


def test_at_least_one_searxng_source_must_stay_on():
    all_off = dict.fromkeys(SOURCE_IDS[:-1], False)
    with pytest.raises(DocumentError) as exc:
        validate_sources({"sources": {**all_off, "thaijo": True}}, ENV)
    assert exc.value.errors == [{"field": "sources", "message": NO_SEARXNG}]
    assert validate_sources({"sources": {**all_off, "arxiv": True}}, ENV)[0]["sources"]["pubmed"] is False


def test_bad_documents_name_the_field_and_never_echo_what_was_sent():
    with pytest.raises(DocumentError) as exc:
        validate_sources({"sources": {"pubmed": "yes", "scopus\ud800": False, "other": True, "doaj": 1}}, ENV)
    assert exc.value.errors == [
        {"field": "sources.pubmed", "message": "sources.pubmed: must be true or false"},
        {"field": "sources", "message": "sources: unknown source"},
        {"field": "sources.doaj", "message": "sources.doaj: must be true or false"}]
    for raw in ({"sources": []}, {"values": {}}, {"sources": {}, "note": "x"}, ["pubmed"], None):
        with pytest.raises(DocumentError) as exc:
            validate_sources(raw, ENV)
        assert exc.value.errors[0]["field"] is None and "yes" not in exc.value.errors[0]["message"]


def test_the_summary_names_each_source_that_moved():
    assert summarize_sources({"sources": {"openaire": False}}, {"sources": {"thaijo": True}}) == {
        "openaire": "off → env", "thaijo": "env → on"}
    assert summarize_sources(None, {"sources": {}}) == {}


async def test_save_restore_and_reset_go_through_the_config_store_with_audit_rows(session_factory, redis):
    async with session_factory() as s, s.begin():
        v1 = await save_version(s, OWNER, SOURCES_KIND, {"sources": {"openaire": False, "pubmed": True}},
                                settings=ENV, base_version=None, note="openaire is slow")
    assert (v1.version, v1.document, v1.changes) == (1, {"sources": {"openaire": False}}, {"openaire": "env → off"})
    assert await publish(redis, SOURCES_KIND, v1)
    assert json.loads(await redis.get(SOURCES_KEY)) == {"version": 1, "sources": {"openaire": False}}
    async with session_factory() as s, s.begin():
        v2 = await reset_to_seed(s, OWNER, SOURCES_KIND, settings=ENV, base_version=1)
    async with session_factory() as s, s.begin():
        v3 = await restore_version(s, OWNER, SOURCES_KIND, 1, settings=ENV, base_version=2)
    assert (v2.document, v2.source, v3.document, v3.restored_from) == ({"sources": {}}, "reset",
                                                                     {"sources": {"openaire": False}}, 1)
    async with session_factory() as s:
        rows = (await s.execute(select(AdminAudit).order_by(AdminAudit.id))).scalars().all()
    assert [(r.action, r.target_type, r.target_id) for r in rows] == [
        ("sources.save", "sources", "1"), ("sources.reset", "sources", "2"), ("sources.restore", "sources", "3")]
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-plan-23d/backend && uv run pytest tests/unit/test_sources.py -q`

Expected: collection error `ModuleNotFoundError: No module named 'app.services.sources'`.

- [ ] **Step 3: Implement**

**New file** `backend/app/services/sources.py` (complete):

```python
"""The search sources the admin console can turn on or off (Plan 23d). Pure: no I/O.

Nine fixed sources: eight SearXNG engines and ThaiJO (the direct client, Plan 24). The environment gives each one its
default (a SearXNG source is on when its engine is in SEARXNG_ENGINES, ThaiJO when THAIJO_ENABLED is true); a saved
version of the `sources` document kind holds only the sources that differ from it ({"sources": {id: bool}}) and wins in
both directions. Engines in SEARXNG_ENGINES that the catalog does not know (an opted-in `plos`) are kept as they are
and cannot be toggled. Reading never fails: an entry that no longer validates is skipped with a log line, and a set
that would leave no SearXNG source falls back to env's engines (`fallback`)."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any, Literal

from app.logging import get_logger

log = get_logger(__name__)


@dataclass(frozen=True)
class Source:
    id: str  # a slug, so error fields read sources.semantic_scholar
    label: str
    kind: Literal["searxng", "direct"]
    engine: str | None  # the SearXNG engine name; None for a direct client


SOURCES: tuple[Source, ...] = (
    Source("pubmed", "PubMed", "searxng", "pubmed"),
    Source("europepmc", "Europe PMC", "searxng", "europe pmc"),
    Source("openalex", "OpenAlex", "searxng", "openalex"),
    Source("semantic_scholar", "Semantic Scholar", "searxng", "semantic scholar"),
    Source("crossref", "Crossref", "searxng", "crossref"),
    Source("arxiv", "arXiv", "searxng", "arxiv"),
    Source("doaj", "DOAJ", "searxng", "doaj"),
    Source("openaire", "OpenAIRE", "searxng", "openaire"),
    Source("thaijo", "ThaiJO", "direct", None),
)
SOURCE_IDS = tuple(s.id for s in SOURCES)
BY_ID = {s.id: s for s in SOURCES}
_BY_ENGINE = {s.engine: s for s in SOURCES if s.engine}
EXTRA_LABELS = {"plos": "PLOS"}  # env-only engines on /status; any other shows its engine name


def env_engines(settings) -> list[str]:
    return [e.strip() for e in str(settings.searxng_engines).split(",") if e.strip()]


def env_defaults(settings) -> dict[str, bool]:
    """Each catalog source's state when no version is saved."""
    engines = set(env_engines(settings))
    return {s.id: (s.engine in engines) if s.engine else bool(settings.thaijo_enabled) for s in SOURCES}


def env_extras(settings) -> list[str]:
    """Engines in SEARXNG_ENGINES that the catalog does not know, in env order."""
    return [e for e in env_engines(settings) if e not in _BY_ENGINE]


@dataclass(frozen=True)
class ActiveSources:
    version: int | None  # None: no saved version, env is in use
    enabled: tuple[str, ...]  # the enabled catalog ids, in catalog order
    engines: str  # the SearXNG `engines=` value
    thaijo: bool
    extras: tuple[str, ...] = ()
    fallback: bool = False  # the stored set left no SearXNG source, so env's engines are used

    @property
    def label(self) -> str:
        return "env" if self.version is None else str(self.version)

    @property
    def has_europepmc(self) -> bool:
        return "europepmc" in self.enabled


def clean_overrides(overrides: Any) -> dict[str, bool]:
    """The entries that still validate; anything else is skipped with a log line (a hand-edited row or mirror)."""
    if not isinstance(overrides, dict):
        if overrides:
            log.warning("sources_not_a_mapping", got=type(overrides).__name__)
        return {}
    out: dict[str, bool] = {}
    for key, value in overrides.items():
        if key not in BY_ID:
            log.warning("source_unknown", name=str(key)[:64])
        elif not isinstance(value, bool):
            log.warning("source_invalid", name=key)
        else:
            out[key] = value
    return out


def _searxng_on(on: dict[str, bool]) -> bool:
    return any(on[s.id] for s in SOURCES if s.kind == "searxng")


def effective_sources(base, overrides: Any, version: int | None = None) -> ActiveSources:
    """The sources in force: env defaults with the saved overrides. With nothing overridden the engines string is
    exactly SEARXNG_ENGINES; otherwise env's engines in env order without the ones turned off (extras kept), then the
    catalog engines env lacks that are turned on, in catalog order."""
    env = env_defaults(base)
    on = {**env, **clean_overrides(overrides)}
    fallback = not _searxng_on(on) and _searxng_on(env)
    if fallback:  # an env change after the save left no SearXNG source: env's engines, reported by the admin read
        log.warning("sources_fallback_to_env_engines", version=version)
        on = {**env, "thaijo": on["thaijo"]}
    listed = env_engines(base)
    if on == env:
        engines = str(base.searxng_engines)
    else:
        kept = [e for e in listed if e not in _BY_ENGINE or on[_BY_ENGINE[e].id]]
        added = [s.engine for s in SOURCES if s.engine and on[s.id] and s.engine not in listed]
        engines = ",".join([*kept, *added])
    return ActiveSources(version=version, enabled=tuple(s.id for s in SOURCES if on[s.id]), engines=engines,
                         thaijo=on["thaijo"], extras=tuple(env_extras(base)), fallback=fallback)


def engine_fingerprint(engines: str) -> str:
    """The first 8 hex digits of sha256 over the sorted engine names joined by ','."""
    names = sorted({e.strip() for e in engines.split(",") if e.strip()})
    return hashlib.sha256(",".join(names).encode()).hexdigest()[:8]


def cache_part(active: ActiveSources, base) -> str:
    """The sources' part of the result-cache key. While no sources version exists it is Plan 24's rule (`+thaijo` while
    THAIJO_ENABLED), so the key is unchanged. With a version, `+thaijo` follows the ThaiJO state in force, and
    `+src{fingerprint}` is added when the SearXNG engine set differs from env's: turning ThaiJO off in the console gives
    the key of turning it off in env, and restoring an older set returns to its cache generation."""
    if active.version is None:
        return "+thaijo" if base.thaijo_enabled else ""
    part = "+thaijo" if active.thaijo else ""
    if engine_fingerprint(active.engines) != engine_fingerprint(str(base.searxng_engines)):
        part += f"+src{engine_fingerprint(active.engines)}"
    return part


def public_list(active: ActiveSources) -> list[dict[str, str]]:
    """/status `sources`: the enabled sources in catalog order, then the env-only engines."""
    return [{"id": i, "label": BY_ID[i].label} for i in active.enabled] + [
        {"id": e, "label": EXTRA_LABELS.get(e, e)} for e in active.extras]
```

**New file** `backend/app/services/sources_store.py` (complete):

```python
"""The search sources as a versioned document kind (Plan 23d, app/services/config_store.py), beside 23c's settings and
glossary. A document is {"sources": {id: bool}} holding only the sources that differ from env (entries equal to the
env default are dropped on save); reset appends {"sources": {}}. Messages name the field and never repeat a submitted
key or value."""
from __future__ import annotations

from typing import Any

from app.config import Settings
from app.services.config_store import DocKind, DocumentError
from app.services.sources import BY_ID, SOURCES, env_defaults

SOURCES_KEY = "mra:sources:active"
SHAPE = 'the document must be {"sources": {id: true or false}}'
NO_SEARXNG = ("at least one source searched through SearXNG must stay on: ThaiJO alone gives at most 1/8 of the "
              "pool, and paper search uses SearXNG only")
WARN_BIOMEDICAL = ("PubMed and Europe PMC are both off: the two biomedical indexes are off; reviews will find far "
                   "fewer clinical studies")
WARN_EUROPEPMC = ("Europe PMC is off, so the Europe PMC RCT search of meta-analyses is off too (abstract enrichment "
                  "and the citation network stay on)")
WARN_THAIJO = "ThaiJO on: this turns on calls to TCI that THAIJO_ENABLED has off"


def validate_sources(raw: Any, settings: Settings) -> tuple[dict[str, Any], list[str]]:
    """`settings` is the env (base) settings: a draft is judged on top of env, never on top of other overrides."""
    if not isinstance(raw, dict) or set(raw) - {"sources"} or not isinstance(raw.get("sources", {}), dict):
        raise DocumentError([{"field": None, "message": SHAPE}])
    errors: list[dict[str, Any]] = []
    values: dict[str, bool] = {}
    for key, value in raw.get("sources", {}).items():
        if key not in BY_ID:
            if not any(e["field"] == "sources" for e in errors):
                errors.append({"field": "sources", "message": "sources: unknown source"})
        elif not isinstance(value, bool):
            errors.append({"field": f"sources.{key}", "message": f"sources.{key}: must be true or false"})
        else:
            values[key] = value
    if errors:
        raise DocumentError(errors)
    env = env_defaults(settings)
    on = {**env, **values}
    if not any(on[s.id] for s in SOURCES if s.kind == "searxng"):
        raise DocumentError([{"field": "sources", "message": NO_SEARXNG}])
    warnings = []
    if not on["pubmed"] and not on["europepmc"]:
        warnings.append(WARN_BIOMEDICAL)
    if not on["europepmc"]:
        warnings.append(WARN_EUROPEPMC)
    if on["thaijo"] and not settings.thaijo_enabled:
        warnings.append(WARN_THAIJO)
    return {"sources": {s.id: values[s.id] for s in SOURCES if s.id in values and values[s.id] != env[s.id]}}, warnings


def summarize_sources(old: dict[str, Any] | None, new: dict[str, Any]) -> dict[str, Any]:
    """What the version changed against the one before, per source: `env → off`, `on → env`, ... (the document holds
    differences from env, so "env" means the source follows the environment)."""
    a, b = (old or {}).get("sources") or {}, (new or {}).get("sources") or {}

    def show(v: Any) -> str:
        return "env" if v is None else ("on" if v is True else "off" if v is False else "?")

    return {s.id: f"{show(a.get(s.id))} → {show(b.get(s.id))}" for s in SOURCES if a.get(s.id) != b.get(s.id)}


SOURCES_KIND = DocKind(name="sources", redis_key=SOURCES_KEY, validate=validate_sources,
                       summarize=summarize_sources, seed=lambda: {"sources": {}},
                       mirror=lambda document: {"sources": dict(document.get("sources") or {})})
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-23d/backend && uv run pytest tests/unit/test_sources.py -q`

Expected: 14 passed.

- [ ] **Step 5: Lint and the full backend suite**

Run: `cd /d/MRA-plan-23d/backend && uv run ruff check . && uv run pytest -q`

Expected: ruff `All checks passed!`; 2566 passed, 17 skipped (the base had 2552 passed, 17 skipped).

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-plan-23d\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
feat(sources): the search-source catalog, the sources in force and the sources document kind (Plan 23d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-23d && git add backend/tests/unit/test_sources.py backend/app/services/sources.py backend/app/services/sources_store.py
git commit -F .superpowers/commit-msg.txt
```

---

### Task 2: The sources reach the API, the workers, the search node, paper search and the eval freeze

**Files:**
- Modify: `backend/app/services/searxng.py`
- Modify: `backend/app/services/paper_search.py`
- Modify: `backend/app/graph/graph.py`
- Modify: `backend/app/graph/nodes/retrieval.py`
- Modify: `backend/app/harness/quality.py`
- Modify: `backend/app/graph/factory.py`
- Modify: `backend/app/services/runtime_config.py`
- Modify: `backend/app/worker/runtime_reload.py`
- Modify: `backend/app/worker/llm_reload.py`
- Modify: `backend/app/evals/freeze.py`
- Modify: `backend/app/cli/eval.py`
- Test (create): `backend/tests/unit/test_sources_propagation.py`
- Test (modify): `backend/tests/unit/test_thaijo_search_node.py`
- Test (modify): `backend/tests/unit/test_papers_and_report.py`

**Interfaces:**
- Consumes: `effective_sources`, `ActiveSources`, `SOURCES_KIND`, `SOURCES_KEY` (Task 1).
- Produces:
  - `SearxngClient.search(query, pageno=1, engines=None)`; `PaperSearch.search(query, limit=10, engines=None)` (passes `engines` only when given, so fakes without it keep working).
  - `GraphDeps.sources: Any = None` (None: deps built by hand ask every client present, as before); `build_graph_deps(..., sources=None)` always sets it (env's when None, the stub too); `build_thaijo(settings, http, redis=None) -> ThaiJoClient` (no longer reads `thaijo_enabled`).
  - `retrieval.engine_args(deps) -> dict`, `retrieval.thaijo_on(deps) -> bool`, `retrieval.trial_search_on(deps) -> bool`; the search entry of `quality` gains `sources` (the enabled ids) when the deps carry sources; `summarize_quality` copies it to `result.quality.sources`; the screening route's `thaijo_enabled` is `retrieval.thaijo_on(deps)`.
  - `Runtime.sources: ActiveSources` (`load_runtime`), `RuntimeConfig.sources()`.
  - Worker ctx `sources`, `sources_version` (`init_runtime`, `refresh_runtime`); `_KINDS`; `_PartialRead(wanted, cause)`; the heartbeat (`report_state`) gains `sources`; `_wire` passes `sources=ctx.get("sources")`.
  - `freeze_engines(deps) -> list[str]` (the deps' sources, env's when they carry none); `eval_runtime` with `--config-file` gives env sources; `eval_main` builds the deps with `runtime.sources`.

- [ ] **Step 1: Write the failing tests**

**New file** `backend/tests/unit/test_sources_propagation.py` (complete):

```python
"""Plan 23d: the sources in force reach the API (RuntimeConfig), the workers (runtime_reload), the graph deps, the
search node, paper search and the eval freeze; a running review keeps the set it started with."""
import dataclasses
import json

import httpx

from app.config import Settings
from app.evals.freeze import freeze_engines
from app.graph.factory import build_graph_deps
from app.graph.graph import GraphDeps
from app.graph.nodes.retrieval import make_enrich, make_search, thaijo_on
from app.graph.schemas import Candidate
from app.harness.quality import summarize_quality
from app.services import llm_store
from app.services.http import HttpClient
from app.services.llm_store import LOADED_KEY, publish_version
from app.services.paper_search import PaperSearch
from app.services.runtime_config import RuntimeConfig, load_runtime
from app.services.searxng import SearxngClient
from app.services.sources import effective_sources
from app.services.sources_store import SOURCES_KEY, SOURCES_KIND
from app.services.thaijo import ThaiJoClient
from app.worker.llm_reload import init_llms, refresh_llms, worker_id
from app.worker.runtime_reload import refresh_runtime
from tests.llm_helpers import MINIMAL
from tests.unit.test_nodes_retrieval import ABSTRACT, FakeEpmc
from tests.unit.test_papers_and_report import Epmc, Searx, hits
from tests.unit.test_runtime_reload import (
    OWNER,
    FakeGraph,
    build_graph_fn,
    make_ctx,
    save,
    save_and_publish,
)
from tests.unit.test_thaijo_search_node import FakeThaiJo, thai

ENV = Settings(_env_file=None)  # THAIJO_ENABLED=false (tests/conftest.py)
ENV_ON = Settings(_env_file=None, thaijo_enabled=True)
NO_OPENAIRE = "pubmed,europe pmc,openalex,semantic scholar,crossref,arxiv,doaj"


class RecordingSearxng:
    """A SearXNG fake that records the engines each call asked for; page 1 has three hits, later pages one."""

    def __init__(self):
        self.calls = []

    async def search(self, query, pageno=1, engines=None):
        self.calls.append((query, pageno, engines))
        n = 3 if pageno == 1 else 1
        return [Candidate(title=f"{query} hit {pageno}.{i} about metformin", doi=f"10.1/{query}.{pageno}.{i}",
                          abstract=ABSTRACT, abstract_source="engine", engines=["pubmed"]) for i in range(n)]


class TrialEpmc(FakeEpmc):
    def __init__(self):
        super().__init__([])
        self.trials = []

    async def search_trials(self, query, page_size=25):
        self.trials.append(query)
        return []


def deps_with(sources, **kw):
    settings = Settings(_env_file=None, searxng_pages=1, searxng_pages_max=2)
    return GraphDeps(settings=settings, searxng=kw.pop("searxng", RecordingSearxng()), europepmc=TrialEpmc(),
                     sources=sources, **kw)


# ---- the API process ------------------------------------------------------------------------------------------------
class Down:
    async def get(self, *_):
        raise ConnectionError("redis down")


def broken_db():
    raise ConnectionError("db down")


async def test_the_api_reads_the_sources_on_a_mirror_hit_a_miss_and_keeps_them_while_both_are_down(session_factory,
                                                                                                 redis):
    rc = RuntimeConfig(ENV, session_factory, redis, ttl=0)
    first = await rc.sources()
    assert first.version is None and first.engines == ENV.searxng_engines
    await save(session_factory, SOURCES_KIND, {"sources": {"openaire": False}})  # in the DB only: a mirror miss
    missed = await rc.sources()
    assert (missed.version, missed.engines) == (1, NO_OPENAIRE)
    await redis.set(SOURCES_KEY, json.dumps({"version": 2, "sources": {"thaijo": True}}))  # a mirror hit
    hit = await rc.sources()
    assert (hit.version, hit.thaijo, hit.engines) == (2, True, ENV.searxng_engines)
    rc.redis, rc.session_factory = Down(), broken_db
    assert await rc.sources() == hit  # the last known set, never an error


async def test_load_runtime_carries_the_saved_sources(session_factory):
    assert (await load_runtime(session_factory, ENV)).sources == effective_sources(ENV, {})
    await save(session_factory, SOURCES_KIND, {"sources": {"openaire": False, "thaijo": True}})
    runtime = await load_runtime(session_factory, ENV)
    assert (runtime.sources.label, runtime.sources.engines, runtime.sources.thaijo) == ("1", NO_OPENAIRE, True)


# ---- the workers ----------------------------------------------------------------------------------------------------
async def worker_ctx(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    deps = dataclasses.replace(ctx["graph_deps"], sources=ctx["sources"])
    ctx.update(graph_deps=deps, graph=FakeGraph(deps, checkpointer="CP"))
    return ctx


async def test_a_sources_change_rebuilds_deps_and_a_running_graph_keeps_its_set(tmp_path, session_factory, redis):
    ctx = await worker_ctx(tmp_path, session_factory, redis)
    assert (ctx["sources_version"], ctx["sources"].version) == ("env", None)
    running = ctx["graph"]
    await save_and_publish(session_factory, redis, SOURCES_KIND, {"sources": {"openaire": False}})
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is True
    assert ctx["sources_version"] == "1" and ctx["graph_deps"].sources is ctx["sources"]
    assert ctx["graph"].deps.sources.engines == NO_OPENAIRE and ctx["graph"].checkpointer == "CP"
    assert running.deps.sources.engines == ENV.searxng_engines  # the review already running keeps its set
    report = json.loads(await redis.hget(LOADED_KEY, worker_id()))
    assert (report["sources"], report["settings"], report["glossary"]) == ("1", "env", "file")
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is False


async def test_a_lost_publish_is_picked_up_by_the_poll(tmp_path, session_factory, redis):
    ctx = await worker_ctx(tmp_path, session_factory, redis)
    await save(session_factory, SOURCES_KIND, {"sources": {"thaijo": True}})  # saved, but Redis never heard of it
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is False  # a job start trusts the mirror
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn, poll=True) is True
    assert ctx["graph_deps"].sources.thaijo is True and json.loads(await redis.get(SOURCES_KEY))["version"] == 1


async def test_a_model_reload_keeps_the_sources(tmp_path, session_factory, redis):
    await save_and_publish(session_factory, redis, SOURCES_KIND, {"sources": {"openaire": False}})
    ctx = await make_ctx(tmp_path, session_factory, redis)
    ctx["http"] = HttpClient()
    await init_llms(ctx, None, "CP", build_graph_fn=build_graph_fn)
    assert ctx["graph_deps"].sources is ctx["sources"] and ctx["sources"].engines == NO_OPENAIRE
    async with session_factory() as s, s.begin():
        row = await llm_store.save_version(s, OWNER, {**MINIMAL, "active_preset": "better"},
                                           settings=ctx["settings"], base_version=None)
    await publish_version(redis, row.id)
    assert await refresh_llms(ctx, build_graph_fn=build_graph_fn) is True
    assert ctx["graph_deps"].llms.preset == "better" and ctx["graph_deps"].sources is ctx["sources"]
    await ctx["http"].aclose()


# ---- graph deps, the search node, paper search, evals ---------------------------------------------------------------
async def test_graph_deps_carry_the_sources_and_the_thaijo_client_is_built_in_live_mode(redis):
    http = HttpClient()
    live = Settings(_env_file=None, openrouter_api_key="sk-or-x")
    deps = build_graph_deps(live, http, redis)
    assert deps.sources == effective_sources(live, {}) and isinstance(deps.thaijo, ThaiJoClient)
    assert not thaijo_on(deps)  # THAIJO_ENABLED=false: the client exists, the env default keeps it off
    chosen = effective_sources(live, {"thaijo": True}, 4)
    assert thaijo_on(build_graph_deps(live, http, redis, sources=chosen))
    stub = build_graph_deps(Settings(_env_file=None, graph_mode="stub"), http, sources=chosen)
    assert stub.sources is chosen and stub.thaijo is None
    await http.aclose()


async def test_the_search_asks_only_the_enabled_engines_in_search_and_top_up():
    sources = effective_sources(ENV, {"openaire": False}, 1)
    deps = deps_with(sources)
    state = {"plan": {"queries": ["q1", "q2"]}, "options": {"candidate_limit": 120, "max_papers": 30}}
    out = await make_search(deps)(state)
    assert out["quality"][0]["sources"] == list(sources.enabled) and "openaire" not in sources.enabled
    await make_enrich(deps)({**state, "candidates": out["candidates"]})  # 6 candidates < 120: one top-up page
    assert [(q, p) for q, p, _ in deps.searxng.calls] == [("q1", 1), ("q2", 1), ("q1", 2), ("q2", 2)]
    assert {e for _, _, e in deps.searxng.calls} == {NO_OPENAIRE}


async def test_europepmc_off_also_turns_the_rct_search_off():
    meta = {"plan": {"queries": ["q1"]}, "options": {"review_type": "meta_analysis", "max_papers": 30}}
    on = deps_with(effective_sources(ENV, {}, 1))
    assert (await make_search(on)(meta))["quality"][0]["trial_queries"] == 1 and on.europepmc.trials == ["q1"]
    off = deps_with(effective_sources(ENV, {"europepmc": False}, 2))
    out = await make_search(off)(meta)
    assert out["quality"][0]["trial_queries"] == 0 and off.europepmc.trials == []
    assert "europe pmc" not in off.searxng.calls[0][2]


async def test_thaijo_follows_the_sources_not_thaijo_enabled():
    state = {"plan": {"queries": ["q1"]}, "options": {"candidate_limit": 120, "max_papers": 30}}
    off = FakeThaiJo([thai(1)])
    out = await make_search(deps_with(effective_sources(ENV_ON, {"thaijo": False}, 1), thaijo=off))(state)
    assert off.calls == [] and "thaijo" not in out["quality"][0]
    on = FakeThaiJo([thai(1)])  # THAIJO_ENABLED is false here; the console turned it on
    out = await make_search(deps_with(effective_sources(ENV, {"thaijo": True}, 2), thaijo=on))(state)
    assert on.calls == [(["q1"], 15)] and out["search_stats"]["per_source"]["thaijo"] == 1
    assert out["quality"][0]["sources"][-1] == "thaijo"



def test_result_quality_lists_the_sources_when_the_search_recorded_them():
    assert summarize_quality([{"stage": "search", "sources": ["pubmed", "arxiv"]}], None)["sources"] == ["pubmed",
                                                                                                         "arxiv"]
    assert "sources" not in summarize_quality([{"stage": "search"}], None)


async def test_searxng_and_paper_search_take_the_engines_per_call():
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.params["engines"])
        return httpx.Response(200, json={"results": []})

    http = HttpClient(retries=0, transport=httpx.MockTransport(handler))
    client = SearxngClient(http, "http://searxng.test", ENV.searxng_engines)
    await client.search("q")
    await client.search("q", engines="pubmed,arxiv")
    assert seen == [ENV.searxng_engines, "pubmed,arxiv"]
    await http.aclose()
    searx = Searx(hits())
    await PaperSearch(searx, Epmc()).search("metformin", 5, engines="pubmed")
    await PaperSearch(searx, Epmc()).search("metformin", 5)
    assert searx.engines == ["pubmed", None]


def test_a_frozen_pool_names_the_sources_it_was_searched_with():
    assert freeze_engines(GraphDeps(settings=ENV))[-1] == "openaire"
    deps = GraphDeps(settings=ENV, sources=effective_sources(ENV, {"openaire": False, "thaijo": True}, 3))
    assert freeze_engines(deps) == [*NO_OPENAIRE.split(","), "thaijo"]

```

**Edit** `backend/tests/unit/test_thaijo_search_node.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python


def test_the_client_exists_only_when_enabled():
    http = HttpClient()
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    assert build_thaijo(Settings(_env_file=None), http, redis) is None
    client = build_thaijo(Settings(_env_file=None, thaijo_enabled=True, thaijo_request_timeout_seconds=4.0), http, redis)
    assert isinstance(client, ThaiJoClient) and client.cache is redis and client.timeout == 4.0
```

   with

```python


def test_the_client_is_built_whatever_thaijo_enabled_says():
    http = HttpClient()
    redis = fakeredis.aioredis.FakeRedis(decode_responses=True)
    # Plan 23d: construction does no I/O; the sources in force decide whether it is asked (test_sources_propagation.py)
    assert isinstance(build_thaijo(Settings(_env_file=None), http, redis), ThaiJoClient)
    client = build_thaijo(Settings(_env_file=None, thaijo_enabled=True, thaijo_request_timeout_seconds=4.0), http, redis)
    assert isinstance(client, ThaiJoClient) and client.cache is redis and client.timeout == 4.0
```

2. Replace

```python

def test_a_frozen_pool_names_thaijo_when_it_was_searched():
    assert "thaijo" not in freeze_engines(Settings(_env_file=None))
    assert freeze_engines(Settings(_env_file=None, thaijo_enabled=True))[-1] == "thaijo"


```

   with

```python

def test_a_frozen_pool_names_thaijo_when_it_was_searched():
    assert "thaijo" not in freeze_engines(GraphDeps(settings=Settings(_env_file=None)))
    assert freeze_engines(GraphDeps(settings=Settings(_env_file=None, thaijo_enabled=True)))[-1] == "thaijo"


```

**Edit** `backend/tests/unit/test_papers_and_report.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
class Searx:
    def __init__(self, results=None, fail=False):
        self.results, self.fail, self.queries = results or [], fail, []

    async def search(self, query, pageno=1):
        self.queries.append(query)
        if self.fail:
            raise httpx.ConnectError("down")
```

   with

```python
class Searx:
    def __init__(self, results=None, fail=False):
        self.results, self.fail, self.queries, self.engines = results or [], fail, [], []

    async def search(self, query, pageno=1, engines=None):
        self.queries.append(query)
        self.engines.append(engines)
        if self.fail:
            raise httpx.ConnectError("down")
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-plan-23d/backend && uv run pytest tests/unit/test_sources_propagation.py tests/unit/test_thaijo_search_node.py tests/unit/test_papers_and_report.py -q`

Expected: collection error `ImportError: cannot import name 'thaijo_on' from 'app.graph.nodes.retrieval'`.

- [ ] **Step 3: Implement**

**Edit** `backend/app/services/searxng.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
        self.timeout = timeout

    async def search(self, query: str, pageno: int = 1) -> list[Candidate]:
        # engines= only: passing categories= as well would union in non-academic engines.
        # One retry only: a slow query must not wait out several full timeouts (HttpClient retries default to 3).
        resp = await self.http.get(
            f"{self.base_url}/search",
            params={"q": query, "format": "json", "engines": self.engines, "pageno": pageno},
            timeout=self.timeout,
            retries=1,
```

   with

```python
        self.timeout = timeout

    async def search(self, query: str, pageno: int = 1, engines: str | None = None) -> list[Candidate]:
        # engines= only: passing categories= as well would union in non-academic engines. `engines` (Plan 23d): the
        # engines the admin console has on; the constructor's (SEARXNG_ENGINES) when None.
        # One retry only: a slow query must not wait out several full timeouts (HttpClient retries default to 3).
        resp = await self.http.get(
            f"{self.base_url}/search",
            params={"q": query, "format": "json", "engines": engines or self.engines, "pageno": pageno},
            timeout=self.timeout,
            retries=1,
```

**Edit** `backend/app/services/paper_search.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
        self.europepmc = europepmc

    async def search(self, query: str, limit: int = 10) -> list[Candidate]:
        try:
            hits = await self.searxng.search(query)
        except Exception as exc:
            raise SearchUnavailable(f"literature search is unavailable: {type(exc).__name__}") from exc
```

   with

```python
        self.europepmc = europepmc

    async def search(self, query: str, limit: int = 10, engines: str | None = None) -> list[Candidate]:
        """`engines` (Plan 23d): the SearXNG engines in force (the REST route and the MCP tool pass the console's
        set); the client's own when None."""
        try:
            hits = await (self.searxng.search(query, engines=engines) if engines else self.searxng.search(query))
        except Exception as exc:
            raise SearchUnavailable(f"literature search is unavailable: {type(exc).__name__}") from exc
```

**Edit** `backend/app/graph/graph.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
    glossary: Any = None  # app.harness.glossary.ActiveGlossary; None → the built-in glossary (Plan 23c)
    thaijo: Any = None  # app.services.thaijo.ThaiJoClient (Plan 24); None → ThaiJO is never searched


```

   with

```python
    glossary: Any = None  # app.harness.glossary.ActiveGlossary; None → the built-in glossary (Plan 23c)
    thaijo: Any = None  # app.services.thaijo.ThaiJoClient (Plan 24); None → ThaiJO is never searched
    # app.services.sources.ActiveSources (Plan 23d): the search sources in force, fixed for the review (the worker
    # rebuilds deps on a new version). None (deps built by hand) → every client present is asked, SearXNG with its own
    # engines, as before Plan 23d; build_graph_deps always sets it.
    sources: Any = None


```

2. Replace

```python
        partial(screening.route_to_reading, external_enabled=lambda: deps.mcp is not None and deps.mcp.enabled,
                citations_enabled=lambda: deps.openalex is not None,
                thaijo_enabled=lambda: getattr(deps, "thaijo", None) is not None),
        ["read_paper", "external_enrich", "fetch_citations", "thaijo_metadata", "normalize_outcomes"],
    )
```

   with

```python
        partial(screening.route_to_reading, external_enabled=lambda: deps.mcp is not None and deps.mcp.enabled,
                citations_enabled=lambda: deps.openalex is not None,
                thaijo_enabled=lambda: retrieval.thaijo_on(deps)),
        ["read_paper", "external_enrich", "fetch_citations", "thaijo_metadata", "normalize_outcomes"],
    )
```

**Edit** `backend/app/graph/nodes/retrieval.py` (4 replacements; each `old` occurs exactly once):

1. Replace

```python


def make_search(deps):
    async def search(state: ReviewState) -> dict:
```

   with

```python


# ---- the search sources in force (Plan 23d) ---------------------------------------------------------------------
# deps.sources is the admin console's set, fixed for the review; None (deps built by hand) asks every client present.
def engine_args(deps) -> dict[str, str]:
    """The `engines=` argument for SearXNG: the enabled engines, or nothing (the client's own) without sources."""
    sources = getattr(deps, "sources", None)
    return {} if sources is None else {"engines": sources.engines}


def thaijo_on(deps) -> bool:
    """ThaiJO is searched and its OAI-PMH step runs only with a client and while the sources have it on."""
    sources = getattr(deps, "sources", None)
    return getattr(deps, "thaijo", None) is not None and (sources is None or sources.thaijo)


def trial_search_on(deps) -> bool:
    """The direct Europe PMC RCT searches follow the Europe PMC switch (enrichment lookups and references do not)."""
    sources = getattr(deps, "sources", None)
    return getattr(deps, "europepmc", None) is not None and (sources is None or sources.has_europepmc)


def make_search(deps):
    async def search(state: ReviewState) -> dict:
```

2. Replace

```python
        jobs = [(q, page) for q in queries for page in range(1, pages + 1)]
        trial_queries = (trial_search_queries(queries, settings.trial_search_queries)
                         if wants_trial_search(options) and getattr(deps, "europepmc", None) is not None else [])
        gate = asyncio.Semaphore(SEARXNG_CONCURRENCY)

        async def searx(q: str, page: int) -> list[Candidate]:
            async with gate:
                return await deps.searxng.search(q, pageno=page)

        # Plan 24: ThaiJO runs alongside SearXNG (its own timeout is shorter), only when enabled
        thaijo = (asyncio.ensure_future(thaijo_search(deps, queries, options))
                  if getattr(deps, "thaijo", None) is not None else None)
        try:
            results = await asyncio.gather(
```

   with

```python
        jobs = [(q, page) for q in queries for page in range(1, pages + 1)]
        trial_queries = (trial_search_queries(queries, settings.trial_search_queries)
                         if wants_trial_search(options) and trial_search_on(deps) else [])
        gate = asyncio.Semaphore(SEARXNG_CONCURRENCY)

        async def searx(q: str, page: int) -> list[Candidate]:
            async with gate:
                return await deps.searxng.search(q, pageno=page, **engine_args(deps))

        # Plan 24: ThaiJO runs alongside SearXNG (its own timeout is shorter), only when enabled
        thaijo = asyncio.ensure_future(thaijo_search(deps, queries, options)) if thaijo_on(deps) else None
        try:
            results = await asyncio.gather(
```

3. Replace

```python
        if thaijo_entry is not None:  # Plan 24
            entry["thaijo"] = thaijo_entry
        return {"candidates": [c.model_dump() for c in found], "errors": errors,
                "search_stats": {"found": len(found), "per_source": dict(per_source), "searched_at": searched_at},
```

   with

```python
        if thaijo_entry is not None:  # Plan 24
            entry["thaijo"] = thaijo_entry
        if getattr(deps, "sources", None) is not None:  # Plan 23d: the sources this review searched
            entry["sources"] = list(deps.sources.enabled)
        return {"candidates": [c.model_dump() for c in found], "errors": errors,
                "search_stats": {"found": len(found), "per_source": dict(per_source), "searched_at": searched_at},
```

4. Replace

```python
    async def searx(q: str, page: int) -> list[Candidate]:
        async with gate:
            return await deps.searxng.search(q, pageno=page)

    results = await asyncio.gather(*(searx(q, p) for q, p in jobs), return_exceptions=True)
```

   with

```python
    async def searx(q: str, page: int) -> list[Candidate]:
        async with gate:
            return await deps.searxng.search(q, pageno=page, **engine_args(deps))

    results = await asyncio.gather(*(searx(q, p) for q, p in jobs), return_exceptions=True)
```

**Edit** `backend/app/harness/quality.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
    if search and "thaijo" in search[-1]:
        extra["thaijo"] = dict(search[-1]["thaijo"])
    oai = by_stage.get("thaijo_metadata") or []
    if oai:
```

   with

```python
    if search and "thaijo" in search[-1]:
        extra["thaijo"] = dict(search[-1]["thaijo"])
    if search and "sources" in search[-1]:  # Plan 23d: the search sources the review used (enabled ids)
        extra["sources"] = list(search[-1]["sources"])
    oai = by_stage.get("thaijo_metadata") or []
    if oai:
```

**Edit** `backend/app/graph/factory.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
from app.services.openalex import OpenAlexClient
from app.services.searxng import SearxngClient
from app.services.thaijo import ThaiJoClient


def build_graph_deps(settings: Settings, http: HttpClient, redis=None, catalog=None, *, resolved=None, sem=None,
                     config_version: str = "file", glossary=None) -> GraphDeps:
    """Stub deps when graph_mode == "stub". Papers are read from their abstracts only (no full-text fetching)."""
    if settings.graph_mode == "stub":
        return GraphDeps(settings=settings, glossary=glossary)
    return GraphDeps(
        settings=settings,
        glossary=glossary,
        llms=build_llms(settings, catalog=catalog, resolved=resolved, sem=sem, config_version=config_version),
        mcp=McpRegistry(settings.mcp_servers_path),
```

   with

```python
from app.services.openalex import OpenAlexClient
from app.services.searxng import SearxngClient
from app.services.sources import ActiveSources, effective_sources
from app.services.thaijo import ThaiJoClient


def build_graph_deps(settings: Settings, http: HttpClient, redis=None, catalog=None, *, resolved=None, sem=None,
                     config_version: str = "file", glossary=None, sources: ActiveSources | None = None) -> GraphDeps:
    """Stub deps when graph_mode == "stub". Papers are read from their abstracts only (no full-text fetching).
    `sources` (Plan 23d): the search sources in force; env's when None."""
    sources = sources if sources is not None else effective_sources(settings, {})
    if settings.graph_mode == "stub":
        return GraphDeps(settings=settings, glossary=glossary, sources=sources)
    return GraphDeps(
        settings=settings,
        glossary=glossary,
        sources=sources,
        llms=build_llms(settings, catalog=catalog, resolved=resolved, sem=sem, config_version=config_version),
        mcp=McpRegistry(settings.mcp_servers_path),
```

2. Replace

```python


def build_thaijo(settings: Settings, http: HttpClient, redis=None) -> ThaiJoClient | None:
    """The ThaiJO client when THAIJO_ENABLED (Plan 24), else None. `redis` (decode_responses=True) caches abstracts
    and OAI records by article; without it nothing is cached."""
    if not settings.thaijo_enabled:
        return None
    return ThaiJoClient(http, settings.thaijo_url, cache=redis, timeout=settings.thaijo_request_timeout_seconds,
                        cache_ttl=settings.thaijo_cache_ttl_seconds)
```

   with

```python


def build_thaijo(settings: Settings, http: HttpClient, redis=None) -> ThaiJoClient:
    """The ThaiJO client (Plan 24), built in live mode whatever THAIJO_ENABLED says (construction does no I/O): the
    search node and the OAI-PMH step ask the sources in force (Plan 23d), where THAIJO_ENABLED is the default.
    `redis` (decode_responses=True) caches abstracts and OAI records by article; without it nothing is cached."""
    return ThaiJoClient(http, settings.thaijo_url, cache=redis, timeout=settings.thaijo_request_timeout_seconds,
                        cache_ttl=settings.thaijo_cache_ttl_seconds)
```

**Edit** `backend/app/services/runtime_config.py` (8 replacements; each `old` occurs exactly once):

1. Replace

```python
"""The settings and glossary in force (Plan 23c). API processes ask RuntimeConfig: it reads both Redis mirrors (the
DB on a miss) at most every RUNTIME_TTL_SECONDS, and keeps the last values it knew while Redis and the DB are both
unreachable (env values until it knows any), so the hot path never fails on them. Workers, the harness job and the
eval CLI call load_runtime, which reads the DB."""
```

   with

```python
"""The settings, glossary and (Plan 23d) search sources in force (Plan 23c). API processes ask RuntimeConfig: it reads
the three Redis mirrors (the DB on a miss) at most every RUNTIME_TTL_SECONDS, and keeps the last values it knew while Redis and the DB are both
unreachable (env values until it knows any), so the hot path never fails on them. Workers, the harness job and the
eval CLI call load_runtime, which reads the DB."""
```

2. Replace

```python
from app.services.glossary_store import GLOSSARY_KIND, active_glossary_from
from app.services.runtime_settings import SETTINGS_KIND, apply_overrides

log = get_logger(__name__)
```

   with

```python
from app.services.glossary_store import GLOSSARY_KIND, active_glossary_from
from app.services.runtime_settings import SETTINGS_KIND, apply_overrides
from app.services.sources import ActiveSources, effective_sources
from app.services.sources_store import SOURCES_KIND

log = get_logger(__name__)
```

3. Replace

```python
    settings_version: str  # "env" while no settings version exists, else the version as text
    glossary: ActiveGlossary


```

   with

```python
    settings_version: str  # "env" while no settings version exists, else the version as text
    glossary: ActiveGlossary
    sources: ActiveSources  # Plan 23d; .label is "env" while no sources version exists


```

4. Replace

```python
        settings_row = await newest(session, SETTINGS_KIND)
        glossary_row = await newest(session, GLOSSARY_KIND)
    settings = apply_overrides(base, (settings_row.document or {}).get("values") or {}) if settings_row else base
    glossary = active_glossary_from(glossary_row) if glossary_row else SEED_GLOSSARY
    return Runtime(settings, str(settings_row.version) if settings_row else "env", glossary)


```

   with

```python
        settings_row = await newest(session, SETTINGS_KIND)
        glossary_row = await newest(session, GLOSSARY_KIND)
        sources_row = await newest(session, SOURCES_KIND)
    settings = apply_overrides(base, (settings_row.document or {}).get("values") or {}) if settings_row else base
    glossary = active_glossary_from(glossary_row) if glossary_row else SEED_GLOSSARY
    sources = (effective_sources(base, (sources_row.document or {}).get("sources") or {}, sources_row.version)
               if sources_row else effective_sources(base, {}))
    return Runtime(settings, str(settings_row.version) if settings_row else "env", glossary, sources)


```

5. Replace

```python
        self._settings_version: int | None = None
        self._glossary = "file"
        self._expires = float("-inf")
        self._lock = asyncio.Lock()
```

   with

```python
        self._settings_version: int | None = None
        self._glossary = "file"
        self._sources: ActiveSources = effective_sources(base, {})
        self._expires = float("-inf")
        self._lock = asyncio.Lock()
```

6. Replace

```python
                return
            generation = self._generation
            loaded: tuple[Settings, int | None, str] | None = None
            try:
                async with asyncio.timeout(RUNTIME_READ_TIMEOUT_SECONDS):  # a timeout is a failed read (TimeoutError)
                    settings = await read_active(self.session_factory, self.redis, SETTINGS_KIND)
                    glossary = await read_active(self.session_factory, self.redis, GLOSSARY_KIND)
                    loaded = (apply_overrides(self.base, settings.mirror.get("values")), settings.version,
                              "file" if glossary.version is None else str(glossary.version))
            except Exception as exc:  # noqa: BLE001 - keep the last values (env until any are known)
                log.warning("runtime_config_unavailable", error=type(exc).__name__)
```

   with

```python
                return
            generation = self._generation
            loaded: tuple[Settings, int | None, str, ActiveSources] | None = None
            try:
                async with asyncio.timeout(RUNTIME_READ_TIMEOUT_SECONDS):  # a timeout is a failed read (TimeoutError)
                    settings = await read_active(self.session_factory, self.redis, SETTINGS_KIND)
                    glossary = await read_active(self.session_factory, self.redis, GLOSSARY_KIND)
                    sources = await read_active(self.session_factory, self.redis, SOURCES_KIND)
                    loaded = (apply_overrides(self.base, settings.mirror.get("values")), settings.version,
                              "file" if glossary.version is None else str(glossary.version),
                              effective_sources(self.base, sources.mirror.get("sources"), sources.version))
            except Exception as exc:  # noqa: BLE001 - keep the last values (env until any are known)
                log.warning("runtime_config_unavailable", error=type(exc).__name__)
```

7. Replace

```python
                return  # invalidate() ran during the read, which may predate the save: read again next time
            if loaded is not None:
                self._settings, self._settings_version, self._glossary = loaded
            self._expires = self.clock() + self.ttl

```

   with

```python
                return  # invalidate() ran during the read, which may predate the save: read again next time
            if loaded is not None:
                self._settings, self._settings_version, self._glossary, self._sources = loaded
            self._expires = self.clock() + self.ttl

```

8. Replace

```python
        return self._glossary

    def invalidate(self) -> None:
        """The saving process reads again at once; other processes follow within the TTL. A refresh already under way
```

   with

```python
        return self._glossary

    async def sources(self) -> ActiveSources:
        """The search sources in force (Plan 23d): env's until a version is known, the last known while Redis and the
        DB are down."""
        await self._fresh()
        return self._sources

    def invalidate(self) -> None:
        """The saving process reads again at once; other processes follow within the TTL. A refresh already under way
```

**Edit** `backend/app/worker/runtime_reload.py` (9 replacements; each `old` occurs exactly once):

1. Replace

```python
stale error. Anything that fails while reading a version, including a stored row nobody should have written (a hand
edit that left the document or its values something other than a mapping), is such a failure: startup falls back to env
and the built-in glossary and the poll that cannot read the versions reports it, so a bad row never stops the worker."""
from __future__ import annotations

```

   with

```python
stale error. Anything that fails while reading a version, including a stored row nobody should have written (a hand
edit that left the document or its values something other than a mapping), is such a failure: startup falls back to env
and the built-in glossary and the poll that cannot read the versions reports it, so a bad row never stops the worker. Plan 23d adds a third kind, the
search sources, under the same rules: they are part of the graph deps (GraphDeps.sources), so a running review keeps
the set it started with."""
from __future__ import annotations

```

2. Replace

```python
from app.services.runtime_config import Runtime, load_runtime
from app.services.runtime_settings import SETTINGS_KIND
from app.worker.llm_reload import POLL_SECONDS, refresh_llms, report_state

```

   with

```python
from app.services.runtime_config import Runtime, load_runtime
from app.services.runtime_settings import SETTINGS_KIND
from app.services.sources import effective_sources
from app.services.sources_store import SOURCES_KIND
from app.worker.llm_reload import POLL_SECONDS, refresh_llms, report_state

```

3. Replace

```python
        log.error("runtime_load_failed", error=str(exc))
        ctx.update(settings=base, glossary=SEED_GLOSSARY, settings_version="env", glossary_version="file",
                   runtime_error=str(exc)[:300])
        return
    ctx.update(settings=runtime.settings, glossary=runtime.glossary, settings_version=runtime.settings_version,
               glossary_version=runtime.glossary.label, runtime_error=None)


class _PartialRead(Exception):
    """A poll that could read one kind's version but not the other's: carries what it read and the failure."""

    def __init__(self, settings: str | None, glossary: str | None, cause: Exception) -> None:
        super().__init__(str(cause))
        self.wanted, self.cause = (settings, glossary), cause


```

   with

```python
        log.error("runtime_load_failed", error=str(exc))
        ctx.update(settings=base, glossary=SEED_GLOSSARY, settings_version="env", glossary_version="file",
                   sources=effective_sources(base, {}), sources_version="env", runtime_error=str(exc)[:300])
        return
    ctx.update(settings=runtime.settings, glossary=runtime.glossary, settings_version=runtime.settings_version,
               glossary_version=runtime.glossary.label, sources=runtime.sources, sources_version=runtime.sources.label,
               runtime_error=None)


_KINDS = ((SETTINGS_KIND, "env"), (GLOSSARY_KIND, "file"), (SOURCES_KIND, "env"))  # the label while a kind has none


class _PartialRead(Exception):
    """A poll that could read some kinds' versions but not all: carries what it read and the failure."""

    def __init__(self, wanted: tuple[str | None, ...], cause: Exception) -> None:
        super().__init__(str(cause))
        self.wanted, self.cause = wanted, cause


```

4. Replace

```python


async def _wanted(ctx: dict, *, poll: bool) -> tuple[str | None, str | None]:
    """The (settings, glossary) versions this worker should run; None for a kind with no news."""
    redis = ctx["events_redis"]
    if poll:  # the DB is the truth; the mirrors are repaired on the way
        # Each kind in its own try, so one that cannot be read (a corrupt row, a failed query) never blocks the other
        # kind's repair. A kind that failed is "no news"; the first failure is raised after both were tried.
        wanted: list[str | None] = []
        failure: Exception | None = None
        for kind, empty in ((SETTINGS_KIND, "env"), (GLOSSARY_KIND, "file")):
            try:
                wanted.append(_label(await reconcile_mirror(redis, ctx["session_factory"], kind), empty))
```

   with

```python


async def _wanted(ctx: dict, *, poll: bool) -> tuple[str | None, ...]:
    """The (settings, glossary, sources) versions this worker should run; None for a kind with no news."""
    redis = ctx["events_redis"]
    if poll:  # the DB is the truth; the mirrors are repaired on the way
        # Each kind in its own try, so one that cannot be read (a corrupt row, a failed query) never blocks another
        # kind's repair. A kind that failed is "no news"; the first failure is raised after all were tried.
        wanted: list[str | None] = []
        failure: Exception | None = None
        for kind, empty in _KINDS:
            try:
                wanted.append(_label(await reconcile_mirror(redis, ctx["session_factory"], kind), empty))
```

5. Replace

```python
                wanted.append(None)
        if failure is not None:
            raise _PartialRead(wanted[0], wanted[1], failure)
        return wanted[0], wanted[1]
    raw_settings, raw_glossary = await redis.mget(SETTINGS_KIND.redis_key, GLOSSARY_KIND.redis_key)
    settings, glossary = mirror_version(raw_settings), mirror_version(raw_glossary)
    return (None if settings is None else str(settings)), (None if glossary is None else str(glossary))


```

   with

```python
                wanted.append(None)
        if failure is not None:
            raise _PartialRead(tuple(wanted), failure)
        return tuple(wanted)
    raw = await redis.mget(*(kind.redis_key for kind, _ in _KINDS))
    return tuple(None if (v := mirror_version(r)) is None else str(v) for r in raw)


```

6. Replace

```python
            llms = build_llms(settings, ctx.get("catalog"), resolved=ctx["llm_resolved"], sem=sem,
                              config_version=getattr(llms, "config_version", "file"))
    deps = dataclasses.replace(ctx["graph_deps"], settings=settings, llms=llms, glossary=runtime.glossary)
    return deps, build_graph_fn(deps, checkpointer=getattr(ctx["graph"], "checkpointer", None)), sem, size


async def refresh_runtime(ctx: dict, *, build_graph_fn=None, poll: bool = False) -> bool:
    """Rebuild the deps when a settings or glossary version moved. True when this call switched."""
    build_graph_fn = build_graph_fn or build_graph
    read_error: str | None = None
```

   with

```python
            llms = build_llms(settings, ctx.get("catalog"), resolved=ctx["llm_resolved"], sem=sem,
                              config_version=getattr(llms, "config_version", "file"))
    deps = dataclasses.replace(ctx["graph_deps"], settings=settings, llms=llms, glossary=runtime.glossary,
                               sources=runtime.sources)
    return deps, build_graph_fn(deps, checkpointer=getattr(ctx["graph"], "checkpointer", None)), sem, size


async def refresh_runtime(ctx: dict, *, build_graph_fn=None, poll: bool = False) -> bool:
    """Rebuild the deps when a settings, glossary or sources version moved. True when this call switched."""
    build_graph_fn = build_graph_fn or build_graph
    read_error: str | None = None
```

7. Replace

```python
            ctx["runtime_error"] = f"could not read the saved versions: {exc}"[:300]
        return False
    loaded = (ctx.get("settings_version"), ctx.get("glossary_version"))
    moved = any(w is not None and w != have for w, have in zip(wanted, loaded, strict=True))
    if not moved:
```

   with

```python
            ctx["runtime_error"] = f"could not read the saved versions: {exc}"[:300]
        return False
    loaded = (ctx.get("settings_version"), ctx.get("glossary_version"), ctx.get("sources_version"))
    moved = any(w is not None and w != have for w, have in zip(wanted, loaded, strict=True))
    if not moved:
```

8. Replace

```python
        try:
            runtime = await load_runtime(ctx["session_factory"], ctx["base_settings"])
            if (runtime.settings_version, runtime.glossary.label) == (ctx.get("settings_version"),
                                                                      ctx.get("glossary_version")):
                return False  # the mirror disagrees with the DB and this worker already runs what the DB says
            deps, graph, sem, size = _rebuild(ctx, runtime, build_graph_fn)
```

   with

```python
        try:
            runtime = await load_runtime(ctx["session_factory"], ctx["base_settings"])
            if (runtime.settings_version, runtime.glossary.label, runtime.sources.label) == loaded:
                return False  # the mirror disagrees with the DB and this worker already runs what the DB says
            deps, graph, sem, size = _rebuild(ctx, runtime, build_graph_fn)
```

9. Replace

```python
        ctx.update(settings=runtime.settings, glossary=runtime.glossary, graph_deps=deps, graph=graph, llm_sem=sem,
                   llm_sem_size=size, settings_version=runtime.settings_version,
                   glossary_version=runtime.glossary.label, runtime_error=read_error)
        await report_state(ctx)
        log.info("runtime_reloaded", settings=runtime.settings_version, glossary=runtime.glossary.label)
        return True

```

   with

```python
        ctx.update(settings=runtime.settings, glossary=runtime.glossary, graph_deps=deps, graph=graph, llm_sem=sem,
                   llm_sem_size=size, settings_version=runtime.settings_version,
                   glossary_version=runtime.glossary.label, sources=runtime.sources,
                   sources_version=runtime.sources.label, runtime_error=read_error)
        await report_state(ctx)
        log.info("runtime_reloaded", settings=runtime.settings_version, glossary=runtime.glossary.label,
                 sources=runtime.sources.label)
        return True

```

**Edit** `backend/app/worker/llm_reload.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
    """Report this worker's current state to LOADED_KEY: the version it runs, its preset and the last load error
    (ctx["llm_error"], cleared by the next successful load), plus (Plan 23c, through `extra`) the settings version
    ("env" when none), the glossary version ("file" when none) and runtime_error (the last failed settings/glossary
    reload, cleared by the next one that succeeds or by a poll that finds the worker on the DB's versions).
    `loaded_at` therefore means "last seen", not "loaded at"."""
    preset = ctx.get("llm_preset") or getattr(getattr(ctx.get("graph_deps"), "llms", None), "preset", "") or ""
    extra = {"settings": ctx.get("settings_version") or "env", "glossary": ctx.get("glossary_version") or "file",
             "runtime_error": ctx.get("runtime_error")}
    await report_loaded(ctx["events_redis"], worker_id(), ctx.get("llm_version") or "file", preset,
                        error=ctx.get("llm_error"), extra=extra)
```

   with

```python
    """Report this worker's current state to LOADED_KEY: the version it runs, its preset and the last load error
    (ctx["llm_error"], cleared by the next successful load), plus (Plan 23c, through `extra`) the settings version
    ("env" when none), the glossary version ("file" when none), the sources version (Plan 23d, "env" when none) and
    runtime_error (the last failed settings/glossary
    reload, cleared by the next one that succeeds or by a poll that finds the worker on the DB's versions).
    `loaded_at` therefore means "last seen", not "loaded at"."""
    preset = ctx.get("llm_preset") or getattr(getattr(ctx.get("graph_deps"), "llms", None), "preset", "") or ""
    extra = {"settings": ctx.get("settings_version") or "env", "glossary": ctx.get("glossary_version") or "file",
             "sources": ctx.get("sources_version") or "env", "runtime_error": ctx.get("runtime_error")}
    await report_loaded(ctx["events_redis"], worker_id(), ctx.get("llm_version") or "file", preset,
                        error=ctx.get("llm_error"), extra=extra)
```

2. Replace

```python
    deps = build_graph_deps(ctx["settings"], ctx["http"], ctx["events_redis"], ctx["catalog"], resolved=resolved,
                            sem=ctx["llm_sem"], config_version=f"db:{active_id}" if active_id != "file" else "file",
                            glossary=ctx.get("glossary"))
    return deps, build_graph_fn(deps, checkpointer=checkpointer)

```

   with

```python
    deps = build_graph_deps(ctx["settings"], ctx["http"], ctx["events_redis"], ctx["catalog"], resolved=resolved,
                            sem=ctx["llm_sem"], config_version=f"db:{active_id}" if active_id != "file" else "file",
                            glossary=ctx.get("glossary"), sources=ctx.get("sources"))
    return deps, build_graph_fn(deps, checkpointer=checkpointer)

```

**Edit** `backend/app/evals/freeze.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
from app.evals.models import Fixture, Manifest, ManifestEntry
from app.graph.graph import build_freeze_graph, initial_state


def freeze_engines(settings) -> list[str]:
    """The sources a frozen pool was searched with: the SearXNG engines, plus thaijo when it was on (Plan 24)."""
    engines = [e.strip() for e in str(settings.searxng_engines).split(",") if e.strip()]
    return engines + (["thaijo"] if settings.thaijo_enabled else [])


```

   with

```python
from app.evals.models import Fixture, Manifest, ManifestEntry
from app.graph.graph import build_freeze_graph, initial_state
from app.services.sources import effective_sources


def freeze_engines(deps) -> list[str]:
    """The sources a frozen pool was searched with: the SearXNG engines, plus thaijo when it was on (Plan 24). Plan
    23d: the deps' sources (the console's set from the DB; env with --config-file, or when the deps carry none)."""
    sources = deps.sources if deps.sources is not None else effective_sources(deps.settings, {})
    engines = [e.strip() for e in sources.engines.split(",") if e.strip()]
    return engines + (["thaijo"] if sources.thaijo else [])


```

**Edit** `backend/app/cli/eval.py` (3 replacements; each `old` occurs exactly once):

1. Replace

```python
    from app.harness.glossary import SEED_GLOSSARY
    from app.services.runtime_config import Runtime, load_runtime

    if config_file:
        return Runtime(settings, "env", SEED_GLOSSARY)
    try:
        return await load_runtime(session_factory_maker(), settings)
```

   with

```python
    from app.harness.glossary import SEED_GLOSSARY
    from app.services.runtime_config import Runtime, load_runtime
    from app.services.sources import effective_sources

    if config_file:
        return Runtime(settings, "env", SEED_GLOSSARY, effective_sources(settings, {}))
    try:
        return await load_runtime(session_factory_maker(), settings)
```

2. Replace

```python
    if args.cmd == "freeze":
        fixtures = await freeze_all(deps, manifest, ids=args.ids, force=args.force, git_sha=git_sha(),
                                    engines=freeze_engines(deps.settings))
        print(", ".join(f"{f.id}:{f.status}:{len(f.candidates)}" for f in fixtures))
        return 0
```

   with

```python
    if args.cmd == "freeze":
        fixtures = await freeze_all(deps, manifest, ids=args.ids, force=args.force, git_sha=git_sha(),
                                    engines=freeze_engines(deps))
        print(", ".join(f"{f.id}:{f.status}:{len(f.candidates)}" for f in fixtures))
        return 0
```

3. Replace

```python
    # report needs the settings (prompt version) and no models
    deps = (build_graph_deps(runtime.settings, http, resolved=resolved, config_version=label,
                             glossary=runtime.glossary) if runtime is not None else GraphDeps(settings=settings))
    offline_deps(deps, _parser().parse_args(rest).cmd)
    try:
```

   with

```python
    # report needs the settings (prompt version) and no models
    deps = (build_graph_deps(runtime.settings, http, resolved=resolved, config_version=label,
                             glossary=runtime.glossary, sources=runtime.sources)
            if runtime is not None else GraphDeps(settings=settings))
    offline_deps(deps, _parser().parse_args(rest).cmd)
    try:
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-23d/backend && uv run pytest tests/unit/test_sources_propagation.py tests/unit/test_thaijo_search_node.py tests/unit/test_papers_and_report.py -q`

Expected: 31 passed (12 new, the 2 rewritten ThaiJO tests and the rest of the two touched files).

- [ ] **Step 5: Lint and the full backend suite**

Run: `cd /d/MRA-plan-23d/backend && uv run ruff check . && uv run pytest -q`

Expected: ruff `All checks passed!`; 2578 passed, 17 skipped.

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-plan-23d\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
feat(sources): the sources in force reach the API, the workers, the search node, paper search and the eval freeze (Plan 23d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-23d && git add backend/tests/unit/test_sources_propagation.py backend/tests/unit/test_thaijo_search_node.py backend/tests/unit/test_papers_and_report.py backend/app/services/searxng.py backend/app/services/paper_search.py backend/app/graph/graph.py backend/app/graph/nodes/retrieval.py backend/app/harness/quality.py backend/app/graph/factory.py backend/app/services/runtime_config.py backend/app/worker/runtime_reload.py backend/app/worker/llm_reload.py backend/app/evals/freeze.py backend/app/cli/eval.py
git commit -F .superpowers/commit-msg.txt
```

---

### Task 3: Sources in the cache key and /status, the admin sources routes, paper search on the enabled engines

**Files:**
- Modify: `backend/app/services/review_service.py`
- Modify: `backend/app/api/papers.py`
- Modify: `backend/app/mcp/server.py`
- Modify: `backend/app/api/admin_runtime.py`
- Test (create): `backend/tests/unit/test_sources_api.py`

**Interfaces:**
- Consumes: `cache_part`, `public_list`, `effective_sources`, `clean_overrides`, `env_defaults`, `SOURCES`, `SOURCES_KIND` (Task 1); `RuntimeConfig.sources()`, `PaperSearch.search(..., engines=)` (Task 2).
- Produces:
  - `ReviewService.sources() -> ActiveSources`; `_version()` ends with `cache_part(await self.sources(), self.settings)`; `status()` gains `"sources": public_list(...)` before `limits`.
  - `GET /admin/sources` → `{source, version, sources: [{id, label, kind, env, enabled, overridden}], extras, error, loaded}`; `POST /admin/sources/validate` `{sources?}` → `{ok, errors, warnings, document, enabled}`; `POST /admin/sources` `{sources, base_version, note?}` → 201; `GET /admin/sources/versions[/{version}]`, `POST /admin/sources/versions/{version}/restore`, `POST /admin/sources/reset` (23c's `_history_routes`); `SourcesDraft`, `SourcesSave`, `SOURCES_FALLBACK`.
  - REST `/papers/search` and MCP `search_papers` pass `engines=(await service.sources()).engines`.

- [ ] **Step 1: Write the failing tests**

**New file** `backend/tests/unit/test_sources_api.py` (complete):

```python
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
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-plan-23d/backend && uv run pytest tests/unit/test_sources_api.py -q`

Expected: 8 failed, 1 passed (`test_the_cache_key_is_unchanged_while_no_sources_version_changes_the_set` already holds: an env-equal version is stored as `{}` by Task 1 and the key has no sources part yet); the others fail on the missing `sources` in `/status`, the 404 admin routes and the engines paper search does not pass yet.

- [ ] **Step 3: Implement**

**Edit** `backend/app/services/review_service.py` (4 replacements; each `old` occurs exactly once):

1. Replace

```python
from app.services.ratelimits import RateLimits
from app.services.safety import red_flag
from app.services.turnstile import TurnstileUnavailable, verify_turnstile
from app.services.urlsafety import is_public_http_url
```

   with

```python
from app.services.ratelimits import RateLimits
from app.services.safety import red_flag
from app.services.sources import ActiveSources, cache_part, effective_sources, public_list
from app.services.turnstile import TurnstileUnavailable, verify_turnstile
from app.services.urlsafety import is_public_http_url
```

2. Replace

```python
        return self.settings if self.runtime is None else await self.runtime.settings()

    async def _version(self) -> str:
        """The cache key's pipeline version: prompt, LLM config (23b) and, once one is saved, the glossary (23c)."""
        version = self.settings.prompt_version
        if self.llm_version is not None:
```

   with

```python
        return self.settings if self.runtime is None else await self.runtime.settings()

    async def sources(self) -> ActiveSources:
        """The search sources in force (Plan 23d): env's with the admin console's saved version, at most 5 seconds
        old."""
        return effective_sources(self.settings, {}) if self.runtime is None else await self.runtime.sources()

    async def _version(self) -> str:
        """The cache key's pipeline version: prompt, LLM config (23b), once one is saved the glossary (23c), and the
        search sources (Plan 24's `+thaijo`; Plan 23d's `+src` fingerprint once a sources version changes the
        SearXNG engines)."""
        version = self.settings.prompt_version
        if self.llm_version is not None:
```

3. Replace

```python
        if self.runtime is not None and (glossary := await self.runtime.glossary_label()) != "file":
            version = f"{version}+g{glossary}"
        if self.settings.thaijo_enabled:  # Plan 24: a pool with ThaiJO is a different search
            version = f"{version}+thaijo"
        return version

    async def _reuse(self, cache_key: str, settings: Settings | None = None) -> ReviewCreated | None:
```

   with

```python
        if self.runtime is not None and (glossary := await self.runtime.glossary_label()) != "file":
            version = f"{version}+g{glossary}"
        # Plan 24: a pool with ThaiJO is a different search; Plan 23d: so is one from another engine set. While no
        # sources version exists this is Plan 24's `+thaijo` rule, so the key is unchanged.
        return version + cache_part(await self.sources(), self.settings)

    async def _reuse(self, cache_key: str, settings: Settings | None = None) -> ReviewCreated | None:
```

4. Replace

```python
            "reviews_today": await self.capacity.reviews_today() if self.capacity is not None else None,
            "turnstile_site_key": s.turnstile_site_key or None,
            "limits": {"review_rate_limit": s.review_rate_limit, "api_key_rate_limit": s.api_key_rate_limit,
                       "paper_search_rate_limit": s.paper_search_rate_limit,
```

   with

```python
            "reviews_today": await self.capacity.reviews_today() if self.capacity is not None else None,
            "turnstile_site_key": s.turnstile_site_key or None,
            # Plan 23d: the search sources in force, in catalog order, then env-only engines
            "sources": public_list(await self.sources()),
            "limits": {"review_rate_limit": s.review_rate_limit, "api_key_rate_limit": s.api_key_rate_limit,
                       "paper_search_rate_limit": s.paper_search_rate_limit,
```

**Edit** `backend/app/api/papers.py` (2 replacements; each `old` occurs exactly once):

1. Replace

```python
async def search_papers(q: str = Query(min_length=2, max_length=300), limit: int = Query(10, ge=1, le=25),
                        deps: AppDeps = Depends(get_deps), identity: Identity = Depends(get_identity)):
    """Literature search (SearXNG academic engines: PubMed, Europe PMC, OpenAlex, Semantic Scholar, Crossref, arXiv, DOAJ, OpenAIRE; Europe PMC
    also supplies curated metadata). No LLM involved."""
    try:
        decision = await deps.limits.hit("papers", identity.rate_key,
```

   with

```python
async def search_papers(q: str = Query(min_length=2, max_length=300), limit: int = Query(10, ge=1, le=25),
                        deps: AppDeps = Depends(get_deps), identity: Identity = Depends(get_identity)):
    """Literature search (the SearXNG academic engines the service has on, listed in GET /api/v1/status → sources;
    by default PubMed, Europe PMC, OpenAlex, Semantic Scholar, Crossref, arXiv, DOAJ, OpenAIRE; Europe PMC also
    supplies curated metadata). No LLM involved."""
    try:
        decision = await deps.limits.hit("papers", identity.rate_key,
```

2. Replace

```python
        if not decision.allowed:
            raise RateLimited(decision.retry_after)
        return await deps.papers.search(q, limit)
    except ServiceError as exc:
        return service_error_response(exc)
```

   with

```python
        if not decision.allowed:
            raise RateLimited(decision.retry_after)
        return await deps.papers.search(q, limit, engines=(await deps.service.sources()).engines)
    except ServiceError as exc:
        return service_error_response(exc)
```

**Edit** `backend/app/mcp/server.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python
    @mcp.tool()
    async def search_papers(query: str, ctx: Context, limit: int = 10) -> dict[str, Any]:
        """Search published biomedical papers (PubMed, Europe PMC, OpenAlex, Semantic Scholar, Crossref, arXiv, DOAJ,
        OpenAIRE; Europe PMC also supplies curated metadata). Returns title, up to 6 authors, year, journal, DOI/PMID/PMCID, open-access flag and the abstract
        (first 600 characters). `limit` is clamped into 1-25; shares the paper-search rate limit with REST."""
        await papers_limit(await identity(ctx))
        try:
            found = await get_deps().papers.search(query, max(1, min(limit, 25)))
            return {"query": query, "papers": [_paper(c) for c in found]}
        except ServiceError as exc:
```

   with

```python
    @mcp.tool()
    async def search_papers(query: str, ctx: Context, limit: int = 10) -> dict[str, Any]:
        """Search published biomedical papers (the SearXNG engines the service has on: by default PubMed, Europe PMC,
        OpenAlex, Semantic Scholar, Crossref, arXiv, DOAJ, OpenAIRE; Europe PMC also supplies curated metadata). Returns title, up to 6 authors, year, journal, DOI/PMID/PMCID, open-access flag and the abstract
        (first 600 characters). `limit` is clamped into 1-25; shares the paper-search rate limit with REST."""
        await papers_limit(await identity(ctx))
        try:
            deps = get_deps()
            found = await deps.papers.search(query, max(1, min(limit, 25)),
                                             engines=(await deps.service.sources()).engines)
            return {"query": query, "papers": [_paper(c) for c in found]}
        except ServiceError as exc:
```

**Edit** `backend/app/api/admin_runtime.py` (4 replacements; each `old` occurs exactly once):

1. Replace

```python
"""Admin console: runtime settings and the Thai glossary (Plan 23c). Thin adapters over config_store with the
settings and glossary kinds. Every change writes its audit row in the same transaction; after the commit the Redis
mirror is raised (workers reload within 30 s) and this process's cache is dropped (other API processes follow
within 5 s). Validation is done against the env settings, never against other overrides."""
```

   with

```python
"""Admin console: runtime settings and the Thai glossary (Plan 23c), and the search sources (Plan 23d). Thin adapters
over config_store with the settings, glossary and sources kinds. Every change writes its audit row in the same transaction; after the commit the Redis
mirror is raised (workers reload within 30 s) and this process's cache is dropped (other API processes follow
within 5 s). Validation is done against the env settings, never against other overrides."""
```

2. Replace

```python
from app.services.review_service import Identity, ServiceError
from app.services.runtime_settings import SETTINGS_KIND, SPECS, apply_overrides, spec_out

router = APIRouter()
```

   with

```python
from app.services.review_service import Identity, ServiceError
from app.services.runtime_settings import SETTINGS_KIND, SPECS, apply_overrides, spec_out
from app.services.sources import SOURCES, clean_overrides, effective_sources, env_defaults
from app.services.sources_store import SOURCES_KIND

router = APIRouter()
```

3. Replace

```python


for _kind in (SETTINGS_KIND, GLOSSARY_KIND):
    _history_routes(_kind)

```

   with

```python


class SourcesDraft(BaseModel):
    sources: dict[str, Any] = Field(default_factory=dict)


class SourcesSave(BaseModel):
    sources: dict[str, Any]  # required: a body without it must not save "env everywhere"
    base_version: int | None
    note: Note = None


for _kind in (SETTINGS_KIND, GLOSSARY_KIND, SOURCES_KIND):
    _history_routes(_kind)

```

4. Replace

```python
        s, identity.admin, GLOSSARY_KIND, raw, settings=settings, base_version=body.base_version, note=body.note,
        ip_hash=ip_hash))
```

   with

```python
        s, identity.admin, GLOSSARY_KIND, raw, settings=settings, base_version=body.base_version, note=body.note,
        ip_hash=ip_hash))


# A stored set that leaves no SearXNG source (an env change after the save): env's engines are searched instead.
SOURCES_FALLBACK = ("the saved version leaves no SearXNG source on with the current SEARXNG_ENGINES, so env's engines "
                    "are searched; save a version that turns one on")


@router.get("/admin/sources")
async def sources_state(deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> dict:
    base = deps.service.settings
    async with deps.session_factory() as session:
        row = await newest(session, SOURCES_KIND)
    document = row.document if row is not None and isinstance(row.document, dict) else {}
    overrides = clean_overrides(document.get("sources"))  # a stored entry that no longer validates is skipped
    active = effective_sources(base, overrides, row.version if row else None)
    env = env_defaults(base)
    return {"source": "db" if row else "env", "version": row.version if row else None,
            "sources": [{"id": s.id, "label": s.label, "kind": s.kind, "env": env[s.id],
                         "enabled": s.id in active.enabled, "overridden": overrides.get(s.id, env[s.id]) != env[s.id]}
                        for s in SOURCES],
            "extras": list(active.extras), "error": SOURCES_FALLBACK if active.fallback else None,
            "loaded": await loaded_workers(deps.redis)}


@router.post("/admin/sources/validate")
async def sources_validate(body: SourcesDraft, deps: AppDeps = Depends(get_deps),
                           _: Identity = Depends(require_admin)) -> dict:
    base = deps.service.settings
    try:
        document, warnings = SOURCES_KIND.validate(body.model_dump(), base)
    except DocumentError as exc:
        return {"ok": False, "errors": exc.errors, "warnings": [], "document": None, "enabled": None}
    enabled = effective_sources(base, document["sources"]).enabled
    return {"ok": True, "errors": [], "warnings": warnings, "document": document, "enabled": list(enabled)}


@router.post("/admin/sources", status_code=201)
async def sources_save(body: SourcesSave, deps: AppDeps = Depends(get_deps), identity: Identity = Depends(require_admin)):
    settings, ip_hash = deps.service.settings, ip_hash_of(identity, deps)
    raw = {"sources": body.sources}
    return await _write(deps, SOURCES_KIND, lambda s: save_version(
        s, identity.admin, SOURCES_KIND, raw, settings=settings, base_version=body.base_version, note=body.note,
        ip_hash=ip_hash))
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-23d/backend && uv run pytest tests/unit/test_sources_api.py -q`

Expected: 9 passed.

- [ ] **Step 5: Lint and the full backend suite**

Run: `cd /d/MRA-plan-23d/backend && uv run ruff check . && uv run pytest -q`

Expected: ruff `All checks passed!`; 2587 passed, 17 skipped.

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-plan-23d\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
feat(sources): sources in the cache key and /status, the admin sources routes, paper search on the enabled engines (Plan 23d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-23d && git add backend/tests/unit/test_sources_api.py backend/app/services/review_service.py backend/app/api/papers.py backend/app/mcp/server.py backend/app/api/admin_runtime.py
git commit -F .superpowers/commit-msg.txt
```

---

### Task 4: Frontend — the admin sources page and its nav link

**Files:**
- Modify: `frontend/src/lib/admin-types.ts`
- Modify: `frontend/src/lib/admin-api.ts`
- Modify: `frontend/src/components/admin/worker-versions.tsx`
- Modify: `frontend/src/components/admin/admin-nav.tsx`
- Create: `frontend/src/components/admin/sources-view.tsx`
- Create: `frontend/src/app/admin/(console)/sources/page.tsx`
- Test (create): `frontend/src/test/admin-sources-fixtures.ts`
- Test (create): `frontend/src/components/admin/sources-view.test.tsx`
- Test (modify): `frontend/src/components/admin/admin-gate.test.tsx`
- Test (create): `frontend/e2e/admin-sources.spec.ts`

**Interfaces:**
- Consumes: the admin routes of Task 3; `useVersionedPage`, `DraftStatus`, `VersionHistory`, `WorkerVersions`, `ConfirmButton`, `STALE_TEXT`.
- Produces:
  - `src/lib/admin-types.ts`: `LoadedWorker.sources?`, `RuntimeKind` gains `"sources"`, `SourceRow`, `SourcesState`, `SourcesReport`; `adminApi.sources()`, `validateSources(sources)`, `saveSources({sources, base_version, note?})`.
  - `WorkerVersions` `field` accepts `"sources"` (default `"env"`); nav link "แหล่งค้น" → `/admin/sources` after "ตั้งค่า".
  - `SourcesView`, `SOURCES_PAGE`, `SOURCE_NOTE`, `type SourcesDraft` (`src/components/admin/sources-view.tsx`); the page `src/app/admin/(console)/sources/page.tsx`.
  - Fixtures `SOURCES`, `SOURCES_VERSIONS`, `SOURCES_WORKER`, `NO_SEARXNG`, `WARN_BIOMEDICAL` (`src/test/admin-sources-fixtures.ts`).

- [ ] **Step 0: Install the frontend dependencies once**

Run: `cd /d/MRA-plan-23d/frontend && npm ci`

- [ ] **Step 1: Write the failing tests**

**New file** `frontend/src/test/admin-sources-fixtures.ts` (complete):

```ts
import type { LoadedWorker, Page, RuntimeVersion, SourceRow, SourcesState } from "@/lib/admin-types";

/** Plan 23d: the admin sources page's fixtures. Version 1 turned OpenAIRE off; ThaiJO follows env (on). */
export const SOURCES_WORKER: LoadedWorker = { worker: "worker-1:7", version: "3", preset: "cheap",
  loaded_at: "2026-10-13T10:00:00Z", error: null, settings: "env", glossary: "file", sources: "1", runtime_error: null };

const row = (id: string, label: string, enabled = true, kind: SourceRow["kind"] = "searxng"): SourceRow =>
  ({ id, label, kind, env: true, enabled, overridden: !enabled });

export const SOURCES: SourcesState = {
  source: "db", version: 1, extras: [], error: null, loaded: [SOURCES_WORKER],
  sources: [
    row("pubmed", "PubMed"), row("europepmc", "Europe PMC"), row("openalex", "OpenAlex"),
    row("semantic_scholar", "Semantic Scholar"), row("crossref", "Crossref"), row("arxiv", "arXiv"), row("doaj", "DOAJ"),
    row("openaire", "OpenAIRE", false), row("thaijo", "ThaiJO", true, "direct"),
  ],
};

export const SOURCES_VERSIONS: Page<RuntimeVersion> = {
  items: [{ version: 1, kind: "sources", created_at: "2026-10-13T10:00:00Z", created_by: "owner", note: "openaire is slow",
    source: "edit", restored_from: null, changes: { openaire: "env → off" } }],
  next: null,
};

export const NO_SEARXNG = "at least one source searched through SearXNG must stay on: ThaiJO alone gives at most 1/8 of the "
  + "pool, and paper search uses SearXNG only";
export const WARN_BIOMEDICAL = "PubMed and Europe PMC are both off: the two biomedical indexes are off; reviews will find far "
  + "fewer clinical studies";
```

**New file** `frontend/src/components/admin/sources-view.test.tsx` (complete):

```tsx
import { fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminReply } from "@/test/admin-fetch";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { NO_SEARXNG, SOURCES, SOURCES_VERSIONS, SOURCES_WORKER, WARN_BIOMEDICAL } from "@/test/admin-sources-fixtures";
import { SourcesView } from "./sources-view";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/sources" }));

const SEEN = Date.parse(SOURCES_WORKER.loaded_at);
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SEEN + 30_000); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); nav.replace.mockReset(); });

const SAVE = { name: "บันทึกเป็นเวอร์ชันใหม่" };
const ALL_ON = Object.fromEntries(SOURCES.sources.map((s) => [s.id, true]));
const routes = (state = SOURCES) => (m: string, p: string): AdminReply | undefined =>
  m === "GET" && p === "/sources" ? [200, state] : m === "GET" && p.startsWith("/sources/versions") ? [200, SOURCES_VERSIONS] : undefined;
const savedAs = (version: number): AdminReply => [201, { ...SOURCES_VERSIONS.items[0], version, workers_notified: true }];
const toggle = (name: string) => fireEvent.click(screen.getByRole("switch", { name }));

describe("SourcesView", () => {
  it("lists the SearXNG sources and ThaiJO with their env default, the state and the worker", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<SourcesView />);
    expect(await screen.findByText("ใช้เวอร์ชัน 1 จาก DB")).toBeInTheDocument();
    const searxng = screen.getByRole("list", { name: "ผ่าน SearXNG" });
    expect(within(searxng).getAllByRole("switch")).toHaveLength(8);
    const direct = screen.getByRole("list", { name: "เรียกตรง" });
    expect(within(direct).getByRole("switch", { name: "ThaiJO" })).toHaveAttribute("aria-checked", "true");
    expect(direct).toHaveTextContent("ไม่เกิน 1/8 ของ pool");
    const openaire = screen.getByRole("switch", { name: "OpenAIRE" });
    expect(openaire).toHaveAttribute("aria-checked", "false");
    const row = openaire.closest("li") as HTMLElement;
    expect(row).toHaveTextContent("ค่า env: เปิด");
    expect(row).toHaveTextContent("ต่างจาก env");
    expect(screen.getByRole("switch", { name: "Europe PMC" }).closest("li")).toHaveTextContent("รวม preprint medRxiv/bioRxiv และการค้น RCT");
    expect(screen.getByText(/worker-1:7/)).toHaveTextContent("ตรงกับที่ใช้งาน");
  });

  it("checks a draft and shows the warnings, then the minimum as an error", async () => {
    const checked: unknown[] = [];
    mockAdminFetch((m, p, body) => {
      if (m === "POST" && p === "/sources/validate") {
        checked.push(body);
        const sources = (body as { sources: Record<string, boolean> }).sources;
        if (!Object.entries(sources).some(([id, on]) => on && id !== "thaijo")) {
          return [200, { ok: false, errors: [{ field: "sources", message: NO_SEARXNG }], warnings: [], document: null, enabled: null }];
        }
        return [200, { ok: true, errors: [], warnings: [WARN_BIOMEDICAL], document: { sources: {} },
          enabled: Object.keys(sources).filter((id) => sources[id]) }];
      }
      return routes()(m, p);
    });
    await renderAdmin(<SourcesView />);
    await screen.findByRole("switch", { name: "PubMed" });
    toggle("PubMed");
    toggle("Europe PMC");
    fireEvent.click(screen.getByRole("button", { name: "ตรวจ" }));
    const warning = await screen.findByText(WARN_BIOMEDICAL);
    expect(warning.closest("ul")).toHaveClass("bg-warn-bg");
    expect(screen.getByText(/^จะค้น 6 แหล่ง: OpenAlex, Semantic Scholar, Crossref, arXiv, DOAJ, ThaiJO$/)).toBeInTheDocument();
    for (const name of ["OpenAlex", "Semantic Scholar", "Crossref", "arXiv", "DOAJ"]) toggle(name);
    expect(screen.queryByText(WARN_BIOMEDICAL)).toBeNull(); // the check was of another draft
    fireEvent.click(screen.getByRole("button", { name: "ตรวจ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(NO_SEARXNG);
    expect(checked[1]).toEqual({ sources: { ...ALL_ON, pubmed: false, europepmc: false, openalex: false, semantic_scholar: false,
      crossref: false, arxiv: false, doaj: false, openaire: false } });
  });

  it("saves the whole set on the version the draft came from", async () => {
    const posted: unknown[] = [];
    mockAdminFetch((m, p, body) => {
      if (m === "POST" && p === "/sources") { posted.push(body); return savedAs(2); }
      return routes()(m, p);
    });
    await renderAdmin(<SourcesView />);
    await screen.findByRole("switch", { name: "OpenAIRE" });
    toggle("OpenAIRE");
    expect(screen.getByRole("switch", { name: "OpenAIRE" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "OpenAIRE" }).closest("li")).not.toHaveTextContent("ต่างจาก env");
    toggle("ThaiJO");
    fireEvent.change(screen.getByLabelText("หมายเหตุ (ไม่บังคับ)"), { target: { value: "openaire is back" } });
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText("บันทึกเป็นเวอร์ชัน 2 แล้ว")).toBeInTheDocument();
    expect(posted).toEqual([{ sources: { ...ALL_ON, thaijo: false }, base_version: 1, note: "openaire is back" }]);
  });

  it("re-reads after a 409, keeps the draft, and saves on the latest version once asked to", async () => {
    let version = 1;
    const posted: { base_version: number | null }[] = [];
    mockAdminFetch((m, p, body) => {
      if (m === "GET" && p === "/sources") return [200, { ...SOURCES, version }];
      if (m === "POST" && p === "/sources") {
        posted.push(body as { base_version: number | null });
        if (posted.length === 1) { version = 4; return [409, { detail: "version 4 is in use now; reload the latest version and try again" }]; }
        return savedAs(5);
      }
      return routes()(m, p);
    });
    await renderAdmin(<SourcesView />);
    await screen.findByRole("switch", { name: "arXiv" });
    toggle("arXiv");
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByRole("alert")).toHaveTextContent("มีผู้ดูแลอีกคนบันทึกเวอร์ชันใหม่ก่อน");
    expect(await screen.findByText("ใช้เวอร์ชัน 4 จาก DB")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "arXiv" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("button", { name: "ใช้ร่างนี้ต่อจากเวอร์ชันล่าสุด" }));
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText("บันทึกเป็นเวอร์ชัน 5 แล้ว")).toBeInTheDocument();
    expect(posted.map((b) => b.base_version)).toEqual([1, 4]);
  });

  it("lists env-only engines read-only, shows a stored version's problem and a lagging or failed worker", async () => {
    mockAdminFetch(routes({ ...SOURCES, extras: ["plos"], error: "the saved version leaves no SearXNG source on",
      loaded: [{ ...SOURCES_WORKER, worker: "behind:1", sources: "env" }, { ...SOURCES_WORKER, worker: "broken:2", runtime_error: "db down" }] }));
    await renderAdmin(<SourcesView />);
    const extras = await screen.findByRole("list", { name: "ตั้งใน env เท่านั้น" });
    expect(extras).toHaveTextContent("plos");
    expect(within(extras).queryByRole("switch")).toBeNull();
    expect(screen.getByText(/เวอร์ชันที่ใช้อยู่มีปัญหา/)).toHaveTextContent("leaves no SearXNG source on");
    expect(screen.getByText(/behind:1/)).toHaveTextContent("ยังใช้ env");
    expect(screen.getByText(/broken:2/)).toHaveTextContent("โหลดไม่สำเร็จ: db down");
  });

  it("shows the history of the sources versions", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<SourcesView />);
    fireEvent.click(await screen.findByRole("button", { name: "ประวัติ" }));
    const item = await screen.findByRole("listitem", { name: "เวอร์ชัน 1" });
    expect(item).toHaveTextContent("openaire: env → off");
  });
});
```

**Edit** `frontend/src/components/admin/admin-gate.test.tsx` (1 replacement; each `old` occurs exactly once):

1. Replace

```tsx
    await renderAdmin(<p>เนื้อหา</p>);
    const links = within(screen.getByRole("navigation", { name: "ผู้ดูแลระบบ" })).getAllByRole("link").map((a) => a.textContent);
    expect(links).toEqual(["Dashboard", "รีวิว", "API keys", "โมเดล", "ตั้งค่า", "อภิธานศัพท์", "Harness", "Audit log"]);
    expect(screen.getByRole("link", { name: "โมเดล" })).toHaveAttribute("href", "/admin/models");
    expect(screen.getByRole("link", { name: "อภิธานศัพท์" })).toHaveAttribute("href", "/admin/glossary");
```

   with

```tsx
    await renderAdmin(<p>เนื้อหา</p>);
    const links = within(screen.getByRole("navigation", { name: "ผู้ดูแลระบบ" })).getAllByRole("link").map((a) => a.textContent);
    expect(links).toEqual(["Dashboard", "รีวิว", "API keys", "โมเดล", "ตั้งค่า", "แหล่งค้น", "อภิธานศัพท์", "Harness", "Audit log"]);
    expect(screen.getByRole("link", { name: "โมเดล" })).toHaveAttribute("href", "/admin/models");
    expect(screen.getByRole("link", { name: "อภิธานศัพท์" })).toHaveAttribute("href", "/admin/glossary");
```

**New file** `frontend/e2e/admin-sources.spec.ts` (complete):

```ts
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page, type Route } from "@playwright/test";
import type { RuntimeVersion, SourcesReport, SourcesState } from "../src/lib/admin-types";
import { NO_SEARXNG, SOURCES, SOURCES_VERSIONS, SOURCES_WORKER } from "../src/test/admin-sources-fixtures";
import { mockApi } from "./mock-api";

/**
 * The admin "แหล่งค้น" page (Plan 23d) against a stateful fake of /api/v1/admin (same origin): sources versions that grow
 * with every save, restore and reset, and a worker that reports the version it runs. A request the fake does not know is
 * answered 404 and listed in `unmocked`; a write without `X-MRA-Admin: 1` is answered 403 and listed in `rejected`.
 */
type Doc = Record<string, boolean>;
const ENV: Doc = Object.fromEntries(SOURCES.sources.map((s) => [s.id, s.env]));
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function check(sources: Doc): SourcesReport {
  const on = { ...ENV, ...sources };
  if (!SOURCES.sources.some((s) => s.kind === "searxng" && on[s.id])) {
    return { ok: false, errors: [{ field: "sources", message: NO_SEARXNG }], warnings: [], document: null, enabled: null };
  }
  const document = { sources: Object.fromEntries(Object.entries(sources).filter(([id, v]) => v !== ENV[id])) };
  return { ok: true, errors: [], warnings: on.europepmc ? [] : ["Europe PMC is off, so the Europe PMC RCT search of meta-analyses is off too"],
    document, enabled: SOURCES.sources.filter((s) => on[s.id]).map((s) => s.id) };
}

async function mockSources(page: Page) {
  const calls = { saves: [] as { sources: Doc; base_version: number | null }[], unmocked: [] as string[], rejected: [] as string[] };
  const rows: (RuntimeVersion & { doc: Doc })[] = [{ ...clone(SOURCES_VERSIONS.items[0]), doc: { openaire: false } }];
  const worker = { sources: "1" };
  const append = (doc: Doc, source: RuntimeVersion["source"], restoredFrom: number | null) => {
    const row = { version: rows[0].version + 1, kind: "sources" as const, created_at: new Date().toISOString(), created_by: "owner",
      note: null, source, restored_from: restoredFrom, changes: {}, doc };
    rows.unshift(row);
    const { doc: _doc, ...out } = row; // eslint-disable-line @typescript-eslint/no-unused-vars
    return { ...out, workers_notified: true };
  };
  const state = (): SourcesState => {
    const on = { ...ENV, ...rows[0].doc };
    return { ...clone(SOURCES), version: rows[0].version,
      sources: SOURCES.sources.map((s) => ({ ...s, enabled: on[s.id], overridden: on[s.id] !== s.env })),
      loaded: [{ ...SOURCES_WORKER, sources: worker.sources, loaded_at: new Date().toISOString() }] };
  };
  await page.route("**/api/v1/admin/**", async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace("/api/v1/admin", "");
    const method = req.method();
    const reply = (status: number, body?: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body ?? {}) });
    if (method !== "GET" && req.headers()["x-mra-admin"] !== "1") {
      calls.rejected.push(`${method} ${path}`);
      return reply(403, { detail: "the X-MRA-Admin: 1 header is required" });
    }
    if (path === "/me") return reply(200, { kind: "user", label: "owner" });
    if (path === "/sources" && method === "GET") return reply(200, state());
    if (path === "/sources/versions" && method === "GET") return reply(200, { items: rows.map(({ doc: _d, ...v }) => v), next: null }); // eslint-disable-line @typescript-eslint/no-unused-vars
    if (path === "/sources/validate" && method === "POST") return reply(200, check((req.postDataJSON() as { sources: Doc }).sources));
    if (path === "/sources" && method === "POST") {
      const body = req.postDataJSON() as { sources: Doc; base_version: number | null };
      calls.saves.push(body);
      if (body.base_version !== rows[0].version) return reply(409, { detail: "a newer version is in use now; reload the latest version and try again" });
      const report = check(body.sources);
      if (!report.ok) return reply(422, { detail: NO_SEARXNG, errors: report.errors });
      return reply(201, append(report.document!.sources, "edit", null));
    }
    const restore = path.match(/^\/sources\/versions\/(\d+)\/restore$/);
    if (restore && method === "POST") {
      const target = rows.find((r) => r.version === Number(restore[1]));
      return target ? reply(201, append(clone(target.doc), "restore", target.version)) : reply(404, { detail: "version not found" });
    }
    if (path === "/sources/reset" && method === "POST") return reply(201, append({}, "reset", null));
    calls.unmocked.push(`${method} ${path}`);
    return reply(404, { detail: `no mock for ${method} ${path}` });
  });
  return { calls, catchUp: () => { worker.sources = String(rows[0].version); } };
}

const sw = (page: Page, name: string) => page.getByRole("switch", { name, exact: true });

async function openSources(page: Page) {
  await page.goto("/admin/sources");
  const link = page.getByRole("navigation", { name: "ผู้ดูแลระบบ" }).getByRole("link", { name: "แหล่งค้น", exact: true });
  await expect(link).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1, name: "แหล่งค้น" })).toBeVisible();
  await expect(sw(page, "OpenAIRE")).toBeVisible();
}

test("sources: turn ThaiJO off, check, save as version 2, follow the worker, then restore version 1", async ({ page }) => {
  await mockApi(page);
  const admin = await mockSources(page);
  await openSources(page);
  await expect(page.getByText("ใช้เวอร์ชัน 1 จาก DB")).toBeVisible();
  await expect(sw(page, "OpenAIRE")).toHaveAttribute("aria-checked", "false");
  await sw(page, "ThaiJO").click();
  await expect(sw(page, "ThaiJO")).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "ตรวจ", exact: true }).click();
  await expect(page.getByText("จะค้น 7 แหล่ง: PubMed, Europe PMC, OpenAlex, Semantic Scholar, Crossref, arXiv, DOAJ")).toBeVisible();
  await page.getByRole("button", { name: "บันทึกเป็นเวอร์ชันใหม่" }).click();
  await expect(page.getByText("บันทึกเป็นเวอร์ชัน 2 แล้ว")).toBeVisible();
  expect(admin.calls.saves).toEqual([{ sources: { ...ENV, openaire: false, thaijo: false }, base_version: 1 }]);
  await expect(page.getByText("ใช้เวอร์ชัน 2 จาก DB")).toBeVisible();
  await expect(page.getByRole("list", { name: "worker" })).toContainText("กำลังเปลี่ยนเป็น 2");
  admin.catchUp();
  await page.reload();
  await expect(page.getByRole("list", { name: "worker" })).toContainText("ตรงกับที่ใช้งาน");
  await page.getByRole("button", { name: "ประวัติ", exact: true }).click();
  const v1 = page.getByRole("listitem", { name: "เวอร์ชัน 1", exact: true });
  await v1.getByRole("button", { name: "ย้อนกลับไปเวอร์ชัน 1" }).click();
  await page.getByRole("button", { name: "ยืนยันย้อนกลับ" }).click();
  await expect(page.getByText("ใช้เวอร์ชัน 3 จาก DB")).toBeVisible();
  expect(admin.calls.unmocked).toEqual([]);
  expect(admin.calls.rejected).toEqual([]);
});

async function audit(page: Page, label: string) {
  await test.step(label, async () => {
    await page.evaluate(() => document.fonts.ready);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(sideways, `${label}: the page scrolls sideways`).toBeLessThanOrEqual(0);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`), `${label}: serious or critical axe violations`).toEqual([]);
  });
}

for (const scheme of ["light", "dark"] as const) {
  for (const width of [1440, 390]) {
    test(`sources at ${width}px (${scheme}): at rest, checked, refused, history — no sideways scroll, axe-clean`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
      await mockApi(page);
      await mockSources(page);
      const at = (what: string) => `${what} · ${width}px ${scheme}`;
      await page.goto("/admin/sources");
      await expect(sw(page, "OpenAIRE")).toBeVisible();
      await audit(page, at("at rest"));
      await sw(page, "Europe PMC").click();
      await page.getByRole("button", { name: "ตรวจ", exact: true }).click();
      await expect(page.getByText(/Europe PMC RCT search/)).toBeVisible();
      await audit(page, at("checked with a warning"));
      for (const name of ["PubMed", "OpenAlex", "Semantic Scholar", "Crossref", "arXiv", "DOAJ"]) await sw(page, name).click();
      await page.getByRole("button", { name: "ตรวจ", exact: true }).click();
      await expect(page.getByRole("main").getByRole("alert")).toContainText(NO_SEARXNG);
      await audit(page, at("the minimum refused"));
      await page.getByRole("button", { name: "ประวัติ", exact: true }).click();
      await expect(page.getByRole("listitem", { name: "เวอร์ชัน 1", exact: true })).toBeVisible();
      await audit(page, at("history"));
    });
  }
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-plan-23d/frontend && npx vitest run src/components/admin/sources-view.test.tsx src/components/admin/admin-gate.test.tsx`

Expected: `Failed to resolve import "./sources-view"` (sources-view.test.tsx) and 1 failed in admin-gate.test.tsx (the nav list lacks "แหล่งค้น").

- [ ] **Step 3: Implement**

**Edit** `frontend/src/lib/admin-types.ts` (2 replacements; each `old` occurs exactly once):

1. Replace

```ts
}
/** `loaded_at` is when the worker last reported (it re-reports every 30 s), not when it loaded the version. Plan 23c adds
 * the settings and glossary versions it runs ("env" and "file" for the defaults) and a failed runtime reload. */
export interface LoadedWorker {
  worker: string; version: string; preset: string; loaded_at: string; error: string | null;
  settings?: string | null; glossary?: string | null; runtime_error?: string | null;
}
export interface LlmConfigState {
```

   with

```ts
}
/** `loaded_at` is when the worker last reported (it re-reports every 30 s), not when it loaded the version. Plan 23c adds
 * the settings and glossary versions it runs ("env" and "file" for the defaults) and a failed runtime reload; Plan 23d
 * the search-sources version ("env" for the default). */
export interface LoadedWorker {
  worker: string; version: string; preset: string; loaded_at: string; error: string | null;
  settings?: string | null; glossary?: string | null; sources?: string | null; runtime_error?: string | null;
}
export interface LlmConfigState {
```

2. Replace

```ts
}
export interface GlossaryReport { ok: boolean; errors: FieldError[]; warnings: string[]; preview: string | null; chars: number | null }
export type RuntimeKind = "settings" | "glossary";
export interface RuntimeVersion {
  version: number; kind: RuntimeKind; created_at: string; created_by: string; note: string | null;
```

   with

```ts
}
export interface GlossaryReport { ok: boolean; errors: FieldError[]; warnings: string[]; preview: string | null; chars: number | null }
export type RuntimeKind = "settings" | "glossary" | "sources";
/** Plan 23d: the search sources (/api/v1/admin/sources). Mirrors backend/app/api/admin_runtime.py. */
export interface SourceRow {
  id: string; label: string; kind: "searxng" | "direct"; env: boolean; enabled: boolean; overridden: boolean;
}
export interface SourcesState {
  source: "db" | "env"; version: number | null; sources: SourceRow[]; extras: string[]; error: string | null;
  loaded: LoadedWorker[];
}
export interface SourcesReport {
  ok: boolean; errors: FieldError[]; warnings: string[]; document: { sources: Record<string, boolean> } | null;
  enabled: string[] | null;
}
export interface RuntimeVersion {
  version: number; kind: RuntimeKind; created_at: string; created_by: string; note: string | null;
```

**Edit** `frontend/src/lib/admin-api.ts` (2 replacements; each `old` occurs exactly once):

1. Replace

```ts
  GlossaryTerm, HarnessCompare, HarnessReportItem, HarnessResultItem, HarnessRun, HarnessStartBody, HarnessState, LlmConfigDoc,
  LlmConfigState, LlmDraft, LlmSaveResult, LlmVersion, MintedKey, Page, ProbeResult, RuntimeKind, RuntimeVersion, SavedVersion,
  SettingValue, SettingsReport, SettingsState, ValidateReport,
} from "./admin-types";

```

   with

```ts
  GlossaryTerm, HarnessCompare, HarnessReportItem, HarnessResultItem, HarnessRun, HarnessStartBody, HarnessState, LlmConfigDoc,
  LlmConfigState, LlmDraft, LlmSaveResult, LlmVersion, MintedKey, Page, ProbeResult, RuntimeKind, RuntimeVersion, SavedVersion,
  SettingValue, SettingsReport, SettingsState, SourcesReport, SourcesState, ValidateReport,
} from "./admin-types";

```

2. Replace

```ts
  saveGlossary: (body: { terms: GlossaryTerm[]; base_version: number | null; note?: string }) =>
    call<SavedVersion>("/glossary", send("POST", body)),
  runtimeVersions: (kind: RuntimeKind, before?: number | null) =>
    call<Page<RuntimeVersion>>(`/${kind}/versions${before ? `?before=${before}` : ""}`),
```

   with

```ts
  saveGlossary: (body: { terms: GlossaryTerm[]; base_version: number | null; note?: string }) =>
    call<SavedVersion>("/glossary", send("POST", body)),
  sources: () => call<SourcesState>("/sources"),
  validateSources: (sources: Record<string, boolean>) => call<SourcesReport>("/sources/validate", send("POST", { sources })),
  saveSources: (body: { sources: Record<string, boolean>; base_version: number | null; note?: string }) =>
    call<SavedVersion>("/sources", send("POST", body)),
  runtimeVersions: (kind: RuntimeKind, before?: number | null) =>
    call<Page<RuntimeVersion>>(`/${kind}/versions${before ? `?before=${before}` : ""}`),
```

**Edit** `frontend/src/components/admin/worker-versions.tsx` (2 replacements; each `old` occurs exactly once):

1. Replace

```tsx
import { isStale } from "@/lib/admin-workers";

/** Which settings or glossary version each worker runs (Plan 23c), by the rules of the models header (Plan 23b): a
 * worker on another version is "changing" while the page's own write settles and a warning after that, a failed
 * reload and a worker silent for over 2 minutes are warnings, and each says so in words as well as colour. `now` is
 * when the page read the reports. */
export function WorkerVersions({ loaded, field, expected, now, settling = false }: {
  loaded: LoadedWorker[]; field: "settings" | "glossary"; expected: string; now: number; settling?: boolean;
}) {
  if (loaded.length === 0) {
```

   with

```tsx
import { isStale } from "@/lib/admin-workers";

/** Which settings, glossary or (Plan 23d) sources version each worker runs (Plan 23c), by the rules of the models header (Plan 23b): a
 * worker on another version is "changing" while the page's own write settles and a warning after that, a failed
 * reload and a worker silent for over 2 minutes are warnings, and each says so in words as well as colour. `now` is
 * when the page read the reports. */
export function WorkerVersions({ loaded, field, expected, now, settling = false }: {
  loaded: LoadedWorker[]; field: "settings" | "glossary" | "sources"; expected: string; now: number; settling?: boolean;
}) {
  if (loaded.length === 0) {
```

2. Replace

```tsx
    <ul className="mt-2 grid gap-1 text-sm" aria-label="worker">
      {loaded.map((w) => {
        const version = w[field] ?? (field === "settings" ? "env" : "file");
        const other = version !== expected;
        const changing = other && settling;
```

   with

```tsx
    <ul className="mt-2 grid gap-1 text-sm" aria-label="worker">
      {loaded.map((w) => {
        const version = w[field] ?? (field === "glossary" ? "file" : "env");
        const other = version !== expected;
        const changing = other && settling;
```

**Edit** `frontend/src/components/admin/admin-nav.tsx` (1 replacement; each `old` occurs exactly once):

1. Replace

```tsx
const LINKS = [
  ["/admin/dashboard", "Dashboard"], ["/admin/reviews", "รีวิว"], ["/admin/keys", "API keys"], ["/admin/models", "โมเดล"],
  ["/admin/settings", "ตั้งค่า"], ["/admin/glossary", "อภิธานศัพท์"], ["/admin/harness", "Harness"], ["/admin/audit", "Audit log"],
] as const;

```

   with

```tsx
const LINKS = [
  ["/admin/dashboard", "Dashboard"], ["/admin/reviews", "รีวิว"], ["/admin/keys", "API keys"], ["/admin/models", "โมเดล"],
  ["/admin/settings", "ตั้งค่า"], ["/admin/sources", "แหล่งค้น"], ["/admin/glossary", "อภิธานศัพท์"], ["/admin/harness", "Harness"], ["/admin/audit", "Audit log"],
] as const;

```

**New file** `frontend/src/components/admin/sources-view.tsx` (complete):

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { AdminApiError, adminApi } from "@/lib/admin-api";
import { WORKERS_NOT_NOTIFIED } from "@/lib/admin-copy";
import type { SourceRow, SourcesReport, SourcesState } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { ConfirmButton } from "./confirm-button";
import { STALE_TEXT } from "./settings-view";
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT } from "./ui";
import { VersionHistory } from "./version-history";
import { DraftStatus, type VersionedSpec, useVersionedPage } from "./versioned-page";
import { WorkerVersions } from "./worker-versions";

/** The draft: each source on (true) or off (false). The page sends the whole set; the server keeps only what differs
 * from env, so the stored version is "where this differs from env" (Plan 23d). */
export type SourcesDraft = Record<string, boolean>;

/** What each source covers, in one line (English source names, Thai text). */
export const SOURCE_NOTE: Record<string, string> = {
  pubmed: "ฐานข้อมูลงานวิจัยการแพทย์ของ NLM (MEDLINE)",
  europepmc: "รวม preprint medRxiv/bioRxiv และการค้น RCT",
  openalex: "ดัชนีงานวิชาการแบบเปิดทุกสาขา",
  semantic_scholar: "ดัชนีงานวิชาการพร้อมข้อมูลการอ้างอิง",
  crossref: "ทะเบียน DOI ของสำนักพิมพ์",
  arxiv: "preprint สายชีววิทยาเชิงปริมาณและสถิติ",
  doaj: "วารสาร open access ที่ผ่านการคัดกรอง",
  openaire: "คลังงานวิจัยแบบเปิดของยุโรป",
  thaijo: "วารสารไทยหมวดสุขภาพ ไม่เกิน 1/8 ของ pool",
};

const GROUPS: { kind: SourceRow["kind"]; title: string }[] = [
  { kind: "searxng", title: "ผ่าน SearXNG" },
  { kind: "direct", title: "เรียกตรง" },
];

const sourcesName = (v: number | null) => (v === null ? "env" : String(v));

export const SOURCES_PAGE: VersionedSpec<SourcesState, SourcesDraft> = {
  read: () => adminApi.sources(),
  docOf: (state) => Object.fromEntries(state.sources.map((s) => [s.id, s.enabled])),
  same: (a, b) => JSON.stringify(a) === JSON.stringify(b), // drafts are built in catalog order, so key order matches
  workerVersion: (w) => w.sources ?? "env",
  wanted: (s) => sourcesName(s.version),
  versionName: sourcesName,
};

function SourceSwitch({ source, on, error, onChange }: {
  source: SourceRow; on: boolean; error: string | undefined; onChange: (on: boolean) => void;
}) {
  const nameId = `source-${source.id}-name`;
  const errorId = `source-${source.id}-error`;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 border-b border-rule py-3">
      <div className="grid gap-1">
        <span id={nameId} className="font-display font-semibold">{source.label}</span>
        <span className="text-sm text-muted">{SOURCE_NOTE[source.id] ?? ""}</span>
        <span className="flex flex-wrap gap-2 text-sm">
          <span>{`ค่า env: ${source.env ? "เปิด" : "ปิด"}`}</span>
          {on !== source.env && <span className="rounded-sm bg-warn-bg px-2">ต่างจาก env</span>}
        </span>
        {error && <p id={errorId} className="text-sm text-err">{error}</p>}
      </div>
      <button type="button" role="switch" aria-checked={on} aria-labelledby={nameId}
        aria-describedby={error ? errorId : undefined} onClick={() => onChange(!on)}
        className={`inline-flex min-h-11 min-w-20 cursor-pointer items-center justify-center rounded-sm border px-3 font-display font-semibold ${on ? "border-primary bg-primary text-on-primary" : "border-rule bg-transparent text-ink"}`}>
        {on ? "เปิด" : "ปิด"}
      </button>
    </li>
  );
}

interface Saved { version: number; workersNotified: boolean }

export function SourcesView() {
  const { fail } = useAdmin();
  const page = useVersionedPage(SOURCES_PAGE);
  const { state, draft } = page;
  /** The last check and the draft it was run on: once the draft is edited it is not shown as the draft's. */
  const [checked, setChecked] = useState<{ doc: SourcesDraft; report: SourcesReport } | null>(null);
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<"edit" | "history">("edit");
  const [actionError, setActionError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [busy, setBusy] = useState(false);
  const savedRef = useRef<HTMLDivElement>(null);
  const focusSaved = useRef(false);
  /** The draft as last rendered, for a save that answers after the admin kept editing (read in handlers only). */
  const latestDoc = useRef<SourcesDraft | undefined>(undefined);

  useEffect(() => {
    latestDoc.current = draft?.doc;
  });

  useEffect(() => {
    if (saved && focusSaved.current) {
      focusSaved.current = false;
      savedRef.current?.focus();
    }
  }, [saved]);

  if (!state || !draft) {
    return (
      <section aria-labelledby="sources-title" className="py-6">
        <h1 id="sources-title" className="font-display text-2xl font-semibold">แหล่งค้น</h1>
        {page.error ? <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-2">{page.error}</p>
          : <p role="status" className="mt-4 text-muted">กำลังโหลด…</p>}
      </section>
    );
  }
  const current = state;
  const report = checked && SOURCES_PAGE.same(checked.doc, draft.doc) ? checked.report : null;
  const ids = new Set(current.sources.map((s) => s.id));
  const fieldErrors = new Map((report?.errors ?? []).filter((e) => e.field?.startsWith("sources.") && ids.has(e.field.slice(8)))
    .map((e) => [(e.field as string).slice(8), e.message]));
  const otherErrors = (report?.errors ?? []).filter((e) => !(e.field?.startsWith("sources.") && ids.has(e.field.slice(8))));
  const labelOf = (id: string) => current.sources.find((s) => s.id === id)?.label ?? id;

  function change(id: string, on: boolean) {
    setSaved(null);
    page.edit((d) => ({ ...d, [id]: on }));
  }

  async function validate() {
    const doc = draft!.doc;
    setBusy(true);
    setActionError(null);
    try {
      setChecked({ doc, report: await adminApi.validateSources(doc) });
    } catch (e) {
      setActionError(fail(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const sent = draft!.doc;
    setBusy(true);
    setActionError(null);
    page.track.start();
    try {
      const row = await adminApi.saveSources({ sources: sent, base_version: draft!.base, ...(note.trim() ? { note: note.trim() } : {}) });
      page.track.wrote();
      setNote("");
      focusSaved.current = true;
      setSaved({ version: row.version, workersNotified: row.workers_notified !== false });
      await page.load(sent, row.version); // the button stays busy until the page has re-read
    } catch (e) {
      if (e instanceof AdminApiError && e.status === 409) {
        setActionError(STALE_TEXT);
        page.reload(); // the header moves on; the draft keeps its base and the page offers both ways forward
      } else if (e instanceof AdminApiError && e.status === 422 && e.errors && e.errors.length > 0
        && latestDoc.current !== undefined && SOURCES_PAGE.same(sent, latestDoc.current)) {
        // the save's own check refused the draft: shown as after "ตรวจ" (a draft edited meanwhile gets the notice)
        setChecked({ doc: sent, report: { ok: false, errors: e.errors, warnings: [], document: null, enabled: null } });
      } else {
        setActionError(fail(e));
      }
    } finally {
      page.track.end();
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="sources-title" className="py-6">
      <h1 id="sources-title" className="font-display text-2xl font-semibold">แหล่งค้น</h1>
      <div className="mt-3 rounded-sm bg-info-bg px-4 py-3">
        <p className="font-display font-semibold">
          {current.source === "db" ? `ใช้เวอร์ชัน ${current.version} จาก DB` : "ใช้ค่าจาก env"}
        </p>
        <p className="text-sm">
          API ใช้ชุดแหล่งที่บันทึกภายใน 5 วินาที worker ใช้เมื่อเริ่มรีวิวถัดไปหรือภายใน 30 วินาที รีวิวที่กำลังทำอยู่ใช้ชุดเดิมจนจบ
          แหล่งที่ไม่ได้ตั้งเองตามค่าใน env (SEARXNG_ENGINES, THAIJO_ENABLED)
        </p>
        <WorkerVersions loaded={current.loaded} field="sources" expected={SOURCES_PAGE.wanted(current)}
          now={page.readAt} settling={page.settling} />
      </div>
      {current.error && <p className="mt-4 rounded-sm bg-warn-bg px-4 py-2">{`เวอร์ชันที่ใช้อยู่มีปัญหา: ${current.error}`}</p>}
      {page.error && <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-2">{page.error}</p>}
      <div role="group" aria-label="มุมมอง" className="mt-4 flex flex-wrap gap-2">
        <button type="button" aria-pressed={tab === "edit"} className={BUTTON_GHOST} onClick={() => setTab("edit")}>แก้ไข</button>
        <button type="button" aria-pressed={tab === "history"} className={BUTTON_GHOST} onClick={() => setTab("history")}>ประวัติ</button>
      </div>
      {tab === "history" ? (
        <VersionHistory kind="sources" base={current.version} resetLabel="กลับไปใช้ค่า env" emptyText="ยังไม่มีเวอร์ชันที่บันทึก ใช้ค่าจาก env อยู่"
          resetHint="เวอร์ชันใหม่จะไม่มีแหล่งที่ตั้งเอง ทุกแหล่งกลับไปตามค่าใน env ทันที" onChanged={page.reload} writes={page.track} />
      ) : (
        <>
          {GROUPS.map(({ kind, title }) => (
            <section key={kind} aria-labelledby={`group-${kind}`} className="mt-6">
              <h2 id={`group-${kind}`} className="font-display text-xl font-semibold">{title}</h2>
              <ul aria-labelledby={`group-${kind}`} className="mt-2 border-t border-rule">
                {current.sources.filter((s) => s.kind === kind).map((s) => (
                  <SourceSwitch key={s.id} source={s} on={draft.doc[s.id] ?? s.enabled} error={fieldErrors.get(s.id)}
                    onChange={(on) => change(s.id, on)} />
                ))}
              </ul>
            </section>
          ))}
          {current.extras.length > 0 && (
            <section aria-labelledby="group-extras" className="mt-6">
              <h2 id="group-extras" className="font-display text-xl font-semibold">ตั้งใน env เท่านั้น</h2>
              <ul aria-labelledby="group-extras" className="mt-2 border-t border-rule">
                {current.extras.map((e) => (
                  <li key={e} className="border-b border-rule py-3">
                    <code className="font-code">{e}</code>
                    <span className="text-sm text-muted">{" · ตั้งใน "}<code className="font-code">SEARXNG_ENGINES</code>{" เปิดปิดในหน้านี้ไม่ได้"}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="mt-6 text-sm text-muted">
            การเปลี่ยนชุดแหล่งค้นเริ่ม cache รุ่นใหม่ของชุดนั้น: คำถามเดิมจะถูกค้นใหม่ด้วยแหล่งชุดใหม่ ส่วนการเติมข้อมูลจาก Europe PMC
            และเครือข่ายการอ้างอิงทำงานต่อไม่ว่าจะเปิดหรือปิดแหล่งใด
          </p>
          <DraftStatus moved={page.moved} base={draft.base} current={current.version} note={page.draftNote}
            onDiscard={page.discard} onRebase={page.rebase} versionName={sourcesName} />
          {report && !report.ok && (
            <div role="alert" className="mt-6 rounded-sm bg-err-bg px-4 py-3">
              <p className="font-display font-semibold">ยังบันทึกไม่ได้</p>
              {fieldErrors.size > 0 && <p className="mt-1 text-sm">{`แหล่งที่ต้องแก้ ${fieldErrors.size} แหล่ง: ดูข้อความใต้ชื่อแหล่งนั้น`}</p>}
              {otherErrors.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-sm">{otherErrors.map((e, n) => <li key={`${n}-${e.message}`}>{e.message}</li>)}</ul>
              )}
            </div>
          )}
          {report && report.ok && (
            <div role="status" className="mt-6 grid gap-2">
              <div className="rounded-sm bg-info-bg px-4 py-3">
                <p className="font-display font-semibold">ผ่านการตรวจ</p>
                {report.enabled && (
                  <p className="mt-1 text-sm">{`จะค้น ${report.enabled.length} แหล่ง: ${report.enabled.map(labelOf).join(", ")}`}</p>
                )}
              </div>
              {report.warnings.length > 0 && (
                <ul className="list-disc rounded-sm bg-warn-bg py-2 pr-4 pl-9 text-sm">{report.warnings.map((w, n) => <li key={`${n}-${w}`}>{w}</li>)}</ul>
              )}
            </div>
          )}
          <label className="mt-6 block">
            <span className="text-sm">หมายเหตุ (ไม่บังคับ)</span>
            <input className={INPUT} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={BUTTON_GHOST} disabled={busy} onClick={validate}>ตรวจ</button>
            <button type="button" className={BUTTON_PRIMARY} disabled={busy} onClick={save}>บันทึกเป็นเวอร์ชันใหม่</button>
            {page.dirty && !page.moved && (
              <ConfirmButton label="ยกเลิกการแก้ไข" confirmLabel="ยืนยันยกเลิกการแก้ไข" onConfirm={page.discard}
                hint="การแก้ไขที่ยังไม่ได้บันทึกจะหายไป" />
            )}
          </div>
          {saved && (
            <div ref={savedRef} tabIndex={-1} role="status" className="mt-3 grid gap-2">
              <p className="rounded-sm bg-info-bg px-4 py-2">{`บันทึกเป็นเวอร์ชัน ${saved.version} แล้ว`}</p>
              {!saved.workersNotified && <p className="rounded-sm bg-warn-bg px-4 py-2">{WORKERS_NOT_NOTIFIED}</p>}
            </div>
          )}
          {actionError && <p role="alert" className="mt-3 rounded-sm bg-err-bg px-4 py-2">{actionError}</p>}
        </>
      )}
    </section>
  );
}
```

**New file** `frontend/src/app/admin/(console)/sources/page.tsx` (complete):

```tsx
import type { Metadata } from "next";
import { SourcesView } from "@/components/admin/sources-view";

export const metadata: Metadata = { title: "แหล่งค้น · ผู้ดูแลระบบ" };

export default function AdminSourcesPage() {
  return <SourcesView />;
}
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-23d/frontend && npx vitest run src/components/admin/sources-view.test.tsx src/components/admin/admin-gate.test.tsx`

Expected: 2 files, 15 passed.

- [ ] **Step 5: The full frontend suite, typecheck, lint and the admin e2e specs**

Run: `cd /d/MRA-plan-23d/frontend && npm test && npm run typecheck && npm run lint`
Run: `cd /d/MRA-plan-23d/frontend && npx playwright test e2e/admin-sources.spec.ts e2e/admin-runtime.spec.ts e2e/admin.spec.ts e2e/admin-models.spec.ts` (it builds the app and serves it on port 3100 with a mocked API; see Global Constraints for the port)

Expected: `npm test` 153 files, 1637 tests passed (the base had 152 files, 1631 tests); typecheck and eslint clean; e2e 43 passed (the 5 new admin-sources tests and the three existing admin specs).

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-plan-23d\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
feat(sources): the admin sources page with one switch per source, its history and the nav link (Plan 23d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-23d && git add frontend/src/test/admin-sources-fixtures.ts frontend/src/components/admin/sources-view.test.tsx frontend/src/components/admin/admin-gate.test.tsx frontend/e2e/admin-sources.spec.ts frontend/src/lib/admin-types.ts frontend/src/lib/admin-api.ts frontend/src/components/admin/worker-versions.tsx frontend/src/components/admin/admin-nav.tsx frontend/src/components/admin/sources-view.tsx "frontend/src/app/admin/(console)/sources/page.tsx"
git commit -F .superpowers/commit-msg.txt
```

---

### Task 5: Frontend — the landing band and the developers page list the sources from /status

**Files:**
- Modify: `frontend/src/lib/types.ts`
- Create: `frontend/src/lib/search-sources.ts`
- Modify: `frontend/src/components/landing/capabilities.tsx`
- Modify: `frontend/src/app/page.tsx`
- Modify: `frontend/src/app/developers/page.tsx`
- Test (create): `frontend/src/lib/search-sources.test.ts`
- Test (modify): `frontend/src/components/landing/capabilities.test.tsx`

**Interfaces:**
- Consumes: `/status` `sources` (Task 3); `getServerStatus`.
- Produces:
  - `ServiceStatus.sources?: {id, label}[]` (`src/lib/types.ts`).
  - `src/lib/search-sources.ts`: `DEFAULT_SOURCES` (the static eight), `sourceLabels(sources)`, `hasThaiJo(sources)`, `joinThai(items)`.
  - `Capabilities({ sources? })` lists `sourceLabels(sources)` and adds "และค้นวารสารไทยจาก ThaiJO โดยตรง" while ThaiJO is on; `Home` passes `status?.sources`; the developers page's search step names the sources and their count from `/status`, and the `search_papers` row no longer says "8 แหล่ง".

- [ ] **Step 1: Write the failing tests**

**New file** `frontend/src/lib/search-sources.test.ts` (complete):

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_SOURCES, hasThaiJo, joinThai, sourceLabels } from "./search-sources";

describe("search sources from /status (Plan 23d)", () => {
  it("lists the labels /status sends, in its order", () => {
    expect(sourceLabels([{ id: "pubmed", label: "PubMed" }, { id: "thaijo", label: "ThaiJO" }, { id: "plos", label: "PLOS" }]))
      .toEqual(["PubMed", "ThaiJO", "PLOS"]);
  });

  it("falls back to the default eight without /status, without sources, or with nothing usable", () => {
    for (const sources of [null, undefined, [], [{ id: "x", label: " " }], "PubMed" as never]) {
      expect(sourceLabels(sources)).toEqual([...DEFAULT_SOURCES]);
    }
    expect(DEFAULT_SOURCES).toHaveLength(8);
  });

  it("knows when ThaiJO is on and joins a list the Thai way", () => {
    expect(hasThaiJo([{ id: "thaijo", label: "ThaiJO" }])).toBe(true);
    expect(hasThaiJo([{ id: "pubmed", label: "PubMed" }])).toBe(false);
    expect(hasThaiJo(null)).toBe(false);
    expect(joinThai(["A", "B", "C"])).toBe("A, B และ C");
    expect(joinThai(["A"])).toBe("A");
    expect(joinThai([])).toBe("");
  });
});
```

**Edit** `frontend/src/components/landing/capabilities.test.tsx` (1 replacement; each `old` occurs exactly once):

1. Replace

```tsx
  });

  it("explains each review type in plain Thai and glosses the jargon in brackets", () => {
    const { container } = render(<Capabilities />);
```

   with

```tsx
  });

  it("lists the sources /status reports, and says when ThaiJO is searched directly", () => {
    const { container } = render(<Capabilities sources={[
      { id: "pubmed", label: "PubMed" }, { id: "europepmc", label: "Europe PMC" }, { id: "thaijo", label: "ThaiJO" },
    ]} />);
    const list = screen.getByRole("list", { name: "แหล่งข้อมูลที่ค้น" });
    expect([...list.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["PubMed", "Europe PMC", "ThaiJO"]);
    expect(container.textContent).toContain("และค้นวารสารไทยจาก ThaiJO โดยตรง");
  });

  it("keeps the default eight and no ThaiJO line when /status gives no sources", () => {
    const { container } = render(<Capabilities sources={null} />);
    expect(screen.getByRole("list", { name: "แหล่งข้อมูลที่ค้น" })).toHaveTextContent("OpenAIRE");
    expect(container.textContent).not.toContain("ThaiJO");
  });

  it("explains each review type in plain Thai and glosses the jargon in brackets", () => {
    const { container } = render(<Capabilities />);
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /d/MRA-plan-23d/frontend && npx vitest run src/lib/search-sources.test.ts src/components/landing/capabilities.test.tsx`

Expected: `Failed to resolve import "./search-sources"` (search-sources.test.ts) and 1 failed in capabilities.test.tsx (the band ignores `sources`).

- [ ] **Step 3: Implement**

**Edit** `frontend/src/lib/types.ts` (1 replacement; each `old` occurs exactly once):

1. Replace

```ts
  reviews_today: number | null;
  turnstile_site_key: string | null;
  limits: {
    review_rate_limit: string;
```

   with

```ts
  reviews_today: number | null;
  turnstile_site_key: string | null;
  /** Plan 23d: the search sources in force (catalog order, then env-only engines); absent before it */
  sources?: { id: string; label: string }[];
  limits: {
    review_rate_limit: string;
```

**New file** `frontend/src/lib/search-sources.ts` (complete):

```ts
import type { ServiceStatus } from "./types";

/** The sources searched before Plan 23d, shown when GET /api/v1/status is unreachable or carries no `sources`. */
export const DEFAULT_SOURCES = ["PubMed", "Europe PMC", "OpenAlex", "Semantic Scholar", "Crossref", "arXiv", "DOAJ", "OpenAIRE"] as const;

/** The labels of the search sources the service has on (`/status` → `sources`, Plan 23d: the admin console can turn
 * each one off or on), else the default eight. Never hard-code the count in copy: take it from this list. */
export function sourceLabels(sources: ServiceStatus["sources"] | null | undefined): string[] {
  const labels = (Array.isArray(sources) ? sources : [])
    .map((s) => (typeof s?.label === "string" ? s.label.trim() : ""))
    .filter((label) => label !== "");
  return labels.length > 0 ? labels : [...DEFAULT_SOURCES];
}

/** Whether the list from /status has ThaiJO on (it is searched directly, not through SearXNG). */
export function hasThaiJo(sources: ServiceStatus["sources"] | null | undefined): boolean {
  return Array.isArray(sources) && sources.some((s) => s?.id === "thaijo");
}

/** "A, B และ C" */
export function joinThai(items: readonly string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} และ ${items[items.length - 1]}`;
}
```

**Edit** `frontend/src/components/landing/capabilities.tsx` (3 replacements; each `old` occurs exactly once):

1. Replace

```tsx
import type { ReactNode } from "react";
import { REVIEW_TYPE_LABEL } from "@/lib/review-type";
import type { ReviewType } from "@/lib/types";
import { Gloss } from "../ui/gloss";
import { TypeDescription } from "./type-description";
```

   with

```tsx
import type { ReactNode } from "react";
import { REVIEW_TYPE_LABEL } from "@/lib/review-type";
import { hasThaiJo, sourceLabels } from "@/lib/search-sources";
import type { ReviewType, ServiceStatus } from "@/lib/types";
import { Gloss } from "../ui/gloss";
import { TypeDescription } from "./type-description";
```

2. Replace

```tsx
];

const SOURCES = ["PubMed", "Europe PMC", "OpenAlex", "Semantic Scholar", "Crossref", "arXiv", "DOAJ", "OpenAIRE"];

/** What the service can do now (Plans 14–17): review types, report views and sources, in one band. */
export function Capabilities() {
  return (
    <section aria-labelledby="h-capabilities" className="grid gap-8 border-t border-rule pt-10">
```

   with

```tsx
];

/** What the service can do now (Plans 14–17): review types, report views and sources, in one band. `sources` is
 * `/status` → `sources` (Plan 23d: the admin console turns each one on or off); without it the default eight show. */
export function Capabilities({ sources = null }: { sources?: ServiceStatus["sources"] | null }) {
  const labels = sourceLabels(sources);
  return (
    <section aria-labelledby="h-capabilities" className="grid gap-8 border-t border-rule pt-10">
```

3. Replace

```tsx
          <h3 className="label">แหล่งข้อมูลที่ค้น</h3>
          <ul aria-label="แหล่งข้อมูลที่ค้น" className="flex flex-wrap gap-2">
            {SOURCES.map((s) => (
              <li key={s} className="rounded-sm border border-rule px-2.5 py-1 font-display text-[0.9rem]">{s}</li>
            ))}
          </ul>
          <p className="text-[0.92rem] leading-[1.7] text-muted">
            ฐานข้อมูลงานวิจัยวิชาการแบบเปิด ค้นผ่าน <Gloss k="searxng" /> ตัดงานซ้ำด้วย <Gloss k="doiPmid" />{" "}
            แล้วเติมข้อมูลจาก Europe PMC
          </p>
```

   with

```tsx
          <h3 className="label">แหล่งข้อมูลที่ค้น</h3>
          <ul aria-label="แหล่งข้อมูลที่ค้น" className="flex flex-wrap gap-2">
            {labels.map((s) => (
              <li key={s} className="rounded-sm border border-rule px-2.5 py-1 font-display text-[0.9rem]">{s}</li>
            ))}
          </ul>
          <p className="text-[0.92rem] leading-[1.7] text-muted">
            ฐานข้อมูลงานวิจัยวิชาการแบบเปิด ค้นผ่าน <Gloss k="searxng" />
            {hasThaiJo(sources) && " และค้นวารสารไทยจาก ThaiJO โดยตรง"} ตัดงานซ้ำด้วย <Gloss k="doiPmid" />{" "}
            แล้วเติมข้อมูลจาก Europe PMC
          </p>
```

**Edit** `frontend/src/app/page.tsx` (2 replacements; each `old` occurs exactly once):

1. Replace

```tsx
  // ?q= (a retry or an example) and, since Plan 27, the quick answer's "ทำรีวิวฉบับเต็ม" (?mode=full&lang=&year=&types=)
  const start = formStart(await props.searchParams);
  const limits = (await getServerStatus())?.limits ?? null; // paper counts in copy come from /status (Plan 21)
  return (
    <div className="grid gap-16">
```

   with

```tsx
  // ?q= (a retry or an example) and, since Plan 27, the quick answer's "ทำรีวิวฉบับเต็ม" (?mode=full&lang=&year=&types=)
  const start = formStart(await props.searchParams);
  const status = await getServerStatus();
  const limits = status?.limits ?? null; // paper counts in copy come from /status (Plan 21)
  return (
    <div className="grid gap-16">
```

2. Replace

```tsx
      <SampleBench />
      <Intro />
      <Capabilities />
      <RecentReviews />
    </div>
```

   with

```tsx
      <SampleBench />
      <Intro />
      <Capabilities sources={status?.sources ?? null} />
      <RecentReviews />
    </div>
```

**Edit** `frontend/src/app/developers/page.tsx` (4 replacements; each `old` occurs exactly once):

1. Replace

```tsx
import { limitsCopy } from "@/lib/developers-copy";
import { publicApiUrl } from "@/lib/public-api";
import { getServerStatus } from "@/lib/server-api";

```

   with

```tsx
import { limitsCopy } from "@/lib/developers-copy";
import { publicApiUrl } from "@/lib/public-api";
import { joinThai, sourceLabels } from "@/lib/search-sources";
import { getServerStatus } from "@/lib/server-api";

```

2. Replace

```tsx

const MCP_TOOLS: [string, string][] = [
  ["search_papers", "ค้นงานวิจัยจาก 8 แหล่งในครั้งเดียว ได้ชื่อเรื่อง บทคัดย่อ และรหัสประจำบทความ"],
  ["start_review", "เริ่มรีวิวได้ 4 รูปแบบเหมือนหน้าเว็บ เลือกชนิดงานวิจัยและปีได้ รายงานเป็นภาษาไทยหรืออังกฤษ"],
  ["get_review_status", "ดูสถานะ: รอคิว (queued) กำลังทำ (running) เสร็จ (done) ผิดพลาด (error) ไม่รับหัวข้อ (rejected) หรือยกเลิก (cancelled)"],
```

   with

```tsx

const MCP_TOOLS: [string, string][] = [
  ["search_papers", "ค้นงานวิจัยจากแหล่งที่ค้นผ่าน SearXNG ในครั้งเดียว ได้ชื่อเรื่อง บทคัดย่อ และรหัสประจำบทความ"],
  ["start_review", "เริ่มรีวิวได้ 4 รูปแบบเหมือนหน้าเว็บ เลือกชนิดงานวิจัยและปีได้ รายงานเป็นภาษาไทยหรืออังกฤษ"],
  ["get_review_status", "ดูสถานะ: รอคิว (queued) กำลังทำ (running) เสร็จ (done) ผิดพลาด (error) ไม่รับหัวข้อ (rejected) หรือยกเลิก (cancelled)"],
```

3. Replace

```tsx
  const api = await publicApiUrl();
  const s = snippets(api);
  const lc = limitsCopy((await getServerStatus())?.limits ?? null);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 pt-12">
```

   with

```tsx
  const api = await publicApiUrl();
  const s = snippets(api);
  const status = await getServerStatus();
  const lc = limitsCopy(status?.limits ?? null);
  const sources = sourceLabels(status?.sources); // Plan 23d: the sources in force, the default eight without /status
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 pt-12">
```

4. Replace

```tsx
              {[
                <>รับหัวข้อหรือคำถาม (ไม่เกิน 600 ตัวอักษร) แล้วตีความเป็นคำถามวิจัยตาม <Gloss k="pico" /> หรือ <Gloss k="pcc" /> สำหรับการทบทวนขอบเขต</>,
                <>ค้น 8 แหล่ง: PubMed, Europe PMC (รวม <Gloss k="preprint" /> จาก medRxiv/bioRxiv), OpenAlex, Semantic Scholar, Crossref, arXiv, DOAJ และ OpenAIRE ผ่าน <Gloss k="searxng" /> แล้วตัดงานซ้ำ</>,
                <>คัดกรองงานที่มี<Gloss k="abstract" />{lc.screen && ` ${lc.screen}`} ตามเกณฑ์ของรูปแบบการทบทวน พร้อมเหตุผลที่คัดออกตาม <Gloss k="prisma" /></>,
                <>อ่านบทคัดย่อของฉบับที่เกี่ยวข้องที่สุด{lc.read} สกัดผล ตัวเลข และ<Gloss k="riskOfBias" /> ตรวจตัวเลขทุกตัวกับประโยคต้นฉบับ</>,
```

   with

```tsx
              {[
                <>รับหัวข้อหรือคำถาม (ไม่เกิน 600 ตัวอักษร) แล้วตีความเป็นคำถามวิจัยตาม <Gloss k="pico" /> หรือ <Gloss k="pcc" /> สำหรับการทบทวนขอบเขต</>,
                <>ค้น {sources.length} แหล่ง: {joinThai(sources)} (ฐานข้อมูลสากลค้นผ่าน <Gloss k="searxng" />
                  {sources.includes("Europe PMC") && <> และ Europe PMC รวม <Gloss k="preprint" /> จาก medRxiv/bioRxiv</>}) แล้วตัดงานซ้ำ</>,
                <>คัดกรองงานที่มี<Gloss k="abstract" />{lc.screen && ` ${lc.screen}`} ตามเกณฑ์ของรูปแบบการทบทวน พร้อมเหตุผลที่คัดออกตาม <Gloss k="prisma" /></>,
                <>อ่านบทคัดย่อของฉบับที่เกี่ยวข้องที่สุด{lc.read} สกัดผล ตัวเลข และ<Gloss k="riskOfBias" /> ตรวจตัวเลขทุกตัวกับประโยคต้นฉบับ</>,
```

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-23d/frontend && npx vitest run src/lib/search-sources.test.ts src/components/landing/capabilities.test.tsx`

Expected: 2 files, 7 passed.

- [ ] **Step 5: The full frontend suite, typecheck, lint and the whole e2e suite**

Run: `cd /d/MRA-plan-23d/frontend && npm test && npm run typecheck && npm run lint`
Run: `cd /d/MRA-plan-23d/frontend && npm run e2e` (port 3100, see Global Constraints)

Expected: `npm test` 154 files, 1642 tests passed; typecheck and eslint clean; e2e 458 passed, 1 skipped (4.2 min). The e2e server cannot reach `/status` (the API is mocked in the browser only), so the landing band and the developers page show the default eight there, as before.

- [ ] **Step 6: Commit**

Write the message with the Write tool to `D:\MRA-plan-23d\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
feat(sources): the landing band and the developers page list the search sources from /status (Plan 23d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-23d && git add frontend/src/lib/search-sources.test.ts frontend/src/components/landing/capabilities.test.tsx frontend/src/lib/types.ts frontend/src/lib/search-sources.ts frontend/src/components/landing/capabilities.tsx frontend/src/app/page.tsx frontend/src/app/developers/page.tsx
git commit -F .superpowers/commit-msg.txt
```

---

### Task 6: Docs and final checks

**Files:**
- Modify: `docs/api.md`, `README.md`, `.env.example`, `docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md`
- Test (modify): `backend/tests/unit/test_api_docs_limits.py`

**Interfaces:**
- Consumes: the catalog, routes, cache rule and pages of Tasks 1–5.
- Produces: `docs/api.md` (the data-sources lines, "Search sources and the cache (Plan 23d)", the `/status` example and its `sources` note, `result.quality.sources`, the "Search sources (Plan 23d)" admin section, the ThaiJO flag note and the MCP `search_papers` row), the README admin and ThaiJO lines, the `.env.example` comments, roadmap row 23 (23d built); one docs test (the documented `/status` sources are the catalog).

This task ends at the docs commit and the final checks. The merge, the root `CLAUDE.md` convention line, the docker
rebuild, the smoke check and its cleanup are done by the controller afterwards (see "After the plan (controller)"
below); the implementer does none of them.

- [ ] **Step 1: Docs**

**Edit** `docs/api.md` (9 replacements; each `old` occurs exactly once):

1. Replace

```markdown

The service reviews published papers automatically:
- It turns your topic or question into a structured question (PICO, or PCC for scoping reviews), searches eight scholarly sources, screens about 120 candidate papers that have abstracts, and analyses the abstracts of the 5–50 you choose (default 30). It never fetches full text.
- Four review types: systematic review (`slr`, default), meta-analysis (`meta_analysis`), scoping review (`scoping`) and narrative review (`narrative`).
- Two modes (Plan 27): the full review (`full`, default) and the quick answer (`quick`, "ถามเร็ว"): a 2–4 sentence answer with numbered references from a small pool (see "Quick answer (Plan 27)").
```

   with

```markdown

The service reviews published papers automatically:
- It turns your topic or question into a structured question (PICO, or PCC for scoping reviews), searches the scholarly sources the service has on (eight engines and ThaiJO by default; `GET /api/v1/status` → `sources` lists them), screens about 120 candidate papers that have abstracts, and analyses the abstracts of the 5–50 you choose (default 30). It never fetches full text.
- Four review types: systematic review (`slr`, default), meta-analysis (`meta_analysis`), scoping review (`scoping`) and narrative review (`narrative`).
- Two modes (Plan 27): the full review (`full`, default) and the quick answer (`quick`, "ถามเร็ว"): a 2–4 sentence answer with numbered references from a small pool (see "Quick answer (Plan 27)").
```

2. Replace

```markdown

**Data sources.**
- **Search:** the service's own SearXNG with eight engines: PubMed, Europe PMC (incl. medRxiv/bioRxiv preprints), OpenAlex, Semantic Scholar, Crossref, arXiv, DOAJ and OpenAIRE. PLOS is available but opt-in (`SEARXNG_ENGINES`).
- **Metadata enrichment:** Europe PMC (abstracts, identifiers, publication types, open-access flag, cited-by count).
- **Citation metadata (reference lists, cited-by counts):** OpenAlex, with Europe PMC as the fallback.
- **ThaiJO (Plan 24, on by default since 2026-10-13):** Thai health journals through TCI's search API, turned off
  with `THAIJO_ENABLED=false` (see "ThaiJO source (Plan 24)" below).
- **Optional API keys** in `.env`: `NCBI_API_KEY`, `OPENALEX_API_KEY`, `S2_API_KEY` and `CORE_API_KEY`. Empty keys work at lower rate limits. They are never logged.
- **Survey of other open sources:** `docs/superpowers/notes/2026-10-10-open-scholarly-sources-survey.md`.
```

   with

```markdown

**Data sources.**
- **Search:** the service's own SearXNG with eight engines: PubMed, Europe PMC (incl. medRxiv/bioRxiv preprints), OpenAlex, Semantic Scholar, Crossref, arXiv, DOAJ and OpenAIRE. PLOS is available but opt-in (`SEARXNG_ENGINES`). An admin can turn each engine (and ThaiJO) off or on in the console (Plan 23d, see "Search sources (Plan 23d)"); `GET /api/v1/status` → `sources` lists the ones in use.
- **Metadata enrichment:** Europe PMC (abstracts, identifiers, publication types, open-access flag, cited-by count).
- **Citation metadata (reference lists, cited-by counts):** OpenAlex, with Europe PMC as the fallback.
- **ThaiJO (Plan 24, on by default since 2026-10-13):** Thai health journals through TCI's search API, turned off
  with `THAIJO_ENABLED=false` or in the admin console, whose saved version wins over the flag (see "ThaiJO source
  (Plan 24)" below).
- **Optional API keys** in `.env`: `NCBI_API_KEY`, `OPENALEX_API_KEY`, `S2_API_KEY` and `CORE_API_KEY`. Empty keys work at lower rate limits. They are never logged.
- **Survey of other open sources:** `docs/superpowers/notes/2026-10-10-open-scholarly-sources-survey.md`.
```

3. Replace

```markdown
turning ThaiJO on or off never returns a review that was searched the other way. ThaiJO is on by default, so deploying
the 2026-10-13 default starts a new cache generation: reviews cached before it (searched without ThaiJO) are not returned.

**Turnstile.** This only applies when the deployment sets `TURNSTILE_SECRET`. An anonymous `POST /reviews` must then send the browser token in the `cf-turnstile-response` header:
```

   with

```markdown
turning ThaiJO on or off never returns a review that was searched the other way. ThaiJO is on by default, so deploying
the 2026-10-13 default starts a new cache generation: reviews cached before it (searched without ThaiJO) are not returned.

**Search sources and the cache (Plan 23d).** While no sources version is saved in the admin console the pipeline
version is unchanged (Plan 24's `+thaijo` rule). Once one is saved, `+thaijo` follows the ThaiJO state in force (so
turning ThaiJO off in the console gives the same key as turning it off in env), and `+src<h>` is added when the
SearXNG engines in use differ from `SEARXNG_ENGINES`, where `<h>` is the first 8 hex digits of the sha256 of the
sorted engine names joined by `,`. A changed engine set therefore starts its own cache generation, and restoring an
older set (or a reset) returns to that set's generation.

**Turnstile.** This only applies when the deployment sets `TURNSTILE_SECRET`. An anonymous `POST /reviews` must then send the browser token in the `cf-turnstile-response` header:
```

4. Replace

```markdown
  timed_out}` for the OAI-PMH step when a ThaiJO paper was read.

Plan 25 adds (absent in results stored before it):
- `support`: `{judge, seconds, claims, pairs, judged, over_cap, computed, supported, partial, unsupported, verified}`
```

   with

```markdown
  timed_out}` for the OAI-PMH step when a ThaiJO paper was read.

Plan 23d adds (absent in results stored before it):
- `sources`: the ids of the search sources the review used (`pubmed`, `europepmc`, `openalex`, `semantic_scholar`,
  `crossref`, `arxiv`, `doaj`, `openaire`, `thaijo`), fixed when the review started.

Plan 25 adds (absent in results stored before it):
- `support`: `{judge, seconds, claims, pairs, judged, over_cap, computed, supported, partial, unsupported, verified}`
```

5. Replace

```markdown
{"accepting": true, "reason": null, "retry_after": null, "queue_depth": 0, "running": 3, "reviews_today": 41,
 "turnstile_site_key": null,
 "limits": {"review_rate_limit": "5/hour", "api_key_rate_limit": "60/hour", "paper_search_rate_limit": "30/minute",
            "review_types": ["narrative", "slr", "scoping", "meta_analysis"],
```

   with

```markdown
{"accepting": true, "reason": null, "retry_after": null, "queue_depth": 0, "running": 3, "reviews_today": 41,
 "turnstile_site_key": null,
 "sources": [{"id": "pubmed", "label": "PubMed"}, {"id": "europepmc", "label": "Europe PMC"},
             {"id": "openalex", "label": "OpenAlex"}, {"id": "semantic_scholar", "label": "Semantic Scholar"},
             {"id": "crossref", "label": "Crossref"}, {"id": "arxiv", "label": "arXiv"}, {"id": "doaj", "label": "DOAJ"},
             {"id": "openaire", "label": "OpenAIRE"}, {"id": "thaijo", "label": "ThaiJO"}],
 "limits": {"review_rate_limit": "5/hour", "api_key_rate_limit": "60/hour", "paper_search_rate_limit": "30/minute",
            "review_types": ["narrative", "slr", "scoping", "meta_analysis"],
```

6. Replace

````markdown
            "modes": ["full", "quick"], "quick": {"max_papers": 8, "candidate_limit": 30, "review_type": "slr"}}}
```

The daily budget figures are private. When the budget runs out, the status shows only `accepting: false` with `reason: "daily_budget"`. `accepting` assumes the largest allowed request, so near the end of the day it can read false while a smaller request would still be admitted.
````

   with

````markdown
            "modes": ["full", "quick"], "quick": {"max_papers": 8, "candidate_limit": 30, "review_type": "slr"}}}
```

`sources` (Plan 23d) lists the search sources in use, in the order above, then any engine `SEARXNG_ENGINES` adds
that the console does not know (`{"id": "plos", "label": "PLOS"}`). The example is the default (ThaiJO on). The web
app's landing page and developers page read it and show the default eight engines when `/status` is unreachable.

The daily budget figures are private. When the budget runs out, the status shows only `accepting: false` with `reason: "daily_budget"`. `accepting` assumes the largest allowed request, so near the end of the day it can read false while a smaller request would still be admitted.
````

7. Replace

```markdown
  missing", **422** "the run file could not be read" or "the manifest could not be read".

## Paper count and pool (Plan 21)

```

   with

```markdown
  missing", **422** "the run file could not be read" or "the manifest could not be read".

### Search sources (Plan 23d)

The console page `/admin/sources` turns each search source off or on. The sources are a third kind of the versioned
documents above (`kind` `sources`, same table, rules, history, restore, reset, 409 and audit), so the routes are the
settings ones with `sources` in place of `settings`:

| Method and path | Success | Errors |
|---|---|---|
| `GET /admin/sources` | 200 `{source, version, sources: [{id, label, kind, env, enabled, overridden}], extras, error, loaded}` | 401, 403 |
| `POST /admin/sources/validate` `{sources?}` | 200 `{ok, errors, warnings, document, enabled}`; nothing is saved | 401, 403, 422 |
| `POST /admin/sources` `{sources, base_version, note?}` | 201 the new version plus `workers_notified` | 401, 403, 409, 422 |
| `GET /admin/sources/versions`, `GET /admin/sources/versions/{version}`, `POST /admin/sources/versions/{version}/restore`, `POST /admin/sources/reset` | as for settings | as for settings |

- **The nine sources.** `pubmed`, `europepmc`, `openalex`, `semantic_scholar`, `crossref`, `arxiv`, `doaj` and
  `openaire` (`kind` `searxng`, each one SearXNG engine) and `thaijo` (`kind` `direct`, the ThaiJO client). Their
  default (`env`) comes from the environment: a SearXNG source is on when its engine is in `SEARXNG_ENGINES`, ThaiJO
  when `THAIJO_ENABLED` is true. Engines in `SEARXNG_ENGINES` that are not in the list (an opted-in `plos`) are kept,
  listed in `extras` and cannot be toggled.
- **Document.** `{"sources": {id: true|false}}` holding only the sources that differ from the environment (entries
  equal to it are dropped on save, so a later env change still applies to the others); reset appends
  `{"sources": {}}`. A saved version wins over the environment in both directions: it can turn ThaiJO on while
  `THAIJO_ENABLED=false`. The history's `changes` read `{id: "env → off"}`; audit actions are
  `sources.save|restore|reset` with `target_type` `sources`.
- **Rules.** An unknown id is a 422 with field `sources` ("unknown source"; the key is never repeated); a value that
  is not `true` or `false` is a 422 with field `sources.<id>`. At least one SearXNG source must stay on (ThaiJO alone
  gives at most 1/8 of the pool, and paper search uses SearXNG only). Warnings: PubMed and Europe PMC both off; Europe
  PMC off (its RCT search for meta-analyses is off too); ThaiJO on while `THAIJO_ENABLED=false`.
- **Europe PMC.** Its switch covers the SearXNG `europe pmc` engine and the direct Europe PMC RCT searches of
  meta-analyses (they find candidates). The abstract and metadata enrichment, the citation network's reference lists
  and the OpenAlex citation lookup are not searches and stay on.
- **When a save takes effect.** As for settings: API processes within 5 seconds (`/status` → `sources`, the cache key,
  paper search), workers at the next review start or within 30 seconds. A review keeps the sources it started with;
  `mra:llm:loaded` entries gain `sources` (the version each worker runs, `"env"` while none is saved). The Redis mirror
  is `mra:sources:active`.
- `error` in `GET /admin/sources` is null unless the version in use leaves no SearXNG source on under the current
  environment (an env change after the save); env's engines are then searched until a version that turns one on is
  saved. A stored entry that no longer validates is skipped; neither ever answers 500.

## Paper count and pool (Plan 21)

```

8. Replace

```markdown
## ThaiJO source (Plan 24)

- **On by default** since 2026-10-13 (the owner's decision). `THAIJO_ENABLED=false` (env only, read by the API for the
  cache key and by the workers for the search) turns it off; otherwise Thai Journals Online (TCI) is added to every
  review's search. TCI's search API is undocumented and has no published terms: writing to TCI for permission or rate
  guidance is recommended, not a precondition.
```

   with

```markdown
## ThaiJO source (Plan 24)

- **On by default** since 2026-10-13 (the owner's decision). `THAIJO_ENABLED=false` turns it off; since Plan 23d the
  admin console's sources version (`/admin/sources`) wins over the flag in both directions; otherwise Thai Journals Online (TCI) is added to every
  review's search. TCI's search API is undocumented and has no published terms: writing to TCI for permission or rate
  guidance is recommended, not a precondition.
```

9. Replace

```markdown
| Tool | Returns | Notes |
|---|---|---|
| `search_papers(query, limit=10)` | `{query, papers: [{title, authors (≤6), year, journal, doi, pmid, pmcid, url, is_open_access, abstract (first 600 chars)}]}` | Searches the same eight engines as reviews (never ThaiJO). `limit` is clamped to 1–25. Shares the paper-search limit |
| `start_review(topic, language="th", max_papers=30, review_type="slr", study_types=None, year_from=None, mode="full")` | `{review_id, status, cached, status_url}`; for a topic that reads as an emergency `{review_id: null, status: "refused", code: "emergency", kind, hotlines, message, message_th}` (Plan 26) | `topic`: up to 600 characters. `max_papers`: clamped into 5–50 (not rejected; default 30). `review_type`: `narrative`, `slr`, `scoping` or `meta_analysis`; an unknown value is a tool error. `study_types`: the canonical names above or `"Other: <text>"`, normalised as in REST. `year_from`: 1950–2100. `mode` (Plan 27): `full` or `quick`; with `quick` the service sets the type and both sizes. Capacity errors include the reason and the wait time |
| `quick_answer(topic, language="th", study_types=None, year_from=None, wait_seconds=60)` | `{review_id, status, cached, status_url}` plus, once done, `{answer, closing, certainty, papers_read, references: [{n, ref, citation, links: [{label, url}]}]}`; still running: `message`; ended otherwise: `error`, `refusal_code`; an emergency: the `refused` result of `start_review` | Plan 27. Starts (or reuses) a quick answer and waits up to `wait_seconds` (0–90) for it, checking every 2 s. `answer` has the `[Pn]` groups renumbered `[1]…[n]` by first citation; `references[n-1]` is reference `[n]`, with links to doi.org, PubMed, PubMed Central or ThaiJO. One review against the same limits as `start_review` |
```

   with

```markdown
| Tool | Returns | Notes |
|---|---|---|
| `search_papers(query, limit=10)` | `{query, papers: [{title, authors (≤6), year, journal, doi, pmid, pmcid, url, is_open_access, abstract (first 600 chars)}]}` | Searches the SearXNG engines reviews use (`GET /api/v1/status` → `sources`; never ThaiJO). `limit` is clamped to 1–25. Shares the paper-search limit |
| `start_review(topic, language="th", max_papers=30, review_type="slr", study_types=None, year_from=None, mode="full")` | `{review_id, status, cached, status_url}`; for a topic that reads as an emergency `{review_id: null, status: "refused", code: "emergency", kind, hotlines, message, message_th}` (Plan 26) | `topic`: up to 600 characters. `max_papers`: clamped into 5–50 (not rejected; default 30). `review_type`: `narrative`, `slr`, `scoping` or `meta_analysis`; an unknown value is a tool error. `study_types`: the canonical names above or `"Other: <text>"`, normalised as in REST. `year_from`: 1950–2100. `mode` (Plan 27): `full` or `quick`; with `quick` the service sets the type and both sizes. Capacity errors include the reason and the wait time |
| `quick_answer(topic, language="th", study_types=None, year_from=None, wait_seconds=60)` | `{review_id, status, cached, status_url}` plus, once done, `{answer, closing, certainty, papers_read, references: [{n, ref, citation, links: [{label, url}]}]}`; still running: `message`; ended otherwise: `error`, `refusal_code`; an emergency: the `refused` result of `start_review` | Plan 27. Starts (or reuses) a quick answer and waits up to `wait_seconds` (0–90) for it, checking every 2 s. `answer` has the `[Pn]` groups renumbered `[1]…[n]` by first citation; `references[n-1]` is reference `[n]`, with links to doi.org, PubMed, PubMed Central or ThaiJO. One review against the same limits as `start_review` |
```

**Edit** `README.md` (2 replacements; each `old` occurs exactly once):

1. Replace

```markdown
Plan 24 adds Thai Journals Online (TCI) as a search source for Thai health studies: English abstracts only, at most
15 candidates (and at most 1/8 of the pool), soft-failing, never PDFs or article pages. It is on by default since
2026-10-13 (the owner's decision); set `THAIJO_ENABLED=false` in `.env` to turn it off. Writing to TCI about the use
is recommended (its search API is undocumented). Details: "ThaiJO source (Plan 24)" in `docs/api.md`.

```

   with

```markdown
Plan 24 adds Thai Journals Online (TCI) as a search source for Thai health studies: English abstracts only, at most
15 candidates (and at most 1/8 of the pool), soft-failing, never PDFs or article pages. It is on by default since
2026-10-13 (the owner's decision); set `THAIJO_ENABLED=false` in `.env` to turn it off, or turn it off at
`/admin/sources` (a saved version there wins over the env value). Writing to TCI about the use
is recommended (its search API is undocumented). Details: "ThaiJO source (Plan 24)" in `docs/api.md`.

```

2. Replace

```markdown
  Models: change presets and per-role models at `/admin/models`; each save is a version you can restore; workers pick it up within 30 seconds.
  Settings, glossary and harness: change limits and the Thai glossary at `/admin/settings` and `/admin/glossary` (versioned, restorable, live within 30 seconds); read and compare Cochrane harness reports and start a capped run at `/admin/harness` (`docker compose --profile harness up -d harness`).
- **Webhooks:** `POST /api/v1/reviews` with `"callback_url": "https://..."` (key required, HTTPS public host).
  When the review ends (done, error, rejected or cancelled) we POST `{"review_id","status","result_url"}` (up to 3
```

   with

```markdown
  Models: change presets and per-role models at `/admin/models`; each save is a version you can restore; workers pick it up within 30 seconds.
  Settings, glossary and harness: change limits and the Thai glossary at `/admin/settings` and `/admin/glossary` (versioned, restorable, live within 30 seconds); read and compare Cochrane harness reports and start a capped run at `/admin/harness` (`docker compose --profile harness up -d harness`).
  Search sources: turn each of the eight SearXNG engines and ThaiJO off or on at `/admin/sources` (versioned, restorable, live within 30 seconds; a running review keeps its sources; `GET /api/v1/status` lists the ones in use).
- **Webhooks:** `POST /api/v1/reviews` with `"callback_url": "https://..."` (key required, HTTPS public host).
  When the review ends (done, error, rejected or cancelled) we POST `{"review_id","status","result_url"}` (up to 3
```

**Edit** `.env.example` (1 replacement; each `old` occurs exactly once):

1. Replace

```
CORE_API_KEY=
# SearXNG engines the backend queries (names from infra/searxng/settings.yml). Default below; append ",plos" to opt in
# to PLOS (10 req/min, 300/h budget). The web UI's source list always shows the default engines.
# SEARXNG_ENGINES=pubmed,europe pmc,openalex,semantic scholar,crossref,arxiv,doaj,openaire
# ThaiJO (Thai Journals Online, Plan 24): Thai health journals as an extra source. ON by default since 2026-10-13 (owner's
# decision); set THAIJO_ENABLED=false to turn it off. TCI's search API is undocumented: a letter to TCI is recommended.
# At most 15 candidates per review (and at most 1/8 of the pool); abstracts and OAI records cached 7 days in Redis.
# THAIJO_ENABLED=false
```

   with

```
CORE_API_KEY=
# SearXNG engines the backend queries (names from infra/searxng/settings.yml). Default below; append ",plos" to opt in
# to PLOS (10 req/min, 300/h budget). The admin console (/admin/sources) can turn each engine off or on; a saved version
# there wins over this list, and the web UI's source list follows GET /api/v1/status.
# SEARXNG_ENGINES=pubmed,europe pmc,openalex,semantic scholar,crossref,arxiv,doaj,openaire
# ThaiJO (Thai Journals Online, Plan 24): Thai health journals as an extra source. ON by default since 2026-10-13 (owner's
# decision); set THAIJO_ENABLED=false to turn it off (/admin/sources in the console wins over this flag). TCI's search API
# is undocumented: a letter to TCI is recommended.
# At most 15 candidates per review (and at most 1/8 of the pool); abstracts and OAI records cached 7 days in Redis.
# THAIJO_ENABLED=false
```

**Edit** `docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md` (1 replacement; each `old` occurs exactly once):

1. Replace

```markdown
|---|---|---|
| 22 | Evaluation baseline and a **Cochrane benchmark** (frozen fixtures that replay without network calls; study-level recall, direction and certainty agreement, number-verification rate, citation precision). Split into **22a** (the harness and the metrics that need no gold standard, including Thai share, glossary consistency, numbers preserved and cost) and **22b** (gold standard: LLM extracts, a human checks). Spec: `../specs/2026-10-11-plan-22-cochrane-benchmark-design.md`. **22a done (2026-10-12):** harness merged; 60-review manifest (checked by Claude on the owner's delegation, see PROTOCOL deviations) and pool v1 frozen; a 12-review pilot ran (24 runs, 0 failed, $1.83, `backend/evals/cochrane/reports/2026-10-11.1-pilot.md`). Baseline (owner's $5 cap): the first 5 eligible reviews per stratum x 2 (60 runs, 0 failed, $3.90; verification 89.6%, glossary 97.0%, primary-outcome verdict stable in 80% of pairs), `backend/evals/cochrane/reports/2026-10-11.1-baseline.md` | Measures every later change; publishable on its own |
| 23 | **Admin console** (section 6b): username + password login, a dashboard, LLM model management with live reload, reviews and cost, API keys and runtime settings, the glossary editor, and harness results. **23a done (2026-10-12):** sign-in (argon2id, Redis sessions, lockout), dashboard, reviews, API keys and the audit log; spec ../specs/2026-10-12-plan-23a-admin-console-design.md. **23b done (2026-10-12):** model management in the admin console (versions in the DB, live reload, catalog, test call). **23c done (2026-10-13):** runtime settings and the Thai glossary as versioned documents read live by every process, and the harness page (reports, compare, capped runs on an opt-in worker, ceiling $5). | From here on every plan can be configured and measured from one place |
| 24 | **ThaiJO source** (section 7). **Built (2026-10-13); on by default since 2026-10-13 (owner's decision):** search, detail and OAI-PMH client, at most 15 candidates (1/8 of the pool), soft-fail, "ThaiJO" in the report and PRISMA; `THAIJO_ENABLED=false` turns it off; the letter to TCI is recommended, no longer blocking. Measuring it on the 22a harness needs a new pool version (a paid batch, the owner's call). Spec: `../specs/2026-10-13-plan-24-thaijo-source-design.md` | Cheap, adds Thai evidence, measured by Plan 22 |
| 25 | Sentence-support grounding, a "why this source was cited" view, and a per-citation "ตรวจแล้ว" badge (goes beyond Evidence Finder's Verify). **Built (2026-10-13):** candidates chosen in code from the cited abstract, one judge call per review on the screener's model (soft-fail, budget-aware), the badge only when supported with verified numbers, the rail's "ทำไมจึงอ้างอิงงานนี้", and two harness rows (support rate, badge share); `prompt_version` 2026-10-13.1. Measuring it on real reviews is a paid batch, the owner's call. Spec: `../specs/2026-10-13-plan-25-sentence-support-design.md` | Safety for every audience; publishable |
```

   with

```markdown
|---|---|---|
| 22 | Evaluation baseline and a **Cochrane benchmark** (frozen fixtures that replay without network calls; study-level recall, direction and certainty agreement, number-verification rate, citation precision). Split into **22a** (the harness and the metrics that need no gold standard, including Thai share, glossary consistency, numbers preserved and cost) and **22b** (gold standard: LLM extracts, a human checks). Spec: `../specs/2026-10-11-plan-22-cochrane-benchmark-design.md`. **22a done (2026-10-12):** harness merged; 60-review manifest (checked by Claude on the owner's delegation, see PROTOCOL deviations) and pool v1 frozen; a 12-review pilot ran (24 runs, 0 failed, $1.83, `backend/evals/cochrane/reports/2026-10-11.1-pilot.md`). Baseline (owner's $5 cap): the first 5 eligible reviews per stratum x 2 (60 runs, 0 failed, $3.90; verification 89.6%, glossary 97.0%, primary-outcome verdict stable in 80% of pairs), `backend/evals/cochrane/reports/2026-10-11.1-baseline.md` | Measures every later change; publishable on its own |
| 23 | **Admin console** (section 6b): username + password login, a dashboard, LLM model management with live reload, reviews and cost, API keys and runtime settings, the glossary editor, and harness results. **23a done (2026-10-12):** sign-in (argon2id, Redis sessions, lockout), dashboard, reviews, API keys and the audit log; spec ../specs/2026-10-12-plan-23a-admin-console-design.md. **23b done (2026-10-12):** model management in the admin console (versions in the DB, live reload, catalog, test call). **23c done (2026-10-13):** runtime settings and the Thai glossary as versioned documents read live by every process, and the harness page (reports, compare, capped runs on an opt-in worker, ceiling $5). **23d built (2026-10-13):** each search source (eight SearXNG engines and ThaiJO) on or off at `/admin/sources`, a versioned document like the settings (env stays the default, a saved version wins), `/status` lists the sources in use, and the cache key carries the engine set once a version changes it; spec ../specs/2026-10-13-plan-23d-source-toggles-design.md. | From here on every plan can be configured and measured from one place |
| 24 | **ThaiJO source** (section 7). **Built (2026-10-13); on by default since 2026-10-13 (owner's decision):** search, detail and OAI-PMH client, at most 15 candidates (1/8 of the pool), soft-fail, "ThaiJO" in the report and PRISMA; `THAIJO_ENABLED=false` turns it off; the letter to TCI is recommended, no longer blocking. Measuring it on the 22a harness needs a new pool version (a paid batch, the owner's call). Spec: `../specs/2026-10-13-plan-24-thaijo-source-design.md` | Cheap, adds Thai evidence, measured by Plan 22 |
| 25 | Sentence-support grounding, a "why this source was cited" view, and a per-citation "ตรวจแล้ว" badge (goes beyond Evidence Finder's Verify). **Built (2026-10-13):** candidates chosen in code from the cited abstract, one judge call per review on the screener's model (soft-fail, budget-aware), the badge only when supported with verified numbers, the rail's "ทำไมจึงอ้างอิงงานนี้", and two harness rows (support rate, badge share); `prompt_version` 2026-10-13.1. Measuring it on real reviews is a paid batch, the owner's call. Spec: `../specs/2026-10-13-plan-25-sentence-support-design.md` | Safety for every audience; publishable |
```

**Edit** `backend/tests/unit/test_api_docs_limits.py` (1 replacement; each `old` occurs exactly once):

1. Replace

```python


def test_the_docs_name_the_current_prompt_version():
    from app.config import Settings
```

   with

```python


def test_status_example_lists_the_sources_in_catalog_order():
    # Plan 23d: the documented default (eight engines and ThaiJO) is the service's own catalog
    from app.services.sources import BY_ID, SOURCE_IDS
    sources = _status_example()["sources"]
    assert [s["id"] for s in sources] == list(SOURCE_IDS)
    assert all(s["label"] == BY_ID[s["id"]].label for s in sources)


def test_the_docs_name_the_current_prompt_version():
    from app.config import Settings
```

Then run: `cd /d/MRA-plan-23d/backend && uv run pytest tests/unit/test_api_docs_limits.py tests/unit/test_openapi_docs.py -q`

Expected: 9 passed. (never write a range like "5–30" in new text: `test_docs_have_no_stale_paper_counts` reads it as an old paper count).

- [ ] **Step 2: Final checks on the branch**

Run: `cd /d/MRA-plan-23d/backend && uv run pytest -q && uv run ruff check .`
Run: `cd /d/MRA-plan-23d/frontend && npm test && npm run typecheck && npm run lint && npm run e2e`

Expected: all pass (pre-flight: backend 2588 passed, 17 skipped, ruff clean; frontend 154 files, 1642 tests, typecheck and eslint clean; e2e 458 passed, 1 skipped (Task 5's run; Task 6 changes no frontend file)). Integration tests are unchanged by this plan; run them only if Postgres is up (`MRA_INTEGRATION=1 uv run pytest -m integration -q`) and report the result or why they were not run.

- [ ] **Step 3: Commit**

Write the message with the Write tool to `D:\MRA-plan-23d\.superpowers\commit-msg.txt` (git-ignored), then commit:

```text
docs(sources): API reference, README, .env.example and roadmap 23d built (Plan 23d)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
```

```bash
cd /d/MRA-plan-23d && git add docs/api.md README.md .env.example docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md backend/tests/unit/test_api_docs_limits.py
git commit -F .superpowers/commit-msg.txt
```

---

## After the plan (controller)

Not part of any task: the controller does these after the whole-branch review, in its own session.
- **Merge** `plan-23d-sources` into master with `--no-ff`. The main worktree's uncommitted owner entries (for example
  `infra/searxng/limiter.toml.new`) are never staged or changed.
- **Root `CLAUDE.md`:** add the convention line to the committed file only (the owner may have working-tree edits):

```text
- Search sources (Plan 23d): the nine sources (eight SearXNG engines, ThaiJO; `app/services/sources.py`) are a third versioned kind in `config_versions` (`sources`, `app/services/sources_store.py`, mirror `mra:sources:active`): a sparse `{sources: {id: bool}}` of where they differ from `SEARXNG_ENGINES`/`THAIJO_ENABLED`, winning over env both ways, at least one SearXNG source on; the API reads them through `ReviewService.sources()` (5 s) and workers put them in `GraphDeps.sources` (a review keeps its set; Europe PMC off also stops its RCT search, never enrichment). No version → the cache key is unchanged; with one, `+thaijo` follows the set and `+src<sha256[:8] of the sorted engines>` marks an engine set that differs from env. `/status` `sources` is the public list (the web falls back to the static eight).
```

- **Docker rebuild and the smoke check, spending nothing.** No review is started and no LLM is called; one paper
  search goes through SearXNG to the public engines (free). The script signs in as the existing `smoke` admin (23c),
  saves a version turning OpenAIRE off, watches `/status` and the workers follow it, checks that no paper-search hit
  came from OpenAIRE, resets, then deletes the smoke rows and the mirror so the owner sees "ใช้ค่าจาก env" (as after
  the 23b and 23c smokes), and disables the smoke admin. Write it with the Write tool to
  `D:\MedicalReviewerAgent\.superpowers\smoke23d.sh` (git-ignored; no heredoc), run it with `bash`, then delete it.

```bash
cd /d/MedicalReviewerAgent && docker compose build migrate web && docker compose up -d
docker compose ps                                     # api healthy, worker up, searxng healthy
bash .superpowers/smoke23d.sh && rm .superpowers/smoke23d.sh
```

```bash
#!/usr/bin/env bash
# Plan 23d docker smoke check through Caddy. Spends nothing: no review is started and no LLM is called. One paper
# search goes through SearXNG to the public engines (free, no key needed).
set -u
cd /d/MedicalReviewerAgent
JAR=.superpowers/smoke23d.jar; rm -f "$JAR"
B=http://localhost:8088/api/v1
W=(-b "$JAR" -H "X-MRA-Admin: 1" -H "Content-Type: application/json")
py() { python -c "import json,sys; d=json.load(sys.stdin); $1"; }

PW="smoke-$(openssl rand -hex 12)"
docker compose exec -T api python -m app.cli.admin enable smoke
printf '%s\n' "$PW" | docker compose exec -T api python -m app.cli.admin passwd smoke --password-stdin
curl -s -o /dev/null -w "sign-in %{http_code}\n" -c "$JAR" -H "X-MRA-Admin: 1" -H "Content-Type: application/json" \
  -d "{\"username\":\"smoke\",\"password\":\"$PW\"}" $B/admin/session
unset PW

echo "== state"; curl -s -b "$JAR" $B/admin/sources | py "print(d['source'], d['version'], [s['id'] for s in d['sources'] if s['enabled']], d['error'])"
echo "== status before"; curl -s $B/status | py "print(' '.join(s['id'] for s in d['sources']))"
echo "== save openaire off"
curl -s "${W[@]}" -d '{"sources":{"openaire":false},"base_version":null,"note":"smoke check 23d"}' $B/admin/sources \
  | py "print(d['version'], d['changes'], d['workers_notified'])"
sleep 6; echo "== status after save"; curl -s $B/status | py "print(' '.join(s['id'] for s in d['sources']))"
sleep 30; echo "== workers"; curl -s -b "$JAR" $B/admin/sources | py "print([(w['sources'], w['runtime_error']) for w in d['loaded']])"
echo "== paper search"
curl -s "$B/papers/search?q=metformin%20colorectal%20cancer&limit=25" \
  | py "print('papers', len(d) > 0, 'openaire hits', sum('openaire' in p['engines'] for p in d))"
echo "== reset"
curl -s "${W[@]}" -d '{"base_version":1,"note":"smoke check 23d reset"}' $B/admin/sources/reset | py "print(d['version'], d['source'])"
sleep 6; echo "== status after reset"; curl -s $B/status | py "print(' '.join(s['id'] for s in d['sources']))"
echo "== cleanup"
docker compose exec -T postgres psql -U mra -d mra -c "DELETE FROM config_versions WHERE kind = 'sources'"
docker compose exec -T redis redis-cli DEL mra:sources:active
docker compose exec -T api python -m app.cli.admin disable smoke
rm -f "$JAR"
sleep 35; echo "== workers back on env"; docker compose exec -T redis redis-cli HVALS mra:llm:loaded | grep -o '"sources": *"[^"]*"' | sort -u
echo "== done"
```

Expected (ThaiJO on by default; no sources version saved before the smoke):
- `sign-in 204`;
- `== state`: `env None ['pubmed', 'europepmc', 'openalex', 'semantic_scholar', 'crossref', 'arxiv', 'doaj', 'openaire', 'thaijo'] None`;
- `== status before`: `pubmed europepmc openalex semantic_scholar crossref arxiv doaj openaire thaijo`;
- `== save openaire off`: `1 {'openaire': 'env → off'} True`;
- `== status after save`: the same list without `openaire`;
- `== workers`: `('1', None)` for every worker;
- `== paper search`: `papers True openaire hits 0` (`papers False` only when the public engines did not answer; then
  rerun that line);
- `== reset`: `2 reset`, and `== status after reset` lists `openaire` again;
- `== cleanup`: `DELETE 2`, `(integer) 1`, and `== workers back on env`: `"sources": "env"` only.

- **Record:** remove the worktree (keep the branch) and update the memory notes: Plan 23d merged; `/admin/sources`
  toggles the nine search sources; the smoke left no sources version (env in force).
