# Plan 23c: Admin Settings, Glossary and Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the admin console, change the runtime limits and the Thai glossary, and read, compare and start Cochrane harness runs. Settings and glossary changes are versioned, restorable and audited, and every process picks them up without a restart. A harness run starts only with a USD cap the admin types.

**Architecture:**
- **Versioned documents:** one generic store (`config_store`, the 23b rules) keeps two kinds in `config_versions`: `settings` (sparse overrides of env values) and `glossary` (Thai terms). Each kind has a Redis mirror.
- **API processes:** they read the mirrors through `RuntimeConfig`, cached for 5 s per process, with the DB as fallback.
- **Workers:** they extend the 23b reload hook and its rules. A job start trusts the Redis mirrors; the 30-second poll reads the DB and repairs the mirrors (23b's `reconcile_version_key`, here `reconcile_mirror`). On a change they rebuild their graph deps (settings, glossary, and the LLM semaphore when `llm_concurrency` changed) under 23b's `llm_lock`.
- **Localizer:** it reads the glossary from the graph deps. The seed is the built-in text, byte for byte.
- **Harness runs:** a separate arq queue and worker (compose profile `harness`) run them through `run_all` with a strict cap.
- **Admin side:** thin routes over these services feed three client pages. The settings and glossary pages reuse the models page's draft, 409 and worker-polling rules (23b's `ModelsView`), moved into shared helpers.
- **Carried from the 23b final review (Task 14):** a validate warning for models with no known price, a readable `/admin/llm-config` when the newest saved version no longer parses, and bounds on `harness.screen_borderline`.

**Tech Stack:**
- **Backend:** FastAPI, SQLAlchemy async, Alembic, Redis (fakeredis in tests), arq.
- **Frontend:** Next.js 16 client components, Vitest and Testing Library, Playwright with axe.

**Spec:** `docs/superpowers/specs/2026-10-13-plan-23c-settings-glossary-harness-design.md`

**Worktree:** `D:\MRA-plan-23c` (branch `plan-23c-settings-glossary-harness`).
- It was created from master `fdb7ec5`, which has Plan 23b merged. Its first commit holds the spec, this plan and the pre-flight scan (`docs/superpowers/plans/2026-10-13-plan-23c-preflight.md`).
- The Bash cwd resets between calls, so every command starts with `cd /d/MRA-plan-23c/backend` or `cd /d/MRA-plan-23c/frontend`.
- The frontend needs `npm ci` once (Task 10).
- **23b interfaces this plan uses**, checked against master `fdb7ec5` on 2026-10-13:
  - `llm_store`: `report_loaded`, `loaded_workers`, `load_effective`/`EffectiveConfig` (`.resolve()`, `.label`), `publish_version`'s WATCH/MULTI pattern, `reconcile_version_key`'s rules, `NOTE_MAX`;
  - `llm_reload`: `refresh_llms(ctx, *, build_graph_fn=build_graph, poll=False)`, `report_state`, `init_llms`, `stop_llms` (it cancels `ctx["llm_poller"]`), `worker_id`, `POLL_SECONDS` and the worker's one-attempt `load_live_catalog`;
  - `model_catalog.cached_catalog(redis, loader)`; `llm_config`: `has_bad_text`, `ensure_storable`, `LLMConfigError`, `CONFIG_ERRORS`, `config_error_text`, `HarnessSpec`;
  - `admin_models.Note` and its `_write` pattern (`workers_notified` in the 201);
  - the eval CLI's `eval_llm_config`, `EvalConfigError`, `_why`, `eval_main(settings, config_file, rest, session_factory_maker, release_db)`, and `RunRecord.llm_config` with its mixed-batch check;
  - the frontend's `ModelsView` (draft `{doc, origin, base, refused}`, `load(saved, savedId)`, header polling while a worker lags), `ModelsHistory`, `WriteTracker`, `WORKERS_NOT_NOTIFIED`, `ConfirmButton`'s `hint` and `TABLE_REGION`.
- When master differs from what is quoted here, follow master and note it in the task report.

## Global Constraints

- **Dependencies:** none new, backend or frontend.
- **Redis keys:**
  - `mra:settings:active`: JSON `{"version": n, "values": {...}}`.
  - `mra:glossary:active`: JSON `{"version": n}`.
  - Both mirrors only move forward (WATCH/MULTI, as 23b's `publish_version`). A reader that finds a mirror missing reads the DB and refills it with `SET NX`.
  - The workers' 30-second poll makes each mirror agree with the DB (`reconcile_mirror`, the rules of 23b's `reconcile_version_key`): a lost publish is republished, and a mirror above the DB is set back, or deleted while the kind has no version.
  - `mra:harness:worker`: JSON `{"worker", "seen_at"}`, written every 30 s with `EX 90`.
  - Each `mra:llm:loaded` entry (23b) gains `settings`, `glossary` and `runtime_error`, through `report_loaded(..., extra=)`; 23b's own fields are unchanged.
- **Versions:**
  - Numbered per kind from 1, with `(kind, version)` unique. Rows are never updated or deleted.
  - `base_version` is `null` while a kind has no version; a stale base gives 409.
  - `source` is `edit | restore | reset`, and the note is at most 500 characters.
  - Saves take the Postgres advisory lock `0x4D52_4152_5443_4647`.
- **Audit:**
  - Actions: `settings.save|restore|reset`, `glossary.save|restore|reset`, `harness.start` and `harness.cancel`.
  - Target types: `settings` and `glossary` (target id = version), and `harness_run` (target id = row id).
  - The row is written in the same transaction as the change.
- **Editable settings (exactly these 13):**

  | Name | Type | Bounds |
  |---|---|---|
  | `review_rate_limit`, `api_key_rate_limit`, `paper_search_rate_limit` | rate, `^[1-9][0-9]{0,4}/(second\|minute\|hour\|day)$` | |
  | `sse_max_per_ip` | int | 1–50 |
  | `max_queued_reviews` | int | 1–1000 |
  | `max_reviews_per_day` | int | 1–100000 |
  | `max_usd_per_day` | float | 0.1–1000 |
  | `review_cost_base_usd` | float | 0–1 |
  | `review_cost_per_paper_usd` | float | 0–0.1 |
  | `review_cost_per_candidate_usd` | float | 0–0.01 |
  | `max_cost_per_review_usd` | float | 0.05–5 |
  | `llm_concurrency` | int | 1–64 |
  | `result_cache_ttl_seconds` | int | 0–2592000 |

  - A document is `{"values": {...}}`, and reset is `{"values": {}}`.
  - `max_usd_per_day` must be at least `worst_case_review_cap(effective)`.
  - Every other `Settings` field stays env-only, `HARNESS_MAX_USD` included.
- **Propagation:**
  - API: `RuntimeConfig` caches for `RUNTIME_TTL_SECONDS = 5.0`, and the saving process invalidates at once. With Redis and the DB both down, it keeps the last known values, or env when it has none. Never a 500.
  - Workers: reload at each job start (the mirrors) and on the 30-second poll (the DB, as 23b's `refresh_llms(poll=True)`); `refresh_runtime` runs before `refresh_llms`, under the same `llm_lock`. A poll that finds the worker already on the DB's versions clears a stale `runtime_error`.
- **Glossary:**
  - 1–200 terms. `en` ≤ 120 (aliases split by `/`); `th` ≤ 120, with Thai script and no brackets; `abbr` ≤ 24, no brackets; `note` ≤ 300, never rendered.
  - No `;` or `=` in `en`, `th` or `abbr`, no control characters, and no `has_bad_text`.
  - An English alias may appear once (case-insensitive). The rendered text is at most 4000 characters, as `en = th (ABBR)` joined by `"; "`.
- **Seed pin:** with no glossary version, `sha256(localize_system("th"))` is `607f7ea53d5d743d0cbf6707c4553ea3ec1e0f923d708e3d8db70de38a822deb`. `prompt_version` is not bumped.
- **Cache key:** `f"{prompt_version}+llm{llm_id}"`, plus `f"+g{glossary_version}"` only while a glossary version exists. Settings never enter it.
- **Harness:**
  - Queue and worker: queue `arq:harness`; `HarnessWorkerSettings` with `max_jobs = 1`, a job timeout of `43200` s and `max_tries = 3`.
  - Start body:
    - the cap is at least the per-review cap of the selection and at most `settings.harness_max_usd` (env `HARNESS_MAX_USD`, default `5.0`, the owner's eval budget cap of 2026-10-12); the form defaults to `1.00`;
    - `repeats` 1–2, `max_reviews` 1–1000, and at most 20 `strata` of up to 64 characters;
    - `compare_run` matches `^[A-Za-z0-9][A-Za-z0-9._-]{0,63}/[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`;
    - `confirm: true` is required, and extra fields are refused.
  - Run rules: one active run (the unique `active` column). The batch never starts a review unless `spent + its cap ≤ max_usd`. A retried job counts earlier spend from the run files. Cancel is graceful. `run_id` is `console-YYYYMMDD-HHMMSS-xxxx` (UTC, then 4 random hex digits).
  - Reports: a name must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.md$`, must not be a symlink, must sit directly in `reports/` and must be ≤ 1,000,000 bytes.
- **Money:** no code path in 23c calls a provider on its own. Unit tests use fakes. The docker smoke check never posts a start that could pass.
- **Errors:** validation errors are lists of `{field, message}`. Messages name fields or cells (`terms.3.th`) and never echo submitted text.
- **Docker:**
  - The `harness` service has `profiles: ["harness"]` and mounts `./backend/evals/cochrane:/app/evals/cochrane`.
  - `api` mounts the same path `:ro`.
  - `backend/.dockerignore` excludes `evals/cochrane/fixtures`, `evals/cochrane/runs` and `evals/cochrane/*.bak`.
- **Admin routes:** under `/api/v1/admin`, with `Depends(require_admin)`, registered with `include_in_schema=False`. Writes need the cookie + `X-MRA-Admin: 1`, or an admin key. Keep the `from app.api import (...)` list in `main.py` sorted (ruff I001).
- **Migrations:** a migration test pins its downgrade target to a named revision constant (`BEFORE_RUNTIME = "f2a4c6e8b0d1"`, as 23a's and 23b's tests do), never `"-1"`, so a later migration cannot change what it undoes.
- **UI:**
  - Thai labels with English technical terms.
  - DESIGN.md rules as in 23a/23b: `rounded-sm`, 1px `rule` borders, `min-h-11` targets, status blocks as a tint plus text (`bg-info-bg`, `bg-warn-bg`, `bg-err-bg`), and setting names in `font-code`.
  - Every `<table>` has a `<caption>` (screen-reader only is fine); `src/components/tables-caption.test.ts` fails otherwise.
  - No Martian Mono and no `confirm()`. Costs are plain figures (`formatUsd`).
  - Effects set state only inside promise callbacks, and nothing reads a ref during render (`react-hooks/refs`): a hook returns plain values, and the component that renders a focused note owns its ref.
  - Focus moves to the page notice after an action that unmounts the focused control.
  - The settings and glossary pages follow the models page (23b): a draft keeps its base version, a 409 re-reads and keeps the draft, the page offers "ทิ้งการแก้ไข" (confirmed) or "ใช้ร่างนี้ต่อจากเวอร์ชันล่าสุด", it re-reads every 10 s while a worker lags after a write, and a `workers_notified: false` answer shows `WORKERS_NOT_NOTIFIED`.
- **Do not touch** `CLAUDE.md`, `frontend/CLAUDE.md` or `infra/searxng/limiter.toml.new` in `D:\MedicalReviewerAgent`. The CLAUDE.md line is added after the merge.
- **Commits:** every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Spending past the cap** (Tasks 7, 8 and 9):
   - `run_all(strict_cap=True)` never starts a review whose own cap does not fit in what is left (Task 7, `test_strict_cap_never_starts_a_review_that_does_not_fit`).
   - A retried job passes `spent_before` from the run files (Task 9, `test_earlier_spend_counts_and_the_cap_stop_is_recorded`).
   - A start over `HARNESS_MAX_USD` ($5), below one review's cap, without `confirm: true` or while a run is active creates no row and enqueues nothing (Task 8, `test_bad_starts_create_nothing`, `test_start_enqueues_one_run_and_writes_an_audit_row`).
   - A worker whose `prompt_version` differs from the run's errors before calling anything (Task 9, `test_a_prompt_version_mismatch_errors_before_anything_runs`).
2. **Seed prompt drift** (Tasks 2 and 4): with no glossary version, `localize_system("th")` matches the sha256 pin, and the cache key has no `+g` suffix. Old cached results stay valid (Task 2, `test_the_seed_prompt_is_byte_identical`; Task 4, `test_the_cache_key_is_unchanged_until_a_glossary_is_saved`).
3. **Hot path when Redis or the DB is down** (Tasks 3, 4 and 5):
   - `/status`, review creation, SSE and paper search read the 5-second cache (Task 4, `test_runtime_api.py`).
   - Redis down means the DB; both down means the last known values, or env. Never a 500 (Task 3, `test_runtime_config_keeps_the_last_values_when_everything_is_down`; Task 1, `test_read_active_survives_redis_being_down`).
   - A stored value that no longer validates is skipped, not raised (Task 3, `test_overrides_apply_and_bad_stored_values_are_skipped`).
   - A publish that failed reaches the API and the workers through the workers' DB poll (Task 5, `test_a_poll_picks_up_a_version_whose_publish_was_lost_and_repairs_the_mirror`).
4. **Unsafe report names and bodies** (Tasks 6 and 8):
   - `../`, encoded slashes, dot files, symlinks, non-`.md` names and files over 1 MB are 404 (Task 8, `test_reports_are_listed_and_read_and_unsafe_names_refused`, `test_a_symlinked_report_is_refused`).
   - Lone surrogates, NUL and deep bodies are 422, never 500 (Task 6, `test_bad_bodies_are_422_never_500`, `test_deep_bodies_are_refused_and_never_echoed`).
   - No message echoes submitted text (Task 2, `test_errors_never_echo_submitted_text`; Task 3, `test_validation_names_fields_and_never_echoes_a_bad_name`).
5. **Reload consistency** (Task 5):
   - A worker swaps settings, glossary and (on an `llm_concurrency` change) its semaphore and LLMs together under `llm_lock` (`test_a_concurrency_change_gives_new_reviews_a_new_semaphore`).
   - A running review keeps the graph it started with (`test_a_change_rebuilds_deps_and_graph_and_a_running_graph_keeps_its_own`).
   - A failed reload keeps everything and reports `runtime_error`, and the next poll retries; a poll clears an error that no longer applies (`test_a_failed_reload_keeps_the_old_state_and_reports_it`, `test_a_poll_clears_a_stale_error_and_keeps_one_that_still_applies`).

---

### Task 1: The `config_versions` and `harness_runs` tables and the versioned document store

**Files:**
- Modify: `backend/app/db/models.py` (append `ConfigVersion`, `HarnessRun`)
- Create: `backend/migrations/versions/b3d5f7a9c1e2_runtime_config_and_harness_runs.py`
- Create: `backend/app/services/config_store.py`
- Test: `backend/tests/unit/test_config_store.py`, `backend/tests/integration/test_runtime_config_migration.py`, `backend/tests/integration/test_config_store_concurrency.py`

**Interfaces:**
- Consumes: `record` (`app.services.audit`); `AdminPrincipal`; `Conflict`, `NotFound` (`app.services.review_service`); `Settings`; from 23b, `ensure_storable` and `LLMConfigError` (`app.services.llm_config`).
- Produces:
  - Models `ConfigVersion` (`id, kind, version, created_at, created_by, note, source, restored_from, document, changes`) and `HarnessRun` (fields in Step 3).
  - `DocumentError(errors)` with `.errors: list[{"field": str | None, "message": str}]`; `str(exc)` is the first message.
  - `DocKind(name, redis_key, validate, summarize, seed, mirror)`, where `validate(raw, settings) -> (document, warnings)`.
  - `Active(version: int | None, mirror: dict)`.
  - Constants `NOTE_MAX = 500`, `PUBLISH_ATTEMPTS = 3`, `CONFIG_SAVE_LOCK`.
  - `async newest(session, kind)`.
  - `async save_version(session, actor, kind, raw, *, settings, base_version, note=None, source="edit", restored_from=None, ip_hash=None) -> ConfigVersion`.
  - `async restore_version(session, actor, kind, version, *, settings, base_version, note=None, ip_hash=None)` and `async reset_to_seed(session, actor, kind, *, settings, base_version, note=None, ip_hash=None)`.
  - `async list_versions(session, kind, *, before=None, limit=50) -> (rows, next)` and `async get_version(session, kind, version)` (raises `NotFound`).
  - `version_out(row) -> dict` (`version, kind, created_at, created_by, note, source, restored_from, changes`).
  - `mirror_version(raw: str | None) -> int | None`.
  - `async publish(redis, kind, row) -> bool`.
  - `async read_active(session_factory, redis, kind) -> Active`.
  - `async reconcile_mirror(redis, session_factory, kind) -> int | None` (the DB's newest version; the rules of 23b's `reconcile_version_key`, used by the worker poll in Task 5).

- [ ] **Step 1: Write the failing unit tests**

`backend/tests/unit/test_config_store.py`:

```python
import json

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.config import Settings
from app.db.models import AdminAudit, ConfigVersion, HarnessRun
from app.services.admin_auth import AdminPrincipal
from app.services.config_store import (
    DocKind,
    DocumentError,
    get_version,
    list_versions,
    mirror_version,
    newest,
    publish,
    read_active,
    reconcile_mirror,
    reset_to_seed,
    restore_version,
    save_version,
    version_out,
)
from app.services.review_service import Conflict, NotFound

OWNER = AdminPrincipal(kind="user", id=None, label="owner")
SETTINGS = Settings(_env_file=None)


def _validate(raw, settings):
    if not isinstance(raw, dict) or not isinstance(raw.get("n"), int):
        raise DocumentError([{"field": "n", "message": "n: must be a whole number"}])
    return {"n": raw["n"]}, (["big"] if raw["n"] > 9 else [])


DEMO = DocKind(name="demo", redis_key="mra:demo:active", validate=_validate,
               summarize=lambda old, new: {"n": f"{(old or {}).get('n')} → {new['n']}"},
               seed=lambda: {"n": 0}, mirror=lambda doc: {"n": doc["n"]})
OTHER = DocKind(name="other", redis_key="mra:other:active", validate=_validate,
                summarize=lambda old, new: {}, seed=lambda: {"n": 0}, mirror=lambda doc: {})


async def save(session_factory, kind, n, base, **kw):
    async with session_factory() as s, s.begin():
        return await save_version(s, OWNER, kind, {"n": n}, settings=SETTINGS, base_version=base, **kw)


async def test_versions_count_per_kind_and_a_stale_base_is_a_conflict(session_factory):
    a1 = await save(session_factory, DEMO, 1, None)
    b1 = await save(session_factory, OTHER, 5, None)
    a2 = await save(session_factory, DEMO, 2, a1.version, note="n" * 600)
    assert (a1.version, b1.version, a2.version) == (1, 1, 2)
    assert len(a2.note) == 500 and a2.source == "edit" and a2.changes == {"n": "1 → 2"}
    with pytest.raises(Conflict):
        await save(session_factory, DEMO, 3, None)
    with pytest.raises(Conflict):
        await save(session_factory, DEMO, 3, a1.version)
    async with session_factory() as s:
        assert (await newest(s, DEMO)).version == 2 and (await newest(s, OTHER)).version == 1


async def test_invalid_documents_leave_no_row_and_no_audit(session_factory):
    for raw in ({"n": "x"}, ["n"], None):
        with pytest.raises(DocumentError) as info:
            async with session_factory() as s, s.begin():
                await save_version(s, OWNER, DEMO, raw, settings=SETTINGS, base_version=None)
        assert info.value.errors[0]["field"] == "n" and str(info.value) == "n: must be a whole number"
    async with session_factory() as s:
        assert (await s.execute(select(ConfigVersion))).first() is None
        assert (await s.execute(select(AdminAudit))).first() is None


async def test_a_document_the_json_column_cannot_hold_is_refused(session_factory):
    nan = DocKind(name="nan", redis_key="mra:nan:active", validate=lambda raw, settings: ({"x": float("nan")}, []),
                  summarize=lambda old, new: {}, seed=dict, mirror=lambda doc: {})
    with pytest.raises(DocumentError, match="cannot be stored as JSON"):
        async with session_factory() as s, s.begin():
            await save_version(s, OWNER, nan, {}, settings=SETTINGS, base_version=None)
    async with session_factory() as s:
        assert (await s.execute(select(ConfigVersion))).first() is None


async def test_restore_and_reset_append_copies_with_audit_rows(session_factory):
    v1 = await save(session_factory, DEMO, 1, None)
    v2 = await save(session_factory, DEMO, 2, v1.version)
    async with session_factory() as s, s.begin():
        v3 = await restore_version(s, OWNER, DEMO, 1, settings=SETTINGS, base_version=v2.version)
    assert (v3.version, v3.source, v3.restored_from, v3.document) == (3, "restore", 1, {"n": 1})
    assert v3.note == "restored from version 1"
    async with session_factory() as s, s.begin():
        v4 = await reset_to_seed(s, OWNER, DEMO, settings=SETTINGS, base_version=v3.version)
    assert (v4.source, v4.document, v4.note) == ("reset", {"n": 0}, "reset to the default")
    with pytest.raises(NotFound):
        async with session_factory() as s, s.begin():
            await restore_version(s, OWNER, DEMO, 99, settings=SETTINGS, base_version=v4.version)
    async with session_factory() as s:
        audits = list((await s.execute(select(AdminAudit).order_by(AdminAudit.id))).scalars())
    assert [a.action for a in audits] == ["demo.save", "demo.save", "demo.restore", "demo.reset"]
    assert audits[0].target_type == "demo" and audits[0].target_id == "1"
    assert audits[1].before == {"version": 1} and audits[1].after == {"version": 2, "n": "1 → 2"}


async def test_history_pages_newest_first_within_a_kind(session_factory):
    base = None
    for n in range(3):
        base = (await save(session_factory, DEMO, n, base)).version
    await save(session_factory, OTHER, 7, None)
    async with session_factory() as s:
        page, cursor = await list_versions(s, DEMO, limit=2)
        rest, end = await list_versions(s, DEMO, before=cursor, limit=2)
        with pytest.raises(NotFound):
            await get_version(s, OTHER, 2)
    assert [r.version for r in page + rest] == [3, 2, 1] and end is None
    out = version_out(page[0])
    assert out["version"] == 3 and out["kind"] == "demo" and "document" not in out


async def test_publish_only_moves_forward(session_factory, redis):
    v1 = await save(session_factory, DEMO, 1, None)
    v2 = await save(session_factory, DEMO, 2, v1.version)
    assert await publish(redis, DEMO, v2) is True
    assert await publish(redis, DEMO, v1) is True  # an older publish arriving late changes nothing
    assert json.loads(await redis.get(DEMO.redis_key)) == {"version": 2, "n": 2}
    assert mirror_version(await redis.get(DEMO.redis_key)) == 2
    assert mirror_version(None) is None and mirror_version("not json") is None
    assert mirror_version('{"version": true}') is None and mirror_version("[1]") is None


async def test_read_active_uses_redis_then_the_db_then_the_seed(session_factory, redis):
    seed = await read_active(session_factory, redis, DEMO)
    assert (seed.version, seed.mirror) == (None, {"n": 0}) and await redis.get(DEMO.redis_key) is None
    await save(session_factory, DEMO, 4, None)
    miss = await read_active(session_factory, redis, DEMO)  # nothing published: the DB, then cached with NX
    assert (miss.version, miss.mirror) == (1, {"n": 4})
    assert json.loads(await redis.get(DEMO.redis_key)) == {"version": 1, "n": 4}
    await redis.set(DEMO.redis_key, json.dumps({"version": 7, "n": 9}))
    assert (await read_active(session_factory, redis, DEMO)).version == 7


async def test_reconcile_repairs_a_lost_publish_and_a_mirror_the_db_does_not_have(session_factory, redis):
    assert await reconcile_mirror(redis, session_factory, DEMO) is None
    await redis.set(DEMO.redis_key, json.dumps({"version": 5, "n": 1}))  # a DB restored from an older backup
    assert await reconcile_mirror(redis, session_factory, DEMO) is None and await redis.get(DEMO.redis_key) is None
    await save(session_factory, DEMO, 1, None)  # saved, never published
    assert await reconcile_mirror(redis, session_factory, DEMO) == 1
    assert json.loads(await redis.get(DEMO.redis_key)) == {"version": 1, "n": 1}
    await redis.set(DEMO.redis_key, json.dumps({"version": 9, "n": 7}))  # above the DB's newest
    assert await reconcile_mirror(redis, session_factory, DEMO) == 1
    assert json.loads(await redis.get(DEMO.redis_key)) == {"version": 1, "n": 1}


async def test_read_active_survives_redis_being_down(session_factory):
    class DeadRedis:
        async def get(self, *_):
            raise ConnectionError("redis down")

        async def set(self, *_, **__):
            raise ConnectionError("redis down")

    await save(session_factory, DEMO, 3, None)
    active = await read_active(session_factory, DeadRedis(), DEMO)
    assert (active.version, active.mirror) == (1, {"n": 3})


async def test_one_active_harness_run_at_a_time(session_factory):
    def run(run_id):
        return HarnessRun(run_id=run_id, prompt_version="pv", status="queued", active=1, max_usd=1.0, repeats=1,
                          planned=2, created_by="owner")

    async with session_factory() as s, s.begin():
        s.add(run("console-1"))
    with pytest.raises(IntegrityError):
        async with session_factory() as s, s.begin():
            s.add(run("console-2"))
    async with session_factory() as s, s.begin():
        first = (await s.execute(select(HarnessRun))).scalar_one()
        first.active, first.status = None, "done"
    async with session_factory() as s, s.begin():
        s.add(run("console-2"))
    async with session_factory() as s:
        rows = list((await s.execute(select(HarnessRun).order_by(HarnessRun.id))).scalars())
    assert [(r.run_id, r.active, r.spent_usd, r.strata, r.done) for r in rows] == [
        ("console-1", None, 0.0, [], 0), ("console-2", 1, 0.0, [], 0)]
```

- [ ] **Step 2: Write the failing integration tests**

`backend/tests/integration/test_runtime_config_migration.py` (the pattern of 23b's `test_llm_config_migration.py`; the
downgrade is pinned to the revision this migration builds on, never `"-1"`):

```python
import json
import os

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from app.config import get_settings

pytestmark = pytest.mark.integration

BEFORE_RUNTIME = "f2a4c6e8b0d1"  # the revision the runtime-config migration (b3d5f7a9c1e2) builds on
TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://mra:mra@localhost:5432/mra_test")
INSERT_RUN = ("INSERT INTO harness_runs (run_id, prompt_version, status, active, max_usd, spent_usd, repeats, planned,"
              " done, failed, skipped, strata, created_by, config) VALUES (:r, 'pv', 'queued', 1, 1.0, 0, 1, 1, 0, 0,"
              " 0, '[]'::jsonb, 'owner', '{}'::jsonb)")


def test_runtime_tables_migration_constraints_and_round_trip(monkeypatch):
    engine = create_engine(TEST_DB)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    monkeypatch.setenv("DATABASE_URL", TEST_DB)
    get_settings.cache_clear()
    cfg = Config("alembic.ini")
    try:
        command.upgrade(cfg, "head")
        assert {"config_versions", "harness_runs"} <= set(inspect(engine).get_table_names())
        doc = {"terms": [{"en": "placebo", "th": "ยาหลอก", "abbr": None, "note": None}]}
        with engine.begin() as conn:
            conn.execute(text("INSERT INTO config_versions (kind, version, created_by, source, document, changes) "
                              "VALUES ('glossary', 1, 'owner', 'edit', CAST(:d AS JSONB), '{}'::jsonb)"),
                         {"d": json.dumps(doc, ensure_ascii=False)})
            assert conn.execute(text("SELECT document FROM config_versions")).scalar_one() == doc
        with pytest.raises(IntegrityError), engine.begin() as conn:
            conn.execute(text("INSERT INTO config_versions (kind, version, created_by, source, document, changes) "
                              "VALUES ('glossary', 1, 'x', 'edit', '{}'::jsonb, '{}'::jsonb)"))
        with engine.begin() as conn:
            conn.execute(text(INSERT_RUN), {"r": "a"})
        with pytest.raises(IntegrityError), engine.begin() as conn:
            conn.execute(text(INSERT_RUN), {"r": "b"})  # a second active run
        command.downgrade(cfg, BEFORE_RUNTIME)  # pinned, so a later migration cannot change what this undoes
        assert not {"config_versions", "harness_runs"} & set(inspect(engine).get_table_names())
        command.upgrade(cfg, "head")
    finally:
        get_settings.cache_clear()
        engine.dispose()
```

`backend/tests/integration/test_config_store_concurrency.py` (23b's `test_llm_store_concurrency.py` for this store: the
advisory lock lets exactly one of two saves from the same base win):

```python
import asyncio
import os

import pytest
from sqlalchemy import func, select

from app.config import Settings
from app.db.models import AdminAudit, Base, ConfigVersion
from app.db.session import make_engine, make_session_factory
from app.services import config_store
from app.services.admin_auth import AdminPrincipal
from app.services.config_store import save_version
from app.services.review_service import Conflict
from app.services.runtime_settings import SETTINGS_KIND

pytestmark = pytest.mark.integration

TEST_DB = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://mra:mra@localhost:5432/mra_test")
OWNER = AdminPrincipal(kind="user", id=None, label="owner")


@pytest.fixture
async def pg_session_factory():
    engine = make_engine(TEST_DB)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield make_session_factory(engine)
    await engine.dispose()


async def test_two_saves_from_the_same_base_cannot_both_win(pg_session_factory, monkeypatch):
    real_newest = config_store.newest

    async def newest_then_linger(session, kind):
        row = await real_newest(session, kind)
        await asyncio.sleep(0.3)  # keeps the gap between the base check and the insert open for the other save
        return row

    monkeypatch.setattr(config_store, "newest", newest_then_linger)

    async def save(n):
        async with pg_session_factory() as session, session.begin():
            return await save_version(session, OWNER, SETTINGS_KIND, {"values": {"max_queued_reviews": n}},
                                      settings=Settings(_env_file=None), base_version=None)

    results = await asyncio.gather(save(60), save(70), return_exceptions=True)

    winners = [r for r in results if isinstance(r, ConfigVersion)]
    losers = [r for r in results if isinstance(r, Conflict)]
    assert (len(winners), len(losers)) == (1, 1), results
    async with pg_session_factory() as session:
        assert await session.scalar(select(func.count()).select_from(ConfigVersion)) == 1
        assert await session.scalar(select(func.count()).select_from(AdminAudit)) == 1
```

- [ ] **Step 3: Run the unit tests to verify they fail**

Run: `cd /d/MRA-plan-23c/backend && uv run pytest tests/unit/test_config_store.py -q`
Expected: FAIL with `ImportError: cannot import name 'ConfigVersion'`.

- [ ] **Step 4: Add the models and the migration**

Append to `backend/app/db/models.py` (every import used is already there):

```python
class ConfigVersion(Base):
    """One saved runtime document (Plan 23c): kind "settings" (the admin's overrides of env settings) or "glossary"
    (the Thai glossary). Never updated or deleted; the newest version of a kind is in use, and while a kind has none
    its seed is (env values, the built-in glossary)."""

    __tablename__ = "config_versions"
    __table_args__ = (UniqueConstraint("kind", "version", name="uq_config_versions_kind_version"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    kind: Mapped[str] = mapped_column(String(16))
    version: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    created_by: Mapped[str] = mapped_column(String(64))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str] = mapped_column(String(16))  # edit | restore | reset
    restored_from: Mapped[int | None] = mapped_column(Integer, nullable=True)
    document: Mapped[dict[str, Any]] = mapped_column(JSONType)
    changes: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)


class HarnessRun(Base):
    """A Cochrane harness run started from the admin console (Plan 23c). `active` is 1 while the run is queued or
    running and NULL afterwards; its unique constraint allows one active run at a time."""

    __tablename__ = "harness_runs"
    __table_args__ = (UniqueConstraint("active", name="uq_harness_runs_active"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(64), unique=True)
    prompt_version: Mapped[str] = mapped_column(String(32))
    status: Mapped[str] = mapped_column(String(16))  # queued | running | done | stopped | cancelled | error
    active: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_usd: Mapped[float] = mapped_column(Float)
    spent_usd: Mapped[float] = mapped_column(Float, default=0.0)
    repeats: Mapped[int] = mapped_column(Integer)
    strata: Mapped[list[str]] = mapped_column(JSONType, default=list)
    max_reviews: Mapped[int | None] = mapped_column(Integer, nullable=True)
    compare_run: Mapped[str | None] = mapped_column(String(129), nullable=True)
    planned: Mapped[int] = mapped_column(Integer, default=0)
    done: Mapped[int] = mapped_column(Integer, default=0)
    failed: Mapped[int] = mapped_column(Integer, default=0)
    skipped: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    report: Mapped[str | None] = mapped_column(String(160), nullable=True)
    config: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)  # {llm_config, settings_version, glossary}
```

`backend/migrations/versions/b3d5f7a9c1e2_runtime_config_and_harness_runs.py` (`uv run alembic heads` prints `f2a4c6e8b0d1`,
23b's `llm_config_versions`, on master `fdb7ec5`; if a newer head appears, use it as `down_revision` and as
`BEFORE_RUNTIME` in the migration test):

```python
"""runtime config versions and harness runs (Plan 23c)

Revision ID: b3d5f7a9c1e2
Revises: f2a4c6e8b0d1
Create Date: 2026-10-13 09:00:00
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "b3d5f7a9c1e2"
down_revision: Union[str, None] = "f2a4c6e8b0d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

JSON = sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), "postgresql")


def upgrade() -> None:
    op.create_table(
        "config_versions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("source", sa.String(length=16), nullable=False),
        sa.Column("restored_from", sa.Integer(), nullable=True),
        sa.Column("document", JSON, nullable=False),
        sa.Column("changes", JSON, nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("kind", "version", name="uq_config_versions_kind_version"),
    )
    op.create_table(
        "harness_runs",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("run_id", sa.String(length=64), nullable=False),
        sa.Column("prompt_version", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("active", sa.Integer(), nullable=True),
        sa.Column("max_usd", sa.Float(), nullable=False),
        sa.Column("spent_usd", sa.Float(), nullable=False),
        sa.Column("repeats", sa.Integer(), nullable=False),
        sa.Column("strata", JSON, nullable=False),
        sa.Column("max_reviews", sa.Integer(), nullable=True),
        sa.Column("compare_run", sa.String(length=129), nullable=True),
        sa.Column("planned", sa.Integer(), nullable=False),
        sa.Column("done", sa.Integer(), nullable=False),
        sa.Column("failed", sa.Integer(), nullable=False),
        sa.Column("skipped", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("report", sa.String(length=160), nullable=True),
        sa.Column("config", JSON, nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id"),
        sa.UniqueConstraint("active", name="uq_harness_runs_active"),
    )


def downgrade() -> None:
    op.drop_table("harness_runs")
    op.drop_table("config_versions")
```

- [ ] **Step 5: Implement `backend/app/services/config_store.py`**

```python
"""Versioned runtime documents (Plan 23c): the runtime settings and the Thai glossary. The rules are those of the LLM
config versions (Plan 23b, app/services/llm_store.py): rows are never updated or deleted, the newest version of a kind
is the one in use, a save carries the version it was based on (409 when another one became active meanwhile), saves
are serialised by a Postgres advisory lock, and the audit row is written in the same transaction. While a kind has no
version its seed is in use (the env values for settings, the built-in glossary). Redis mirrors the active version of
each kind under kind.redis_key as JSON (the version plus kind.mirror(document)); the mirror only ever moves forward,
and a reader that finds it missing or unreachable reads the database."""
from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from redis.exceptions import WatchError
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.db.models import ConfigVersion
from app.logging import get_logger
from app.services.admin_auth import AdminPrincipal
from app.services.audit import record
from app.services.llm_config import LLMConfigError, ensure_storable
from app.services.review_service import Conflict, NotFound

log = get_logger(__name__)

NOTE_MAX = 500
PUBLISH_ATTEMPTS = 3
# Postgres advisory-lock key ("MRARTCFG") that serialises saves of every kind; held until the caller commits, so a
# second save from the same base reads the first one's row and gets the Conflict.
CONFIG_SAVE_LOCK = 0x4D52_4152_5443_4647
_VERB = {"edit": "save", "restore": "restore", "reset": "reset"}


class DocumentError(ValueError):
    """A document failed validation. `errors` lists {"field": str | None, "message": str}; a field names a setting
    or a glossary cell ("terms.3.th"), and no message repeats the submitted text."""

    def __init__(self, errors: list[dict[str, Any]]) -> None:
        self.errors = errors or [{"field": None, "message": "invalid document"}]
        super().__init__(self.errors[0]["message"])


@dataclass(frozen=True)
class DocKind:
    name: str  # "settings" | "glossary": the audit action prefix and target type
    redis_key: str
    validate: Callable[[Any, Settings], tuple[dict[str, Any], list[str]]]  # (normalised document, warnings)
    summarize: Callable[[dict[str, Any] | None, dict[str, Any]], dict[str, Any]]
    seed: Callable[[], dict[str, Any]]
    mirror: Callable[[dict[str, Any]], dict[str, Any]]  # what the Redis mirror carries next to the version


@dataclass(frozen=True)
class Active:
    version: int | None  # None: no saved version, the seed is in use
    mirror: dict[str, Any]


async def newest(session: AsyncSession, kind: DocKind) -> ConfigVersion | None:
    stmt = (select(ConfigVersion).where(ConfigVersion.kind == kind.name)
            .order_by(ConfigVersion.version.desc()).limit(1))
    return (await session.execute(stmt)).scalar_one_or_none()


def _storable(document: dict[str, Any]) -> None:
    """23b's check that the JSON column can hold the document (ensure_storable), as a DocumentError whose message
    does not repeat the document."""
    try:
        ensure_storable(document)
    except LLMConfigError as exc:
        raise DocumentError([{"field": None, "message": "the document cannot be stored as JSON"}]) from exc


async def save_version(session: AsyncSession, actor: AdminPrincipal, kind: DocKind, raw: Any, *, settings: Settings,
                       base_version: int | None, note: str | None = None, source: str = "edit",
                       restored_from: int | None = None, ip_hash: str | None = None) -> ConfigVersion:
    """Validate, refuse a stale base, append the next version of the kind and its audit row."""
    document, _ = kind.validate(raw, settings)
    _storable(document)
    if session.get_bind().dialect.name == "postgresql":  # READ COMMITTED would let two saves pass the same check
        await session.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": CONFIG_SAVE_LOCK})
    current = await newest(session, kind)
    current_version = current.version if current is not None else None
    if base_version != current_version:
        active = f"version {current_version}" if current_version is not None else "the default"
        raise Conflict(f"{active} is in use now; reload the latest version and try again")
    previous = current.document if current is not None else kind.seed()
    changes = kind.summarize(previous, document)
    row = ConfigVersion(kind=kind.name, version=(current_version or 0) + 1, created_at=datetime.now(UTC),
                        created_by=actor.label[:64], note=(note or "").strip()[:NOTE_MAX] or None, source=source,
                        restored_from=restored_from, document=document, changes=changes)
    session.add(row)
    await session.flush()
    await record(session, actor, f"{kind.name}.{_VERB[source]}", target_type=kind.name, target_id=row.version,
                 before={"version": current_version}, after={"version": row.version, **changes}, ip_hash=ip_hash)
    return row


async def get_version(session: AsyncSession, kind: DocKind, version: int) -> ConfigVersion:
    stmt = select(ConfigVersion).where(ConfigVersion.kind == kind.name, ConfigVersion.version == version)
    row = (await session.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise NotFound(f"{kind.name} version {version} not found")
    return row


async def restore_version(session: AsyncSession, actor: AdminPrincipal, kind: DocKind, version: int, *,
                          settings: Settings, base_version: int | None, note: str | None = None,
                          ip_hash: str | None = None) -> ConfigVersion:
    """Append a copy of an old version. It is validated again: a version the current rules refuse is not restored."""
    old = await get_version(session, kind, version)
    return await save_version(session, actor, kind, old.document, settings=settings, base_version=base_version,
                              note=note or f"restored from version {version}", source="restore",
                              restored_from=version, ip_hash=ip_hash)


async def reset_to_seed(session: AsyncSession, actor: AdminPrincipal, kind: DocKind, *, settings: Settings,
                        base_version: int | None, note: str | None = None,
                        ip_hash: str | None = None) -> ConfigVersion:
    return await save_version(session, actor, kind, kind.seed(), settings=settings, base_version=base_version,
                              note=note or "reset to the default", source="reset", ip_hash=ip_hash)


async def list_versions(session: AsyncSession, kind: DocKind, *, before: int | None = None,
                        limit: int = 50) -> tuple[list[ConfigVersion], int | None]:
    stmt = (select(ConfigVersion).where(ConfigVersion.kind == kind.name)
            .order_by(ConfigVersion.version.desc()).limit(limit + 1))
    if before is not None:
        stmt = stmt.where(ConfigVersion.version < before)
    rows = list((await session.execute(stmt)).scalars())
    cursor = rows[limit - 1].version if len(rows) > limit else None
    return rows[:limit], cursor


def version_out(row: ConfigVersion) -> dict[str, Any]:
    return {"version": row.version, "kind": row.kind, "created_at": row.created_at, "created_by": row.created_by,
            "note": row.note, "source": row.source, "restored_from": row.restored_from, "changes": row.changes or {}}


def mirror_version(raw: str | None) -> int | None:
    """The version a mirror holds, or None when it is empty or holds something else."""
    if not raw:
        return None
    try:
        value = json.loads(raw)
    except ValueError:
        return None
    version = value.get("version") if isinstance(value, dict) else None
    return version if isinstance(version, int) and not isinstance(version, bool) else None


def _payload(kind: DocKind, version: int, document: dict[str, Any]) -> str:
    return json.dumps({"version": version, **kind.mirror(document)}, ensure_ascii=False)


async def publish(redis, kind: DocKind, row: ConfigVersion) -> bool:
    """Raise the kind's mirror to this version; never lower it (commits can reach Redis out of order). False on a
    Redis error or lost WATCH races: the mirror keeps its old value, and readers that miss it read the DB."""
    payload = _payload(kind, row.version, row.document)
    try:
        for _ in range(PUBLISH_ATTEMPTS):
            async with redis.pipeline(transaction=True) as pipe:
                try:
                    await pipe.watch(kind.redis_key)
                    stored = mirror_version(await pipe.get(kind.redis_key))
                    if stored is not None and stored >= row.version:
                        return True
                    pipe.multi()
                    pipe.set(kind.redis_key, payload)
                    await pipe.execute()
                    return True
                except WatchError:
                    continue
        log.warning("runtime_publish_contended", kind=kind.name, version=row.version)
    except Exception:  # noqa: BLE001 - the version is committed; Redis trouble must not fail the save
        log.warning("runtime_publish_failed", kind=kind.name, version=row.version)
    return False


async def read_active(session_factory, redis, kind: DocKind) -> Active:
    """The kind's active version and mirror: Redis first; on a miss or a Redis error the newest DB row (then cached
    with NX, so a publish that landed meanwhile wins); the seed while the kind has no version (not cached)."""
    try:
        raw = await redis.get(kind.redis_key)
        redis_ok = True
    except Exception:  # noqa: BLE001 - Redis down must not block anything that reads settings
        raw, redis_ok = None, False
    version = mirror_version(raw)
    if version is not None:
        data = json.loads(raw)
        return Active(version, {k: v for k, v in data.items() if k != "version"})
    async with session_factory() as session:
        row = await newest(session, kind)
    if row is None:
        return Active(None, kind.mirror(kind.seed()))
    if redis_ok:
        try:
            await redis.set(kind.redis_key, _payload(kind, row.version, row.document), nx=True)
        except Exception:  # noqa: BLE001 - the next reader asks the DB again
            log.warning("runtime_mirror_fill_failed", kind=kind.name)
    return Active(row.version, kind.mirror(row.document))


async def reconcile_mirror(redis, session_factory, kind: DocKind) -> int | None:
    """Make the kind's mirror agree with the DB, which is the truth, and return the DB's newest version (None while
    the kind has none). The rules of 23b's reconcile_version_key: a mirror that is missing or behind is raised (a
    publish that was lost); one above the DB's newest is set back to it, or deleted while the kind is empty (a DB
    restored from a backup). Redis is read before the DB: a publish follows its commit, so a mirror above the DB's
    newest was not committed here. Redis errors propagate; the caller keeps what it has."""
    raw = await redis.get(kind.redis_key)
    stored = mirror_version(raw)
    async with session_factory() as session:
        row = await newest(session, kind)
    if row is None:
        if raw is not None:
            await redis.delete(kind.redis_key)
        return None
    if stored is None or stored < row.version:
        await publish(redis, kind, row)
    elif stored > row.version:
        await redis.set(kind.redis_key, _payload(kind, row.version, row.document))
    return row.version
```

- [ ] **Step 6: Run the tests**

Run: `cd /d/MRA-plan-23c/backend && uv run pytest tests/unit/test_config_store.py -q`
Expected: PASS (10 tests).
Run the integration tests against the running Postgres, as in 23a and 23b: `docker exec mra-postgres-1 psql -U mra -d postgres -c "CREATE DATABASE mra_test"` (ignore "already exists"), then
`cd /d/MRA-plan-23c/backend && MRA_INTEGRATION=1 uv run pytest tests/integration/test_runtime_config_migration.py tests/integration/test_config_store_concurrency.py tests/integration/test_llm_config_migration.py -q`.
Expected: PASS. If Postgres is not reachable, write down that the test was not run and why; never mark it passed.

- [ ] **Step 7: Lint and commit**

```bash
cd /d/MRA-plan-23c/backend && uv run ruff check app tests migrations
cd /d/MRA-plan-23c && git add backend/app/db/models.py backend/migrations/versions/b3d5f7a9c1e2_runtime_config_and_harness_runs.py \
  backend/app/services/config_store.py backend/tests/unit/test_config_store.py \
  backend/tests/integration/test_runtime_config_migration.py backend/tests/integration/test_config_store_concurrency.py
git commit -m "feat(runtime): config_versions and harness_runs tables, versioned document store (Plan 23c)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The glossary document, and the localizer reads the glossary from the graph deps

**Files:**
- Create: `backend/app/harness/glossary.py`
- Create: `backend/app/services/glossary_store.py`
- Modify: `backend/app/harness/localize.py` (`localize_system` and `localize_strings` take `glossary`)
- Modify: `backend/app/graph/graph.py` (`GraphDeps.glossary`), `backend/app/graph/factory.py` (`build_graph_deps(..., glossary=None)`)
- Modify: `backend/app/graph/nodes/intake.py`, `backend/app/graph/nodes/synthesis.py` (pass the glossary; `result.glossary_version`)
- Test: `backend/tests/unit/test_glossary.py`; add one test to `backend/tests/unit/test_nodes_synthesis.py`

**Interfaces:**
- Consumes: `DocKind`, `DocumentError` (Task 1); `has_bad_text` (`app.services.llm_config`, 23b); `GLOSSARY` (`app.harness.localize`).
- Produces:
  - `app.harness.glossary`:
    - `ActiveGlossary(version: int | None, text: str)` with `.label` (`"file"` or the version as text);
    - `SEED_GLOSSARY`, `seed_document() -> {"terms": [...]}`, `render_term(term)`, `render_glossary(terms) -> str`;
    - `glossary_of(deps) -> ActiveGlossary`.
  - `app.services.glossary_store`:
    - `GLOSSARY_KEY = "mra:glossary:active"`, `TERMS_MAX = 200`, `EN_MAX = 120`, `TH_MAX = 120`, `ABBR_MAX = 24`, `TERM_NOTE_MAX = 300`, `RENDERED_MAX = 4000`;
    - `validate_glossary(raw, settings=None) -> (document, warnings)` and `summarize_glossary(old, new) -> dict`;
    - `GLOSSARY_KIND`, `active_glossary_from(row) -> ActiveGlossary`.
  - `localize_system(language, glossary: str | None = None)` and `localize_strings(..., glossary: str | None = None)`.
  - `GraphDeps.glossary: Any = None`.
  - `build_graph_deps(settings, http, redis=None, catalog=None, *, resolved=None, sem=None, config_version="file", glossary=None)`.
  - `result["glossary_version"]`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_glossary.py`:

```python
import hashlib
import json
import re

import pytest

from app.config import Settings
from app.graph.factory import build_graph_deps
from app.graph.graph import GraphDeps
from app.graph.schemas import TranslationBatch, TranslationItem
from app.harness.glossary import (
    SEED_GLOSSARY,
    ActiveGlossary,
    glossary_of,
    render_glossary,
    seed_document,
)
from app.harness.localize import GLOSSARY, localize_strings, localize_system
from app.harness.runner import HarnessRunner
from app.services.config_store import DocumentError
from app.services.glossary_store import (
    GLOSSARY_KIND,
    RENDERED_MAX,
    TERMS_MAX,
    active_glossary_from,
    summarize_glossary,
    validate_glossary,
)
from tests.fakes import FakeStructuredLLM

# sha256 of localize_system("th") before Plan 23c (prompt_version 2026-10-12.1): with no saved glossary the
# localizer prompt must not change by a byte.
SEED_PROMPT_SHA = "607f7ea53d5d743d0cbf6707c4553ea3ec1e0f923d708e3d8db70de38a822deb"
S = Settings(_env_file=None)


def term(en="placebo", th="ยาหลอก", abbr=None, note=None):
    return {"en": en, "th": th, "abbr": abbr, "note": note}


def test_the_seed_prompt_is_byte_identical():
    assert hashlib.sha256(localize_system("th").encode()).hexdigest() == SEED_PROMPT_SHA
    assert localize_system("th", SEED_GLOSSARY.text) == localize_system("th")
    assert SEED_GLOSSARY.label == "file" and SEED_GLOSSARY.text == GLOSSARY["th"]


def test_the_seed_document_round_trips_except_one_missing_space():
    doc = seed_document()
    assert len(doc["terms"]) == 24
    assert doc["terms"][1] == term("risk ratio/relative risk", "อัตราส่วนความเสี่ยง", "RR")
    assert doc["terms"][3] == term("95% confidence interval", "ช่วงความเชื่อมั่น 95%", "95% CI")
    # GLOSSARY["th"] has "(PFS);adverse events"; a rendered document always puts a space after ";"
    assert render_glossary(doc["terms"]) == GLOSSARY["th"].replace("(PFS);adverse", "(PFS); adverse")
    assert validate_glossary(doc, S) == (doc, [])


def test_a_saved_glossary_replaces_the_terms_for_thai_only():
    system = localize_system("th", "placebo = ยาหลอก")
    # the prompt's own example ("e.g. อัตราส่วนฮาซาร์ด (HR)") stays; only the glossary line changes
    assert system.endswith("Glossary (use these terms): placebo = ยาหลอก") and GLOSSARY["th"] not in system
    assert "Glossary" not in localize_system("ja", "placebo = ยาหลอก")


def _translate(system, user):
    items = json.loads(re.search(r"<items>\n(.*)\n</items>", user, flags=re.DOTALL).group(1))
    return TranslationBatch(items=[TranslationItem(id=i["id"], text="แปลแล้ว ยาหลอก") for i in items])


async def test_localize_strings_sends_the_given_glossary():
    llm = FakeStructuredLLM("qwen", _translate)
    await localize_strings(llm, HarnessRunner(max_repairs=1), {"a": "versus placebo"}, "th",
                           glossary="placebo = ยาหลอก")
    assert llm.calls[0][0].endswith("Glossary (use these terms): placebo = ยาหลอก")


@pytest.mark.parametrize("terms, field", [
    ([], "terms"),
    ([term(en="")], "terms.0.en"),
    ([term(th="placebo")], "terms.0.th"),  # no Thai script
    ([term(th="ยาหลอก (P)")], "terms.0.th"),  # the abbreviation has its own field
    ([term(en="a=b")], "terms.0.en"),
    ([term(abbr="H;R")], "terms.0.abbr"),
    ([term(en="x/ /y")], "terms.0.en"),  # an empty alias
    ([term(), term(en="Placebo/sugar pill")], "terms.1.en"),  # an alias listed twice
    ([term(note="a\nb")], "terms.0.note"),
    ([term(th="ยา\x00หลอก")], "terms.0.th"),
    ([term(en="x" * 121)], "terms.0.en"),
    ([{**term(), "extra": 1}], "terms.0"),
    ([term(en=7)], "terms.0.en"),
])
def test_invalid_terms_name_the_cell(terms, field):
    with pytest.raises(DocumentError) as info:
        validate_glossary({"terms": terms}, S)
    assert info.value.errors[0]["field"] == field


def test_errors_never_echo_submitted_text():
    bad = "\ud800zz"
    with pytest.raises(DocumentError) as info:
        validate_glossary({"terms": [term(th=bad)]}, S)
    assert all(bad not in e["message"] for e in info.value.errors)


def test_document_shape_size_and_rendered_length():
    for raw in (None, [], {"terms": "x"}, {"terms": [], "more": 1}):
        with pytest.raises(DocumentError):
            validate_glossary(raw, S)
    with pytest.raises(DocumentError, match=f"at most {TERMS_MAX}"):
        validate_glossary({"terms": [term(en=f"t{i}") for i in range(TERMS_MAX + 1)]}, S)
    long = [term(en=f"term number {i:03d} " + "x" * 90, th="ก" * 110) for i in range(30)]
    with pytest.raises(DocumentError, match=str(RENDERED_MAX)):
        validate_glossary({"terms": long}, S)


def test_values_are_trimmed_blanks_become_null_and_a_shared_thai_term_warns():
    doc, warnings = validate_glossary({"terms": [term(en=" placebo ", abbr=" ", note=""), term(en="dummy pill")]}, S)
    assert doc == {"terms": [term(), term(en="dummy pill")]}
    assert warnings == ["terms.0 and terms.1 share one Thai term"]


def test_change_summary_and_active_glossary():
    old = {"terms": [term(), term(en="mortality", th="อัตราการเสียชีวิต")]}
    new = {"terms": [term(note="note"), term(en="incidence", th="อุบัติการณ์")]}
    assert summarize_glossary(old, new) == {"added": ["incidence"], "removed": ["mortality"], "changed": ["placebo"]}
    assert summarize_glossary(old, old) == {}

    class Row:
        version, document = 4, new

    active = active_glossary_from(Row())
    assert active == ActiveGlossary(4, "placebo = ยาหลอก; incidence = อุบัติการณ์") and active.label == "4"
    assert GLOSSARY_KIND.mirror(new) == {} and GLOSSARY_KIND.seed() == seed_document()


def test_deps_carry_the_glossary():
    g = ActiveGlossary(2, "placebo = ยาหลอก")
    assert glossary_of(GraphDeps(settings=S)) is SEED_GLOSSARY
    assert glossary_of(GraphDeps(settings=S, glossary=g)) is g
    assert build_graph_deps(Settings(_env_file=None, graph_mode="stub"), http=None, glossary=g).glossary is g
```

Add to `backend/tests/unit/test_nodes_synthesis.py` (it reuses that file's `deps`, `state`, `paper`, `card`, `narrative`,
`matrix_for` and `thai` helpers; add `import dataclasses` at the top and
`from app.harness.glossary import ActiveGlossary` before `from app.services.llm import LLMError, LLMs`). The localizer
prompt has its own example term ("e.g. อัตราส่วนฮาซาร์ด (HR)"), which stays whatever the glossary is, so the glossary
assertions here and in `test_glossary.py` check the prompt's last line (`endswith`), never the absence of a Thai term:

```python
async def test_localize_uses_the_glossary_in_the_deps_and_finalize_records_it():
    papers = [paper("P1", card())]
    writer = make_write_synthesis(deps(synthesizer=FakeStructuredLLM("ds", lambda s, u: narrative("A [P1]."))))
    english = (await writer(state(papers, matrix=matrix_for(papers), conflict_notes=[], language="en")))["synthesis"]
    loc = FakeStructuredLLM("qwen", thai)
    d = dataclasses.replace(deps(localizer=loc), glossary=ActiveGlossary(5, "placebo = ยาหลอก"))
    await make_localize(d)(state(papers, synthesis=english))
    systems = [system for system, _ in loc.calls]
    assert systems and all(s.endswith("Glossary (use these terms): placebo = ยาหลอก") for s in systems)
    base = {"topic": "t", "english_topic": "T", "language": "en", "papers": [], "question": None,
            "synthesis": {"executive_summary": "none"}}
    assert (await make_finalize(d)(base))["result"]["glossary_version"] == "5"
    assert (await make_finalize(deps())(base))["result"]["glossary_version"] == "file"
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23c/backend && uv run pytest tests/unit/test_glossary.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.harness.glossary'`.

- [ ] **Step 3: Implement `backend/app/harness/glossary.py`**

```python
"""The Thai glossary the localizer's prompt carries (Plan 23c). While the admin console has saved no glossary, the
built-in GLOSSARY text (app/harness/localize.py) is used verbatim, so the localizer prompt is byte-identical to before
23c. A saved glossary is a list of terms rendered as "en = th (ABBR)" joined by "; ". Validation and storage live in
app/services/glossary_store.py; this module stays pure."""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from app.harness.localize import GLOSSARY

_ABBR = re.compile(r"\(([^)]+)\)\s*$")


@dataclass(frozen=True)
class ActiveGlossary:
    version: int | None  # None: the built-in glossary
    text: str  # what the localizer prompt carries

    @property
    def label(self) -> str:
        return "file" if self.version is None else str(self.version)


SEED_GLOSSARY = ActiveGlossary(None, GLOSSARY["th"])


def seed_document() -> dict[str, Any]:
    """The built-in glossary as a document: one term per "en = th (ABBR)" entry, case kept."""
    terms = []
    for part in GLOSSARY["th"].split(";"):
        if "=" not in part:
            continue
        en, th = (s.strip() for s in part.split("=", 1))
        m = _ABBR.search(th)
        terms.append({"en": en, "th": _ABBR.sub("", th).strip(), "abbr": m.group(1).strip() if m else None,
                      "note": None})
    return {"terms": terms}


def render_term(term: dict[str, Any]) -> str:
    text = f"{term['en']} = {term['th']}"
    return f"{text} ({term['abbr']})" if term.get("abbr") else text


def render_glossary(terms: list[dict[str, Any]]) -> str:
    return "; ".join(render_term(t) for t in terms)


def glossary_of(deps: Any) -> ActiveGlossary:
    """The glossary a graph run uses: the deps' own (set when the worker loads, so one review keeps one), else the
    built-in one."""
    glossary = getattr(deps, "glossary", None)
    return glossary if isinstance(glossary, ActiveGlossary) else SEED_GLOSSARY
```

- [ ] **Step 4: Implement `backend/app/services/glossary_store.py`**

```python
"""The Thai glossary as a versioned document kind (Plan 23c, app/services/config_store.py). Terms are validated here;
messages name the cell ("terms.3.th") and never repeat its text, so a lone surrogate cannot break the response. The
Redis mirror carries only the version: the API needs it for the cache key, and workers read the terms from the DB."""
from __future__ import annotations

import re
from typing import Any

from app.config import Settings
from app.harness.glossary import ActiveGlossary, render_glossary, seed_document
from app.services.config_store import DocKind, DocumentError
from app.services.llm_config import has_bad_text

GLOSSARY_KEY = "mra:glossary:active"
TERMS_MAX = 200
EN_MAX = 120
TH_MAX = 120
ABBR_MAX = 24
TERM_NOTE_MAX = 300
RENDERED_MAX = 4000
FIELDS = ("en", "th", "abbr", "note")
_THAI = re.compile(r"[ก-๛]")
_CONTROL = re.compile(r"[\x00-\x1f\x7f]")


def _text(value: Any, path: str, *, required: bool, max_len: int, errors: list[dict[str, Any]]) -> str | None:
    """A clean, trimmed value, or None (blank optional values become None)."""
    if value is None or (isinstance(value, str) and not value.strip()):
        if required:
            errors.append({"field": path, "message": f"{path}: required"})
        return None
    if not isinstance(value, str):
        errors.append({"field": path, "message": f"{path}: must be text"})
        return None
    if has_bad_text(value) or _CONTROL.search(value):
        errors.append({"field": path, "message": f"{path}: holds a control or invalid character"})
        return None
    value = value.strip()
    if len(value) > max_len:
        errors.append({"field": path, "message": f"{path}: at most {max_len} characters"})
        return None
    return value


def validate_glossary(raw: Any, settings: Settings | None = None) -> tuple[dict[str, Any], list[str]]:
    if not isinstance(raw, dict) or set(raw) - {"terms"} or not isinstance(raw.get("terms"), list):
        raise DocumentError([{"field": None, "message": 'the document must be {"terms": [...]}'}])
    terms = raw["terms"]
    if not terms:
        raise DocumentError([{"field": "terms", "message": "the glossary needs at least one term"}])
    if len(terms) > TERMS_MAX:
        raise DocumentError([{"field": "terms", "message": f"at most {TERMS_MAX} terms"}])
    errors: list[dict[str, Any]] = []
    warnings: list[str] = []
    out: list[dict[str, Any]] = []
    aliases_seen: dict[str, int] = {}
    thai_seen: dict[str, int] = {}
    for i, term in enumerate(terms):
        path = f"terms.{i}"
        if not isinstance(term, dict) or set(term) - set(FIELDS):
            errors.append({"field": path, "message": f"{path}: a term has en, th, abbr and note only"})
            continue
        en = _text(term.get("en"), f"{path}.en", required=True, max_len=EN_MAX, errors=errors)
        th = _text(term.get("th"), f"{path}.th", required=True, max_len=TH_MAX, errors=errors)
        abbr = _text(term.get("abbr"), f"{path}.abbr", required=False, max_len=ABBR_MAX, errors=errors)
        note = _text(term.get("note"), f"{path}.note", required=False, max_len=TERM_NOTE_MAX, errors=errors)
        for field, value in (("en", en), ("th", th), ("abbr", abbr)):
            if value and (";" in value or "=" in value):
                errors.append({"field": f"{path}.{field}", "message": f"{path}.{field}: ';' and '=' are not allowed"})
        for field, value in (("th", th), ("abbr", abbr)):
            if value and ("(" in value or ")" in value):
                errors.append({"field": f"{path}.{field}",
                               "message": f"{path}.{field}: no brackets (the abbreviation has its own field)"})
        if th and not _THAI.search(th):
            errors.append({"field": f"{path}.th", "message": f"{path}.th: must contain Thai"})
        if en:
            aliases = [a.strip().lower() for a in en.split("/")]
            if not all(aliases):
                errors.append({"field": f"{path}.en", "message": f"{path}.en: an empty alias around '/'"})
            for alias in filter(None, aliases):
                if alias in aliases_seen:
                    errors.append({"field": f"{path}.en",
                                   "message": f"{path}.en: also listed in terms.{aliases_seen[alias]}"})
                else:
                    aliases_seen[alias] = i
        if th:
            if th in thai_seen:
                warnings.append(f"terms.{thai_seen[th]} and {path} share one Thai term")
            else:
                thai_seen[th] = i
        out.append({"en": en, "th": th, "abbr": abbr, "note": note})
    if errors:
        raise DocumentError(errors)
    rendered = render_glossary(out)
    if len(rendered) > RENDERED_MAX:
        raise DocumentError([{"field": "terms", "message": f"the glossary renders to {len(rendered)} characters; "
                                                            f"at most {RENDERED_MAX} fit the prompt"}])
    return {"terms": out}, warnings


def summarize_glossary(old: dict[str, Any] | None, new: dict[str, Any]) -> dict[str, Any]:
    """Terms added, removed and changed (by English term), for history and the audit log; at most 50 names each."""
    def keyed(doc):
        return {t["en"].lower(): t for t in ((doc or {}).get("terms") or []) if isinstance(t, dict) and t.get("en")}

    a, b = keyed(old), keyed(new)
    out: dict[str, Any] = {}
    for name, items in (("added", sorted(b.keys() - a.keys())), ("removed", sorted(a.keys() - b.keys())),
                        ("changed", sorted(k for k in a.keys() & b.keys() if a[k] != b[k]))):
        if items:
            out[name] = items[:50]
            if len(items) > 50:
                out[f"{name}_count"] = len(items)
    return out


GLOSSARY_KIND = DocKind(name="glossary", redis_key=GLOSSARY_KEY, validate=validate_glossary,
                        summarize=summarize_glossary, seed=seed_document, mirror=lambda document: {})


def active_glossary_from(row) -> ActiveGlossary:
    return ActiveGlossary(row.version, render_glossary(row.document["terms"]))
```

- [ ] **Step 5: The localizer, the deps and the nodes**

In `backend/app/harness/localize.py`:

```python
def localize_system(language: str, glossary: str | None = None) -> str:
    """`glossary`: the active glossary text (Plan 23c; Thai only). None uses the built-in GLOSSARY, verbatim."""
    name = LANGUAGE_NAMES.get(language, language)
    terms_text = glossary if glossary is not None and language == "th" else GLOSSARY.get(language)
    terms = f"\nGlossary (use these terms): {terms_text}" if terms_text else ""
    return f"""..."""  # the prompt body is unchanged
```

Keep the f-string body exactly as it is. Add the keyword `glossary: str | None = None` to `localize_strings` (after
`retry_max_items`), and build the prompt with `system, name = localize_system(language, glossary), LANGUAGE_NAMES.get(language, language)`.

In `backend/app/graph/graph.py`, add this field to `GraphDeps` after `mcp`:
`glossary: Any = None  # app.harness.glossary.ActiveGlossary; None → the built-in glossary (Plan 23c)`.

In `backend/app/graph/factory.py`:
- add `glossary=None` to the keyword arguments of `build_graph_deps`;
- pass it in both returns (`GraphDeps(settings=settings, glossary=glossary)` for the stub, and `glossary=glossary` in the real one).

In the nodes, import `from app.harness.glossary import glossary_of` (keep each import block sorted: ruff I001) and pass
`glossary=glossary_of(deps).text` to all three `localize_strings(...)` calls:
- `intake._localized_display`;
- `synthesis._localize_cards`;
- `synthesis.make_localize`.

In `make_finalize`'s result dict, add `"glossary_version": glossary_of(deps).label,` right after `"prompt_version"`.
Check with `grep -n "localize_strings(" app/graph/nodes/*.py`: each call carries `glossary=`.

- [ ] **Step 6: Run the tests**

Run: `cd /d/MRA-plan-23c/backend && uv run pytest tests/unit/test_glossary.py tests/unit/test_nodes_synthesis.py tests/unit/test_harness_localize.py tests/unit/test_eval_glossary_check.py tests/unit/test_prompts_by_type.py -q`
Expected: PASS. If a test compares the result's full key set and fails on `glossary_version`, add the key to its
expectation, and name the test in the report.

- [ ] **Step 7: Lint and commit**

```bash
cd /d/MRA-plan-23c/backend && uv run ruff check app tests
cd /d/MRA-plan-23c && git add backend/app/harness/glossary.py backend/app/services/glossary_store.py \
  backend/app/harness/localize.py backend/app/graph/graph.py backend/app/graph/factory.py \
  backend/app/graph/nodes/intake.py backend/app/graph/nodes/synthesis.py \
  backend/tests/unit/test_glossary.py backend/tests/unit/test_nodes_synthesis.py
git commit -m "feat(glossary): glossary document kind; the localizer reads the deps' glossary, the seed prompt unchanged (Plan 23c)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Runtime settings and the per-process cache

**Files:**
- Modify: `backend/app/services/budget.py` (`worst_case_review_cap`)
- Modify: `backend/app/services/capacity.py` (`worst_case_cap(settings=None)`, `check(..., settings=None)`)
- Create: `backend/app/services/runtime_settings.py`
- Create: `backend/app/services/runtime_config.py`
- Test: `backend/tests/unit/test_runtime_settings.py`

**Interfaces:**
- Consumes: `DocKind`, `DocumentError`, `newest`, `read_active` (Task 1); `GLOSSARY_KIND`, `active_glossary_from`, `SEED_GLOSSARY`, `ActiveGlossary` (Task 2); `has_bad_text` (23b).
- Produces:
  - `budget.worst_case_review_cap(settings) -> float`.
  - `runtime_settings`:
    - `SETTINGS_KEY = "mra:settings:active"`, `RATE_RE`, `SettingSpec(name, kind, group, applies, min, max)`, `SPECS`, `BY_NAME`;
    - `coerce(spec, value)` (raises `ValueError`);
    - `validate_settings(raw, settings) -> (document, warnings)`, `apply_overrides(base, values) -> Settings`, `summarize_settings(old, new)`;
    - `spec_out(spec) -> dict` and `SETTINGS_KIND`.
  - `runtime_config`:
    - `RUNTIME_TTL_SECONDS = 5.0`;
    - `Runtime(settings, settings_version: str, glossary: ActiveGlossary)` and `async load_runtime(session_factory, base) -> Runtime`;
    - `RuntimeConfig(base, session_factory, redis, *, ttl=5.0, clock=time.monotonic)` with `async settings()`, `async settings_version()`, `async glossary_label()` and `invalidate()`.
  - `Capacity.check(*, queued, running=0, this_cap=None, settings=None)` and `Capacity.worst_case_cap(settings=None)`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_runtime_settings.py`:

```python
import pytest

from app.config import Settings
from app.harness.glossary import SEED_GLOSSARY, ActiveGlossary
from app.services.admin_auth import AdminPrincipal
from app.services.budget import worst_case_review_cap
from app.services.capacity import Capacity
from app.services.config_store import DocumentError, newest, publish, save_version
from app.services.glossary_store import GLOSSARY_KIND
from app.services.runtime_config import RuntimeConfig, load_runtime
from app.services.runtime_settings import (
    BY_NAME,
    SETTINGS_KIND,
    SPECS,
    apply_overrides,
    coerce,
    summarize_settings,
    validate_settings,
)

OWNER = AdminPrincipal(kind="user", id=None, label="owner")
BASE = Settings(_env_file=None)


def test_the_editable_list_is_fixed_and_holds_nothing_sensitive():
    assert [s.name for s in SPECS] == [
        "review_rate_limit", "api_key_rate_limit", "paper_search_rate_limit", "sse_max_per_ip",
        "max_queued_reviews", "max_reviews_per_day", "max_usd_per_day", "review_cost_base_usd",
        "review_cost_per_paper_usd", "review_cost_per_candidate_usd", "max_cost_per_review_usd",
        "llm_concurrency", "result_cache_ttl_seconds"]
    for spec in SPECS:
        assert spec.name in Settings.model_fields
        assert not any(w in spec.name for w in ("secret", "salt", "_url", "proxy", "password", "admin", "turnstile",
                                                "harness"))


@pytest.mark.parametrize("name, value, expected", [
    ("review_rate_limit", " 10/hour ", "10/hour"),
    ("max_queued_reviews", 80, 80),
    ("max_queued_reviews", 80.0, 80),
    ("max_usd_per_day", 25, 25.0),
    ("result_cache_ttl_seconds", 0, 0),
])
def test_values_are_coerced(name, value, expected):
    got = coerce(BY_NAME[name], value)
    assert got == expected and type(got) is type(expected)


@pytest.mark.parametrize("name, value", [
    ("review_rate_limit", "5 per hour"), ("review_rate_limit", "0/hour"), ("review_rate_limit", 5),
    ("max_queued_reviews", 0), ("max_queued_reviews", 1001), ("max_queued_reviews", 2.5),
    ("max_queued_reviews", True), ("max_queued_reviews", "50"), ("max_usd_per_day", float("inf")),
    ("max_usd_per_day", float("nan")), ("llm_concurrency", 65),
])
def test_bad_values_are_refused(name, value):
    with pytest.raises(ValueError):
        coerce(BY_NAME[name], value)


def test_validation_names_fields_and_never_echoes_a_bad_name():
    with pytest.raises(DocumentError) as info:
        validate_settings({"values": {"max_queued_reviews": 0, "database_url": "x", "\ud800": 1}}, BASE)
    assert [e["field"] for e in info.value.errors] == ["max_queued_reviews", "database_url", None]
    assert all("\ud800" not in e["message"] for e in info.value.errors)
    for raw in (None, [], {"values": []}, {"values": {}, "extra": 1}):
        with pytest.raises(DocumentError):
            validate_settings(raw, BASE)


def test_a_daily_budget_below_one_review_is_refused_and_a_tight_one_warns():
    worst = worst_case_review_cap(BASE)
    with pytest.raises(DocumentError, match="no review could be admitted") as info:
        validate_settings({"values": {"max_usd_per_day": round(worst / 2, 2)}}, BASE)
    assert info.value.errors[0]["field"] == "max_usd_per_day"
    doc, warnings = validate_settings({"values": {"max_usd_per_day": round(worst * 2, 2), "llm_concurrency": 8}}, BASE)
    assert doc == {"values": {"max_usd_per_day": round(worst * 2, 2), "llm_concurrency": 8}}
    assert any("daily budget" in w for w in warnings) and any("llm_concurrency" in w for w in warnings)
    assert validate_settings({"values": {}}, BASE) == ({"values": {}}, [])


def test_overrides_apply_and_bad_stored_values_are_skipped():
    s = apply_overrides(BASE, {"max_queued_reviews": 80, "review_rate_limit": "9/hour", "gone_setting": 1,
                               "sse_max_per_ip": "lots"})
    assert (s.max_queued_reviews, s.review_rate_limit, s.sse_max_per_ip) == (80, "9/hour", BASE.sse_max_per_ip)
    assert BASE.max_queued_reviews == 50 and apply_overrides(BASE, {}) is BASE


def test_change_summary_says_env_for_unset_values():
    assert summarize_settings({"values": {"max_queued_reviews": 50}}, {"values": {"review_rate_limit": "9/hour"}}) == {
        "max_queued_reviews": "50 → env", "review_rate_limit": "env → 9/hour"}
    assert SETTINGS_KIND.seed() == {"values": {}}
    assert SETTINGS_KIND.mirror({"values": {"max_queued_reviews": 1}}) == {"values": {"max_queued_reviews": 1}}


async def test_capacity_checks_against_the_settings_it_is_given(redis):
    cap = Capacity(redis, BASE)
    assert cap.worst_case_cap() == worst_case_review_cap(BASE)
    assert await cap.check(queued=1) is None
    refusal = await cap.check(queued=1, settings=apply_overrides(BASE, {"max_queued_reviews": 1}))
    assert refusal is not None and refusal.reason == "queue_full"


async def save(session_factory, kind, raw):
    async with session_factory() as s, s.begin():
        current = await newest(s, kind)
        return await save_version(s, OWNER, kind, raw, settings=BASE,
                                  base_version=current.version if current else None)


class Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


async def test_runtime_config_caches_for_the_ttl_and_follows_a_publish(session_factory, redis):
    clock = Clock()
    rc = RuntimeConfig(BASE, session_factory, redis, ttl=5.0, clock=clock)
    assert await rc.settings() is BASE and await rc.settings_version() is None and await rc.glossary_label() == "file"
    row = await save(session_factory, SETTINGS_KIND, {"values": {"max_queued_reviews": 80}})
    await publish(redis, SETTINGS_KIND, row)
    assert (await rc.settings()).max_queued_reviews == 50  # still cached
    clock.now = 5.1
    assert (await rc.settings()).max_queued_reviews == 80 and await rc.settings_version() == 1
    g = await save(session_factory, GLOSSARY_KIND, {"terms": [{"en": "placebo", "th": "ยาหลอก"}]})
    await publish(redis, GLOSSARY_KIND, g)
    rc.invalidate()
    assert await rc.glossary_label() == "1"


async def test_runtime_config_keeps_the_last_values_when_everything_is_down(session_factory, redis):
    clock = Clock()
    rc = RuntimeConfig(BASE, session_factory, redis, ttl=5.0, clock=clock)
    row = await save(session_factory, SETTINGS_KIND, {"values": {"sse_max_per_ip": 9}})
    await publish(redis, SETTINGS_KIND, row)
    assert (await rc.settings()).sse_max_per_ip == 9

    class Down:
        async def get(self, *_):
            raise ConnectionError("down")

        async def set(self, *_, **__):
            raise ConnectionError("down")

    def broken_factory():
        raise OSError("db down")

    rc.redis, rc.session_factory = Down(), broken_factory
    clock.now = 10.0
    assert (await rc.settings()).sse_max_per_ip == 9  # the last values it knew
    assert await RuntimeConfig(BASE, broken_factory, Down(), clock=clock).settings() is BASE  # none known yet: env


async def test_load_runtime_reads_the_db(session_factory):
    rt = await load_runtime(session_factory, BASE)
    assert (rt.settings, rt.settings_version, rt.glossary) == (BASE, "env", SEED_GLOSSARY)
    await save(session_factory, SETTINGS_KIND, {"values": {"llm_concurrency": 4}})
    await save(session_factory, GLOSSARY_KIND, {"terms": [{"en": "placebo", "th": "ยาหลอก"}]})
    rt = await load_runtime(session_factory, BASE)
    assert rt.settings.llm_concurrency == 4 and rt.settings_version == "1"
    assert rt.glossary == ActiveGlossary(1, "placebo = ยาหลอก")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23c/backend && uv run pytest tests/unit/test_runtime_settings.py -q`
Expected: FAIL with `ImportError: cannot import name 'worst_case_review_cap'`.

- [ ] **Step 3: `budget.worst_case_review_cap` and `Capacity`**

Append to `backend/app/services/budget.py`:

```python
def worst_case_review_cap(settings: Settings) -> float:
    """The largest cap any request can get: the most papers and candidates the form allows (Plan 23c: shared by
    admission control and the settings validation)."""
    from app.schemas.review import ReviewOptions

    return review_cost_cap(settings, ReviewOptions(max_papers=ReviewOptions.bound("max_papers"),
                                                   candidate_limit=ReviewOptions.bound("candidate_limit")))
```

In `backend/app/services/capacity.py`:
- import it, and drop the `ReviewOptions` and `review_cost_cap` imports if nothing else uses them;
- replace `worst_case_cap` and the head of `check` with:

```python
    def worst_case_cap(self, settings: Settings | None = None) -> float:
        return worst_case_review_cap(settings or self.settings)

    async def check(self, *, queued: int, running: int = 0, this_cap: float | None = None,
                    settings: Settings | None = None) -> Refusal | None:
        """`settings`: the settings in force (Plan 23c); None means the ones this Capacity was built with."""
        s = settings or self.settings
```

In the rest of `check`, use `worst_cap = self.worst_case_cap(s)`; the code already reads `s.max_queued_reviews` and the
other limits through `s`.

- [ ] **Step 4: Implement `backend/app/services/runtime_settings.py`**

`coerce` keeps its type checks out of the `if` that raises (`number = ... if isinstance(...) else None`): ruff's TRY004
asks for a `TypeError` after an `isinstance` test, and every bad value here must be one `ValueError` (the validator turns
it into a field error). Non-finite floats are refused, as 23b's `has_non_finite_number` refuses them in configs.

```python
"""Runtime settings the admin console may change (Plan 23c). Only the names in SPECS can be changed; secrets, URLs,
proxy trust, Turnstile, salts, admin sign-in rules, provider keys and HARNESS_MAX_USD stay env-only. A saved version
stores only the values the admin set; the env value (Settings) stays the default for every other name, so
{"values": {}} means "env everywhere". Reading never fails: a stored value that no longer validates is skipped."""
from __future__ import annotations

import math
import re
from dataclasses import asdict, dataclass
from typing import Any, Literal

from app.config import Settings
from app.logging import get_logger
from app.services.budget import worst_case_review_cap
from app.services.config_store import DocKind, DocumentError
from app.services.llm_config import has_bad_text

log = get_logger(__name__)

SETTINGS_KEY = "mra:settings:active"
RATE_RE = re.compile(r"^[1-9][0-9]{0,4}/(second|minute|hour|day)$")


@dataclass(frozen=True)
class SettingSpec:
    name: str
    kind: Literal["rate", "int", "float"]
    group: Literal["limits", "capacity", "cost", "workers", "cache"]
    applies: Literal["api", "worker", "both"]
    min: float | None = None
    max: float | None = None


SPECS: tuple[SettingSpec, ...] = (
    SettingSpec("review_rate_limit", "rate", "limits", "api"),
    SettingSpec("api_key_rate_limit", "rate", "limits", "api"),
    SettingSpec("paper_search_rate_limit", "rate", "limits", "api"),
    SettingSpec("sse_max_per_ip", "int", "limits", "api", 1, 50),
    SettingSpec("max_queued_reviews", "int", "capacity", "api", 1, 1000),
    SettingSpec("max_reviews_per_day", "int", "capacity", "api", 1, 100_000),
    SettingSpec("max_usd_per_day", "float", "capacity", "api", 0.1, 1000.0),
    SettingSpec("review_cost_base_usd", "float", "cost", "both", 0.0, 1.0),
    SettingSpec("review_cost_per_paper_usd", "float", "cost", "both", 0.0, 0.1),
    SettingSpec("review_cost_per_candidate_usd", "float", "cost", "both", 0.0, 0.01),
    SettingSpec("max_cost_per_review_usd", "float", "cost", "both", 0.05, 5.0),
    SettingSpec("llm_concurrency", "int", "workers", "worker", 1, 64),
    SettingSpec("result_cache_ttl_seconds", "int", "cache", "api", 0, 2_592_000),
)
BY_NAME = {s.name: s for s in SPECS}


def _fmt(value: float | None) -> str:
    return "?" if value is None else (str(int(value)) if float(value).is_integer() else str(value))


def coerce(spec: SettingSpec, value: Any) -> str | int | float:
    """The value in the setting's type; ValueError with a message that never repeats the value."""
    if spec.kind == "rate":
        text = value.strip() if isinstance(value, str) else ""
        if not RATE_RE.match(text):
            raise ValueError("must look like 5/hour (1-99999 per second, minute, hour or day)")
        return text
    number = value if isinstance(value, int | float) and not isinstance(value, bool) else None
    if number is None:  # bool is an int subclass, and True is not a count
        raise ValueError("must be a number")
    if spec.kind == "int":
        if isinstance(number, float):
            if not number.is_integer():
                raise ValueError("must be a whole number")
            number = int(number)
    else:
        number = float(number)
        if not math.isfinite(number):
            raise ValueError("must be a finite number")
    if (spec.min is not None and number < spec.min) or (spec.max is not None and number > spec.max):
        raise ValueError(f"must be between {_fmt(spec.min)} and {_fmt(spec.max)}")
    return number


def apply_overrides(base: Settings, values: dict[str, Any]) -> Settings:
    """The env settings with the saved values; anything unknown or invalid is skipped with a log line."""
    update: dict[str, Any] = {}
    for name, value in (values or {}).items():
        spec = BY_NAME.get(name)
        if spec is None:
            log.warning("runtime_setting_unknown", name=str(name)[:64])
            continue
        try:
            update[name] = coerce(spec, value)
        except ValueError:
            log.warning("runtime_setting_invalid", name=name)
    return base.model_copy(update=update) if update else base


def validate_settings(raw: Any, settings: Settings) -> tuple[dict[str, Any], list[str]]:
    """`settings` is the env (base) settings: overrides always apply to env values, never to other overrides."""
    if not isinstance(raw, dict) or set(raw) - {"values"} or not isinstance(raw.get("values", {}), dict):
        raise DocumentError([{"field": None, "message": 'the document must be {"values": {name: value}}'}])
    errors: list[dict[str, Any]] = []
    values: dict[str, Any] = {}
    for name, value in raw.get("values", {}).items():
        spec = BY_NAME.get(name)
        if spec is None:
            safe = None if has_bad_text(name) else str(name)[:64]
            errors.append({"field": safe, "message": f"{safe} cannot be changed in the console" if safe
                           else "a setting name holds an invalid character"})
            continue
        try:
            values[name] = coerce(spec, value)
        except ValueError as exc:
            errors.append({"field": name, "message": f"{name}: {exc}"})
    if errors:
        raise DocumentError(errors)
    effective = apply_overrides(settings, values)
    worst = worst_case_review_cap(effective)
    if worst > effective.max_usd_per_day:
        raise DocumentError([{"field": "max_usd_per_day", "message": (
            f"max_usd_per_day (${effective.max_usd_per_day:.2f}) is below the largest per-review cap "
            f"(${worst:.2f}); no review could be admitted")}])
    warnings = []
    if effective.max_usd_per_day < 5 * worst:
        warnings.append(f"the daily budget holds only {int(effective.max_usd_per_day // worst)} reviews at their "
                        "largest cap; admission reserves that much for each queued or running review")
    if "llm_concurrency" in values:
        warnings.append("llm_concurrency applies to reviews that start after the workers reload; reviews already "
                        "running keep the old limit")
    return {"values": values}, warnings


def summarize_settings(old: dict[str, Any] | None, new: dict[str, Any]) -> dict[str, Any]:
    a, b = (old or {}).get("values") or {}, (new or {}).get("values") or {}

    def show(v: Any) -> str:
        return "env" if v is None else str(v)

    return {n: f"{show(a.get(n))} → {show(b.get(n))}" for n in sorted(set(a) | set(b)) if a.get(n) != b.get(n)}


def spec_out(spec: SettingSpec) -> dict[str, Any]:
    return asdict(spec)


SETTINGS_KIND = DocKind(name="settings", redis_key=SETTINGS_KEY, validate=validate_settings,
                        summarize=summarize_settings, seed=lambda: {"values": {}},
                        mirror=lambda document: {"values": dict(document.get("values") or {})})
```

- [ ] **Step 5: Implement `backend/app/services/runtime_config.py`**

Like 23b's `active_version_id`, `RuntimeConfig` trusts Redis first and reads the DB only on a miss. A mirror left behind
by a failed publish is therefore not this module's job: the workers' poll repairs it from the DB within 30 seconds
(`reconcile_mirror`, Task 5), after which every API process follows within its 5-second TTL.

```python
"""The settings and glossary in force (Plan 23c). API processes ask RuntimeConfig: it reads both Redis mirrors (the
DB on a miss) at most every RUNTIME_TTL_SECONDS, and keeps the last values it knew while Redis and the DB are both
unreachable (env values until it knows any), so the hot path never fails on them. Workers, the harness job and the
eval CLI call load_runtime, which reads the DB."""
from __future__ import annotations

import asyncio
import time
from collections.abc import Callable
from dataclasses import dataclass

from app.config import Settings
from app.harness.glossary import SEED_GLOSSARY, ActiveGlossary
from app.logging import get_logger
from app.services.config_store import newest, read_active
from app.services.glossary_store import GLOSSARY_KIND, active_glossary_from
from app.services.runtime_settings import SETTINGS_KIND, apply_overrides

log = get_logger(__name__)
RUNTIME_TTL_SECONDS = 5.0


@dataclass(frozen=True)
class Runtime:
    settings: Settings
    settings_version: str  # "env" while no settings version exists, else the version as text
    glossary: ActiveGlossary


async def load_runtime(session_factory, base: Settings) -> Runtime:
    async with session_factory() as session:
        settings_row = await newest(session, SETTINGS_KIND)
        glossary_row = await newest(session, GLOSSARY_KIND)
    settings = apply_overrides(base, (settings_row.document or {}).get("values") or {}) if settings_row else base
    glossary = active_glossary_from(glossary_row) if glossary_row else SEED_GLOSSARY
    return Runtime(settings, str(settings_row.version) if settings_row else "env", glossary)


class RuntimeConfig:
    def __init__(self, base: Settings, session_factory, redis, *, ttl: float = RUNTIME_TTL_SECONDS,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.base, self.session_factory, self.redis = base, session_factory, redis
        self.ttl, self.clock = ttl, clock
        self._settings: Settings = base
        self._settings_version: int | None = None
        self._glossary = "file"
        self._expires = float("-inf")
        self._lock = asyncio.Lock()

    async def _fresh(self) -> None:
        if self.clock() < self._expires:
            return
        async with self._lock:
            if self.clock() < self._expires:
                return
            try:
                settings = await read_active(self.session_factory, self.redis, SETTINGS_KIND)
                glossary = await read_active(self.session_factory, self.redis, GLOSSARY_KIND)
            except Exception as exc:  # noqa: BLE001 - keep the last values (env until any are known)
                log.warning("runtime_config_unavailable", error=type(exc).__name__)
            else:
                self._settings = apply_overrides(self.base, settings.mirror.get("values") or {})
                self._settings_version = settings.version
                self._glossary = "file" if glossary.version is None else str(glossary.version)
            self._expires = self.clock() + self.ttl

    async def settings(self) -> Settings:
        await self._fresh()
        return self._settings

    async def settings_version(self) -> int | None:
        await self._fresh()
        return self._settings_version

    async def glossary_label(self) -> str:
        await self._fresh()
        return self._glossary

    def invalidate(self) -> None:
        """The saving process reads again at once; other processes follow within the TTL."""
        self._expires = float("-inf")
```

- [ ] **Step 6: Run the tests**

Run: `cd /d/MRA-plan-23c/backend && uv run pytest tests/unit/test_runtime_settings.py tests/unit/test_capacity.py tests/unit/test_budget.py -q`
Expected: PASS.

- [ ] **Step 7: Lint and commit**

```bash
cd /d/MRA-plan-23c/backend && uv run ruff check app tests
cd /d/MRA-plan-23c && git add backend/app/services/budget.py backend/app/services/capacity.py \
  backend/app/services/runtime_settings.py backend/app/services/runtime_config.py \
  backend/tests/unit/test_runtime_settings.py
git commit -m "feat(runtime): editable settings registry, validation and the per-process settings cache (Plan 23c)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Every API surface reads the settings in force; the cache key gains the glossary

**Files:**
- Modify: `backend/app/runtime.py` (`AppDeps.runtime`)
- Modify: `backend/app/main.py` (`complete()` builds the `RuntimeConfig` and passes it to `ReviewService`)
- Modify: `backend/app/services/review_service.py` (`runtime`, `effective()`, `_version()`; the settings in force in `create`, `_reuse`, `_admit_and_insert` and `status`)
- Modify: `backend/app/api/events.py`, `backend/app/api/papers.py`, `backend/app/mcp/server.py` (`papers_limit`)
- Modify: `backend/app/api/admin_dashboard.py`, `backend/app/services/admin_dashboard.py` (`capacity.check(..., settings=settings)`)
- Test: `backend/tests/unit/test_runtime_api.py`

**Interfaces:**
- Consumes: `RuntimeConfig` (Task 3); `save_version`, `publish`, `newest` (Task 1); `SETTINGS_KIND`, `GLOSSARY_KIND`.
- Produces:
  - `AppDeps.runtime`.
  - `ReviewService(..., runtime=None)`, with `async effective() -> Settings` and `async _version() -> str`.
  - Review creation, `/status`, the SSE slot limit, the paper-search limit (REST and MCP) and the dashboard capacity block all use the settings in force.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_runtime_api.py`:

```python
import uuid

import pytest
from fastmcp import Client
from fastmcp.exceptions import ToolError

from app.schemas.review import compute_cache_key
from app.services.admin_auth import AdminPrincipal
from app.services.config_store import newest, publish, save_version
from app.services.glossary_store import GLOSSARY_KIND
from app.services.paper_search import PaperSearch
from app.services.runtime_settings import SETTINGS_KIND
from tests.admin_helpers import admin_headers
from tests.unit.test_papers_and_report import Epmc, Searx, hits

OWNER = AdminPrincipal(kind="user", id=None, label="owner")
TOPIC = {"topic": "metformin and colorectal cancer"}


async def apply(app, kind, raw):
    """Save a version as the console does, and make this process read it now."""
    deps = app.state.deps
    async with deps.session_factory() as s, s.begin():
        current = await newest(s, kind)
        row = await save_version(s, OWNER, kind, raw, settings=deps.service.settings,
                                 base_version=current.version if current else None)
    await publish(deps.redis, kind, row)
    deps.runtime.invalidate()
    return row


async def test_status_reports_the_values_in_force(app, client):
    before = (await client.get("/api/v1/status")).json()["limits"]
    assert before["max_queued_reviews"] == 50 and before["review_rate_limit"] == "5/hour"
    await apply(app, SETTINGS_KIND, {"values": {"max_queued_reviews": 80, "review_rate_limit": "9/hour",
                                                "sse_max_per_ip": 2}})
    after = (await client.get("/api/v1/status")).json()["limits"]
    assert (after["max_queued_reviews"], after["review_rate_limit"], after["sse_max_per_ip"]) == (80, "9/hour", 2)


async def test_review_creation_uses_the_live_rate_limit(app, client):
    await apply(app, SETTINGS_KIND, {"values": {"review_rate_limit": "1/hour"}})
    assert (await client.post("/api/v1/reviews", json=TOPIC)).status_code == 202
    assert (await client.post("/api/v1/reviews", json={"topic": "statins and dementia risk"})).status_code == 429


async def test_review_creation_uses_the_live_queue_cap(app, client):
    await apply(app, SETTINGS_KIND, {"values": {"max_queued_reviews": 1, "review_rate_limit": "100/hour"}})
    assert (await client.post("/api/v1/reviews", json=TOPIC)).status_code == 202
    refused = await client.post("/api/v1/reviews", json={"topic": "statins and dementia risk"})
    assert refused.status_code == 503 and refused.json()["reason"] == "queue_full"


async def test_the_cache_key_is_unchanged_until_a_glossary_is_saved(app, client):
    deps = app.state.deps
    first = (await client.post("/api/v1/reviews", json=TOPIC)).json()
    review = await deps.service.get(uuid.UUID(first["review_id"]))
    assert review.cache_key == compute_cache_key(review.topic, review.language, review.options,
                                                 f"{deps.service.settings.prompt_version}+llmfile")
    assert (await client.post("/api/v1/reviews", json=TOPIC)).json()["review_id"] == first["review_id"]
    await apply(app, GLOSSARY_KIND, {"terms": [{"en": "placebo", "th": "ยาหลอก"}]})
    assert (await client.post("/api/v1/reviews", json=TOPIC)).json()["review_id"] != first["review_id"]


async def test_event_streams_use_the_live_limit(app, client):
    await apply(app, SETTINGS_KIND, {"values": {"sse_max_per_ip": 1}})
    created = (await client.post("/api/v1/reviews", json=TOPIC)).json()
    deps = app.state.deps
    await deps.redis.set(f"mra:sse:{deps.service.sse_key('127.0.0.1')}", 1)  # one stream already open
    r = await client.get(f"/api/v1/reviews/{created['review_id']}/events")
    assert r.status_code == 429 and "max 1 per client" in r.json()["detail"]


async def test_paper_search_uses_the_live_limit_in_rest_and_mcp(app, client):
    app.state.deps.papers = PaperSearch(Searx(hits()), Epmc())
    await apply(app, SETTINGS_KIND, {"values": {"paper_search_rate_limit": "1/minute"}})
    assert (await client.get("/api/v1/papers/search?q=metformin")).status_code == 200
    assert (await client.get("/api/v1/papers/search?q=metformin")).status_code == 429
    async with Client(app.state.mcp) as c:
        await c.call_tool("search_papers", {"query": "metformin", "limit": 1})
        with pytest.raises(ToolError, match="rate limit"):
            await c.call_tool("search_papers", {"query": "metformin", "limit": 1})


async def test_dashboard_capacity_shows_the_values_in_force(app, client, session_factory):
    h = await admin_headers(client, session_factory)
    await apply(app, SETTINGS_KIND, {"values": {"max_reviews_per_day": 7}})
    capacity = (await client.get("/api/v1/admin/dashboard?days=7", headers=h)).json()["capacity"]
    assert capacity["max_reviews_per_day"] == 7
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23c/backend && uv run pytest tests/unit/test_runtime_api.py -q`
Expected: FAIL with `AttributeError: 'AppDeps' object has no attribute 'runtime'`.

- [ ] **Step 3: Wire the provider**

`backend/app/runtime.py`: add this field to `AppDeps`:
`runtime: Any = None  # app.services.runtime_config.RuntimeConfig (built by create_app when omitted, Plan 23c)`.

`backend/app/main.py`, inside `complete(d)`, after `d.limits = ...`:

```python
        if d.runtime is None:
            from app.services.runtime_config import RuntimeConfig
            d.runtime = RuntimeConfig(settings, d.session_factory, d.redis)
```

Then pass `runtime=d.runtime` to the `ReviewService(...)` call.

`backend/app/services/review_service.py`:

```python
    def __init__(self, session_factory, queue, event_sink, settings: Settings, limits: RateLimits,
                 url_check=is_public_http_url, capacity=None, llm_version=None, runtime=None) -> None:
        ...
        self.runtime = runtime  # RuntimeConfig (Plan 23c); None → env settings only (unit tests)

    async def effective(self) -> Settings:
        """The settings in force: env values with the admin console's saved overrides, at most 5 seconds old.
        Env-only values (salts, Turnstile, prompt_version) read the same either way."""
        return self.settings if self.runtime is None else await self.runtime.settings()

    async def _version(self) -> str:
        """The cache key's pipeline version: prompt, LLM config (23b) and, once one is saved, the glossary (23c)."""
        version = self.settings.prompt_version
        if self.llm_version is not None:
            version = f"{version}+llm{await self.llm_version()}"
        if self.runtime is not None and (glossary := await self.runtime.glossary_label()) != "file":
            version = f"{version}+g{glossary}"
        return version
```

Then change these methods:
- **`create`:**
  - start with `s = await self.effective()`;
  - build the key with `compute_cache_key(req.topic, req.language, options, await self._version())`;
  - call `self._reuse(cache_key, s)` (both calls) and `self._admit_and_insert(req, identity, options, cache_key, s)`.
- **`_reuse(self, cache_key, settings=None)`:** the TTL is `(settings or self.settings).result_cache_ttl_seconds`.
- **`_admit_and_insert(..., settings)`:**
  - `this_cap = review_cost_cap(settings, ...)`;
  - `self.capacity.check(queued=..., running=..., this_cap=this_cap, settings=settings)`;
  - the rate is `settings.api_key_rate_limit if identity.api_key else settings.review_rate_limit`;
  - the `_reuse` inside its `IntegrityError` branch passes `settings`.
- **`status`:** `s = await self.effective()` goes above the capacity check (23b's code reads `s = self.settings` only after it), the later `s = self.settings` line goes, and the check becomes `self.capacity.check(queued=..., running=..., settings=s)`.

`backend/app/api/events.py`: before the slots,

```python
    live = await deps.service.effective()  # Plan 23c: the limit in force
    slots = SseSlots(deps.redis, limit=live.sse_max_per_ip)
```

Use `live.sse_max_per_ip` in the 429 message as well. `sse_ping_seconds` stays on `settings`.

`backend/app/api/papers.py`: the rate is `(await deps.service.effective()).paper_search_rate_limit`.

`backend/app/mcp/server.py`, in `papers_limit`:

```python
        deps = get_deps()
        rate = (await deps.service.effective()).paper_search_rate_limit
        decision = await deps.limits.hit("papers", ident.rate_key, rate)
```

`backend/app/api/admin_dashboard.py`: pass `await deps.service.effective()` instead of `deps.service.settings`. In
`backend/app/services/admin_dashboard.py`, call `capacity.check(queued=queued, running=running, settings=settings)`.

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-23c/backend && uv run pytest tests/unit/test_runtime_api.py tests/unit/test_review_service.py tests/unit/test_reviews_api.py tests/unit/test_sse.py tests/unit/test_mcp_server.py tests/unit/test_admin_dashboard.py tests/unit/test_cache_key_llm_version.py tests/unit/test_api_docs_limits.py -q`
Expected: PASS. The existing tests that set `app.state.deps.service.settings.<limit>` keep working, because with no
saved version `apply_overrides` returns the env settings object itself.

- [ ] **Step 5: Lint and commit**

```bash
cd /d/MRA-plan-23c/backend && uv run ruff check app tests
cd /d/MRA-plan-23c && git add backend/app/runtime.py backend/app/main.py backend/app/services/review_service.py \
  backend/app/api/events.py backend/app/api/papers.py backend/app/mcp/server.py backend/app/api/admin_dashboard.py \
  backend/app/services/admin_dashboard.py backend/tests/unit/test_runtime_api.py
git commit -m "feat(runtime): reviews, /status, SSE, paper search and the dashboard use the settings in force; a saved glossary starts a cache generation (Plan 23c)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Workers reload settings and the glossary without a restart

**Files:**
- Create: `backend/app/worker/runtime_reload.py`
- Modify: `backend/app/services/llm_store.py` (`report_loaded(..., extra=None)`)
- Modify: `backend/app/worker/llm_reload.py`:
  - `report_state` sends the runtime fields;
  - `_wire` passes the glossary;
  - `init_llms` and `refresh_llms` keep `ctx["llm_resolved"]`, and `init_llms` keeps `ctx["llm_sem_size"]`.
- Modify: `backend/app/worker/settings.py` (`init_runtime` before `init_llms`; the poller is `poll_runtime`)
- Modify: `backend/app/worker/tasks.py` (`run_review` calls `refresh_runtime` before `refresh_llms`)
- Test: `backend/tests/unit/test_runtime_reload.py`

**Interfaces:**
- Consumes:
  - `load_runtime` (Task 3), `mirror_version` and `reconcile_mirror` (Task 1), `SETTINGS_KIND`, `GLOSSARY_KIND`, `SEED_GLOSSARY`;
  - from 23b: `refresh_llms(ctx, *, build_graph_fn=build_graph, poll=False)`, `report_state`, `POLL_SECONDS`, `worker_id`, `ctx["llm_lock"]`, `ctx["llm_poller"]` (cancelled by `stop_llms`), `build_llms(settings, catalog, *, resolved=, sem=, config_version=)`.
- Produces:
  - `async init_runtime(ctx)`. It sets `ctx["base_settings"]`, `ctx["settings"]`, `ctx["glossary"]`, `ctx["settings_version"]` (`"env"` or the version), `ctx["glossary_version"]` (`"file"` or the version) and `ctx["runtime_error"]`.
  - `async refresh_runtime(ctx, *, build_graph_fn=None, poll=False) -> bool` and `async poll_runtime(ctx, interval=POLL_SECONDS)`.
  - `report_loaded(redis, worker, version, preset, error=None, *, extra=None)`.
- How it fits the merged 23b hook (`app/worker/llm_reload.py`):
  - **Lock:** the rebuild runs under `ctx["llm_lock"]`, so a settings reload and a model reload never interleave; `refresh_llms` then builds on the deps the runtime reload left (its `dataclasses.replace(ctx["graph_deps"], llms=...)` keeps `settings` and `glossary`, and it passes the new `ctx["llm_sem"]`).
  - **Poll:** like `refresh_llms(poll=True)`, the poll reads the DB (`reconcile_mirror` for both kinds) and repairs the mirrors, so a lost publish still arrives within 30 s; a job start trusts the mirrors (one `MGET`). `poll_runtime` calls `refresh_runtime(ctx, poll=True)` and then `refresh_llms(ctx, poll=True)`: calling `refresh_llms(ctx)` there would drop 23b's DB check.
  - **Stub mode:** stub deps have no LLMs, so a concurrency change only resizes the semaphore and the stub graph is rebuilt with the new settings (`refresh_llms` leaves stub deps alone, as before).
  - **Heartbeat:** `report_state` adds `settings`, `glossary` and `runtime_error` to 23b's entry; `loaded_workers` passes them through untouched.
  - **Catalog:** a concurrency rebuild uses `ctx["catalog"]`, the catalog the current LLMs were built with (`refresh_llms` keeps it current from 23b's shared cache), so only the semaphore changes, never the models' capabilities.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_runtime_reload.py`:

```python
import asyncio
import contextlib
import json
from dataclasses import dataclass

import pytest
from sqlalchemy import delete

from app.config import Settings
from app.db.models import ConfigVersion
from app.graph.graph import GraphDeps
from app.harness.glossary import SEED_GLOSSARY, ActiveGlossary
from app.services.admin_auth import AdminPrincipal
from app.services.config_store import newest, publish, save_version
from app.services.glossary_store import GLOSSARY_KIND
from app.services.llm_config import load_llm_config
from app.services.llm_store import LOADED_KEY
from app.services.runtime_settings import SETTINGS_KIND
from app.worker import llm_reload, runtime_reload, tasks
from app.worker.llm_reload import worker_id
from app.worker.runtime_reload import init_runtime, poll_runtime, refresh_runtime
from tests.llm_helpers import MINIMAL, write_yaml

OWNER = AdminPrincipal(kind="user", id=None, label="owner")


@pytest.fixture(autouse=True)
def offline_catalog(monkeypatch):
    """The poller also runs 23b's refresh_llms, which may ask the live catalog: no test may reach the network."""
    async def offline():
        raise OSError("offline")

    monkeypatch.setattr(llm_reload, "load_live_catalog", offline)


@dataclass
class FakeGraph:
    deps: GraphDeps
    checkpointer: object = None


def build_graph_fn(deps, checkpointer=None):
    return FakeGraph(deps, checkpointer)


class FakeLLMs:
    config_version = "file"
    preset = "cheap"


async def make_ctx(tmp_path, session_factory, redis, mode="real"):
    base = Settings(_env_file=None, openrouter_api_key="sk-or-x", llm_concurrency=4, graph_mode=mode,
                    llm_config_path=str(write_yaml(tmp_path / "llm.yaml", MINIMAL)))
    ctx = {"settings": base, "session_factory": session_factory, "events_redis": redis,
           "llm_lock": asyncio.Lock(), "catalog": None, "llm_version": "file"}
    await init_runtime(ctx)
    deps = GraphDeps(settings=ctx["settings"], llms=None if mode == "stub" else FakeLLMs(), glossary=ctx["glossary"])
    ctx.update(graph_deps=deps, graph=FakeGraph(deps, checkpointer="CP"), llm_sem=asyncio.Semaphore(4),
               llm_sem_size=4, llm_resolved=load_llm_config(base.llm_config_path))
    return ctx


async def save(session_factory, kind, raw):
    async with session_factory() as s, s.begin():
        current = await newest(s, kind)
        return await save_version(s, OWNER, kind, raw, settings=Settings(_env_file=None),
                                  base_version=current.version if current else None)


async def save_and_publish(session_factory, redis, kind, raw):
    row = await save(session_factory, kind, raw)
    await publish(redis, kind, row)
    return row


async def test_startup_without_versions_uses_env_and_the_seed(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    assert (ctx["settings_version"], ctx["glossary_version"], ctx["runtime_error"]) == ("env", "file", None)
    assert ctx["settings"] is ctx["base_settings"] and ctx["glossary"] is SEED_GLOSSARY
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is False  # nothing published
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn, poll=True) is False  # nothing saved


async def test_a_saved_version_is_loaded_at_startup(tmp_path, session_factory, redis):
    await save_and_publish(session_factory, redis, SETTINGS_KIND, {"values": {"max_cost_per_review_usd": 0.3}})
    ctx = await make_ctx(tmp_path, session_factory, redis)
    assert ctx["settings_version"] == "1" and ctx["settings"].max_cost_per_review_usd == 0.3


async def test_a_change_rebuilds_deps_and_graph_and_a_running_graph_keeps_its_own(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    old_graph, old_llms = ctx["graph"], ctx["graph_deps"].llms
    await save_and_publish(session_factory, redis, SETTINGS_KIND, {"values": {"max_cost_per_review_usd": 0.3}})
    await save_and_publish(session_factory, redis, GLOSSARY_KIND, {"terms": [{"en": "placebo", "th": "ยาหลอก"}]})
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is True
    assert ctx["settings"].max_cost_per_review_usd == 0.3 and ctx["graph_deps"].settings is ctx["settings"]
    assert ctx["graph_deps"].glossary == ActiveGlossary(1, "placebo = ยาหลอก")
    assert ctx["graph"] is not old_graph and ctx["graph"].checkpointer == "CP"
    assert ctx["graph_deps"].llms is old_llms  # same concurrency: same LLMs
    assert old_graph.deps.glossary is SEED_GLOSSARY  # the running review's graph is untouched
    assert (ctx["settings_version"], ctx["glossary_version"]) == ("1", "1")
    report = json.loads(await redis.hget(LOADED_KEY, worker_id()))
    assert (report["settings"], report["glossary"], report["runtime_error"]) == ("1", "1", None)
    assert report["version"] == "file"  # 23b's own fields are untouched
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is False


async def test_a_concurrency_change_gives_new_reviews_a_new_semaphore(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    old_sem, old_graph = ctx["llm_sem"], ctx["graph"]
    await save_and_publish(session_factory, redis, SETTINGS_KIND, {"values": {"llm_concurrency": 9}})
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is True
    assert ctx["llm_sem"] is not old_sem and ctx["llm_sem_size"] == 9
    llms = ctx["graph_deps"].llms
    assert llms.synthesizer.sem is ctx["llm_sem"] and llms.config_version == "file"
    assert old_graph.deps.llms.__class__ is FakeLLMs  # reviews already running keep the old LLMs and semaphore


async def test_stub_mode_rebuilds_the_graph_and_has_no_models_to_rebuild(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis, mode="stub")
    await save_and_publish(session_factory, redis, SETTINGS_KIND, {"values": {"llm_concurrency": 9}})
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is True
    assert ctx["graph_deps"].llms is None and ctx["settings_version"] == "1" and ctx["llm_sem_size"] == 9


async def test_a_failed_reload_keeps_the_old_state_and_reports_it(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    before = (ctx["settings"], ctx["graph"], ctx["graph_deps"])
    await save_and_publish(session_factory, redis, SETTINGS_KIND, {"values": {"sse_max_per_ip": 3}})

    def boom(deps, checkpointer=None):
        raise RuntimeError("graph build failed")

    assert await refresh_runtime(ctx, build_graph_fn=boom) is False
    assert (ctx["settings"], ctx["graph"], ctx["graph_deps"]) == before and ctx["settings_version"] == "env"
    assert "graph build failed" in json.loads(await redis.hget(LOADED_KEY, worker_id()))["runtime_error"]
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is True and ctx["runtime_error"] is None


async def test_a_poll_picks_up_a_version_whose_publish_was_lost_and_repairs_the_mirror(tmp_path, session_factory,
                                                                                      redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    await save(session_factory, SETTINGS_KIND, {"values": {"sse_max_per_ip": 3}})  # saved, never published
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is False  # a job start trusts Redis
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn, poll=True) is True
    assert ctx["settings"].sse_max_per_ip == 3
    assert json.loads(await redis.get(SETTINGS_KIND.redis_key)) == {"version": 1, "values": {"sse_max_per_ip": 3}}
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn, poll=True) is False


async def test_a_poll_follows_an_emptied_table_back_to_env(tmp_path, session_factory, redis):
    await save_and_publish(session_factory, redis, SETTINGS_KIND, {"values": {"sse_max_per_ip": 3}})
    ctx = await make_ctx(tmp_path, session_factory, redis)
    async with session_factory() as s, s.begin():  # a database restored from an older backup
        await s.execute(delete(ConfigVersion))
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn, poll=True) is True
    assert ctx["settings_version"] == "env" and ctx["settings"] is ctx["base_settings"]
    assert await redis.get(SETTINGS_KIND.redis_key) is None


async def test_a_poll_clears_a_stale_error_and_keeps_one_that_still_applies(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    ctx["runtime_error"] = "the DB was down at startup"
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn, poll=True) is False
    assert ctx["runtime_error"] is None  # the worker runs env and the seed, which is what the DB says
    await save(session_factory, SETTINGS_KIND, {"values": {"sse_max_per_ip": 3}})

    def boom(deps, checkpointer=None):
        raise RuntimeError("graph build failed")

    assert await refresh_runtime(ctx, build_graph_fn=boom, poll=True) is False
    assert "graph build failed" in ctx["runtime_error"]  # version 1 is still not running


async def test_redis_or_the_db_down_keeps_the_current_state(tmp_path, session_factory, redis):
    ctx = await make_ctx(tmp_path, session_factory, redis)

    class Down:
        async def mget(self, *_):
            raise ConnectionError("down")

        async def get(self, *_):
            raise ConnectionError("down")

    ctx["events_redis"] = Down()
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn) is False
    assert await refresh_runtime(ctx, build_graph_fn=build_graph_fn, poll=True) is False


async def test_run_review_refreshes_settings_and_glossary_before_the_models(monkeypatch):
    calls = []

    async def fake_runtime(ctx):
        calls.append("runtime")
        return False

    async def fake_llms(ctx):
        calls.append("llms")
        return False

    class Runner:
        async def run(self, review_id):
            return "done"

    monkeypatch.setattr(tasks, "refresh_runtime", fake_runtime)
    monkeypatch.setattr(tasks, "refresh_llms", fake_llms)
    monkeypatch.setattr(tasks, "_runner", lambda c: Runner())
    await tasks.run_review({"llm_lock": asyncio.Lock()}, "00000000-0000-0000-0000-000000000001")
    assert calls == ["runtime", "llms"]


async def test_the_poller_reads_the_db_and_picks_up_a_version_without_a_publish(tmp_path, session_factory, redis,
                                                                               monkeypatch):
    ctx = await make_ctx(tmp_path, session_factory, redis)
    monkeypatch.setattr(runtime_reload, "build_graph", build_graph_fn)
    poller = asyncio.create_task(poll_runtime(ctx, interval=0.01))
    try:
        await save(session_factory, SETTINGS_KIND, {"values": {"sse_max_per_ip": 3}})
        report = {}
        for _ in range(300):
            await asyncio.sleep(0.01)
            report = json.loads(await redis.hget(LOADED_KEY, worker_id()) or "{}")
            if report.get("settings") == "1":
                break
    finally:
        poller.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await poller
    assert ctx["settings_version"] == "1" and ctx["settings"].sse_max_per_ip == 3
    assert (report["settings"], report["version"]) == ("1", "file")
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23c/backend && uv run pytest tests/unit/test_runtime_reload.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.worker.runtime_reload'`.

- [ ] **Step 3: Small changes to the 23b modules**

`backend/app/services/llm_store.py`:

```python
async def report_loaded(redis, worker: str, version: str, preset: str, error: str | None = None, *,
                        extra: dict[str, Any] | None = None) -> None:
    """Record what a worker runs. Workers repeat this on every poll (a heartbeat), so `loaded_at` means "last seen",
    and loaded_workers drops entries that were not refreshed for LOADED_MAX_AGE. `extra` carries the runtime versions
    (Plan 23c: settings, glossary, runtime_error); it never overrides the LLM fields."""
    payload = {**(extra or {}), "version": version, "preset": preset, "loaded_at": datetime.now(UTC).isoformat(),
               "error": (error or None) and error[:300]}
    ...  # the hset and its except are unchanged
```

`backend/app/worker/llm_reload.py`:
- **`report_state`:** pass `extra={"settings": ctx.get("settings_version") or "env", "glossary": ctx.get("glossary_version") or "file", "runtime_error": ctx.get("runtime_error")}` to `report_loaded`.
- **`_wire`:** pass `glossary=ctx.get("glossary")` to `build_graph_deps`.
- **`init_llms`:**
  - after `ctx["llm_sem"] = ...`, add `ctx["llm_sem_size"] = max(1, settings.llm_concurrency)`;
  - the semaphore now has the configured size, because `init_runtime` ran first and `ctx["settings"]` is the settings in force;
  - where it sets `ctx["graph_deps"], ctx["graph"], ...`, also set `ctx["llm_resolved"] = resolved` (in the file-fallback branch, the reassigned `resolved`).
- **`refresh_llms`:** on success, set `ctx["llm_resolved"] = resolved` next to `ctx["llm_preset"]`.

- [ ] **Step 4: Implement `backend/app/worker/runtime_reload.py`**

```python
"""Workers follow saved runtime settings and glossary versions without a restart (Plan 23c), the way they follow LLM
config versions (Plan 23b, app/worker/llm_reload.py), and under the same lock (ctx["llm_lock"]). A job start trusts the
Redis mirrors (one MGET; a missing mirror is no news). The 30-second poll reads the DB instead through
reconcile_mirror, which also repairs the mirrors (a lost publish, a mirror above the DB), so a saved version reaches
every worker and every API process within one interval even when its publish failed. When either kind moved, the
worker reads both from the DB and rebuilds its graph deps (settings, glossary) and graph. A running review keeps the
graph it started with, and so its caps, glossary and LLM semaphore. An llm_concurrency change gives reviews that start
afterwards a new semaphore (their LLMs are rebuilt on it, with the catalog the current LLMs were built with); reviews
already running keep the old one, so for a short while the process may run up to old + new calls. In stub mode there
are no LLMs to rebuild; the stub graph is rebuilt with the new settings. A failed reload keeps the old state and
reports runtime_error; the next poll retries, and a poll that finds the worker already on the DB's versions clears a
stale error."""
from __future__ import annotations

import asyncio
import dataclasses

from app.graph.graph import build_graph
from app.harness.glossary import SEED_GLOSSARY
from app.logging import get_logger
from app.services.config_store import mirror_version, reconcile_mirror
from app.services.glossary_store import GLOSSARY_KIND
from app.services.llm import build_llms
from app.services.runtime_config import Runtime, load_runtime
from app.services.runtime_settings import SETTINGS_KIND
from app.worker.llm_reload import POLL_SECONDS, refresh_llms, report_state

log = get_logger(__name__)


async def init_runtime(ctx: dict) -> None:
    """Worker startup, before init_llms (the LLM semaphore then gets the configured size). ctx["base_settings"]
    keeps the env settings; ctx["settings"] becomes the settings in force. A DB that cannot be read leaves env values
    and the built-in glossary, and the error is reported; the poller retries."""
    base = ctx.setdefault("base_settings", ctx["settings"])
    try:
        runtime = await load_runtime(ctx["session_factory"], base)
    except Exception as exc:  # noqa: BLE001
        log.error("runtime_load_failed", error=str(exc))
        ctx.update(settings=base, glossary=SEED_GLOSSARY, settings_version="env", glossary_version="file",
                   runtime_error=str(exc)[:300])
        return
    ctx.update(settings=runtime.settings, glossary=runtime.glossary, settings_version=runtime.settings_version,
               glossary_version=runtime.glossary.label, runtime_error=None)


def _label(version: int | None, empty: str) -> str:
    return empty if version is None else str(version)


async def _wanted(ctx: dict, *, poll: bool) -> tuple[str | None, str | None]:
    """The (settings, glossary) versions this worker should run; None for a kind with no news."""
    redis = ctx["events_redis"]
    if poll:  # the DB is the truth; the mirrors are repaired on the way
        settings = await reconcile_mirror(redis, ctx["session_factory"], SETTINGS_KIND)
        glossary = await reconcile_mirror(redis, ctx["session_factory"], GLOSSARY_KIND)
        return _label(settings, "env"), _label(glossary, "file")
    raw_settings, raw_glossary = await redis.mget(SETTINGS_KIND.redis_key, GLOSSARY_KIND.redis_key)
    settings, glossary = mirror_version(raw_settings), mirror_version(raw_glossary)
    return (None if settings is None else str(settings)), (None if glossary is None else str(glossary))


def _rebuild(ctx: dict, runtime: Runtime, build_graph_fn):
    settings = runtime.settings
    sem, size = ctx["llm_sem"], max(1, settings.llm_concurrency)
    llms = getattr(ctx["graph_deps"], "llms", None)
    if size != ctx.get("llm_sem_size"):
        sem = asyncio.Semaphore(size)
        if llms is not None and ctx.get("llm_resolved") is not None:
            llms = build_llms(settings, ctx.get("catalog"), resolved=ctx["llm_resolved"], sem=sem,
                              config_version=getattr(llms, "config_version", "file"))
    deps = dataclasses.replace(ctx["graph_deps"], settings=settings, llms=llms, glossary=runtime.glossary)
    return deps, build_graph_fn(deps, checkpointer=getattr(ctx["graph"], "checkpointer", None)), sem, size


async def refresh_runtime(ctx: dict, *, build_graph_fn=None, poll: bool = False) -> bool:
    """Rebuild the deps when a settings or glossary version moved. True when this call switched."""
    build_graph_fn = build_graph_fn or build_graph
    try:
        wanted = await _wanted(ctx, poll=poll)
    except Exception as exc:  # noqa: BLE001 - keep the current state while Redis or the DB is unreachable
        if poll:
            log.warning("runtime_poll_reconcile_failed", error=str(exc))
        return False
    loaded = (ctx.get("settings_version"), ctx.get("glossary_version"))
    moved = any(w is not None and w != have for w, have in zip(wanted, loaded, strict=True))
    if not moved:
        if poll:
            ctx["runtime_error"] = None  # this worker already runs what the DB says: an old error is stale
        return False
    async with ctx["llm_lock"]:
        try:
            runtime = await load_runtime(ctx["session_factory"], ctx["base_settings"])
            if (runtime.settings_version, runtime.glossary.label) == (ctx.get("settings_version"),
                                                                      ctx.get("glossary_version")):
                return False  # the mirror disagrees with the DB and this worker already runs what the DB says
            deps, graph, sem, size = _rebuild(ctx, runtime, build_graph_fn)
        except Exception as exc:  # noqa: BLE001 - keep serving with what is loaded
            log.error("runtime_reload_failed", error=str(exc))
            ctx["runtime_error"] = str(exc)[:300]
            await report_state(ctx)
            return False
        ctx.update(settings=runtime.settings, glossary=runtime.glossary, graph_deps=deps, graph=graph, llm_sem=sem,
                   llm_sem_size=size, settings_version=runtime.settings_version,
                   glossary_version=runtime.glossary.label, runtime_error=None)
        await report_state(ctx)
        log.info("runtime_reloaded", settings=runtime.settings_version, glossary=runtime.glossary.label)
        return True


async def poll_runtime(ctx: dict, interval: float = POLL_SECONDS) -> None:
    """The worker's background check (it replaces 23b's poll_llm_config in startup): settings and glossary first,
    then the models (23b's DB check, poll=True), then the heartbeat. Never dies."""
    while True:
        try:
            await refresh_runtime(ctx, poll=True)
            await refresh_llms(ctx, poll=True)
            await report_state(ctx)
        except Exception as exc:  # noqa: BLE001 - the poller must never die
            log.error("runtime_poll_failed", error=str(exc))
        await asyncio.sleep(interval)
```

- [ ] **Step 5: Startup and the review job**

`backend/app/worker/settings.py`:
- import `init_runtime` and `poll_runtime` from `app.worker.runtime_reload`, and drop the now unused `poll_llm_config` import (23b's function stays in `llm_reload.py` for its own tests);
- call `await init_runtime(ctx)` right after `ctx["http"] = ...` (before the catalog load and `init_llms`), so `init_llms` sizes the semaphore from the settings in force;
- replace `asyncio.create_task(poll_llm_config(ctx))` with `asyncio.create_task(poll_runtime(ctx))`, kept under `ctx["llm_poller"]` so 23b's `stop_llms` still cancels and awaits it before it removes the worker's entry;
- `graph_mode`, `Capacity(...)` and the log line keep the local `settings` (env; `graph_mode` is not editable);
- `WorkerSettings.max_jobs` and the pool size stay on env (`get_settings()`), as the spec says.

`backend/app/worker/tasks.py` (the import goes after `from app.worker.runner import ReviewRunner`: ruff I001):

```python
from app.worker.runtime_reload import refresh_runtime

async def run_review(ctx: dict, review_id: str) -> dict:
    """Start or resume a review. Saved settings and glossary (Plan 23c), then a saved LLM configuration (Plan 23b),
    are picked up first, so the review runs on the newest of each."""
    if "llm_lock" in ctx:
        await refresh_runtime(ctx)
        await refresh_llms(ctx)
    ...
```

- [ ] **Step 6: Run the tests**

Run: `cd /d/MRA-plan-23c/backend && uv run pytest tests/unit/test_runtime_reload.py tests/unit/test_llm_reload.py tests/unit/test_runner.py -q`
Expected: PASS. 23b's `test_run_review_refreshes_before_it_builds_the_runner` still passes: with no mirrors in its Redis,
`refresh_runtime` (a job start) returns False before it touches the context. Then run the whole suite once
(`uv run pytest -q`): the worker startup and 23b's reload tests must not notice the new hook.

- [ ] **Step 7: Lint and commit**

```bash
cd /d/MRA-plan-23c/backend && uv run ruff check app tests
cd /d/MRA-plan-23c && git add backend/app/worker/runtime_reload.py backend/app/services/llm_store.py \
  backend/app/worker/llm_reload.py backend/app/worker/settings.py backend/app/worker/tasks.py \
  backend/tests/unit/test_runtime_reload.py
git commit -m "feat(worker): load and reload runtime settings and the glossary without a restart; llm_concurrency gets a new semaphore for new reviews (Plan 23c)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Admin routes for settings and the glossary

**Files:**
- Create: `backend/app/api/admin_runtime.py`
- Modify: `backend/app/main.py` (include the router with `include_in_schema=False`)
- Test: `backend/tests/unit/test_admin_runtime_api.py`

**Interfaces:**
- Consumes:
  - the store (Task 1);
  - `SETTINGS_KIND`, `SPECS`, `spec_out`, `apply_overrides` (Task 3) and `worst_case_review_cap`;
  - `GLOSSARY_KIND`, `RENDERED_MAX`, `render_glossary`, `seed_document`, `SEED_GLOSSARY` (Task 2);
  - from 23b: `loaded_workers`, `admin_models.Note` (max 500 characters, no NUL or lone surrogate); from 23a: `require_admin`, `ip_hash_of`, `service_error_response`.
- Produces the routes in the spec, section 5 (settings and glossary rows). A save, restore or reset answers 201 with
  `{version, kind, created_at, created_by, note, source, restored_from, changes, workers_notified}`; a document error
  answers 422 with `{detail, errors}`.
- Follows 23b's `admin_models._write`: the write and its audit row in one transaction, then `publish` after the commit,
  and its result is `workers_notified` (false: Redis was not updated; the workers' poll repairs the mirror within 30 s).
  Unlike 23b it also drops this process's `RuntimeConfig` cache, so `/status` here shows the save at once.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_admin_runtime_api.py`:

```python
import json

from sqlalchemy import func, select

from app.db.models import AdminAudit, ConfigVersion
from app.services.glossary_store import GLOSSARY_KEY
from app.services.runtime_settings import SETTINGS_KEY
from tests.admin_helpers import admin_headers

BASE = "/api/v1/admin"
PLACEBO = {"en": "placebo", "th": "ยาหลอก", "abbr": None, "note": None}


async def count(session_factory, action):
    async with session_factory() as s:
        return await s.scalar(select(func.count()).select_from(AdminAudit).where(AdminAudit.action == action))


async def test_settings_state_save_and_status(client, session_factory, redis):
    h = await admin_headers(client, session_factory)
    state = (await client.get(f"{BASE}/settings", headers=h)).json()
    assert (state["source"], state["version"], state["overrides"]) == ("env", None, {})
    assert state["values"]["max_queued_reviews"] == state["env"]["max_queued_reviews"] == 50
    assert {s["name"] for s in state["specs"]} >= {"review_rate_limit", "llm_concurrency"} and state["loaded"] == []
    saved = await client.post(f"{BASE}/settings", headers=h,
                              json={"values": {"max_queued_reviews": 80}, "base_version": None, "note": "busier"})
    assert saved.status_code == 201 and saved.json()["version"] == 1 and saved.json()["workers_notified"] is True
    assert json.loads(await redis.get(SETTINGS_KEY)) == {"version": 1, "values": {"max_queued_reviews": 80}}
    state = (await client.get(f"{BASE}/settings", headers=h)).json()
    assert (state["source"], state["version"], state["values"]["max_queued_reviews"]) == ("db", 1, 80)
    assert (await client.get("/api/v1/status")).json()["limits"]["max_queued_reviews"] == 80  # this process: at once
    assert await count(session_factory, "settings.save") == 1


async def test_settings_validate_conflict_and_bad_values(client, session_factory):
    h = await admin_headers(client, session_factory)
    report = (await client.post(f"{BASE}/settings/validate", headers=h,
                                json={"values": {"max_queued_reviews": 0, "turnstile_secret": "x"}})).json()
    assert report["ok"] is False
    assert [e["field"] for e in report["errors"]] == ["max_queued_reviews", "turnstile_secret"]
    ok = (await client.post(f"{BASE}/settings/validate", headers=h, json={"values": {"llm_concurrency": 8}})).json()
    assert ok["ok"] is True and ok["values"]["llm_concurrency"] == 8 and ok["worst_case_review_usd"] > 0
    bad = await client.post(f"{BASE}/settings", headers=h, json={"values": {"sse_max_per_ip": 0}, "base_version": None})
    assert bad.status_code == 422 and bad.json()["errors"][0]["field"] == "sse_max_per_ip"
    assert (await client.post(f"{BASE}/settings", headers=h,
                              json={"values": {}, "base_version": None})).status_code == 201
    stale = await client.post(f"{BASE}/settings", headers=h, json={"values": {}, "base_version": None})
    assert stale.status_code == 409 and "reload" in stale.json()["detail"]
    async with session_factory() as s:
        assert await s.scalar(select(func.count()).select_from(ConfigVersion)) == 1


async def test_restore_reset_and_history(client, session_factory):
    h = await admin_headers(client, session_factory)
    await client.post(f"{BASE}/settings", headers=h, json={"values": {"max_queued_reviews": 80}, "base_version": None})
    await client.post(f"{BASE}/settings", headers=h, json={"values": {"max_queued_reviews": 90}, "base_version": 1})
    restored = await client.post(f"{BASE}/settings/versions/1/restore", headers=h, json={"base_version": 2})
    assert restored.status_code == 201 and restored.json()["restored_from"] == 1
    reset = await client.post(f"{BASE}/settings/reset", headers=h, json={"base_version": 3})
    assert reset.status_code == 201 and reset.json()["source"] == "reset"
    page = (await client.get(f"{BASE}/settings/versions?limit=2", headers=h)).json()
    assert [v["version"] for v in page["items"]] == [4, 3] and page["next"] == 3
    one = (await client.get(f"{BASE}/settings/versions/2", headers=h)).json()
    assert one["document"] == {"values": {"max_queued_reviews": 90}}
    assert one["changes"] == {"max_queued_reviews": "80 → 90"}
    assert (await client.get(f"{BASE}/settings/versions/9", headers=h)).status_code == 404
    assert (await client.get(f"{BASE}/settings", headers=h)).json()["values"]["max_queued_reviews"] == 50


async def test_glossary_state_validate_save_and_reset(client, session_factory, redis):
    h = await admin_headers(client, session_factory)
    state = (await client.get(f"{BASE}/glossary", headers=h)).json()
    assert state["source"] == "file" and len(state["terms"]) == 24 and state["max_chars"] == 4000
    report = (await client.post(f"{BASE}/glossary/validate", headers=h,
                                json={"terms": [PLACEBO, {**PLACEBO, "en": "Placebo"}]})).json()
    assert report["ok"] is False and report["errors"][0]["field"] == "terms.1.en"
    ok = (await client.post(f"{BASE}/glossary/validate", headers=h, json={"terms": [PLACEBO]})).json()
    assert ok == {"ok": True, "errors": [], "warnings": [], "preview": "placebo = ยาหลอก", "chars": 16}
    saved = await client.post(f"{BASE}/glossary", headers=h, json={"terms": [PLACEBO], "base_version": None})
    assert saved.status_code == 201 and saved.json()["version"] == 1
    assert json.loads(await redis.get(GLOSSARY_KEY)) == {"version": 1}
    state = (await client.get(f"{BASE}/glossary", headers=h)).json()
    assert (state["source"], state["version"], state["terms"]) == ("db", 1, [PLACEBO])
    reset = await client.post(f"{BASE}/glossary/reset", headers=h, json={"base_version": 1})
    assert reset.status_code == 201 and len((await client.get(f"{BASE}/glossary", headers=h)).json()["terms"]) == 24
    assert await count(session_factory, "glossary.save") == 1 and await count(session_factory, "glossary.reset") == 1


async def test_bad_bodies_are_422_never_500(client, session_factory):
    h = await admin_headers(client, session_factory)
    json_headers = {**h, "Content-Type": "application/json"}
    lone_surrogate = r'{"terms":[{"en":"\ud800","th":"ยา"}],"base_version":null}'.encode()
    r = await client.post(f"{BASE}/glossary", headers=json_headers, content=lone_surrogate)
    assert r.status_code == 422 and "\ud800" not in r.text
    for path, body in ((f"{BASE}/glossary", {"terms": "x", "base_version": None}),
                       (f"{BASE}/glossary", {"terms": [PLACEBO] * 1001, "base_version": None}),
                       (f"{BASE}/settings", {"values": {"max_queued_reviews": {"deep": [1]}}, "base_version": None}),
                       (f"{BASE}/settings", {"values": [], "base_version": None}),
                       (f"{BASE}/settings", {"values": {}, "base_version": None, "note": "a\x00b"})):
        r = await client.post(path, headers=h, json=body)
        assert r.status_code == 422, (path, r.text)


async def test_routes_need_an_admin_and_the_csrf_header_and_stay_out_of_openapi(client, session_factory, app):
    for path in (f"{BASE}/settings", f"{BASE}/glossary", f"{BASE}/glossary/versions"):
        assert (await client.get(path)).status_code == 401
    h = await admin_headers(client, session_factory)
    no_csrf = {k: v for k, v in h.items() if k != "X-MRA-Admin"}
    r = await client.post(f"{BASE}/settings", headers=no_csrf, json={"values": {}, "base_version": None})
    assert r.status_code == 403
    paths = app.openapi()["paths"]
    assert not any(p.startswith(("/api/v1/admin/settings", "/api/v1/admin/glossary")) for p in paths)


async def test_deep_bodies_are_refused_and_never_echoed(client, session_factory):
    h = await admin_headers(client, session_factory)
    json_headers = {**h, "Content-Type": "application/json"}
    deep = "[" * 400 + "]" * 400
    cases = ((f"{BASE}/settings", '{"values": ' + deep + ', "base_version": null}', 422),
             (f"{BASE}/glossary", '{"terms": [' + deep + '], "base_version": null}', 422),
             (f"{BASE}/settings/validate", '{"values": {"sse_max_per_ip": ' + deep + '}}', 200),
             (f"{BASE}/glossary/validate", '{"terms": [' + deep + ']}', 200))
    for path, body, status in cases:
        r = await client.post(path, headers=json_headers, content=body.encode())
        assert r.status_code == status and "[[[" not in r.text, (path, r.status_code)
        if status == 200:
            assert r.json()["ok"] is False
    async with session_factory() as s:
        assert await s.scalar(select(func.count()).select_from(ConfigVersion)) == 0
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23c/backend && uv run pytest tests/unit/test_admin_runtime_api.py -q`
Expected: FAIL with 404s on `/api/v1/admin/settings`.

- [ ] **Step 3: Implement `backend/app/api/admin_runtime.py`**

```python
"""Admin console: runtime settings and the Thai glossary (Plan 23c). Thin adapters over config_store with the
settings and glossary kinds. Every change writes its audit row in the same transaction; after the commit the Redis
mirror is raised (workers reload within 30 s) and this process's cache is dropped (other API processes follow
within 5 s). Validation is done against the env settings, never against other overrides."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.api.admin_models import Note
from app.api.auth import ip_hash_of, require_admin
from app.api.deps import get_deps
from app.api.reviews import service_error_response
from app.harness.glossary import SEED_GLOSSARY, render_glossary, seed_document
from app.runtime import AppDeps
from app.services.budget import worst_case_review_cap
from app.services.config_store import (
    DocKind,
    DocumentError,
    get_version,
    list_versions,
    newest,
    publish,
    reset_to_seed,
    restore_version,
    save_version,
    version_out,
)
from app.services.glossary_store import GLOSSARY_KIND, RENDERED_MAX
from app.services.llm_store import loaded_workers
from app.services.review_service import Identity, ServiceError
from app.services.runtime_settings import SETTINGS_KIND, SPECS, apply_overrides, spec_out

router = APIRouter()
TERMS_BODY_MAX = 1000  # more rows than TERMS_MAX reach the validator, which says how many fit


class SettingsDraft(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict)


class SettingsSave(SettingsDraft):
    base_version: int | None
    note: Note = None


class GlossaryDraft(BaseModel):
    terms: list[Any] = Field(max_length=TERMS_BODY_MAX)


class GlossarySave(GlossaryDraft):
    base_version: int | None
    note: Note = None


class BaseBody(BaseModel):
    base_version: int | None
    note: Note = None


async def _write(deps: AppDeps, kind: DocKind, action) -> JSONResponse:
    try:
        async with deps.session_factory() as session, session.begin():
            row = await action(session)
    except DocumentError as exc:
        return JSONResponse(status_code=422, content={"detail": str(exc), "errors": exc.errors})
    except ServiceError as exc:
        return service_error_response(exc)
    notified = await publish(deps.redis, kind, row)  # False: Redis was not updated; readers fall back to the DB
    if deps.runtime is not None:
        deps.runtime.invalidate()
    return JSONResponse(status_code=201, content=jsonable_encoder({**version_out(row), "workers_notified": notified}))


def _history_routes(kind: DocKind) -> None:
    base = f"/admin/{kind.name}"

    @router.get(f"{base}/versions")
    async def versions(before: int | None = Query(None, ge=1), limit: int = Query(50, ge=1, le=100),
                       deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> dict:
        async with deps.session_factory() as session:
            rows, nxt = await list_versions(session, kind, before=before, limit=limit)
        return {"items": [version_out(r) for r in rows], "next": nxt}

    @router.get(f"{base}/versions/{{version}}")
    async def one_version(version: int, deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)):
        try:
            async with deps.session_factory() as session:
                row = await get_version(session, kind, version)
        except ServiceError as exc:
            return service_error_response(exc)
        return jsonable_encoder({**version_out(row), "document": row.document})

    @router.post(f"{base}/versions/{{version}}/restore", status_code=201)
    async def restore(version: int, body: BaseBody, deps: AppDeps = Depends(get_deps),
                      identity: Identity = Depends(require_admin)):
        settings, ip_hash = deps.service.settings, ip_hash_of(identity, deps)
        return await _write(deps, kind, lambda s: restore_version(
            s, identity.admin, kind, version, settings=settings, base_version=body.base_version, note=body.note,
            ip_hash=ip_hash))

    @router.post(f"{base}/reset", status_code=201)
    async def reset(body: BaseBody, deps: AppDeps = Depends(get_deps), identity: Identity = Depends(require_admin)):
        settings, ip_hash = deps.service.settings, ip_hash_of(identity, deps)
        return await _write(deps, kind, lambda s: reset_to_seed(
            s, identity.admin, kind, settings=settings, base_version=body.base_version, note=body.note,
            ip_hash=ip_hash))


for _kind in (SETTINGS_KIND, GLOSSARY_KIND):
    _history_routes(_kind)


def _in_force(base, overrides: dict[str, Any]) -> dict[str, Any]:
    effective = apply_overrides(base, overrides)
    return {"values": {s.name: getattr(effective, s.name) for s in SPECS},
            "worst_case_review_usd": round(worst_case_review_cap(effective), 4)}


@router.get("/admin/settings")
async def settings_state(deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> dict:
    base = deps.service.settings
    async with deps.session_factory() as session:
        row = await newest(session, SETTINGS_KIND)
    overrides = dict((row.document or {}).get("values") or {}) if row else {}
    return {"source": "db" if row else "env", "version": row.version if row else None, **_in_force(base, overrides),
            "overrides": overrides, "env": {s.name: getattr(base, s.name) for s in SPECS},
            "specs": [spec_out(s) for s in SPECS], "loaded": await loaded_workers(deps.redis)}


@router.post("/admin/settings/validate")
async def settings_validate(body: SettingsDraft, deps: AppDeps = Depends(get_deps),
                            _: Identity = Depends(require_admin)) -> dict:
    base = deps.service.settings
    try:
        document, warnings = SETTINGS_KIND.validate(body.model_dump(), base)
    except DocumentError as exc:
        return {"ok": False, "errors": exc.errors, "warnings": [], "values": None, "worst_case_review_usd": None}
    return {"ok": True, "errors": [], "warnings": warnings, **_in_force(base, document["values"])}


@router.post("/admin/settings", status_code=201)
async def settings_save(body: SettingsSave, deps: AppDeps = Depends(get_deps),
                        identity: Identity = Depends(require_admin)):
    settings, ip_hash = deps.service.settings, ip_hash_of(identity, deps)
    raw = {"values": body.values}
    return await _write(deps, SETTINGS_KIND, lambda s: save_version(
        s, identity.admin, SETTINGS_KIND, raw, settings=settings, base_version=body.base_version, note=body.note,
        ip_hash=ip_hash))


@router.get("/admin/glossary")
async def glossary_state(deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> dict:
    async with deps.session_factory() as session:
        row = await newest(session, GLOSSARY_KIND)
    terms = row.document["terms"] if row else seed_document()["terms"]
    text = render_glossary(terms) if row else SEED_GLOSSARY.text
    return {"source": "db" if row else "file", "version": row.version if row else None, "terms": terms,
            "chars": len(text), "max_chars": RENDERED_MAX, "loaded": await loaded_workers(deps.redis)}


@router.post("/admin/glossary/validate")
async def glossary_validate(body: GlossaryDraft, deps: AppDeps = Depends(get_deps),
                            _: Identity = Depends(require_admin)) -> dict:
    try:
        document, warnings = GLOSSARY_KIND.validate(body.model_dump(), deps.service.settings)
    except DocumentError as exc:
        return {"ok": False, "errors": exc.errors, "warnings": [], "preview": None, "chars": None}
    preview = render_glossary(document["terms"])
    return {"ok": True, "errors": [], "warnings": warnings, "preview": preview, "chars": len(preview)}


@router.post("/admin/glossary", status_code=201)
async def glossary_save(body: GlossarySave, deps: AppDeps = Depends(get_deps),
                        identity: Identity = Depends(require_admin)):
    settings, ip_hash = deps.service.settings, ip_hash_of(identity, deps)
    raw = {"terms": body.terms}
    return await _write(deps, GLOSSARY_KIND, lambda s: save_version(
        s, identity.admin, GLOSSARY_KIND, raw, settings=settings, base_version=body.base_version, note=body.note,
        ip_hash=ip_hash))
```

In `backend/app/main.py`, import `admin_runtime` with the other admin routers (the list stays alphabetical:
`admin_models, admin_reviews, admin_runtime`) and register it after `admin_models`:
`app.include_router(admin_runtime.router, prefix="/api/v1", tags=["admin"], include_in_schema=False)`.

- [ ] **Step 4: Run the tests**

Run: `cd /d/MRA-plan-23c/backend && uv run pytest tests/unit/test_admin_runtime_api.py tests/unit/test_admin_models_api.py tests/unit/test_openapi_docs.py -q`
Expected: PASS. If the lone-surrogate body is refused by the JSON decoder before validation, it is still a 422 from the
admin handler. Either way, check that the response text holds no surrogate. A body nested 400 deep is refused by the
model (`values` must be a mapping) or by the validator (a term must be a mapping), and 23a's admin 422 handler never
echoes it, so no `RecursionError` reaches the encoder.

- [ ] **Step 5: Lint and commit**

```bash
cd /d/MRA-plan-23c/backend && uv run ruff check app tests
cd /d/MRA-plan-23c && git add backend/app/api/admin_runtime.py backend/app/main.py \
  backend/tests/unit/test_admin_runtime_api.py
git commit -m "feat(admin): settings and glossary routes — state, versions, validate, save, restore, reset (Plan 23c)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Eval runs record their glossary, and `run_all` learns a strict cap and progress hooks

**Files:**
- Modify: `backend/app/evals/models.py` (`RunRecord.glossary`, `RunRecord.glossary_text`)
- Modify: `backend/app/evals/run.py` (record them)
- Modify: `backend/app/evals/metrics.py` (score against the run's own glossary)
- Modify: `backend/app/evals/batch.py` (`strict_cap`, `spent_before`, `on_record`, `should_stop`; `BatchSummary.cancelled`)
- Modify: `backend/app/evals/report.py`:
  - rename `_rows` → `summary_rows` and `_verdict_changes` → `verdict_changes`, updating their callers;
  - name the LLM config and the glossary in the header.
- Create: `backend/app/evals/results.py` (`load_rows` and `write_report` move here from the CLI; `prior_spend`)
- Modify: `backend/app/cli/eval.py`:
  - use `results` (23b's `_load_rows` goes, with its `llm_config` meta and mixed check kept in `results.load_rows`);
  - `eval_runtime`, so runs use the effective settings and glossary, read inside 23b's `eval_main`;
  - `main()`'s `factory()` builds the engine once;
  - `--config-file` means "no DB".
- Test: `backend/tests/unit/test_eval_runtime.py`

**Interfaces:**
- Consumes:
  - `glossary_of`, `SEED_GLOSSARY`, `ActiveGlossary` (Task 2);
  - `Runtime`, `load_runtime` (Task 3), `review_cost_cap`, `ReviewOptions`, `entry_options`;
  - from 23b: `EvalConfigError`, `_why`, `eval_llm_config`, `eval_main(settings, config_file, rest, session_factory_maker, release_db)`, `RunRecord.llm_config` and its mixed-batch check.
- Produces:
  - `RunRecord.glossary: str = ""` and `RunRecord.glossary_text: str = ""`.
  - `run_all(deps, manifest, *, run_id, repeats, max_usd, ids, git_sha, strict_cap=False, spent_before=0.0, on_record=None, should_stop=None) -> BatchSummary`, with `BatchSummary.cancelled: bool = False`.
  - `results.load_rows(prompt_version, run_id, manifest) -> (rows, meta)`: 23b's `_load_rows`, whose `meta` gains `"llm_config"` and `"glossary"`; the `mixed` check covers 23b's `llm_config` and the glossary.
  - `results.write_report(prompt_version, run_id, manifest, compare_label=None) -> Path | None` and `results.prior_spend(prompt_version, run_id) -> float`.
  - `report.summary_rows(aggregate) -> list[tuple[str, str]]` and `report.verdict_changes(rows, other, label) -> list[str]`.
  - `cli.eval.eval_runtime(settings, config_file, session_factory_maker) -> Runtime`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_eval_runtime.py`:

```python
import pytest

from app.cli.eval import EvalConfigError, eval_runtime
from app.config import Settings
from app.evals import batch, models
from app.evals.batch import run_all
from app.evals.freeze import entry_options, freeze_all
from app.evals.metrics import review_metrics
from app.evals.models import Fixture, RunRecord, read_model, run_path
from app.evals.results import load_rows, prior_spend, write_report
from app.graph.graph import GraphDeps
from app.harness.glossary import ActiveGlossary
from app.schemas.review import ReviewOptions
from app.services.admin_auth import AdminPrincipal
from app.services.budget import review_cost_cap
from app.services.config_store import save_version
from app.services.glossary_store import GLOSSARY_KIND
from tests.unit.test_eval_batch import manifest
from tests.unit.test_review_graph import make_deps

S = Settings(_env_file=None)
OWNER = AdminPrincipal(kind="cli", id=None, label="cli")


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    return tmp_path


def record(rid, cost, repeat=1, glossary="3", text="placebo = ยาหลอก", result=None, pv="pv", run="r"):
    return RunRecord(id=rid, repeat=repeat, run_id=run, prompt_version=pv, git_sha="s", preset="p", models={},
                     started_at="2026-10-13T00:00:00", elapsed_s=1.0, cost_usd=cost, status="done",
                     glossary=glossary, glossary_text=text, result=result)


def write_fixtures(m):
    for e in m.reviews:
        models.write_json_atomic(models.fixture_path(m.pool_version, e.id), Fixture(
            id=e.id, pool_version=m.pool_version, frozen_at="2026-10-13T00:00:00", git_sha="s", prompt_version="pv",
            engines=["pubmed"], year_to=2023, topic="t", english_topic="t", question=None, plan=None,
            candidates=[], search_stats={}, status="ok"))


def fake_replay(cost):
    async def replay(deps, fixture, *, options, repeat, run_id, git_sha, primary_outcome="", language="th"):
        return record(fixture.id, cost, repeat=repeat, pv=deps.settings.prompt_version, run=run_id)
    return replay


async def test_strict_cap_never_starts_a_review_that_does_not_fit(root, monkeypatch):
    monkeypatch.setattr(batch, "replay", fake_replay(0.10))
    m = manifest(5)
    write_fixtures(m)
    assert review_cost_cap(S, ReviewOptions.clamped(entry_options(m.reviews[0]))) == pytest.approx(0.28)
    # spent before each start: 0 / 0.1 / 0.2 fit under 0.5 with a 0.28 cap; 0.3 + 0.28 does not
    s = await run_all(GraphDeps(settings=S), m, run_id="r", repeats=1, max_usd=0.5, ids=None, git_sha="s",
                      strict_cap=True)
    assert (s.done, s.stopped_for_budget) == (3, True) and s.spent == pytest.approx(0.30)
    lenient = await run_all(GraphDeps(settings=S), m, run_id="r2", repeats=1, max_usd=0.5, ids=None, git_sha="s")
    assert lenient.done == 5  # the CLI's behaviour is unchanged: it stops only once spent >= max_usd


async def test_spent_before_counts_and_the_hooks_run(root, monkeypatch):
    monkeypatch.setattr(batch, "replay", fake_replay(0.10))
    m = manifest(3)
    write_fixtures(m)
    seen = []
    stops = iter([False, False, True])

    async def on_record(rec, summary):
        seen.append((rec.id, round(summary.spent, 2)))

    async def should_stop():
        return next(stops)

    s = await run_all(GraphDeps(settings=S), m, run_id="r", repeats=1, max_usd=5, ids=None, git_sha="s",
                      spent_before=1.0, on_record=on_record, should_stop=should_stop)
    assert seen == [("CD0", 1.1), ("CD1", 1.2)] and s.cancelled and s.done == 2 and s.spent == pytest.approx(1.2)


async def test_replay_records_the_glossary_it_used(root):
    deps, m = make_deps(), manifest(1)
    deps.glossary = ActiveGlossary(4, "placebo = ยาหลอก")
    await freeze_all(deps, m, ids=None, force=False, git_sha="s", engines=["pubmed"])
    await run_all(deps, m, run_id="g", repeats=1, max_usd=100, ids=None, git_sha="s")
    rec = read_model(run_path(deps.settings.prompt_version, "g", "CD0", 1), RunRecord)
    assert (rec.glossary, rec.glossary_text) == ("4", "placebo = ยาหลอก")


def test_the_glossary_metric_uses_the_runs_own_glossary():
    result = {"synthesis_en": {"executive_summary": "Compared with placebo, risk fell."},
              "synthesis": {"executive_summary": "เมื่อเทียบกับยาหลอก ความเสี่ยงลดลง"},
              "quality": {}, "stats": {}, "papers": []}
    assert review_metrics(record("CD1", 0.1, result=result), "cv").glossary == [("placebo", True)]
    other = record("CD1", 0.1, result=result, text="placebo = ยาเปล่า")
    assert review_metrics(other, "cv").glossary == [("placebo", False)]
    legacy = record("CD1", 0.1, result=result, text="")  # before Plan 23c: the built-in terms
    assert review_metrics(legacy, "cv").glossary == [("placebo", True)]


def test_prior_spend_load_rows_and_the_report(root):
    m = manifest(2)
    models.write_json_atomic(models.run_path("pv", "r", "CD0", 1), record("CD0", 0.1, glossary="3"))
    models.write_json_atomic(models.run_path("pv", "r", "CD1", 1), record("CD1", 0.25, glossary="file", text=""))
    assert prior_spend("pv", "r") == pytest.approx(0.35) and prior_spend("pv", "none") == 0.0
    rows, meta = load_rows("pv", "r", m)
    assert len(rows) == 2 and meta["glossary"] == "3" and meta["mixed"]["glossary"] == ["3", "file"]
    path = write_report("pv", "r", m)
    text = path.read_text(encoding="utf-8")
    assert path.name == "pv-r.md" and "glossary `3`" in text and "**MIXED BATCH:** glossary: 3, file" in text
    assert write_report("pv", "empty", m) is None
    broken = models.run_path("pv", "b", "CD9", 1)
    broken.parent.mkdir(parents=True, exist_ok=True)
    broken.write_text("not json", encoding="utf-8")
    assert prior_spend("pv", "b") == 0.0  # an unreadable file is skipped


async def test_eval_runtime_uses_the_db_unless_a_config_file_is_given(session_factory):
    rt = await eval_runtime(S, None, lambda: session_factory)
    assert (rt.settings_version, rt.glossary.label) == ("env", "file")
    async with session_factory() as s, s.begin():
        await save_version(s, OWNER, GLOSSARY_KIND, {"terms": [{"en": "placebo", "th": "ยาหลอก"}]}, settings=S,
                           base_version=None)
    assert (await eval_runtime(S, None, lambda: session_factory)).glossary.label == "1"
    assert (await eval_runtime(S, "config/llm.yaml", lambda: session_factory)).glossary.label == "file"

    def broken():
        raise OSError("refused")

    with pytest.raises(EvalConfigError, match="--config-file"):
        await eval_runtime(S, None, broken)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23c/backend && uv run pytest tests/unit/test_eval_runtime.py -q`
Expected: FAIL with `ImportError: cannot import name 'eval_runtime'`.

- [ ] **Step 3: Records, replay and the metric**

- **`backend/app/evals/models.py`:** add these `RunRecord` fields after 23b's `llm_config`:
  - `glossary: str = ""  # "file" or the glossary version (Plan 23c)`;
  - `glossary_text: str = ""  # the glossary text the run's localizer carried; the 22a metric scores against it`.
- **`backend/app/evals/run.py` `replay`:** import `glossary_of`, set `glossary = glossary_of(deps)` next to `budget`, and add `"glossary": glossary.label, "glossary_text": glossary.text` to `common` (after 23b's `"llm_config"`).
- **`backend/app/evals/metrics.py` `review_metrics`:**
  - replace `terms = default_terms()` with `terms = parse_glossary(rec.glossary_text) if rec.glossary_text else default_terms()`;
  - import `parse_glossary` from `app.harness.glossary_check`.

- [ ] **Step 4: `run_all`**

In `backend/app/evals/batch.py`, add `cancelled: bool = False` to `BatchSummary` and change `run_all` to:

```python
async def run_all(deps, manifest: Manifest, *, run_id: str, repeats: int, max_usd: float, ids: list[str] | None,
                  git_sha: str, strict_cap: bool = False, spent_before: float = 0.0, on_record=None,
                  should_stop=None) -> BatchSummary:
    """Plan 23c, for the console's runs:
    - strict_cap: a review starts only when what is spent plus that review's own cost cap fits in max_usd, so the
      batch never overshoots by a whole review;
    - spent_before: what earlier attempts of this run already spent;
    - on_record(rec, summary): called after each record is written;
    - should_stop(): checked before each review; True stops the batch with summary.cancelled."""
    s = BatchSummary(spent=spent_before)
    pv = deps.settings.prompt_version
    for entry in _selected(manifest, ids):
        fx_path = models.fixture_path(manifest.pool_version, entry.id)
        if not fx_path.exists():  # operator error, not a review outcome: no run record, so freeze can repair it
            s.missing_fixture.append(entry.id)
            continue
        fixture = models.read_model(fx_path, Fixture)
        need = review_cost_cap(deps.settings, ReviewOptions.clamped(entry_options(entry))) if strict_cap else 0.0
        for repeat in range(1, repeats + 1):
            path = models.run_path(pv, run_id, entry.id, repeat)
            if path.exists():
                s.skipped += 1
                continue
            if should_stop is not None and await should_stop():
                s.cancelled = True
                return s
            if s.spent >= max_usd or (strict_cap and s.spent + need > max_usd):
                s.stopped_for_budget = True
                return s
            ...  # the record is built and written exactly as before; the rejected/error record (23b's, which carries
            #      llm_config) also gets glossary=glossary_of(deps).label
            if rec.status == "done":
                s.done += 1
            else:
                s.failed += 1
            if on_record is not None:
                await on_record(rec, s)
    return s
```

Imports: `from app.harness.glossary import glossary_of`, `from app.schemas.review import ReviewOptions` and
`from app.services.budget import review_cost_cap`. The rejected/error record keeps 23b's
`llm_config=getattr(deps.llms, "config_version", "")` and gains `glossary=glossary_of(deps).label`, so a batch's
records all say which glossary they ran under.

- [ ] **Step 5: `results.py`, the report and the CLI**

In `backend/app/evals/report.py`:
- rename `_rows` to `summary_rows` and `_verdict_changes` to `verdict_changes`, updating their callers in the module;
- extend the header line (23b's report printed no config line for a uniform batch) with the LLM config and the glossary:

```python
           (f"- git `{meta.get('git_sha', '')}` · preset `{meta.get('preset', '')}` · "
            f"pool `{meta.get('pool_version') or manifest.pool_version}` · seed {manifest.seed} · "
            f"llm config `{meta.get('llm_config') or EMPTY}` · glossary `{meta.get('glossary') or 'file'}`"),
```

`backend/app/evals/results.py`:

```python
"""Plan 22a run folders and reports, shared by the eval CLI, the harness worker and the admin console (Plan 23c).
Paths are relative to models.EVAL_ROOT (backend/ in development, /app in the containers)."""
from __future__ import annotations

import json
from pathlib import Path

from app.evals import models
from app.evals.freeze import _selected
from app.evals.metrics import aggregate, review_metrics
from app.evals.models import Manifest, RunRecord, read_model
from app.evals.report import render_report


def load_rows(prompt_version: str, run_id: str, manifest: Manifest) -> tuple[list, dict]:
    """(metrics rows, meta) of one run folder: moved here from app/cli/eval.py (23b's version, with its llm_config
    label and mixed check), plus the glossary."""
    strata = {e.id: e.stratum for e in manifest.reviews}
    folder = models.EVAL_ROOT / "runs" / prompt_version / run_id
    recs = [read_model(p, RunRecord) for p in sorted(folder.glob("*.json"))]
    meta: dict = {}
    if recs:
        meta = {"git_sha": recs[0].git_sha, "preset": recs[0].preset, "models": recs[0].models,
                "pool_version": recs[0].pool_version, "llm_config": recs[0].llm_config,
                "glossary": recs[0].glossary}
        # expected = every selected review x every repeat number seen in the folder (at least r1 and r2)
        repeats = {1, 2} | {r.repeat for r in recs}
        have = {(r.id, r.repeat) for r in recs}
        meta["missing"] = [f"{e.id} r{n}" for e in _selected(manifest, None) for n in sorted(repeats)
                           if (e.id, n) not in have]
        meta["expected"] = len(_selected(manifest, None)) * len(repeats)
        fields = {"models": [json.dumps(r.models, sort_keys=True) for r in recs],
                  "git_sha": [r.git_sha for r in recs], "preset": [r.preset for r in recs],
                  "prompt_version": [r.prompt_version for r in recs],
                  "pool_version": [r.pool_version for r in recs],
                  "llm_config": [r.llm_config for r in recs], "glossary": [r.glossary for r in recs]}
        # records of rejected/errored fixtures carry no models or pool version, and records from before a field
        # existed carry "": neither ever makes a batch "mixed"
        distinct = {k: sorted(set(v) - {"{}", ""}) for k, v in fields.items()}
        meta["mixed"] = {k: v for k, v in distinct.items() if len(v) > 1}
    return [review_metrics(r, strata.get(r.id, "?")) for r in recs], meta


def write_report(prompt_version: str, run_id: str, manifest: Manifest, compare_label: str | None = None) -> Path | None:
    """reports/<prompt_version>-<run_id>.md, or None when the run has no files. A comparison run without files is
    left out."""
    rows, meta = load_rows(prompt_version, run_id, manifest)
    if not rows:
        return None
    compare = None
    if compare_label and "/" in compare_label:
        other_pv, other_run = compare_label.split("/", 1)
        other_rows, _ = load_rows(other_pv, other_run, manifest)
        if other_rows:
            compare = {"label": compare_label, "aggregate": aggregate(other_rows), "rows": other_rows}
    path = models.EVAL_ROOT / "reports" / f"{prompt_version}-{run_id}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_report(prompt_version, run_id, manifest, rows, meta, compare), encoding="utf-8",
                    newline="\n")
    return path


def prior_spend(prompt_version: str, run_id: str) -> float:
    """What the records already in a run folder cost (a retried harness job counts it against its cap). Files that
    do not read are skipped."""
    total = 0.0
    for path in (models.EVAL_ROOT / "runs" / prompt_version / run_id).glob("*.json"):
        try:
            total += float(json.loads(path.read_text(encoding="utf-8")).get("cost_usd") or 0.0)
        except (OSError, ValueError, AttributeError, TypeError):
            continue
    return total
```

`aggregate` is a top-level import: `app.evals.metrics` does not import `results`, so there is no cycle.

In `backend/app/cli/eval.py`:
- delete `_load_rows` and import `load_rows` and `write_report` from `app.evals.results`;
- drop the imports that become unused (`json`, `aggregate`, `review_metrics`, `RunRecord`, `read_model`, `render_report`
  and `_selected`; ruff F401 names any left over), and add `from app.services.runtime_config import Runtime` to the
  `TYPE_CHECKING` block;
- the `report` branch becomes:

```python
    pv = deps.settings.prompt_version
    if args.compare_run and "/" not in args.compare_run:
        print("--compare-run must look like PROMPT_VERSION/RUN_ID")
        return 1
    if not load_rows(pv, args.run_id, manifest)[0]:
        print(f"no run files for {pv}/{args.run_id}")
        return 1
    if args.compare_run:
        other_pv, other_run = args.compare_run.split("/", 1)
        if not load_rows(other_pv, other_run, manifest)[0]:
            print(f"no run files for {args.compare_run}")
            return 1
    print(write_report(pv, args.run_id, manifest, args.compare_run))
    return 0
```

Add `eval_runtime` next to 23b's `eval_llm_config`, and change 23b's `eval_main` and `main()` as shown (the rest of
both stays as it is):

```python
async def eval_runtime(settings: Settings, config_file: str | None,
                       session_factory_maker: Callable[[], async_sessionmaker[AsyncSession]]) -> Runtime:
    """(Plan 23c) The settings in force and the glossary for an eval run: the DB's saved versions, or env values and
    the built-in glossary when --config-file says not to use the DB. An unreachable DB is an EvalConfigError, never a
    silent fallback."""
    from app.harness.glossary import SEED_GLOSSARY
    from app.services.runtime_config import Runtime, load_runtime

    if config_file:
        return Runtime(settings, "env", SEED_GLOSSARY)
    try:
        return await load_runtime(session_factory_maker(), settings)
    except Exception as exc:
        raise EvalConfigError(f"cannot read the runtime settings ({_why(exc)}); check that Postgres is running and "
                              f"migrated, or pass --config-file PATH") from exc


# in eval_main (23b): the runtime is read in the same try as the LLM config, before release_db() disposes the engine
    resolved, label, runtime = None, "file", None
    if _parser().parse_args(rest).cmd in LLM_COMMANDS:
        try:
            resolved, label = await eval_llm_config(settings, config_file, session_factory_maker)
            runtime = await eval_runtime(settings, config_file, session_factory_maker)
        except EvalConfigError as exc:
            print(exc)
            return 2
        finally:
            if release_db is not None:
                await release_db()
        print(f"llm config: {label} · settings: {runtime.settings_version} · glossary: {runtime.glossary.label}")
    http = HttpClient(timeout=settings.http_timeout_seconds, min_interval=DEFAULT_MIN_INTERVAL)
    # report needs the settings (prompt version) and no models
    deps = (build_graph_deps(runtime.settings, http, resolved=resolved, config_version=label,
                             glossary=runtime.glossary) if runtime is not None else GraphDeps(settings=settings))


# in main(): one engine for both reads (23b's factory built a new one per call, and release_db disposed only the last)
    def factory():
        nonlocal engine
        from app.db.session import make_engine, make_session_factory

        if engine is None:  # eval_llm_config and eval_runtime share one engine; release_db disposes it
            engine = make_engine(settings.database_url)
        return make_session_factory(engine)
```

23b's CLI tests keep passing unchanged: the printed line still starts `llm config: file:<path>`, `report`, `--help` and
bad arguments still never open the database, and a DB error is still exit 2 naming `--config-file`.

Mention `--config-file` = "no DB: llm.yaml, env settings, built-in glossary" in the module docstring.

- [ ] **Step 6: Run the tests**

Run: `cd /d/MRA-plan-23c/backend && uv run pytest tests/unit/test_eval_runtime.py tests/unit/test_eval_llm_config.py tests/unit/test_eval_cli.py tests/unit -q -k "eval"`
Expected: PASS, including 23b's `test_the_report_flags_a_batch_run_with_two_configs` (the `llm_config` mixed check now in
`results.load_rows`). Then run the whole suite: `uv run pytest -q`.

- [ ] **Step 7: Lint and commit**

```bash
cd /d/MRA-plan-23c/backend && uv run ruff check .
cd /d/MRA-plan-23c && git add backend/app/evals backend/app/cli/eval.py backend/tests/unit/test_eval_runtime.py
git commit -m "feat(eval): runs record their glossary and the metric scores against it; run_all strict cap, earlier spend, progress and stop hooks; shared results module (Plan 23c)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Harness runs from the console — service, reports, compare and admin routes

**Files:**
- Modify: `backend/app/config.py` (`harness_max_usd: float = 5.0`)
- Modify: `backend/app/services/queue.py` (`HARNESS_QUEUE = "arq:harness"`, `ArqJobQueue.enqueue_harness`)
- Modify: `backend/tests/conftest.py` (`FakeJobQueue.harness` and `enqueue_harness`)
- Modify: `backend/app/evals/results.py` (report and run-folder browsing, compare)
- Create: `backend/app/services/harness_runs.py`
- Create: `backend/app/api/admin_harness.py`
- Modify: `backend/app/main.py` (include the router with `include_in_schema=False`)
- Create: `backend/tests/harness_helpers.py`
- Test: `backend/tests/unit/test_admin_harness_api.py`

**Interfaces:**
- Consumes:
  - `HarnessRun` (Task 1), `results.load_rows` (Task 7), `summary_rows` and `verdict_changes` (Task 7);
  - `aggregate`, `load_manifest`, `_selected`, `entry_options`, `review_cost_cap`;
  - `record`, `require_admin`, `ip_hash_of` and `service_error_response`.
- Produces:
  - `results`:
    - `REPORT_NAME`, `LABEL_PART`, `REPORT_MAX_BYTES = 1_000_000`;
    - `list_reports()`, `read_report(name)` (raises `FileNotFoundError`), `parse_label(label)` (raises `ValueError`);
    - `list_results()` and `compare_results(a, b)` (raises `LookupError` when a run has no files).
  - `harness_runs`:
    - constants `WORKER_KEY = "mra:harness:worker"`, `WORKER_TTL_SECONDS = 90`, `DEFAULT_CAP_USD = 1.0`, `REPEATS_MAX = 2`;
    - `StartBody`, `HarnessUnavailable(reasons)`;
    - `selection(manifest, strata, max_reviews)`, `per_review_cap(settings, entries)`, `run_out(row)`;
    - `async harness_state(session_factory, redis, settings)`;
    - `async start_run(session_factory, redis, settings, actor, body, *, ip_hash=None)` and `async cancel_run(session_factory, actor, run_pk, *, ip_hash=None)`;
    - `async list_runs(session_factory, *, before=None, limit=20)`, `async get_run(session_factory, run_pk)`;
    - `async finish(session_factory, run_pk, *, status, summary=None, report=None, error=None)`.
  - The `/admin/harness*` routes in the spec, section 5.
  - Test helpers `make_eval_root(path)`, `async worker_up(redis)` and `write_run(pv, run, rows)`.

- [ ] **Step 1: Test helpers and the failing tests**

`backend/tests/harness_helpers.py`:

```python
"""Shared setup for the Plan 23c harness tests: a manifest of two strata (cv: CD0-CD2 frozen; renal: CD3 not
frozen), run files and a live harness worker heartbeat."""
import json

from app.evals import models
from app.evals.models import Fixture, Manifest, ManifestEntry, RunRecord, Stratum, save_manifest
from app.services.harness_runs import WORKER_KEY


def make_eval_root(path) -> None:
    entries = [ManifestEntry(id=f"CD{i}", stratum="cv" if i < 3 else "renal", title="t", question="q",
                             search_date="2023-01-01", year_to=2023, checked_by_owner=True) for i in range(4)]
    save_manifest(Manifest(seed=1, strata=[Stratum(name="cv", query="x"), Stratum(name="renal", query="y")],
                           reviews=entries), path / "manifest.yaml")
    for e in entries[:3]:
        models.write_json_atomic(models.fixture_path("v1", e.id), Fixture(
            id=e.id, pool_version="v1", frozen_at="2026-10-13T00:00:00", git_sha="s", prompt_version="pv",
            engines=["pubmed"], year_to=2023, topic="q", english_topic="q", question=None, plan=None,
            candidates=[], search_stats={}, status="ok"))


async def worker_up(redis) -> None:
    await redis.set(WORKER_KEY, json.dumps({"worker": "h:1", "seen_at": "2026-10-13T00:00:00+00:00"}), ex=90)


def write_run(pv: str, run: str, rows: list[tuple[str, int, float]]) -> None:
    for rid, repeat, cost in rows:
        models.write_json_atomic(models.run_path(pv, run, rid, repeat), RunRecord(
            id=rid, repeat=repeat, run_id=run, prompt_version=pv, git_sha="s", preset="p", models={},
            started_at="2026-10-13T00:00:00", elapsed_s=10.0, cost_usd=cost, status="done"))
```

In `backend/tests/conftest.py`'s `FakeJobQueue`, add `self.harness: list[int] = []` and:

```python
    async def enqueue_harness(self, run_pk) -> bool:
        self.harness.append(run_pk)
        return True
```

`backend/tests/unit/test_admin_harness_api.py`:

```python
import pytest
from sqlalchemy import func, select

from app.db.models import AdminAudit, HarnessRun
from app.evals import models
from app.evals.results import read_report
from tests.admin_helpers import admin_headers
from tests.harness_helpers import make_eval_root, worker_up, write_run

BASE = "/api/v1/admin/harness"


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    make_eval_root(tmp_path)
    return tmp_path


def start_body(**kw):
    return {"max_usd": 1.0, "repeats": 1, "strata": [], "confirm": True, **kw}


async def runs_count(session_factory):
    async with session_factory() as s:
        return await s.scalar(select(func.count()).select_from(HarnessRun))


async def test_state_lists_strata_and_says_why_it_cannot_start(client, session_factory, root):
    h = await admin_headers(client, session_factory)
    state = (await client.get(BASE, headers=h)).json()
    assert state["available"] is False and state["reasons"] == ["no_worker"]
    assert state["strata"] == [{"name": "cv", "selected": 3, "with_fixtures": 3},
                               {"name": "renal", "selected": 1, "with_fixtures": 0}]
    assert state["fixtures"] == {"selected": 4, "present": 3} and state["per_review_cap_usd"] == pytest.approx(0.28)
    assert (state["ceiling_usd"], state["default_usd"], state["active"]) == (5.0, 1.0, None)


async def test_without_a_manifest_the_reason_says_so(client, session_factory, tmp_path, monkeypatch, redis):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path / "empty")
    await worker_up(redis)
    h = await admin_headers(client, session_factory)
    assert (await client.get(BASE, headers=h)).json()["reasons"] == ["no_manifest"]


async def test_start_enqueues_one_run_and_writes_an_audit_row(client, session_factory, redis, queue, root):
    await worker_up(redis)
    h = await admin_headers(client, session_factory)
    r = await client.post(f"{BASE}/runs", headers=h, json=start_body(strata=["cv"], max_reviews=2, repeats=2))
    assert r.status_code == 201, r.text
    run = r.json()
    assert (run["status"], run["planned"], run["max_usd"], run["strata"]) == ("queued", 4, 1.0, ["cv"])
    assert run["run_id"].startswith("console-") and queue.harness == [run["id"]]
    assert (await client.post(f"{BASE}/runs", headers=h, json=start_body())).status_code == 409
    state = (await client.get(BASE, headers=h)).json()
    assert state["reasons"] == ["active_run"] and state["active"]["id"] == run["id"]
    async with session_factory() as s:
        audits = await s.scalar(select(func.count()).select_from(AdminAudit).where(AdminAudit.action == "harness.start"))
    assert audits == 1


@pytest.mark.parametrize("body", [
    start_body(max_usd=5.01),  # over HARNESS_MAX_USD ($5)
    start_body(max_usd=0.27),  # below one review's own cap ($0.28)
    start_body(confirm=False),
    {"max_usd": 1.0, "repeats": 1},  # no confirm
    start_body(repeats=3),
    start_body(strata=["nope"]),
    start_body(strata=["renal"]),  # no frozen pool in that stratum
    start_body(compare_run="pv/none"),
    start_body(compare_run="../etc"),
    start_body(extra=1),
])
async def test_bad_starts_create_nothing(client, session_factory, redis, queue, root, body):
    await worker_up(redis)
    h = await admin_headers(client, session_factory)
    r = await client.post(f"{BASE}/runs", headers=h, json=body)
    assert r.status_code == 422, r.text
    assert queue.harness == [] and await runs_count(session_factory) == 0


async def test_start_is_refused_while_unavailable(client, session_factory, queue, root):
    h = await admin_headers(client, session_factory)  # no worker heartbeat
    r = await client.post(f"{BASE}/runs", headers=h, json=start_body())
    assert r.status_code == 503 and r.json()["reasons"] == ["no_worker"]
    assert queue.harness == [] and await runs_count(session_factory) == 0


async def test_cancel_clears_the_active_slot(client, session_factory, redis, root):
    await worker_up(redis)
    h = await admin_headers(client, session_factory)
    run = (await client.post(f"{BASE}/runs", headers=h, json=start_body())).json()
    cancelled = await client.post(f"{BASE}/runs/{run['id']}/cancel", headers=h)
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled"
    assert (await client.post(f"{BASE}/runs/{run['id']}/cancel", headers=h)).status_code == 409
    assert (await client.post(f"{BASE}/runs/999/cancel", headers=h)).status_code == 404
    assert (await client.post(f"{BASE}/runs", headers=h, json=start_body())).status_code == 201
    listed = (await client.get(f"{BASE}/runs", headers=h)).json()["items"]
    assert [r["status"] for r in listed] == ["queued", "cancelled"]
    assert (await client.get(f"{BASE}/runs/{run['id']}", headers=h)).json()["status"] == "cancelled"


async def test_an_enqueue_failure_marks_the_run_error(client, session_factory, redis, queue, root, monkeypatch):
    await worker_up(redis)

    async def broken(run_pk):
        raise ConnectionError("redis down")

    monkeypatch.setattr(queue, "enqueue_harness", broken)
    h = await admin_headers(client, session_factory)
    assert (await client.post(f"{BASE}/runs", headers=h, json=start_body())).status_code == 503
    async with session_factory() as s:
        row = (await s.execute(select(HarnessRun))).scalar_one()
    assert (row.status, row.active) == ("error", None)


async def test_reports_are_listed_and_read_and_unsafe_names_refused(client, session_factory, root):
    h = await admin_headers(client, session_factory)
    (root / "reports").mkdir()
    (root / "reports" / "2026-10-11.1-baseline.md").write_text("# Report\n\n<script>x</script>\n", encoding="utf-8")
    (root / "reports" / "big.md").write_bytes(b"x" * 1_000_001)
    (root / "secret.md").write_text("outside", encoding="utf-8")
    items = (await client.get(f"{BASE}/reports", headers=h)).json()["items"]
    assert {i["name"] for i in items} == {"2026-10-11.1-baseline.md", "big.md"}
    baseline = next(i for i in items if i["name"].startswith("2026"))
    assert (baseline["prompt_version"], baseline["run_id"]) == ("2026-10-11.1", "baseline")
    one = (await client.get(f"{BASE}/reports/2026-10-11.1-baseline.md", headers=h)).json()
    assert one["text"].startswith("# Report") and "<script>" in one["text"]  # text; the page never renders HTML
    for name in ("big.md", "..%2Fsecret.md", ".hidden.md", "report.txt", "nope.md"):
        assert (await client.get(f"{BASE}/reports/{name}", headers=h)).status_code == 404, name


def test_a_symlinked_report_is_refused(root):
    (root / "reports").mkdir()
    target = root / "outside.md"
    target.write_text("x", encoding="utf-8")
    try:
        (root / "reports" / "link.md").symlink_to(target)
    except OSError:
        pytest.skip("creating symlinks needs a privilege on this host")
    with pytest.raises(FileNotFoundError):
        read_report("link.md")


async def test_results_and_compare(client, session_factory, root):
    h = await admin_headers(client, session_factory)
    write_run("pv1", "a", [("CD0", 1, 0.05), ("CD0", 2, 0.07)])
    write_run("pv2", "b", [("CD0", 1, 0.10)])
    labels = {i["label"] for i in (await client.get(f"{BASE}/results", headers=h)).json()["items"]}
    assert labels == {"pv1/a", "pv2/b"}
    cmp = (await client.get(f"{BASE}/compare?a=pv1/a&b=pv2/b", headers=h)).json()
    assert cmp["a"] == {"label": "pv1/a", "runs": 2} and cmp["b"] == {"label": "pv2/b", "runs": 1}
    cost = next(r for r in cmp["rows"] if r["metric"] == "Batch cost")
    assert (cost["a"], cost["b"]) == ("$0.12", "$0.10")
    assert (await client.get(f"{BASE}/compare?a=pv1/a&b=pv9/none", headers=h)).status_code == 404
    assert (await client.get(f"{BASE}/compare?a=../x&b=pv2/b", headers=h)).status_code == 422


async def test_harness_routes_need_an_admin_and_stay_out_of_openapi(client, app, root):
    for path in (BASE, f"{BASE}/runs", f"{BASE}/reports", f"{BASE}/results"):
        assert (await client.get(path)).status_code == 401
    assert not any("/admin/harness" in p for p in app.openapi()["paths"])
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23c/backend && uv run pytest tests/unit/test_admin_harness_api.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.harness_runs'`.

- [ ] **Step 3: Settings, queue, browsing**

`backend/app/config.py`, next to the cost settings:

```python
    # Plan 23c: the most a console harness run may be capped at. Env only: the admin console cannot raise it. $5 is the
    # owner's eval budget cap of 2026-10-12.
    harness_max_usd: float = 5.0
```

`backend/app/services/queue.py` (the constant goes right after the imports, one blank line below them; the method goes in
`ArqJobQueue`):

```python
HARNESS_QUEUE = "arq:harness"  # Plan 23c: harness runs have their own queue and worker (compose profile "harness")

    async def enqueue_harness(self, run_pk: int) -> bool:
        job = await self.pool.enqueue_job("run_harness", run_pk, _job_id=f"harness:{run_pk}", _queue_name=HARNESS_QUEUE)
        return job is not None
```

Append to `backend/app/evals/results.py` (Task 7's file):

```python
# the imports this half adds at the top of results.py
import re
from datetime import UTC, datetime

from app.evals.models import load_manifest  # next to Manifest, RunRecord, read_model
from app.evals.report import EMPTY, summary_rows, verdict_changes  # next to render_report


REPORT_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.md$")
LABEL_PART = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
REPORT_MAX_BYTES = 1_000_000
_REPORT_PARTS = re.compile(r"^(\d{4}-\d{2}-\d{2}\.\d+)-(.+)\.md$")


def _stamp(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, UTC).isoformat(timespec="seconds")


def list_reports() -> list[dict]:
    folder = models.EVAL_ROOT / "reports"
    if not folder.is_dir():
        return []
    out = []
    for path in folder.glob("*.md"):
        if not REPORT_NAME.match(path.name) or path.is_symlink() or not path.is_file():
            continue
        m = _REPORT_PARTS.match(path.name)
        out.append({"name": path.name, "prompt_version": m.group(1) if m else None,
                    "run_id": m.group(2) if m else None, "size": path.stat().st_size, "modified_at": _stamp(path)})
    return sorted(out, key=lambda r: r["modified_at"], reverse=True)


def read_report(name: str) -> str:
    """A report's Markdown. FileNotFoundError for any name that is not a plain .md file directly in reports/ of at
    most REPORT_MAX_BYTES."""
    folder = (models.EVAL_ROOT / "reports").resolve()
    if not REPORT_NAME.match(name):
        raise FileNotFoundError(name)
    path = folder / name
    if path.is_symlink() or not path.is_file() or path.resolve().parent != folder:
        raise FileNotFoundError(name)
    if path.stat().st_size > REPORT_MAX_BYTES:
        raise FileNotFoundError(name)
    return path.read_text(encoding="utf-8", errors="replace")


def parse_label(label: str) -> tuple[str, str]:
    pv, _, run = label.partition("/")
    if not (LABEL_PART.match(pv) and LABEL_PART.match(run)):
        raise ValueError("a run label looks like PROMPT_VERSION/RUN_ID")
    return pv, run


def list_results() -> list[dict]:
    root = models.EVAL_ROOT / "runs"
    if not root.is_dir():
        return []
    out = []
    for pv_dir in root.iterdir():
        if not pv_dir.is_dir() or pv_dir.is_symlink() or not LABEL_PART.match(pv_dir.name):
            continue
        for run_dir in pv_dir.iterdir():
            if not run_dir.is_dir() or run_dir.is_symlink() or not LABEL_PART.match(run_dir.name):
                continue
            files = sum(1 for _ in run_dir.glob("*.json"))
            if files:
                out.append({"label": f"{pv_dir.name}/{run_dir.name}", "prompt_version": pv_dir.name,
                            "run_id": run_dir.name, "files": files, "modified_at": _stamp(run_dir)})
    return sorted(out, key=lambda r: r["modified_at"], reverse=True)


def compare_results(a: str, b: str) -> dict:
    """Two runs side by side with the report's summary rows. ValueError for a bad label, LookupError when a run has
    no files, FileNotFoundError when the manifest is missing."""
    manifest = load_manifest()
    sides = []
    for label in (a, b):
        pv, run = parse_label(label)
        rows, _ = load_rows(pv, run, manifest)
        if not rows:
            raise LookupError(f"no run files for {label}")
        sides.append((label, rows))
    (label_a, rows_a), (label_b, rows_b) = sides
    other = dict(summary_rows(aggregate(rows_b)))
    return {"a": {"label": label_a, "runs": len(rows_a)}, "b": {"label": label_b, "runs": len(rows_b)},
            "rows": [{"metric": name, "a": value, "b": other.get(name, EMPTY)}
                     for name, value in summary_rows(aggregate(rows_a))],
            "verdict_changes": [line.removeprefix("- ") for line in verdict_changes(rows_a, rows_b, label_b)
                                if line != "- none"]}
```

Keep the module's imports at the top of the file (move these there; `aggregate` is already imported by Task 7).

- [ ] **Step 4: Implement `backend/app/services/harness_runs.py`**

```python
"""Cochrane harness runs started from the admin console (Plan 23c). The API side checks that a run can start
(harness_state), records it (start_run: one active run; a typed cap between one review's own cap and
HARNESS_MAX_USD) and cancels it; the harness worker (app/worker/harness.py) claims, updates and finishes it. Nothing
here spends money: the worker never starts a review whose own cap does not fit in what is left
(run_all strict_cap)."""
from __future__ import annotations

import json
import secrets
from datetime import UTC, datetime
from typing import Annotated, Any, Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.config import Settings
from app.db.models import HarnessRun
from app.evals import models as eval_models
from app.evals.freeze import _selected, entry_options
from app.evals.models import Manifest, ManifestEntry, load_manifest
from app.evals.results import list_results
from app.schemas.review import ReviewOptions
from app.services.admin_auth import AdminPrincipal
from app.services.audit import record
from app.services.budget import review_cost_cap
from app.services.review_service import Conflict, NotFound, ServiceError, Unprocessable

WORKER_KEY = "mra:harness:worker"
WORKER_TTL_SECONDS = 90
DEFAULT_CAP_USD = 1.0
REPEATS_MAX = 2
ACTIVE = ("queued", "running")
LABEL_PATTERN = r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}/[A-Za-z0-9][A-Za-z0-9._-]{0,63}$"
OUT_FIELDS = ("id", "run_id", "prompt_version", "status", "max_usd", "spent_usd", "repeats", "strata", "max_reviews",
              "compare_run", "planned", "done", "failed", "skipped", "created_by", "created_at", "started_at",
              "finished_at", "error", "report", "config")


class HarnessUnavailable(ServiceError):
    status_code = 503

    def __init__(self, reasons: list[str]) -> None:
        super().__init__("the harness cannot start a run now: " + ", ".join(reasons))
        self.reasons = reasons


class StartBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_usd: float = Field(gt=0, allow_inf_nan=False)
    repeats: int = Field(2, ge=1, le=REPEATS_MAX)
    strata: list[Annotated[str, Field(min_length=1, max_length=64)]] = Field(default_factory=list, max_length=20)
    max_reviews: int | None = Field(None, ge=1, le=1000)
    compare_run: str | None = Field(None, max_length=129, pattern=LABEL_PATTERN)
    confirm: Literal[True]


def selection(manifest: Manifest, strata: list[str], max_reviews: int | None) -> list[ManifestEntry]:
    """The checked reviews of the chosen strata (all when empty) that have a frozen pool, in manifest order."""
    entries = [e for e in _selected(manifest, None) if (not strata or e.stratum in strata)
               and eval_models.fixture_path(manifest.pool_version, e.id).exists()]
    return entries[:max_reviews] if max_reviews else entries


def per_review_cap(settings: Settings, entries: list[ManifestEntry]) -> float:
    return max((review_cost_cap(settings, ReviewOptions.clamped(entry_options(e))) for e in entries), default=0.0)


def run_out(row: HarnessRun) -> dict[str, Any]:
    return {k: getattr(row, k) for k in OUT_FIELDS}


def _manifest() -> Manifest | None:
    try:
        return load_manifest()
    except (OSError, ValueError, yaml.YAMLError):
        return None


async def _worker(redis) -> dict | None:
    try:
        raw = await redis.get(WORKER_KEY)
        return json.loads(raw) if raw else None
    except Exception:  # noqa: BLE001 - an unreachable Redis reads as "no worker"
        return None


async def harness_state(session_factory, redis, settings: Settings) -> dict[str, Any]:
    manifest = _manifest()
    reasons: list[str] = []
    strata: list[dict[str, Any]] = []
    selected = present = 0
    cap = 0.0
    if manifest is None:
        reasons.append("no_manifest")
    else:
        checked, ready = _selected(manifest, None), selection(manifest, [], None)
        names = [s.name for s in manifest.strata] or sorted({e.stratum for e in checked})
        strata = [{"name": n, "selected": sum(e.stratum == n for e in checked),
                   "with_fixtures": sum(e.stratum == n for e in ready)} for n in names]
        selected, present, cap = len(checked), len(ready), per_review_cap(settings, ready)
        if not ready:
            reasons.append("no_fixtures")
    if settings.graph_mode == "stub":
        reasons.append("stub_mode")
    worker = await _worker(redis)
    if worker is None:
        reasons.append("no_worker")
    async with session_factory() as session:
        active = (await session.execute(select(HarnessRun).where(HarnessRun.active.is_not(None)))).scalar_one_or_none()
        last = (await session.execute(
            select(HarnessRun).where(HarnessRun.status.in_(("done", "stopped")), HarnessRun.done + HarnessRun.failed > 0)
            .order_by(HarnessRun.id.desc()).limit(1))).scalar_one_or_none()
    if active is not None:
        reasons.append("active_run")
    return {"available": not reasons, "reasons": reasons, "prompt_version": settings.prompt_version,
            "pool_version": manifest.pool_version if manifest else None, "strata": strata,
            "fixtures": {"selected": selected, "present": present}, "worker": worker,
            "ceiling_usd": settings.harness_max_usd, "default_usd": DEFAULT_CAP_USD,
            "per_review_cap_usd": round(cap, 4),
            "typical_review_usd": round(last.spent_usd / (last.done + last.failed), 4) if last else None,
            "active": run_out(active) if active else None}


async def start_run(session_factory, redis, settings: Settings, actor: AdminPrincipal, body: StartBody, *,
                    ip_hash: str | None = None) -> HarnessRun:
    """Checks every rule, then records the run (queued, active) with its audit row. The caller enqueues it."""
    state = await harness_state(session_factory, redis, settings)
    if "active_run" in state["reasons"]:
        raise Conflict("a harness run is already queued or running")
    if state["reasons"]:
        raise HarnessUnavailable(state["reasons"])
    manifest = load_manifest()
    if set(body.strata) - {s["name"] for s in state["strata"]}:
        raise Unprocessable("unknown strata: pick from the list")
    entries = selection(manifest, body.strata, body.max_reviews)
    if not entries:
        raise Unprocessable("nothing to run: no checked review in the chosen strata has a frozen pool")
    cap, ceiling = per_review_cap(settings, entries), settings.harness_max_usd
    if body.max_usd > ceiling:
        raise Unprocessable(f"the cap is above the ceiling of ${ceiling:.2f} (HARNESS_MAX_USD)")
    if body.max_usd < cap:
        raise Unprocessable(f"the cap must cover at least one review's own cap (${cap:.2f})")
    if body.compare_run and body.compare_run not in {r["label"] for r in list_results()}:
        raise Unprocessable("the comparison run has no run files")
    now = datetime.now(UTC)
    run_id = f"console-{now:%Y%m%d-%H%M%S}-{secrets.token_hex(2)}"  # the suffix keeps two starts in one second apart
    row = HarnessRun(run_id=run_id, prompt_version=settings.prompt_version, status="queued", active=1,
                     max_usd=body.max_usd, spent_usd=0.0, repeats=body.repeats,
                     strata=sorted(set(body.strata)), max_reviews=body.max_reviews, compare_run=body.compare_run,
                     planned=len(entries) * body.repeats, done=0, failed=0, skipped=0,
                     created_by=actor.label[:64], created_at=now, config={})
    try:
        async with session_factory() as session, session.begin():
            session.add(row)
            await session.flush()
            await record(session, actor, "harness.start", target_type="harness_run", target_id=row.id,
                         after={"run_id": row.run_id, "max_usd": row.max_usd, "repeats": row.repeats,
                                "strata": row.strata, "max_reviews": row.max_reviews, "planned": row.planned},
                         ip_hash=ip_hash)
    except IntegrityError as exc:  # another start won the one active slot
        raise Conflict("a harness run is already queued or running") from exc
    return row


async def cancel_run(session_factory, actor: AdminPrincipal, run_pk: int, *,
                     ip_hash: str | None = None) -> HarnessRun:
    """Graceful: a running batch stops before its next review; a queued run is over at once. Clears a stuck row."""
    async with session_factory() as session, session.begin():
        row = await session.get(HarnessRun, run_pk)
        if row is None:
            raise NotFound("harness run not found")
        if row.active is None:
            raise Conflict(f"the run is already {row.status}")
        before = row.status
        row.status, row.active = "cancelled", None
        if before == "queued":
            row.finished_at = datetime.now(UTC)
        await record(session, actor, "harness.cancel", target_type="harness_run", target_id=row.id,
                     before={"status": before}, after={"status": "cancelled"}, ip_hash=ip_hash)
    return row


async def list_runs(session_factory, *, before: int | None = None,
                    limit: int = 20) -> tuple[list[HarnessRun], int | None]:
    stmt = select(HarnessRun).order_by(HarnessRun.id.desc()).limit(limit + 1)
    if before is not None:
        stmt = stmt.where(HarnessRun.id < before)
    async with session_factory() as session:
        rows = list((await session.execute(stmt)).scalars())
    return rows[:limit], (rows[limit - 1].id if len(rows) > limit else None)


async def get_run(session_factory, run_pk: int) -> HarnessRun:
    async with session_factory() as session:
        row = await session.get(HarnessRun, run_pk)
    if row is None:
        raise NotFound("harness run not found")
    return row


async def finish(session_factory, run_pk: int, *, status: str, summary=None, report: str | None = None,
                 error: str | None = None) -> None:
    """The run's end: counts, report and error; the active slot is freed; a cancelled run stays cancelled."""
    values: dict[str, Any] = {"active": None, "finished_at": datetime.now(UTC), "report": report,
                              "error": error[:500] if error else None}
    if summary is not None:
        values |= {"spent_usd": round(summary.spent, 6), "done": summary.done, "failed": summary.failed,
                   "skipped": summary.skipped}
    async with session_factory() as session, session.begin():
        current = await session.scalar(select(HarnessRun.status).where(HarnessRun.id == run_pk))
        if current is None:
            return
        if current != "cancelled":
            values["status"] = status
        await session.execute(update(HarnessRun).where(HarnessRun.id == run_pk).values(**values))
```

- [ ] **Step 5: Implement `backend/app/api/admin_harness.py`**

```python
"""Admin console: the Cochrane harness (Plan 23c). Reports and run folders are read from the mounted evals/cochrane
directory (read-only in the API container); a start records the run and enqueues it on the harness queue, whose worker
runs only with `docker compose --profile harness`. File reads and comparisons run in a thread."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from app.api.auth import ip_hash_of, require_admin
from app.api.deps import get_deps
from app.api.reviews import service_error_response
from app.evals.results import compare_results, list_reports, list_results, read_report
from app.logging import get_logger
from app.runtime import AppDeps
from app.services.harness_runs import (
    HarnessUnavailable,
    StartBody,
    cancel_run,
    finish,
    get_run,
    harness_state,
    list_runs,
    run_out,
    start_run,
)
from app.services.review_service import Identity, ServiceError

router = APIRouter()
log = get_logger(__name__)


@router.get("/admin/harness")
async def harness(deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)):
    return jsonable_encoder(await harness_state(deps.session_factory, deps.redis, await deps.service.effective()))


@router.get("/admin/harness/runs")
async def runs(before: int | None = Query(None, ge=1), limit: int = Query(20, ge=1, le=100),
               deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)):
    rows, nxt = await list_runs(deps.session_factory, before=before, limit=limit)
    return jsonable_encoder({"items": [run_out(r) for r in rows], "next": nxt})


@router.get("/admin/harness/runs/{run_pk}")
async def one_run(run_pk: int, deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)):
    try:
        return jsonable_encoder(run_out(await get_run(deps.session_factory, run_pk)))
    except ServiceError as exc:
        return service_error_response(exc)


@router.post("/admin/harness/runs", status_code=201)
async def start(body: StartBody, deps: AppDeps = Depends(get_deps), identity: Identity = Depends(require_admin)):
    settings = await deps.service.effective()
    try:
        row = await start_run(deps.session_factory, deps.redis, settings, identity.admin, body,
                              ip_hash=ip_hash_of(identity, deps))
    except HarnessUnavailable as exc:
        return JSONResponse(status_code=503, content={"detail": exc.detail, "reasons": exc.reasons})
    except ServiceError as exc:
        return service_error_response(exc)
    try:
        await deps.queue.enqueue_harness(row.id)
    except Exception:
        log.exception("harness_enqueue_failed", run=row.id)
        await finish(deps.session_factory, row.id, status="error", error="enqueue failed")
        return JSONResponse(status_code=503, content={"detail": "the harness queue is unavailable; try again",
                                                      "reasons": []})
    return JSONResponse(status_code=201, content=jsonable_encoder(run_out(row)))


@router.post("/admin/harness/runs/{run_pk}/cancel")
async def cancel(run_pk: int, deps: AppDeps = Depends(get_deps), identity: Identity = Depends(require_admin)):
    try:
        row = await cancel_run(deps.session_factory, identity.admin, run_pk, ip_hash=ip_hash_of(identity, deps))
    except ServiceError as exc:
        return service_error_response(exc)
    return jsonable_encoder(run_out(row))


@router.get("/admin/harness/reports")
async def reports(_: Identity = Depends(require_admin)):
    return {"items": await asyncio.to_thread(list_reports)}


@router.get("/admin/harness/reports/{name}")
async def report(name: str, _: Identity = Depends(require_admin)):
    try:
        text = await asyncio.to_thread(read_report, name)
    except FileNotFoundError:
        return JSONResponse(status_code=404, content={"detail": "no such report (or it is over 1 MB)"})
    return {"name": name, "text": text}


@router.get("/admin/harness/results")
async def results(_: Identity = Depends(require_admin)):
    return {"items": await asyncio.to_thread(list_results)}


@router.get("/admin/harness/compare")
async def compare(a: str = Query(max_length=129), b: str = Query(max_length=129), _: Identity = Depends(require_admin)):
    try:
        return await asyncio.to_thread(compare_results, a, b)
    except LookupError as exc:
        return JSONResponse(status_code=404, content={"detail": str(exc)})
    except FileNotFoundError:
        return JSONResponse(status_code=404, content={"detail": "the harness manifest is missing"})
    except ValueError as exc:
        return JSONResponse(status_code=422, content={"detail": str(exc)})
```

Register the router in `backend/app/main.py`, after `admin_runtime` (the import list stays alphabetical:
`admin_dashboard, admin_harness, admin_keys`):
`app.include_router(admin_harness.router, prefix="/api/v1", tags=["admin"], include_in_schema=False)`.
The enqueue fallback is `except Exception:` with `log.exception`, which ruff's BLE001 accepts, so it carries no `noqa`
(an unused one fails RUF100).

- [ ] **Step 6: Run the tests**

Run: `cd /d/MRA-plan-23c/backend && uv run pytest tests/unit/test_admin_harness_api.py tests/unit/test_eval_runtime.py tests/unit/test_eval_cli.py -q`
Expected: PASS (the symlink test may report SKIPPED on Windows; it runs in CI on Linux).

- [ ] **Step 7: Lint and commit**

```bash
cd /d/MRA-plan-23c/backend && uv run ruff check app tests
cd /d/MRA-plan-23c && git add backend/app/config.py backend/app/services/queue.py backend/app/evals/results.py \
  backend/app/services/harness_runs.py backend/app/api/admin_harness.py backend/app/main.py \
  backend/tests/conftest.py backend/tests/harness_helpers.py backend/tests/unit/test_admin_harness_api.py
git commit -m "feat(admin): harness page backend — availability, capped start with confirm, one active run, cancel, reports, compare (Plan 23c)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The harness worker and its opt-in compose service

**Files:**
- Modify: `backend/app/services/harness_runs.py` (job-side transitions: `claim`, `set_config`, `progress`, `run_stopped`, `requeue`)
- Create: `backend/app/worker/harness.py`
- Modify: `docker-compose.yml` (the `harness` service; the `api` read-only mount)
- Modify: `backend/.dockerignore`
- Test: `backend/tests/unit/test_harness_worker.py`

**Interfaces:**
- Consumes:
  - `run_all` with `strict_cap`, `spent_before`, `on_record`, `should_stop` (Task 7), and `prior_spend`, `write_report` (Task 7);
  - `selection`, `finish`, `WORKER_KEY`, `WORKER_TTL_SECONDS` (Task 8), `HARNESS_QUEUE`;
  - `load_runtime` (Task 3), `build_graph_deps(..., glossary=)` (Task 2);
  - from 23b: `load_effective` and `EffectiveConfig.resolve()` (LLM_PRESET applies while llm.yaml is the source), `cached_catalog(redis, loader)` and the worker's one-attempt `app.worker.llm_reload.load_live_catalog`.
- Produces:
  - `harness_runs.claim(session_factory, run_pk) -> HarnessRun | None`, `set_config(session_factory, run_pk, config)`, `progress(session_factory, run_pk, summary)`, `run_stopped(session_factory, run_pk) -> bool` and `requeue(session_factory, run_pk)`.
  - `app.worker.harness`:
    - `JOB_TIMEOUT_SECONDS = 43200`, `HEARTBEAT_SECONDS = 30`;
    - `async build_eval_deps(ctx) -> (deps, labels)`, `async run_harness(ctx, run_pk) -> dict` and `async heartbeat(ctx, interval=30)`;
    - `startup`, `shutdown` and `HarnessWorkerSettings`.
  - `run_harness` takes test seams from `ctx`: `ctx["run_all"]` and `ctx["build_eval_deps"]`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/unit/test_harness_worker.py`:

```python
import asyncio
import contextlib
import json
from pathlib import Path

import pytest
import yaml

from app.config import Settings
from app.db.models import HarnessRun
from app.evals import models
from app.evals.batch import BatchSummary
from app.graph.graph import GraphDeps
from app.services.admin_auth import AdminPrincipal
from app.services.config_store import save_version
from app.services.glossary_store import GLOSSARY_KIND
from app.services.harness_runs import WORKER_KEY
from app.services.http import HttpClient
from app.worker import harness as harness_worker
from app.worker import llm_reload
from app.worker.harness import HarnessWorkerSettings, build_eval_deps, heartbeat, run_harness
from tests.harness_helpers import make_eval_root, write_run
from tests.llm_helpers import MINIMAL, write_yaml

S = Settings(_env_file=None)
ROOT = Path(__file__).resolve().parents[3]


@pytest.fixture
def root(tmp_path, monkeypatch):
    monkeypatch.setattr(models, "EVAL_ROOT", tmp_path)
    make_eval_root(tmp_path)
    return tmp_path


async def add_run(session_factory, **kw):
    fields = {"run_id": "console-1", "prompt_version": S.prompt_version, "status": "queued", "active": 1,
              "max_usd": 1.0, "repeats": 1, "strata": [], "planned": 3, "created_by": "owner"} | kw
    row = HarnessRun(**fields)
    async with session_factory() as s, s.begin():
        s.add(row)
    return row.id


async def get(session_factory, pk):
    async with session_factory() as s:
        return await s.get(HarnessRun, pk)


def fake_run_all(summary: BatchSummary, seen: dict):
    async def run_all(deps, manifest, **kw):
        seen.update(kw)
        await kw["on_record"](None, summary)
        return summary
    return run_all


async def fake_deps(ctx):
    return GraphDeps(settings=S), {"llm_config": "db:3", "settings_version": "2", "glossary": "file"}


def ctx_for(session_factory, run_all):
    return {"session_factory": session_factory, "settings": S, "run_all": run_all, "build_eval_deps": fake_deps}


async def test_a_run_is_claimed_capped_and_finished(session_factory, root):
    pk = await add_run(session_factory)
    seen = {}
    out = await run_harness(ctx_for(session_factory, fake_run_all(BatchSummary(done=3, spent=0.2), seen)), pk)
    assert out["status"] == "done"
    assert (seen["strict_cap"], seen["max_usd"], seen["ids"]) == (True, 1.0, ["CD0", "CD1", "CD2"])
    assert seen["spent_before"] == 0.0 and seen["run_id"] == "console-1"
    row = await get(session_factory, pk)
    assert (row.status, row.active, row.done, row.spent_usd) == ("done", None, 3, 0.2)
    assert row.config == {"llm_config": "db:3", "settings_version": "2", "glossary": "file"}
    assert row.started_at is not None and row.finished_at is not None


async def test_earlier_spend_counts_and_the_cap_stop_is_recorded(session_factory, root):
    pk = await add_run(session_factory)
    write_run(S.prompt_version, "console-1", [("CD0", 1, 0.25)])
    seen = {}
    summary = BatchSummary(done=1, spent=0.5, stopped_for_budget=True)
    out = await run_harness(ctx_for(session_factory, fake_run_all(summary, seen)), pk)
    assert seen["spent_before"] == pytest.approx(0.25) and out["status"] == "stopped"
    row = await get(session_factory, pk)
    assert row.status == "stopped" and row.report == f"{S.prompt_version}-console-1.md"


async def test_a_cancelled_run_stops_before_the_next_review_and_stays_cancelled(session_factory, root):
    pk = await add_run(session_factory)

    async def run_all(deps, manifest, **kw):
        async with session_factory() as s, s.begin():  # the admin cancels while the batch runs
            row = await s.get(HarnessRun, pk)
            row.status, row.active = "cancelled", None
        return BatchSummary(done=1, spent=0.1, cancelled=await kw["should_stop"]())

    out = await run_harness(ctx_for(session_factory, run_all), pk)
    row = await get(session_factory, pk)
    assert out["status"] == "cancelled" and (row.status, row.active, row.done) == ("cancelled", None, 1)


async def test_cancelled_runs_are_not_claimed(session_factory, root):
    pk = await add_run(session_factory, status="cancelled", active=None)

    async def must_not_run(*a, **k):
        raise AssertionError("a cancelled run must not start")

    assert (await run_harness(ctx_for(session_factory, must_not_run), pk))["status"] == "skipped"


async def test_a_prompt_version_mismatch_errors_before_anything_runs(session_factory, root):
    pk = await add_run(session_factory, prompt_version="older")
    called = []

    async def run_all(*a, **k):
        called.append(1)

    out = await run_harness(ctx_for(session_factory, run_all), pk)
    row = await get(session_factory, pk)
    assert out["status"] == "error" and called == [] and "prompt_version" in row.error and row.active is None


async def test_a_shutdown_puts_the_run_back_in_the_queue_and_the_retry_resumes(session_factory, root):
    pk = await add_run(session_factory)

    async def interrupted(*a, **k):
        raise asyncio.CancelledError

    with pytest.raises(asyncio.CancelledError):
        await run_harness(ctx_for(session_factory, interrupted), pk)
    row = await get(session_factory, pk)
    assert (row.status, row.active) == ("queued", 1)
    seen = {}
    assert (await run_harness(ctx_for(session_factory, fake_run_all(BatchSummary(done=1), seen)), pk))["status"] == "done"


async def test_heartbeat_and_worker_settings(redis):
    task = asyncio.create_task(heartbeat({"redis_client": redis}, interval=0.01))
    try:
        for _ in range(100):
            await asyncio.sleep(0.01)
            if await redis.get(WORKER_KEY):
                break
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
    assert json.loads(await redis.get(WORKER_KEY))["worker"] and 0 < await redis.ttl(WORKER_KEY) <= 90
    assert (HarnessWorkerSettings.queue_name, HarnessWorkerSettings.max_jobs) == ("arq:harness", 1)
    assert HarnessWorkerSettings.functions[0].timeout_s == 12 * 3600


def test_compose_keeps_the_harness_opt_in_and_fixtures_out_of_images():
    compose = yaml.safe_load((ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
    harness = compose["services"]["harness"]
    assert harness["profiles"] == ["harness"]
    assert harness["command"] == ["arq", "app.worker.harness.HarnessWorkerSettings"]
    assert "./backend/evals/cochrane:/app/evals/cochrane" in harness["volumes"]
    assert "./backend/evals/cochrane:/app/evals/cochrane:ro" in compose["services"]["api"]["volumes"]
    ignored = set((ROOT / "backend" / ".dockerignore").read_text(encoding="utf-8").split())
    assert {"evals/cochrane/fixtures", "evals/cochrane/runs", "evals/cochrane/*.bak"} <= ignored


async def test_eval_deps_use_the_models_settings_glossary_and_catalog_in_force(tmp_path, session_factory, redis,
                                                                              monkeypatch):
    settings = Settings(_env_file=None, openrouter_api_key="sk-or-x",
                        llm_config_path=str(write_yaml(tmp_path / "llm.yaml", MINIMAL)))
    async with session_factory() as s, s.begin():
        await save_version(s, AdminPrincipal(kind="cli", id=None, label="cli"), GLOSSARY_KIND,
                           {"terms": [{"en": "placebo", "th": "ยาหลอก"}]}, settings=settings, base_version=None)
    loaders = []

    async def fake_cached(redis_client, loader):
        loaders.append(loader)
        return {}

    monkeypatch.setattr(harness_worker, "cached_catalog", fake_cached)
    http = HttpClient(timeout=5)
    try:
        deps, labels = await build_eval_deps({"settings": settings, "session_factory": session_factory,
                                              "redis_client": redis, "http": http})
    finally:
        await http.aclose()
    assert labels == {"llm_config": "file", "settings_version": "env", "glossary": "1"}
    assert deps.glossary.label == "1" and deps.llms.preset == "cheap" and (deps.openalex, deps.mcp) == (None, None)
    assert loaders == [llm_reload.load_live_catalog]  # 23b's one-attempt loader, never the shared client's retries
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23c/backend && uv run pytest tests/unit/test_harness_worker.py -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.worker.harness'`.

- [ ] **Step 3: Job-side transitions**

Append to `backend/app/services/harness_runs.py`:

```python
async def claim(session_factory, run_pk: int) -> HarnessRun | None:
    """queued → running; a retry after a shutdown finds it queued again. None when it was cancelled or finished."""
    async with session_factory() as session, session.begin():
        row = await session.get(HarnessRun, run_pk)
        if row is None or row.active is None or row.status not in ACTIVE:
            return None
        row.status = "running"
        row.started_at = row.started_at or datetime.now(UTC)
    return row


async def set_config(session_factory, run_pk: int, config: dict[str, str]) -> None:
    async with session_factory() as session, session.begin():
        await session.execute(update(HarnessRun).where(HarnessRun.id == run_pk).values(config=config))


async def progress(session_factory, run_pk: int, summary) -> None:
    """Counts and spend after each record; never the status, so a cancel is not overwritten."""
    async with session_factory() as session, session.begin():
        await session.execute(update(HarnessRun).where(HarnessRun.id == run_pk).values(
            spent_usd=round(summary.spent, 6), done=summary.done, failed=summary.failed, skipped=summary.skipped))


async def run_stopped(session_factory, run_pk: int) -> bool:
    """True once the run is no longer running (the admin cancelled it): the batch stops before its next review."""
    async with session_factory() as session:
        status = await session.scalar(select(HarnessRun.status).where(HarnessRun.id == run_pk))
    return status != "running"


async def requeue(session_factory, run_pk: int) -> None:
    """Worker shutdown: a running run goes back to queued; arq retries the job and run_all skips finished files."""
    async with session_factory() as session, session.begin():
        await session.execute(update(HarnessRun).where(HarnessRun.id == run_pk, HarnessRun.status == "running")
                              .values(status="queued"))
```

- [ ] **Step 4: Implement `backend/app/worker/harness.py`**

`build_eval_deps` builds the deps as a review worker does after 23b's final fix: the shared catalog cache with the
worker's one-attempt loader (a model's structured-output method and price then match production; the eval CLI passes no
catalog), the effective config resolved before anything is spent, and the settings and glossary in force.
`run_harness`'s fallback is `except Exception as exc:` with `log.exception`, so it carries no `noqa` (RUF100).

```python
"""The Cochrane harness worker (Plan 23c). It has its own arq queue (HARNESS_QUEUE) and process, so a run of hours
never takes a review slot, and it runs one job at a time. A job replays the frozen pools with the production nodes
(run_all) on the service's effective models (23b), settings and glossary (23c), inside the run's USD cap:
run_all(strict_cap=True) never starts a review whose own cap does not fit in what is left, and a retried job counts
what earlier attempts spent (the run files). Cancel is graceful (checked before each review). The service starts only
with `docker compose --profile harness up -d harness`."""
from __future__ import annotations

import asyncio
import contextlib
import json
import os
import socket
from datetime import UTC, datetime
from typing import ClassVar

from arq import func
from arq.connections import RedisSettings
from redis.asyncio import Redis

from app.cli.eval import git_sha
from app.config import get_settings
from app.db.session import make_engine, make_session_factory
from app.evals.batch import run_all
from app.evals.models import load_manifest
from app.evals.results import prior_spend, write_report
from app.graph.factory import build_graph_deps
from app.logging import configure_logging, get_logger
from app.services.harness_runs import (
    WORKER_KEY,
    WORKER_TTL_SECONDS,
    claim,
    finish,
    progress,
    requeue,
    run_stopped,
    selection,
    set_config,
)
from app.services.http import DEFAULT_MIN_INTERVAL, HttpClient
from app.services.llm_store import load_effective
from app.services.model_catalog import cached_catalog
from app.services.queue import HARNESS_QUEUE
from app.services.runtime_config import load_runtime
from app.worker.llm_reload import load_live_catalog

log = get_logger(__name__)
JOB_TIMEOUT_SECONDS = 12 * 3600
HEARTBEAT_SECONDS = 30


async def build_eval_deps(ctx: dict):
    """Graph deps for a replay, built as a review worker builds them: the effective LLM config (23b's load_effective;
    LLM_PRESET applies while llm.yaml is the source), the settings and glossary in force, and the OpenRouter catalog the
    API and the review workers share (cached_catalog with 23b's one-attempt worker loader), so structured-output
    methods and prices match production. No citation network and no external tools, as in the eval CLI. Returns the
    deps and the labels the run records."""
    base = ctx["settings"]
    async with ctx["session_factory"]() as session:
        effective = await load_effective(session, base)
    resolved = effective.resolve()  # an LLM_PRESET that names no preset fails here, before anything is spent
    runtime = await load_runtime(ctx["session_factory"], base)
    catalog = await cached_catalog(ctx["redis_client"], load_live_catalog)
    deps = build_graph_deps(runtime.settings, ctx["http"], catalog=catalog, resolved=resolved,
                            config_version=effective.label, glossary=runtime.glossary)
    deps.openalex, deps.mcp = None, None
    return deps, {"llm_config": effective.label, "settings_version": runtime.settings_version,
                  "glossary": runtime.glossary.label}


async def run_harness(ctx: dict, run_pk: int) -> dict:
    session_factory = ctx["session_factory"]
    row = await claim(session_factory, run_pk)
    if row is None:
        return {"run": run_pk, "status": "skipped"}
    try:
        deps, labels = await ctx.get("build_eval_deps", build_eval_deps)(ctx)
        await set_config(session_factory, run_pk, labels)
        pv = deps.settings.prompt_version
        if pv != row.prompt_version:
            raise RuntimeError(f"this worker runs prompt_version {pv} but the run was started for "
                               f"{row.prompt_version}; rebuild the containers")
        manifest = load_manifest()
        entries = selection(manifest, row.strata or [], row.max_reviews)

        async def on_record(rec, summary) -> None:
            await progress(session_factory, run_pk, summary)

        async def should_stop() -> bool:
            return await run_stopped(session_factory, run_pk)

        summary = await ctx.get("run_all", run_all)(
            deps, manifest, run_id=row.run_id, repeats=row.repeats, max_usd=row.max_usd,
            ids=[e.id for e in entries], git_sha=git_sha(), strict_cap=True,
            spent_before=prior_spend(pv, row.run_id), on_record=on_record, should_stop=should_stop)
        report = write_report(pv, row.run_id, manifest, row.compare_run)
        status = "cancelled" if summary.cancelled else "stopped" if summary.stopped_for_budget else "done"
        await finish(session_factory, run_pk, status=status, summary=summary, report=report.name if report else None)
        log.info("harness_run_finished", run=run_pk, status=status, spent=round(summary.spent, 4))
        return {"run": run_pk, "status": status, "spent_usd": round(summary.spent, 6)}
    except asyncio.CancelledError:
        await requeue(session_factory, run_pk)
        raise
    except Exception as exc:  # recorded on the run, not retried (log.exception keeps the traceback)
        log.exception("harness_run_failed", run=run_pk)
        await finish(session_factory, run_pk, status="error", error=f"{type(exc).__name__}: {exc}")
        return {"run": run_pk, "status": "error"}


async def heartbeat(ctx: dict, interval: float = HEARTBEAT_SECONDS) -> None:
    """The console's sign of life (WORKER_KEY expires 90 s after the last beat)."""
    name = f"{socket.gethostname()}:{os.getpid()}"
    while True:
        try:
            await ctx["redis_client"].set(WORKER_KEY, json.dumps(
                {"worker": name, "seen_at": datetime.now(UTC).isoformat(timespec="seconds")}), ex=WORKER_TTL_SECONDS)
        except Exception:  # noqa: BLE001 - the next beat retries
            log.warning("harness_heartbeat_failed")
        await asyncio.sleep(interval)


async def startup(ctx: dict) -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    ctx["settings"] = settings
    ctx["engine"] = make_engine(settings.database_url)
    ctx["session_factory"] = make_session_factory(ctx["engine"])
    ctx["redis_client"] = Redis.from_url(settings.redis_url, decode_responses=True)
    ctx["http"] = HttpClient(timeout=settings.http_timeout_seconds, min_interval=DEFAULT_MIN_INTERVAL)
    ctx["heartbeat"] = asyncio.create_task(heartbeat(ctx))
    log.info("harness_worker_started", graph_mode=settings.graph_mode)


async def shutdown(ctx: dict) -> None:
    task = ctx.get("heartbeat")
    if task is not None:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await task
    with contextlib.suppress(Exception):
        await ctx["redis_client"].delete(WORKER_KEY)
    await ctx["http"].aclose()
    await ctx["redis_client"].aclose()
    await ctx["engine"].dispose()


class HarnessWorkerSettings:
    functions: ClassVar[list] = [func(run_harness, name="run_harness", timeout=JOB_TIMEOUT_SECONDS, max_tries=3)]
    queue_name = HARNESS_QUEUE
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(get_settings().redis_url)
    max_jobs = 1
    job_timeout = JOB_TIMEOUT_SECONDS
    retry_jobs = True  # a shutdown re-runs the job; it resumes (existing run files are skipped, their cost counted)
    max_tries = 3
    keep_result = 0
    health_check_interval = 60
```

- [ ] **Step 5: Compose and the image**

Append to `backend/.dockerignore` (today it holds `.venv`, `__pycache__`, `*.pyc`, `.pytest_cache`, `.ruff_cache`,
`tests` and `.env`, so images carry the frozen fixtures and run files; the build context is `./backend`, so the paths
are relative to it):

```
evals/cochrane/fixtures
evals/cochrane/runs
evals/cochrane/*.bak
```

In `docker-compose.yml`:
- **`api.volumes`:** add `- ./backend/evals/cochrane:/app/evals/cochrane:ro  # harness reports and run files (Plan 23c)`.
- **New `harness` service** after `worker`:

```yaml
  # Cochrane harness runs started from the admin console (Plan 23c). Off by default: start it with
  # `docker compose --profile harness up -d harness`. It writes run files and reports into backend/evals/cochrane
  # (fixtures and runs hold third-party abstracts and stay out of git and out of the image). Every run spends real
  # money up to the cap the admin types (never above HARNESS_MAX_USD).
  harness:
    image: mra/backend:dev
    profiles: ["harness"]
    env_file: .env
    command: ["arq", "app.worker.harness.HarnessWorkerSettings"]
    depends_on:
      migrate:
        condition: service_completed_successfully
      redis:
        condition: service_healthy
    restart: unless-stopped
    volumes:
      - ./backend/config:/app/config:ro
      - ./backend/evals/cochrane:/app/evals/cochrane
    networks: [data, search]
```

- [ ] **Step 6: Run the tests**

Run: `cd /d/MRA-plan-23c/backend && uv run pytest tests/unit/test_harness_worker.py tests/unit/test_admin_harness_api.py -q`
Expected: PASS. Then run `cd /d/MRA-plan-23c && docker compose config --quiet` (no output means the file parses) and
`docker compose --profile harness config --services` (the list includes `harness`).

- [ ] **Step 7: Lint and commit**

```bash
cd /d/MRA-plan-23c/backend && uv run ruff check app tests
cd /d/MRA-plan-23c && git add backend/app/services/harness_runs.py backend/app/worker/harness.py docker-compose.yml \
  backend/.dockerignore backend/tests/unit/test_harness_worker.py
git commit -m "feat(harness): harness worker on its own queue (compose profile), strict cap, resume with earlier spend, graceful cancel, heartbeat; fixtures stay out of images (Plan 23c)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Frontend foundation and the settings page

**Files:**
- Modify: `frontend/src/lib/admin-types.ts`, `frontend/src/lib/admin-api.ts`, `frontend/src/lib/admin-copy.ts`
- Modify: `frontend/src/components/admin/admin-nav.tsx` (add "ตั้งค่า", "อภิธานศัพท์" and "Harness"), and
  `frontend/src/components/admin/admin-gate.test.tsx` (its nav test lists every link)
- Create: `frontend/src/lib/admin-workers.ts` (moved out of `models-view.tsx`), `frontend/src/components/admin/use-worker-follow-up.ts`,
  `frontend/src/components/admin/versioned-page.tsx`
- Modify: `frontend/src/components/admin/models-view.tsx` (imports the moved helpers and uses `useWorkerFollowUp`; no
  behaviour change)
- Create: `frontend/src/components/admin/worker-versions.tsx`, `frontend/src/components/admin/version-history.tsx`, `frontend/src/components/admin/settings-view.tsx`
- Create: `frontend/src/app/admin/(console)/settings/page.tsx`
- Create: `frontend/src/test/admin-runtime-fixtures.ts`
- Test: `frontend/src/components/admin/version-history.test.tsx`, `frontend/src/components/admin/settings-view.test.tsx`; add cases to `frontend/src/lib/admin-api.test.ts`

**Reuse of the 23b models page.** The settings and glossary documents work like the LLM config: versions, a
`base_version` 409, restore and reset, workers that pick a version up within 30 s. So their pages follow `ModelsView`
rather than a new model, and this task moves the shared parts out of it:
- `isStale`, `STALE_AFTER_MS`, `POLL_MS`, `POLL_WINDOW_MS` and `SETTLING_MS` move to `src/lib/admin-workers.ts`;
- ModelsView's two follow-up effects (poll every 10 s while a worker lags, for at most 2 minutes after a write; "settling"
  for 60 s after the page's own write) become `useWorkerFollowUp`, which ModelsView then uses;
- `useVersionedPage` (in `versioned-page.tsx`) is ModelsView's draft model without its llm.yaml specifics (`runningDoc`,
  `refused`): a draft `{doc, origin, base}`, `load(saved, savedId)` with request numbers, the `WriteTracker` guard that
  keeps a background read from landing ahead of a write's own re-read, and `reconcileDraft`, which is ModelsView's
  `reconcile`. ModelsView keeps its own reconcile in 23c (moving it onto the hook is a later clean-up);
- `DraftStatus` is ModelsView's "the server moved on" block ("ทิ้งการแก้ไข" through `ConfirmButton` with a `hint`, or
  "ใช้ร่างนี้ต่อจากเวอร์ชันล่าสุด") and its focused note;
- `VersionHistory` is `ModelsHistory` for the two kinds: its own notice with `WORKERS_NOT_NOTIFIED`, `onChanged` after a
  restore, reset or 409, separate load and action errors, the `generation` guard for "โหลดเพิ่ม", and no reset while the
  default is in use;
- `WorkerVersions` uses the models header's rules: "changing" while settling, a warning for another version, a reload
  error or a worker silent for over 2 minutes, in words as well as colour.
So a 409 no longer offers "โหลดค่าล่าสุด" (which threw the draft away): the page re-reads, keeps the draft on its base and
offers both ways forward, as the models page does.

**Interfaces:**
- Consumes:
  - the routes from Tasks 6 and 8;
  - `useAdmin`, `ConfirmButton` (with 23b's `hint`), the `ui.ts` classes, `mockAdminFetch`/`renderAdmin` (23a);
  - from 23b: the `LoadedWorker` type, `WriteTracker` (`models-save-bar.tsx`), `WORKERS_NOT_NOTIFIED`, `formatWhen`,
    ModelsView's helpers named above, and the nav's "โมเดล" link.
- Produces:
  - Types:
    - `SettingSpec`, `SettingValue`, `SettingsState`, `FieldError`, `SettingsReport`;
    - `GlossaryTerm`, `GlossaryState`, `GlossaryReport`;
    - `RuntimeKind`, `RuntimeVersion`, `SavedVersion`;
    - `HarnessStatus`, `HarnessRun`, `HarnessState`, `HarnessReportItem`, `HarnessResultItem`, `HarnessCompare`, `HarnessStartBody`;
    - `LoadedWorker` gains `settings`, `glossary` and `runtime_error`.
  - `adminApi`:
    - settings: `settings`, `validateSettings`, `saveSettings`;
    - glossary: `glossary`, `validateGlossary`, `saveGlossary`;
    - both: `runtimeVersions`, `restoreRuntime`, `resetRuntime`;
    - harness: `harness`, `harnessRuns`, `startHarness`, `cancelHarness`, `harnessReports`, `harnessReport`, `harnessResults`, `harnessCompare`.
  - Copy: `SETTING_LABEL`, `SETTING_GROUP_LABEL`, `SETTING_GROUP_ORDER`, `APPLIES_LABEL`, `RUNTIME_SOURCE_LABEL`, `HARNESS_STATUS_LABEL`, `HARNESS_REASON_LABEL`, `harnessReasonText` and eight `ACTION_LABEL` entries.
  - Shared: `isStale`, `STALE_AFTER_MS`, `POLL_MS`, `POLL_WINDOW_MS`, `SETTLING_MS` (`@/lib/admin-workers`);
    `useWorkerFollowUp(lagging, poll) -> {settling, wrote}`; `useVersionedPage(spec)`, `VersionedSpec`,
    `VersionedDraft`, `reconcileDraft`, `<DraftStatus moved base current note onDiscard onRebase versionName />`.
  - Components:
    - `<WorkerVersions loaded field expected now settling />`;
    - `<VersionHistory kind base resetLabel resetHint emptyText onChanged writes />`;
    - `<SettingsView />`, `SETTINGS_PAGE`, `STALE_TEXT` and `draftValues(specs, draft)`.

- [ ] **Step 1: Types, client and copy**

Append to `frontend/src/lib/admin-types.ts` (and add the three optional fields to 23b's `LoadedWorker`:
`settings?: string | null; glossary?: string | null; runtime_error?: string | null;`):

```ts
/** Plan 23c: runtime settings, the glossary and the harness. Mirrors backend/app/api/admin_runtime.py and admin_harness.py. */
export type SettingValue = string | number;
export interface SettingSpec {
  name: string; kind: "rate" | "int" | "float"; group: "limits" | "capacity" | "cost" | "workers" | "cache";
  applies: "api" | "worker" | "both"; min: number | null; max: number | null;
}
export interface SettingsState {
  source: "db" | "env"; version: number | null; values: Record<string, SettingValue>; overrides: Record<string, SettingValue>;
  env: Record<string, SettingValue>; specs: SettingSpec[]; worst_case_review_usd: number; loaded: LoadedWorker[];
}
export interface FieldError { field: string | null; message: string }
export interface SettingsReport {
  ok: boolean; errors: FieldError[]; warnings: string[]; values: Record<string, SettingValue> | null;
  worst_case_review_usd: number | null;
}
export interface GlossaryTerm { en: string; th: string; abbr: string | null; note: string | null }
export interface GlossaryState {
  source: "db" | "file"; version: number | null; terms: GlossaryTerm[]; chars: number; max_chars: number; loaded: LoadedWorker[];
}
export interface GlossaryReport { ok: boolean; errors: FieldError[]; warnings: string[]; preview: string | null; chars: number | null }
export type RuntimeKind = "settings" | "glossary";
export interface RuntimeVersion {
  version: number; kind: RuntimeKind; created_at: string; created_by: string; note: string | null;
  source: "edit" | "restore" | "reset"; restored_from: number | null; changes: Record<string, unknown>;
}
export interface SavedVersion extends RuntimeVersion { workers_notified: boolean }
export type HarnessStatus = "queued" | "running" | "done" | "stopped" | "cancelled" | "error";
export interface HarnessRun {
  id: number; run_id: string; prompt_version: string; status: HarnessStatus; max_usd: number; spent_usd: number;
  repeats: number; strata: string[]; max_reviews: number | null; compare_run: string | null; planned: number;
  done: number; failed: number; skipped: number; created_by: string; created_at: string; started_at: string | null;
  finished_at: string | null; error: string | null; report: string | null; config: Record<string, string>;
}
export interface HarnessState {
  available: boolean; reasons: string[]; prompt_version: string; pool_version: string | null;
  strata: { name: string; selected: number; with_fixtures: number }[]; fixtures: { selected: number; present: number };
  worker: { worker: string; seen_at: string } | null; ceiling_usd: number; default_usd: number;
  per_review_cap_usd: number; typical_review_usd: number | null; active: HarnessRun | null;
}
export interface HarnessReportItem { name: string; prompt_version: string | null; run_id: string | null; size: number; modified_at: string }
export interface HarnessResultItem { label: string; prompt_version: string; run_id: string; files: number; modified_at: string }
export interface HarnessCompare {
  a: { label: string; runs: number }; b: { label: string; runs: number };
  rows: { metric: string; a: string; b: string }[]; verdict_changes: string[];
}
export interface HarnessStartBody {
  max_usd: number; repeats: number; strata: string[]; max_reviews: number | null; compare_run: string | null; confirm: true;
}
```

Add to `adminApi` in `frontend/src/lib/admin-api.ts` (import the new types):

```ts
  settings: () => call<SettingsState>("/settings"),
  validateSettings: (values: Record<string, SettingValue>) => call<SettingsReport>("/settings/validate", send("POST", { values })),
  saveSettings: (body: { values: Record<string, SettingValue>; base_version: number | null; note?: string }) =>
    call<SavedVersion>("/settings", send("POST", body)),
  glossary: () => call<GlossaryState>("/glossary"),
  validateGlossary: (terms: GlossaryTerm[]) => call<GlossaryReport>("/glossary/validate", send("POST", { terms })),
  saveGlossary: (body: { terms: GlossaryTerm[]; base_version: number | null; note?: string }) =>
    call<SavedVersion>("/glossary", send("POST", body)),
  runtimeVersions: (kind: RuntimeKind, before?: number | null) =>
    call<Page<RuntimeVersion>>(`/${kind}/versions${before ? `?before=${before}` : ""}`),
  restoreRuntime: (kind: RuntimeKind, version: number, base: number | null, note?: string) =>
    call<SavedVersion>(`/${kind}/versions/${version}/restore`, send("POST", { base_version: base, note })),
  resetRuntime: (kind: RuntimeKind, base: number | null, note?: string) =>
    call<SavedVersion>(`/${kind}/reset`, send("POST", { base_version: base, note })),
  harness: () => call<HarnessState>("/harness"),
  harnessRuns: (before?: number | null) => call<Page<HarnessRun>>(`/harness/runs${before ? `?before=${before}` : ""}`),
  startHarness: (body: HarnessStartBody) => call<HarnessRun>("/harness/runs", send("POST", body)),
  cancelHarness: (id: number) => call<HarnessRun>(`/harness/runs/${id}/cancel`, send("POST")),
  harnessReports: () => call<{ items: HarnessReportItem[] }>("/harness/reports"),
  harnessReport: (name: string) => call<{ name: string; text: string }>(`/harness/reports/${enc(name)}`),
  harnessResults: () => call<{ items: HarnessResultItem[] }>("/harness/results"),
  harnessCompare: (a: string, b: string) => call<HarnessCompare>(`/harness/compare?a=${enc(a)}&b=${enc(b)}`),
```

Add to `frontend/src/lib/admin-copy.ts`:

```ts
export const SETTING_LABEL: Record<string, string> = {
  review_rate_limit: "รีวิวต่อ IP (ไม่มี API key)", api_key_rate_limit: "รีวิวต่อ API key",
  paper_search_rate_limit: "ค้นหางานวิจัย (REST และ MCP)", sse_max_per_ip: "event stream ที่เปิดพร้อมกันต่อ client",
  max_queued_reviews: "รีวิวที่รอคิวได้สูงสุด", max_reviews_per_day: "รีวิวใหม่ต่อวัน", max_usd_per_day: "งบ LLM ต่อวัน (USD)",
  review_cost_base_usd: "งบต่อรีวิว: ค่าพื้นฐาน (USD)", review_cost_per_paper_usd: "งบต่อรีวิว: ต่องานที่วิเคราะห์ (USD)",
  review_cost_per_candidate_usd: "งบต่อรีวิว: ต่องานที่คัดกรอง (USD)", max_cost_per_review_usd: "เพดานงบต่อรีวิว (USD)",
  llm_concurrency: "LLM call พร้อมกันต่อ worker", result_cache_ttl_seconds: "อายุ cache ผลรีวิว (วินาที)",
};
export const SETTING_GROUP_ORDER: SettingSpec["group"][] = ["limits", "capacity", "cost", "workers", "cache"];
export const SETTING_GROUP_LABEL: Record<SettingSpec["group"], string> = {
  limits: "อัตราจำกัด", capacity: "ความจุ", cost: "งบค่าใช้จ่าย", workers: "Worker", cache: "Cache",
};
export const APPLIES_LABEL: Record<SettingSpec["applies"], string> = {
  api: "API · ภายใน 5 วินาที", worker: "worker · รีวิวถัดไป หรือภายใน 30 วินาที", both: "API และ worker",
};
export const RUNTIME_SOURCE_LABEL: Record<RuntimeVersion["source"], string> = { edit: "แก้ไข", restore: "ย้อนกลับ", reset: "กลับค่าตั้งต้น" };
export const HARNESS_STATUS_LABEL: Record<HarnessStatus, string> = {
  queued: "รอคิว", running: "กำลังรัน", done: "เสร็จ", stopped: "หยุดเพราะถึงงบ", cancelled: "ยกเลิกแล้ว", error: "ผิดพลาด",
};
export const HARNESS_REASON_LABEL: Record<string, string> = {
  no_manifest: "ไม่พบ manifest ของ harness (evals/cochrane/manifest.yaml)",
  no_fixtures: "ไม่มี frozen pool ในเครื่องนี้ ต้อง mount โฟลเดอร์ evals/cochrane ที่มี fixtures",
  no_worker: "harness worker ไม่ทำงาน (เริ่มด้วย docker compose --profile harness up -d harness)",
  stub_mode: "ระบบอยู่ใน GRAPH_MODE=stub รัน harness ไม่ได้",
  active_run: "มี harness run ที่รอคิวหรือกำลังรันอยู่",
};
export function harnessReasonText(code: string): string {
  return HARNESS_REASON_LABEL[code] ?? code;
}
```

Add to `ACTION_LABEL`:

```ts
  "settings.save": "บันทึกการตั้งค่า", "settings.restore": "ย้อนการตั้งค่า", "settings.reset": "กลับไปใช้ค่า env",
  "glossary.save": "บันทึกอภิธานศัพท์", "glossary.restore": "ย้อนอภิธานศัพท์", "glossary.reset": "กลับไปใช้อภิธานศัพท์ตั้งต้น",
  "harness.start": "เริ่มรัน harness", "harness.cancel": "ยกเลิก harness run",
```

In `admin-nav.tsx`, add `["/admin/settings", "ตั้งค่า"], ["/admin/glossary", "อภิธานศัพท์"], ["/admin/harness", "Harness"]`
to `LINKS` after `["/admin/models", "โมเดล"]`. 23a's `admin-gate.test.tsx` lists every link in order, so its test
"links the models page after API keys" becomes:

```tsx
  it("links the models page after API keys, then settings, glossary and harness (Plan 23c)", async () => {
    mockAdminFetch();
    await renderAdmin(<p>เนื้อหา</p>);
    const links = within(screen.getByRole("navigation", { name: "ผู้ดูแลระบบ" })).getAllByRole("link").map((a) => a.textContent);
    expect(links).toEqual(["Dashboard", "รีวิว", "API keys", "โมเดล", "ตั้งค่า", "อภิธานศัพท์", "Harness", "Audit log"]);
    expect(screen.getByRole("link", { name: "โมเดล" })).toHaveAttribute("href", "/admin/models");
    expect(screen.getByRole("link", { name: "อภิธานศัพท์" })).toHaveAttribute("href", "/admin/glossary");
  });
```

Add inside `describe("adminApi", ...)` in `frontend/src/lib/admin-api.test.ts`:

```ts
  it("builds the runtime and harness URLs and bodies", async () => {
    const fn = stub(200, { items: [], next: null });
    await adminApi.runtimeVersions("glossary", 4);
    await adminApi.harnessCompare("2026-10-11.1/baseline", "pv/run b");
    await adminApi.restoreRuntime("settings", 2, 3);
    const urls = fn.mock.calls.map((c) => c[0]);
    expect(urls).toEqual(["/api/v1/admin/glossary/versions?before=4",
      "/api/v1/admin/harness/compare?a=2026-10-11.1%2Fbaseline&b=pv%2Frun%20b",
      "/api/v1/admin/settings/versions/2/restore"]);
    const init = fn.mock.calls[2][1];
    expect(init.headers).toMatchObject({ "X-MRA-Admin": "1" });
    expect(JSON.parse(init.body as string)).toEqual({ base_version: 3 });
  });
```

- [ ] **Step 2: Fixtures and failing tests**

`frontend/src/test/admin-runtime-fixtures.ts`:

```ts
import type {
  GlossaryState, HarnessCompare, HarnessReportItem, HarnessResultItem, HarnessRun, HarnessState, LoadedWorker, Page,
  RuntimeVersion, SettingSpec, SettingsState,
} from "@/lib/admin-types";

export const WORKER: LoadedWorker = { worker: "worker-1:7", version: "3", preset: "cheap", loaded_at: "2026-10-13T10:00:00Z",
  error: null, settings: "2", glossary: "4", runtime_error: null };

export const SPECS: SettingSpec[] = [
  { name: "review_rate_limit", kind: "rate", group: "limits", applies: "api", min: null, max: null },
  { name: "max_queued_reviews", kind: "int", group: "capacity", applies: "api", min: 1, max: 1000 },
  { name: "max_usd_per_day", kind: "float", group: "capacity", applies: "api", min: 0.1, max: 1000 },
  { name: "llm_concurrency", kind: "int", group: "workers", applies: "worker", min: 1, max: 64 },
];

export const SETTINGS: SettingsState = {
  source: "db", version: 2, specs: SPECS, worst_case_review_usd: 0.4, loaded: [WORKER],
  values: { review_rate_limit: "5/hour", max_queued_reviews: 80, max_usd_per_day: 10, llm_concurrency: 16 },
  overrides: { max_queued_reviews: 80 },
  env: { review_rate_limit: "5/hour", max_queued_reviews: 50, max_usd_per_day: 10, llm_concurrency: 16 },
};

export const SETTINGS_VERSIONS: Page<RuntimeVersion> = {
  items: [
    { version: 2, kind: "settings", created_at: "2026-10-13T10:00:00Z", created_by: "owner", note: "busier",
      source: "edit", restored_from: null, changes: { max_queued_reviews: "50 → 80" } },
    { version: 1, kind: "settings", created_at: "2026-10-12T10:00:00Z", created_by: "owner", note: null,
      source: "edit", restored_from: null, changes: { max_queued_reviews: "env → 50" } },
  ],
  next: null,
};

export const GLOSSARY: GlossaryState = {
  source: "db", version: 4, chars: 52, max_chars: 4000, loaded: [WORKER],
  terms: [
    { en: "hazard ratio", th: "อัตราส่วนฮาซาร์ด", abbr: "HR", note: null },
    { en: "placebo", th: "ยาหลอก", abbr: null, note: "ไม่ใช่ยาจริง" },
  ],
};

export const GLOSSARY_VERSIONS: Page<RuntimeVersion> = {
  items: [{ version: 4, kind: "glossary", created_at: "2026-10-13T09:00:00Z", created_by: "owner", note: null,
    source: "edit", restored_from: null, changes: { added: ["placebo"] } }],
  next: null,
};

export const RUN: HarnessRun = {
  id: 7, run_id: "console-20261013-100000-a1b2", prompt_version: "2026-10-12.1", status: "running", max_usd: 1,
  spent_usd: 0.13, repeats: 2, strata: ["cv"], max_reviews: null, compare_run: null, planned: 6, done: 2, failed: 0,
  skipped: 0, created_by: "owner", created_at: "2026-10-13T10:00:00Z", started_at: "2026-10-13T10:00:05Z",
  finished_at: null, error: null, report: null, config: { llm_config: "db:3", settings_version: "2", glossary: "4" },
};

export const RUN_DONE: HarnessRun = {
  ...RUN, id: 6, run_id: "console-20261012-090000-c3d4", status: "done", done: 6, spent_usd: 0.4,
  finished_at: "2026-10-12T09:20:00Z", report: "2026-10-12.1-console-20261012-090000-c3d4.md",
};

export const HARNESS: HarnessState = {
  available: true, reasons: [], prompt_version: "2026-10-12.1", pool_version: "v1",
  strata: [{ name: "cv", selected: 3, with_fixtures: 3 }, { name: "renal", selected: 1, with_fixtures: 0 }],
  fixtures: { selected: 4, present: 3 }, worker: { worker: "harness-1:9", seen_at: "2026-10-13T10:00:00Z" },
  ceiling_usd: 5, default_usd: 1, per_review_cap_usd: 0.28, typical_review_usd: 0.065, active: null,
};

export const REPORTS: HarnessReportItem[] = [
  { name: "2026-10-11.1-baseline.md", prompt_version: "2026-10-11.1", run_id: "baseline", size: 3635,
    modified_at: "2026-10-12T11:05:00Z" },
];

export const REPORT_TEXT = [
  "# Cochrane harness report: 2026-10-11.1 (run baseline)", "",
  "- git `abc` · preset `budget`", "",
  "## Summary", "",
  "| Metric | This run |", "|---|---|", "| Runs (failed) | 60 (0) |", "| Batch cost | $3.90 |", "",
  "<script>alert(1)</script>", "",
].join("\n");

export const RESULTS: HarnessResultItem[] = [
  { label: "2026-10-11.1/baseline", prompt_version: "2026-10-11.1", run_id: "baseline", files: 60,
    modified_at: "2026-10-12T11:02:00Z" },
  { label: "2026-10-12.1/console-20261012-090000-c3d4", prompt_version: "2026-10-12.1",
    run_id: "console-20261012-090000-c3d4", files: 6, modified_at: "2026-10-12T09:20:00Z" },
];

export const COMPARE: HarnessCompare = {
  a: { label: "2026-10-11.1/baseline", runs: 60 }, b: { label: "2026-10-12.1/console-20261012-090000-c3d4", runs: 6 },
  rows: [{ metric: "Runs (failed)", a: "60 (0)", b: "6 (0)" }, { metric: "Batch cost", a: "$3.90", b: "$0.40" }],
  verdict_changes: ["CD1: consensus:positive → none"],
};
```

`frontend/src/components/admin/version-history.test.tsx`:

```tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WORKERS_NOT_NOTIFIED } from "@/lib/admin-copy";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { SETTINGS_VERSIONS } from "@/test/admin-runtime-fixtures";
import { VersionHistory } from "./version-history";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/settings" }));
afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

const props = { kind: "settings" as const, resetLabel: "กลับไปใช้ค่า env", resetHint: "ทุกค่ากลับไปใช้ env",
  emptyText: "ยังไม่มีเวอร์ชันที่บันทึก" };

describe("VersionHistory", () => {
  it("lists versions with their changes and marks the active one", async () => {
    mockAdminFetch((m, p) => (p.startsWith("/settings/versions") ? [200, SETTINGS_VERSIONS] : undefined));
    await renderAdmin(<VersionHistory {...props} base={2} onChanged={() => {}} />);
    const v2 = await screen.findByRole("listitem", { name: "เวอร์ชัน 2" });
    expect(v2).toHaveTextContent("ใช้งานอยู่");
    expect(v2).toHaveTextContent("max_queued_reviews: 50 → 80");
    expect(v2).toHaveTextContent("busier");
    expect(within(v2).queryByRole("button", { name: /ย้อนกลับ/ })).toBeNull();
  });

  it("restores after the in-page confirm, sends the base version, says so and re-reads the page", async () => {
    const posted: unknown[] = [];
    const onChanged = vi.fn();
    mockAdminFetch((m, p, body) => {
      if (m === "GET" && p.startsWith("/settings/versions")) return [200, SETTINGS_VERSIONS];
      if (m === "POST" && p === "/settings/versions/1/restore") {
        posted.push(body);
        return [201, { ...SETTINGS_VERSIONS.items[0], version: 3, source: "restore", restored_from: 1, workers_notified: false }];
      }
    });
    await renderAdmin(<VersionHistory {...props} base={2} onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "ย้อนกลับไปเวอร์ชัน 1" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันย้อนกลับ" }));
    expect(await screen.findByText("สร้างเวอร์ชัน 3 จากเวอร์ชัน 1 แล้ว")).toBeInTheDocument();
    expect(screen.getByText(WORKERS_NOT_NOTIFIED)).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(posted).toEqual([{ base_version: 2 }]);
  });

  it("re-reads the page after a 409 so the next try carries the fresh base", async () => {
    const onChanged = vi.fn();
    mockAdminFetch((m, p) => {
      if (m === "GET" && p.startsWith("/settings/versions")) return [200, SETTINGS_VERSIONS];
      if (m === "POST" && p === "/settings/reset") return [409, { detail: "version 4 is in use now; reload the latest version and try again" }];
    });
    await renderAdmin(<VersionHistory {...props} base={2} onChanged={onChanged} />);
    fireEvent.click(await screen.findByRole("button", { name: "กลับไปใช้ค่า env" }));
    expect(screen.getByText("ทุกค่ากลับไปใช้ env")).toBeInTheDocument(); // the hint, while asking
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน: กลับไปใช้ค่า env" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("version 4 is in use now");
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("offers no reset while the default is in use", async () => {
    mockAdminFetch((m, p) => (p.startsWith("/settings/versions") ? [200, { items: [], next: null }] : undefined));
    await renderAdmin(<VersionHistory {...props} base={null} onChanged={() => {}} />);
    expect(await screen.findByText("ยังไม่มีเวอร์ชันที่บันทึก")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "กลับไปใช้ค่า env" })).toBeNull();
  });
});
```

`frontend/src/components/admin/settings-view.test.tsx`:

```tsx
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKERS_NOT_NOTIFIED } from "@/lib/admin-copy";
import type { AdminReply } from "@/test/admin-fetch";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { SETTINGS, SETTINGS_VERSIONS, SPECS, WORKER } from "@/test/admin-runtime-fixtures";
import { SettingsView, draftValues } from "./settings-view";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/settings" }));

// The fixture worker was last seen at 10:00:00Z; pin Date 30 s later (only Date: findBy and waitFor keep real timers).
const SEEN = Date.parse(WORKER.loaded_at);
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SEEN + 30_000); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); nav.replace.mockReset(); });

const QUEUE = "รีวิวที่รอคิวได้สูงสุด";
const SAVE = { name: "บันทึกเป็นเวอร์ชันใหม่" };
const routes = (state = SETTINGS) => (m: string, p: string): AdminReply | undefined =>
  m === "GET" && p === "/settings" ? [200, state] : m === "GET" && p.startsWith("/settings/versions") ? [200, SETTINGS_VERSIONS] : undefined;
const savedAs = (version: number, notified = true): AdminReply =>
  [201, { ...SETTINGS_VERSIONS.items[0], version, workers_notified: notified }];

describe("draftValues", () => {
  it("sends numbers as numbers, rates as typed, and leaves out the env rows", () => {
    expect(draftValues(SPECS, { review_rate_limit: " 9/hour ", max_queued_reviews: "90", max_usd_per_day: null, llm_concurrency: "x" }))
      .toEqual({ review_rate_limit: "9/hour", max_queued_reviews: 90, llm_concurrency: "x" });
  });
});

describe("SettingsView", () => {
  it("shows the source, the workers and each setting with its env value and the value in force", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<SettingsView />);
    expect(await screen.findByText("ใช้เวอร์ชัน 2 จาก DB")).toBeInTheDocument();
    const row = screen.getByRole("row", { name: new RegExp(QUEUE) });
    expect(row).toHaveTextContent("50");
    expect(row).toHaveTextContent("80");
    expect(within(row).getByLabelText(`ค่าใหม่: ${QUEUE}`)).toHaveValue("80");
    const worker = screen.getByText(/worker-1:7/);
    expect(worker).toHaveTextContent("ตรงกับที่ใช้งาน");
    expect(worker).not.toHaveClass("bg-warn-bg");
  });

  it("marks a worker on another version, one that failed to reload, and one that went quiet", async () => {
    mockAdminFetch(routes({ ...SETTINGS, loaded: [
      { ...WORKER, worker: "behind:1", settings: "1" },
      { ...WORKER, worker: "broken:2", runtime_error: "graph build failed" },
      { ...WORKER, worker: "quiet:3", loaded_at: new Date(SEEN - 5 * 60_000).toISOString() },
    ] }));
    await renderAdmin(<SettingsView />);
    expect(await screen.findByText(/behind:1/)).toHaveTextContent("ยังใช้ 1");
    expect(screen.getByText(/broken:2/)).toHaveTextContent("โหลดไม่สำเร็จ: graph build failed");
    expect(screen.getByText(/quiet:3/)).toHaveTextContent("ไม่ได้รายงานเกิน 2 นาที");
    for (const name of [/behind:1/, /broken:2/, /quiet:3/]) expect(screen.getByText(name)).toHaveClass("bg-warn-bg");
  });

  it("validates, shows a field error beside its input, then saves on the version the draft came from", async () => {
    const posted: unknown[] = [];
    mockAdminFetch((m, p, body) => {
      if (m === "POST" && p === "/settings/validate") {
        const values = (body as { values: Record<string, unknown> }).values;
        return values.max_queued_reviews === 0
          ? [200, { ok: false, errors: [{ field: "max_queued_reviews", message: "max_queued_reviews: must be between 1 and 1000" }],
              warnings: [], values: null, worst_case_review_usd: null }]
          : [200, { ok: true, errors: [], warnings: ["llm_concurrency applies to reviews that start after the workers reload"],
              values: SETTINGS.values, worst_case_review_usd: 0.4 }];
      }
      if (m === "POST" && p === "/settings") { posted.push(body); return savedAs(3); }
      return routes()(m, p);
    });
    await renderAdmin(<SettingsView />);
    const input = await screen.findByLabelText(`ค่าใหม่: ${QUEUE}`);
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจ" }));
    expect(await screen.findByText("max_queued_reviews: must be between 1 and 1000")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(input, { target: { value: "90" } });
    expect(screen.queryByText("max_queued_reviews: must be between 1 and 1000")).toBeNull(); // the check was of another draft
    fireEvent.click(screen.getByRole("checkbox", { name: "ตั้งค่าเอง: LLM call พร้อมกันต่อ worker" }));
    fireEvent.change(screen.getByLabelText("ค่าใหม่: LLM call พร้อมกันต่อ worker"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจ" }));
    expect(await screen.findByText(/llm_concurrency applies/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("หมายเหตุ (ไม่บังคับ)"), { target: { value: "more workers" } });
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText("บันทึกเป็นเวอร์ชัน 3 แล้ว")).toBeInTheDocument();
    expect(posted).toEqual([{ values: { max_queued_reviews: 90, llm_concurrency: 8 }, base_version: 2, note: "more workers" }]);
  });

  it("turning off ตั้งค่าเอง drops the override", async () => {
    const posted: unknown[] = [];
    mockAdminFetch((m, p, body) => {
      if (m === "POST" && p === "/settings") { posted.push(body); return savedAs(3); }
      return routes()(m, p);
    });
    await renderAdmin(<SettingsView />);
    fireEvent.click(await screen.findByRole("checkbox", { name: `ตั้งค่าเอง: ${QUEUE}` }));
    expect(screen.queryByLabelText(`ค่าใหม่: ${QUEUE}`)).toBeNull();
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText("บันทึกเป็นเวอร์ชัน 3 แล้ว")).toBeInTheDocument();
    expect(posted).toEqual([{ values: {}, base_version: 2 }]);
  });

  it("says when the workers were not told", async () => {
    mockAdminFetch((m, p) => (m === "POST" && p === "/settings" ? savedAs(3, false) : routes()(m, p)));
    await renderAdmin(<SettingsView />);
    fireEvent.change(await screen.findByLabelText(`ค่าใหม่: ${QUEUE}`), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText(WORKERS_NOT_NOTIFIED)).toBeInTheDocument();
  });

  it("re-reads after a 409, keeps the draft on its old base, and saves on the latest version once asked to", async () => {
    let version = 2;
    const posted: { base_version: number | null }[] = [];
    mockAdminFetch((m, p, body) => {
      if (m === "GET" && p === "/settings") return [200, { ...SETTINGS, version }];
      if (m === "POST" && p === "/settings") {
        posted.push(body as { base_version: number | null });
        if (posted.length === 1) { version = 5; return [409, { detail: "version 5 is in use now; reload the latest version and try again" }]; }
        return savedAs(6);
      }
      return routes()(m, p);
    });
    await renderAdmin(<SettingsView />);
    const input = await screen.findByLabelText(`ค่าใหม่: ${QUEUE}`);
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByRole("alert")).toHaveTextContent("มีผู้ดูแลอีกคนบันทึกเวอร์ชันใหม่ก่อน");
    expect(await screen.findByText("ใช้เวอร์ชัน 5 จาก DB")).toBeInTheDocument();
    expect(screen.getByLabelText(`ค่าใหม่: ${QUEUE}`)).toHaveValue("99");
    expect(screen.getByText("ร่างนี้แก้จากเวอร์ชัน 2 แต่ตอนนี้ใช้เวอร์ชัน 5 อยู่")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ใช้ร่างนี้ต่อจากเวอร์ชันล่าสุด" }));
    const note = await screen.findByText("ร่างนี้ใช้เวอร์ชัน 5 เป็นฐานแล้ว: บันทึกต่อจากเวอร์ชันนั้นได้");
    await waitFor(() => expect(note).toHaveFocus());
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText("บันทึกเป็นเวอร์ชัน 6 แล้ว")).toBeInTheDocument();
    expect(posted.map((b) => b.base_version)).toEqual([2, 5]);
  });

  it("discards the edits only after the in-page confirm", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<SettingsView />);
    const input = await screen.findByLabelText(`ค่าใหม่: ${QUEUE}`);
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิกการแก้ไข" }));
    expect(input).toHaveValue("99");
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันยกเลิกการแก้ไข" }));
    expect(await screen.findByLabelText(`ค่าใหม่: ${QUEUE}`)).toHaveValue("80");
  });
});

/** After a save the page re-reads every 10 s while a worker lags (the models page's rule, Plan 23b). */
describe("SettingsView follows the workers after a save", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"], now: SEEN + 30_000 });
    vi.stubGlobal("jest", { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
  });
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it("polls every 10 s until the workers report the new version, then stops", async () => {
    const s = { version: 2, worker: "2", gets: 0 };
    mockAdminFetch((m, p) => {
      if (m === "GET" && p === "/settings") {
        s.gets += 1;
        return [200, { ...SETTINGS, version: s.version, loaded: [{ ...WORKER, settings: s.worker, loaded_at: new Date(Date.now()).toISOString() }] }];
      }
      if (m === "POST" && p === "/settings") { s.version = 3; return savedAs(3); }
      return routes()(m, p);
    });
    await renderAdmin(<SettingsView />);
    fireEvent.change(await screen.findByLabelText(`ค่าใหม่: ${QUEUE}`), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", SAVE));
    await screen.findByText("บันทึกเป็นเวอร์ชัน 3 แล้ว");
    await advance(0);
    const worker = () => screen.getByText(/worker-1:7/);
    expect(worker()).toHaveTextContent("กำลังเปลี่ยนเป็น 3 (ภายใน 30 วินาที)");
    const afterSave = s.gets;
    await advance(10_000);
    expect(s.gets).toBe(afterSave + 1);
    s.worker = "3";
    await advance(10_000);
    expect(worker()).toHaveTextContent("ตรงกับที่ใช้งาน");
    await advance(5 * 60_000);
    expect(s.gets).toBe(afterSave + 2);
  });
});
```

Run: `cd /d/MRA-plan-23c/frontend && npm ci && npx vitest run src/components/admin/version-history.test.tsx src/components/admin/settings-view.test.tsx src/lib/admin-api.test.ts`
Expected: FAIL (the modules do not exist yet).

- [ ] **Step 3: Move the shared parts out of ModelsView**

`frontend/src/lib/admin-workers.ts`:

```ts
/** Worker reports and the page's follow-up after a write, shared by the models page (Plan 23b) and the settings and
 * glossary pages (Plan 23c). */

/** Workers re-report every 30 s, so `loaded_at` is "last seen": a worker silent for longer than this has probably stopped. */
export const STALE_AFTER_MS = 120_000;

export function isStale(loadedAt: string, now: number): boolean {
  const seen = Date.parse(loadedAt);
  return Number.isFinite(seen) && now - seen > STALE_AFTER_MS; // a time that does not parse is not stale
}

/** After a save, restore or reset the workers pick the version up within 30 s (their poll), so a page re-reads this
 * often while one lags, for at most POLL_WINDOW_MS. For SETTLING_MS after the page's own change, a lagging worker is
 * "changing" and not yet a warning. */
export const POLL_MS = 10_000;
export const POLL_WINDOW_MS = 120_000;
export const SETTLING_MS = 60_000;
```

`frontend/src/components/admin/use-worker-follow-up.ts`:

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import { POLL_MS, POLL_WINDOW_MS, SETTLING_MS } from "@/lib/admin-workers";

/** What a page that shows worker reports does after a write (moved out of ModelsView, Plan 23b): while `lagging` (a
 * reporting worker is not on the page's version yet) it calls `poll` every POLL_MS, for at most POLL_WINDOW_MS, and
 * every `wrote()` starts a fresh window; `settling` is true for SETTLING_MS after the page's own write, when a lagging
 * worker is "changing" and not yet a warning. `poll` must be stable (useCallback). */
export function useWorkerFollowUp(lagging: boolean, poll: () => void): { settling: boolean; wrote: () => void } {
  const [settling, setSettling] = useState(false);
  const [writeCount, setWriteCount] = useState(0);

  useEffect(() => {
    if (!lagging) return;
    const since = Date.now();
    const id = setInterval(() => {
      if (Date.now() - since >= POLL_WINDOW_MS) clearInterval(id);
      else poll();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [lagging, writeCount, poll]);

  useEffect(() => {
    if (!settling) return;
    const id = setTimeout(() => setSettling(false), SETTLING_MS);
    return () => clearTimeout(id);
  }, [settling, writeCount]);

  const wrote = useCallback(() => {
    setSettling(true);
    setWriteCount((n) => n + 1);
  }, []);
  return { settling, wrote };
}
```

In `frontend/src/components/admin/models-view.tsx` (no behaviour change; `models-view.test.tsx` passes untouched):
- delete the local `STALE_AFTER_MS`, `isStale`, `POLL_MS`, `POLL_WINDOW_MS` and `SETTLING_MS` with their comments, and
  add `import { isStale } from "@/lib/admin-workers";` and `import { useWorkerFollowUp } from "./use-worker-follow-up";`;
- delete the `settling`/`writeCount` state and the two effects that use them; after `poll`, write
  `const lagging = state !== null && hasLaggingWorker(state, readAt);` and
  `const { settling, wrote } = useWorkerFollowUp(lagging, poll);`;
- `track` becomes `useMemo<WriteTracker>(() => ({ start: ..., wrote, end: ... }), [wrote])`, with `start` and `end` as
  before.

`frontend/src/components/admin/versioned-page.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LoadedWorker } from "@/lib/admin-types";
import { isStale } from "@/lib/admin-workers";
import { useAdmin } from "./admin-gate";
import { ConfirmButton } from "./confirm-button";
import type { WriteTracker } from "./models-save-bar";
import { BUTTON_GHOST } from "./ui";
import { useWorkerFollowUp } from "./use-worker-follow-up";

/** The rules of the models page (ModelsView, Plan 23b) for the other versioned documents of the console, the runtime
 * settings and the glossary (Plan 23c). A draft keeps the version it was loaded from (`base`), and its save is built
 * on that version, so a save on top of a newer one is the server's 409, never a silent overwrite. A read replaces a
 * draft without edits and keeps one with edits; the page then says the server moved on and offers to discard the edits
 * or to build on the latest version. While a worker lags behind the page's version, the page re-reads every 10 s. */
export interface VersionedState { version: number | null; loaded: LoadedWorker[] }

/** `doc` is what the admin edits; `origin` the document it was loaded from ("dirty" means it differs from that); `base`
 * the version its save is built on. */
export interface VersionedDraft<D> { doc: D; origin: D; base: number | null }

/** A page's document kind. Pass a module-level constant: the page's effects depend on it. */
export interface VersionedSpec<S extends VersionedState, D> {
  read: () => Promise<S>;
  /** The draft a read starts from. */
  docOf: (state: S) => D;
  /** Same content (keys that exist only for the page, such as row ids, do not count). */
  same: (a: D, b: D) => boolean;
  /** What a worker reports for this kind, and what it should report for the page's version. */
  workerVersion: (w: LoadedWorker) => string;
  wanted: (state: S) => string;
  /** How the page names a version; null is the default (env values, the built-in glossary). */
  versionName: (version: number | null) => string;
}

/** ModelsView's reconcile without the llm.yaml specifics. `saved` and `savedId` are set only on the re-read that
 * follows the admin's own save: the document saved and the version it became.
 * - The draft is still that document: the server's copy replaces it.
 * - It was edited since, and the server is on the version just saved: the edits stay, on top of it, still unsaved.
 * - It was edited since and the server is on another version (someone saved after us): the ordinary rule applies.
 * Otherwise a draft without edits follows the server (keeping its own object when the content is the same, so row ids
 * and focus survive a background read) and a draft with edits stays as it is. */
export function reconcileDraft<D>(same: (a: D, b: D) => boolean, draft: VersionedDraft<D> | null, doc: D,
  version: number | null, saved?: D, savedId?: number): VersionedDraft<D> {
  const fresh = { doc, origin: doc, base: version };
  if (draft === null) return fresh;
  if (saved !== undefined) {
    if (same(draft.doc, saved)) return fresh;
    if (version === savedId) return { doc: draft.doc, origin: doc, base: version };
  }
  if (!same(draft.doc, draft.origin)) return draft;
  return same(draft.doc, doc) ? { doc: draft.doc, origin: draft.doc, base: version } : fresh;
}

export function useVersionedPage<S extends VersionedState, D>(spec: VersionedSpec<S, D>) {
  const { fail } = useAdmin();
  const [state, setState] = useState<S | null>(null);
  const [readAt, setReadAt] = useState(0);
  const [draft, setDraft] = useState<VersionedDraft<D> | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** What the last "discard" or "build on the latest" did, for the base it applies to. Any edit clears it. */
  const [draftNote, setDraftNote] = useState<{ text: string; base: number | null } | null>(null);
  const mounted = useRef(true);
  /** Request numbers only: an answer older than one already applied is dropped. */
  const requests = useRef({ started: 0, applied: 0 });
  /** Writes in flight (`active`) and how many have begun (`began`): no background read starts during a write, and one
   * that began before it is dropped, so a plain read cannot land ahead of the write's own re-read. */
  const writes = useRef({ active: 0, began: 0 });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  /** Reads the state. Resolves when the answer is applied or the read has failed; it never rejects. */
  const load = useCallback((saved?: D, savedId?: number, accept?: () => boolean): Promise<void> => {
    const seq = ++requests.current.started;
    return spec.read()
      .then((s) => {
        if (!mounted.current || seq < requests.current.applied || (accept && !accept())) return;
        requests.current.applied = seq;
        setState(s);
        setReadAt(Date.now());
        setError(null);
        setDraft((d) => reconcileDraft(spec.same, d, spec.docOf(s), s.version, saved, savedId));
      })
      .catch((e: unknown) => {
        if (mounted.current && seq >= requests.current.applied && (!accept || accept())) setError(fail(e));
      });
  }, [spec, fail]);

  useEffect(() => { void load(); }, [load]);

  const poll = useCallback(() => {
    if (writes.current.active > 0) return; // a write is in flight: its own re-read comes first
    const began = writes.current.began;
    void load(undefined, undefined, () => writes.current.active === 0 && writes.current.began === began);
  }, [load]);

  const lagging = state !== null && state.loaded.some((w) =>
    spec.workerVersion(w) !== spec.wanted(state) && !isStale(w.loaded_at, readAt));
  const { settling, wrote } = useWorkerFollowUp(lagging, poll);

  const track = useMemo<WriteTracker>(() => ({
    start: () => { writes.current.active += 1; writes.current.began += 1; },
    wrote,
    end: () => { writes.current.active -= 1; },
  }), [wrote]);

  const reload = useCallback(() => { void load(); }, [load]);
  const edit = useCallback((change: (doc: D) => D) => {
    setDraftNote(null);
    setDraft((d) => (d ? { ...d, doc: change(d.doc) } : d));
  }, []);

  function discard() {
    if (!state) return;
    const doc = spec.docOf(state);
    setDraft({ doc, origin: doc, base: state.version });
    setDraftNote({ text: `ทิ้งการแก้ไขแล้ว: ร่างตรงกับเวอร์ชัน ${spec.versionName(state.version)}`, base: state.version });
  }
  function rebase() {
    if (!state) return;
    setDraft((d) => (d ? { ...d, base: state.version } : d));
    setDraftNote({ text: `ร่างนี้ใช้เวอร์ชัน ${spec.versionName(state.version)} เป็นฐานแล้ว: บันทึกต่อจากเวอร์ชันนั้นได้`,
      base: state.version });
  }

  const dirty = draft !== null && !spec.same(draft.doc, draft.origin);
  const moved = state !== null && draft !== null && dirty && draft.base !== state.version;
  return { state, readAt, draft, error, settling, track, load, reload, edit, discard, rebase, dirty, moved,
    draftNote: draftNote && draft && draftNote.base === draft.base ? draftNote.text : null };
}

/** The "server moved on" note and the answer to its buttons (ModelsView's, Plan 23b). `note` appears only after
 * "discard" or "build on the latest", whose buttons are then gone, so focus moves to it. */
export function DraftStatus({ moved, base, current, note, onDiscard, onRebase, versionName }: {
  moved: boolean; base: number | null; current: number | null; note: string | null;
  onDiscard: () => void; onRebase: () => void; versionName: (version: number | null) => string;
}) {
  const noteRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (note) noteRef.current?.focus(); }, [note]);
  return (
    <>
      {moved && (
        <div className="mt-6 grid gap-2 rounded-sm bg-warn-bg px-4 py-3">
          <p>{`ร่างนี้แก้จากเวอร์ชัน ${versionName(base)} แต่ตอนนี้ใช้เวอร์ชัน ${versionName(current)} อยู่`}</p>
          <div className="flex flex-wrap gap-2">
            <ConfirmButton label="ทิ้งการแก้ไข" confirmLabel="ยืนยันทิ้งการแก้ไข" onConfirm={onDiscard}
              hint="การแก้ไขที่ยังไม่ได้บันทึกจะหายไป และร่างจะตรงกับเวอร์ชันที่ใช้อยู่" />
            <button type="button" className={BUTTON_GHOST} onClick={onRebase}>ใช้ร่างนี้ต่อจากเวอร์ชันล่าสุด</button>
          </div>
          <p className="text-sm">ถ้าใช้ร่างนี้ต่อ การบันทึกครั้งต่อไปจะทับการเปลี่ยนแปลงที่เกิดขึ้นในเวอร์ชันล่าสุด</p>
        </div>
      )}
      {note && <p ref={noteRef} tabIndex={-1} role="status" className="mt-6 rounded-sm bg-info-bg px-4 py-2">{note}</p>}
    </>
  );
}
```

The hook returns plain values and functions only: `DraftStatus` owns the ref of the note it focuses, because the React
compiler's lint (`react-hooks/refs`) refuses a ref read through a hook's returned object during render.

- [ ] **Step 4: Implement the components**

`frontend/src/components/admin/worker-versions.tsx`:

```tsx
import { formatWhen } from "@/lib/admin-copy";
import type { LoadedWorker } from "@/lib/admin-types";
import { isStale } from "@/lib/admin-workers";

/** Which settings or glossary version each worker runs (Plan 23c), by the rules of the models header (Plan 23b): a
 * worker on another version is "changing" while the page's own write settles and a warning after that, a failed
 * reload and a worker silent for over 2 minutes are warnings, and each says so in words as well as colour. `now` is
 * when the page read the reports. */
export function WorkerVersions({ loaded, field, expected, now, settling = false }: {
  loaded: LoadedWorker[]; field: "settings" | "glossary"; expected: string; now: number; settling?: boolean;
}) {
  if (loaded.length === 0) {
    return <p className="mt-2 text-sm text-muted">ยังไม่มี worker รายงาน (worker จะรายงานภายใน 30 วินาทีหลังเริ่มทำงาน)</p>;
  }
  return (
    <ul className="mt-2 grid gap-1 text-sm" aria-label="worker">
      {loaded.map((w) => {
        const version = w[field] ?? (field === "settings" ? "env" : "file");
        const other = version !== expected;
        const changing = other && settling;
        const stale = isStale(w.loaded_at, now);
        const off = (other && !changing) || Boolean(w.runtime_error) || stale;
        return (
          <li key={w.worker} className={off ? "rounded-sm bg-warn-bg px-2 py-1" : "text-muted"}>
            {`${w.worker} · ${other ? `ยังใช้ ${version}` : "ตรงกับที่ใช้งาน"} · รายงานล่าสุด ${formatWhen(w.loaded_at)}`}
            {changing ? ` · กำลังเปลี่ยนเป็น ${expected} (ภายใน 30 วินาที)` : ""}
            {w.runtime_error ? ` · โหลดไม่สำเร็จ: ${w.runtime_error}` : ""}
            {stale ? " · ไม่ได้รายงานเกิน 2 นาที (worker อาจหยุดทำงาน)" : ""}
          </li>
        );
      })}
    </ul>
  );
}
```

`frontend/src/components/admin/version-history.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { AdminApiError, adminApi } from "@/lib/admin-api";
import { RUNTIME_SOURCE_LABEL, WORKERS_NOT_NOTIFIED, formatWhen } from "@/lib/admin-copy";
import type { RuntimeKind, RuntimeVersion, SavedVersion } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { ConfirmButton } from "./confirm-button";
import type { WriteTracker } from "./models-save-bar";
import { BUTTON_GHOST } from "./ui";

function changeLines(changes: Record<string, unknown>): string[] {
  return Object.entries(changes).map(([k, v]) =>
    `${k}: ${Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : JSON.stringify(v)}`);
}

interface Notice { text: string; workersNotified: boolean }

/** The saved versions of the settings or the glossary, newest first (Plan 23c), with the rules of the models history
 * (Plan 23b): restore and reset append a version and say so here (with the warning when the workers were not told),
 * then `onChanged` re-reads the page; a 409 re-reads too, so the next try carries the fresh base. Reset is offered
 * only once a version exists (before that the default is already in use). */
export function VersionHistory({ kind, base, resetLabel, resetHint, emptyText, onChanged, writes }: {
  kind: RuntimeKind; base: number | null; resetLabel: string; resetHint: string; emptyText: string;
  onChanged: () => void; writes?: WriteTracker;
}) {
  const { fail } = useAdmin();
  const [items, setItems] = useState<RuntimeVersion[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  // Two messages, so that reloading the list for a new base (which follows a conflict) does not wipe the conflict.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const focusNotice = useRef(false);
  /** Bumped whenever the list is reloaded or the tab goes away: an answer from an older generation is dropped. */
  const generation = useRef(0);

  useEffect(() => {
    let alive = true;
    adminApi.runtimeVersions(kind)
      .then((page) => {
        if (!alive) return;
        setItems(page.items);
        setNext((page.next as number | null) ?? null);
        setLoadError(null);
      })
      .catch((e: unknown) => { if (alive) setLoadError(fail(e)); });
    return () => { alive = false; generation.current += 1; };
  }, [kind, base, fail]);

  useEffect(() => {
    if (notice && focusNotice.current) {
      focusNotice.current = false;
      noticeRef.current?.focus();
    }
  }, [notice]);

  async function act(run: () => Promise<SavedVersion>, done: (v: SavedVersion) => string) {
    setActionError(null);
    setNotice(null);
    writes?.start();
    try {
      const v = await run();
      writes?.wrote();
      focusNotice.current = true;
      // `=== false`: only an answer that says the publish failed is a warning
      setNotice({ text: done(v), workersNotified: v.workers_notified !== false });
      onChanged();
    } catch (e) {
      setActionError(fail(e));
      if (e instanceof AdminApiError && e.status === 409) onChanged(); // someone else saved first: re-read the base
    } finally {
      writes?.end();
    }
  }

  async function more() {
    const mine = generation.current;
    try {
      const page = await adminApi.runtimeVersions(kind, next);
      if (mine !== generation.current) return;
      setItems((prev) => [...(prev ?? []), ...page.items]);
      setNext((page.next as number | null) ?? null);
      setLoadError(null);
    } catch (e) {
      if (mine === generation.current) setLoadError(fail(e));
    }
  }

  return (
    <section aria-labelledby={`${kind}-history-title`} className="mt-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${kind}-history-title`} className="font-display text-xl font-semibold">ประวัติ</h2>
        {base !== null && (
          <ConfirmButton label={resetLabel} confirmLabel={`ยืนยัน: ${resetLabel}`} hint={resetHint}
            onConfirm={() => act(() => adminApi.resetRuntime(kind, base), (v) => `สร้างเวอร์ชัน ${v.version} ด้วยค่าตั้งต้นแล้ว`)} />
        )}
      </div>
      {notice && (
        <div ref={noticeRef} tabIndex={-1} role="status" className="mt-3 grid gap-2">
          <p className="rounded-sm bg-info-bg px-4 py-2">{notice.text}</p>
          {!notice.workersNotified && <p className="rounded-sm bg-warn-bg px-4 py-2">{WORKERS_NOT_NOTIFIED}</p>}
        </div>
      )}
      {actionError && <p role="alert" className="mt-3 rounded-sm bg-err-bg px-4 py-2">{actionError}</p>}
      {loadError && <p role="alert" className="mt-3 rounded-sm bg-err-bg px-4 py-2">{loadError}</p>}
      {items === null && !loadError && <p role="status" className="mt-3 text-muted">กำลังโหลด…</p>}
      {items && items.length === 0 && <p className="mt-3 text-muted">{emptyText}</p>}
      {items && items.length > 0 && (
        <ol className="mt-3 border-t border-rule">
          {items.map((v) => {
            const lines = changeLines(v.changes);
            return (
              <li key={v.version} aria-label={`เวอร์ชัน ${v.version}`}
                className="grid gap-2 border-b border-rule py-3 md:grid-cols-[14rem_1fr_auto]">
                <div className="text-sm">
                  <p className="font-display font-semibold">{`เวอร์ชัน ${v.version}`}{v.version === base ? " · ใช้งานอยู่" : ""}</p>
                  <p className="text-muted">{formatWhen(v.created_at)} · {v.created_by}</p>
                  <p className="text-muted">{RUNTIME_SOURCE_LABEL[v.source]}{v.restored_from ? ` จากเวอร์ชัน ${v.restored_from}` : ""}</p>
                </div>
                <div className="min-w-0 text-sm">
                  {v.note && <p className="mb-1 break-words">{v.note}</p>}
                  {lines.length === 0
                    ? <p className="text-muted">ไม่มีการเปลี่ยนแปลง</p>
                    : <ul>{lines.map((line) => <li key={line} className="break-words">{line}</li>)}</ul>}
                </div>
                <div className="flex flex-wrap items-start gap-2">
                  {v.version !== base && (
                    <ConfirmButton label="ย้อนกลับไปเวอร์ชันนี้" name={`ย้อนกลับไปเวอร์ชัน ${v.version}`} confirmLabel="ยืนยันย้อนกลับ"
                      onConfirm={() => act(() => adminApi.restoreRuntime(kind, v.version, base),
                        (n) => `สร้างเวอร์ชัน ${n.version} จากเวอร์ชัน ${v.version} แล้ว`)} />
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {next !== null && <button type="button" onClick={more} className={`mt-3 ${BUTTON_GHOST}`}>โหลดเพิ่ม</button>}
    </section>
  );
}
```

`frontend/src/components/admin/settings-view.tsx`:

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { AdminApiError, adminApi } from "@/lib/admin-api";
import {
  APPLIES_LABEL, SETTING_GROUP_LABEL, SETTING_GROUP_ORDER, SETTING_LABEL, WORKERS_NOT_NOTIFIED, formatUsd,
} from "@/lib/admin-copy";
import type { SettingSpec, SettingValue, SettingsReport, SettingsState } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { ConfirmButton } from "./confirm-button";
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT, TABLE_REGION, TD, TH } from "./ui";
import { VersionHistory } from "./version-history";
import { DraftStatus, type VersionedSpec, useVersionedPage } from "./versioned-page";
import { WorkerVersions } from "./worker-versions";

/** A setting's draft: the text typed for an override, or null to use the env value. */
export type SettingsDraft = Record<string, string | null>;

/** The 409 answer to a save: the page has re-read and the draft is still there (the models page's wording). */
export const STALE_TEXT = "มีผู้ดูแลอีกคนบันทึกเวอร์ชันใหม่ก่อน: ค่าที่กรอกยังอยู่ ดูเวอร์ชันล่าสุดแล้วเลือกว่าจะทิ้งการแก้ไขหรือใช้ร่างนี้ต่อ";

function draftOf(state: SettingsState): SettingsDraft {
  return Object.fromEntries(state.specs.map((s) => [s.name, s.name in state.overrides ? String(state.overrides[s.name]) : null]));
}

const settingsName = (v: number | null) => (v === null ? "env" : String(v));

export const SETTINGS_PAGE: VersionedSpec<SettingsState, SettingsDraft> = {
  read: () => adminApi.settings(),
  docOf: draftOf,
  same: (a, b) => JSON.stringify(a) === JSON.stringify(b), // drafts are built in spec order, so key order matches
  workerVersion: (w) => w.settings ?? "env",
  wanted: (s) => settingsName(s.version),
  versionName: settingsName,
};

/** Rates go as typed; numbers as numbers when they parse, else as typed so the server names the problem. */
export function draftValues(specs: SettingSpec[], draft: SettingsDraft): Record<string, SettingValue> {
  const out: Record<string, SettingValue> = {};
  for (const spec of specs) {
    const text = draft[spec.name];
    if (text === null || text === undefined) continue;
    const t = text.trim();
    const n = Number(t);
    out[spec.name] = spec.kind === "rate" || t === "" || !Number.isFinite(n) ? t : n;
  }
  return out;
}

function SettingRow({ spec, env, inForce, value, error, onChange }: {
  spec: SettingSpec; env: SettingValue | undefined; inForce: SettingValue | undefined; value: string | null;
  error: string | undefined; onChange: (value: string | null) => void;
}) {
  const name = SETTING_LABEL[spec.name] ?? spec.name;
  const errorId = `setting-${spec.name}-error`;
  return (
    <tr>
      <th scope="row" className={`${TD} text-left font-normal`}>
        <span className="block font-display font-semibold">{name}</span>
        <code className="font-code text-xs text-muted">{spec.name}</code>
      </th>
      <td className={TD}>{String(env ?? "—")}</td>
      <td className={TD}>{String(inForce ?? "—")}</td>
      <td className={TD}>
        <label className="flex min-h-11 items-center gap-2">
          <input type="checkbox" aria-label={`ตั้งค่าเอง: ${name}`} checked={value !== null}
            onChange={(e) => onChange(e.target.checked ? String(inForce ?? env ?? "") : null)} />
          <span aria-hidden="true">ตั้งค่าเอง</span>
        </label>
        {value !== null && (
          <>
            <input aria-label={`ค่าใหม่: ${name}`} className={INPUT} value={value}
              inputMode={spec.kind === "rate" ? "text" : "decimal"} aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined} onChange={(e) => onChange(e.target.value)} />
            <p className="mt-1 text-xs text-muted">
              {spec.kind === "rate" ? "เช่น 5/hour (second, minute, hour, day)" : `${spec.min} ถึง ${spec.max}`}
            </p>
          </>
        )}
        {error && <p id={errorId} className="mt-1 text-sm text-err">{error}</p>}
      </td>
      <td className={TD}>{APPLIES_LABEL[spec.applies]}</td>
    </tr>
  );
}

interface Saved { version: number; workersNotified: boolean }

export function SettingsView() {
  const { fail } = useAdmin();
  const page = useVersionedPage(SETTINGS_PAGE);
  const { state, draft } = page;
  /** The last check and the draft it was run on: once the draft is edited it is not shown as the draft's. */
  const [checked, setChecked] = useState<{ doc: SettingsDraft; report: SettingsReport } | null>(null);
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<"edit" | "history">("edit");
  const [actionError, setActionError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [busy, setBusy] = useState(false);
  const savedRef = useRef<HTMLDivElement>(null);
  const focusSaved = useRef(false);

  useEffect(() => {
    if (saved && focusSaved.current) {
      focusSaved.current = false;
      savedRef.current?.focus();
    }
  }, [saved]);

  if (!state || !draft) {
    return (
      <section aria-labelledby="settings-title" className="py-6">
        <h1 id="settings-title" className="font-display text-2xl font-semibold">ตั้งค่าระบบ</h1>
        {page.error ? <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-2">{page.error}</p>
          : <p role="status" className="mt-4 text-muted">กำลังโหลด…</p>}
      </section>
    );
  }
  const current = state;
  const specs = current.specs;
  const report = checked && SETTINGS_PAGE.same(checked.doc, draft.doc) ? checked.report : null;
  const specNames = new Set(specs.map((s) => s.name));
  const fieldErrors = new Map((report?.errors ?? []).filter((e) => e.field && specNames.has(e.field))
    .map((e) => [e.field as string, e.message]));
  const otherErrors = (report?.errors ?? []).filter((e) => !e.field || !specNames.has(e.field));

  function change(name: string, value: string | null) {
    setSaved(null);
    page.edit((d) => ({ ...d, [name]: value }));
  }

  async function validate() {
    const doc = draft!.doc;
    setBusy(true);
    setActionError(null);
    try {
      setChecked({ doc, report: await adminApi.validateSettings(draftValues(specs, doc)) });
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
      const row = await adminApi.saveSettings({ values: draftValues(specs, sent), base_version: draft!.base,
        ...(note.trim() ? { note: note.trim() } : {}) });
      page.track.wrote();
      setNote("");
      focusSaved.current = true;
      setSaved({ version: row.version, workersNotified: row.workers_notified !== false });
      await page.load(sent, row.version); // the button stays busy until the page has re-read
    } catch (e) {
      if (e instanceof AdminApiError && e.status === 409) {
        setActionError(STALE_TEXT);
        page.reload(); // the header moves on; the draft keeps its base and the page offers both ways forward
      } else {
        setActionError(fail(e));
      }
    } finally {
      page.track.end();
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="settings-title" className="py-6">
      <h1 id="settings-title" className="font-display text-2xl font-semibold">ตั้งค่าระบบ</h1>
      <div className="mt-3 rounded-sm bg-info-bg px-4 py-3">
        <p className="font-display font-semibold">
          {current.source === "db" ? `ใช้เวอร์ชัน ${current.version} จาก DB` : "ใช้ค่าจาก env"}
        </p>
        <p className="text-sm">
          API ใช้ค่าที่บันทึกภายใน 5 วินาที worker ใช้เมื่อเริ่มรีวิวถัดไปหรือภายใน 30 วินาที ค่าที่ไม่ได้ตั้งเองใช้ค่าจาก env
        </p>
        <WorkerVersions loaded={current.loaded} field="settings" expected={SETTINGS_PAGE.wanted(current)}
          now={page.readAt} settling={page.settling} />
      </div>
      {page.error && <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-2">{page.error}</p>}
      <div role="group" aria-label="มุมมอง" className="mt-4 flex flex-wrap gap-2">
        <button type="button" aria-pressed={tab === "edit"} className={BUTTON_GHOST} onClick={() => setTab("edit")}>แก้ไข</button>
        <button type="button" aria-pressed={tab === "history"} className={BUTTON_GHOST} onClick={() => setTab("history")}>ประวัติ</button>
      </div>
      {tab === "history" ? (
        <VersionHistory kind="settings" base={current.version} resetLabel="กลับไปใช้ค่า env" emptyText="ยังไม่มีเวอร์ชันที่บันทึก ใช้ค่าจาก env อยู่"
          resetHint="เวอร์ชันใหม่จะไม่มีค่าที่ตั้งเอง ทุกค่ากลับไปใช้ env ทันที" onChanged={page.reload} writes={page.track} />
      ) : (
        <>
          {SETTING_GROUP_ORDER.map((group) => {
            const rows = specs.filter((s) => s.group === group);
            if (rows.length === 0) return null;
            return (
              <section key={group} aria-labelledby={`group-${group}`} className="mt-6">
                <h2 id={`group-${group}`} className="font-display text-xl font-semibold">{SETTING_GROUP_LABEL[group]}</h2>
                <div className={TABLE_REGION}>
                  <table className="w-full min-w-[46rem] border-collapse text-sm">
                    <caption className="sr-only">{SETTING_GROUP_LABEL[group]}</caption>
                    <thead>
                      <tr>
                        <th scope="col" className={TH}>ค่า</th>
                        <th scope="col" className={TH}>env</th>
                        <th scope="col" className={TH}>ใช้อยู่</th>
                        <th scope="col" className={TH}>ค่าใหม่</th>
                        <th scope="col" className={TH}>มีผลที่</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((spec) => (
                        <SettingRow key={spec.name} spec={spec} env={current.env[spec.name]} inForce={current.values[spec.name]}
                          value={draft.doc[spec.name] ?? null} error={fieldErrors.get(spec.name)}
                          onChange={(v) => change(spec.name, v)} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
          <DraftStatus moved={page.moved} base={draft.base} current={current.version} note={page.draftNote}
            onDiscard={page.discard} onRebase={page.rebase} versionName={settingsName} />
          {report && (
            <div className={`mt-6 rounded-sm px-4 py-3 ${report.ok ? "bg-info-bg" : "bg-err-bg"}`}>
              <p className="font-display font-semibold">{report.ok ? "ผ่านการตรวจ" : "ยังบันทึกไม่ได้"}</p>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {otherErrors.map((e) => <li key={e.message}>{e.message}</li>)}
                {report.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
              {report.ok && report.values && report.worst_case_review_usd !== null && (
                <p className="mt-1 text-sm">
                  {`งบต่อรีวิวกรณีมากที่สุด ${formatUsd(report.worst_case_review_usd)} · งบต่อวัน ${formatUsd(Number(report.values.max_usd_per_day ?? 0))}`}
                </p>
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

`frontend/src/app/admin/(console)/settings/page.tsx`:

```tsx
import type { Metadata } from "next";
import { SettingsView } from "@/components/admin/settings-view";

export const metadata: Metadata = { title: "ตั้งค่า · ผู้ดูแลระบบ" };

export default function AdminSettingsPage() {
  return <SettingsView />;
}
```

- [ ] **Step 5: Run the tests and the checks**

Run: `cd /d/MRA-plan-23c/frontend && npx vitest run src/components src/lib && npm run typecheck && npm run lint`
Expected: PASS, including 23b's `models-view.test.tsx` (60 tests, unchanged), 23a's `admin-gate.test.tsx` with the new
link list, and `src/components/tables-caption.test.ts` (each settings group table has a screen-reader caption).

- [ ] **Step 6: Commit**

```bash
cd /d/MRA-plan-23c && git add frontend/src/lib/admin-types.ts frontend/src/lib/admin-api.ts frontend/src/lib/admin-api.test.ts \
  frontend/src/lib/admin-copy.ts frontend/src/lib/admin-workers.ts frontend/src/components/admin/admin-nav.tsx \
  frontend/src/components/admin/admin-gate.test.tsx frontend/src/components/admin/models-view.tsx \
  frontend/src/components/admin/use-worker-follow-up.ts frontend/src/components/admin/versioned-page.tsx \
  frontend/src/components/admin/worker-versions.tsx \
  frontend/src/components/admin/version-history.tsx frontend/src/components/admin/version-history.test.tsx \
  frontend/src/components/admin/settings-view.tsx frontend/src/components/admin/settings-view.test.tsx \
  "frontend/src/app/admin/(console)/settings/page.tsx" frontend/src/test/admin-runtime-fixtures.ts
git commit -m "feat(admin-ui): settings page with env defaults, validate, save, 409, history and restore on the models page's rules (shared helpers moved out of ModelsView); runtime and harness client (Plan 23c)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: The glossary page

**Files:**
- Create: `frontend/src/components/admin/glossary-view.tsx`
- Create: `frontend/src/app/admin/(console)/glossary/page.tsx`
- Test: `frontend/src/components/admin/glossary-view.test.tsx`

**Interfaces:**
- Consumes: `adminApi.glossary/validateGlossary/saveGlossary`, `useVersionedPage`, `DraftStatus`, `<VersionHistory>`,
  `<WorkerVersions>` and `STALE_TEXT` (Task 10); `ConfirmButton`, `WORKERS_NOT_NOTIFIED` (23b).
- Produces: `<GlossaryView />`, `GLOSSARY_PAGE`, `Row` and `termsOf(rows)`.
- The page is the settings page's model with rows: the draft is the row list, `same` compares `termsOf(rows)` (row keys
  are for React only), and a clean draft whose terms equal the server's keeps its own rows, so a background read every
  10 s while a worker lags never re-mounts a cell the admin is in. Row keys come from a module-level counter, so no
  ref is written in a promise callback or during render.

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/admin/glossary-view.test.tsx`:

```tsx
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlossaryTerm } from "@/lib/admin-types";
import type { AdminReply } from "@/test/admin-fetch";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { GLOSSARY, GLOSSARY_VERSIONS, WORKER } from "@/test/admin-runtime-fixtures";
import { GlossaryView } from "./glossary-view";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/glossary" }));
const SEEN = Date.parse(WORKER.loaded_at);
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SEEN + 30_000); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); nav.replace.mockReset(); });

const SAVE = { name: "บันทึกเป็นเวอร์ชันใหม่" };
const routes = (state = GLOSSARY) => (m: string, p: string): AdminReply | undefined =>
  m === "GET" && p === "/glossary" ? [200, state] : m === "GET" && p.startsWith("/glossary/versions") ? [200, GLOSSARY_VERSIONS] : undefined;

describe("GlossaryView", () => {
  it("shows the source, the terms and their notes", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<GlossaryView />);
    expect(await screen.findByText("ใช้อภิธานศัพท์เวอร์ชัน 4 จาก DB")).toBeInTheDocument();
    expect(screen.getByLabelText("English คำที่ 2")).toHaveValue("placebo");
    expect(screen.getByLabelText("หมายเหตุ คำที่ 2")).toHaveValue("ไม่ใช่ยาจริง");
    expect(screen.getByText(/worker-1:7/)).toHaveTextContent("ตรงกับที่ใช้งาน");
  });

  it("adds a term, shows a cell error, previews and saves the terms on the version they came from", async () => {
    const posted: unknown[] = [];
    mockAdminFetch((m, p, body) => {
      if (m === "POST" && p === "/glossary/validate") {
        const terms = (body as { terms: GlossaryTerm[] }).terms;
        return terms[2].th === ""
          ? [200, { ok: false, errors: [{ field: "terms.2.th", message: "terms.2.th: required" }], warnings: [], preview: null, chars: null }]
          : [200, { ok: true, errors: [], warnings: [],
              preview: "hazard ratio = อัตราส่วนฮาซาร์ด (HR); placebo = ยาหลอก; mortality = อัตราการเสียชีวิต", chars: 80 }];
      }
      if (m === "POST" && p === "/glossary") {
        posted.push(body);
        return [201, { ...GLOSSARY_VERSIONS.items[0], version: 5, workers_notified: true }];
      }
      return routes()(m, p);
    });
    await renderAdmin(<GlossaryView />);
    await screen.findByLabelText("English คำที่ 1");
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มคำ" }));
    const en = screen.getByLabelText("English คำที่ 3");
    await waitFor(() => expect(en).toHaveFocus());
    fireEvent.change(en, { target: { value: "mortality" } });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจ" }));
    expect(await screen.findByText("terms.2.th: required")).toBeInTheDocument();
    expect(screen.getByLabelText("ภาษาไทย คำที่ 3")).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(screen.getByLabelText("ภาษาไทย คำที่ 3"), { target: { value: "อัตราการเสียชีวิต" } });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจ" }));
    expect(await screen.findByText(/mortality = อัตราการเสียชีวิต/)).toBeInTheDocument();
    expect(screen.getByText("80 / 4000 ตัวอักษร")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText("บันทึกเป็นเวอร์ชัน 5 แล้ว")).toBeInTheDocument();
    expect(posted).toEqual([{ base_version: 4, terms: [
      { en: "hazard ratio", th: "อัตราส่วนฮาซาร์ด", abbr: "HR", note: null },
      { en: "placebo", th: "ยาหลอก", abbr: null, note: "ไม่ใช่ยาจริง" },
      { en: "mortality", th: "อัตราการเสียชีวิต", abbr: null, note: null }] }]);
  });

  it("filters the table, removes a term and puts focus on the add button", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<GlossaryView />);
    fireEvent.change(await screen.findByLabelText("ค้นหาคำ"), { target: { value: "placebo" } });
    expect(screen.queryByLabelText("English คำที่ 1")).toBeNull();
    fireEvent.change(screen.getByLabelText("ค้นหาคำ"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "ลบคำที่ 1" }));
    expect(screen.getByLabelText("English คำที่ 1")).toHaveValue("placebo");
    await waitFor(() => expect(screen.getByRole("button", { name: "เพิ่มคำ" })).toHaveFocus());
  });

  it("re-reads after a 409 and keeps the draft, which can be discarded after the confirm", async () => {
    let version = 4;
    mockAdminFetch((m, p) => {
      if (m === "GET" && p === "/glossary") return [200, { ...GLOSSARY, version }];
      if (m === "POST" && p === "/glossary") { version = 6; return [409, { detail: "version 6 is in use now; reload the latest version and try again" }]; }
      return routes()(m, p);
    });
    await renderAdmin(<GlossaryView />);
    fireEvent.change(await screen.findByLabelText("ภาษาไทย คำที่ 2"), { target: { value: "ยาเปล่า" } });
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByRole("alert")).toHaveTextContent("มีผู้ดูแลอีกคนบันทึกเวอร์ชันใหม่ก่อน");
    expect(await screen.findByText("ร่างนี้แก้จากเวอร์ชัน 4 แต่ตอนนี้ใช้เวอร์ชัน 6 อยู่")).toBeInTheDocument();
    expect(screen.getByLabelText("ภาษาไทย คำที่ 2")).toHaveValue("ยาเปล่า");
    fireEvent.click(screen.getByRole("button", { name: "ทิ้งการแก้ไข" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันทิ้งการแก้ไข" }));
    expect(await screen.findByText("ทิ้งการแก้ไขแล้ว: ร่างตรงกับเวอร์ชัน 6")).toBeInTheDocument();
    expect(screen.getByLabelText("ภาษาไทย คำที่ 2")).toHaveValue("ยาหลอก");
  });
});
```

Run: `cd /d/MRA-plan-23c/frontend && npx vitest run src/components/admin/glossary-view.test.tsx`
Expected: FAIL (`glossary-view` does not exist).

- [ ] **Step 2: Implement `frontend/src/components/admin/glossary-view.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { AdminApiError, adminApi } from "@/lib/admin-api";
import { WORKERS_NOT_NOTIFIED } from "@/lib/admin-copy";
import type { GlossaryReport, GlossaryState, GlossaryTerm } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { ConfirmButton } from "./confirm-button";
import { STALE_TEXT } from "./settings-view";
import { BUTTON_GHOST, BUTTON_PRIMARY, INPUT, TABLE_REGION, TD, TH } from "./ui";
import { VersionHistory } from "./version-history";
import { DraftStatus, type VersionedSpec, useVersionedPage } from "./versioned-page";
import { WorkerVersions } from "./worker-versions";

/** One table row: a term and a key that only React uses (rows can be added and removed). */
export type Row = { key: number; en: string; th: string; abbr: string; note: string };
const FIELDS = ["en", "th", "abbr", "note"] as const;
type Field = (typeof FIELDS)[number];
const FIELD_LABEL: Record<Field, string> = { en: "English", th: "ภาษาไทย", abbr: "ตัวย่อ", note: "หมายเหตุ" };
const FIELD_HEAD: Record<Field, string> = {
  en: "English (คั่นคำพ้องด้วย /)", th: "ภาษาไทย", abbr: "ตัวย่อ", note: "หมายเหตุ (ไม่ส่งให้โมเดล)",
};

let nextKey = 0; // row keys only need to be unique on this page
const keyed = (terms: GlossaryTerm[]): Row[] =>
  terms.map((t) => ({ key: nextKey++, en: t.en, th: t.th, abbr: t.abbr ?? "", note: t.note ?? "" }));
const emptyRow = (): Row => ({ key: nextKey++, en: "", th: "", abbr: "", note: "" });

export function termsOf(rows: Row[]): GlossaryTerm[] {
  return rows.map((r) => ({ en: r.en, th: r.th, abbr: r.abbr.trim() ? r.abbr : null, note: r.note.trim() ? r.note : null }));
}

const glossaryName = (v: number | null) => (v === null ? "ตั้งต้น" : String(v));

export const GLOSSARY_PAGE: VersionedSpec<GlossaryState, Row[]> = {
  read: () => adminApi.glossary(),
  docOf: (s) => keyed(s.terms),
  same: (a, b) => JSON.stringify(termsOf(a)) === JSON.stringify(termsOf(b)), // row keys do not count
  workerVersion: (w) => w.glossary ?? "file",
  wanted: (s) => (s.version === null ? "file" : String(s.version)),
  versionName: glossaryName,
};

interface Saved { version: number; workersNotified: boolean }

export function GlossaryView() {
  const { fail } = useAdmin();
  const page = useVersionedPage(GLOSSARY_PAGE);
  const { state, draft } = page;
  const [checked, setChecked] = useState<{ rows: Row[]; report: GlossaryReport } | null>(null);
  const [filter, setFilter] = useState("");
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<"edit" | "history">("edit");
  const [actionError, setActionError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [busy, setBusy] = useState(false);
  const savedRef = useRef<HTMLDivElement>(null);
  const focusSaved = useRef(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const newRowRef = useRef<HTMLInputElement>(null);
  // Where focus goes after the rows change: the new row's English cell, or the add button when a row is removed.
  const focusAfterRows = useRef<"new" | "add" | null>(null);
  const rows = draft?.doc;

  useEffect(() => {
    if (focusAfterRows.current === "new") newRowRef.current?.focus();
    else if (focusAfterRows.current === "add") addRef.current?.focus();
    focusAfterRows.current = null;
  }, [rows]);

  useEffect(() => {
    if (saved && focusSaved.current) {
      focusSaved.current = false;
      savedRef.current?.focus();
    }
  }, [saved]);

  if (!state || !draft || !rows) {
    return (
      <section aria-labelledby="glossary-title" className="py-6">
        <h1 id="glossary-title" className="font-display text-2xl font-semibold">อภิธานศัพท์ไทย</h1>
        {page.error ? <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-2">{page.error}</p>
          : <p role="status" className="mt-4 text-muted">กำลังโหลด…</p>}
      </section>
    );
  }
  const current = state;
  const report = checked && GLOSSARY_PAGE.same(checked.rows, rows) ? checked.report : null;
  const cellErrors = new Map((report?.errors ?? []).filter((e) => e.field?.startsWith("terms."))
    .map((e) => [e.field as string, e.message]));
  const otherErrors = (report?.errors ?? []).filter((e) => !e.field?.startsWith("terms."));
  const needle = filter.trim().toLowerCase();
  const shown = (r: Row) => !needle || r.en.toLowerCase().includes(needle) || r.th.includes(filter.trim());

  function changeRows(change: (rows: Row[]) => Row[]) {
    setSaved(null);
    page.edit(change);
  }
  const edit = (key: number, field: Field, value: string) =>
    changeRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  function add() {
    focusAfterRows.current = "new";
    setFilter("");
    changeRows((prev) => [...prev, emptyRow()]);
  }
  function remove(key: number) {
    focusAfterRows.current = "add";
    changeRows((prev) => prev.filter((r) => r.key !== key));
  }

  async function validate() {
    const sent = rows!;
    setBusy(true);
    setActionError(null);
    try {
      setChecked({ rows: sent, report: await adminApi.validateGlossary(termsOf(sent)) });
    } catch (e) {
      setActionError(fail(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const sent = rows!;
    setBusy(true);
    setActionError(null);
    page.track.start();
    try {
      const row = await adminApi.saveGlossary({ terms: termsOf(sent), base_version: draft!.base,
        ...(note.trim() ? { note: note.trim() } : {}) });
      page.track.wrote();
      setNote("");
      focusSaved.current = true;
      setSaved({ version: row.version, workersNotified: row.workers_notified !== false });
      await page.load(sent, row.version);
    } catch (e) {
      if (e instanceof AdminApiError && e.status === 409) {
        setActionError(STALE_TEXT);
        page.reload();
      } else {
        setActionError(fail(e));
      }
    } finally {
      page.track.end();
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="glossary-title" className="py-6">
      <h1 id="glossary-title" className="font-display text-2xl font-semibold">อภิธานศัพท์ไทย</h1>
      <div className="mt-3 rounded-sm bg-info-bg px-4 py-3">
        <p className="font-display font-semibold">
          {current.source === "db" ? `ใช้อภิธานศัพท์เวอร์ชัน ${current.version} จาก DB` : "ใช้อภิธานศัพท์ตั้งต้น (ในโค้ด)"}
        </p>
        <p className="text-sm">{`${current.terms.length} คำ · ${current.chars} / ${current.max_chars} ตัวอักษรใน prompt ของตัวแปลภาษา`}</p>
        <p className="text-sm">
          การบันทึกทำให้รีวิวหัวข้อเดิมรันใหม่ (cache รุ่นใหม่) รีวิวที่กำลังทำอยู่ใช้ชุดเดิมจนจบ worker ใช้ชุดใหม่เมื่อเริ่มรีวิวถัดไปหรือภายใน 30 วินาที
        </p>
        <WorkerVersions loaded={current.loaded} field="glossary" expected={GLOSSARY_PAGE.wanted(current)}
          now={page.readAt} settling={page.settling} />
      </div>
      {page.error && <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-2">{page.error}</p>}
      <div role="group" aria-label="มุมมอง" className="mt-4 flex flex-wrap gap-2">
        <button type="button" aria-pressed={tab === "edit"} className={BUTTON_GHOST} onClick={() => setTab("edit")}>แก้ไข</button>
        <button type="button" aria-pressed={tab === "history"} className={BUTTON_GHOST} onClick={() => setTab("history")}>ประวัติ</button>
      </div>
      {tab === "history" ? (
        <VersionHistory kind="glossary" base={current.version} resetLabel="กลับไปใช้อภิธานศัพท์ตั้งต้น"
          emptyText="ยังไม่มีเวอร์ชันที่บันทึก ใช้อภิธานศัพท์ตั้งต้นอยู่"
          resetHint="เวอร์ชันใหม่จะมีคำชุดตั้งต้น แต่ยังเป็นเวอร์ชันที่บันทึก: cache ผลรีวิวเริ่มรุ่นใหม่เหมือนการบันทึกครั้งอื่น"
          onChanged={page.reload} writes={page.track} />
      ) : (
        <>
          <label className="mt-6 block max-w-md">
            <span className="text-sm">ค้นหาคำ</span>
            <input type="search" className={INPUT} value={filter} onChange={(e) => setFilter(e.target.value)} />
          </label>
          <div className={TABLE_REGION}>
            <table className="w-full min-w-[54rem] border-collapse text-sm">
              <caption className="sr-only">คำในอภิธานศัพท์</caption>
              <thead>
                <tr>
                  <th scope="col" className={TH}>#</th>
                  {FIELDS.map((f) => <th key={f} scope="col" className={TH}>{FIELD_HEAD[f]}</th>)}
                  <th scope="col" className={TH}><span className="sr-only">ลบ</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => shown(r) && (
                  <tr key={r.key}>
                    <td className={TD}>{i + 1}</td>
                    {FIELDS.map((field) => {
                      const message = cellErrors.get(`terms.${i}.${field}`) ?? (field === "en" ? cellErrors.get(`terms.${i}`) : undefined);
                      const id = `term-${r.key}-${field}`;
                      return (
                        <td key={field} className={TD}>
                          <input id={id} ref={field === "en" && i === rows.length - 1 ? newRowRef : undefined}
                            aria-label={`${FIELD_LABEL[field]} คำที่ ${i + 1}`} className={INPUT} value={r[field]}
                            aria-invalid={message ? true : undefined} aria-describedby={message ? `${id}-error` : undefined}
                            onChange={(e) => edit(r.key, field, e.target.value)} />
                          {message && <p id={`${id}-error`} className="mt-1 text-sm text-err">{message}</p>}
                        </td>
                      );
                    })}
                    <td className={TD}>
                      <button type="button" className={BUTTON_GHOST} aria-label={`ลบคำที่ ${i + 1}`} onClick={() => remove(r.key)}>ลบ</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button ref={addRef} type="button" className={`mt-3 ${BUTTON_GHOST}`} onClick={add}>เพิ่มคำ</button>
          <DraftStatus moved={page.moved} base={draft.base} current={current.version} note={page.draftNote}
            onDiscard={page.discard} onRebase={page.rebase} versionName={glossaryName} />
          {report && (
            <div className={`mt-6 rounded-sm px-4 py-3 ${report.ok ? "bg-info-bg" : "bg-err-bg"}`}>
              <p className="font-display font-semibold">{report.ok ? "ผ่านการตรวจ" : "ยังบันทึกไม่ได้ ดูช่องที่มีข้อความสีแดง"}</p>
              <ul className="mt-1 list-disc pl-5 text-sm">
                {otherErrors.map((e) => <li key={e.message}>{e.message}</li>)}
                {report.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
              {report.ok && report.preview !== null && (
                <>
                  <p className="mt-2 text-sm">{`${report.chars} / ${current.max_chars} ตัวอักษร`}</p>
                  <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-sm border border-rule bg-ground p-3 font-code text-xs">
                    {report.preview}
                  </pre>
                </>
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

`frontend/src/app/admin/(console)/glossary/page.tsx`:

```tsx
import type { Metadata } from "next";
import { GlossaryView } from "@/components/admin/glossary-view";

export const metadata: Metadata = { title: "อภิธานศัพท์ · ผู้ดูแลระบบ" };

export default function AdminGlossaryPage() {
  return <GlossaryView />;
}
```

- [ ] **Step 3: Run the tests and the checks**

Run: `cd /d/MRA-plan-23c/frontend && npx vitest run src/components/admin && npm run typecheck && npm run lint`
Expected: PASS (the term table has its screen-reader caption, so `tables-caption.test.ts` stays green).

- [ ] **Step 4: Commit**

```bash
cd /d/MRA-plan-23c && git add frontend/src/components/admin/glossary-view.tsx frontend/src/components/admin/glossary-view.test.tsx \
  "frontend/src/app/admin/(console)/glossary/page.tsx"
git commit -m "feat(admin-ui): glossary page — term table with add, remove and filter, cell errors, prompt preview, save, history (Plan 23c)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: The harness page and the safe report renderer

**Files:**
- Create: `frontend/src/lib/report-markdown.ts`
- Create: `frontend/src/components/admin/harness-report.tsx`, `frontend/src/components/admin/harness-view.tsx`
- Create: `frontend/src/app/admin/(console)/harness/page.tsx`
- Test: `frontend/src/lib/report-markdown.test.ts`, `frontend/src/components/admin/harness-view.test.tsx`

**Interfaces:**
- Consumes: the harness half of `adminApi`, the types and copy (Task 10); `ConfirmButton`; `formatUsd`, `formatWhen`.
- Produces:
  - `parseReport(md) -> Block[]` and `parseInline(text) -> Inline[]`;
  - `<HarnessReport text />`;
  - `<HarnessView />` and `plannedRuns(state, strata, maxReviews, repeats)`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/lib/report-markdown.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { REPORT_TEXT } from "@/test/admin-runtime-fixtures";
import { parseInline, parseReport } from "./report-markdown";

describe("parseReport", () => {
  it("reads the report's headings, lists, tables and paragraphs", () => {
    const blocks = parseReport(REPORT_TEXT);
    expect(blocks[0]).toEqual({ kind: "heading", level: 1, text: "Cochrane harness report: 2026-10-11.1 (run baseline)" });
    expect(blocks).toContainEqual({ kind: "list", items: ["git `abc` · preset `budget`"] });
    expect(blocks).toContainEqual({ kind: "heading", level: 2, text: "Summary" });
    expect(blocks).toContainEqual({ kind: "table", head: ["Metric", "This run"], rows: [["Runs (failed)", "60 (0)"], ["Batch cost", "$3.90"]] });
    expect(blocks.at(-1)).toEqual({ kind: "paragraph", text: "<script>alert(1)</script>" });
  });

  it("never loops on a lone pipe line, reads CRLF and keeps deeper headings as text", () => {
    expect(parseReport("| not a table\r\nnext")).toEqual([{ kind: "paragraph", text: "| not a table next" }]);
    expect(parseReport("#### deep")).toEqual([{ kind: "paragraph", text: "#### deep" }]);
  });
});

describe("parseInline", () => {
  it("splits bold and code and leaves everything else as text", () => {
    expect(parseInline("**MIXED BATCH:** git `x` <b>")).toEqual([
      { kind: "strong", text: "MIXED BATCH:" }, { kind: "text", text: " git " }, { kind: "code", text: "x" },
      { kind: "text", text: " <b>" }]);
  });
});
```

`frontend/src/components/admin/harness-view.test.tsx`:

```tsx
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HarnessState } from "@/lib/admin-types";
import type { AdminReply } from "@/test/admin-fetch";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { COMPARE, HARNESS, REPORTS, REPORT_TEXT, RESULTS, RUN, RUN_DONE } from "@/test/admin-runtime-fixtures";
import { HarnessReport } from "./harness-report";
import { HarnessView, plannedRuns } from "./harness-view";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/harness" }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); nav.replace.mockReset(); });

const ACTIVE: HarnessState = { ...HARNESS, available: false, reasons: ["active_run"], active: RUN };
const routes = (state: HarnessState = HARNESS) => (m: string, p: string): AdminReply | undefined => {
  if (m !== "GET") return undefined;
  if (p === "/harness") return [200, state];
  if (p.startsWith("/harness/runs")) return [200, { items: [RUN_DONE], next: null }];
  if (p === "/harness/reports") return [200, { items: REPORTS }];
  if (p.startsWith("/harness/reports/")) return [200, { name: REPORTS[0].name, text: REPORT_TEXT }];
  if (p === "/harness/results") return [200, { items: RESULTS }];
  if (p.startsWith("/harness/compare")) return [200, COMPARE];
  return undefined;
};

describe("plannedRuns", () => {
  it("counts the chosen strata's frozen reviews, capped, times the repeats", () => {
    expect(plannedRuns(HARNESS, [], null, 2)).toBe(6);
    expect(plannedRuns(HARNESS, ["cv"], 2, 1)).toBe(2);
    expect(plannedRuns(HARNESS, ["renal"], null, 2)).toBe(0);
  });
});

describe("HarnessReport", () => {
  it("renders the report as elements and never as HTML", () => {
    const { container } = render(<HarnessReport text={REPORT_TEXT} />);
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByText("<script>alert(1)</script>")).toBeInTheDocument();
    expect(within(screen.getByRole("table")).getByRole("row", { name: /Batch cost/ })).toHaveTextContent("$3.90");
  });
});

describe("HarnessView", () => {
  it("explains why it cannot start and keeps the start button disabled", async () => {
    mockAdminFetch(routes({ ...HARNESS, available: false, reasons: ["no_worker", "no_fixtures"] }));
    await renderAdmin(<HarnessView />);
    expect(await screen.findByText("ยังเริ่มรันไม่ได้")).toBeInTheDocument();
    expect(screen.getByText(/harness worker ไม่ทำงาน/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เริ่มรัน harness" })).toBeDisabled();
  });

  it("estimates the run and starts it only after the acknowledgement and the confirm", async () => {
    const posted: unknown[] = [];
    mockAdminFetch((m, p, body) => {
      if (m === "POST" && p === "/harness/runs") { posted.push(body); return [201, { ...RUN, status: "queued" }]; }
      return routes()(m, p);
    });
    await renderAdmin(<HarnessView />);
    await screen.findByText("พร้อมเริ่มรัน");
    fireEvent.click(screen.getByRole("checkbox", { name: /cv · 3/ }));
    fireEvent.click(screen.getByRole("radio", { name: "1 รอบ" }));
    expect(screen.getByText(/ประมาณการ: 3 รอบ/)).toHaveTextContent("กรณีมากที่สุด $0.840");
    const start = screen.getByRole("button", { name: "เริ่มรัน harness" });
    expect(start).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /เข้าใจว่าการรันนี้เรียกโมเดลจริง/ }));
    fireEvent.click(start);
    fireEvent.click(screen.getByRole("button", { name: "ยืนยัน เริ่มรันและใช้เงินจริง" }));
    expect(await screen.findByText(/เริ่มรัน console-20261013-100000-a1b2 แล้ว/)).toBeInTheDocument();
    expect(posted).toEqual([{ max_usd: 1, repeats: 1, strata: ["cv"], max_reviews: null, compare_run: null, confirm: true }]);
  });

  it("refuses a cap outside the per-review cap and the ceiling", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<HarnessView />);
    fireEvent.change(await screen.findByLabelText("งบสูงสุด (USD)"), { target: { value: "20" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /เข้าใจว่าการรันนี้เรียกโมเดลจริง/ }));
    expect(screen.getByText("งบต้องอยู่ระหว่าง $0.280 ถึง $5.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เริ่มรัน harness" })).toBeDisabled();
  });

  it("shows the active run's progress and cancels it after the confirm", async () => {
    let cancelled = false;
    mockAdminFetch((m, p) => {
      if (m === "POST" && p === `/harness/runs/${RUN.id}/cancel`) { cancelled = true; return [200, { ...RUN, status: "cancelled" }]; }
      return routes(cancelled ? HARNESS : ACTIVE)(m, p);
    });
    await renderAdmin(<HarnessView />);
    expect(await screen.findByText(/เสร็จ 2 · ล้มเหลว 0 · ข้าม 0 จาก 6/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิกการรัน" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันยกเลิก" }));
    expect(await screen.findByText(/ยกเลิกแล้ว รีวิวที่กำลังทำอยู่/)).toBeInTheDocument();
  });

  it("polls every 5 seconds while a run is active", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let done = 2;
    const fn = mockAdminFetch((m, p) => routes({ ...ACTIVE, active: { ...RUN, done } })(m, p));
    await renderAdmin(<HarnessView />);
    await screen.findByText(/เสร็จ 2 ·/);
    done = 4;
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(await screen.findByText(/เสร็จ 4 ·/)).toBeInTheDocument();
    expect(fn.mock.calls.filter(([u]) => String(u).endsWith("/api/v1/admin/harness")).length).toBeGreaterThanOrEqual(2);
  });

  it("opens a report as text and compares two runs", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<HarnessView />);
    fireEvent.click(await screen.findByRole("button", { name: REPORTS[0].name }));
    expect(await screen.findByRole("heading", { name: "Cochrane harness report: 2026-10-11.1 (run baseline)" })).toBeInTheDocument();
    expect(document.querySelector("main script, section script")).toBeNull();
    fireEvent.change(screen.getByLabelText("รุ่น A"), { target: { value: RESULTS[0].label } });
    fireEvent.change(screen.getByLabelText("รุ่น B"), { target: { value: RESULTS[1].label } });
    fireEvent.click(screen.getByRole("button", { name: "เทียบ" }));
    const row = await screen.findByRole("row", { name: /Batch cost.*\$0\.40/ });
    expect(row).toHaveTextContent("$3.90");
    expect(screen.getByText("CD1: consensus:positive → none")).toBeInTheDocument();
  });
});
```

Run: `cd /d/MRA-plan-23c/frontend && npx vitest run src/lib/report-markdown.test.ts src/components/admin/harness-view.test.tsx`
Expected: FAIL (the modules do not exist).

- [ ] **Step 2: Implement `frontend/src/lib/report-markdown.ts`**

```ts
/** A small reader for the 22a harness reports (Plan 23c): headings (#, ##, ###), paragraphs, bullet lists, pipe
 * tables, **bold** and `code`. Everything else is text. The result is data for React elements: no HTML is produced
 * or inserted, so a report cannot run script whatever it contains. */
export type Inline = { kind: "text" | "strong" | "code"; text: string };
export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "table"; head: string[]; rows: string[][] };

const SEPARATOR = /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/;
const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^[-*]\s+/;

function cells(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

function startsBlock(line: string): boolean {
  return HEADING.test(line) || BULLET.test(line) || line.startsWith("|");
}

export function parseReport(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trim());
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) { i += 1; continue; }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, text: heading[2] });
      i += 1;
      continue;
    }
    if (line.startsWith("|") && i + 1 < lines.length && SEPARATOR.test(lines[i + 1])) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].startsWith("|")) { rows.push(cells(lines[i])); i += 1; }
      blocks.push({ kind: "table", head, rows });
      continue;
    }
    if (BULLET.test(line)) {
      const items: string[] = [];
      while (i < lines.length && BULLET.test(lines[i])) { items.push(lines[i].replace(BULLET, "")); i += 1; }
      blocks.push({ kind: "list", items });
      continue;
    }
    const para = [line]; // the first line is always taken, so a line no rule matches can never stall the loop
    i += 1;
    while (i < lines.length && lines[i] && !startsBlock(lines[i])) { para.push(lines[i]); i += 1; }
    blocks.push({ kind: "paragraph", text: para.join(" ") });
  }
  return blocks;
}

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ kind: "text", text: text.slice(last, at) });
    const token = m[0];
    out.push(token.startsWith("**") ? { kind: "strong", text: token.slice(2, -2) } : { kind: "code", text: token.slice(1, -1) });
    last = at + token.length;
  }
  if (last < text.length) out.push({ kind: "text", text: text.slice(last) });
  return out;
}
```

The lone-pipe test relies on two rules. The table rule needs a separator line next. The paragraph rule takes its first
line whatever it starts with, then stops only at a blank line or a line that starts a block. Here the next line,
"next", starts no block, so both lines join one paragraph, as the test expects.

- [ ] **Step 3: Implement `frontend/src/components/admin/harness-report.tsx`**

```tsx
import { parseInline, parseReport } from "@/lib/report-markdown";
import { TABLE_REGION, TD, TH } from "./ui";

function Text({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((part, i) =>
        part.kind === "strong" ? <strong key={i}>{part.text}</strong>
          : part.kind === "code" ? <code key={i} className="font-code text-[0.85em]">{part.text}</code>
            : <span key={i}>{part.text}</span>)}
    </>
  );
}

/** A 22a report as React elements (headings start at h3 inside the harness page). */
export function HarnessReport({ text }: { text: string }) {
  return (
    <div className="mt-3 grid gap-3 text-sm [overflow-wrap:anywhere]">
      {parseReport(text).map((block, i) => {
        if (block.kind === "heading") {
          const Tag = (["h3", "h4", "h5"] as const)[block.level - 1];
          return <Tag key={i} className="font-display font-semibold"><Text text={block.text} /></Tag>;
        }
        if (block.kind === "list") {
          return <ul key={i} className="list-disc pl-5">{block.items.map((item, j) => <li key={j}><Text text={item} /></li>)}</ul>;
        }
        if (block.kind === "table") {
          return (
            <div key={i} className={TABLE_REGION}>
              <table className="w-full border-collapse">
                <caption className="sr-only">ตารางในรายงาน</caption>
                <thead><tr>{block.head.map((h, j) => <th key={j} scope="col" className={TH}><Text text={h} /></th>)}</tr></thead>
                <tbody>
                  {block.rows.map((row, j) => (
                    <tr key={j}>{row.map((c, k) => <td key={k} className={TD}><Text text={c} /></td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }
        return <p key={i}><Text text={block.text} /></p>;
      })}
    </div>
  );
}
```

- [ ] **Step 4: Implement `frontend/src/components/admin/harness-view.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { adminApi } from "@/lib/admin-api";
import { HARNESS_STATUS_LABEL, formatUsd, formatWhen, harnessReasonText } from "@/lib/admin-copy";
import type { HarnessCompare, HarnessReportItem, HarnessResultItem, HarnessRun, HarnessState } from "@/lib/admin-types";
import { useAdmin } from "./admin-gate";
import { ConfirmButton } from "./confirm-button";
import { HarnessReport } from "./harness-report";
import { BUTTON_GHOST, INPUT, TABLE_REGION, TD, TH } from "./ui";

const POLL_MS = 5000;

/** Planned runs for the form: the chosen strata's reviews with a frozen pool (all strata when none is chosen),
 * capped by "at most N reviews", times the repeats. */
export function plannedRuns(state: HarnessState, strata: string[], maxReviews: number | null, repeats: number): number {
  const reviews = state.strata.filter((s) => strata.length === 0 || strata.includes(s.name))
    .reduce((n, s) => n + s.with_fixtures, 0);
  return (maxReviews ? Math.min(reviews, maxReviews) : reviews) * repeats;
}

function ActiveRun({ run, onCancel }: { run: HarnessRun; onCancel: (id: number) => Promise<void> }) {
  return (
    <div className="mt-3 border-t border-rule pt-3">
      <p className="font-display font-semibold">{`${run.run_id} · ${HARNESS_STATUS_LABEL[run.status]}`}</p>
      <p className="text-sm">
        {`เสร็จ ${run.done} · ล้มเหลว ${run.failed} · ข้าม ${run.skipped} จาก ${run.planned} · ใช้ไป ${formatUsd(run.spent_usd)} จากงบ ${formatUsd(run.max_usd)}`}
      </p>
      <progress className="mt-2 w-full" aria-label="ความคืบหน้าของการรัน" max={run.planned || 1}
        value={run.done + run.failed + run.skipped} />
      <div className="mt-2">
        <ConfirmButton label="ยกเลิกการรัน" confirmLabel="ยืนยันยกเลิก" onConfirm={() => onCancel(run.id)} />
      </div>
    </div>
  );
}

export function HarnessView() {
  const { fail } = useAdmin();
  const [state, setState] = useState<HarnessState | null>(null);
  const [runs, setRuns] = useState<HarnessRun[]>([]);
  const [reports, setReports] = useState<HarnessReportItem[]>([]);
  const [results, setResults] = useState<HarnessResultItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const [strata, setStrata] = useState<string[]>([]);
  const [repeats, setRepeats] = useState(2);
  const [maxReviews, setMaxReviews] = useState("");
  const [compareRun, setCompareRun] = useState("");
  const [cap, setCap] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [open, setOpen] = useState<{ name: string; text: string } | null>(null);
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [comparison, setComparison] = useState<HarnessCompare | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const focusNotice = useRef(false);
  const reportRef = useRef<HTMLHeadingElement>(null);
  const compareRef = useRef<HTMLTableCaptionElement>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([adminApi.harness(), adminApi.harnessRuns(), adminApi.harnessReports(), adminApi.harnessResults()])
      .then(([s, r, rep, res]) => {
        if (alive) { setState(s); setRuns(r.items); setReports(rep.items); setResults(res.items); }
      })
      .catch((e: unknown) => { if (alive) setError(fail(e)); });
    return () => { alive = false; };
  }, [fail, reloads]);

  const activeId = state?.active?.id ?? null;
  useEffect(() => {
    if (activeId === null) return undefined;
    const timer = setInterval(() => {
      adminApi.harness()
        .then((s) => {
          setState(s);
          if (s.active === null) setReloads((n) => n + 1); // finished: refresh the runs and the reports
        })
        .catch(() => { /* the next tick tries again */ });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [activeId]);

  useEffect(() => {
    if (notice && focusNotice.current) {
      focusNotice.current = false;
      noticeRef.current?.focus();
    }
  }, [notice]);
  useEffect(() => { if (open) reportRef.current?.focus(); }, [open]);
  useEffect(() => { if (comparison) compareRef.current?.focus(); }, [comparison]);

  if (!state) {
    return (
      <section aria-labelledby="harness-title" className="py-6">
        <h1 id="harness-title" className="font-display text-2xl font-semibold">Cochrane harness</h1>
        {error ? <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-2">{error}</p>
          : <p role="status" className="mt-4 text-muted">กำลังโหลด…</p>}
      </section>
    );
  }
  const current = state;
  const capText = cap ?? current.default_usd.toFixed(2);
  const capValue = Number(capText);
  const reviewsLimit = maxReviews ? Number(maxReviews) : null;
  const planned = plannedRuns(current, strata, reviewsLimit, repeats);
  const capOk = Number.isFinite(capValue) && capValue >= current.per_review_cap_usd && capValue <= current.ceiling_usd;
  const canStart = current.available && planned > 0 && capOk && ack;

  async function start() {
    setError(null);
    try {
      const run = await adminApi.startHarness({ max_usd: capValue, repeats, strata, max_reviews: reviewsLimit,
        compare_run: compareRun || null, confirm: true });
      focusNotice.current = true;
      setNotice(`เริ่มรัน ${run.run_id} แล้ว (งบไม่เกิน ${formatUsd(run.max_usd)})`);
      setAck(false);
    } catch (e) {
      setError(fail(e));
    }
    setReloads((n) => n + 1);
  }

  async function cancel(id: number) {
    setError(null);
    try {
      await adminApi.cancelHarness(id);
      focusNotice.current = true;
      setNotice("ยกเลิกแล้ว รีวิวที่กำลังทำอยู่จะทำจนจบแล้วหยุด");
    } catch (e) {
      setError(fail(e));
    }
    setReloads((n) => n + 1);
  }

  async function openReport(name: string) {
    setError(null);
    try {
      setOpen(await adminApi.harnessReport(name));
    } catch (e) {
      setError(fail(e));
    }
  }

  async function compare() {
    setError(null);
    setComparison(null);
    try {
      setComparison(await adminApi.harnessCompare(a, b));
    } catch (e) {
      setError(fail(e));
    }
  }

  return (
    <section aria-labelledby="harness-title" className="py-6">
      <h1 id="harness-title" className="font-display text-2xl font-semibold">Cochrane harness</h1>
      {notice && <p ref={noticeRef} tabIndex={-1} role="status" className="mt-4 rounded-sm bg-info-bg px-4 py-2">{notice}</p>}
      {error && <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-2">{error}</p>}

      <section aria-labelledby="harness-status" className={`mt-4 rounded-sm px-4 py-3 ${current.available ? "bg-info-bg" : "bg-warn-bg"}`}>
        <h2 id="harness-status" className="font-display text-lg font-semibold">{current.available ? "พร้อมเริ่มรัน" : "ยังเริ่มรันไม่ได้"}</h2>
        {current.reasons.length > 0 && (
          <ul className="mt-1 list-disc pl-5 text-sm">{current.reasons.map((r) => <li key={r}>{harnessReasonText(r)}</li>)}</ul>
        )}
        <p className="mt-1 text-sm">
          {`prompt_version ${current.prompt_version} · pool ${current.pool_version ?? "—"} · frozen pool ${current.fixtures.present} จาก ${current.fixtures.selected} รีวิว · `}
          {current.worker ? `worker ${current.worker.worker} (เห็นล่าสุด ${formatWhen(current.worker.seen_at)})` : "worker ไม่ทำงาน"}
        </p>
        {current.active && <ActiveRun run={current.active} onCancel={cancel} />}
      </section>

      <section aria-labelledby="harness-start" className="mt-6">
        <h2 id="harness-start" className="font-display text-xl font-semibold">เริ่มรัน harness</h2>
        <p className="mt-1 rounded-sm bg-warn-bg px-3 py-2 text-sm">
          การรันนี้เรียกโมเดลจริงทุกรีวิวและเสียเงินจริงจากบัญชีของ provider ระบบจะไม่เริ่มรีวิวใดที่งบของมันเกินยอดที่เหลือ
        </p>
        <fieldset disabled={!current.available} className="mt-3 grid gap-4">
          <fieldset>
            <legend className="font-display font-semibold">กลุ่ม (ไม่เลือก = ทุกกลุ่ม)</legend>
            {current.strata.map((s) => (
              <label key={s.name} className="flex min-h-11 items-center gap-2">
                <input type="checkbox" checked={strata.includes(s.name)} disabled={s.with_fixtures === 0}
                  onChange={(e) => setStrata((prev) => (e.target.checked ? [...prev, s.name] : prev.filter((n) => n !== s.name)))} />
                {`${s.name} · ${s.with_fixtures} รีวิวที่มี frozen pool`}
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend className="font-display font-semibold">จำนวนรอบต่อรีวิว</legend>
            {[1, 2].map((n) => (
              <label key={n} className="mr-4 inline-flex min-h-11 items-center gap-2">
                <input type="radio" name="harness-repeats" checked={repeats === n} onChange={() => setRepeats(n)} />
                {`${n} รอบ`}
              </label>
            ))}
          </fieldset>
          <label className="block max-w-xs">
            <span className="text-sm">ไม่เกินกี่รีวิว (ไม่บังคับ)</span>
            <input type="number" min={1} className={INPUT} value={maxReviews} onChange={(e) => setMaxReviews(e.target.value)} />
          </label>
          <label className="block max-w-md">
            <span className="text-sm">เทียบในรายงานกับ (ไม่บังคับ)</span>
            <select className={INPUT} value={compareRun} onChange={(e) => setCompareRun(e.target.value)}>
              <option value="">ไม่เทียบ</option>
              {results.map((r) => <option key={r.label} value={r.label}>{r.label}</option>)}
            </select>
          </label>
          <label className="block max-w-xs">
            <span className="text-sm">งบสูงสุด (USD)</span>
            <input type="number" step="0.01" min={current.per_review_cap_usd} max={current.ceiling_usd} className={INPUT}
              value={capText} aria-invalid={capOk ? undefined : true} onChange={(e) => setCap(e.target.value)} />
          </label>
          <p className="text-sm">
            {`ประมาณการ: ${planned} รอบ · กรณีมากที่สุด ${formatUsd(planned * current.per_review_cap_usd)}`}
            {current.typical_review_usd !== null ? ` · โดยทั่วไป ${formatUsd(planned * current.typical_review_usd)}` : ""}
            {` · งบต่อรีวิว ${formatUsd(current.per_review_cap_usd)} · เพดาน ${formatUsd(current.ceiling_usd)}`}
          </p>
          {!capOk && (
            <p className="text-sm text-err">{`งบต้องอยู่ระหว่าง ${formatUsd(current.per_review_cap_usd)} ถึง ${formatUsd(current.ceiling_usd)}`}</p>
          )}
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            {`เข้าใจว่าการรันนี้เรียกโมเดลจริงและเสียเงินจริง ไม่เกิน ${Number.isFinite(capValue) ? formatUsd(capValue) : "—"}`}
          </label>
          <div>
            <ConfirmButton label="เริ่มรัน harness" confirmLabel="ยืนยัน เริ่มรันและใช้เงินจริง" disabled={!canStart} onConfirm={start} />
          </div>
        </fieldset>
      </section>

      <section aria-labelledby="harness-runs" className="mt-8">
        <h2 id="harness-runs" className="font-display text-xl font-semibold">การรันจากหน้านี้</h2>
        {runs.length === 0 ? <p className="mt-2 text-muted">ยังไม่มี</p> : (
          <div className={TABLE_REGION}>
            <table className="w-full min-w-[46rem] border-collapse text-sm">
              <caption className="sr-only">การรันจากหน้านี้</caption>
              <thead>
                <tr>
                  <th scope="col" className={TH}>Run</th><th scope="col" className={TH}>สถานะ</th>
                  <th scope="col" className={TH}>ความคืบหน้า</th><th scope="col" className={TH}>ค่าใช้จ่าย / งบ</th>
                  <th scope="col" className={TH}>เริ่ม</th><th scope="col" className={TH}>รายงาน</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <th scope="row" className={`${TD} text-left font-normal`}><code className="font-code text-xs">{r.run_id}</code></th>
                    <td className={TD}>
                      {HARNESS_STATUS_LABEL[r.status]}
                      {r.error && <span className="block text-xs text-err">{r.error}</span>}
                    </td>
                    <td className={TD}>{`${r.done + r.failed} / ${r.planned}`}</td>
                    <td className={TD}>{`${formatUsd(r.spent_usd)} / ${formatUsd(r.max_usd)}`}</td>
                    <td className={TD}>{formatWhen(r.created_at)}</td>
                    <td className={TD}>
                      {r.report ? (
                        <button type="button" className={BUTTON_GHOST} aria-label={`เปิดรายงาน ${r.report}`}
                          onClick={() => openReport(r.report as string)}>เปิด</button>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="harness-reports" className="mt-8">
        <h2 id="harness-reports" className="font-display text-xl font-semibold">รายงาน</h2>
        {reports.length === 0 ? <p className="mt-2 text-muted">ยังไม่มีรายงาน</p> : (
          <ul className="mt-2 grid gap-2">
            {reports.map((r) => (
              <li key={r.name} className="flex flex-wrap items-center gap-3">
                <button type="button" className={BUTTON_GHOST} onClick={() => openReport(r.name)}>{r.name}</button>
                <span className="text-sm text-muted">{formatWhen(r.modified_at)}</span>
              </li>
            ))}
          </ul>
        )}
        {open && (
          <article className="mt-4 rounded-sm border border-rule p-4">
            <h3 ref={reportRef} tabIndex={-1} className="font-display text-lg font-semibold">{open.name}</h3>
            <HarnessReport text={open.text} />
          </article>
        )}
      </section>

      <section aria-labelledby="harness-compare" className="mt-8">
        <h2 id="harness-compare" className="font-display text-xl font-semibold">เทียบผลสองรุ่น</h2>
        <div className="mt-2 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
          <label className="block">
            <span className="text-sm">รุ่น A</span>
            <select className={INPUT} value={a} onChange={(e) => setA(e.target.value)}>
              <option value="">เลือก</option>
              {results.map((r) => <option key={r.label} value={r.label}>{`${r.label} (${r.files} ไฟล์)`}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-sm">รุ่น B</span>
            <select className={INPUT} value={b} onChange={(e) => setB(e.target.value)}>
              <option value="">เลือก</option>
              {results.map((r) => <option key={r.label} value={r.label}>{`${r.label} (${r.files} ไฟล์)`}</option>)}
            </select>
          </label>
          <button type="button" className={BUTTON_GHOST} disabled={!a || !b || a === b} onClick={compare}>เทียบ</button>
        </div>
        {comparison && (
          <>
            <div className={TABLE_REGION}>
              <table className="w-full min-w-[36rem] border-collapse text-sm">
                <caption ref={compareRef} tabIndex={-1} className="px-3 py-2 text-left font-display font-semibold">
                  {`${comparison.a.label} (${comparison.a.runs} รอบ) เทียบกับ ${comparison.b.label} (${comparison.b.runs} รอบ)`}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className={TH}>ตัวชี้วัด</th>
                    <th scope="col" className={TH}>{comparison.a.label}</th>
                    <th scope="col" className={TH}>{comparison.b.label}</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.rows.map((r) => (
                    <tr key={r.metric}>
                      <th scope="row" className={`${TD} text-left font-normal`}>{r.metric}</th>
                      <td className={TD}>{r.a}</td>
                      <td className={TD}>{r.b}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 className="mt-4 font-display font-semibold">ผลลัพธ์หลักที่เปลี่ยน</h3>
            {comparison.verdict_changes.length === 0 ? <p className="text-sm text-muted">ไม่มี</p> : (
              <ul className="mt-1 list-disc pl-5 text-sm">{comparison.verdict_changes.map((v) => <li key={v}>{v}</li>)}</ul>
            )}
          </>
        )}
      </section>
    </section>
  );
}
```

`frontend/src/app/admin/(console)/harness/page.tsx`:

```tsx
import type { Metadata } from "next";
import { HarnessView } from "@/components/admin/harness-view";

export const metadata: Metadata = { title: "Harness · ผู้ดูแลระบบ" };

export default function AdminHarnessPage() {
  return <HarnessView />;
}
```

- [ ] **Step 5: Run the tests and the checks**

Run: `cd /d/MRA-plan-23c/frontend && npx vitest run src/lib/report-markdown.test.ts src/components/admin && npm run typecheck && npm run lint`
Expected: PASS. In the start test, a strata checkbox is reachable by name only through its label text: keep the text
`cv · 3 รีวิวที่มี frozen pool` inside the `<label>`. The report's tables and the runs table carry screen-reader captions
(`tables-caption.test.ts`); the compare table's caption is visible. The ceiling in the fixtures is $5
(`HARNESS_MAX_USD`), so the out-of-range message reads "$0.280 ถึง $5.00".

- [ ] **Step 6: Commit**

```bash
cd /d/MRA-plan-23c && git add frontend/src/lib/report-markdown.ts frontend/src/lib/report-markdown.test.ts \
  frontend/src/components/admin/harness-report.tsx frontend/src/components/admin/harness-view.tsx \
  frontend/src/components/admin/harness-view.test.tsx "frontend/src/app/admin/(console)/harness/page.tsx"
git commit -m "feat(admin-ui): harness page — availability, capped start with acknowledgement and confirm, progress and cancel, reports as safe elements, compare (Plan 23c)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: End-to-end flow for the three pages (Playwright, mocked admin API)

**Files:**
- Create: `frontend/e2e/admin-runtime.spec.ts`

**Interfaces:**
- Consumes:
  - the pages from Tasks 10–12;
  - the 23a/23b e2e conventions in `frontend/e2e/admin.spec.ts` and `frontend/e2e/admin-models.spec.ts`: a stateful mock with the CSRF check, `noSeriousA11y`, `noHorizontalScroll`, `document.fonts.ready`, and alerts scoped to `main`;
  - the fixtures from `src/test/admin-runtime-fixtures.ts`.

- [ ] **Step 1: Write the spec**

`frontend/e2e/admin-runtime.spec.ts` must cover:
1. **Settings:**
   - With the session cookie set, `/admin/settings` shows "ใช้เวอร์ชัน 2 จาก DB" and a worker line.
   - Change `max_queued_reviews` to 90, click "ตรวจ", then "บันทึกเป็นเวอร์ชันใหม่".
   - The mock records `{values: {max_queued_reviews: 90}, base_version: 2}`, answers 201 with version 3, and from then on serves version 3.
   - The notice "บันทึกเป็นเวอร์ชัน 3 แล้ว" has focus, and the worker line says it is changing to 3 (the mock's worker still reports 2), then matches once the mock's worker reports 3 on a later read (the page re-reads every 10 s while a worker lags; use `page.clock` or wait up to 12 s).
   - In "ประวัติ", restore version 1 through the in-page confirm ("ยืนยันย้อนกลับ"); the POST carries `base_version: 3`, and the history shows its notice.
2. **Settings 409:** a stale save gets 409. The alert in `main` says another admin saved first, the page shows the newer version in its header, the typed value stays, and the note "ร่างนี้แก้จากเวอร์ชัน 2 แต่ตอนนี้ใช้เวอร์ชัน N อยู่" offers "ทิ้งการแก้ไข" (in-page confirm) and "ใช้ร่างนี้ต่อจากเวอร์ชันล่าสุด"; after the latter, the next save carries `base_version: N`.
3. **Glossary:**
   - "เพิ่มคำ" focuses the new English cell. Type `mortality` / `อัตราการเสียชีวิต`, then "ตรวจ".
   - The mock's preview appears with its character count. "บันทึกเป็นเวอร์ชันใหม่" posts the three terms with `base_version: 4`.
4. **Harness, unavailable:** the state has `reasons: ["no_worker"]`. The page shows the reason with the profile command, and "เริ่มรัน harness" is disabled.
5. **Harness, start:**
   - The state is available. Tick `cv`, choose 1 round, and see the estimate "3 รอบ".
   - "เริ่มรัน harness" stays disabled until the acknowledgement is ticked. Then the in-page confirm.
   - The mock records exactly one POST `{max_usd: 1, repeats: 1, strata: ["cv"], max_reviews: null, compare_run: null, confirm: true}` with `X-MRA-Admin: 1`, answers 201, and from then on serves an active run.
   - The progress line appears, and within 6 s the page polls `/harness` again.
6. **Harness, report and compare:**
   - Open the baseline report. The table renders, `<script>` shows as text, and `page.locator("main script")` has count 0.
   - Compare the two results: the "Batch cost" row shows both values.
7. **Layout and accessibility matrix (light/dark × 1440/390):**
   - Run on `/admin/settings` (edit, history, and the 409 note), `/admin/glossary` (edit) and `/admin/harness` (with a report open and a comparison shown).
   - Assert there is no sideways scroll and that the page is axe-clean (serious and critical, WCAG 2 A/AA).
   - Wait for `document.fonts.ready` before measuring, and name each page and state in the failure message (`test.step`).
   - Mark the matrix `test.slow()`, as 23b's `admin-models.spec.ts` does: a dozen axe passes do not fit the default 30 s.

The harness state in the mock uses the fixtures (ceiling `5`, `HARNESS_MAX_USD`). Every negative check
(`toHaveCount(0)`, a disabled button) sits next to a positive one that proves the page rendered (23b's e2e review).

Use `page.route("**/api/v1/admin/**")` with the same stateful-mock style as `e2e/admin.spec.ts`:
- reject non-GET without `X-MRA-Admin: 1` with 403;
- answer 401 when not signed in;
- count harness POSTs and assert the count is exactly 1 at the end of test 5.

Copy the axe and layout helpers from `e2e/admin.spec.ts`.

- [ ] **Step 2: Run the spec**

Run: `cd /d/MRA-plan-23c/frontend && npx playwright test e2e/admin-runtime.spec.ts`
Expected: PASS. When axe or layout fails, fix the page and do not loosen the check. The settings tables, the term table
and the run and compare tables scroll inside their own regions (`TABLE_REGION`), so the page must not scroll sideways
at 390px.

- [ ] **Step 3: Run the whole e2e suite once**

Run: `cd /d/MRA-plan-23c/frontend && npm run e2e`
Expected: everything passes except the existing skipped live spec.

- [ ] **Step 4: Commit**

```bash
cd /d/MRA-plan-23c && git add frontend/e2e/admin-runtime.spec.ts
git commit -m "test(admin-ui): e2e settings, glossary and harness pages — save, 409, history restore, capped start with confirm, report and compare; axe and layout (Plan 23c)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(Add any page file you fixed to the same commit, and name it in the report.)

---

### Task 14: Carried from the 23b final review — unpriced models, an unreadable saved version, the borderline band

The 23b final review parked three items for 23c, none of which a 23c task above owns, so they get their own task:
- **M3:** validate warns when a role's model has no known price, because the review cost cap cannot count its calls (a
  direct Anthropic model missing from `PRICES_PER_MTOK`; an OpenRouter model missing from the catalog, which is counted
  only when OpenRouter reports the call's cost).
- **M6:** `GET /admin/llm-config` answers 500 when the newest saved version no longer parses (it was saved under looser
  rules, as the band below now makes possible). It answers 200 with the raw config and an `error` field instead, and the
  models page shows the error with the history, so the admin can still restore an older version or build a new one from
  llm.yaml. The same path answers a broken llm.yaml while no version exists (23b's deferred minor).
- **`harness.screen_borderline`:** the band was two unbounded ints; it is now `[low, high]` with `0 <= low <= high <= 100`
  (relevance runs 0–100, and the low end is also the screening relevance floor).

**Files:**
- Modify: `backend/app/services/llm_config.py` (`HarnessSpec._borderline_band`)
- Modify: `backend/app/services/llm_validate.py` (`unpriced_roles` and its warning)
- Modify: `backend/app/services/llm_store.py` (`newest_row`)
- Modify: `backend/app/api/admin_models.py` (`_unreadable`; `llm_config_state` answers it, and `"error": None` otherwise)
- Modify: `frontend/src/lib/admin-types.ts` (`LlmConfigState.error`), `frontend/src/components/admin/models-view.tsx`
- Test: `backend/tests/unit/test_admin_models_api.py`, `backend/tests/unit/test_llm_config.py`,
  `frontend/src/components/admin/models-view.test.tsx`

**Interfaces:**
- Consumes (23b): `PRICES_PER_MTOK` (`app.services.llm`), `CONFIG_ERRORS`, `config_error_text`, `load_effective`,
  `loaded_workers`, `ModelsHistory`.
- Produces: `unpriced_roles(resolved, catalog) -> list[str]`; `newest_row(session) -> LlmConfigVersion | None`;
  `GET /admin/llm-config` gains `error: str | null`; `LlmConfigState.error?: string | null`.
- Workers need no change: a stored version that no longer parses already makes `refresh_llms` keep the loaded models and
  report `llm_error`, and `init_llms` start on llm.yaml with the error reported.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/unit/test_admin_models_api.py` (it already imports `copy`, `LlmConfigVersion`, `MINIMAL`,
`admin_headers` and has the `fake_catalog` fixture, whose catalog lists `vendor/cheap` only):

```python
# --- Plan 23c: carried from the 23b final review ----------------------------------------------------------------

async def test_validate_warns_about_roles_whose_price_is_unknown(client, session_factory):
    h = await admin_headers(client, session_factory)
    draft = copy.deepcopy(MINIMAL)
    draft["providers"]["anthropic"] = {"api_key_env": "ANTHROPIC_API_KEY"}
    draft["presets"]["cheap"]["guard"] = {"model": "claude-unknown-9", "provider": "anthropic"}
    draft["presets"]["cheap"]["planner"] = {"model": "claude-haiku-4-5", "provider": "anthropic"}  # priced
    checked = (await client.post(f"{BASE}/llm-config/validate", json={"config": draft}, headers=h)).json()
    assert checked["ok"] is True
    unpriced = [w for w in checked["warnings"] if "no known price" in w]
    assert unpriced[0] == "cheap: no known price for guard: the review cost cap cannot count their calls"
    assert unpriced[1].startswith("better: no known price for guard, planner, screener")  # not in the catalog
    assert len(unpriced) == 2


async def test_state_shows_a_saved_version_that_no_longer_parses_and_restore_still_works(client, session_factory):
    h = await admin_headers(client, session_factory)
    good = (await client.post(f"{BASE}/llm-config", json={"config": MINIMAL, "base_version": None}, headers=h)).json()
    stale = {**MINIMAL, "harness": {"screen_borderline": [80, 20]}}  # saved under the rules before 23c
    async with session_factory() as s, s.begin():
        s.add(LlmConfigVersion(created_by="owner", source="edit", config=stale, changes={}))
    r = await client.get(f"{BASE}/llm-config", headers=h)
    assert r.status_code == 200
    state = r.json()
    assert (state["source"], state["version"], state["config"]) == ("db", good["id"] + 1, stale)
    assert "screen_borderline" in state["error"] and state["keys_present"] == {}
    restored = await client.post(f"{BASE}/llm-config/versions/{good['id']}/restore",
                                 json={"base_version": state["version"]}, headers=h)
    assert restored.status_code == 201
    assert (await client.get(f"{BASE}/llm-config", headers=h)).json()["error"] is None


async def test_state_with_a_broken_llm_yaml_and_no_version_answers_with_the_error(client, app, session_factory,
                                                                                 tmp_path, monkeypatch):
    h = await admin_headers(client, session_factory)
    broken = tmp_path / "llm.yaml"
    broken.write_text("presets: [unclosed", encoding="utf-8")
    monkeypatch.setattr(app.state.deps.service.settings, "llm_config_path", str(broken))
    r = await client.get(f"{BASE}/llm-config", headers=h)
    assert r.status_code == 200
    assert (r.json()["source"], r.json()["version"], r.json()["config"]) == ("file", None, {})
    assert "invalid YAML" in r.json()["error"]
```

Append to `backend/tests/unit/test_llm_config.py` (add `from pydantic import ValidationError` and `HarnessSpec` to its
imports; ruff wraps the `app.services.llm_config` import over several lines):

```python
@pytest.mark.parametrize("band", [(70, 35), (-1, 50), (40, 101), (10**9, 10**9)])
def test_screen_borderline_is_an_ordered_band_of_relevance_scores(band):
    with pytest.raises(ValidationError, match="screen_borderline"):
        HarnessSpec(screen_borderline=band)
    assert HarnessSpec(screen_borderline=(0, 100)).screen_borderline == (0, 100)
    assert HarnessSpec(screen_borderline=(50, 50)).screen_borderline == (50, 50)
```

Append to `frontend/src/components/admin/models-view.test.tsx`:

```tsx
describe("ModelsView with a configuration that no longer passes the checks", () => {
  it("says why and offers the history to restore or rebuild, with no editor", async () => {
    const unreadable = { ...STATE, version: 4, config: { active_preset: "cheap" } as LlmConfigDoc, keys_present: {},
      error: "version 4: harness.screen_borderline must be [low, high] with 0 <= low <= high <= 100" };
    mockAdminFetch(routes(unreadable));
    await renderAdmin(<ModelsView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("เวอร์ชัน 4 ที่ใช้อยู่ไม่ผ่านการตรวจตามกฎปัจจุบันแล้ว");
    expect(screen.getByRole("alert")).toHaveTextContent("screen_borderline");
    expect(screen.queryByRole("button", { name: "Presets" })).toBeNull();
    expect(screen.queryByRole("button", { name: "บันทึกเป็นเวอร์ชันใหม่" })).toBeNull();
    expect(await screen.findByRole("listitem", { name: /เวอร์ชัน 3/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "สร้างเวอร์ชันใหม่จาก llm.yaml" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd /d/MRA-plan-23c/backend && uv run pytest tests/unit/test_admin_models_api.py tests/unit/test_llm_config.py -q -k "price or no_longer_parses or broken_llm_yaml or screen_borderline"`
Expected: FAIL (no price warning, a 500 on the stale row, the band accepted).

- [ ] **Step 3: The band**

In `backend/app/services/llm_config.py`, add to `HarnessSpec` (after `extraction_chars`):

```python
    @field_validator("screen_borderline")
    @classmethod
    def _borderline_band(cls, value: tuple[int, int]) -> tuple[int, int]:
        # relevance scores run 0-100; the band's low end is also the screening relevance floor
        low, high = value
        if not 0 <= low <= high <= 100:
            raise ValueError("screen_borderline must be [low, high] with 0 <= low <= high <= 100")
        return value
```

No prompt or output schema changes, so `prompt_version` stays. `config/llm.yaml` (`[35, 70]`) and every test band pass.

- [ ] **Step 4: The price warning**

In `backend/app/services/llm_validate.py`, import `PRICES_PER_MTOK` next to `_api_key` and `ResolvedLLMConfig` from
`app.services.llm_config`, add:

```python
def unpriced_roles(resolved: ResolvedLLMConfig, catalog: dict[str, ModelInfo] | None) -> list[str]:
    """Roles whose calls the review cost cap cannot count (Plan 23c, carried from the 23b review): a direct Anthropic
    model missing from PRICES_PER_MTOK, or an OpenRouter model the catalog does not list (counted only when OpenRouter
    reports the call's cost). Without a catalog the OpenRouter check is skipped (validate already says so), and a
    local server (openai_compatible) is never flagged: it usually costs nothing."""
    return [name for name, role in resolved.roles.items()
            if (role.provider == "anthropic" and role.spec.model not in PRICES_PER_MTOK)
            or (role.provider == "openrouter" and catalog is not None and role.spec.model not in catalog)]
```

and in `_validate`'s loop over the presets, after the cost estimate:

```python
        if unpriced := unpriced_roles(resolved, catalog):
            warnings.append(f"{preset}: no known price for {', '.join(unpriced)}: the review cost cap cannot count "
                            "their calls")
```

- [ ] **Step 5: A readable state for an unreadable version**

In `backend/app/services/llm_store.py`, before `load_effective`:

```python
async def newest_row(session: AsyncSession) -> LlmConfigVersion | None:
    """The newest saved version as stored, unparsed: the console shows one that no longer passes validation."""
    return await _newest(session)
```

In `backend/app/api/admin_models.py`, import `newest_row` with the other `llm_store` names, add `_unreadable` above the
route, catch `CONFIG_ERRORS` around `load_effective`, and add `"error": None` to the normal answer:

```python
def _unreadable(settings, row, exc: BaseException, loaded: list) -> dict:
    """The state when the configuration in use no longer passes validation: the newest version was saved under older
    rules, or llm.yaml is broken while no version exists. It is shown as stored, with the error, and never as a 500,
    so the console can still restore an older version or build a new one from llm.yaml. Workers keep the models they
    loaded and report the same error."""
    raw = row.config if row is not None and isinstance(row.config, dict) else {}
    preset = raw.get("active_preset")
    return {"source": "db" if row is not None else "file", "version": row.id if row is not None else None,
            "config": raw, "active_preset": preset if isinstance(preset, str) else "",
            "env_preset": settings.llm_preset, "keys_present": {}, "loaded": loaded, "error": config_error_text(exc)}


@router.get("/admin/llm-config")
async def llm_config_state(deps: AppDeps = Depends(get_deps), _: Identity = Depends(require_admin)) -> dict:
    settings = deps.service.settings
    async with deps.session_factory() as session:
        try:
            effective = await load_effective(session, settings)
        except CONFIG_ERRORS as exc:
            row = await newest_row(session)
            return _unreadable(settings, row, exc, await loaded_workers(deps.redis))
    ...  # unchanged, and the answer gains "error": None
```

A database error is not in `CONFIG_ERRORS` and stays a 500, as before.

- [ ] **Step 6: The models page shows it**

In `frontend/src/lib/admin-types.ts`, add to `LlmConfigState`:

```ts
  /** Plan 23c: set when the configuration in use no longer passes validation (a version saved under older rules, or a
   * broken llm.yaml while no version exists). `config` is then as stored and `keys_present` is empty. */
  error?: string | null;
```

In `frontend/src/components/admin/models-view.tsx`:
- above `ModelsView`, add:

```tsx
/** The configuration in use no longer passes the checks (Plan 23c, carried from 23b): a version saved under older
 * rules, or a broken llm.yaml while no version exists. The page shows why and the history, never an editor. */
function unreadableText(s: LlmConfigState): string {
  return s.source === "db"
    ? `เวอร์ชัน ${s.version} ที่ใช้อยู่ไม่ผ่านการตรวจตามกฎปัจจุบันแล้ว (${s.error}) worker ใช้โมเดลที่โหลดไว้ก่อนหน้าต่อ ย้อนกลับไปเวอร์ชันอื่นหรือสร้างเวอร์ชันใหม่จาก llm.yaml ได้ที่ประวัติด้านล่าง`
    : `อ่าน llm.yaml ไม่ได้ (${s.error}) แก้ไฟล์แล้วโหลดหน้านี้ใหม่`;
}
```

- in `load`, a state with an error never becomes a draft (its config may lack `presets`, which the draft helpers read):
  `setEdit((e) => (s.error ? e : reconcile(e, s, saved, savedId)));`
- in the render, before the editor block, show the error and the history, and render the editor only without an error:

```tsx
      {state?.error && (
        <>
          <p role="alert" className="mt-4 rounded-sm bg-err-bg px-4 py-3">{unreadableText(state)}</p>
          <ModelsHistory base={state.version} onChanged={reload} writes={track} />
        </>
      )}
      {state && !state.error && edit && (
```

`ModelsHeader` is not rendered then: its key check reads `config.presets`.

- [ ] **Step 7: Run the tests**

Run: `cd /d/MRA-plan-23c/backend && uv run pytest tests/unit/test_admin_models_api.py tests/unit/test_llm_config.py tests/unit/test_model_catalog.py tests/unit/test_models_cli.py -q`
Run: `cd /d/MRA-plan-23c/frontend && npx vitest run src/components/admin/models-view.test.tsx && npm run typecheck && npm run lint`
Expected: PASS.

- [ ] **Step 8: Lint and commit**

```bash
cd /d/MRA-plan-23c/backend && uv run ruff check app tests
cd /d/MRA-plan-23c && git add backend/app/services/llm_config.py backend/app/services/llm_validate.py \
  backend/app/services/llm_store.py backend/app/api/admin_models.py backend/tests/unit/test_admin_models_api.py \
  backend/tests/unit/test_llm_config.py frontend/src/lib/admin-types.ts frontend/src/components/admin/models-view.tsx \
  frontend/src/components/admin/models-view.test.tsx
git commit -m "fix(models): warn about models with no known price, show a saved version that no longer parses instead of a 500, bound the screening borderline band (Plan 23c, carried from 23b)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Docs, final checks, then merge, docker and the smoke check

**Files:**
- Modify: `docs/api.md`:
  - a "Runtime settings, glossary and harness (Plan 23c)" subsection inside the Admin API section, after "Model
    management (Plan 23b)";
  - in "Model management (Plan 23b)": the price warning, the `error` field and the band (Task 14);
  - the limits note;
  - the cache note.
- Modify: `README.md` (one line under the admin console bullet)
- Modify: `.env.example` (a commented `HARNESS_MAX_USD=5` next to the cost settings)
- Modify: `docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md` (row 23: 23c done)
- After the merge, on master: root `CLAUDE.md`, by the crafted-blob method

**Steps 1–4 are for the implementer. Steps 5–7 are done by the controller after the final review.**

- [ ] **Step 1: `docs/api.md`**

- **Routes:** document the routes from spec section 5, checked against `backend/app/api/admin_runtime.py` and `admin_harness.py`:
  - methods, bodies, success and error codes;
  - `base_version` and 409;
  - the `{detail, errors}` shape of a document 422;
  - the start body with `confirm: true`;
  - the 503 `reasons` codes.
- **Behaviour:**
  - the 13 editable settings, with bounds, as a table;
  - everything else stays env-only, including `HARNESS_MAX_USD` (default $5);
  - API processes use a saved value within 5 s and workers at the next review or within 30 s; when a save answers
    `workers_notified: false`, the workers' DB poll still picks it up (and repairs the mirror the API reads) within 30 s;
  - an `llm_concurrency` change applies to reviews that start after the reload;
  - a changed rate limit starts counting afresh.
- **Glossary:**
  - the rules (term counts, lengths, characters, aliases, the rendered limit);
  - the seed is the built-in text and is used verbatim;
  - a saved glossary adds `+g{version}` to the cache key; results carry `glossary_version`.
- **Harness:**
  - the `harness` compose profile; one run at a time;
  - the cap rules (at least one review's own cap, at most the ceiling, never starting a review that does not fit, earlier spend counted on retry);
  - graceful cancel;
  - fixtures are mounted, never baked into the image.
- **Limits section:** under "Limits", say that the admin console can change these values at runtime and that
  `GET /api/v1/status → limits` always shows the values in force (within 5 s).
- **Cache:** in the description of the result cache, say that a saved glossary starts a new cache generation, and that settings never do.
- **Model management (23b section), carried items:** validate's warning "`<preset>`: no known price for `<roles>`" (a
  direct Anthropic model not in the price table, or an OpenRouter model the catalog does not list; local servers are
  not flagged); `GET /admin/llm-config`'s `error` (null normally; when the newest version or llm.yaml no longer passes
  validation the route answers 200 with the stored `config`, empty `keys_present` and the error, and the console offers
  restore and reset); `harness.screen_borderline` is `[low, high]` with `0 <= low <= high <= 100`.
- After editing, run `cd /d/MRA-plan-23c/backend && uv run pytest tests/unit/test_api_docs_limits.py -q`: it checks the
  limits and paper counts the document states.

- [ ] **Step 2: Other docs**

- **README:** under the admin console bullet, add "Settings, glossary and harness: change limits and the Thai glossary at `/admin/settings` and `/admin/glossary` (versioned, restorable, live within 30 seconds); read and compare Cochrane harness reports and start a capped run at `/admin/harness` (`docker compose --profile harness up -d harness`)."
- **Roadmap row 23:** append `**23c done (2026-10-13):** runtime settings and the Thai glossary as versioned documents read live by every process, and the harness page (reports, compare, capped runs on an opt-in worker, ceiling $5).`
- **`.env.example`:** after `MAX_COST_PER_REVIEW_USD`, add `# HARNESS_MAX_USD=5              # most a console harness run may be capped at (Plan 23c; env only)`.

- [ ] **Step 3: Commit**

```bash
cd /d/MRA-plan-23c && git add docs/api.md README.md .env.example docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md
git commit -m "docs(admin): settings, glossary and harness reference; limits are live in /status; roadmap 23c done (Plan 23c)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Final checks on the branch**

Run: `cd /d/MRA-plan-23c/backend && uv run pytest -q && uv run ruff check .`
Run the integration tests as in Task 1 (`MRA_INTEGRATION=1 uv run pytest -m integration -q` with Postgres up). Report
the result, or why they were not run.
Run: `cd /d/MRA-plan-23c/frontend && npm test && npm run typecheck && npm run lint`
Expected: all pass. The known flaky tests are allowed only when they pass alone; report them.

- [ ] **Step 5 (controller): Merge, then the CLAUDE.md line**

The whole-branch review comes first. The main worktree has the owner's uncommitted edits to `CLAUDE.md`,
`frontend/CLAUDE.md` and `infra/searxng/limiter.toml.new`; none may be staged or changed.

```bash
cd /d/MedicalReviewerAgent && git status --short   # expect only the owner's entries
git merge --no-ff plan-23c-settings-glossary-harness -m "Merge plan-23c-settings-glossary-harness: runtime settings, Thai glossary editor and the harness page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Then add the convention line to the committed `CLAUDE.md` only, by building a blob from `HEAD:CLAUDE.md`. Use the
session's scratchpad directory instead of `/tmp` when one is listed:

```bash
cd /d/MedicalReviewerAgent
git show HEAD:CLAUDE.md > /tmp/claude-md-head.txt
cat >> /tmp/claude-md-head.txt <<'EOF'
- Runtime settings, glossary and harness (Plan 23c): the 13 settings in `app/services/runtime_settings.py` `SPECS` and the Thai glossary are versioned documents in `config_versions` (`app/services/config_store.py`; secrets, URLs and `HARNESS_MAX_USD` stay env-only); API code reads settings through `ReviewService.effective()` (`RuntimeConfig`, 5 s cache, never `self.settings` for an editable value) and workers reload them with the 23b hook (`app/worker/runtime_reload.py`); with no glossary version the localizer prompt is byte-identical (sha256 pin in `tests/unit/test_glossary.py`) and a saved glossary adds `+g{version}` to the cache key; console harness runs go to the `arq:harness` queue (`app/worker/harness.py`, compose profile `harness`) under a typed USD cap enforced by `run_all(strict_cap=True)`.
EOF
BLOB=$(git hash-object -w /tmp/claude-md-head.txt)
git update-index --cacheinfo 100644,$BLOB,CLAUDE.md
git commit -m "docs(claude): runtime settings, glossary and harness convention line (Plan 23c)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git status --short   # still exactly the owner's entries; CLAUDE.md stays modified in the working tree
```

Check that `git show HEAD:CLAUDE.md | tail -2` ends with the new line, and that `git diff CLAUDE.md` still shows the
owner's own edits.

- [ ] **Step 6 (controller): Docker rebuild and the smoke check through Caddy, spending nothing**

```bash
cd /d/MedicalReviewerAgent && docker compose build migrate web && docker compose up -d
docker compose ps                    # api healthy, web and caddy up, migrate exited 0, no harness service
docker run --rm --entrypoint ls mra/backend:dev /app/evals/cochrane   # no fixtures or runs in the image
PW="smoke-$(openssl rand -hex 12)"
printf '%s\n' "$PW" | docker compose exec -T api python -m app.cli.admin create --username smoke --password-stdin
JAR="$(mktemp)"; B=http://localhost:8088/api/v1
W=(-b "$JAR" -H "X-MRA-Admin: 1" -H "Content-Type: application/json")
curl -s -o /dev/null -w "sign-in %{http_code}\n" -c "$JAR" -H "X-MRA-Admin: 1" -H "Content-Type: application/json" \
  -d "{\"username\":\"smoke\",\"password\":\"$PW\"}" $B/admin/session                                   # 204
curl -s -b "$JAR" $B/admin/settings | head -c 200; echo                                                # "source":"env"
curl -s -o /dev/null -w "save %{http_code}\n" "${W[@]}" \
  -d '{"values":{"sse_max_per_ip":6},"base_version":null,"note":"smoke"}' $B/admin/settings          # 201
sleep 6; curl -s $B/status | grep -o '"sse_max_per_ip":[0-9]*'                                         # :6
sleep 30; curl -s -b "$JAR" $B/admin/settings | grep -o '"settings":"[^"]*"'                           # each worker "1"
curl -s -o /dev/null -w "reset %{http_code}\n" "${W[@]}" -d '{"base_version":1}' $B/admin/settings/reset   # 201
sleep 6; curl -s $B/status | grep -o '"sse_max_per_ip":[0-9]*'                                         # :5
curl -s -b "$JAR" $B/admin/llm-config | grep -o '"error":null'                                         # "error":null (Task 14)
curl -s -b "$JAR" $B/admin/glossary | head -c 120; echo                                                # "source":"file"
curl -s "${W[@]}" -d '{"terms":[{"en":"placebo","th":"ยาหลอก"}]}' $B/admin/glossary/validate            # ok true, preview
curl -s -b "$JAR" $B/admin/harness | head -c 300; echo                                                 # reasons ["no_worker"]
docker compose --profile harness up -d harness && sleep 35
curl -s -b "$JAR" $B/admin/harness | grep -o '"available":[a-z]*\|"present":[0-9]*'                    # true, 60
curl -s -o /dev/null -w "over ceiling %{http_code}\n" "${W[@]}" \
  -d '{"max_usd":999,"repeats":1,"strata":[],"confirm":true}' $B/admin/harness/runs                     # 422
curl -s -o /dev/null -w "no confirm %{http_code}\n" "${W[@]}" \
  -d '{"max_usd":1,"repeats":1,"strata":[],"confirm":false}' $B/admin/harness/runs                      # 422
curl -s -b "$JAR" $B/admin/harness/runs                                                                # {"items":[],...}
curl -s -b "$JAR" $B/admin/harness/reports | grep -o '"name":"[^"]*"'                                   # the two 22a reports
curl -s -b "$JAR" "$B/admin/harness/compare?a=2026-10-11.1/pilot&b=2026-10-11.1/baseline" | head -c 300; echo   # rows
docker compose --profile harness stop harness
docker compose exec -T api python -m app.cli.admin disable smoke
rm -f "$JAR"
```

Expected: the results in the comments. Report each one exactly.
- The smoke check never saves a glossary, so the seed state (and today's cache keys) stays.
- The two settings rows it leaves (version 1, and version 2 from the reset, with no overrides) read every value from env,
  change no cache key and hide no later env edit (overrides are sparse). Unlike 23b's LLM versions, which had to be
  deleted after its smoke check so llm.yaml stayed the source, they can stay; the audit rows stay too.
- It never posts a start that could pass.
- When a result differs, stop and investigate before telling the owner 23c is ready.

- [ ] **Step 7 (controller): Clean up and record**

- Remove the worktree with `git worktree remove ../MRA-plan-23c`, and keep the branch.
- Update the memory notes (a `plan-23c-state.md`, or extend the 23a/23b state note) and the `MEMORY.md` index. Record:
  - 23c merged;
  - the harness worker is opt-in (`--profile harness`), and the ceiling is `HARNESS_MAX_USD` = $5;
  - the smoke admin was disabled;
  - ThaiJO (Plan 24) is next.
