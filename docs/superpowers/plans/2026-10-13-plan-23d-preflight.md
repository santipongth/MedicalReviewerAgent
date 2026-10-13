# Plan 23d pre-flight scan (2026-10-13)

Plan: `docs/superpowers/plans/2026-10-13-plan-23d-source-toggles.md`. Spec:
`docs/superpowers/specs/2026-10-13-plan-23d-source-toggles-design.md` (`64849f9`). Base: master `8cccaee` (Plan 27
quick answer merged as `aaf7054`, its `CLAUDE.md` line `8cccaee`; `prompt_version` `2026-10-13.3`; ThaiJO on by
default, pinned off in `tests/conftest.py`).

**How it was checked.**
- Every interface the plan quotes from master was read in the code at `8cccaee`: the 23c document store
  (`config_store`, `runtime_settings`, `glossary_store`, `runtime_config`), the admin runtime routes and their helpers,
  `ReviewService` (`effective`, `_version`, `status`), the worker reload (`runtime_reload`, `llm_reload`), the graph deps
  and factory, the search and enrich nodes, `summarize_quality`, `SearxngClient`, `PaperSearch`, the REST and MCP paper
  search, the eval freeze and CLI, the test helpers it imports, and the frontend versioned-page helpers, `SettingsView`,
  `WorkerVersions`, `VersionHistory`, `adminApi`, the admin fetch mocks, `Capabilities`, the developers page,
  `getServerStatus` and the e2e `mockApi`.
- The spec's section 10 (rebasing on Plan 27) was resolved against the merged code, not assumed: Plan 27 keeps the
  mode in the stored options (`compute_cache_key`), not in `_version()`, so 23d only replaces the `+thaijo` line; the
  quick answer runs the same `search` and `enrich` nodes as a full review, so no second search path needs the
  switches; `/status` gains `sources` beside 27's `limits.modes`/`limits.quick`; 23d's `docs/api.md` edits land after
  27's.
- The code was written and made green in a scratch clone outside the repository
  (`%TEMP%\claude\…\scratchpad\p23dproto`, tags `t0` = `64849f9` … `t6`, one commit per task). The plan's code sections
  were rendered from it (new files whole; edits as replacement pairs whose `old` is unique in the file at that task's
  start). Then:
  - **Replay:** a fresh copy of `64849f9` (`p23dreplay`) received the tasks one by one from the rendered plan, test
    files first. Each task's tests were run before its code (to see them fail as the plan says), then after it, then
    ruff and the full backend suite, or the full frontend suite, typecheck and eslint and the task's e2e specs (Task 4:
    the four admin specs; Task 5: the whole e2e suite).
  - **Parse-back:** the final plan was parsed and every block applied to another fresh copy of `64849f9`
    (`p23dback`): 44 blocks, 44 files, mismatched: none. The replay copy matches `t6` on all touched files too (44 files, identical).
- No network call and no real LLM call was made. Backend dependencies came from the uv cache (`uv sync --offline`),
  frontend ones from the npm cache (`npm ci --offline`). The e2e runs used a copy of `playwright.config.ts` with port
  3123 (kept out of git), so they could not reuse a server another worktree runs on 3100.

## Task pairs that share a file or an interface

