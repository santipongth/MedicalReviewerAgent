import type { AdminKey, AdminReview, AuditEntry, Dashboard, Page } from "@/lib/admin-types";

export const DASHBOARD: Dashboard = {
  days: 30, since: "2026-09-13",
  per_day: [
    { date: "2026-10-11", by_status: { done: 3 }, cost_usd: 0.21 },
    { date: "2026-10-12", by_status: { done: 4, error: 1 }, cost_usd: 0.31 },
  ],
  totals: { reviews: 8, by_status: { done: 7, error: 1 }, cost_usd: 0.52, avg_cost_done_usd: 0.072 },
  error_rate_7d: 0.125,
  by_model: [{ synthesizer: "openrouter:qwen/qwen3.5-flash-02-23", reviews: 7, cost_usd: 0.5 }, { synthesizer: "unknown", reviews: 1, cost_usd: 0.02 }],
  capacity: { accepting: true, reason: null, queued: 0, running: 1, max_queued_reviews: 50, reviews_today: 5,
    max_reviews_per_day: 500, usd_today: 0.4, max_usd_per_day: 10 },
};

export const REVIEWS: Page<AdminReview> = {
  items: [
    { id: "11111111-1111-4111-8111-111111111111", topic: "เมตฟอร์มินกับมะเร็งลำไส้ใหญ่", status: "running", review_type: "slr",
      created_at: "2026-10-12T09:00:00Z", finished_at: null, cost_usd: 0.01, is_listed: true, api_key_prefix: null,
      prompt_version: "2026-10-12.1", error: null },
    { id: "22222222-2222-4222-8222-222222222222", topic: "Statins and dementia", status: "done", review_type: "meta_analysis",
      created_at: "2026-10-11T09:00:00Z", finished_at: "2026-10-11T09:02:00Z", cost_usd: 0.074, is_listed: true,
      api_key_prefix: "mra_abcdefgh", prompt_version: "2026-10-12.1", error: null },
  ],
  next: null,
};

export const KEYS: AdminKey[] = [
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", key_prefix: "mra_abcdefgh", name: "partner lab", daily_quota: 100,
    is_admin: false, created_at: "2026-10-01T00:00:00Z", revoked_at: null, reviews_24h: 3 },
];

export const AUDIT: Page<AuditEntry> = {
  items: [
    { id: 2, created_at: "2026-10-12T10:00:00Z", actor_kind: "user", actor_label: "owner", action: "key.update",
      target_type: "key", target_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", before: { daily_quota: 10 }, after: { daily_quota: 100 } },
    { id: 1, created_at: "2026-10-12T09:59:00Z", actor_kind: "cli", actor_label: "cli", action: "admin.create",
      target_type: "admin", target_id: "x", before: null, after: { username: "owner" } },
  ],
  next: null,
};
