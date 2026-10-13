# Plan 23e pre-flight scan (2026-10-14)

Plan: `docs/superpowers/plans/2026-10-14-plan-23e-provider-keys.md`. Spec:
`docs/superpowers/specs/2026-10-13-plan-23e-provider-keys-design.md` (`81c32ee`). Owner-approved design:
`C:\Users\santi\.claude\plans\rippling-toasting-whisper.md`. Base: master `cab96c4` (Plan 30 merged).

**How it was checked.**
- Spec section 14 (rebasing on Plan 30) was resolved against `cab96c4`: `refresh_llms`/`poll_runtime` keep the 23b/23c
  flow, so the keys revision is a second value inside `refresh_llms`; the heartbeat keeps Plan 30's format and pruning
  (`LOADED_MAX_AGE` 3 min) and gains `keys`/`keys_error` in `report_state`'s `extra`; `pipeline_version`/`run_version`
  are untouched (a key is not in the cache key); Plan 30 added no migration, so `down_revision = "b3d5f7a9c1e2"`;
  `prompt_version` stays `2026-10-14.1`.
- `cryptography` was confirmed offline: it is in `uv.lock` (50.0.2, through `authlib`) and
  `uv add --offline "cryptography>=50.0"` succeeded, changing only `pyproject.toml` (1 line) and `uv.lock` (2 lines).
