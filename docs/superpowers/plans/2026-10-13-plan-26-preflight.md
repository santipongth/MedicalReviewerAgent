# Plan 26 pre-flight scan (2026-10-13)

Plan: `docs/superpowers/plans/2026-10-13-plan-26-audience-safety.md`. Spec:
`docs/superpowers/specs/2026-10-13-plan-26-audience-safety-design.md`. Base: master `6eb0a34` (Plans 22a through 25
merged).

**How it was checked.**
- Every interface the plan quotes from master was read in the code: `ReviewService.create` and its check order,
  `ServiceError` and subclasses, `service_error_response`, the MCP `start_review`/`get_review_status`/
  `get_review_result` tools, `INSTRUCTIONS`, `ReviewOut` and its validator, `ReviewRepository.find_reusable` and
  `list_recent` (rejected reviews are never reused or listed), `TopicVerdict` and the `_require_*` schema hooks,
  `GUARD_SYSTEM`/`guard_user`, `make_topic_guard`, `route_after_guard`, `HarnessRunner.call` (no validator for the
  guard), `ReviewRunner.run`'s rejected branch, `Settings.prompt_version`, the guard's place in the graph (the first
  node of the job, after admission), and the frontend `Report`, `reportLayout`/`SECTIONS_BY_TYPE`, `BottomLine`,
  `StrengthLine`, `ReviewScreen`, `TerminalState`, `RequestSlip`, `ApiError`/`request`, `reduceRun`, `useReview`,
  `isNotEvidence`, `isNonQuantitative`, `RC` and its scan test, and the stored-preference pattern of `stage-view.tsx`.
