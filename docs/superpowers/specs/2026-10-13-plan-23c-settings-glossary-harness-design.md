# Plan 23c: admin console settings, glossary and harness — design (2026-10-13)

**สรุปภาษาไทย:** Plan 23c เพิ่มสามหน้าใน admin console หน้า `/admin/settings` แก้ค่าที่ใช้ระหว่างทำงานได้ 13 ค่า ได้แก่
อัตราจำกัด, คิว, เพดานต่อวัน, งบต่อรีวิว, จำนวน LLM call พร้อมกัน, จำนวน event stream ต่อ client และอายุ cache ทุกครั้งที่
บันทึกจะเป็นเวอร์ชันใหม่ใน DB ย้อนกลับได้ และบันทึกลง audit ค่าใน env ยังเป็นค่าตั้งต้นของทุกค่าที่ไม่ได้ตั้ง API อ่านค่าใหม่ภายใน
5 วินาที (`/status` แสดงค่าจริงเสมอ) และ worker ใช้ตอนเริ่มรีวิวถัดไปหรือภายใน 30 วินาที ค่าลับ, URL และค่าด้านความปลอดภัย
ยังอยู่ใน env เท่านั้น หน้า `/admin/glossary` แก้อภิธานศัพท์ไทยเป็นตาราง มีประวัติและย้อนกลับได้ `localize` ใช้อภิธานศัพท์ที่
ใช้งานอยู่ โดยรีวิวหนึ่งใช้ชุดเดียวตลอด ตราบที่ยังไม่บันทึกเวอร์ชันใด prompt ยังเหมือนเดิมทุกตัวอักษร และการบันทึกอภิธานศัพท์ทำให้
cache ผลรีวิวเริ่มรุ่นใหม่ หน้า `/admin/harness` แสดงรายงาน 22a, เทียบผลสองรุ่น และมีปุ่มเริ่มรัน harness ซึ่งเป็น arq job
บน worker แยกที่ต้องเปิดเอง (`docker compose --profile harness`) ผู้ดูแลต้องพิมพ์งบเป็น USD เอง ระบบมีเพดานจาก env (ค่าตั้งต้น
$5) และจะไม่เริ่มรีวิวที่งบของตัวเองเกินยอดที่เหลือ รันได้ทีละหนึ่ง และไม่มีอะไรใน 23c ที่ใช้เงินจริงเองโดยอัตโนมัติ หน้าตั้งค่าและ
อภิธานศัพท์ใช้กติกาเดียวกับหน้าโมเดลของ 23b (ร่างจำเวอร์ชันฐาน, 409 ไม่ทิ้งร่าง, ติดตาม worker หลังบันทึก) และ 23c ปิดงานค้างจาก
23b สามข้อ: เตือนโมเดลที่ไม่รู้ราคา, หน้าโมเดลไม่ 500 เมื่อเวอร์ชันล่าสุดอ่านไม่ผ่านแล้ว และจำกัดช่วง `screen_borderline`

Context: `docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md` section 6b (23c). Plan 23a (sign-in, audit,
`require_admin`) is merged. Plan 23b (model management: `llm_store`, the worker reload hook, hardened admin document
parsing) is merged (master `fdb7ec5`), and 23c builds on its modules as merged, including the changes its reviews made:
the worker poll that reads the DB and repairs Redis (`reconcile_version_key`), the shared catalog cache with the
worker's one-attempt loader, `workers_notified` in write answers, and the models page's draft, 409 and worker-polling
rules. The owner told Claude to run the roadmap plans end to end without waiting for approval, so Claude made the
decisions in section 2.

## 1. Goal and success

The owner tunes the service's limits, the Thai glossary and the quality harness from the admin console, sees what each
change does before saving it, can undo it, and never edits a file or restarts a container to do so. Nothing in the
console spends money unless the owner starts a harness run with a cap they typed.

**Success for 23c:**
- `/admin/settings` lists the 13 editable settings with their env default, the value in force and where each one
  applies. A save is validated, becomes a new version, is audited and can be restored. "กลับไปใช้ค่า env" appends a
  version with no overrides.
- Every API process uses a saved value within 5 seconds, `GET /api/v1/status` reports the values in force, and every
  worker uses them at its next job start or within 30 seconds, with no restart.
