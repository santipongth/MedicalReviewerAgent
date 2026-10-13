# Plan 30 pre-flight scan (2026-10-13)

Plan: `docs/superpowers/plans/2026-10-13-plan-30-cleanup.md`. Spec:
`docs/superpowers/specs/2026-10-13-plan-30-cleanup-design.md`. Base: master `eae78b5` (Plans 22a through 27 and 23d
merged).

**How it was checked.**
- Every candidate item of the brief was first verified against `eae78b5` (spec, sections 3–5). Dropped as already fixed
  or by design: D2 (non-mapping documents: a reported failure since Plan 23c Task 5; prototyped as a silent `{}`, which
  broke seven pins in `test_runtime_reload.py`, so it was reverted), D3 (`/admin/llm-config` answers an unreadable row),
  E3 (CLI `passwd` ends every session), F2 (downgrade targets pinned). Deferred with reasons: red-flag typos,
  and-framing and "someone" traps; four eval minors; the ModelsView refactor; the harness 422 mapping; bidi isolation.
- Every interface the plan quotes from master was read in the code: `ReviewService._version`/`create`/`sse_key`/
  `effective`, `Identity`, `compute_cache_key`, `ReviewSummary`/`ReviewOut`, `cache_part`/`effective_sources`/
  `ActiveSources`, `refusal_code_of`/`rejection_error`/`red_flag`/`MEDICAL_PATTERNS_EN`, `run_review`/`_runner`,
  `ReviewRunner.run`/`_finish`, the worker ctx keys set by `init_runtime`/`init_llms`/`refresh_*`, `loaded_workers`/
  `report_loaded`/`LOADED_MAX_AGE`, `HarnessRunner.call`/`_run_escalation`/`HarnessResult`, `make_topic_guard`,
  `prose._sentences`/`_SENTENCE`/`_REF` and the four prose checks, `closing_line`, `make_search`, `render_markdown`,
  `review_events`, the MCP `quick_answer`/`review_resource`/`QUICK_ANSWER_DOC`/`_sleep`, `SseSlots`, `_record_sign_in`,
  `queue_position`, the eval writers and `load_gold`, the partial unique index `ux_reviews_active_cache_key`, and the
  frontend `ReviewScreen`, `QuickAnswer`/`Sentence`, `RequestSlip`, `getReview`, `reduceRun`/`RunState`/`STEP_OF`,
  `FALLBACK_TITLE`, `isQuickReview`, `RC.quick`, the report route and the fixtures.
- The code was written and made green in a scratch clone outside the repository (`%TEMP%\claude\…\scratchpad\p30proto`),
  one commit and tag per task (`t0` = `eae78b5` … `t7`). The plan's code sections were generated from those tags (new
  files whole; edits as replacement pairs whose `old` is unique in the file at that task's start;
  `backend/app/mcp/server.py` is edited in Tasks 2 and 4 and `backend/app/services/review_service.py` in Tasks 1 and 2,
  each against its own starting text). Then:
  - **Replay:** a fresh clone of `eae78b5` (`p30replay`) received the tasks one by one from the rendered plan, test
    files first. Each task's tests were run before its code (to see them fail as the plan says), then after it, then
    ruff and the full backend suite, or for Task 6 the full frontend suite, typecheck, eslint and the whole e2e suite.
    The replay matches the prototype's `t7` on all 37 changed files.
  - **Parse-back:** the final plan was parsed and every block applied to another fresh clone (`p30back2`): 39 blocks,
    37 files, all byte-identical to `t7`, and no file changed by the prototype is missing from the plan.
- No network call and no real LLM call was made. Backend dependencies came from the uv cache (`uv sync --offline`),
  frontend ones from the npm cache (`npm ci --offline`). The controller's smoke script was run against the prototype's
  own environment (not docker) and printed the lines quoted in "After the plan (controller)".

## Task pairs that share a file or an interface

| Task A | Task B | A produces → B consumes | Finding | Fix |
|---|---|---|---|---|
| 1 | 2 | `review_service.py`: `_version` (Task 1) and the `queued` event (Task 2) | Same file, distinct places | Each edit generated against its own starting text and replayed in order |
| 1 | existing tests | `ReviewService._version` now calls `pipeline_version` | Any byte change would move every cache key | `test_the_version_string_keeps_the_admission_rules` pins the old strings (`pv`, `pv+llmfile`, `+g`, `+thaijo`, a sources version turning ThaiJO off); `test_cache_key_llm_version.py` and the whole suite stay green |
| 1 | worker tests | `_runner(ctx)` keeps its one-argument shape | `test_llm_reload.py`/`test_runtime_reload.py` monkeypatch `_runner` with a one-argument lambda | `run_version(ctx)` is read inside `_runner`, not passed in |
| 1 | runner | the re-key is written while the row is `running` | `ux_reviews_active_cache_key` is a partial unique index on active rows | The key is written in the same `UPDATE` that sets `status = "done"`, so the new row is outside the index |
| 2 | 6 | REST `topic: null` → `getReview` | `Review.topic: string` is read by about ten components | `getReview` maps `null` to `""`; the personal page already hides the topic (Plan 26), so no component changes |
| 2 | 4 | `mcp/server.py` imports (`shown_topic`, then `SseSlots`) | Same import block | Generated per task |
| 2 | existing tests | the `queued` event payload | Tests emit `queued` with `{}`; the reducer never read `topic` | Docs table updated in Task 7; a replay strips `topic` from older stored events |
| 3 | quick writer | `prose._sentences` canonicalises cites | The quick writer already did so in its own splitter | Both now agree; every quick, prose and support test unchanged |
| 5 | `test_llm_reload.py` | `LOADED_MAX_AGE` 1 day → 3 minutes | The poll test seeded an entry 20 hours old; with pruning it vanished (`ValueError` on unpack) | The seed is 2 minutes old (still listed) |
| 5 | `test_capacity.py` | id tie-break in `queue_position` | Ties now get distinct but id-ordered positions, so the old test could still flake on order | The test sets distinct `created_at` |
| 6 | e2e | the report route, the tab title | No e2e spec asserts either | The whole e2e suite was run in the replay: 458 passed, 1 skipped |
| 7 | `test_api_docs_limits.py` | `docs/api.md` | A range like "5-30" would read as a stale paper count | The new text has none; the new test pins that `$0.103` is gone |