- Every interface the plan quotes from master was read in the code (list in the plan's header).
- The code was written and made green in a scratch clone outside the repository (`%TEMP%\claude\…\scratchpad\p23eproto`),
  one commit and tag per task (`t0` = `81c32ee` … `t7`). The plan's code sections were generated from those tags (new
  files whole; edits as replacement pairs whose `old` is unique in the file at that task's start). Then:
  - **Replay:** a fresh clone of the branch (`p23ereplay`, own uv environment, `npm ci --offline`) received the tasks
    one by one from the rendered plan, test files first. Each task's tests were run before its code, then after it,
    then ruff and the full backend suite, or for Task 6 the full frontend suite, typecheck, eslint and the two touched
    e2e specs (port 3123 through a temporary config, deleted afterwards). The replay matches the prototype's `t7` on
    all 52 changed files (`cmp`).
  - **Parse-back:** the final plan was parsed and every block applied to another fresh copy of `t0` (`p23eback2`):
    56 blocks, 52 files, all byte-identical to `t7`, and no file changed by the prototype is missing from the plan.
  - **Smoke:** the controller's smoke script (`smoke23e.run` and `smoke23e.leaks`) was run in-process against the app
    (sqlite, fakeredis, an offline catalog, no worker) with a fresh secret; its output is quoted in the plan. The
    secret helper was run twice on a scratch `.env` (sets once, keeps it, never prints it).
- No network call and no real LLM call was made. Backend dependencies came from the uv cache, frontend ones from the
  npm cache. The live stack (`D:\MedicalReviewerAgent`) and port 3100 were not touched.

## Task pairs that share a file or an interface

| Task A | Task B | A produces → B consumes | Finding | Fix |
|---|---|---|---|---|
| 1 | 4 | `tests/unit/test_admin_models_api.py` | Task 1 changes the unpriced-Anthropic test and `HOSTILE_PROVIDERS` (+10 cases, `free_draft`); Task 4 widens the two `fake_probe` signatures (`keys=None`) | Generated per task, replayed in order |
| 1 | 4 | `llm_validate.py`, `llm_store.py` | Same files, distinct places (Task 1 `document_errors`/`save_version`; Task 4 ring-aware warnings, `publish_keys_version`) | Generated per task; `llm_store` → `llm_validate` → `llm` → `llm_keys` has no cycle |
| 1 | 3 | `build_role_llm` kind checks | Between Tasks 1 and 3 a free name has no env key; on a public host it would get `"not-needed"` (no key sent, nothing leaked, no API to add one yet) | Task 3 makes it `MissingKeyLLM` |
| 2 | 3 | `llm_keys` imported by `llm.py` | `llm_keys` must not import `llm` | `env_key` duplicates `_api_key`'s two-line legacy read; `_api_key` stays for its old callers |
| 3 | existing tests | `probe(..., keys=)` | `test_llm_probe.py` builds take `(r, settings, catalog, schema=None)` | `probe` passes `keys` to `build` only when given |
| 4 | existing tests | `probe` now called with `keys=` | `fake_probe(role, settings, catalog=None)` would raise | The two fakes gain `keys=None` (Task 4 edit) |
| 5 | `test_llm_reload.py`, `test_runtime_reload.py` | ctx without `llm_keys_version` | An empty table must not look like a change | Missing is read as `"none"`; job start uses `MGET` (the `Down` fakes have `mget`) |
| 5 | Plan 30 | `run_version` | A keys reload must not change the version string | Pinned by `test_a_key_write_does_not_move_the_result_cache_key` |
| 6 | `e2e/admin-models.spec.ts` | the header's missing-key text | The spec pins "OPENROUTER_API_KEY ยังไม่ได้ตั้ง: role ที่ใช้ provider นี้จะรันไม่ได้" | Legacy names keep that exact text; free names and problems get new lines |
| 6 | `models-catalog.test.tsx` | the catalog's declared provider | The spec asked for `kind: "openrouter"`; the test pins `{api_key_env}` | Left unchanged: the legacy name infers its kind (deviation 7) |
| 7 | docs test | `docs/api.md` | A wrapped message would not match `KEY_TEXT_ERROR` | The message sits on one line; pinned |

## Each task against itself

| Task | Tests vs code; files | Finding | Fix |
|---|---|---|---|
| 1 | 68 new tests + 10 hostile cases; 1 test file created, 2 test files and 8 files modified | Price errors listed every fallback copy of the planner (6 lines for one role) | A copied role is skipped when the role it copies is listed |
| 1 | — | `default_provider` "always checked" (spec 5.1) in `_check` would stop a stored version from loading | Moved to `document_errors` (validate/save only): deviation 2 |
| 1 | — | The pydantic message for an unknown role provider changed (no `Literal`) | `test_llm_config.py` expects "Provider 'bedrock' is not configured" |
| 2 | 23 tests + 1 integration test; 3 files created, 5 modified | Autoflush inserted the row before its revision was set (NOT NULL) | The revision is computed before the row joins the session |
| 2 | — | The integration test needs a Postgres it can wipe | Not executed; the live Postgres is never used |
| 3 | 11 tests; 1 test file created, 5 files modified | A chained provider exception would keep the unredacted text | Provider errors are raised `from None` after `redact` |
| 4 | 22 tests; 1 file and 1 test file created, 4 files and 1 test file modified | `Path(pattern=...)` is a search, so "Bad-Name" matched | Patterns anchored `^…$` (path and test body) |
| 5 | 9 tests; 1 test file created, 2 files modified | — | Config and keys changes share one locked reload (deviation 4) |
| 6 | 3 test files (22 tests), fixtures, 1 e2e spec (8 tests); 3 files created, 6 modified | A password input drops line breaks, so a pasted "key\n" arrives without them | Test uses a trailing space (the server strips it) |
| 6 | — | A second landmark named "worker" | The workers section has no landmark name |
| 7 | 3 docs tests; 1 test file created, 4 files modified | Consistent | — |

## Deviations from the spec (all small; none changes a security property)

1. **No Postgres sequence.** `revision = max(revision) + 1` under the advisory lock `MRALLMKY`, on Postgres and sqlite
   alike. Rows are never deleted (tombstones), so it only grows; the whole path is unit-tested.
2. **`default_provider` must exist** is a validate/save error (`document_errors`), not a parse rule, so stored versions
   keep loading (spec 5.2's promise).
3. **PUT/DELETE answer the whole key state** plus `workers_notified` (not one row); the page replaces its state with it.
4. **One reload path** for config and keys: under the lock the worker reads the DB's config and key ring together and
   rebuilds; a keys-only change keeps the config, its label and the semaphore (as specified), it just re-reads the config.
5. **Key status `not_needed`** is added to `key_status` for a keyless local server (the header needs it).
6. **Templates** carry no pricing links (unverified URLs left out) and the presets tab does not prefill
   `structured_output` from a template.
7. **Catalog tab unchanged** (no `kind: "openrouter"` written; the legacy name infers it).
8. **`missingKeyEnvs` kept** as a wrapper of the new `missingKeys`, so its existing tests stand.

## Results

Baseline (`81c32ee`, same host): backend 2656 passed, 17 skipped; frontend 155 files, 1662 tests (3 known-flaky
timeouts in the full run).

| Task | Before its code | Its tests after | ruff / typecheck / eslint | Full suite |
|---|---|---|---|---|
| 1 | collection error (`is_local_origin`) | 165 passed | ruff clean | backend 2734 passed, 17 skipped |
| 2 | collection error (`app.services.llm_keys`) | 23 passed | ruff clean | backend 2757 passed, 18 skipped |
| 3 | collection error (`eval_keys`) | 11 passed | ruff clean | backend 2768 passed, 18 skipped |
| 4 | collection error (`KEYS_VERSION_KEY`) | 103 passed | ruff clean | backend 2790 passed, 18 skipped |
| 5 | 7 failed, 59 passed | 66 passed | ruff clean | backend 2799 passed, 18 skipped |
| 6 | the new test files fail | 6 files, 122 passed | clean / clean | frontend 158 files, 1684 tests, 3 known-flaky timeouts (passed alone: 2 files, 47 tests); e2e 19 passed |
| 7 | — | docs tests 13 passed | ruff clean | backend 2802 passed, 18 skipped |

The 18th skipped test is the new integration test (`tests/integration/test_llm_keys_migration.py`).

## Commands run

| Where | Command | Result |
|---|---|---|
| proto | `uv add --offline "cryptography>=50.0"` | 1 + 2 lines, no download |
| proto, base | `uv run --offline pytest -q` | 2656 passed, 17 skipped |
| replay, base | `npx vitest run` | 155 files, 1659 passed, 3 known-flaky timeouts |
| proto, t6 | `npx playwright test -c pw-alt.config.mjs e2e/admin-providers.spec.ts e2e/admin-models.spec.ts` (port 3123) | 19 passed |
| proto | `python run_smoke23e.py` (in-process) | the lines quoted in "After the plan (controller)" |
| replay | `python replay23e.py plan.md p23ereplay <env> 1 7` | the table above |
| replay vs proto | `cmp` over the 52 changed files | identical |
| parse-back | `python parseback30.py plan.md p23eback2 p23eproto t7` | 56 blocks, 52 files, mismatched: none, not in plan: none |

**Not executed:** the integration tests (no disposable Postgres), the Postgres advisory-lock branch, the controller's
merge, the `CLAUDE.md` lines, the secret in the live `.env`, the docker rebuild and the smoke inside the containers
(including the workers' `keys` report and the log grep), and any real provider call (the owner presses "ทดสอบ").

## Cost check (no call made)

No prompt, schema or model call changes, so a review costs what it did. A worker reloads its LLMs once per key write
(no network). The API decrypts the stored keys (a handful of Fernet operations) on each `GET /admin/llm-keys`,
`GET /admin/llm-config`, validate and test call. The probe's $0.05 gate and 10/minute are unchanged; a provider
test with `price_in`/`price_out` left out is charged 0 against that gate, so its spend is bounded by the 512-token
cap, as for any probe.

## Concerns for the controller

- The admin sign-in is still `admin`/`admin` over HTTP (spec section 11): tell the owner again before a real key is
  entered.
- The smoke saves two config versions; the clean-up deletes them (the 23b/23c precedent) so the cache generation and
  the history return to what they were.
- `LLM_KEYS_SECRET` lives only in `.env`; the owner must back it up outside the repository.
