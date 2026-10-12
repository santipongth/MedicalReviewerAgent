# Plan 23c pre-flight scan (2026-10-13)

Plan: `docs/superpowers/plans/2026-10-13-plan-23c-settings-glossary-harness.md`. Spec:
`docs/superpowers/specs/2026-10-13-plan-23c-settings-glossary-harness-design.md`. Base: master `fdb7ec5` (Plan 23b
merged).

**How it was checked.** Every interface the drafts quote from 23a and 23b was read against the merged code. Then the
plan's code was executed: a scratch copy of `backend/` and `frontend/` (outside the repository) received the code of
Tasks 1–12 and 14 as the plan gives it, and every task's own tests were run at the step that names them. Where a test
failed or a check (ruff, tsc, eslint, a repository test) objected, the plan was fixed and the fix run again. The code
blocks now in the plan are the files that passed, copied in verbatim.

- Backend, all of Tasks 1–9 and 14 applied: `uv run pytest -q` 2051 passed, 16 skipped (the integration tests, which
  need `MRA_INTEGRATION=1` and Postgres); `uv run ruff check .` clean.
- Frontend, Tasks 10, 11, 12 and 14 applied: `npx vitest run` 142 files, 1473 tests passed (one unrelated timing test
  failed once under load and passed on three reruns); `npm run typecheck` and `npx eslint` clean.
- Not executed: the Postgres integration tests (Task 1: migration up/down, the concurrency test), the Playwright spec
  (Task 13 is a checklist), `docker compose config` and the controller's steps (Task 15).

## Task pairs that share a file or an interface

