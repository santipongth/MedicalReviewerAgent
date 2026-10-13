/** Payloads of the admin API (/api/v1/admin, Plan 23a). Mirrors backend/app/services/admin_*.py. */
export type AdminStatus = "queued" | "running" | "done" | "error" | "rejected" | "cancelled";

export interface AdminMe { kind: "user" | "key"; label: string }

export interface Page<T> { items: T[]; next: string | number | null }

export interface Dashboard {
  days: number;
  since: string;
  per_day: { date: string; by_status: Partial<Record<AdminStatus, number>>; cost_usd: number }[];
  totals: { reviews: number; by_status: Partial<Record<AdminStatus, number>>; cost_usd: number; avg_cost_done_usd: number | null };
  error_rate_7d: number | null;
  by_model: { synthesizer: string; reviews: number; cost_usd: number }[];
  capacity: {
    accepting: boolean; reason: string | null; queued: number; running: number; max_queued_reviews: number;
    reviews_today: number; max_reviews_per_day: number; usd_today: number; max_usd_per_day: number;
  };
}

export interface AdminReview {
  id: string; topic: string; status: AdminStatus; review_type: string; created_at: string; finished_at: string | null;
  cost_usd: number; is_listed: boolean; api_key_prefix: string | null; prompt_version: string | null; error: string | null;
}

export interface AdminKey {
  id: string; key_prefix: string | null; name: string; daily_quota: number; is_admin: boolean; created_at: string;
  revoked_at: string | null; reviews_24h: number;
}

export interface MintedKey extends AdminKey { key: string }

export interface AuditEntry {
  id: number; created_at: string; actor_kind: "user" | "key" | "cli"; actor_label: string; action: string;
  target_type: string | null; target_id: string | null;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null;
}

/** Model management (/api/v1/admin/llm-*, Plan 23b). Mirrors backend/app/api/admin_models.py. */
export interface LlmRoleSpec {
  model: string; provider?: string | null; max_tokens?: number; temperature?: number | null; top_p?: number | null;
  reasoning_effort?: string | null; structured_output?: string; timeout_seconds?: number; fallback_models?: string[];
  extra_body?: Record<string, unknown>;
  /** Plan 23e: USD per 1M tokens, both or neither; required off OpenRouter. */
  price_in?: number | null; price_out?: number | null;
}
/** Plan 23e: a provider's kind; the three legacy names have the kind of their name. */
export type ProviderKind = "openrouter" | "anthropic" | "openai_compatible";
export interface LlmConfigDoc {
  active_preset: string; default_provider?: string; providers: Record<string, Record<string, unknown>>;
  presets: Record<string, Record<string, LlmRoleSpec>>; harness?: Record<string, unknown>;
  overrides?: Record<string, Record<string, unknown>>;
}
/** `loaded_at` is when the worker last reported (it re-reports every 30 s), not when it loaded the version. Plan 23c adds
 * the settings and glossary versions it runs ("env" and "file" for the defaults) and a failed runtime reload; Plan 23d
 * the search-sources version ("env" for the default). */
export interface LoadedWorker {
  worker: string; version: string; preset: string; loaded_at: string; error: string | null;
  settings?: string | null; glossary?: string | null; sources?: string | null; runtime_error?: string | null;
  /** Plan 23e: the provider-key revision the worker built its models with ("none" before any key), and why stored
   * keys cannot be used there. */
  keys?: string | null; keys_error?: string | null;
}
/** Plan 23e: one word for a provider's key: where it comes from, or why there is none. */
export type KeyStatus = "console" | "env" | "not_needed" | "none" | "origin_mismatch" | "unreadable" | "env_origin_missing";
export interface LlmConfigState {
  source: "db" | "file"; version: number | null; config: LlmConfigDoc; active_preset: string; env_preset: string | null;
  keys_present: Record<string, boolean>; loaded: LoadedWorker[];
  /** Plan 23e: each provider's key status, and the code's prices of direct Anthropic models (USD per 1M tokens). */
  key_status?: Record<string, KeyStatus>; known_prices?: Record<string, [number, number]>;
  /** Plan 23c: set when the configuration in use no longer passes validation (a version saved under older rules, or a
   * broken llm.yaml while no version exists). `config` is then as stored and `keys_present` is empty. */
  error?: string | null;
}
export interface LlmVersion {
  id: number; created_at: string; created_by: string; note: string | null; source: "edit" | "restore" | "file";
  restored_from: number | null; active_preset: string; changes: Record<string, unknown>;
}
/** The 201 answer of save, restore and reset. `workers_notified` is false when the Redis publish failed: the version is
 * saved, but the workers pick it up only at their next DB check. */
export type LlmSaveResult = LlmVersion & { workers_notified: boolean };
export interface CostEstimate { total_usd: number; per_role: Record<string, number>; unknown_models: string[] }
export interface ValidateReport {
  ok: boolean; errors: string[]; warnings: string[]; cost: Record<string, CostEstimate>;
  config: LlmConfigDoc | null; yaml: string | null;
}
export interface CatalogModel {
  id: string; context_length: number | null; price_in_per_m: number; price_out_per_m: number;
  structured: boolean; tools: boolean; reasoning: boolean;
}
export interface ProbeResult { ok: boolean; latency_ms: number; cost_usd: number; model: string; error: string | null }
/** Plan 23e: the provider keys (/api/v1/admin/llm-keys). Mirrors backend/app/api/admin_keys_llm.py. A key is never sent
 * back: only where it comes from, its last 4 characters and the origin it is bound to. */
export interface ProviderKeyRow {
  name: string; kind: ProviderKind; origin: string; used_by: string[]; keyless: boolean;
  key: {
    source: "console" | "env" | "none"; problem: "origin_mismatch" | "unreadable" | "env_origin_missing" | null;
    last4: string | null; bound_origin: string | null; updated_at: string | null; updated_by: string | null;
  };
  env: { name: string; set: boolean; origin_ok: boolean };
}
export interface OrphanKey { name: string; last4: string | null; bound_origin: string | null; updated_at: string | null; unreadable: boolean }
export interface LlmKeysState {
  writable: boolean; reason: "no_secret" | "bad_secret" | null; keys_version: number | null; config_version: number | null;
  config_error: string | null; providers: ProviderKeyRow[]; orphans: OrphanKey[]; loaded: LoadedWorker[];
}
/** The answer of a key write: the whole state, and whether the workers were told (false: they find out within 30 s). */
export type LlmKeysWrite = LlmKeysState & { workers_notified: boolean };
/** A test call: a role of a preset, or (Plan 23e) a provider with a model of its own. */
export type TestBody = Partial<LlmDraft> & { preset?: string } & (
  { role: string } | { provider: string; model: string; price_in?: number; price_out?: number });
export type LlmDraft = { config: LlmConfigDoc } | { yaml: string };
export interface CatalogQuery { q?: string; structured?: boolean; reasoning?: boolean; max_price?: number | null }

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
export type RuntimeKind = "settings" | "glossary" | "sources";
/** Plan 23d: the search sources (/api/v1/admin/sources). Mirrors backend/app/api/admin_runtime.py. */
export interface SourceRow {
  id: string; label: string; kind: "searxng" | "direct"; env: boolean; enabled: boolean; overridden: boolean;
}
export interface SourcesState {
  source: "db" | "env"; version: number | null; sources: SourceRow[]; extras: string[]; error: string | null;
  loaded: LoadedWorker[];
}
export interface SourcesReport {
  ok: boolean; errors: FieldError[]; warnings: string[]; document: { sources: Record<string, boolean> } | null;
  enabled: string[] | null;
}
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
