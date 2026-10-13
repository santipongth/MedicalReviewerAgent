/** Ready-made OpenAI-compatible providers for the admin models page (Plan 23e). They are editable defaults copied into
 * the draft; the backend neither knows nor trusts them. The base URLs come from Claude's knowledge (2026-06), not a
 * fetch: the first "ทดสอบ" confirms them. `keyFrom` says where the admin gets a key (null: a local server needs none). */
export interface ProviderTemplate { id: string; label: string; name: string; baseUrl: string; keyFrom: string | null }

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  { id: "openai", label: "OpenAI", name: "openai", baseUrl: "https://api.openai.com/v1", keyFrom: "platform.openai.com" },
  { id: "gemini", label: "Gemini (OpenAI-compatible endpoint)", name: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", keyFrom: "Google AI Studio" },
  { id: "deepseek", label: "DeepSeek", name: "deepseek", baseUrl: "https://api.deepseek.com/v1", keyFrom: "platform.deepseek.com" },
  { id: "groq", label: "Groq", name: "groq", baseUrl: "https://api.groq.com/openai/v1", keyFrom: "console.groq.com" },
  { id: "mistral", label: "Mistral", name: "mistral", baseUrl: "https://api.mistral.ai/v1", keyFrom: "console.mistral.ai" },
  { id: "together", label: "Together", name: "together", baseUrl: "https://api.together.xyz/v1", keyFrom: "api.together.ai" },
  { id: "ollama", label: "Ollama (เครื่องนี้)", name: "ollama", baseUrl: "http://host.docker.internal:11434/v1", keyFrom: null },
];