- `/admin/glossary` edits the Thai terms (English term and aliases, Thai term, abbreviation, note), validates them,
  shows the rendered prompt text and its length, and keeps a history with restore and "กลับไปใช้อภิธานศัพท์ตั้งต้น".
- The localizer uses the active glossary. A review uses one glossary from start to finish. While no glossary version
  exists, the localizer prompt is byte-identical to the one before 23c and the cache key does not change.
- A saved glossary makes a repeated topic run again instead of returning a result translated with the old terms.
- The 22a glossary metric scores each run against the glossary that run used, and run records say which one it was.
- `/admin/harness` lists the 22a reports and renders them safely, compares two runs metric by metric, shows the
  console's harness runs with progress, and starts a run with an explicit USD cap. Without fixtures, without the
  harness worker, in stub mode or while another run is active, the start button is disabled and the page says why.

**Out of scope:**
- Settings that need a restart (`MAX_CONCURRENT_REVIEWS_PER_WORKER`, pool sizes), secrets, URLs, proxy trust, CORS,
  Turnstile, salts, admin sign-in rules and provider keys. They stay env-only.
- The frontend report glossary (`frontend/src/lib/term-names.ts`): it names terms in the UI and is not the localizer's
  glossary.
- Enforcing glossary terms inside `localize` (Plan 28), editing the manifest, `select` or `freeze` from the console, and
  scheduled harness runs.
- A Thai or fine-tuned model (the roadmap rules it out).

## 2. Decisions (Claude, on the owner's standing instruction, 2026-10-13)

