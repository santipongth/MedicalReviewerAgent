# Plan 23e: LLM provider keys in the admin console — design (2026-10-13)

**สรุปภาษาไทย:** Plan 23e ให้ผู้ดูแลใส่ เปลี่ยน และลบคีย์ของผู้ให้บริการ LLM ได้จากหน้า `/admin/models` แท็บใหม่
"ผู้ให้บริการและคีย์" และเพิ่มผู้ให้บริการได้หลายราย คือ OpenRouter, Anthropic และผู้ให้บริการใดก็ได้ที่ใช้ API แบบ OpenAI
(OpenAI, Gemini ผ่าน endpoint แบบ OpenAI, DeepSeek, Groq, Mistral, Together, Ollama ในเครื่อง) คีย์เก็บแยกจากเวอร์ชัน
config ในตารางใหม่ `llm_provider_keys` เข้ารหัสด้วย Fernet โดยใช้กุญแจหลัก `LLM_KEYS_SECRET` จาก `.env` ไม่มีกุญแจหลักก็
ดูได้อย่างเดียว คีย์เขียนได้อย่างเดียว: API ตอบแค่ว่ามีคีย์ไหม เลขท้าย 4 ตัว origin ที่ผูกไว้ และเวลาแก้ ไม่ส่งค่าจริงกลับ ไม่ลง
log ไม่ลง audit คีย์จากหน้านี้ชนะคีย์ใน env ลบแล้วกลับไปใช้ env คีย์ผูกกับ origin (scheme + host + port) ของผู้ให้บริการ
ถ้าเปลี่ยน `base_url` ไป origin อื่น คีย์นั้นจะไม่ถูกส่งจนกว่าจะใส่ใหม่ และไม่ถอยไปใช้คีย์ env ด้วย OpenRouter กับ Anthropic
ยังตรึงไว้กับ host ของตัวเองเหมือนเดิม โมเดลที่ไม่ได้ผ่าน OpenRouter ต้องมีราคา input/output ต่อ 1M token (Anthropic ใช้
ตารางราคาในโค้ดได้) ไม่มีราคาบันทึกไม่ได้ เพื่อให้เพดานค่าใช้จ่ายต่อรีวิวนับได้จริง บันทึกคีย์แล้ว worker สร้าง LLM ใหม่ตอนเริ่ม
งานถัดไปหรือภายใน 30 วินาที ผ่าน `mra:llm:keys_version` cache ผลรีวิวไม่ต้องเริ่มรุ่นใหม่เพราะคีย์ไม่เปลี่ยนโมเดลหรือ prompt
ไม่มีการแก้ prompt จึงไม่เปลี่ยน `prompt_version` มี migration หนึ่งตัว ไม่มีอะไรที่ใช้เงินในการทดสอบอัตโนมัติ

Context: the owner's request of 2026-10-13 ("add and edit the OpenRouter key on the admin models page; add other LLM
providers with their own keys and tune them from the same page") and the design the owner approved the same day
(`C:\Users\santi\.claude\plans\rippling-toasting-whisper.md`, binding). The owner chose OpenRouter + Anthropic + any
OpenAI-compatible provider. The request reverses the written rule that provider keys stay env-only (root `CLAUDE.md`
line 51, `backend/app/services/runtime_settings.py:1-2`); the owner's request is the sign-off and this plan updates
both texts. The base is master `eae78b5` (Plan 23d merged). Plan 30 (cleanup) is in progress and touches
`app/worker/llm_reload.py` and the `mra:llm:loaded` heartbeats, so 23e's implementation plan is written after Plan 30
merges (section 14). The owner told Claude to run roadmap plans end to end without approval gates, so Claude made the
decisions in section 2 on top of the approved design.

## 1. Goal, success and scope

**Goal.** An admin enters, replaces or removes a provider's API key from the console, adds an OpenAI-compatible
provider from a template, points preset roles at it with its prices, tests it with one capped call, and never edits
`.env` or restarts a container. A stolen admin session can spend through the stored keys (within the caps) but can
neither read a key nor send one to a host of its choosing.

**Success for 23e:**
- `/admin/models` has a "ผู้ให้บริการและคีย์" tab: one row per configured provider with kind, origin, key status and
  set/replace/delete/test actions; "เพิ่มผู้ให้บริการ" adds a provider from a template to the draft.
- A key saved in the console is used by every worker at its next job start or within 30 s, beats the env key, and
  falls back to env when deleted. No response, log line, audit row, Redis value or exception message carries a key.
- A stored key is sent only to the origin it was saved for; a `base_url` change to another origin silences it.
- Every role whose provider is not OpenRouter has a price the review budget charges (`LimitedLLM` →
  `ReviewBudget.charge`), or the save is refused.
- Today's `backend/config/llm.yaml` and every stored `llm_config_versions` row load unchanged; with no stored keys and
  no new providers, behaviour, the result cache key and every existing test are unchanged.

**Out of scope:**
- Keys for anything other than LLM providers (OpenAlex, SearXNG engines, Turnstile, salts stay env-only).
- Native Gemini, Bedrock, Vertex or Azure clients (Gemini is reached through its OpenAI-compatible endpoint).
- Per-review or per-user keys (bring-your-own-key).
- Fetching price lists from non-OpenRouter providers (prices are typed in).
- A secrets manager or KMS; envelope encryption beyond one master secret.
- Changing the admin sign-in (the `admin`/`admin` risk is reported to the owner, section 11).

## 2. Decisions (Claude, on the owner's approved design, 2026-10-13)

