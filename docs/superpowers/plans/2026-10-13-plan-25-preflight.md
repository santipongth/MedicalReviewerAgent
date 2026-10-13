# Plan 25 pre-flight scan (2026-10-13)

Plan: `docs/superpowers/plans/2026-10-13-plan-25-sentence-support.md`. Spec:
`docs/superpowers/specs/2026-10-13-plan-25-sentence-support-design.md`. Base: master `ad53132` (Plans 22a, 23a–c and 24
merged).

**How it was checked.**
- Every interface the plan quotes from master was read in the code: `LLMs.with_schema`/`for_schema`, `LimitedLLM`,
  `current_budget`/`ReviewBudget`, `HarnessRunner.call`, `harness_runner`, `prose_context`/`ProseContext`/`_admitted`,
  `verify.tokens`, `pooled_number_strings`, `unique_papers`, `design_excluded`, `related`, `_narrative_papers`,
  `_prose_context`, `make_write_synthesis`, `make_localize`, `make_finalize`, `_add_review_nodes`, `ReviewState`,
  `summarize_quality`, `stub_result`, `ReviewMetrics`/`aggregate`/`summary_rows`, the localizer's citation rule
  (`localize.citations_preserved`), and the frontend `CitedText`, `RefButtons`, `KeyFindings`, `SourceRail`,
  `BottomLine`, `Report`, `keyFindingViews`, `isNotEvidence`, `RC` and its scan test.
- The code was written and made green in a scratch copy outside the repository
  (`%TEMP%\claude\…\scratchpad\p25proto`). The plan's code sections were then generated from that copy (new files whole,
  edits as replacement pairs whose `old` is unique in master), and two further checks were run:
  - **Replay:** a fresh copy of master (`p25replay`) received the tasks one by one from the rendered plan, test files
    first. Each task's tests were run before its code (to see them fail as the plan says), then after it, then
    `ruff` and the full backend suite, or the full frontend suite, typecheck and eslint.
  - **Parse-back:** the final plan was parsed and every block applied to another fresh copy of master (`p25back`). All
    33 touched files came out byte-identical to the verified copy (the replay copy too).
- No network call and no real LLM call was made. Backend dependencies came from the uv cache (`uv sync --offline`),
  frontend ones from the npm cache (`npm ci --offline`).

| Task | Before its code | Its tests after | ruff | Full suite |
|---|---|---|---|---|
| 1 | `ImportError: SupportBatch` | 12 passed | clean | 2237 passed, 17 skipped, 1 failed (`test_capacity.py::test_queue_position`, the known flake) |
| 2 | `ImportError: cannot import name 'support' from 'app.graph.nodes'` | 79 passed | clean | 2249 passed, 17 skipped |
| 3 | 3 failed (`KeyError: 'support'` ×2, `AttributeError: support_citations`) | 15 passed | clean | 2252 passed, 17 skipped |
| 4 | `Failed to resolve import "./support"` | 2 files, 50 passed | — | frontend 144 files, 1522 tests; typecheck and eslint clean |
| 5 | 5 failed, 3 passed (`support.test.tsx`) | 3 files, 70 passed | — | frontend 145 files, 1530 tests; typecheck and eslint clean |
| 6 | — | `test_api_docs_limits.py` + `test_harness_worker.py`: 35 passed | clean | backend 2252 passed, 17 skipped; frontend 145 files, 1530 tests |

Baseline before Task 1 (same host): backend 2225 passed, 17 skipped and the flaky `test_queue_position` failing once
(it then passed 2 of 3 isolated runs: timing, unrelated to Plan 25); frontend 143 files, 1515 tests. The 17 skipped are
the integration tests (they need `MRA_INTEGRATION=1` and Postgres); Plan 25 adds none and changes no migration.

**Not executed:** the integration tests, the controller's merge, the `CLAUDE.md` blob, the docker rebuild and the
smoke check (Task 6 Steps 4–6), a browser check of the rail view, and any real judge call (accuracy and latency of the
judge on real abstracts are unmeasured).

## Commands run

