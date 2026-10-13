import type { LlmConfigDoc, LlmKeysState, ProviderKeyRow } from "@/lib/admin-types";
import { CONFIG } from "./admin-model-fixtures";

/** Plan 23e fixtures: a draft with OpenRouter and DeepSeek, and the provider-key state the API answers for it. */
export const KEYS_CONFIG: LlmConfigDoc = {
  ...CONFIG,
  providers: {
    ...CONFIG.providers,
    deepseek: { kind: "openai_compatible", base_url: "https://api.deepseek.com/v1", require_parameters: false },
  },
  presets: {
    ...CONFIG.presets,
    cheap: { ...CONFIG.presets.cheap, extractor: { model: "deepseek-chat", provider: "deepseek", price_in: 0.27, price_out: 1.1 } },
  },
};

const noKey: ProviderKeyRow["key"] = { source: "none", problem: null, last4: null, bound_origin: null, updated_at: null, updated_by: null };

export const OPENROUTER_ROW: ProviderKeyRow = {
  name: "openrouter", kind: "openrouter", origin: "https://openrouter.ai", used_by: ["guard", "planner"], keyless: false,
  key: { ...noKey, source: "env" }, env: { name: "OPENROUTER_API_KEY", set: true, origin_ok: true },
};
export const DEEPSEEK_ROW: ProviderKeyRow = {
  name: "deepseek", kind: "openai_compatible", origin: "https://api.deepseek.com", used_by: ["extractor"], keyless: false,
  key: { source: "console", problem: null, last4: "a1b2", bound_origin: "https://api.deepseek.com",
    updated_at: "2026-10-14T09:00:00Z", updated_by: "owner" },
  env: { name: "LLM_KEY_DEEPSEEK", set: false, origin_ok: false },
};

export const KEYS_STATE: LlmKeysState = {
  writable: true, reason: null, keys_version: 4, config_version: 3, config_error: null,
  providers: [OPENROUTER_ROW, DEEPSEEK_ROW], orphans: [],
  loaded: [{ worker: "worker-1:7", version: "3", preset: "cheap", loaded_at: "2026-10-14T09:00:00Z", error: null, keys: "4" }],
};

export const row = (over: Omit<Partial<ProviderKeyRow>, "key"> & { key?: Partial<ProviderKeyRow["key"]> }): ProviderKeyRow =>
  ({ ...DEEPSEEK_ROW, ...over, key: { ...DEEPSEEK_ROW.key, ...over.key } });
