import type { KeyStatus, LlmConfigDoc, LlmConfigState, LlmRoleSpec, ProviderKind } from "./admin-types";

// Mirrors resolve_llm_config in backend/app/services/llm_config.py: which roles a preset resolves, and from what.
const CORE_ROLES = ["guard", "planner", "screener", "extractor", "synthesizer"];
/** Harness roles that, when the preset omits them, take another role's settings. */
const FALLBACK_ROLES: Record<string, string> = {
  normalizer: "planner", conflict_explainer: "extractor", localizer: "planner", refiner: "planner", enricher: "planner",
};
/** Harness roles that are simply off when the preset omits them (an override with a `model` can switch them on). */
const SWITCHED_ROLES = ["screener_secondary", "extractor_secondary", "escalation"];
export const ALL_ROLES = [...CORE_ROLES, ...Object.keys(FALLBACK_ROLES), ...SWITCHED_ROLES];
const DEFAULT_PROVIDER = "openrouter";
/** A local server's key is optional, and the backend's validator skips this provider too. */
const KEY_OPTIONAL = "openai_compatible";
/** Mirrors PROVIDER_KEYS and key_env in backend/app/services/llm_config.py (Plan 23e). */
const LEGACY_KEYS: Record<string, string> = {
  openrouter: "OPENROUTER_API_KEY", anthropic: "ANTHROPIC_API_KEY", openai_compatible: "OPENAI_COMPATIBLE_API_KEY",
};
const DEFAULT_ORIGINS: Record<string, string> = { openrouter: "https://openrouter.ai", anthropic: "https://api.anthropic.com" };
export const PROVIDER_NAME = /^[a-z][a-z0-9_]{0,31}$/;
export const MAX_PROVIDERS = 12;
/** Statuses with which the provider's roles cannot run. */
const NO_KEY: ReadonlySet<KeyStatus> = new Set<KeyStatus>(["none", "origin_mismatch", "unreadable", "env_origin_missing"]);

/** The one variable a provider's env key may come from. */
export const keyEnv = (name: string): string => LEGACY_KEYS[name] ?? `LLM_KEY_${name.toUpperCase()}`;

/** A provider's kind: its `kind`, or its name for the three legacy names. */
export function providerKind(name: string, spec: Record<string, unknown> | undefined): ProviderKind {
  const kind = spec?.kind;
  return (typeof kind === "string" ? kind : name) as ProviderKind;
}

/** The origin (scheme://host[:port]) a provider's calls go to, which a stored key is bound to; "" when it does not parse. */
export function providerOrigin(name: string, spec: Record<string, unknown> | undefined): string {
  const base = spec?.base_url;
  if (typeof base !== "string" || base === "") return DEFAULT_ORIGINS[providerKind(name, spec)] ?? "";
  try {
    return new URL(base).origin;
  } catch {
    return "";
  }
}

export const KIND_LABEL: Record<ProviderKind, string> = {
  openrouter: "OpenRouter", anthropic: "Anthropic", openai_compatible: "OpenAI-compatible",
};

export interface MissingKey { provider: string; env: string; status: KeyStatus }

/** Providers a role of the running preset uses whose key is missing or unusable (Plan 23e: from `key_status`, which
 * knows console keys, origins and local servers). An answer without `key_status` falls back to `keys_present` by
 * variable name, where the legacy local server never counts and a variable the service did not report is no warning. */
export function missingKeys(state: LlmConfigState): MissingKey[] {
  const out: MissingKey[] = [];
  for (const name of usedProviders(state.config, state.active_preset)) {
    const spec = state.config.providers[name];
    if (!spec) continue;
    const status = state.key_status?.[name];
    if (status !== undefined) {
      if (NO_KEY.has(status)) out.push({ provider: name, env: keyEnv(name), status });
      continue;
    }
    if (name === KEY_OPTIONAL) continue;
    const env = typeof spec.api_key_env === "string" ? spec.api_key_env : keyEnv(name);
    if (state.keys_present[env] === false) out.push({ provider: name, env, status: "none" });
  }
  return out;
}

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
 * resolves with LLM_PRESET already) needs them; missingKeys by variable name. */
export function missingKeyEnvs(state: LlmConfigState): string[] {
  return [...new Set(missingKeys(state).map((m) => m.env))];
}

/** The providers any role of any preset, or an override, uses (removing one of these would break the draft). */
export function providersInUse(config: LlmConfigDoc): Set<string> {
  const used = new Set<string>(Object.keys(config.presets).flatMap((p) => usedProviders(config, p)));
  for (const override of Object.values(config.overrides ?? {})) {
    if (typeof override.provider === "string") used.add(override.provider);
  }
  used.add(config.default_provider ?? DEFAULT_PROVIDER);
  return used;
}

/** Display order of roles in the editor (the backend accepts any order). Every role of ALL_ROLES, once. */
export const ROLE_ORDER = [
  "guard", "refiner", "planner", "screener", "screener_secondary", "extractor", "extractor_secondary",
  "normalizer", "conflict_explainer", "synthesizer", "localizer", "escalation", "enricher",
];

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Same content (a re-read gives new objects for the same configuration). Key order counts, so an editor that only
 * ever clones can tell "edited" from "not edited"; a mismatch errs on the side of keeping the admin's edits. */
export const sameConfig = (a: LlmConfigDoc, b: LlmConfigDoc): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The draft helpers return a new document and never touch the one they were given. */
export function setRole(doc: LlmConfigDoc, preset: string, role: string, patch: Partial<LlmRoleSpec>): LlmConfigDoc {
  const out = clone(doc);
  out.presets[preset][role] = { ...(out.presets[preset][role] ?? { model: "" }), ...patch } as LlmRoleSpec;
  return out;
}

export function copyPreset(doc: LlmConfigDoc, from: string, to: string): LlmConfigDoc {
  if (doc.presets[to]) throw new Error(`preset ${to} exists`); // truthiness, so "constructor" and "__proto__" count as taken
  const out = clone(doc);
  out.presets[to] = clone(doc.presets[from]);
  return out;
}

export function deletePreset(doc: LlmConfigDoc, name: string): LlmConfigDoc {
  if (doc.active_preset === name) throw new Error("the active preset cannot be deleted");
  const out = clone(doc);
  delete out.presets[name];
  return out;
}

export function setActive(doc: LlmConfigDoc, name: string): LlmConfigDoc {
  return { ...clone(doc), active_preset: name };
}

/** Plan 23e: add an OpenAI-compatible provider to the draft (it becomes real with the next saved version). */
export function addProvider(doc: LlmConfigDoc, name: string, baseUrl: string): LlmConfigDoc {
  if (doc.providers[name]) throw new Error(`provider ${name} exists`);
  const out = clone(doc);
  out.providers[name] = { kind: "openai_compatible", base_url: baseUrl, require_parameters: false };
  return out;
}

export function removeProvider(doc: LlmConfigDoc, name: string): LlmConfigDoc {
  if (providersInUse(doc).has(name)) throw new Error(`provider ${name} is in use`);
  const out = clone(doc);
  delete out.providers[name];
  return out;
}