| Topic | Decision |
|---|---|
| Store | A new table `llm_provider_keys`, one row per provider name, outside the versioned config (keys are not history: a restore must never bring an old key back). A delete keeps the row as a tombstone (`ciphertext` null) so the revision counter never goes backwards |
| Encryption | Fernet (`cryptography`, added as a direct dependency; today it is only transitive through `authlib`, `uv.lock:175`). `LLM_KEYS_SECRET` holds one or more comma-separated Fernet keys; the first encrypts, all decrypt (`MultiFernet`) |
| What is encrypted | The JSON payload `{"v": 1, "provider", "origin", "key"}`, not the bare key. On decrypt the payload's provider and origin must equal the row's, so a row copied to another provider or an edited `bound_origin` column reads as unreadable (Fernet has no associated data; this is its stand-in) |
| Missing or bad secret | The tab is read-only with the reason; set/replace answers 409 `code: "no_secret"` or `"bad_secret"`; delete still works (it needs no secret and clears unreadable rows). Stored rows are then unreadable and resolution falls back to env |
| Binding unit | The origin (`scheme://host[:port]`, lower case, default port dropped), not the bare host: `http://localhost:11434` and `http://localhost:8080` are different servers. A path change (`/v1` → `/v1beta/openai/`) keeps the key |
| Origin mismatch | The stored key is not sent and there is **no env fallback** for that provider until a key is entered for the new origin, otherwise a `base_url` change would redirect the env key instead. The status says which origin the key belongs to |
| Precedence | Console key (readable, origin matches) → env key (per the env rules below) → none. An unreadable console row falls back to env and is reported loudly (page, worker heartbeat) |
| Provider document | `ProviderSpec` gains `kind: openrouter \| anthropic \| openai_compatible`; provider names become free slugs `^[a-z][a-z0-9_]{0,31}$` (at most 12 providers). `kind` may be omitted only for the three legacy names, where it equals the name. `openrouter` and `anthropic` kinds exist only under their own names (one each), so `PINNED_HOSTS` keeps working by name |
| `api_key_env` | Becomes optional. Legacy names: absent or exactly `PROVIDER_KEYS[name]` (today's rule). Free names: absent or exactly `LLM_KEY_<NAME>` (upper case of the name); nothing else, so no document can name `DATABASE_URL`, `OPENALEX_API_KEY` or another provider's variable |
| Env fallback, free names | `LLM_KEY_<NAME>` is read from `os.environ` only (never `Settings`, so no field such as `openalex_api_key` is reachable) and used only when `LLM_KEY_<NAME>_ORIGIN` equals the provider's origin: an env key is bound like a console key. Legacy `openai_compatible` keeps `OPENAI_COMPATIBLE_API_KEY` unbound, as today (a local server; documented gap) |
| Base URL rules | OpenRouter and Anthropic as today (`_is_https_host`, `llm_config.py:94`). Legacy `openai_compatible`: today's any-http(s) rule (`llm_config.py:296-300`). Free-named `openai_compatible`: https to a host name or a global IP literal; http only to `localhost`, `127.0.0.1`, `::1` or `host.docker.internal`; no userinfo, query or fragment; private, link-local and metadata IP literals refused |
| Prices | `RoleSpec` gains `price_in`/`price_out` (USD per 1M tokens, both or neither, 0–1000). Required, as a save error, for every resolved role whose provider kind is `openai_compatible` (0 is allowed for a local server) and for `anthropic` models missing from `PRICES_PER_MTOK`. Enforced at validate and save, never at parse, so stored versions keep loading |
| Charging | `anthropic`: role price, else `PRICES_PER_MTOK`. `openrouter`: `usage.cost`, else the catalog, else the role price. `openai_compatible`: the role price only; a provider-reported `usage.cost` is ignored (not trusted from an arbitrary server) |
| Fallback models | OpenRouter only (`body["models"]` is an OpenRouter field). For other kinds `build_role_llm` drops them and validation warns; an OpenAI server would otherwise 400 on the unknown field |
| Reasoning effort | For the `openai_compatible` kind it is sent as ChatOpenAI's `reasoning_effort` (top-level, OpenAI's name), not OpenRouter's `reasoning` object; `none` is not sent. The seed's presets do not use the legacy entry, so nothing in use changes |
| Reload | Redis `mra:llm:keys_version` = the newest `revision` (a Postgres sequence), raised only, like `publish_version` (`llm_store.py:199`). Job start trusts Redis; the 30 s poll reads `max(revision)` from the DB and repairs the key. A keys change rebuilds the LLMs on the same resolved config and semaphore |
| Cache key | Unchanged (section 6.4) |
| Templates | Frontend-only data (`src/lib/provider-templates.ts`), editable defaults copied into the draft; the backend never trusts or needs them |
| Write-only API | `GET` status, `PUT` set/replace, `DELETE`, and the existing test route widened. The `PUT` body is read and checked in code with fixed messages, because FastAPI's default 422 echoes the submitted `input` |
| Error text | Every message built from a provider exception passes `redact(text, key)` before it leaves `llm.py`; the probe's 300-character error is redacted again |
| Audit | `llm_key.set`, `llm_key.replace`, `llm_key.delete`; `after` holds provider, kind, origin and revision, never any part of the key (not even `last4`). `SECRET_FIELDS` gains `api_key`, `ciphertext` and `llm_keys_secret` as a backstop |
| Settings | `llm_keys_secret: SecretStr` in `Settings` (masked in reprs); env-only, read once per process (`get_settings` is `lru_cache`d, `config.py:114`), so a secret change needs a restart |

## 3. Data model and migration

### 3.1 Table

```
llm_provider_keys
  provider      varchar(32)  primary key          -- the provider's name in the config document
  ciphertext    text         null                 -- Fernet token (ASCII); null = deleted (tombstone)
  last4         varchar(4)   null                 -- last 4 characters; null for keys under 12 characters and tombstones
  bound_origin  varchar(255) null                 -- origin the key was saved for; null for tombstones
  revision      bigint       not null             -- nextval('llm_provider_keys_revision_seq') on every set/replace/delete
  updated_at    timestamptz  not null default now()
  updated_by    varchar(64)  not null             -- AdminPrincipal.label[:64]
```