| Task A | Task B | A produces → B consumes | Finding | Fix |
|---|---|---|---|---|
| 1 | 2 | `effective_sources`, `ActiveSources`, `SOURCES_KIND` → `RuntimeConfig`, `load_runtime`, the worker reload, the search node | With no version the search must ask exactly what it asks today | With nothing differing from env the engines string is `SEARXNG_ENGINES` verbatim (`test_no_overrides_give_the_env_engines_string_exactly`) |
| 1 | 3 | `cache_part`, `public_list` → `ReviewService._version`, `status` | The key must not move without a version, and the existing test that flips `settings.thaijo_enabled` on the live service must keep passing | With no version `cache_part` reads `base.thaijo_enabled` itself (Plan 24's rule), not the cached set |
| 2 | existing graph and node tests | `GraphDeps.sources` | Dozens of tests build `GraphDeps` by hand with SearXNG fakes that take no `engines` argument | `sources=None` keeps the pre-23d behaviour (every client present is asked, no `engines=`); `build_graph_deps` always sets it |
| 2 | existing ThaiJO tests | `build_thaijo`, `freeze_engines` | The spec builds the ThaiJO client whatever `THAIJO_ENABLED` says, and the eval CLI test's deps carry no sources | `test_the_client_exists_only_when_enabled` becomes `test_the_client_is_built_whatever_thaijo_enabled_says`; `freeze_engines(deps)` falls back to env's set |
| 2 | 3 | `PaperSearch.search(..., engines=)` → the REST route and the MCP tool | The shared `Searx` fake took no `engines` | Task 2 lets the fake take and record it (`test_papers_and_report.py`); the routes pass it in Task 3 |
| 2 | worker ctx | `_PartialRead`, `_wanted`, `report_state` | 23c's reload compared two kinds | `_KINDS` lists three; the job-start MGET reads three mirrors; the heartbeat adds `sources` (existing reload tests unchanged) |
| 3 | 4 | the `/admin/sources` shapes → `SourcesState`, `SourcesReport`, the e2e fake | Types and fakes must mirror the routes | Fixtures and the e2e fake follow the route shapes; the draft sends the whole set and the server keeps only what differs from env |
| 3 | 5 | `/status` `sources` → `ServiceStatus.sources`, `Capabilities`, the developers page | Absent before 23d, and the e2e server cannot reach `/status` | `sourceLabels` falls back to the static eight (the e2e suite shows them as before) |
| 4 | `admin-gate.test.tsx` | the nav link list | The test pins the exact list | Task 4 adds "แหล่งค้น" after "ตั้งค่า" in the expected list |
| 4 | admin e2e specs | the nav gains a link | Link lookups by exact name | `admin-runtime`, `admin` and `admin-models` specs pass unchanged |
| 6 | `test_api_docs_limits.py` | the `/status` example | Docs could drift from the catalog | `test_status_example_lists_the_sources_in_catalog_order` |

## Each task against itself

| Task | Tests vs code; files created vs touched | Finding | Fix |
|---|---|---|---|
| 1 | 14 tests; 1 test file and 2 modules created | A stored document must never echo a submitted key (lone surrogates included) | Unknown keys are reported once as field `sources`, "unknown source" |
| 2 | 12 new tests, 2 rewritten, 1 fake extended; 1 test file created, 11 modules modified | A running review must keep its set while the worker reloads | The set lives in `GraphDeps`, replaced only on rebuild (`test_a_sources_change_rebuilds_deps_and_a_running_graph_keeps_its_set`) |
| 3 | 9 tests; 1 test file created, 4 modules modified | A stored version that no longer fits env (an env change, a hand edit) must not 500 | The admin read and `/status` skip bad entries and fall back to env's engines with `error` set |
| 4 | 6 unit tests, the nav test, 5 e2e tests (the flow, axe and overflow at 1440/390 in light and dark); 3 test files, 1 module and 1 page created, 4 modules modified | A refused save answered after further edits must still be shown | The settings page's latest-draft rule (the alert, not a hidden field error) |
| 5 | 5 new tests; 1 module and 1 test file created, 1 test file and 4 modules modified | No copy may hard-code the count | The count comes from the list; the `search_papers` row is count-free |
| 6 | 1 docs test | Consistent | — |

## Rulings (deviations from the spec)

1. **History summary.** `DocKind.summarize` gets no settings, so the effective sets of section 4.2 cannot be computed
   there. `summarize_sources` records each source that moved as `env → off`, `off → env`, `env → on` (the settings
   kind's format), which the history page and the audit log already show.
2. **`GraphDeps.sources` defaults to None** (deps built by hand ask every client present, as before 23d), while
   `build_graph_deps` always sets it (env's set when none is given), so production always runs on an explicit set and
   no existing test or fake changes behaviour.
3. **`freeze_engines(deps)`** instead of `freeze_engines(active)`: the eval tests build deps without sources, so the
   function takes the deps and falls back to env's set.
4. **`result.quality.sources`.** `result.quality` has no per-stage entry; the search entry in the state carries
   `sources` and `summarize_quality` copies it to a top-level `sources` key (absent in older results).
5. **"At most 9 entries"** is not a separate check: only the nine known ids are accepted, so a longer document is
   already refused as an unknown source.
6. **Public copy.** The developers page's `search_papers` row says "จากแหล่งที่ค้นผ่าน SearXNG" without a number
   (paper search never asks ThaiJO). The site footer and the live-stage satellites keep the static eight: the spec
   names only the landing band and the developers page.
7. **Smoke check.** The spec's "see `engines=` without `openaire` in the SearXNG log" relies on a log format that was
   not verified; the smoke instead counts paper-search hits whose `engines` include `openaire` (0 after the save). It
   also deletes the smoke's sources rows and mirror afterwards, as the 23b/23c smokes did.

## Results

Baseline (`64849f9`, same host): backend 2552 passed, 17 skipped; frontend 152 files, 1631 tests passed (no flaky timeout in this run).

| Task | Before its code | Its tests after | ruff / typecheck / eslint | Full suite |
|---|---|---|---|---|
| 1 | `ModuleNotFoundError: No module named 'app.services.sources'` (collection) | 14 passed | ruff clean | backend 2566 passed, 17 skipped |
| 2 | `ImportError: cannot import name 'thaijo_on'` (collection) | 31 passed | ruff clean | backend 2578 passed, 17 skipped |
| 3 | 8 failed, 1 passed (the unchanged-key test already holds) | 9 passed | ruff clean | backend 2587 passed, 17 skipped |
| 4 | `Failed to resolve import "./sources-view"`; the nav-list test failed | 2 files, 15 passed | clean / clean | frontend 153 files, 1637 tests; e2e admin specs 43 passed (1.0 min) |
| 5 | `Failed to resolve import "./search-sources"`; the ThaiJO band test failed | 2 files, 7 passed | clean / clean | frontend 154 files, 1642 tests; whole e2e suite 458 passed, 1 skipped (4.2 min) |
| 6 | — | docs tests 9 passed | ruff clean | backend 2588 passed, 17 skipped; frontend 154 files, 1642 tests |

## Commands run

| Where | Command | Result |
|---|---|---|
| proto | one commit and tag per task (`t0` = `64849f9` … `t6`) | — |
| replay, base | `uv run pytest -q`; `npx vitest run` | 2552 passed, 17 skipped; 152 files, 1631 tests passed (no flaky timeout in this run) |
| replay | `python replay23d.py plan.md p23dreplay <env> 1 6` | the table above |
| replay vs `t6` | `cmp` over the touched files | 44 files, identical |
| parse-back | `python parseback27.py plan.md p23dback p23dproto` | 44 blocks, 44 files, mismatched: none |

**Not executed:** the integration tests (Plan 23d adds none and changes no migration), the controller's merge, the
`CLAUDE.md` line, the docker rebuild, the smoke script (its expected output is derived from the code and the unit
tests, not observed) and its cleanup, and any real SearXNG, ThaiJO or model call.