| Topic | Decision |
|---|---|
| Editable settings | A fixed list of 13 (section 4.2), each with a type, bounds and its env default. Nothing that needs a restart or is security-sensitive is editable. `HARNESS_MAX_USD` is env-only, so the console cannot raise its own spending ceiling |
| Storage | One table, `config_versions`, for both documents (`kind` = `settings` or `glossary`) with a version number per kind. It is separate from 23b's `llm_config_versions`, which stays as merged (its ids are its versions, and its rows hold a whole llm.yaml). One generic store module (`config_store`) follows the 23b rules: linear versions, `base_version` 409, Postgres advisory lock (its own key), audit in the same transaction, restore and reset append copies, a mirror that only moves forward |
| Settings document | Sparse overrides `{values: {name: value}}`. Names not in it fall back to env, so an env change still applies to them. Reset appends `{values: {}}` |
| Reading settings | The API reads a Redis mirror (`mra:settings:active`, JSON with the version and the values) and caches it in each process for 5 s. On a Redis miss or error it reads the DB; if that fails too, it keeps the last known values, or env when it has none. Never a 500. A stored value that no longer validates is skipped with a log line |
| Workers | They extend the 23b hook with its rules: a job start compares the settings and glossary mirrors with what the worker loaded; the 30-second poll reads the DB instead and repairs the mirrors (`reconcile_mirror`, the rules of 23b's `reconcile_version_key`), so a save whose publish failed still reaches every worker and API process within 30 s. On a change they rebuild the graph deps (settings, glossary) under 23b's `llm_lock`. A running review keeps the graph it started with. A poll that finds a worker already on the DB's versions clears a stale `runtime_error` |
| `LLM_CONCURRENCY` | A change gives reviews started after the reload a new per-process semaphore, and their LLMs are rebuilt on it. Reviews already running keep the old one, so for a short while one process may run up to old + new calls. Stated in the UI and the docs |
| Cache key | Settings never enter it. The glossary does: `{prompt_version}+llm{id}` gains `+g{version}` only when a glossary version exists, so the seed state keeps today's keys |
| Glossary seed | The built-in `GLOSSARY["th"]` text stays the seed and is used verbatim while no version exists (pinned by the sha256 of `localize_system("th")`). A saved version renders as `en = th (ABBR)` joined by `"; "`. `prompt_version` is not bumped: no prompt text changes until the owner saves |
| Glossary rules | 1–200 terms. `en` ≤ 120 characters, with `/` between aliases. `th` ≤ 120 and must contain Thai script. `abbr` ≤ 24, `note` ≤ 300; the note is never sent to the model. No `;` or `=` in `en`, `th` or `abbr`, and no brackets in `th` or `abbr`. No control characters, NUL or lone surrogates (`has_bad_text` from 23b). An English alias may appear only once (case-insensitive). The rendered text is at most 4000 characters. Two terms sharing a Thai term only warn |
| One review, one glossary | The glossary is part of the graph deps, so a review keeps the glossary it started with (same rule as 23b's models). Results record `glossary_version` |
| Harness metric | Run records carry the glossary label and text, and the metric parses that text. Records from before 23c fall back to the built-in terms |
| Harness execution | A dedicated arq queue (`arq:harness`) and worker (`app.worker.harness.HarnessWorkerSettings`, `max_jobs` 1, 12-hour job timeout), as a compose service behind the `harness` profile. Off by default; review capacity is untouched |
| Harness money | The owner types the cap. It must cover at least one review's own cap and stay within `HARNESS_MAX_USD` (env, default $5). The form defaults to $1.00, and `confirm: true` is required. The batch never starts a review whose own cap does not fit in what is left. A retried job counts what earlier attempts spent, read from the run files. Harness spend is not added to the public daily budget |
| `HARNESS_MAX_USD` default | HARNESS_MAX_USD defaults to $5, matching the owner's earlier eval budget cap (2026-10-12). |
| One at a time | A nullable `active` column (1 while queued or running) with a unique index. A second start gets 409 |
| Cancel | Graceful: the run stops before its next review, and the review in flight finishes within its own cap. A queued run is cancelled at once. Cancel also clears a stuck row |
| Fixtures in containers | `backend/.dockerignore` keeps `evals/cochrane/fixtures`, `runs` and `*.bak` out of images (third-party abstracts). The API mounts `./backend/evals/cochrane` read-only; the harness service mounts it read-write. No fixtures means the button is disabled |
| Effective config for runs | A console run uses the effective LLM config (23b), settings and glossary, and records their labels on the run row. It builds its models with the catalog the API and review workers share (23b's `cached_catalog` with the worker's one-attempt loader), so structured-output methods and prices match production. A run whose worker has a different `prompt_version` than the one it was started for stops with an error before spending |
| Reports in the browser | No new dependency. The report Markdown is parsed into headings, paragraphs, lists and tables in TypeScript and rendered as React elements, never as HTML |
| Compare | Computed from the run files (`aggregate` + the report's summary rows) in a thread, so the API never blocks. A run whose files are missing gives 404 |
| Errors | Validation errors are `{field, message}` lists whose messages name fields (`max_queued_reviews`, `terms.3.th`) and never echo submitted text, so a lone surrogate cannot break the response |
| Settings and glossary pages | They follow the models page (23b `ModelsView`) instead of a model of their own, and its helpers move to shared modules: a draft keeps the version it was loaded from and saves on it; a read replaces a draft without edits and keeps one with edits; a 409 re-reads, keeps the draft and offers "ทิ้งการแก้ไข" (confirmed) or "ใช้ร่างนี้ต่อจากเวอร์ชันล่าสุด"; after a write the page re-reads every 10 s while a worker lags (at most 2 minutes), shows a lagging worker as "changing" for 60 s, and marks a worker silent for over 2 minutes; restore and reset say so in the history, with `WORKERS_NOT_NOTIFIED` when Redis was not told |
| Carried from 23b | Three items the 23b final review parked for 23c: validate warns when a role's model has no known price (a direct Anthropic model missing from the price table, an OpenRouter model the catalog does not list); `GET /admin/llm-config` answers 200 with the stored config and an `error` field, not 500, when the newest version (or llm.yaml while no version exists) no longer parses, and the models page shows it with the history; `harness.screen_borderline` is bounded to `0 <= low <= high <= 100` |
| Migration tests | A migration test pins its downgrade target to a named revision, never `"-1"`, as 23a's and 23b's do |

## 3. Data model

One Alembic migration adds two tables.

**`config_versions`**:
- `id` integer primary key (autoincrement)
- `kind` varchar(16): `settings` or `glossary`
- `version` integer: 1, 2, … per kind; unique together with `kind`
- `created_at` timestamptz, `created_by` varchar(64), `note` text nullable (≤ 500 characters)
- `source` varchar(16): `edit`, `restore` or `reset`
- `restored_from` integer nullable (a version of the same kind)
- `document` JSONB: `{values: {...}}` for settings, `{terms: [{en, th, abbr, note}]}` for the glossary, already
  validated and normalised
- `changes` JSONB: the summary against the version before it

The application never updates or deletes a row.

**`harness_runs`**:
- `id` integer primary key; `run_id` varchar(64), unique (`console-YYYYMMDD-HHMMSS-xxxx`, UTC plus 4 random hex
  digits, the folder under `runs/<prompt_version>/`)
- `prompt_version` varchar(32)
- `status` varchar(16): `queued`, `running`, `done`, `stopped` (the cap was reached), `cancelled` or `error`
- `active` integer nullable, unique: 1 while queued or running, NULL afterwards
- `max_usd`, `spent_usd` float
- `repeats`, `planned`, `done`, `failed`, `skipped` integer
- `strata` JSONB (a list; empty means all), `max_reviews` integer nullable, `compare_run` varchar(129) nullable
- `created_by` varchar(64), `created_at`, `started_at`, `finished_at`
- `error` text nullable, `report` varchar(160) nullable (the report file name)
- `config` JSONB: `{llm_config, settings_version, glossary}`, the labels the run used

## 4. Backend

### 4.1 Versioned documents (`app/services/config_store.py`)
- `DocKind(name, redis_key, validate, summarize, seed, mirror)`. `validate(raw, settings)` returns
  `(document, warnings)` or raises `DocumentError(errors)`.
- `newest`, `save_version` (validate, check JSON storability, advisory lock, `base_version` check, insert, audit row
  `<kind>.save|restore|reset`), `restore_version`, `reset_to_seed`, `list_versions`, `get_version` and `version_out`.
- `publish(redis, kind, row) -> bool` raises the mirror monotonically (WATCH/MULTI, as 23b's `publish_version`). False
  means Redis could not be updated; the save stands.
- `reconcile_mirror(redis, session_factory, kind) -> int | None` makes the mirror agree with the DB and returns the DB's
  newest version: a missing or lower mirror is republished, a higher one set back, or deleted while the kind is empty
  (the rules of 23b's `reconcile_version_key`). The workers' poll calls it.
- `read_active(session_factory, redis, kind) -> Active(version, mirror)` reads Redis first and the DB on a miss or an
  error, refilling Redis with `SET NX`. While a kind is empty, it returns its seed without caching it.

### 4.2 Runtime settings (`app/services/runtime_settings.py`)

| Name | Type | Bounds | Applies |
|---|---|---|---|
| `review_rate_limit`, `api_key_rate_limit`, `paper_search_rate_limit` | rate (`N/second\|minute\|hour\|day`, N 1–99999) | | API |
| `sse_max_per_ip` | int | 1–50 | API |
| `max_queued_reviews` | int | 1–1000 | API |
| `max_reviews_per_day` | int | 1–100000 | API |
| `max_usd_per_day` | float | 0.1–1000 | API |
| `review_cost_base_usd` | float | 0–1 | API and worker |
| `review_cost_per_paper_usd` | float | 0–0.1 | API and worker |
| `review_cost_per_candidate_usd` | float | 0–0.01 | API and worker |
| `max_cost_per_review_usd` | float | 0.05–5 | API and worker |
| `llm_concurrency` | int | 1–64 | worker |
| `result_cache_ttl_seconds` | int | 0–2592000 | API |

- **Validation:** unknown names and out-of-range values are errors. `max_usd_per_day` below the worst-case per-review
  cap is also an error, because no review could be admitted. Warnings cover a daily budget that holds fewer than five
  worst-case reviews and the `llm_concurrency` reload rule.
- **Applying:** `apply_overrides(base, values)` returns `base.model_copy(update=...)` and skips anything that no longer
  validates.
- **`budget.worst_case_review_cap(settings)`:** the largest cap any request can get. Capacity and validation share it.
- **Rate counters:** a changed rate limit starts counting afresh, because the limits library keys each window by its
  rate.

### 4.3 Propagation
- **`app/services/runtime_config.py`:**
  - `RuntimeConfig(base, session_factory, redis, ttl=5)` serves `settings()`, `settings_version()` and
    `glossary_label()` from one cached read of both mirrors. An `asyncio.Lock` coalesces refreshes, and `invalidate()`
    is called by the saving process.
  - `load_runtime(session_factory, base) -> Runtime(settings, settings_version, glossary)` reads the DB directly. The
    worker, the harness job and the eval CLI use it.
- **API surfaces:**
  - `AppDeps.runtime` holds the provider. `ReviewService.effective()` returns the settings in force.
  - Review creation reads from it: rate limits, cost cap, cache TTL and the capacity check (`Capacity.check(...,
    settings=)`). So do `/status`, the SSE slot limit, the paper-search limit (REST and MCP) and the admin dashboard's
    capacity block.
  - Env-only values (salts, Turnstile, `prompt_version`) still come from the base settings.
- **Workers (`app/worker/runtime_reload.py`):**
  - At startup, `init_runtime` loads the effective settings and glossary before `init_llms`, so the semaphore has the
    configured size.
  - `refresh_runtime(ctx, poll=False)` runs at each job start (it trusts the mirrors) and, with `poll=True`, on the poller
    before 23b's `refresh_llms(ctx, poll=True)` (it reads the DB through `reconcile_mirror`). It rebuilds the deps
    (`settings`, `glossary`, and the LLMs with a new semaphore when `llm_concurrency` changed, on the catalog they were
    built with) and the graph. In stub mode there are no LLMs to rebuild.
  - A failure keeps the old state and reports `runtime_error`; the next poll retries, and a poll that finds the worker on
    the DB's versions clears an error that no longer applies.
  - Each worker's entry in `mra:llm:loaded` also carries `settings`, `glossary` and `runtime_error`.
  - 23b's `llm_reload` keeps `ctx["llm_resolved"]` and `ctx["llm_sem_size"]`, and passes the glossary to the deps.

### 4.4 Glossary
- **`app/harness/glossary.py` (pure):**
  - `ActiveGlossary(version, text)` with `.label` (`file` or the version).
  - `SEED_GLOSSARY` (the built-in text, verbatim), `seed_document()`, `render_glossary(terms)` and `glossary_of(deps)`.
- **`app/services/glossary_store.py`:** `validate_glossary`, `summarize_glossary` (terms added, removed and changed),
  `GLOSSARY_KIND` (mirror: version only) and `active_glossary_from(row)`.
- **`localize`:** `localize_system(language, glossary=None)` and `localize_strings(..., glossary=None)` use the given
  text for Thai. The three call sites pass `glossary_of(deps).text`. `GraphDeps.glossary` and `build_graph_deps(...,
  glossary=)` carry it, and `finalize` records `result.glossary_version`.

### 4.5 Result cache
`ReviewService.create` builds the version as `prompt_version`, then `+llm{id}` (23b), then `+g{version}` when a
glossary version exists. Settings are operational and never part of the key.

### 4.6 Harness runs (`app/services/harness_runs.py`, `app/evals/results.py`)
- **`harness_state`:** availability with reason codes (`no_manifest`, `no_fixtures`, `no_worker`, `stub_mode`,
  `active_run`), the strata with their selected and frozen counts, the worker heartbeat, the ceiling, the default cap,
  the per-review cap of the selection, the typical cost per review from the last finished console run, and the active
  run.
- **`start_run`:**
  - checks availability, the strata, that the selection is not empty, that the cap is at least the per-review cap and
    at most the ceiling, and that `compare_run` exists;
  - inserts the row (`active` = 1) with its `harness.start` audit row;
  - after the commit the route enqueues `run_harness` on `arq:harness`, and an enqueue failure marks the row `error`.
- **`cancel_run`:** sets `cancelled` and clears `active` (audit `harness.cancel`).
- **Job-side transitions:** `claim` (queued → running; a running row on retry continues), `progress`, `is_cancelled`,
  `finish` (never overwrites `cancelled`) and `requeue` (a shutdown puts a running row back to queued).
- **`app/evals/results.py`:**
  - `load_rows` and `write_report` move here from the CLI.
  - `list_reports` and `read_report` refuse any name outside `^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.md$`, symlinks, files
    outside `reports/` and files over 1 MB.
  - Also `list_results`, `compare_results(a, b)` and `prior_spend(pv, run_id)`.
- **`run_all` options:** `strict_cap` (do not start a review unless `spent + its cap ≤ max_usd`), `spent_before`,
  `on_record` and `should_stop`. The CLI keeps its old behaviour by default.

### 4.7 Harness worker (`app/worker/harness.py`)
- **Startup:** settings, DB, Redis, an HTTP client and a heartbeat (`mra:harness:worker`, written every 30 s with a
  90 s TTL).
- **`run_harness(ctx, run_pk)`:**
  - claims the row and builds eval deps from the effective LLM config, settings and glossary and the shared catalog
    (`openalex` and `mcp` off, as in the CLI), recording their labels on the row;
  - refuses a `prompt_version` mismatch;
  - runs `run_all(strict_cap=True, spent_before=prior_spend(...))`, updating the row after each record and checking
    for cancellation before each review;
  - writes the report (with `compare_run` when set), then finishes as `done`, `stopped`, `cancelled` or `error`.
- **Shutdown:** a running row goes back to queued and arq retries the job (`max_tries` 3). It resumes, because
  existing run files are skipped.

### 4.8 Docker
- `backend/.dockerignore`: add `evals/cochrane/fixtures`, `evals/cochrane/runs` and `evals/cochrane/*.bak`.
- `api`: add `./backend/evals/cochrane:/app/evals/cochrane:ro`.
- New `harness` service: the backend image, command `arq app.worker.harness.HarnessWorkerSettings`, `profiles:
  ["harness"]`, the same env file, volumes `./backend/config:/app/config:ro` and
  `./backend/evals/cochrane:/app/evals/cochrane`, networks `data` and `search`.

## 5. Admin API

All routes are under `/api/v1/admin` and need `require_admin`. They are hidden from OpenAPI, and every change writes
an audit row in its transaction (cookie + `X-MRA-Admin: 1`, or an admin key, as in 23a).

| Method and path | What it does |
|---|---|
| `GET /settings` | `{source: db\|env, version, values (in force), overrides, env, specs: [{name, kind, group, applies, min, max}], worst_case_review_usd, loaded}` |
| `GET /settings/versions?before=&limit=` | Newest first: `{items: [{version, kind, created_at, created_by, note, source, restored_from, changes}], next}` |
| `GET /settings/versions/{version}` | The version with its `document` |
| `POST /settings/validate` | Body `{values}` → `{ok, errors: [{field, message}], warnings, values (in force) \| null, worst_case_review_usd}`; nothing saved |
| `POST /settings` | `{values, base_version, note?}` → 201 the version plus `workers_notified`; 409 stale base; 422 `{detail, errors}` |
| `POST /settings/versions/{version}/restore` | `{base_version, note?}` → 201 |
| `POST /settings/reset` | `{base_version, note?}` → 201, a version with no overrides |
| `GET /glossary` | `{source: db\|file, version, terms, chars, max_chars, loaded}` |
| `GET /glossary/versions`, `GET /glossary/versions/{version}` | As for settings |
| `POST /glossary/validate` | Body `{terms}` → `{ok, errors, warnings, preview, chars}` |
| `POST /glossary`, `POST /glossary/versions/{version}/restore`, `POST /glossary/reset` | As for settings; reset appends the built-in terms |
| `GET /harness` | The availability and selection state (4.6) |
| `GET /harness/runs?before=&limit=`, `GET /harness/runs/{id}` | Console runs, newest first |
| `POST /harness/runs` | `{max_usd, repeats (1–2), strata, max_reviews?, compare_run?, confirm: true}` → 201; 409 when a run is active; 422 for a bad cap, unknown strata, an empty selection or a missing comparison; 503 `{detail, reasons}` when unavailable |
| `POST /harness/runs/{id}/cancel` | 200 the run; 409 when it is not active |
| `GET /harness/reports`, `GET /harness/reports/{name}` | `[{name, prompt_version, run_id, size, modified_at}]`; `{name, text}`; 404 for an unknown or refused name |
| `GET /harness/results` | Run folders: `[{label, prompt_version, run_id, files, modified_at}]` |
| `GET /harness/compare?a=PV/RUN&b=PV/RUN` | `{a: {label, runs}, b: {label, runs}, rows: [{metric, a, b}], verdict_changes}`; 404 when a run has no files; 422 for a bad label |

Changes to 23b's model routes (carried items): `POST /llm-config/validate` adds the warning "`<preset>`: no known price
for `<roles>`: the review cost cap cannot count their calls"; `GET /llm-config` gains `error` (null normally; when the
configuration in use no longer passes validation, a 200 with the stored `config`, empty `keys_present` and the error).

## 6. Frontend

The admin nav gains "ตั้งค่า", "อภิธานศัพท์" and "Harness" after "โมเดล". The pages follow the 23a/23b patterns:
`useAdmin().fail`, page notices with focus after actions, `ConfirmButton` for restore, reset, cancel and start, the
`ui.ts` classes, Thai labels with English technical terms, effects that set state only in promise callbacks, and no
`confirm()`.

The settings and glossary pages share the models page's rules (section 2, "Settings and glossary pages"), through
helpers moved out of `ModelsView`: `useWorkerFollowUp`, `useVersionedPage`, `DraftStatus`, `VersionHistory` and
`WorkerVersions`.

- **`/admin/settings`:**
  - Header: "ใช้เวอร์ชัน N จาก DB" or "ใช้ค่าจาก env", and each worker's settings version and `runtime_error` (a
    warning tint, with words, when a worker differs after the page's write has settled, failed to reload, or has not
    reported for over 2 minutes; "changing" while it settles).
  - One table per group (อัตราจำกัด, ความจุ, งบค่าใช้จ่าย, Worker, Cache). Each row has the Thai label with the setting
    name in the code face, the env value, the value in force, a "ตั้งค่าเอง" checkbox with its input, and where it
    applies.
  - "ตรวจ" shows field errors beside their inputs, the warnings, and the worst-case per-review cap against the daily
    budget. "บันทึกเป็นเวอร์ชันใหม่" saves with an optional note.
  - A 409 says another admin saved first, re-reads, and keeps the draft on its old base; the page then offers
    "ทิ้งการแก้ไข" (confirmed in the page) or "ใช้ร่างนี้ต่อจากเวอร์ชันล่าสุด", as the models page does.
  - A history tab, shared with the glossary page: restore, and reset once a version exists.
- **`/admin/glossary`:**
  - Header as above.
  - A term table (English and aliases, Thai, abbreviation, note) with add and remove row, a search filter, and
    "ยกเลิกการแก้ไข".
  - "ตรวจ" shows cell errors, warnings and the rendered text with its length and limit. Save, 409 and history as for
    settings.
  - A note that saving starts a new cache generation.
- **`/admin/harness`:**
  - Status block: available, or the reasons in Thai with the profile command; the worker; fixtures; the active run's
    progress (done, failed and planned; spent against the cap), polled every 5 s while active, with a confirmed
    cancel.
  - Start form: strata checkboxes, repeats 1 or 2, an optional "ไม่เกิน N รีวิว", an optional comparison run and the
    cap input (min = per-review cap, max = ceiling, default $1.00). An estimate shows the planned runs, the worst case
    and the typical cost when known.
  - The start button needs a ticked "เข้าใจว่าการรันนี้เรียกโมเดลจริงและเสียเงินจริง" and an in-page confirm.
  - The console's runs, the report list with the selected report rendered by the safe Markdown subset, and the
    compare panel (two selects and a metric table).

No new frontend dependency.

## 7. CLI and evals

- `app.cli.eval run` uses the effective settings and glossary from the DB, next to 23b's effective LLM config, read in
  the same step of 23b's `eval_main` and through one database engine. `--config-file` means "no DB": `llm.yaml`, env
  settings and the built-in glossary.
- `RunRecord` gains `glossary` (label) and `glossary_text`, next to 23b's `llm_config`. The report's header line names
  the LLM config and the glossary, and a batch mixing either is flagged MIXED (23b's check for `llm_config` moves with
  `load_rows` into `app/evals/results.py`).
- `report` uses `results.write_report`.

## 8. Testing

Backend unit tests (sqlite and fakeredis; no real provider, no network):
- **Store:** versions per kind, the 409, restore, reset, audit rows, the monotonic publish, `read_active` with Redis
  hit, miss and down.
- **Settings:** coercion and bounds, unknown names, the daily-budget rule, the never-echo rule, `apply_overrides`
  skipping bad stored values.
- **`RuntimeConfig`:** TTL, invalidate, Redis down, DB down.
- **API surfaces:** live rate limits, queue cap, SSE limit, cache TTL and `/status` after a publish.
- **Glossary:** validation cases, the seed sha256 pin, the localize prompt with a saved glossary, nodes passing deps'
  glossary, `result.glossary_version`, and the cache key with and without `+g`.
- **Worker reload:** no change means no rebuild; a settings change rebuilds deps; a concurrency change gives a new
  semaphore while the old graph keeps the old one; a failure keeps the state and reports it; a poll picks up a version
  whose publish was lost, follows an emptied table back to env, and clears a stale error; stub mode; the heartbeat keeps
  23b's fields.
- **Routes:** each route, CSRF and `require_admin`, 409 and 422 shapes, hidden from OpenAPI.
- **Eval:** the metric uses the run's glossary; `run_all` with a strict cap, `spent_before`, `should_stop` and
  `on_record`.
- **Harness:**
  - availability reasons, start rules (ceiling, the per-review minimum, `confirm`, one active, an empty selection);
  - cancel; report-name refusals (`../`, absolute paths, symlinks, over 1 MB); compare;
  - the job with a fake `run_all` (claim, progress, cancel, stop, error, requeue, the `prompt_version` mismatch).
- **Carried from 23b:** the unpriced-model warning, `/admin/llm-config` with a stored version that no longer parses
  (and a broken llm.yaml), restore from that state, and the band's bounds.
- **Integration (Postgres):** the migration up and down (the downgrade pinned to `f2a4c6e8b0d1`), the unique `active`
  index, the `(kind, version)` constraint, and two concurrent saves from one base (exactly one wins).

Frontend:
- **Vitest:** the Markdown subset parser (never HTML), the settings page (edit, validate, save, 409 with discard and
  rebase, env toggle, worker states, polling after a save), the glossary page (add, remove, cell errors, preview, save,
  409), the shared history, the harness page (disabled reasons, estimate, ack and confirm, progress polling, cancel,
  report view, compare), and the models page with an unreadable version. 23b's `models-view.test.tsx` passes unchanged
  after its helpers move.
- **Playwright** with a mocked admin API: the three flows, plus axe and layout at 1440 and 390 in both themes.

Docker smoke check through Caddy (spends nothing):
- Save a settings version that only changes `sse_max_per_ip`, and see `/status` report it within 5 s and the workers
  report the version within 30 s. Then reset.
- Validate a glossary without saving it. A save would leave a glossary version behind, and with it a new cache
  generation, so the smoke check keeps the seed state.
- Start the `harness` profile and see the heartbeat and availability. Check that starts over the ceiling and without
  `confirm` get 422 and create no row. Stop the profile.

## 9. Docs

- **`docs/api.md`:**
  - the settings, glossary and harness routes;
  - "limits can change at runtime; `/status` is live within 5 s";
  - the cache key's glossary part;
  - the `llm_concurrency` reload rule;
  - the harness profile and its money rules (`HARNESS_MAX_USD`, default $5);
  - in the 23b model section, the price warning, the `error` field and the band.
- **README:** one line under the admin console bullet.
- **Roadmap row 23:** 23c done.
- **Root `CLAUDE.md`:** one convention line, added after the merge by the crafted-blob method.

## 10. Risks

- **Spending by mistake.** The harness worker is off by default, the ceiling is env-only, a start needs a typed cap,
  `confirm: true` and an in-page confirm, the strict cap never starts a review that does not fit, retries count
  earlier spend, and tests and the smoke check never post a valid start.
- **A bad settings save closes the service.** Bounds, the daily-budget rule and restore in one click; the env values
  stay as the fallback.
- **Settings drift between processes.** At most 5 s on the API and 30 s on workers. A review admitted under old caps
  and started after a change runs under the new ones, because caps are bounds.
- **Glossary changes translation quality.** The harness measures it per glossary version, and restore is one click.
- **A stuck harness row blocks new runs.** Cancel always clears `active`.
- **Fixtures on a production host.** They are absent there, so the page says so and the button stays disabled.