- ORM model `LlmProviderKey` in `app/db/models.py` beside `LlmConfigVersion` (`models.py:200`).
- Migration `migrations/versions/c6e8a0b2d4f6_llm_provider_keys.py`, `down_revision = "b3d5f7a9c1e2"` (today's head,
  `b3d5f7a9c1e2_runtime_config_and_harness_runs.py:13`); it creates the sequence and the table; downgrade drops both.
  On sqlite (unit tests) the revision comes from `coalesce(max(revision), 0) + 1` inside the write transaction, under
  the same advisory-lock pattern as `LLM_SAVE_LOCK` (`llm_store.py:39`) on Postgres (new lock key `MRALLMKY`).
- One row per provider name. Set and replace update the row in place; delete sets `ciphertext`, `last4` and
  `bound_origin` to null and takes a new revision. Rows for providers no longer in the config stay until deleted and
  are listed as "orphans".

### 3.2 Revision

`keys_version` is `max(revision)` (null while the table is empty). It only grows, so workers compare it as an integer
like the LLM config id. It is not a document version: there is no history, restore or rollback of keys.

## 4. Encryption (`app/services/llm_keys.py`)

- **Secret format.** `LLM_KEYS_SECRET` is one or more Fernet keys (URL-safe base64 of 32 bytes, 44 characters),
  comma-separated, newest first. Generate with `python -m app.cli.admin llm-keys-secret` (prints
  `Fernet.generate_key()`; no DB or network) or the equivalent one-liner in `.env.example`. The controller sets it at
  deploy, as `IP_HASH_SALT` was set.
- **State.** `cipher(settings) -> MultiFernet | None` and `secret_state(settings) -> "ok" | "no_secret" |
  "bad_secret"`. A part that does not decode to 32 bytes makes the whole secret `bad_secret` (logged once at error,
  never the value). Neither the API nor the worker refuses to start.
- **Encrypt.** `seal(cipher, provider, origin, key) -> str` encrypts the JSON payload of section 2.
- **Decrypt.** `open_row(cipher, row) -> str | Unreadable`: `InvalidToken`, bad JSON, `v != 1`, or a payload whose
  provider or origin differ from the row's columns are all `Unreadable` (logged with the provider name only).
- **Rotation.** Add a new key at the front of `LLM_KEYS_SECRET` (`new,old`), restart the API and workers, run
  `python -m app.cli.admin rotate-llm-keys` (re-encrypts every live row with the first key via `MultiFernet.rotate`, in
  one transaction, with an `llm_key.rotate` audit row by `CLI_ACTOR` naming the count, as `app/cli/admin.py:66-76`
  audits its other commands; the revision is not bumped because no
  plaintext changed), then remove the old key and restart again.
- **Loss.** A lost secret makes every stored key unreadable: the page says so, resolution falls back to env, and the
  admin deletes and re-enters the keys. The `.env` backup is the recovery path; DB backups alone hold only ciphertext.
- **Key text accepted.** Leading and trailing whitespace stripped (pasted keys often end in a newline); then 8 to 512
  characters of visible ASCII with no spaces (`VISIBLE_ASCII`, `llm_config.py:75`), so the value is always a valid
  `Authorization`/`x-api-key` header. Anything else: 422 with a fixed message that never quotes the input.

## 5. The provider document

### 5.1 Schema changes (`app/services/llm_config.py`)

- `ProviderName` (`llm_config.py:30`) stops being a `Literal`: provider keys of `LLMConfig.providers`, `RoleSpec.provider`
  and `LLMConfig.default_provider` are strings matching `PROVIDER_NAME = ^[a-z][a-z0-9_]{0,31}$`; `ProviderKind =
  Literal["openrouter", "anthropic", "openai_compatible"]`.
- `ProviderSpec` (`extra="forbid"` kept, `llm_config.py:195`) gains `kind: ProviderKind | None = None`;
  `api_key_env: str | None = None`. A property-free helper `provider_kind(name, spec)` returns `spec.kind or name` for
  the legacy names and is the only way code asks for a kind.
- `RoleSpec` (`llm_config.py:219`) gains `price_in: float | None = Field(None, ge=0, le=1000)` and `price_out` (same),
  with a model validator "set both or neither". Overrides may set them (they go through `RoleSpec.model_validate`,
  `llm_config.py:422`).