| Where | Command | Result |
|---|---|---|
| proto, base | `uv run --offline pytest -q` | 2225 passed, 17 skipped, 1 failed (flake) |
| proto, base | `uv run --offline pytest tests/unit/test_capacity.py -q` ×3 | 13 passed, 13 passed, 1 failed |
| proto, base | `npx vitest run` | 143 files, 1515 tests passed |
| proto, done | `uv run --offline ruff check . && uv run --offline pytest -q` | clean; 2252 passed, 17 skipped |
| proto, done | `npx vitest run && npm run typecheck && npm run lint` | 145 files, 1530 tests; clean; clean |
| replay | `python replay.py plan.md p25replay v2 1 6` (then 4–6 again after a console-encoding crash of the script's own print; the task 4 files were reset first) | the table above |
| replay | Task 5 tests against master's components | 5 failed, 3 passed |
| parse-back | `python parseback.py plan.md p25back p25proto` | 33 blocks, 33 files, mismatched: none |
| replay vs proto | `cmp` over the 33 changed files | identical |

## Task pairs that share a file or an interface

| Task A | Task B | A produces → B consumes | Finding | Fix |
|---|---|---|---|---|
| 1 | 2 | `SupportBatch`, `build_pairs`, `judge_items`, `verdict_problems`, `verdicts`, `citation`, `claim_record`, `claim_checks` → `make_check_support` | `claim_checks` must see the prose context `write_synthesis` used, or the number rule differs from the one that cleaned the summary | The node rebuilds it with `_prose_context(state, _narrative_papers(state), matrix, meta)`, the writer's own call |
| 1 | 2 | `claim_checks` uses `prose.unverified_numbers`, which admits pooled values (they are in `ctx.allowed`) | A pooled restatement would pass the number rule | `computed` is checked separately (`pooled_keys`), and a computed claim is never judged and never badged (`test_papers_that_are_not_evidence_and_pooled_claims_are_never_judged`) |
| 1 | 3 | `finding_claims`, `claim_record` → `_stub_support` | The stub must have the engine's shape | `test_the_stub_result_carries_support_in_the_engine_shape` compares the key sets of claims and citations |
| 1 | 4 | `MARKER` (backend) and `CITE` (frontend `CitedText`, `support.ts`) | Must be the same pattern, or marker k differs between sides | Both are `\[(P\d+(?:\s*,\s*P\d+)*)\]`; a range is no marker on either side (tests on both) |
| 2 | 3 | `result.support.claims[].citations[]` (`label`, `verified`, `not_evidence`) → `review_metrics` | Consistent | — |
| 2 | 4, 5 | `markers`, claim `id`/`where`/`markers`/`finding`, `verified`, `display_aligned` → `alignMarkers`, `findingClaim`, `isChecked` | Consistent; the UI adds `isNotEvidence` on top of `verified` | — |
| 2 | existing tests | `bind_by_role` returns the role's own fake for an unknown schema | The judge ran on the screener's `ScreenBatch` fake: the 50-paper test saw 14 screener calls instead of 12 | `make_deps` binds `SupportBatch` to a free fake judge (`support_judge`) |
| 2 | existing tests | `test_eval_graph.py` asserts `asked == [("planner", OutcomeMatch)]` | The eval graph shares `_add_review_nodes`, so the replay now also asks for `("screener", SupportBatch)` | The assertion filters to `OutcomeMatch` (the eval replay does run the check: the metric needs it) |
| 2 | existing tests | `values["cost_usd"] == 0.01 * all_calls(deps)` | A paid fake judge would break it | The test judge costs 0.0; node tests assert cost on their own |
| 2 | graph | `localize` and `check_support` both feed `finalize` | `finalize` must run once | Both run in the same superstep; `test_full_review_checks_sentence_support_beside_localize` counts one `finalizing` event |
| 2 | timed stub graph | node names | The timed stub chain has no `check_support`; its `finalize` returns `stub_result`, which carries `support` from Task 3 | No stub node needed; no new SSE event |
| 2 | 6 | `prompt_version` | The docs header names the version | Task 6 edits it to 2026-10-13.1; the pin comment is updated in Task 2 |
| 4 | 5 | `RC.support` (keys, `state: Record<SupportState, Pair>`), `Select` gaining `claim` | 44 existing `Select` uses | The third parameter is optional; typecheck clean; `onSelect(ref)` is still called with one argument when there is no claim, so `toHaveBeenCalledWith("P3")` tests hold |
| 4 | i18n scan | `RC.support` pairs | English copy must hold no Thai, Thai copy must be Thai | Passes (`i18n-report.test.ts` in Task 4's run) |
| 5 | i18n scan | component literals | "✓" is the only literal added in components | Not Thai or English words; the scan passes |
| 6 | `test_api_docs_limits.py` | `docs/api.md` | "15–30 pairs" matched the stale paper-count pattern `5[-–]30` | Reworded ("about 24 pairs"); Task 6 warns about it |
| all | `test_prompts_by_type.py` | existing pins | No existing prompt changed | Every pin holds; two new pins for the judge |

## Each task against itself

| Task | Tests vs code; files created vs touched | Finding | Fix |
|---|---|---|---|
| 1 | 12 tests; 1 module and 1 test file created, 2 files modified | A group after the full stop followed by a capital ("similar. [P5] Follow-up") did not end the sentence | The claim boundary also follows `]` |
| 1 | — | The number-rule test first used "3 cohorts" (no study noun the count rule knows) | Uses a context number ("type 2 diabetes") instead |
| 1 | — | The pooled claim failed `numbers_checked` in the test because the test context had no pooled values | The test context passes `values=["0.84"]`, as `write_synthesis` does |
| 1 | — | `STOPWORDS = frozenset("""…""".split())` tripped ruff SIM905 | The text is a named string, split once |
| 2 | 9 node tests, 1 graph test, 1 pin test, 2 test edits; 1 node created, 7 files modified | The not-evidence test ticked `"cohort"`, which is not a canonical study type | `"Cohort"` |
| 2 | — | A file edit made through a Bash heredoc kept `\s` only by luck | The plan says to use the editor tools; every block in it was applied by the parse-back, not by a shell |
| 3 | 2 stub tests, 1 metric test; 3 files modified | The stub test first lived in Task 2's test file, so Task 2 could not pass alone | Its own file, `test_support_stub.py` |
| 4 | 7 tests; 1 module and 1 test file created, 2 files modified | Consistent | — |
| 5 | 8 tests; 5 components modified, 1 test file | Consistent; no DESIGN.md token change (existing `ink`, `rule`, `harm`, `warn`, `surface`) | DESIGN.md text in Task 6 |
| 6 | docs tests | See the docs row above | — |

## Cost check (no call made)

Measured prompt sizes with `prompts.support_user`: 24 pairs at typical lengths (claim 220, candidates 260 characters)
are 20,678 characters with the system prompt, about 5,200 tokens; 30 pairs at the clip limits are 51,326 characters,
about 12,800 tokens. Prices from the committed OpenRouter catalog fixture: Qwen3.5 Flash $0.065 / $0.26 per 1M (input /
output), Gemini 3.1 Flash Lite $0.25 / $1.5. Typical about $0.0005 per review; worst (three attempts at the largest
size plus an escalation) about $0.008, below `MIN_BUDGET_USD` ($0.01) and the smallest review cap ($0.08).