## Each task against itself

| Task | Tests vs code; files created vs touched | Finding | Fix |
|---|---|---|---|
| 1 | 7 tests; 1 module and 1 test file created, 3 files modified | Consistent | — |
| 2 | 18 new tests + 2 moved RR4 cases; 1 test file created, 8 files and 1 test file modified | The first draft of the test passed a string id to `list_since` | `uuid.UUID(...)` |
| 3 | 16 tests; 1 test file created, 2 files modified | "Use of statins…" and "Never-smokers…" read as imperatives | `(?!-|\s+of\b)` after the sentence-initial verb; pinned as research wording |
| 3 | — | A lone group after an already-cited sentence ("… [P1]. [P2]") | Joined inside the stop too ("… [P1] [P2]."), pinned |
| 4 | 3 tests; 1 test file created, 1 file modified | A raw address must not reach Redis | `waiter_key` hashes it with `sse_key`, pinned |
| 5 | 6 tests; 1 test file created, 2 test files and 5 files modified | D2 was prototyped here and reverted (see above) | Dropped, recorded in the spec |
| 5 | — | "password changed meanwhile" passes before the code | Expected: it pins the existing re-read; the row lock closes the commit window after it |
| 6 | 7 tests; 1 test file created, 1 test file and 7 files modified | "names the tab once the check has passed" passes before the code | Expected: the old code set the title at once |
| 7 | docs test | Consistent | — |

## Results

Baseline (`eae78b5`, same host): backend 2589 passed, 17 skipped; frontend 154 files, 1653 tests. The 17 skipped are the
integration tests (they need `MRA_INTEGRATION=1` and Postgres); Plan 30 adds none and changes no migration.

| Task | Before its code | Its tests after | ruff / typecheck / eslint | Full suite |
|---|---|---|---|---|
| 1 | `ModuleNotFoundError: app.services.pipeline_version` (collection error) | 7 passed | ruff clean | backend 2596 passed, 17 skipped |
| 2 | 12 failed, 90 passed | 102 passed | ruff clean | backend 2616 passed, 17 skipped |
| 3 | 11 failed, 5 passed | 16 passed | ruff clean | backend 2632 passed, 17 skipped |
| 4 | 3 failed, 13 passed | 16 passed | ruff clean | backend 2635 passed, 17 skipped |
| 5 | 5 failed, 43 passed | 48 passed | ruff clean | backend 2641 passed, 17 skipped |
| 6 | 6 failed, 95 passed (1 file) | 5 files, 101 passed | clean / clean | frontend 155 files, 1660 tests (see below); e2e 458 passed, 1 skipped |
| 7 | — | docs tests 10 passed | ruff clean | backend 2642 passed, 17 skipped |

Flaky under load: in full frontend runs `agent-layout.test.ts` ("keeps everything inside the viewBox", wide and/or
narrow) and `team-stage.test.tsx` ("Plan 21 fix round 1 …") timed out (2–3 failures per run, prototype and replay);
once, while the host ran a second suite, `glossary-view.test.tsx` and `models-save-bar.test.tsx` timed out too. All
passed alone (4 files, 78 tests). Plan 30 touches none of them. `test_capacity.py::test_queue_position` passed in every
run (Task 5 removes its race).

## Commands run

| Where | Command | Result |
|---|---|---|
| proto, base | `uv run --offline pytest -q` | 2589 passed, 17 skipped |
| proto, base | `npx vitest run` | 154 files, 1653 tests passed |
| proto, done | `uv run --offline ruff check . && uv run --offline pytest -q` | clean; 2642 passed, 17 skipped |
| proto, done | `npx vitest run && npm run typecheck && npm run lint` | 1657 passed, 3 known-flaky timeouts (passed alone); clean; clean |
| proto | `python smoke30.py` (the plan's smoke script, outside docker) | the lines quoted in the plan |
| replay | `python replay30.py plan.md p30replay <env> 1 7` | the table above |
| replay | `npx vitest run` (after Task 7) | 1658 passed, 2 known-flaky timeouts; alone: 4 files, 78 passed |
| replay vs proto | `cmp` over the 37 changed files | identical |
| parse-back | `python parseback30.py plan.md p30back2 p30proto t7` | 39 blocks, 37 files, mismatched: none, not in plan: none |

**Not executed:** the integration tests, the controller's merge, the `CLAUDE.md` line, the docker rebuild and the smoke
check inside the containers, a browser check of the tab title and the quick page, and any real guard or escalation call.

## Cost check (no call made)

No prompt, schema or model call changes. The guard still makes one call per review; an escalation refusal now ends as
`personal_medical` at the same cost it already had. Re-keying adds one hash in the worker per finished review. The MCP
wait cap adds one Redis INCR/EXPIRE and one DECR per waiting `quick_answer` call.
