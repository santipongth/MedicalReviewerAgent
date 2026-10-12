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
