# Plan 23b: admin console model management — design (2026-10-12)

**สรุปภาษาไทย:** หน้า `/admin/models` ใช้จัดการโมเดลแทนการแก้ `llm.yaml` ได้แก่ preset ที่ใช้งาน, โมเดลและค่าต่อ role ใน
แต่ละ preset, provider, harness และ override ทุกครั้งที่บันทึก ระบบตรวจกับ schema เดิมและกับ catalog ของ OpenRouter
แล้วเก็บเป็นเวอร์ชันใหม่ใน DB พร้อมประวัติ ย้อนกลับได้ และบันทึกลง audit worker จะโหลด config ใหม่ตอนเริ่มรีวิวถัดไป
ไม่ต้อง restart ส่วน `llm.yaml` ยังเป็นค่าตั้งต้นเมื่อยังไม่มีเวอร์ชันใน DB และมี catalog ให้ค้นโมเดล ปุ่มทดสอบเรียกโมเดลจริง
1 ครั้ง (จำกัดค่าใช้จ่าย) และค่าใช้จ่ายโดยประมาณต่อรีวิวของแต่ละ preset API key ยังอยู่ใน env เท่านั้น

Context: `docs/superpowers/notes/2026-10-11-roadmap-thai-evidence.md` section 6b (23b). Plan 23a (sign-in, audit,
`require_admin`) is merged. The owner approved this design in chat on 2026-10-12.

## 1. Goal and success

The owner changes which models the service uses from the admin console, sees the cost of the change before saving,
can undo it, and never edits a file or restarts a container to do so.

**Success for 23b:**
- `/admin/models` shows the effective configuration (from the DB, or from `llm.yaml` while the DB has none) and the
  version each worker has loaded.
- The owner switches the active preset, changes a role's model and settings, duplicates or deletes a preset, and edits
  anything else (providers, harness, overrides, `extra_body`) in an advanced YAML editor.
- Every save is validated by the existing `LLMConfig` schema (errors block the save) and checked against the
  OpenRouter catalog (problems are shown as warnings). The cost per review of each preset is shown before saving.
- Each save creates a new version; history lists what changed; restoring an old version creates a new version with its
  content. Saves and restores are in the audit log.
- After a save, the next review a worker starts runs on the new models, with no restart. Reviews already running finish
  on the models they started with.
- After a save, a repeated topic runs again instead of returning a cached result made by the old models.
- The catalog tab lists OpenRouter models with prices and capabilities; a role's model can be picked from it.
- A test button makes one small real call to a role's model and reports success, latency and cost.

**Out of scope:**
- Storing provider API keys in the DB or showing them. Keys stay in env; the console shows only whether each
  `api_key_env` variable is set in the API process.
- Letting public users choose models per review.
- Runtime settings, the glossary editor and the harness page (23c).

## 2. Decisions (owner, 2026-10-12)

| Topic | Decision |
|---|---|
| Versions | Linear: every save appends a version; the newest version is active; a restore appends a copy of the old version |
| Concurrent edits | A save carries the version it was based on; if another version became active meanwhile, 409 |
| Source precedence | The newest DB version, else `llm.yaml`. `LLM_PRESET` applies only to the `llm.yaml` source; the console warns when it is set while a DB version is active |
| Seed | `llm.yaml` stays in the image as the seed; "กลับไปใช้ llm.yaml" appends a version with the file's content |
| Reload | A Redis version key; each worker checks it when a review job starts and rebuilds its models when it changed |
| In-flight reviews | Keep the models they started with |
| Result cache | The cache key includes the active config version |
| Editing | A form for the common edits plus an advanced YAML editor; both go through the same validation and save |
| Validation | Schema errors block; catalog problems warn; missing API key env vars warn |
| Test call | One structured call, output tokens capped, rate limited per actor, audited |
| Eval CLI | Uses the effective config (DB when it has a version); `--config-file` forces `llm.yaml`; an unreachable DB is an error, never a silent fallback |
| API keys | Env only |

