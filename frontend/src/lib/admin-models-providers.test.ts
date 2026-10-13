import { describe, expect, it } from "vitest";
import { KEYS_CONFIG } from "@/test/admin-keys-fixtures";
import { STATE } from "@/test/admin-model-fixtures";
import { addProvider, keyEnv, missingKeyEnvs, missingKeys, providerKind, providerOrigin, providersInUse, removeProvider } from "./admin-models";
import type { LlmConfigState } from "./admin-types";
import { PROVIDER_TEMPLATES } from "./provider-templates";

const state = (over: Partial<LlmConfigState>): LlmConfigState => ({ ...STATE, config: KEYS_CONFIG, ...over });

describe("provider helpers (Plan 23e)", () => {
  it("names the one variable a provider's env key may come from", () => {
    expect(keyEnv("openrouter")).toBe("OPENROUTER_API_KEY");
    expect(keyEnv("openai_compatible")).toBe("OPENAI_COMPATIBLE_API_KEY");
    expect(keyEnv("deepseek")).toBe("LLM_KEY_DEEPSEEK");
  });

  it("reads a kind, inferring it for the legacy names", () => {
    expect(providerKind("anthropic", {})).toBe("anthropic");
    expect(providerKind("deepseek", { kind: "openai_compatible" })).toBe("openai_compatible");
  });

  it("gives the origin a key is bound to: scheme, host and a non-default port", () => {
    expect(providerOrigin("deepseek", { base_url: "https://API.deepseek.com:443/v1" })).toBe("https://api.deepseek.com");
    expect(providerOrigin("ollama", { base_url: "http://localhost:11434/v1" })).toBe("http://localhost:11434");
    expect(providerOrigin("openrouter", {})).toBe("https://openrouter.ai");
    expect(providerOrigin("anthropic", undefined)).toBe("https://api.anthropic.com");
    expect(providerOrigin("x", { base_url: "not a url" })).toBe("");
  });

  it("adds an OpenAI-compatible provider and removes one only while nothing uses it", () => {
    const added = addProvider(KEYS_CONFIG, "groq", "https://api.groq.com/openai/v1");
    expect(added.providers.groq).toEqual({ kind: "openai_compatible", base_url: "https://api.groq.com/openai/v1", require_parameters: false });
    expect(KEYS_CONFIG.providers.groq).toBeUndefined();
    expect(() => addProvider(added, "groq", "https://x.example")).toThrow();
    expect(removeProvider(added, "groq").providers.groq).toBeUndefined();
    expect(() => removeProvider(KEYS_CONFIG, "deepseek")).toThrow(/in use/);
    expect(providersInUse(KEYS_CONFIG)).toEqual(new Set(["openrouter", "deepseek"]));
  });

  it("offers the seven templates with an editable name and base URL each", () => {
    expect(PROVIDER_TEMPLATES.map((t) => t.name)).toEqual(["openai", "gemini", "deepseek", "groq", "mistral", "together", "ollama"]);
    expect(PROVIDER_TEMPLATES.every((t) => /^[a-z][a-z0-9_]*$/.test(t.name) && /^https?:\/\//.test(t.baseUrl))).toBe(true);
  });
});

describe("missingKeys (Plan 23e)", () => {
  it("follows key_status: a console or env key is fine, a problem or none is not, a local server needs none", () => {
    expect(missingKeys(state({ key_status: { openrouter: "console", deepseek: "env" } }))).toEqual([]);
    expect(missingKeys(state({ key_status: { openrouter: "none", deepseek: "origin_mismatch" } }))).toEqual([
      { provider: "deepseek", env: "LLM_KEY_DEEPSEEK", status: "origin_mismatch" },
      { provider: "openrouter", env: "OPENROUTER_API_KEY", status: "none" },
    ]);
    expect(missingKeys(state({ key_status: { openrouter: "not_needed", deepseek: "unreadable" } })).map((m) => m.status)).toEqual(["unreadable"]);
  });

  it("falls back to keys_present by variable when the answer has no key_status", () => {
    expect(missingKeyEnvs(state({ keys_present: { OPENROUTER_API_KEY: false, LLM_KEY_DEEPSEEK: false } })))
      .toEqual(["LLM_KEY_DEEPSEEK", "OPENROUTER_API_KEY"]);
  });

  it("only counts providers the running preset uses", () => {
    expect(missingKeys(state({ active_preset: "better", key_status: { openrouter: "env", deepseek: "none" } }))).toEqual([]);
  });
});
