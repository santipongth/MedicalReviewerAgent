import type { LlmConfigDoc, LlmConfigState } from "./admin-types";

// Mirrors resolve_llm_config in backend/app/services/llm_config.py: which roles a preset resolves, and from what.
const CORE_ROLES = ["guard", "planner", "screener", "extractor", "synthesizer"];
/** Harness roles that, when the preset omits them, take another role's settings. */
const FALLBACK_ROLES: Record<string, string> = {
  normalizer: "planner", conflict_explainer: "extractor", localizer: "planner", refiner: "planner", enricher: "planner",
};
/** Harness roles that are simply off when the preset omits them (an override with a `model` can switch them on). */
const SWITCHED_ROLES = ["screener_secondary", "extractor_secondary", "escalation"];
const ALL_ROLES = [...CORE_ROLES, ...Object.keys(FALLBACK_ROLES), ...SWITCHED_ROLES];
const DEFAULT_PROVIDER = "openrouter";
/** A local server's key is optional, and the backend's validator skips this provider too. */
const KEY_OPTIONAL = "openai_compatible";

/** The provider each role of `preset` really calls (an override's, else the role's own, else the default), sorted and
 * without repeats. A provider that is only declared in `providers` is not here. */
export function usedProviders(config: LlmConfigDoc, preset: string): string[] {
  const roles = config.presets[preset];
  if (!roles) return [];
  const overrides = config.overrides ?? {};
  const used = new Set<string>();
  for (const role of ALL_ROLES) {
    const override = overrides[role];
    let provider: string | null | undefined;
    if (roles[role]) provider = roles[role].provider;
    else if (role in FALLBACK_ROLES) {
      const from = roles[FALLBACK_ROLES[role]];
      if (!from) continue;
      provider = from.provider;
    } else if (override && "model" in override) provider = undefined; // switched on purely by the override
    else continue;
    if (override && "provider" in override) provider = override.provider as string | null | undefined;
    used.add(provider ?? config.default_provider ?? DEFAULT_PROVIDER);
  }
  return [...used].sort();
}

/** Key variables that are not set although a role of the running preset (`state.active_preset`, which the service
 * resolves with LLM_PRESET already) needs them. Providers that are merely declared, and openai_compatible, never
 * appear. A variable the service did not report is not a warning. */
export function missingKeyEnvs(state: LlmConfigState): string[] {
  const missing = new Set<string>();
  for (const name of usedProviders(state.config, state.active_preset)) {
    if (name === KEY_OPTIONAL) continue;
    const env = state.config.providers[name]?.api_key_env;
    if (typeof env === "string" && state.keys_present[env] === false) missing.add(env);
  }
  return [...missing];
}
