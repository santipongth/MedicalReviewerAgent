# Plan 27 pre-flight scan (2026-10-13)

Plan: `docs/superpowers/plans/2026-10-13-plan-27-quick-answer.md`. Spec:
`docs/superpowers/specs/2026-10-13-plan-27-quick-answer-design.md`. Base: master `83196cc` (Plans 22a through 26
merged; ThaiJO on by default since 2026-10-13; the production compose overlay).

**How it was checked.**
- Every interface the plan quotes from master was read in the code and found at `83196cc`: `ReviewOptions` (`bound`,
  `clamped`, `enough_candidates`), `CreateReviewRequest`, `compute_cache_key`, `ReviewService.create`/`status`,
  `Refused`, `review_cost_cap`, `worst_case_review_cap`, the MCP `build_mcp`/`start_review`/`INSTRUCTIONS`/
  `START_REVIEW_DOC`/`_error`, `TERMINAL_STATUSES`, the graph builders (`_add_review_nodes`, `build_graph`,
  `GraphDeps`, `initial_state`), `route_to_reading`, `route_after_normalize` and the synthesis helpers it names
  (`_narrative_papers`, `_direction_papers`, `_prose_context`, `_brief`, `_empty_synthesis`, `_split_sentences`,
  `_drop_wrong_self_claims`, `ANSWER_CERTAINTY`, the fixed messages, `make_localize`, `make_finalize`),
  `make_check_support`, `HarnessRunner.call`, the prose and citation checks, `markers`, `LLMs.with_schema`,
  `Synthesis`, `DATA_NOTICE`, `Settings.prompt_version`, the stub's `stub_result`/`_stub_support`/`make_timed_nodes`,
  `render_markdown`/`_citation_parts`/`vancouver`/`_vancouver_md`, the test helpers, and the frontend `RequestSlip`,
  `ReviewScreen`, `LiveRun`, `Report`/`useDocumentLang`, `CitationText`, `citedQuestion`, `ReportNotices`,
  `alignMarkers`/`citationOf`/`isChecked`, `RC`, `TYPICAL_DURATION_TH`, the fixtures and the e2e `mockApi`.
- The code was written and made green in a scratch copy outside the repository (`%TEMP%\claude\…\scratchpad\p27proto`),
  first on master `be1e368`, one commit and tag per task. When master moved to `83196cc` (ThaiJO on by default, the
  compose and prod-overlay changes, docs and `CLAUDE.md` edits), the six task commits were rebased onto it in a fresh
  clone (`p27r`, tags `t0` = `83196cc` … `t6`). The rebase applied without a conflict; Task 6 then gained one sentence
  (ruling 3). The plan's code sections were regenerated from `p27r` (new files whole; edits as replacement pairs whose
  `old` is unique in the file at that task's start on the new base; `backend/app/mcp/server.py` is edited in Tasks 1
  and 3 and `frontend/src/components/review/review-screen.tsx` in Tasks 4 and 5, each against its own starting text).
  Then:
  - **Replay:** a fresh copy of `83196cc` (`p27replay2`) received the tasks one by one from the rendered plan, test
    files first. Each task's tests were run before its code (to see them fail as the plan says), then after it, then
    ruff and the full backend suite, or the full frontend suite, typecheck and eslint, and for Task 5 the whole
    Playwright e2e suite.
  - **Parse-back:** the final plan was parsed and every block applied to another fresh copy of `83196cc` (`p27back2`):
    45 blocks, 43 files, all byte-identical to `t6`. The replay copy matches `t6` on all 43 files too.
- No network call and no real LLM call was made. Backend dependencies came from the uv cache (`uv sync --offline`),
  frontend ones from the npm cache (`npm ci --offline`). The controller's smoke script ("After the plan") was run
  against the replay copy's own environment (not docker) and printed the expected lines quoted in the plan.

## Task pairs that share a file or an interface