- `LLMConfig._check` (`llm_config.py:286`) becomes, per provider:
  1. the name matches `PROVIDER_NAME`; at most 12 providers;
  2. the kind is known: `kind` given, or the name is one of the three legacy names;
  3. `openrouter` and `anthropic` kinds only under the names `openrouter` and `anthropic` (and those names only with
     their own kind); `openai_compatible` kind under any other name, including the legacy `openai_compatible`;
  4. `api_key_env`: legacy names as today (`PROVIDER_KEYS`, `llm_config.py:72`, now "absent or equal"); free names
     absent or `LLM_KEY_<NAME>`;
  5. base URL per section 2's table (`PINNED_HOSTS` unchanged; a new `_is_open_provider_url` for free names);
  6. `default_provider` exists in `providers` (today it is only checked when a role uses it; it is now always checked
     because the presets tab offers it as the dropdown's default).
- `provider_origin(name, spec) -> str`: the origin of `spec.base_url`, or `https://openrouter.ai` /
  `https://api.anthropic.com` when an OpenRouter or Anthropic `base_url` is absent (`OPENROUTER_BASE_URL`,
  `llm.py:310`; ChatAnthropic's default).
- `key_env(name, spec) -> str | None`: `PROVIDER_KEYS[name]` for legacy names, `LLM_KEY_<NAME>` for free names.

### 5.2 Backward compatibility

- Today's `llm.yaml` (`providers.openrouter`, `.anthropic`, `.openai_compatible` with their `api_key_env`,
  `config/llm.yaml:38-50`) validates unchanged: legacy names infer their kind and their variables are the fixed ones.
- Every stored version validates unchanged: no rule that existed is relaxed, and the new rules (name pattern, free-name
  URL rules, kind) only bite on names and fields that could not exist before. The price rule is save-time only, so a
  stored version without prices still loads in workers; restoring one that lacks a now-required price is refused with
  the price error (the admin adds prices to the draft and saves).
- `role.provider == "openrouter"`-style checks become kind checks in `llm.py:323-343`, `llm_validate.py:41-42`,
  `llm_cost.py:40`, `model_catalog.py:155` and `cli/models.py:77`. For the legacy names the kind equals the name, so
  behaviour is unchanged for every existing document.
- `ResolvedRole` (`llm_config.py:313`) gains `kind`; `ResolvedLLMConfig.describe()` keeps `provider:model`.
- The llm.yaml header comments (`config/llm.yaml:18-37`) are rewritten for kinds, free names and prices; the seed's
  content does not change.

### 5.3 Templates (frontend data, editable defaults)

Base URLs are from Claude's knowledge (cutoff 2026-06), not fetched; each is a default the admin can edit, and the
first "ทดสอบ" confirms it.

| Template | Suggested name | `base_url` | Suggested `structured_output` | Key from |
|---|---|---|---|---|
| OpenAI | `openai` | `https://api.openai.com/v1` | `json_schema` | platform.openai.com |
| Gemini (OpenAI-compatible endpoint) | `gemini` | `https://generativelanguage.googleapis.com/v1beta/openai/` | `json_schema` | Google AI Studio |
| DeepSeek | `deepseek` | `https://api.deepseek.com/v1` | `json_mode` | platform.deepseek.com |
| Groq | `groq` | `https://api.groq.com/openai/v1` | `tool_calling` | console.groq.com |
| Mistral | `mistral` | `https://api.mistral.ai/v1` | `json_schema` | console.mistral.ai |
| Together | `together` | `https://api.together.xyz/v1` | `json_mode` | api.together.ai |
| Ollama (this machine) | `ollama` | `http://host.docker.internal:11434/v1` | `json_schema` | none (price 0) |

A template fills the provider entry (`kind: openai_compatible`, `base_url`, `require_parameters: false`) and remembers
the suggested `structured_output` for roles later pointed at it (the presets tab prefills it; `auto` without a catalog
already means `json_schema`, `model_catalog.py:142-143`).

## 6. Keys at run time

### 6.1 Resolution (`app/services/llm_keys.py`)

- `KeyRing` (frozen): `entries: dict[provider, StoredKey(value, origin, last4)]`, `unreadable: frozenset[provider]`,
  `revision: int | None`, `state` (the secret state). `__repr__`/`__str__` list provider names only.
  `load_keyring(session, settings) -> KeyRing` reads and decrypts every live row once.
- `resolve_key(name, spec, ring, environ) -> KeyChoice(value | None, source, problem)`, where `source` is `console`,
  `env` or `none` and `problem` is null, `origin_mismatch`, `unreadable` or `env_origin_missing`:
  1. a readable console row whose `bound_origin` equals `provider_origin(name, spec)` → console;
  2. a readable console row bound to another origin → none, `origin_mismatch` (no env fallback);
  3. otherwise (no row, tombstone, or unreadable row) → env: `openrouter`/`anthropic`/legacy `openai_compatible` read
     `Settings` then `os.environ` as `_api_key` does today (`llm.py:313`); a free name reads `os.environ["LLM_KEY_<NAME>"]`
     and uses it only when `os.environ["LLM_KEY_<NAME>_ORIGIN"]` normalises to the provider's origin, else
     `env_origin_missing`; an unreadable row keeps its `unreadable` problem even when env supplies a key.
- In docker the `LLM_KEY_*` variables reach the containers through `env_file: .env` (`docker-compose.yml:76,85,114,141`);
  a host-run process must export them (pydantic-settings reads only declared fields from `.env`).

### 6.2 Building clients (`app/services/llm.py`)

- `build_role_llm(role, settings, catalog, schema, keys: KeyRing | None = None)` and `build_llms(..., keys=None)` take
  the ring; `None` means env-only (today's behaviour, used by tests and CLIs without a DB).
- A missing key keeps today's `MissingKeyLLM` (`llm.py:237`) with a message naming the provider and the problem, e.g.
  "no key for provider deepseek (the stored key belongs to https://api.deepseek.com; enter one for https://x)". For the
  `openai_compatible` kind, a missing key is still sent as `"not-needed"` only when the origin is a local http one
  (local servers ignore it); otherwise it is `MissingKeyLLM` (no anonymous calls to a paid public host).
- `OpenAICompatibleStructuredLLM` and `AnthropicStructuredLLM` keep the key in the client only. Their `except` blocks
  (`llm.py:122-123`, `llm.py:216-217`) format provider errors through `redact(text, key)`: the key and every 12-plus
  character slice of it are replaced by `[redacted]` before the `LLMError` is built. OpenAI's 401 text masks keys
  itself, but an arbitrary OpenAI-compatible server may echo the header; httpx and langchain exceptions do not include
  request headers, and the redaction is the backstop for what they might quote from a response body.
- Pricing per section 2: a `FixedPrice(price_in, price_out)` (per 1M tokens) beside `ModelInfo` (per token,
  `model_catalog.py:20-31`); both expose `cost(in_tok, out_tok)`. `estimate_cost` (`llm.py:55`) takes the role price
  first. `LimitedLLM` (`llm.py:251`) is unchanged: it already charges `res.cost_usd` to the contextvar budget, so a
  priced role is counted by the per-review cap and the daily USD counter.
- Every caller passes the ring: `app/graph/factory.py:27` (`build_graph_deps(..., keys=)`), `llm_reload._wire` and
  `refresh_llms`, `runtime_reload.py:103` (an `llm_concurrency` change rebuilds with `ctx["llm_keys"]`),
  `app/worker/harness.py:81-87` (loads the ring with the effective config), `app/cli/eval.py:66-76,236` (loads the
  ring when it reads the DB config; env-only otherwise), and the probe (section 7.3).

### 6.3 Propagation

- **Publish.** After a key write commits, the route calls `publish_keys_version(redis, revision)`: raise-only, WATCH/
  MULTI like `publish_version`; failure returns `workers_notified: false` and the poll repairs it.
  `reconcile_keys_version(redis, session_factory)` mirrors `reconcile_version_key` (`llm_store.py:224`).
- **Worker.** `refresh_llms` (`llm_reload.py:61`) compares two values: the config id (today) and the keys revision
  (`ctx["llm_keys_version"]`). Job start reads both Redis keys in one `MGET`; the poll reconciles both from the DB.
  Under `llm_lock`, a config change loads the effective config and the ring; a keys-only change reloads the ring and
  rebuilds `LLMs` from `ctx["llm_resolved"]` with the same `config_version` label and semaphore. A ring that fails to
  load keeps the old LLMs and reports `keys_error`. Runners already holding the old graph keep it, so a running review
  keeps the key it started with.
- **Heartbeat.** `report_state` (`llm_reload.py:119`) adds `keys` (the revision, `"none"` while the table is empty) and
  `keys_error` to the `extra` of `report_loaded` (`llm_store.py:267`). The page compares each worker's `keys` with the
  current revision.
- **API.** The API holds no long-lived LLMs: the key routes, the state route and the probe load the ring per request
  from the DB. Nothing in the API caches a key.

### 6.4 The result cache key does not change

`ReviewService._version()` (`review_service.py:142`) is `prompt_version + llm<config id> + …`. A key change alters
neither the prompt, the model, nor any request parameter, so a finished review is as valid after the change as before;
starting a new generation would only re-spend money. The cases where a key change does change outcomes are covered
already: a `base_url` change (which is what moves a key's binding) is a config save and so a new `llm<id>`; a missing or
wrong key makes calls fail, and reuse only considers `done` reviews or ones still active (`repositories.py:47-60`), so
a failure is never served from cache. A review that degraded because a key was revoked mid-run finishes `done` with
step errors in `errors`, exactly as a provider outage does today; that case is not new and is not keyed today either.

## 7. API

Admin routes under `/api/v1/admin`, `require_admin` (`app/api/auth.py:104`), registered with `include_in_schema=False`,
cookie writes need `X-MRA-Admin: 1` (`auth.py:60-62`), audit row in the same transaction. New file
`app/api/admin_keys_llm.py` (the name `admin_keys` is taken by API keys).

### 7.1 Routes

| Method and path | What it does |
|---|---|
| `GET /llm-keys` | State (7.2) |
| `PUT /llm-keys/{provider}` | Body `{"key": "..."}` → 200 the provider's state row plus `keys_version` and `workers_notified`. 404 when `provider` is not in the effective config; 409 `{detail, code: "no_secret" \| "bad_secret"}`; 422 fixed messages ("the key must be 8 to 512 visible characters without spaces"); 429 over `20/hour` per admin. Audit `llm_key.set` or `llm_key.replace` |
| `DELETE /llm-keys/{provider}` | → 200 the state row (now env or none) plus `keys_version`, `workers_notified`. Works without a secret and for orphans; 404 when there is no live row. Audit `llm_key.delete` |
| `POST /llm-models/test` | As today (`admin_models.py:221`, 10/min, $0.05 budget) plus optional `provider` and `model` (and `price_in`/`price_out`) instead of `role`: probes a role synthesised from that provider's spec in the effective config, so a key can be tried before any preset uses it. Draft tests resolve keys with the same ring, so a draft that moves a `base_url` gets no key |

`{provider}` must match `PROVIDER_NAME` (else 422 from the path, which echoes only the name). The `PUT` handler reads
`await request.json()` itself (body capped at 4 KiB) and validates in code: no pydantic model on the key field,
because FastAPI's request-validation 422 includes the offending `input`.

### 7.2 State shape

```
{
  "writable": true,                    // false when the secret is missing or bad
  "reason": null,                      // "no_secret" | "bad_secret"
  "keys_version": 7,                   // null while the table is empty
  "config_version": 12,                // the config the rows are checked against (null = llm.yaml)
  "providers": [
    {"name": "deepseek", "kind": "openai_compatible", "origin": "https://api.deepseek.com",
     "used_by": ["screener", "extractor"],           // roles of the active preset
     "key": {"source": "console", "last4": "a1b2", "bound_origin": "https://api.deepseek.com",
             "updated_at": "...", "updated_by": "admin", "problem": null},
     "env": {"name": "LLM_KEY_DEEPSEEK", "set": false, "origin_ok": false}}
  ],
  "orphans": [{"name": "groq", "last4": "9f0e", "bound_origin": "...", "updated_at": "...", "unreadable": false}],
  "loaded": [ ...worker heartbeats with "keys" and "keys_error"... ]
}
```

`env.set` says only whether the variable is non-empty. `GET /admin/llm-config` keeps `keys_present` (now true when a
console or env key resolves, keyed by env name as today, `admin_models.py:129`) and adds `key_status: {provider:
source-or-problem}`; the frontend moves from `missingKeyEnvs` to `key_status`. `llm_validate`'s missing-key warning
(`llm_validate.py:66-69`) uses the same resolution and skips local http origins instead of the name
`openai_compatible`; `validate_document` stays synchronous and takes the ring, which the route loads first.

### 7.3 Probe

`probe` (`llm_probe.py:32`) gains `keys` and passes it to `build`. Its error text is redacted with the key that was
used. The audit row (`admin_models.py:248-250`) adds `kind` and `key_source`; `base_url_host` stays.

### 7.4 Validation of prices (`llm_validate.py`, `llm_store.py`)

`price_errors(config) -> list[str]` walks every preset resolved with `resolve_llm_config` (overrides included) and
lists `presets.<preset>.<role>: price_in and price_out (USD per 1M tokens) are required for provider '<name>'
(<kind>); the review cost cap cannot count its calls otherwise`. `_validate` returns them as errors (`ok: false`);
`save_version` (`llm_store.py:117`) raises `LLMConfigError` with the first three (+N more), so save, restore and reset
all refuse an unpriced document. `unpriced_roles` (`llm_validate.py:35`) keeps its warning for OpenRouter models the
catalog does not list and no role price covers. `estimate_review_cost` (`llm_cost.py:30`) prices roles with a role
price, so non-OpenRouter presets get an estimate instead of "unknown models".

## 8. UI (`frontend/src/components/admin/`)

- **Tab.** `TABS` (`models-view.tsx:19-20`) gains `["providers", "ผู้ให้บริการและคีย์"]` after "Presets". New
  `models-providers.tsx`, on `ui.ts` classes and DESIGN.md patterns; Thai labels with English provider names.
- **Read-only banner** when `writable` is false: "ยังใส่หรือเปลี่ยนคีย์จากหน้านี้ไม่ได้: เซิร์ฟเวอร์ไม่มี
  `LLM_KEYS_SECRET`" (or "…: `LLM_KEYS_SECRET` ไม่ถูกต้อง"), plus "ดูวิธีสร้างใน .env.example". Delete stays available.
- **Rows** (a table at 1440, stacked cards at 390): name, kind ("OpenRouter" / "Anthropic" / "OpenAI-compatible"),
  origin, "ใช้กับ: screener, extractor" or "ยังไม่มี role ใช้", and the key status:
  - console: "ตั้งจากหน้านี้ ••••a1b2" (with "แก้ล่าสุดโดย admin เมื่อ …")
  - env: "ใช้ค่าจาก .env"
  - none: "ยังไม่มีคีย์" (for a local http origin: "ไม่ต้องใช้คีย์")
  - `origin_mismatch`: "คีย์ที่เก็บไว้ผูกกับ {bound_origin} — ใส่คีย์ใหม่สำหรับ {origin}"
  - `unreadable`: "ถอดรหัสคีย์ที่เก็บไว้ไม่ได้ (LLM_KEYS_SECRET เปลี่ยนไป) — ใส่ใหม่หรือลบ"
  - `env_origin_missing`: "มี LLM_KEY_… ใน .env แต่ไม่มี LLM_KEY_…_ORIGIN ที่ตรงกับ {origin}"
- **Actions:** "ใส่คีย์" / "เปลี่ยนคีย์" opens an inline form with one `type="password"` field (`autocomplete="off"`,
  `spellcheck=false`, never prefilled, cleared on submit, on error and on close) and "บันทึกคีย์"; "ลบคีย์" uses
  `ConfirmButton` ("ยืนยันลบคีย์", with "หลังลบจะใช้คีย์จาก .env ถ้ามี"); "ทดสอบ" calls the test route with the first
  role of the active preset using the provider, or asks for a model id when none does ("ทดสอบใช้เงินจริงไม่เกิน $0.05").
- **Draft providers.** A provider that exists only in the unsaved draft shows "บันทึกเวอร์ชันก่อนจึงใส่คีย์ได้" and no
  key actions; a provider whose draft `base_url` changes origin shows "เมื่อบันทึก คีย์ที่เก็บไว้จะหยุดใช้".
- **"เพิ่มผู้ให้บริการ":** a template select (section 5.3 plus "กำหนดเอง"), name and base URL fields prefilled from the
  template; "เพิ่มลงร่าง" adds `providers.<name>` to the draft; the existing save bar saves it as a new config version
  (history and rollback as before). Removing a provider from the draft is refused client-side while a role uses it.
- **Orphans:** listed below the table with "ลบคีย์" only.
- **Workers:** `WorkerVersions` shows each worker's `keys` revision; a lagging worker reads "ยังใช้คีย์ชุดเดิม".
- **Presets tab** (`models-presets.tsx:134-135`): the free-text provider field becomes a `<select>` of the draft's
  providers (`name (kind)`), with "ค่าเริ่มต้น ({default_provider})" as the empty option. When the role's provider kind is
  not OpenRouter, two number fields "ราคา input" and "ราคา output" (USD ต่อ 1M token, step 0.01) appear; for Anthropic
  the placeholder shows the `PRICES_PER_MTOK` price from a new `known_prices` field of `GET /admin/llm-config`. The
  price error from validate is shown on the role's row.
- **Catalog tab** (`models-catalog.tsx:13,57`): unchanged except that a declared OpenRouter provider is written with
  `kind: "openrouter"`.
- **Lib:** `admin-types.ts` gains `LlmKeysState`, `ProviderKeyRow`, `ProviderKind`, the price fields and `key_status`;
  `admin-api.ts` gains `llmKeys`, `setLlmKey`, `deleteLlmKey` (writes with `X-MRA-Admin: 1` through the existing
  `send`); `admin-models.ts` replaces `KEY_OPTIONAL`/`missingKeyEnvs` with a kind-and-origin aware `missingKeys`.

## 9. Failure modes

| Failure | Behaviour |
|---|---|
| `LLM_KEYS_SECRET` missing | Read-only tab; stored rows unreadable; env keys work; workers report `keys_error: "no_secret"` only when rows exist |
| Secret wrong or rotated without the old key | Rows `unreadable`; env fallback; page and heartbeat say so; delete and re-enter |
| Row tampered (provider or origin edited in the DB) | Payload mismatch → `unreadable`, same as above |
| Provider down or 5xx | Unchanged: `LLMError`, the step fails or escalates as today; the review continues with what it has |
| Wrong key (401/403) | Every call of that provider fails; the probe shows the redacted provider message; reviews end with step errors (the guard role failing fails the review, as with a missing env key today) |
| Key deleted mid-review | The running review keeps the LLMs it started with (old key); the next job uses env or none. Deleting does not revoke the key at the provider; the page says to revoke it there |
| Key revoked at the provider mid-review | Calls 401 from then on; same as a provider outage |
| Redis down | Writes commit, `workers_notified: false`, the 30 s poll reconciles from the DB |
| DB down at worker start | Env-only ring, `keys_error` reported, the poll retries |
| `base_url` moved to another origin | Config save succeeds; the key goes silent (`origin_mismatch`); validate warns before the save |
| Price missing on a non-OpenRouter role | Validate error, save 422; stored versions without prices still load and charge 0 (as today) |
| Provider returns `usage.cost` 0 | Ignored for `openai_compatible`; the role price is charged |

## 10. Security analysis

- **Who can do what.** Any admin (cookie or admin API key) can set, replace, delete and use keys. No route returns a key
  or any slice of it beyond `last4`; the DB holds ciphertext; Redis holds only the revision; workers hold plaintext in
  memory only.
- **Redirecting a key (exfiltration).** The binding check runs in `resolve_key`, at every build, in the worker and in
  the probe: a draft, a saved version or a restored version that moves `base_url` gets no key. OpenRouter and Anthropic
  stay pinned (`PINNED_HOSTS`). A free name can only name `LLM_KEY_<ITS NAME>`, read from `os.environ`, bound by its
  `_ORIGIN`. `HOSTILE_PROVIDERS` (`tests/unit/test_admin_models_api.py:228`) grows with: a free name naming
  `DATABASE_URL`, `OPENALEX_API_KEY`, `LLM_KEYS_SECRET` or `LLM_KEY_OTHER`; a provider named `openrouter` with kind
  `openai_compatible`; a kind `openrouter` under another name; a free name on `http://` to a public host; private,
  link-local and `169.254.169.254` literals; userinfo look-alikes. Each must be refused by validate, save and test with
  no probe call and no audit row, as the existing test asserts.
- **SSRF.** The probe makes the API call an admin-chosen origin. New providers are limited to https (or local http to
  the four loopback names), and non-global IP literals are refused; host names are not resolved at validation (DNS
  could change between check and call), so a public name resolving to a private address remains possible. The
  response a probe can reflect is at most 300 characters of an error string, and only to an admin. The legacy
  `openai_compatible` entry keeps today's wider rule; this is an existing exposure, now documented.
- **Leaks through text.** Provider errors are redacted (6.2); the key route never uses a pydantic constraint on the
  key (7.1); `KeyRing` reprs carry names only; structlog calls never receive a key or a payload; `Settings` holds
  `llm_keys_secret` as `SecretStr`; uvicorn and Caddy access logs carry no bodies. `SECRET_FIELDS`
  (`app/services/audit.py:15`) gains `api_key`, `ciphertext` and `llm_keys_secret` (today `api_key` is not scrubbed:
  it is neither in the set nor matched by `SECRET_SUFFIXES`, `audit.py:16`), so a future caller passing one is
  scrubbed anyway.
- **CSRF and clickjacking.** Writes need `X-MRA-Admin: 1` with a cookie; the password field never holds a stored
  value, so a framed page has nothing to read.
- **Spend.** A stolen admin session can run reviews or probes through the stored keys. The bounds are the existing
  caps (`max_cost_per_review_usd`, `MAX_USD_PER_DAY`, the probe's $0.05 and 10/min), and they only bind because
  non-OpenRouter roles must carry prices. The admin password is the real control (section 11).

## 11. Risks to tell the owner

- **The admin sign-in is still `admin`/`admin` over HTTP.** Once real keys are stored, anyone who can sign in can
  spend with them (within the daily and per-review caps), though they cannot read or redirect them. Change the admin
  password (`python -m app.cli.admin`) and put the console behind HTTPS before entering a real key.
- **Losing `LLM_KEYS_SECRET`** makes the stored keys unreadable; keep a backup of `.env` separate from DB backups.
- **Typed prices can be wrong.** A low price lets reviews spend more than the cap intends; the page links each
  template's pricing page and shows the per-review estimate.
- **Templates' base URLs** come from Claude's knowledge, not a fetch; the first test confirms them.

## 12. Testing

Backend unit (sqlite, fakeredis, no network, no real key; synthetic keys like `sk-test-0000…abcd`):
- `llm_keys`: seal/open round trip; `MultiFernet` with two keys; rotation; `no_secret` and `bad_secret`; a swapped or
  edited row is unreadable; repr has no key.
- Resolution: console beats env; delete falls back to env; origin mismatch gives none and no env fallback; unreadable
  falls back to env with the problem kept; free-name env needs a matching `_ORIGIN`; legacy names read as today; a
  `Settings` field is never reachable from a free name.
- Document: today's `llm.yaml` and a set of stored-version fixtures validate unchanged; kind inference; name pattern;
  the 12-provider cap; free-name URL rules; `default_provider` must exist; prices both-or-neither and bounds.
- Prices: validate and save refuse an unpriced `openai_compatible` role and an unknown Anthropic model; 0 passes;
  restore of an unpriced version is refused; stored unpriced versions still load; charging per kind, including an
  ignored `usage.cost` and the role price feeding `ReviewBudget`.
- `build_role_llm`: fallback models dropped and `reasoning_effort` top-level for `openai_compatible`; `MissingKeyLLM`
  messages; `"not-needed"` only for local http origins; `redact` on a fake provider error that echoes the key.
- Routes: each route's shape, `require_admin`, `X-MRA-Admin`, OpenAPI hidden, 404/409/422/429; the raw key never
  appears in any response body, any audit row, captured log output, or Redis (assert on the raw value across all of
  them); the 422 for a bad key does not echo it; delete without a secret; the test route with `provider`+`model`;
  `HOSTILE_PROVIDERS` extended.
- Worker: a keys-only change rebuilds LLMs with the same config label; the poll repairs a lost publish; a ring load
  failure keeps the old LLMs and reports `keys_error`; the heartbeat carries `keys`; `runtime_reload` rebuilds keep
  the ring; the cache key is unchanged by a key write.
- Existing pins stay green: `test_llm_config_safety.py`, `test_admin_models_api.py`, the scrubbing tests in
  `test_admin_accounts.py`, `test_admin_keys.py`.

Frontend: Vitest for the providers tab (each status line, read-only banner, set clears the field, delete confirm,
draft-only provider, origin-change notice, add from template), the presets dropdown and price fields, `missingKeys`.
Playwright with a mocked admin API: add a template provider, save, set, replace and delete a key; axe and no sideways
scroll at 1440 and 390 in both themes.

Docker smoke (spends nothing, no real key, `GRAPH_MODE=stub`): set `LLM_KEYS_SECRET`; add a provider `fake` with
`base_url` `http://localhost:9/v1` and a priced role in a non-active preset; set key `sk-fake-0000000000001234`; see
"••••1234", the workers report the new `keys` revision within 30 s, `grep` the API and worker logs, Redis dump and the
audit table for the raw value (none); change the origin and see `origin_mismatch`; delete and see env/none; reset the
config. The real "ทดสอบ" call costs money and is left to the owner.

## 13. Docs

- `docs/api.md`: the key routes and state shape; the test route's `provider`/`model`; `key_status`, `known_prices`;
  the provider document (kind, names, `api_key_env`, `LLM_KEY_*`/`_ORIGIN`, URL rules, prices); the heartbeat's `keys`.
- `.env.example`: `LLM_KEYS_SECRET=` with the generation command and the backup warning; a commented
  `LLM_KEY_<NAME>` / `LLM_KEY_<NAME>_ORIGIN` example; the `OPENROUTER_API_KEY` comment says the console may override it.
- `backend/config/llm.yaml` header comments (5.2).
- Root `CLAUDE.md`: line 51's "secrets, URLs and `HARNESS_MAX_USD` stay env-only" becomes "secrets, URLs and
  `HARNESS_MAX_USD` stay env-only, except LLM provider keys (Plan 23e)"; a new convention line: keys in
  `llm_provider_keys` (Fernet, `LLM_KEYS_SECRET`, write-only API, origin-bound, console > env, no env fallback on an
  origin mismatch), prices required off OpenRouter, `mra:llm:keys_version`, no cache-key part.
- `runtime_settings.py:1-2` docstring: "provider keys" moves out of the env-only list with a pointer to
  `llm_keys.py`.
- README admin bullet: one line.

## 14. Rebasing on Plan 30

Plan 30 (cleanup) merges first and touches `app/worker/llm_reload.py` and the `mra:llm:loaded` heartbeats. 23e's plan
must be written against that master and reconcile:
- **`refresh_llms` / `poll_llm_config`:** 23e adds a second compared value (keys revision) and a keys-only rebuild path
  under `llm_lock`. If Plan 30 restructures the wanted/poll/reconcile flow (or merges it with `runtime_reload`), the keys
  check goes into whatever single "what changed" step results, not beside it.
- **Heartbeat payload:** 23e adds `keys` and `keys_error` to `report_state`'s `extra`. If Plan 30 changes the payload
  shape, TTL, pruning (`LOADED_MAX_AGE`) or the reader (`loaded_workers`), the two fields follow its format, and the
  frontend `WorkerVersions` field list follows it too.
- **`report_loaded` / `report_state` signatures** and their tests: re-read after the rebase.
- **`build_graph_deps` / `build_llms` call sites:** any Plan 30 consolidation decides where the `keys` argument is
  threaded; every caller listed in 6.2 must still receive it.
- **Migrations:** if Plan 30 adds one, 23e's `down_revision` moves to Plan 30's head.
- **`CLAUDE.md` and `docs/api.md`:** apply 23e's line edits to Plan 30's wording.
- **Provider-name checks:** if Plan 30 touches `_api_key`, `unpriced_roles` or the `== "openrouter"` checks, the kind
  conversion of 5.2 applies to its version.

## 15. Size

About 7 tasks:
1. Provider document: kinds, free names, `api_key_env` rules, URL rules, `RoleSpec` prices, `price_errors` at validate
   and save, kind-based call sites (`llm.py`, `llm_validate.py`, `llm_cost.py`, `model_catalog.py`, `cli/models.py`),
   llm.yaml comments.
2. Key store: `cryptography` dependency, `Settings.llm_keys_secret`, migration and model, `llm_keys.py` (seal/open,
   `KeyRing`, `resolve_key`), the CLI `llm-keys-secret` and `rotate-llm-keys`, `SECRET_FIELDS`.
3. Clients: `build_role_llm`/`build_llms` with the ring, pricing per kind, fallback and effort rules, `redact`, every
   build site (factory, worker reloads, harness, eval, probe).
4. Admin API: the key routes, state, the widened test route, `key_status`/`known_prices`, publish/reconcile of
   `mra:llm:keys_version`.
5. Worker reload: keys revision in `refresh_llms`, the keys-only rebuild, heartbeat fields.
6. Frontend: providers tab, templates, presets dropdown and prices, lib types and API, Vitest.
7. Playwright, docs (`api.md`, `.env.example`, `CLAUDE.md`, README), the docker smoke.
