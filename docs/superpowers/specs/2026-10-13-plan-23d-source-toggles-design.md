# Plan 23d: search source toggles in the admin console — design (2026-10-13)

**สรุปภาษาไทย:** Plan 23d เพิ่มหน้า `/admin/sources` ให้ผู้ดูแลเปิดหรือปิดแหล่งค้นได้ทีละแหล่ง เก้าแหล่ง ได้แก่ PubMed,
Europe PMC, OpenAlex, Semantic Scholar, Crossref, arXiv, DOAJ, OpenAIRE (ผ่าน SearXNG) และ ThaiJO (เรียกตรง) การบันทึกแต่ละครั้ง
เป็นเวอร์ชันใหม่ในตาราง `config_versions` เดิมของ 23c (`kind` = `sources`) มีประวัติ ย้อนกลับได้ และบันทึกลง audit เหมือนหน้า
ตั้งค่าและอภิธานศัพท์ ค่าใน env (`SEARXNG_ENGINES`, `THAIJO_ENABLED`) ยังเป็นค่าตั้งต้น เวอร์ชันที่บันทึกในหน้านี้ชนะ env และเก็บ
เฉพาะแหล่งที่ต่างจาก env API ใช้ค่าใหม่ภายใน 5 วินาที worker ใช้ตอนเริ่มรีวิวถัดไปหรือภายใน 30 วินาที รีวิวหนึ่งใช้ชุดแหล่งเดียว
ตลอด ต้องเปิดแหล่งที่ผ่าน SearXNG ไว้อย่างน้อยหนึ่งแหล่ง (ThaiJO อย่างเดียวไม่พอ เพราะถูกจำกัดไว้ที่ 1/8 ของ pool) และระบบเตือน
เมื่อปิดทั้ง PubMed และ Europe PMC การปิด Europe PMC ปิดการค้น RCT ของ Europe PMC ด้วย แต่การเติมข้อมูลบทความและเครือข่าย
การอ้างอิงยังทำงาน การค้นบทความ (`/papers/search`, MCP `search_papers`) ใช้ชุดแหล่งเดียวกัน cache ผลรีวิวแยกตามชุดแหล่งที่ใช้
จริง ตราบที่ยังไม่บันทึกเวอร์ชันใด key เหมือนเดิมทุกตัวอักษร `/api/v1/status` บอกรายชื่อแหล่งที่เปิดอยู่ และหน้าแรกกับหน้า
นักพัฒนาแสดงรายชื่อจากตรงนั้น ไม่มีการแก้ prompt จึงไม่เปลี่ยน `prompt_version` ไม่ต้องมี migration และไม่มีอะไรที่ใช้เงิน

Context: `docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md` section 6b (row 23) and the owner's request of
2026-10-13 ("admins can enable or disable each search source"). Plan 23c (`config_versions`, `config_store`,
`RuntimeConfig`, the worker reload hook `app/worker/runtime_reload.py`, the versioned admin pages) and Plan 24 (ThaiJO,
on by default since 2026-10-13) are merged; the base is master `83196cc`. Plan 27 (quick answer mode) merges to master
before 23d's implementation plan is written, so 23d rebases on it (section 10). The owner told Claude to run the roadmap
plans end to end without approval gates, so Claude stood in for the brainstorming dialogue and made the decisions in
section 2.

## 1. Goal, success and scope

**Goal.** When a source misbehaves (slow, down, rate-limited, returning junk) or the owner wants to change what the
service searches, an admin turns it off or on from the console, sees the effect before saving, can undo it, and never
edits `.env` or restarts a container.

**Success for 23d:**
- `/admin/sources` lists the nine sources with their env default, the state in force and what each one covers. A save
  is validated, becomes a new version, is audited and can be restored. "กลับไปใช้ค่า env" appends a version with no
  overrides.
- Every API process uses a saved version within 5 seconds and every worker at its next job start or within 30 seconds,
  with no restart. A review keeps the sources it started with.
- A review's search asks only the enabled SearXNG engines (one `engines=` parameter) and asks ThaiJO only while ThaiJO
  is enabled. `/api/v1/papers/search` and the MCP `search_papers` tool ask the same SearXNG engines.
- `GET /api/v1/status` lists the enabled sources; the landing page's source band and the developers page read that
  list and fall back to today's static list when `/status` is unreachable.
- While no sources version exists, behaviour, the result cache key and every existing test are unchanged.