- The code was written and made green in a scratch copy outside the repository
  (`%TEMP%\claude\…\scratchpad\p26proto`), one tag per task (`t0` = master … `t6`). The plan's code sections were
  generated from that copy (new files whole; edits as replacement pairs whose `old` is unique in the file at that
  task's start; `review-screen.tsx` is edited in Tasks 4 and 5, each against its own starting text). Then:
  - **Replay:** a fresh copy of master (`p26replay`) received the tasks one by one from the rendered plan, test files
    first. Each task's tests were run before its code (to see them fail as the plan says), then after it, then ruff
    and the full backend suite, or the full frontend suite, typecheck and eslint.
  - **Parse-back:** the final plan was parsed and every block applied to another fresh copy of master (`p26back2`):
    40 blocks, 39 files, all byte-identical to the prototype. The replay copy matches the prototype on all 39 files.
- No network call and no real LLM call was made. Backend dependencies came from the uv cache (`uv sync --offline`),
  frontend ones from the npm cache (`npm ci --offline`). The controller's smoke script (Task 6 Step 5) was run against
  the prototype's own environment (not docker) and printed the expected lines quoted in the plan.

## Task pairs that share a file or an interface

| Task A | Task B | A produces → B consumes | Finding | Fix |
|---|---|---|---|---|
| 1 | 2 | `rejection_error`, `refusal_code_of` → `topic_guard`, the runner's event `code` | The stored `error` is the only field that survives for a rejected review | The code is a prefix of `error` (`"personal_medical: …"`), so REST, MCP and the runner derive it the same way; no migration |
| 1 | 2 | `ReviewOut.refusal_code` reads `status` and `error` | A rejection from before Plan 26 has a free-text reason | Anything rejected without the prefix reads `declined` (`test_refusal_codes_of_stored_reviews`) |
| 1 | 5 | REST 422 body `{detail, code, kind, hotlines, message_th}` → `ApiError.refusal` → `EmergencyPanel` | A plain body-validation 422 must stay an error line | The panel shows only for `refusal.code === "emergency"` ("a plain validation error is still an error line") |
| 1 | 5 | `MESSAGES` (backend) and `EMERGENCY_COPY`/`PERSONAL_MEDICAL_COPY` (frontend) | Two copies of the Thai text | Both are pinned by tests to the same strings (spec section 5); the UI shows its own copy, never server text |
| 2 | 5 | event `rejected {reason, code}` and `review.refusal_code` → `RunState.code` → `TerminalState` | A page that missed the event | `TerminalState` also recognises the `"personal_medical: "` error prefix ("is recognised from the stored error when the code is missing") |
| 2 | existing tests | `TopicVerdict` gains a required field | 20+ tests build `TopicVerdict(allowed, reason, english_topic)` (runner, LLM client and budget tests) | Python default `"research"`, removed from the tool schema (`_require_category`); no fake changes; strict schema still lists it as required |
| 2 | existing tests | a guard validator would make the runner repair `allowed: false` fakes | Extra calls and costs in tests that count them | No validator: either signal rejecting is a rejection, `personal_medical` wins |
| 2 | `test_prompts_by_type.py` | `GUARD_SYSTEM` changes | The SLR pins and the Plan 25 judge pins must hold | Only the guard changed; its two prompts pinned; comment updated to 2026-10-13.2 |
| 2 | 6 | `prompt_version` | The docs header names it | Task 6 edits `docs/api.md` to 2026-10-13.2 |
| 3 | 4 | `audienceLayout`, `learnerNoteAfter`, `opensRationale`, `harmsGap`, `needsDosingNotice` → `Report`, `ReportNotices` | 156 existing `<Report>` renders in 12 test files expect today's order | The public view (default) equals `reportLayout` exactly; notices are `aside`s outside the table of contents; the full suite stays green |
| 3 | 4 | notices vs existing `getByRole("note")` in `report.test.tsx` | A `role="note"` would collide | Notices are `aside` (`complementary`), named by their label |
| 3 | 5 | `useStoredAudience`, `storeAudience` → `RequestSlip` | Reading storage in a `useEffect` + `setState` failed `react-hooks/set-state-in-effect` | `useSyncExternalStore` with the default as the server snapshot; the chosen value overrides it |
| 4 | 5 | `review-screen.tsx` | Edited by both tasks | Task 4 passes `initialAudience`/`onAudience`; Task 5 adds `code` to `TerminalState`; each edit is generated against its own starting text and replayed in order |
| 4 | i18n scan | `RC.audience`, `RC.safety` | Report components may hold no Thai literal; Thai copy must be Thai, English copy Thai-free | Passes (`i18n-report.test.ts` in Task 4's run); `terminal-state.tsx` and the landing form are outside the scan, as before |
| 6 | `test_api_docs_limits.py` | `docs/api.md` | A range like "5-30" would read as a stale paper count | The new text has none (6 passed) |

## Each task against itself

| Task | Tests vs code; files created vs touched | Finding | Fix |
|---|---|---|---|
| 1 | 40 tests; 1 module and 2 test files created, 4 files modified | A plain red-flag phrase would refuse research ("chest pain in the emergency department"); a personal marker alone would refuse "help me find studies on…" | The rule needs a marker and no research framing; research words match as word starts ("researching", "trials") |
| 1 | — | "type I diabetes" read "I" as a personal marker | `i` after type/phase/class/grade/stage is skipped |
| 1 | — | MCP: a tool error would read as a failure to retry | `start_review` returns a structured `refused` result |
| 2 | 5 node tests, 1 new runner test and 1 extended, 1 pin; 5 files modified | Consistent | — |
| 3 | 32 tests; 3 modules and 2 test files created | A paper with no card (a failed read) broke the test helper | The helper returns such a paper unchanged |
| 4 | 9 tests; 1 component and 1 test file created, 5 files modified | `React.ReactNode` without an import is a UMD global in a module | `import { type ReactNode } from "react"` |
| 5 | 10 tests; 2 files and 1 test file created, 7 files modified | See the 3–5 pair (storage in an effect) | `useStoredAudience` |
| 6 | docs tests | Consistent | — |

## Results

Baseline (master `6eb0a34`, same host): backend 2262 passed, 17 skipped; frontend 145 files, 1530 tests. The 17
skipped are the integration tests (they need `MRA_INTEGRATION=1` and Postgres); Plan 26 adds none and changes no
migration. The known flaky `test_capacity.py::test_queue_position` did not fail in any run here.

| Task | Before its code | Its tests after | ruff / typecheck / eslint | Full suite |
|---|---|---|---|---|
| 1 | `ImportError: cannot import name 'safety'` (2 collection errors) | 40 passed | ruff clean | backend 2302 passed, 17 skipped |
| 2 | 8 failed, 67 passed | 75 passed | ruff clean | backend 2309 passed, 17 skipped |
| 3 | `Failed to resolve import "./safety"` / `"./audience"` | 2 files, 32 passed | clean / clean | frontend 147 files, 1562 tests |
| 4 | `audience.test.tsx` 7 of 9 failed | 3 files, 62 passed | clean / clean | frontend 148 files, 1572 tests |
| 5 | `Failed to resolve import "@/lib/refusal-copy"` | 4 files, 62 passed | clean / clean | frontend 149 files, 1582 tests |
| 6 | — | docs tests 6 passed | ruff clean | backend 2309 passed, 17 skipped; frontend 149 files, 1582 tests |

## Commands run

| Where | Command | Result |
|---|---|---|
| proto, base | `uv run --offline pytest -q` | 2262 passed, 17 skipped |
| replay, base | `npx vitest run` | 145 files, 1530 tests passed |
| proto, done | `uv run --offline ruff check . && uv run --offline pytest -q` | clean; 2309 passed, 17 skipped |
| proto, done | `npx vitest run && npm run typecheck && npm run lint` | 149 files, 1582 tests; clean; clean |
| proto | `python smoke26_local.py` (the plan's smoke script, outside docker) | the lines quoted in Task 6 Step 5 |
| replay | `python replay26.py plan.md p26replay <env> 1 6` (then 3–6 again after a console-encoding crash of the script's own print, with Task 3's new files removed first) | the table above |
| replay vs proto | `cmp` over the 39 changed files | identical |
| parse-back | `python parseback.py plan.md p26back2 p26proto` | 40 blocks, 39 files, mismatched: none |

**Not executed:** the integration tests, the controller's merge, the `CLAUDE.md` blob, the docker rebuild and the
smoke check inside the containers (Task 6 Steps 4–6), a browser check of the four views, the emergency panel and the
personal page, and any real guard call (how often a budget model labels real questions `personal_medical`, and how
often it wrongly refuses a research question, is unmeasured: a paid batch on the 22a harness, the owner's call).

## Cost check (no call made)

The guard's system prompt grows from 739 to 1,270 characters (+531, about 130 tokens) and its answer by one enum
field. On `budget` (Qwen3.5 Flash, $0.065 / $0.26 per 1M) that is about $0.00001 more per review; on `balanced`
(Gemini 3.1 Flash Lite, $0.25 / $1.5) about $0.00003. An emergency refusal costs nothing; a `personal_medical`
refusal costs the one guard call every review already makes. The per-review cap and the admission reservation do not
change.
