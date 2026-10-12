import { describe, expect, it } from "vitest";
import { CONFIG, STATE } from "@/test/admin-model-fixtures";
import { missingKeyEnvs, usedProviders } from "./admin-models";
import type { LlmConfigDoc, LlmConfigState, LlmRoleSpec } from "./admin-types";

const PROVIDERS = {
  openrouter: { base_url: "https://openrouter.ai/api/v1", api_key_env: "OPENROUTER_API_KEY" },
  anthropic: { api_key_env: "ANTHROPIC_API_KEY" },
  openai_compatible: { base_url: "http://localhost:11434/v1", api_key_env: "OPENAI_COMPATIBLE_API_KEY" },
};
const ALL_MISSING = { OPENROUTER_API_KEY: false, ANTHROPIC_API_KEY: false, OPENAI_COMPATIBLE_API_KEY: false };
const core = (spec: Partial<LlmRoleSpec>): Record<string, LlmRoleSpec> =>
  Object.fromEntries(["guard", "planner", "screener", "extractor", "synthesizer"].map((r) => [r, { model: "vendor/m", ...spec }]));

/** Three providers declared, the active preset uses openrouter only (the shipped llm.yaml's shape). */
const THREE: LlmConfigDoc = {
  active_preset: "cheap", default_provider: "openrouter", providers: PROVIDERS,
  presets: { cheap: core({}), claude: core({ provider: "anthropic" }) },
};
const state = (config: LlmConfigDoc, keys: Record<string, boolean>, over: Partial<LlmConfigState> = {}): LlmConfigState =>
  ({ ...STATE, config, active_preset: config.active_preset, keys_present: keys, ...over });

describe("usedProviders", () => {
  it("lists only the providers the active preset's roles use, not the ones merely declared", () => {
    expect(usedProviders(THREE, "cheap")).toEqual(["openrouter"]);
    expect(usedProviders(THREE, "claude")).toEqual(["anthropic"]);
  });

  it("gives a role without a provider the default provider, and openrouter when none is set", () => {
    expect(usedProviders({ ...THREE, default_provider: "anthropic" }, "cheap")).toEqual(["anthropic"]);
    const noDefault: LlmConfigDoc = { ...THREE };
    delete noDefault.default_provider;
    expect(usedProviders(noDefault, "cheap")).toEqual(["openrouter"]);
  });

  it("counts a provider named by one role of the preset", () => {
    const config = { ...THREE, presets: { cheap: { ...core({}), guard: { model: "m", provider: "anthropic" } } } };
    expect(usedProviders(config, "cheap")).toEqual(["anthropic", "openrouter"]);
  });

  it("applies an override to a harness role that falls back to another role's settings", () => {
    const config = { ...THREE, overrides: { localizer: { provider: "anthropic" } } };
    expect(usedProviders(config, "cheap")).toEqual(["anthropic", "openrouter"]);
  });

  it("counts a provider that only an override names", () => {
    const named = { ...THREE, overrides: { escalation: { model: "m", provider: "anthropic" } } };
    expect(usedProviders(named, "cheap")).toEqual(["anthropic", "openrouter"]);
    const reroutes = { ...THREE, overrides: { synthesizer: { provider: "anthropic" } } };
    expect(usedProviders(reroutes, "cheap")).toEqual(["anthropic", "openrouter"]);
  });

  it("counts an optional role enabled purely by an override with the default provider", () => {
    const config = { ...THREE, default_provider: "anthropic", presets: { cheap: core({ provider: "openrouter" }) },
      overrides: { escalation: { model: "m" } } };
    expect(usedProviders(config, "cheap")).toEqual(["anthropic", "openrouter"]);
  });

  it("does not count an optional role the preset omits and no override enables with a model", () => {
    const config = { ...THREE, overrides: { escalation: { provider: "anthropic", max_tokens: 100 } } };
    expect(usedProviders(config, "cheap")).toEqual(["openrouter"]);
  });

  it("is empty for a preset that does not exist", () => {
    expect(usedProviders(THREE, "nope")).toEqual([]);
  });
});

describe("missingKeyEnvs", () => {
  it("warns about the used provider's key and not about an unused provider's", () => {
    expect(missingKeyEnvs(state(THREE, ALL_MISSING))).toEqual(["OPENROUTER_API_KEY"]);
    expect(missingKeyEnvs(state(THREE, { ...ALL_MISSING, OPENROUTER_API_KEY: true }))).toEqual([]);
  });

  it("warns about the key of a used non-default provider", () => {
    expect(missingKeyEnvs(state({ ...THREE, active_preset: "claude" }, { ...ALL_MISSING, OPENROUTER_API_KEY: true })))
      .toEqual(["ANTHROPIC_API_KEY"]);
  });

  it("never warns about openai_compatible: a local server's key is optional", () => {
    const local = { ...THREE, presets: { cheap: core({ provider: "openai_compatible" }) } };
    expect(missingKeyEnvs(state(local, ALL_MISSING))).toEqual([]);
  });

  it("warns once when several roles share a provider, and not for a key the service did not report", () => {
    expect(missingKeyEnvs(state(CONFIG, { OPENROUTER_API_KEY: false }))).toEqual(["OPENROUTER_API_KEY"]);
    expect(missingKeyEnvs(state(CONFIG, {}))).toEqual([]);
  });

  it("judges the preset the service reports as running, not the config document's own active_preset", () => {
    // the service already puts LLM_PRESET into state.active_preset while llm.yaml is the source
    const running = state(THREE, { ...ALL_MISSING, OPENROUTER_API_KEY: true }, { source: "file", version: null, env_preset: "claude", active_preset: "claude" });
    expect(running.config.active_preset).toBe("cheap");
    expect(missingKeyEnvs(running)).toEqual(["ANTHROPIC_API_KEY"]);
  });
});