**Out of scope:**
- Per-review source choice by end users (no new public input on REST or MCP).
- Per-engine tuning: weights, timeouts, page counts, the ThaiJO share cap.
- New sources. PLOS stays an env opt-in (`SEARXNG_ENGINES`), shown read-only (section 4.1).
- The Europe PMC lookups that are not searches (abstract enrichment by DOI/PMID, the citation network's references) and
  the OpenAlex citation lookup: they fetch metadata for papers already found, so they stay on whatever the toggles say.
- Re-freezing or re-running Cochrane pools (the owner declined paid evals).

## 2. Decisions (Claude, on the owner's standing instruction, 2026-10-13)

| Topic | Decision |
|---|---|
| Store | A third kind in 23c's `config_versions`: `kind` = `sources`, through `config_store` (linear versions, `base_version` 409, the shared advisory lock, audit `sources.save\|restore\|reset` in the same transaction, restore and reset append copies, the forward-only Redis mirror, `reconcile_mirror`). The column is `varchar(16)` with no check constraint, so no migration |
| Document | Sparse overrides `{sources: {id: bool}}`, as 23c's settings are `{values: {...}}`. A source not in it follows env, so an env change still applies to it. Validation drops entries equal to the env default, so the stored document is exactly "where this differs from env". Reset appends `{sources: {}}` |
| Catalog | Nine fixed ids in code (`app/services/sources.py`): `pubmed`, `europepmc`, `openalex`, `semantic_scholar`, `crossref`, `arxiv`, `doaj`, `openaire` (each maps to its SearXNG engine name, e.g. `europepmc` → `europe pmc`) and `thaijo` (the direct client). Ids are slugs so error fields read `sources.semantic_scholar` |
| Env default | A SearXNG source is on by default when its engine is in `SEARXNG_ENGINES`; ThaiJO when `THAIJO_ENABLED` is true. Engines in `SEARXNG_ENGINES` outside the catalog (today only an opted-in `plos`) are kept as they are, shown read-only on the page, and cannot be toggled |
| Precedence | A saved version wins over env in both directions: it can turn ThaiJO on while `THAIJO_ENABLED=false` and off while it is true. The admins are the owner's people, and Plan 24's TCI caution was settled by the owner's decision to turn ThaiJO on |
| Minimum (departs from the brief) | At least one SearXNG source must stay on (an error, not a warning), not merely "one source". ThaiJO alone would give at most `min(15, candidate_limit // 8)` candidates, and paper search uses only SearXNG, so a ThaiJO-only set would leave paper search with no engine |
| Warnings | PubMed and Europe PMC both off ("the two biomedical indexes are off; reviews will find far fewer clinical studies"); Europe PMC off ("the Europe PMC RCT search is off too"); ThaiJO on while `THAIJO_ENABLED=false` ("turns on calls to TCI that env had off") |
| Europe PMC toggle | Covers the SearXNG `europe pmc` engine and the direct Europe PMC RCT searches (Plan 20 Task 10: `search_trials`, `search_trial_names`), because both find candidates. Enrichment `lookup` and `references` stay on |
| ThaiJO client | In live mode the client is always built (construction does no I/O); the search node and the OAI-PMH step ask `deps.sources.thaijo`. `build_thaijo` no longer reads `thaijo_enabled` |
| One review, one set | The sources are part of the graph deps (`GraphDeps.sources`), as 23c's glossary is, so a running review keeps the set it started with. `quality` records the set on the search entry (`sources`: the enabled ids) |
| Cache key | While no sources version exists the key is today's: `+thaijo` when `THAIJO_ENABLED`. With a version, `+thaijo` follows the effective ThaiJO state, and `+src{h}` is added when the effective SearXNG engine set differs from env's, where `h` is the first 8 hex digits of sha256 over the sorted engine names joined by `,`. Restoring an older set returns to its old cache generation; turning ThaiJO off by console gives the same key as turning it off by env |
| Paper search | `/papers/search` and MCP `search_papers` pass the effective SearXNG engines per call. They stay off ThaiJO (Plan 24) |
| `/status` | A top-level `sources: [{id, label}]` of the enabled sources in catalog order, then env-only engines (label from a small map, `plos` → `PLOS`, else the engine name). Not under `limits`, which Plan 27 also extends |
| Public copy | The landing band and the developers page render the list from `/status` (60 s revalidate, as today) and fall back to the static eight when `/status` is unreachable. `/status` stays the only source of the count; no copy hard-codes "8 แหล่ง" |
| Admin page | Follows the 23c settings page (`useVersionedPage`, `DraftStatus`, `VersionHistory`, `WorkerVersions`, `useWorkerFollowUp`): draft on a base version, 409 keeps the draft, re-read while a worker lags. One switch per source instead of an override checkbox, because the stored document is derived from the difference to env |
| Workers | `runtime_reload` gains the third kind with 23c's rules: job start trusts the mirror, the 30 s poll reconciles from the DB, a change rebuilds deps and graph under `llm_lock`, a failure keeps the old state and reports `runtime_error`. The heartbeat entry in `mra:llm:loaded` gains `sources` |
| Evals | `freeze_engines` reads the effective sources (`load_runtime`); `--config-file` keeps env. Replays are unaffected (they start at screening) |
| Prompts | None change: `prompt_version` is not bumped and the SLR pins are untouched |

## 3. Data flow

```
admin page ──POST /admin/sources──► config_store.save_version(SOURCES_KIND) ──► config_versions row + admin_audit row
                                          │ publish (mirror mra:sources:active = {version, sources})
              ┌───────────────────────────┴───────────────────────────────┐
     API: RuntimeConfig.sources() (5 s)                      worker: refresh_runtime (job start / 30 s poll)
       ├─ ReviewService._version() → cache key                  └─ GraphDeps.sources → search node
       ├─ ReviewService.status() → /status sources                     ├─ SearXNG engines= (enabled engines)
       └─ paper search adapters → engines=                             ├─ Europe PMC RCT search (europepmc on)
                                                                       └─ ThaiJO search + OAI step (thaijo on)
```

## 4. Backend

### 4.1 Catalog and effective sources (`app/services/sources.py`, pure)
- `Source(id, label, kind, engine)`: `kind` is `searxng` or `direct`; `engine` is the SearXNG engine name or null.
  `SOURCES` holds the nine in the order of section 2 (the landing order), `SOURCE_IDS` their ids.
- `env_defaults(settings) -> dict[id, bool]` and `env_extras(settings) -> list[str]` (engines in `SEARXNG_ENGINES` the
  catalog does not know, in env order).
- `ActiveSources(version, enabled, engines, thaijo, extras)` (frozen): `version` None while the seed is in use;
  `enabled` the enabled catalog ids; `engines` the comma-joined SearXNG engine names (env's list in env order without
  the engines turned off, extras included, then the catalog engines env lacks that are turned on, in catalog order),
  exactly `settings.searxng_engines` when nothing is overridden;
  `thaijo` bool; `.label` `env` or the version. `has_europepmc` is a property.
- `effective_sources(base, overrides, version=None) -> ActiveSources`. An override naming an unknown id or holding a
  non-bool is skipped with a log line (a stored row that no longer validates). If the result has no SearXNG engine
  (an env change after the save), env's engines are used for SearXNG, the event is logged, and the API admin read
  reports it as `error`.
- `cache_part(active, base) -> str`: section 2's rule. `public_list(active) -> [{id, label}]`.

### 4.2 The document kind (`app/services/sources_store.py`)
- `validate_sources(raw, settings) -> (document, warnings)`: `raw` must be `{sources: {id: bool}}`; unknown ids and
  non-bool values are errors with fields `sources.<id>` (the message names the field and never echoes the submitted
  key or value; an unknown key is reported as `sources` with "unknown source"); at most 9 entries; the no-SearXNG-source
  error; section 2's warnings; entries equal to the env default are dropped.
- `summarize_sources(old, new)`: `{turned_on: [...], turned_off: [...]}` against the effective sets.
- `SOURCES_KIND = DocKind(name="sources", redis_key="mra:sources:active", validate=..., summarize=..., seed=lambda:
  {"sources": {}}, mirror=lambda d: {"sources": d.get("sources") or {}})`.

### 4.3 Propagation
- **`RuntimeConfig`:** `_fresh` reads the third mirror in the same guarded block; `sources()` returns the cached
  `ActiveSources` (env until known; the last known while Redis and the DB are down).
- **`load_runtime`:** `Runtime` gains `sources: ActiveSources`.
- **`ReviewService`:** `sources()` (env `effective_sources(self.settings, {})` when `runtime` is None). `_version()`
  replaces `if self.settings.thaijo_enabled: ... +thaijo` with `version += cache_part(await self.sources(),
  self.settings)`. `status()` adds `sources`.
- **Worker (`runtime_reload.py`):** `_wanted` returns three labels (`env` when no sources version); `init_runtime`
  stores `ctx["sources"]` and `ctx["sources_version"]`; `_rebuild` replaces `GraphDeps.sources`; `_PartialRead`
  generalises to the three kinds. `llm_reload`'s `build_graph_deps` call passes `sources=ctx["sources"]`, so a model
  reload keeps them. `report_state` adds `sources`.
- **Graph deps (`factory.py`, `graph.py`):** `build_graph_deps(..., sources=None)` stores `GraphDeps.sources`
  (env default when None); `build_thaijo` builds the client whenever `graph_mode` is live; screening's
  `thaijo_enabled` lambda becomes `deps.thaijo is not None and deps.sources.thaijo`.
- **Search node (`retrieval.py`):** `deps.searxng.search(q, pageno=page, engines=deps.sources.engines)` in the search
  and top-up paths; trial searches only when `deps.sources.has_europepmc`; ThaiJO only when `deps.sources.thaijo`. The
  search entry in `quality` gains `sources` (the enabled ids). `SearxngClient.search` takes an optional `engines`
  (the constructor's value when None, so other callers are unchanged).
- **Paper search:** `PaperSearch.search(query, limit, engines=None)`; the REST route and the MCP tool pass
  `(await service.sources()).engines`.
- **Evals:** `freeze_engines(active: ActiveSources)` returns the enabled engines plus `thaijo` when on; the freeze CLI
  builds deps with the loaded sources.

## 5. API

Admin routes (under `/api/v1/admin`, `require_admin`, hidden from OpenAPI, cookie writes need `X-MRA-Admin: 1`, audit
in the transaction), registered like 23c's:

| Method and path | What it does |
|---|---|
| `GET /sources` | `{source: db\|env, version, sources: [{id, label, kind, env, enabled, overridden}], extras: [engine], error, loaded}`; `error` is null unless the stored version could not be applied (section 4.1) |
| `GET /sources/versions`, `GET /sources/versions/{version}` | As for settings (`_history_routes(SOURCES_KIND)`) |
| `POST /sources/validate` | Body `{sources}` → `{ok, errors, warnings, document, enabled}`; nothing saved |
| `POST /sources` | `{sources, base_version, note?}` → 201 the version plus `workers_notified`; 409 stale base; 422 `{detail, errors}` |
| `POST /sources/versions/{version}/restore`, `POST /sources/reset` | As for settings; reset appends `{sources: {}}` |

Public: `GET /api/v1/status` gains `sources: [{id, label}]`. No new review option, MCP tool or tool argument. The
`search` entry of `result.quality` gains `sources`.

## 6. UI

- **Admin nav:** "แหล่งค้น" after "ตั้งค่า".
- **`/admin/sources`** (`SourcesView`, on the 23c shared helpers and `ui.ts` classes, Thai labels with English source
  names, no `confirm()`):
  - Header: "ใช้เวอร์ชัน N จาก DB" or "ใช้ค่าจาก env", each worker's sources version and `runtime_error`
    (`WorkerVersions` with `field="sources"`), and the `error` notice when set.
  - Two groups: "ผ่าน SearXNG" (eight rows) and "เรียกตรง" (ThaiJO). Each row: the source name, a switch
    (`role="switch"`, labelled by the name, 44 px target), "ค่า env: เปิด/ปิด", a "ต่างจาก env" tag when overridden,
    and one line on what it covers (Europe PMC: "รวม preprint medRxiv/bioRxiv และการค้น RCT"; ThaiJO: "ไม่เกิน 1/8 ของ
    pool"). Env-only extras are listed below, read-only, with "ตั้งใน `SEARXNG_ENGINES`".
  - "ตรวจ" shows errors and warnings; "บันทึกเป็นเวอร์ชันใหม่" with an optional note; the 409, discard and rebase
    flow, history (restore, reset), and the worker follow-up are the settings page's.
  - A note that a change starts a new cache generation for the sets it changes.
- **Landing (`capabilities.tsx`) and developers page:** `Capabilities` takes `sources` from the page's existing
  `getServerStatus()` call; the developers page's search line names the sources from `/status`. Both fall back to the
  static list. Follows DESIGN.md (no new component style; the band's list markup stays).

## 7. Failure modes

- **Redis down:** API keeps the last known set (env until known); workers keep theirs; saves still commit
  (`workers_notified: false`) and the 30 s poll repairs the mirror.
- **DB down at worker start:** env sources, `runtime_error` reported, poll retries (23c rule).
- **A stored row that no longer validates** (hand edit, a catalog id removed later): bad entries are skipped and
  logged; never a 500 on `/status` or the admin read.
- **Env change leaves no SearXNG engine:** env engines are used, logged, and the admin read shows `error`.
- **Every enabled SearXNG engine failing:** unchanged from today (search errors in `errors`, the review continues with
  what it has).
- **Two admins saving at once:** one wins, the other gets 409 with the draft kept.

## 8. Testing

Backend unit (sqlite, fakeredis, no network):
- `sources.py`: env defaults and extras, the engines string identical to env with no overrides, overrides both ways,
  skipped bad entries, the empty-SearXNG fallback, `cache_part` (seed state equals today's `+thaijo` rule; console off
  equals env off; `+src` stable under reordering), `public_list`.
- `sources_store`: validation (unknown id, non-bool, the minimum, warnings, dropping env-equal entries, no echo), the
  summary, save/restore/reset through `config_store` with audit rows.
- `RuntimeConfig.sources()` with Redis hit, miss and down; `load_runtime` with a sources row.
- Worker reload: a sources change rebuilds deps and keeps the old graph's set; a lost publish is picked up by the poll;
  `llm_reload` keeps the sources; the heartbeat carries `sources`.
- Search node: `engines=` passed in search and top-up; trial searches skipped with Europe PMC off; ThaiJO skipped with
  it off and called with it on while `thaijo_enabled` is false; the `quality` entry lists the ids.
- Cache key: seed state byte-identical (existing tests unchanged); with a version.
- Routes: each admin route, CSRF and `require_admin`, 409 and 422 shapes, hidden from OpenAPI; `/status` `sources`;
  paper search REST and MCP pass the engines.
- `tests/conftest.py` keeps ThaiJO pinned off through env; no test needs a real ThaiJO or SearXNG response.

Frontend: Vitest for `SourcesView` (toggle, validate with warnings, the minimum error, save, 409 with discard and rebase,
extras read-only, worker states) and for the landing band with and without `sources`; Playwright with a mocked admin
API for the flow, axe and layout at 1440 and 390 in both themes.

Docker smoke (spends nothing, `GRAPH_MODE=stub`): save a version turning OpenAIRE off, see `/status` drop it within 5 s
and the workers report the version within 30 s, run one paper search and see `engines=` without `openaire` in the
SearXNG log, then reset.

## 9. Docs

- `docs/api.md`: the admin routes; `/status` `sources`; the cache key's sources part; the Europe PMC toggle's reach;
  "Search" line (sources are configurable; `/status` is the list); the ThaiJO section's flag note (console wins);
  `search_papers` ("the enabled SearXNG engines").
- README: one line under the admin console bullet; `.env.example`: the `SEARXNG_ENGINES` and `THAIJO_ENABLED`
  comments say the console can override them, and drop "the web UI's source list always shows the default engines".
- Root `CLAUDE.md`: one convention line after the merge (sources document, precedence, `+src` cache part).
- Roadmap row 23: 23d done.

## 10. Rebasing on Plan 27

Plan 27 (quick answer mode: `options.mode`, `/status` `limits.quick` and `limits.modes`, `prompt_version`
`2026-10-13.3`, the cache key gains the mode) merges first. 23d's plan must be written against that master:
- **`/status`:** 23d adds the top-level `sources` beside Plan 27's `limits` changes; neither touches the other's keys.
  The `ServiceStatus` type in the frontend gains `sources` next to 27's fields.
- **Cache key (`ReviewService._version` / cache key build):** 23d's `cache_part` replaces the `+thaijo` line wherever
  27 leaves it; the mode part stays where 27 put it. Tests that pin full keys must be read after the rebase.
- **Search path:** if quick mode searches through its own node or page count, it must pass `deps.sources.engines` and
  honour the Europe PMC and ThaiJO switches the same way (one helper in `retrieval.py`, used by both).
- **`docs/api.md`:** 27 edits the status, cache and options sections; 23d's edits land after them.
- `prompt_version` is 27's; 23d does not change it.

## 11. Risks

- **An admin turns off the sources that matter.** The minimum rule, the PubMed/Europe PMC warning, restore in one
  click, and the env set stays the fallback.
- **Cache returns a result searched with other sources.** The key carries the effective ThaiJO state and a fingerprint
  of the SearXNG set.
- **Drift between processes.** At most 5 s on the API and 30 s on workers; a running review keeps its set.
- **Turning ThaiJO on from the console while env had it off.** A warning names it; the audit row records who did it.

## 12. Size

About 5 tasks: (1) catalog, effective sources and the document kind; (2) propagation: `RuntimeConfig`,
`load_runtime`, worker reload, graph deps, search node, paper search, evals; (3) cache key, `/status` and the admin
routes; (4) the admin page and nav; (5) landing and developers pages, docs and the smoke check.
