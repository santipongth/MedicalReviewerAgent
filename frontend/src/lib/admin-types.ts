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
}
export interface LlmConfigDoc {
  active_preset: string; default_provider?: string; providers: Record<string, Record<string, unknown>>;
  presets: Record<string, Record<string, LlmRoleSpec>>; harness?: Record<string, unknown>;
  overrides?: Record<string, Record<string, unknown>>;
}
/** `loaded_at` is when the worker last reported (it re-reports every 30 s), not when it loaded the version. */
export interface LoadedWorker { worker: string; version: string; preset: string; loaded_at: string; error: string | null }
export interface LlmConfigState {
  source: "db" | "file"; version: number | null; config: LlmConfigDoc; active_preset: string; env_preset: string | null;
  keys_present: Record<string, boolean>; loaded: LoadedWorker[];
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
export type LlmDraft = { config: LlmConfigDoc } | { yaml: string };
export interface CatalogQuery { q?: string; structured?: boolean; reasoning?: boolean; max_price?: number | null }
