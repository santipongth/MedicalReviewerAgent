import type { LlmConfigDoc, LlmConfigState, LlmVersion, Page, ValidateReport } from "@/lib/admin-types";

const ROLES = ["guard", "planner", "screener", "extractor", "synthesizer"] as const;
export const CONFIG: LlmConfigDoc = {
  active_preset: "cheap", default_provider: "openrouter",
  providers: { openrouter: { base_url: "https://openrouter.ai/api/v1", api_key_env: "OPENROUTER_API_KEY" } },
  presets: {
    cheap: Object.fromEntries(ROLES.map((r) => [r, { model: "vendor/cheap", max_tokens: 4096 }])),
    better: Object.fromEntries(ROLES.map((r) => [r, { model: "vendor/better" }])),
  },
};
export const STATE: LlmConfigState = {
  source: "db", version: 3, config: CONFIG, active_preset: "cheap", env_preset: null,
  keys_present: { OPENROUTER_API_KEY: true },
  loaded: [{ worker: "worker-1:7", version: "3", preset: "cheap", loaded_at: "2026-10-12T10:00:00Z", error: null }],
};
export const VERSIONS: Page<LlmVersion> = {
  items: [
    { id: 3, created_at: "2026-10-12T10:00:00Z", created_by: "owner", note: "cheaper", source: "edit",
      restored_from: null, active_preset: "cheap", changes: { active_preset: "better → cheap" } },
    { id: 2, created_at: "2026-10-11T10:00:00Z", created_by: "owner", note: null, source: "file",
      restored_from: null, active_preset: "better", changes: {} },
  ],
  next: null,
};
export const REPORT_OK: ValidateReport = {
  ok: true, errors: [], warnings: ["better: vendor/better not found on OpenRouter"],
  cost: { cheap: { total_usd: 0.0123, per_role: {}, unknown_models: [] },
          better: { total_usd: 0, per_role: {}, unknown_models: ["guard: openrouter:vendor/better"] } },
  config: CONFIG, yaml: "active_preset: cheap\n", role_errors: [],
};