## 3. Data model

One Alembic migration adds **`llm_config_versions`**:
- `id` integer primary key (autoincrement; the version number shown in the console)
- `created_at` timestamptz
- `created_by` varchar(64): the actor label (username, key prefix or `cli`)
- `note` text, nullable (the owner's comment, at most 500 characters)
- `source` varchar(16): `edit`, `restore` or `file` (a reset to `llm.yaml`)
- `restored_from` integer, nullable (the version a restore copied)
- `config` JSONB: the whole document in the `llm.yaml` shape (`active_preset`, `default_provider`, `providers`,
  `presets`, `harness`, `overrides`), already validated

Rows are never updated or deleted by the application. YAML comments are not kept: the stored document is data.

## 4. Backend

### 4.1 Loading and resolving
`app/services/llm_config.py` is split so a config can come from a file or from a dict:
- `parse_llm_config(raw: dict) -> LLMConfig` (raises `LLMConfigError` with the validation message)
- `resolve_llm_config(config: LLMConfig, preset: str | None) -> ResolvedLLMConfig` (the current resolution logic)
- `load_llm_config(path, preset)` keeps working: it reads the file, then calls the two above.

`app/services/llm_store.py` (new) owns the versions:
- `EffectiveConfig(source: "db" | "file", version: int | None, raw: dict, config: LLMConfig, env_preset: str | None)`
- `async load_effective(session, settings) -> EffectiveConfig`: the newest version when one exists, else the file.
  `settings.llm_preset` is applied only for the file source.
- `async save_version(session, actor, raw, *, base_version, note, source="edit", restored_from=None) -> row`:
  validates, refuses with `Conflict` when `base_version` is not the active version (`None` means "the file is
  active"), inserts, and writes the audit row (`llm_config.save`, `llm_config.restore` or `llm_config.reset`) in the
  same transaction, with a change summary as `before`/`after`.
- `async list_versions(session, before, limit)` and `async get_version(session, id)`.
- `summarize_change(old_raw, new_raw) -> dict`: the active preset change, per preset and role the model change
  (`"budget.synthesizer": "a → b"`), presets added or removed, and which other sections changed. History and the
  audit row both use it.
- `config_version_key(...)`: after a commit the caller sets Redis `mra:llm:config_version` to the new id.
- `async active_version_id(session, redis) -> str`: the Redis value, or on a miss the newest id from the DB (then
  cached in Redis), or `"file"` when the table is empty. The review service uses it for the cache key.

### 4.2 Building and reloading models
- `build_llms(settings, catalog=None, *, resolved=None, sem=None)`: `resolved` defaults to the file loader as today;
  `sem` lets a reload keep the process's one LLM semaphore (`LLM_CONCURRENCY` stays a per-process limit).
- Worker startup (`app/worker/settings.py`) loads the effective config from the DB, builds the graph from it, and
  keeps `ctx["llm_version"]`, `ctx["llm_sem"]` and an `asyncio.Lock`.
- `app/worker/llm_reload.py` (new) `async refresh_llms(ctx)`: reads Redis `mra:llm:config_version`; when it differs
  from `ctx["llm_version"]`, under the lock, loads the effective config, builds new LLMs with the same semaphore and
  catalog, replaces `ctx["graph_deps"]` (a copy with the new `llms`) and `ctx["graph"]` (same checkpointer), and
  records the version. A failure keeps the old models, logs the error, and is reported (below).
- `run_review` (and `resume_review`) call `refresh_llms(ctx)` before building the runner. A runner holds the graph it
  started with, so a running review is never switched mid-way.
- Each worker reports what it loaded in the Redis hash `mra:llm:loaded`: field `<hostname>:<pid>`, value JSON
  `{version, preset, loaded_at, error}`; fields older than a day are ignored by the console.
- A resumed review (worker restart, retry) that started before a change uses the new models from the resume point;
  its result records the models of the worker that finished it. This is stated in the docs.

### 4.3 Result cache
`ReviewService` builds the cache key version as `f"{prompt_version}+llm{active_version_id}"`, so a saved config makes
repeated topics run again.

### 4.4 Cost estimate and catalog
- The typical-calls table and the per-review estimate move from `app/cli/models.py` to `app/services/llm_cost.py`
  (`estimate_review_cost(resolved, catalog) -> {total_usd, per_role, unknown_models}`); the CLI imports them.
- `app/services/model_catalog.py` gets `async cached_catalog(redis, http)`: the OpenRouter catalog cached in Redis
  (`mra:llm:catalog`, one hour). A fetch failure returns no catalog, and the console says the checks were skipped.

### 4.5 Test call
`app/services/llm_probe.py` (new) `async probe(role_spec_with_provider, settings, catalog) -> {ok, latency_ms,
cost_usd, model, error}`:
- builds one LLM from the given role settings with a tiny schema (`{ok: bool, word: str}`) and the instruction to
  answer `ok: true` and one word;
- caps `max_tokens` at 512 (reasoning models need some room) and the timeout at 60 s;
- runs inside a `ReviewBudget` of $0.05 so a misbehaving retry cannot run up a bill;
- never raises: errors come back as text (API key missing, model not found, timeout, invalid output).

## 5. Admin API

All routes are under `/api/v1/admin`, need `require_admin`, are hidden from OpenAPI, and every change writes an audit
row in its transaction (CSRF and cookie rules as in 23a).

| Method and path | What it does |
|---|---|
| `GET /llm-config` | `{source, version, config, env_preset, keys_present: {ENV_NAME: bool}, loaded: [{worker, version, preset, loaded_at, error}]}` |
| `GET /llm-config/versions?before=&limit=` | Newest first: `{items: [{id, created_at, created_by, note, source, restored_from, active_preset, changes}], next}` |
| `GET /llm-config/versions/{id}` | The full stored config |
| `GET /llm-config/versions/{id}/yaml` | The config as YAML text (download) |
| `POST /llm-config/validate` | Body `{config}` or `{yaml}` → `{ok, errors, warnings, cost: {preset: estimate}}`; nothing is saved |
| `POST /llm-config` | Body `{config}` or `{yaml}`, `base_version`, `note?` → 201 the new version; 409 when `base_version` is stale; 422 with the errors when invalid |
| `POST /llm-config/versions/{id}/restore` | Body `{base_version, note?}` → 201 the new version |
| `POST /llm-config/reset` | Body `{base_version, note?}` → 201 a version with `llm.yaml`'s content |
| `GET /llm-models?q=&structured=&reasoning=&max_price=&limit=` | The cached catalog, filtered: `{items: [{id, context_length, price_in_per_m, price_out_per_m, structured, tools, reasoning}], available}` |
| `POST /llm-models/test` | Body: one role's settings (`model`, `provider?`, and the `RoleSpec` fields) → the probe result; 429 over 10 tests per minute per actor; audit `llm.test` with the model and the outcome |

A YAML body is parsed with `yaml.safe_load`; a parse error is 422 with the line.

## 6. Frontend

A "โมเดล" link joins the admin nav. `/admin/models` (client page, same patterns as 23a: `useAdmin().fail`, notices,
focus after actions, `ConfirmButton` for destructive steps, DESIGN.md rules):
- **Header block:** the source and version in use ("ใช้เวอร์ชัน 7 จาก DB" or "ใช้ llm.yaml"), the active preset, the
  workers' loaded versions (a warning tint when a worker reports another version or an error), the `LLM_PRESET`
  warning, and the API key env vars that are not set.
- **ใช้งานอยู่ / Presets tab:** a preset selector; for the chosen preset a role table (model, provider, max_tokens,
  temperature, reasoning_effort, timeout, fallback models) with inline edits; "ทดสอบ" per role; "คัดลอก preset" and
  "ลบ preset" (not the active one); "ตั้งเป็น preset ที่ใช้งาน". Edits build a draft; the draft shows its cost estimate
  and warnings from `validate`; "บันทึกเป็นเวอร์ชันใหม่" with an optional note saves it.
- **YAML ขั้นสูง tab:** a monospace textarea with the draft as YAML, "ตรวจ" and "บันทึก". The form and the YAML editor
  share one draft; switching tabs with unparsed YAML asks first.
- **ประวัติ tab:** versions newest first with their change summaries, "ย้อนกลับไปเวอร์ชันนี้" (confirm in page),
  "ดาวน์โหลด YAML", and "กลับไปใช้ llm.yaml".
- **Catalog tab:** search and filters, a table of models (prices per 1M tokens, context, capabilities), and "ใช้กับ role…"
  which puts the model into the draft's chosen role.
- A 409 on save says another admin saved first and offers to reload the latest version (the draft is kept in the YAML
  tab so nothing typed is lost).

No new frontend dependency: YAML is parsed and produced by the backend (`validate` accepts YAML; the draft's YAML
text comes from the `/yaml` route or a `yaml` field in the validate answer).

## 7. CLI and evals

- `app.cli.models check` keeps validating `llm.yaml`; it gains `--source db` to validate the active DB version.
- `app.cli.eval run` resolves the effective config through `load_effective` (DB when it has a version) and records
  its source and version in each run record; `--config-file PATH` forces a file. An unreachable DB stops the command
  with a message naming `--config-file`.

## 8. Testing

Backend (unit, sqlite + fakeredis):
- versions: save, list, get, restore, reset; `base_version` conflict 409; invalid config 422 with errors and no row;
  audit row with the change summary in the same transaction; `summarize_change` cases.
- effective config precedence: file when empty, DB when present, `LLM_PRESET` only for the file.
- `active_version_id`: Redis hit, miss → DB, empty → `"file"`; cache key changes after a save.
- worker reload: no change → no rebuild; a change → new llms with the same semaphore, old runner keeps its graph;
  a failing config → old models kept, error reported in `mra:llm:loaded`.
- validate: schema errors, catalog warnings (unknown model, reasoning unsupported), missing env key warnings, cost.
- probe: success, missing key, model error, budget cap; route rate limit and audit.
- catalog route: filters, cache, fetch failure → `available: false`.
- routes: `require_admin`, CSRF, hidden from OpenAPI.
- eval CLI: DB source recorded; `--config-file`; unreachable DB error.
- Integration (Postgres): the migration up/down; JSONB round trip of a full config.

Frontend: vitest for the models page (header states, role edit → draft → validate → save, 409 handling, YAML tab,
history restore with confirm, catalog pick, test button); Playwright with a mocked admin API for the save → history
→ restore flow, axe and layout at 1440 and 390 in both themes.

Docker smoke check through Caddy: save a version that changes one role, see a worker report the new version after one
stub review, restore the previous version.

## 9. Docs

- `docs/api.md`: the model management routes and the reload behaviour.
- Root `CLAUDE.md`: the "Models, presets and per-role tuning live in `backend/config/llm.yaml`" line changes to say the
  DB versions win and `llm.yaml` is the seed (added after the merge without touching the owner's uncommitted edits).
- `backend/config/llm.yaml` header comment: it is the seed; the console's versions override it.
- README: one line under the admin console bullet.

## 10. Risks

- **A bad config reaches the workers.** Schema validation blocks invalid documents; a config that validates but fails
  to build keeps the old models and shows the error in the header block. Restore is one click.
- **Cost surprises.** The estimate is shown before saving; the per-review cost cap (`review_cost_cap`) still bounds
  every review regardless of the models chosen.
- **Mixed models in a resumed review.** Rare (a worker restart during a config change); the result records the models
  that finished it.
- **Catalog unavailable.** Saving still works; the console says the catalog checks were skipped.