| Task A | Task B | A produces → B consumes | Finding | Fix |
|---|---|---|---|---|
| 1 | 2, 3 | `DocKind`, `DocumentError`, `newest`, `read_active`, `save_version`, `publish` → glossary and settings kinds, `RuntimeConfig` | Consistent (Tasks 2 and 3 pass on Task 1's store) | — |
| 1 | 5 | `mirror_version` → job-start check | The worker's poll had no DB check: a save whose publish failed never reached workers or the API (23b fixed exactly this for LLM versions with `reconcile_version_key`) | `reconcile_mirror` added to Task 1 with a test; Task 5's poll uses it |
| 1 | 4, 6 | store calls → `test_runtime_api.py`, `admin_runtime.py` | Consistent | — |
| 1 | 8, 9 | `HarnessRun` model, unique `active` → `harness_runs` | Consistent | — |
| 1 | 23a/23b migrations | `b3d5f7a9c1e2` on head `f2a4c6e8b0d1` | Head confirmed on master; the draft's downgrade used `"-1"` | Pinned to `BEFORE_RUNTIME = "f2a4c6e8b0d1"` |
| 2 | 3 | `GLOSSARY_KIND`, `active_glossary_from`, `SEED_GLOSSARY`, `ActiveGlossary` → `runtime_config` | Consistent | — |
| 2 | 5, 9 | `build_graph_deps(..., glossary=)`, `GraphDeps.glossary` → 23b's `_wire`, `_rebuild`, `build_eval_deps` | Consistent with 23b's `build_graph_deps(settings, http, redis, catalog, *, resolved, sem, config_version)` | — |
| 2 | 7 | `glossary_of` → `replay`, `run_all` | Consistent | Rejected/error records now carry the glossary label too |
| 3 | 4 | `RuntimeConfig`, `Capacity.check(settings=)`, `worst_case_review_cap` → `ReviewService` | Consistent; 23b's `llm_version` is kept inside `_version()` | `status` text corrected: `s` is needed above the capacity check |
| 3 | 5, 7, 9 | `load_runtime`, `Runtime` → worker, eval CLI, harness worker | Consistent | — |
| 3 | 6 | `SPECS`, `spec_out`, `apply_overrides` → settings routes | Consistent | — |
| 4 | 6, 8 | `deps.runtime.invalidate()`, `service.effective()` → admin routes | Consistent | — |
| 4 | existing tests | tests that set `service.settings.<limit>` | Consistent: with no version `apply_overrides` returns the same `Settings` object | — |
| 5 | 23b `llm_reload` | `poll_runtime`, `report_state` extras, `_wire` glossary, `llm_resolved`, `llm_sem_size` | The draft's poller called `refresh_llms(ctx)`, which drops 23b's `poll=True` DB check; its runtime poll trusted Redis only | Poller calls `refresh_runtime(ctx, poll=True)` then `refresh_llms(ctx, poll=True)`; stub mode, lock, heartbeat and catalog use spelled out |
| 5 | 23b `stop_llms` | `ctx["llm_poller"]` | Consistent: the new poller keeps the key, so shutdown still cancels and awaits it | — |
| 6 | 10, 11 | state, versions page, 201 `SavedVersion`, 422 `{detail, errors}` → `admin-types.ts` | Consistent | — |
| 7 | 8 | `results.load_rows`, `summary_rows`, `verdict_changes` → `compare_results` | The draft's `results.load_rows` dropped 23b's `llm_config` mixed check and meta | Kept; the report header names the LLM config and the glossary |
| 7 | 23b eval CLI | `eval_runtime` → `eval_main` | The draft edited a `go()` that does not exist; 23b's `factory()` builds an engine per call and `release_db` disposes only the last | Edits target `eval_main`; `factory()` builds one engine; `_why` for the message; unused imports listed |
| 7 | 9 | `run_all(strict_cap, spent_before, on_record, should_stop)`, `prior_spend`, `write_report` → `run_harness` | Consistent | — |
| 8 | 9 | `selection`, `finish`, `WORKER_KEY`, `HARNESS_QUEUE`; Task 9 appends to `harness_runs.py` | Consistent (append only) | — |
| 8 | 12, 13, 15 | `ceiling_usd` → form, fixtures, e2e, docs, smoke | `HARNESS_MAX_USD` default $15 in config, tests, fixtures, docs, spec and memory note | $5 everywhere (`5.01` is "over the ceiling"); Decisions row added |
| 9 | 23b catalog | `build_eval_deps` | Built models with no catalog, unlike the review workers after 23b's final fix | Uses `cached_catalog(redis, llm_reload.load_live_catalog)`; test added |
| 9 | `.dockerignore` | build context `./backend` | Today's file excludes neither fixtures nor runs | Task 9 appends `evals/cochrane/fixtures`, `evals/cochrane/runs`, `evals/cochrane/*.bak`; its test checks them |
| 10 | 23b `ModelsView` | draft/base/409 model, header polling, `WriteTracker`, `WORKERS_NOT_NOTIFIED` | The draft settings page reset the draft on every read, discarded it on "โหลดค่าล่าสุด", never polled workers after a save, and wrote its own `workers_notified` text | Shared helpers moved out of `ModelsView` (`admin-workers.ts`, `useWorkerFollowUp`); `useVersionedPage`, `DraftStatus`, `VersionHistory` and `WorkerVersions` follow its rules; `models-view.test.tsx` passes unchanged |
| 10 | 23a `admin-gate.test.tsx` | nav links | Its test lists every link and failed on the three new ones | Test update added to Task 10 |
| 10 | repository rule `tables-caption.test.ts` | settings group tables | No caption | Screen-reader captions |
| 10 | 11 | `useVersionedPage`, `DraftStatus`, `VersionHistory`, `WorkerVersions`, `STALE_TEXT` | Consistent (executed) | — |
| 10 | 12 | types, client, copy, fixtures | Consistent; fixture ceiling 5 | — |
| 10 | 13 | labels and flows | e2e checklist said "โหลดค่าล่าสุด" and "ยืนยันการย้อนกลับ" | Checklist follows the new 409 note and 23b's "ยืนยันย้อนกลับ"; `test.slow()` for the matrix |
| 10 | 14 | both edit `admin-types.ts` and `models-view.tsx` | Task 14 runs after Task 10, on the refactored `ModelsView` | Executed in that order |
| 12 | `tables-caption.test.ts` | report tables, runs table | No caption | Screen-reader captions |
| 14 | 23b `admin_models`, `llm_validate`, `llm_config` | `newest_row`, `_unreadable`, `unpriced_roles`, band validator | Consistent; the band is what can make a stored version unreadable, which the M6 test uses | — |
| 15 | `test_api_docs_limits.py` | `docs/api.md` | Docs edits must keep it green | Run step added |

## Each task against itself

| Task | Tests vs code; files created vs files touched | Finding | Fix |
|---|---|---|---|
| 1 | 8 → 10 unit tests pass; integration tests written, not run (no Postgres here) | `_storable` duplicated 23b's `ensure_storable`; no concurrency test although 23b required one for its advisory lock | Reuses `ensure_storable`; `reconcile_mirror` and storability tests; `test_config_store_concurrency.py`; commit list updated |
| 2 | 151 tests pass after fixes | Three assertions said "อัตราส่วนฮาซาร์ด not in the prompt", but the prompt's own rules give it as an example; the synthesis test's imports had no place to go | `endswith` on the glossary line; import placement and ruff I001 note |
| 3 | 41 pass | ruff TRY004 on `coerce` | Type checks moved out of the raising `if` |
| 4 | 54 pass (with `docs/api.md` present) | — | `status` ordering spelled out |
| 5 | Rewritten; 52 pass with 23b's `test_llm_reload.py` and `test_runner.py` | Poller test raced the heartbeat write | Waits for the report; new tests for the lost publish, the emptied table, the stale error, stub mode, Redis/DB down |
| 6 | 74 pass | Review Focus 4 names deep bodies but no test sent one; `main.py` import order | Deep-body test; sorted import note |
| 7 | 132 eval tests pass, including 23b's | See pairs 7/8 and 7/23b | As above |
| 8 | 39 pass | RUF100 (an unused `noqa`) on the enqueue fallback; queue constant placement; import order | Fixed in the code and notes |
| 9 | 28 pass plus the new `build_eval_deps` test | RUF100 on `run_harness`'s fallback | Fixed |
| 10 | Rewritten; settings 9, history 4, api, gate tests pass; full frontend suite green | See pairs | As above |
| 11 | Rewritten on the shared hook; 4 pass | Row keys from a ref written in callbacks (lint risk) | Module-level counter; clean drafts keep their rows through background reads |
| 12 | 11 pass | Two "Step 3"/"Step 4" headings; missing captions; $15 text | Steps renumbered 5 and 6; captions; $5.00 |
| 13 | Checklist, not executed | See pair 10/13 | Updated |
| 14 | New task; backend 95 and frontend `models-view` 61 pass | — | — |
| 15 | Docs and controller steps, not executed | $15 in docs and memory; smoke left settings rows unexplained | $5; a note why the smoke's settings rows may stay (unlike 23b's LLM rows); `"error":null` smoke line |

## Spec and plan coverage

Every spec section maps to a task: data model (1), store (1), settings and propagation (3, 4, 5), glossary (2), cache
(4), harness runs (7, 8, 9), Docker (9), admin API (6, 8, 14), frontend (10, 11, 12, 14), CLI (7), testing (each task,
13), docs (15). The Review Focus keeps its five items, each tied to named tests in the plan.