| Task A | Task B | A produces → B consumes | Finding | Fix |
|---|---|---|---|---|
| 1 | 2 | `is_quick(options)` → `route_to_reading`, `route_after_normalize`, `finalize` | The graph state carries the stored `options`; an old state has no `mode` | `is_quick` reads `options.get("mode") == "quick"`; `ReviewOptions.clamped` maps a missing or unknown mode to `full` |
| 1 | 3 | `backend/app/mcp/server.py` | Edited by both tasks (`start_review(mode)`, then the shared inner `create` and `quick_answer`) | Each edit is generated against its own starting text and replayed in order |
| 1 | 5 | `/status` `limits.quick` → the form's paper count | The count must never be hard-coded in copy | `status-fixture.ts` gains `quick`; without it the form shows a number-free line |
| 1 | 6 | `QUICK_*`, `REVIEW_MODES` → the `/status` example in `docs/api.md` | Docs could drift from the constants | `test_status_example_lists_the_quick_limits` reads the constants |
| 2 | 3 | `result.mode`, `result.quick = {refs, papers_read}` → `quick_view`, the Markdown export, `quick_answer`, the stub | The stub has to give the same shape for the smoke check and manual QA | `stub_result(..., options)` adds `mode`/`quick` (`_stub_quick` for a quick answer); `test_quick_outputs.py` covers both |
| 2 | 4 | `result.quick.refs` (order of first citation) → `quickRefs`, `quickParts` | The web app and the backend number refs independently | The page uses `result.quick.refs` when present and only otherwise falls back to first citation in the summary (the same order) |
| 2 | `test_prompts_by_type.py` | new `QUICK_SYSTEM`, `quick_user` | The SLR pins, the guard pins and the Plan 25 judge pins must hold | Only new pins (`test_quick_prompts_are_pinned`); the pin comment names 2026-10-13.3 |
| 2 | 6 | `prompt_version` 2026-10-13.3 | The docs header names it | Task 6 edits it; `test_the_docs_name_the_current_prompt_version` keeps them in step |
| 3 | `test_mcp_server.py` | the tool list gains `quick_answer` | The listing test pins the exact set | Task 3 updates the expected set |
| 4 | 5 | `formStart`, `FormStart`, `isQuickReview` → `Home`, `RequestSlip`, `LiveRun` | `review-screen.tsx` is edited by both | Task 4 shows `QuickAnswer`; Task 5 passes `quick` to `LiveRun`; each edit against its own starting text |
| 4 | existing report | `CitationText` (references.tsx) and `useDocumentLang` (report.tsx) become exports | The full report must not change | Only the `export` keyword and a comment change; the full suite stays green |
| 4 | i18n scan | `RC.quick` | Report components may hold no Thai literal; Thai copy must be Thai, English copy Thai-free | Passes (`i18n-report.test.ts` in Task 4's run) |
| 5 | existing e2e | the form now starts as a quick answer | `app.spec.ts`, `home-plain.spec.ts` and `paper-count.spec.ts` test the full review's options | They open `/?mode=full`; the whole e2e suite passes (453 passed, 1 skipped) |
| 6 | `test_api_docs_limits.py` | `docs/api.md` | A range like "5–30" would read as a stale paper count | The new text has none (8 passed) |
| master `83196cc` | 2, 6 | `config.py` (ThaiJO default), the `docs/api.md` ThaiJO lines, roadmap row 24 | The plan was first written against `be1e368` | All pairs regenerated on `83196cc`; the `prompt_version` pair in `config.py` is far from the ThaiJO lines |

## Each task against itself

| Task | Tests vs code; files created vs touched | Finding | Fix |
|---|---|---|---|
| 1 | 13 tests; 1 test file created, 3 files modified | A quick request that sends a scoping type or 50 papers must not 422 | The `quick_sizes` before-validator replaces them (MCP already clamps) |
| 2 | 16 test functions in `test_quick_answer.py` and 1 pin; 1 module and 1 test file created, 7 files modified | A model sentence may claim another certainty level or carry an unverified number | Dropped in code (`_drop_wrong_self_claims`, `fix_prose`); the certainty line is the computed baseline |
| 3 | 12 tests; 1 test file created, 5 files modified | `quick_answer` must not block a worker or the event loop forever | At most 90 s, polled every 2 s through `_sleep` (replaced in tests) |
| 4 | 13 tests (5 + 8) and a fixture; 2 modules, 2 test files created, 6 files modified | Consistent | — |
| 5 | 7 new unit tests, 3 e2e tests in `quick.spec.ts` (the axe and overflow ones at 1440/390 px, light and dark); 1 spec created, 11 files modified | See the 5 / existing e2e pair | `?mode=full` |
| 6 | 2 docs tests | Consistent | — |

## Rulings

1. **Rebase, not rewrite.** The six task commits rebased onto `83196cc` without conflict; no code change was needed
   for the new base. ThaiJO stays pinned off in unit tests (`tests/conftest.py`), so the test expectations hold.
2. **Task 6 ends at docs and final checks.** The merge, the root `CLAUDE.md` convention line, the docker rebuild and
   the smoke check moved to a short "After the plan (controller)" note, which keeps the proposed `CLAUDE.md` line and
   the smoke script with its expected output.
3. **ThaiJO in a quick pool.** With ThaiJO on by default, a quick answer's pool of 30 takes at most
   `min(15, 30 // 8)` = 3 ThaiJO candidates. `docs/api.md`'s quick section now says so (one sentence in Task 6); no
   code change.
4. **Flaky frontend timeouts.** On this host the full vitest run timed out `agent-layout.test.ts` ("keeps everything
   inside the viewBox and nodes apart", wide and narrow) and `team-stage.test.tsx` ("Plan 21 fix round 1 …") at 5 s
   in two of two runs on master `83196cc` itself, and once in the replay's Task 6 run; they pass alone (1.7 s and
   2.9 s) and Plan 27 touches neither. The plan lists them with the known flaky tests.

## Results

Baseline (master `83196cc`, same host): backend 2493 passed, 17 skipped (the replay's Task 1 total less its 13 new
tests); frontend 150 files, 1607 tests (2–3 of them the ruling-4 timeouts). The 17 skipped are the integration tests
(they need `MRA_INTEGRATION=1` and Postgres); Plan 27 adds none and changes no migration. The e2e baseline on
`be1e368` was 443 passed, 1 skipped.

| Task | Before its code | Its tests after | ruff / typecheck / eslint | Full suite |
|---|---|---|---|---|
| 1 | `ImportError: cannot import name 'QUICK_CANDIDATE_LIMIT'` (collection) | 13 passed | ruff clean | backend 2506 passed, 17 skipped |
| 2 | `No module named 'app.graph.nodes.quick'` (collection) | 67 passed | ruff clean | backend 2523 passed, 17 skipped |
| 3 | `ImportError: cannot import name 'quick_view'` (collection) | 22 passed | ruff clean | backend 2535 passed, 17 skipped |
| 4 | `Failed to resolve import "./quick"` / `"./quick-answer"` | 3 files, 58 passed | clean / clean | frontend 152 files, 1621 tests |
| 5 | 6 failed (the mode-choice tests, the quick duration) | 3 files, 66 passed | clean / clean | frontend 152 files, 1627 tests; e2e 453 passed, 1 skipped (4.0 min) |
| 6 | — | docs tests 8 passed | ruff clean | backend 2537 passed, 17 skipped; frontend 1627 tests (ruling 4) |

## Commands run

| Where | Command | Result |
|---|---|---|
| `p27r` | `git rebase --onto 83196cc be1e368` (then tags `t0`…`t6`) | clean |
| replay | `python replay27.py plan.md p27replay2 <env> 1 6` | the table above |
| replay, base | `npx vitest run` (twice, with the plan's changes stashed) | 150 files, 1607 tests; ruling-4 timeouts |
| replay, done | `npx vitest run src/lib/agent-layout.test.ts src/components/review/team/team-stage.test.tsx` | 2 files, 47 passed |
| replay, done | `uv run python smoke27.py` (the plan's smoke script, outside docker) | the lines quoted in "After the plan" |
| replay vs `t6` | `cmp` over the 43 changed files | identical |
| parse-back | `python parseback27.py plan.md p27back2 p27r` | 45 blocks, 43 files, mismatched: none |

**Not executed:** the integration tests, the controller's merge, the `CLAUDE.md` line, the docker rebuild and the
smoke check inside the containers, a browser check of the quick page beyond the e2e suite, and any real model call
(time, cost and answer quality of quick answers are unmeasured: a paid batch, the owner's call).
