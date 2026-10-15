import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmConfigDoc, LlmKeysState } from "@/lib/admin-types";
import { mockAdminFetch } from "@/test/admin-fetch";
import { DEEPSEEK_ROW, KEYS_CONFIG, KEYS_STATE, OPENROUTER_ROW, row } from "@/test/admin-keys-fixtures";
import { ModelsProviders, PROBE_NOTE, UNPRICED_COST, keyStatusText } from "./models-providers";

afterEach(() => { vi.unstubAllGlobals(); });

const KEY = "sk-test-0000000000000000abcd";

function show(state: LlmKeysState = KEYS_STATE, draft: LlmConfigDoc = KEYS_CONFIG, handler?: Parameters<typeof mockAdminFetch>[0]) {
  const fetch = mockAdminFetch((method, path, body) =>
    handler?.(method, path, body) ?? (method === "GET" && path === "/llm-keys" ? [200, state] : undefined));
  const setDraft = vi.fn();
  render(<ModelsProviders draft={draft} setDraft={setDraft} fail={(e) => (e instanceof Error ? e.message : String(e))} />);
  return { fetch, setDraft };
}

const item = async (name: string) => {
  const list = await screen.findByRole("list", { name: "ผู้ให้บริการ" });
  return within(list).getAllByRole("listitem").find((li) => li.textContent?.startsWith(name))!;
};

describe("keyStatusText", () => {
  it("says where each key comes from, or why there is none, and never more of a key than its last 4", () => {
    expect(keyStatusText(DEEPSEEK_ROW)).toBe("ตั้งจากหน้านี้ ••••a1b2");
    expect(keyStatusText(OPENROUTER_ROW)).toBe("ใช้ค่าจาก .env");
    expect(keyStatusText(row({ key: { source: "none", last4: null, updated_at: null } }))).toBe("ยังไม่มีคีย์");
    expect(keyStatusText(row({ keyless: true, key: { source: "none", last4: null } }))).toBe("ไม่ต้องใช้คีย์");
    expect(keyStatusText(row({ origin: "https://x.example", key: { source: "none", problem: "origin_mismatch" } })))
      .toBe("คีย์ที่เก็บไว้ผูกกับ https://api.deepseek.com — ใส่คีย์ใหม่สำหรับ https://x.example");
    expect(keyStatusText(row({ key: { source: "env", problem: "unreadable" } })))
      .toBe("ถอดรหัสคีย์ที่เก็บไว้ไม่ได้ (LLM_KEYS_SECRET เปลี่ยนไป) — ใส่ใหม่หรือลบ");
    expect(keyStatusText(row({ key: { source: "none", problem: "env_origin_missing" } })))
      .toBe("มี LLM_KEY_DEEPSEEK ใน .env แต่ไม่มี LLM_KEY_DEEPSEEK_ORIGIN ที่ตรงกับ https://api.deepseek.com");
  });
});

describe("ModelsProviders", () => {
  it("lists each provider with its kind, origin, roles and key status", async () => {
    show();
    const deepseek = await item("deepseek");
    expect(deepseek).toHaveTextContent("OpenAI-compatible · https://api.deepseek.com");
    expect(deepseek).toHaveTextContent("ใช้กับ: extractor");
    expect(deepseek).toHaveTextContent("ตั้งจากหน้านี้ ••••a1b2");
    expect(deepseek).toHaveTextContent("แก้ล่าสุดโดย owner");
    expect(within(deepseek).getByRole("button", { name: "เปลี่ยนคีย์ของ deepseek" })).toBeInTheDocument();
    expect(within(await item("openrouter")).getByRole("button", { name: "ใส่คีย์ของ openrouter" })).toBeInTheDocument();
  });

  it("sends a typed key once and clears the field, whether the save works or not", async () => {
    let fail = true;
    const { fetch } = show(KEYS_STATE, KEYS_CONFIG, (method, path) => {
      if (method === "PUT" && path === "/llm-keys/openrouter") {
        if (fail) { fail = false; return [409, { detail: "LLM_KEYS_SECRET is not set on the server", code: "no_secret" }]; }
        return [200, { ...KEYS_STATE, workers_notified: true,
          providers: [{ ...OPENROUTER_ROW, key: { ...DEEPSEEK_ROW.key, last4: "abcd", bound_origin: "https://openrouter.ai" } }, DEEPSEEK_ROW] }];
      }
      return undefined;
    });
    fireEvent.click(within(await item("openrouter")).getByRole("button", { name: "ใส่คีย์ของ openrouter" }));
    const field = screen.getByLabelText("คีย์ของ openrouter");
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveAttribute("autocomplete", "new-password");
    expect(field).toHaveAttribute("spellcheck", "false");
    fireEvent.change(field, { target: { value: KEY } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกคีย์" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("LLM_KEYS_SECRET is not set");
    expect(screen.getByLabelText("คีย์ของ openrouter")).toHaveValue("");  // refused: not kept
    fireEvent.change(screen.getByLabelText("คีย์ของ openrouter"), { target: { value: `${KEY} ` } }); // the server trims
    fireEvent.click(screen.getByRole("button", { name: "บันทึกคีย์" }));
    expect(await screen.findByText(/บันทึกแล้ว: worker ใช้คีย์ชุดนี้/)).toBeInTheDocument();
    expect(screen.queryByLabelText("คีย์ของ openrouter")).not.toBeInTheDocument();
    expect(await item("openrouter")).toHaveTextContent("ตั้งจากหน้านี้ ••••abcd");
    const puts = fetch.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(puts.map(([url, init]) => [String(url), JSON.parse(String(init?.body))])).toEqual([
      ["/api/v1/admin/llm-keys/openrouter", { key: KEY }], ["/api/v1/admin/llm-keys/openrouter", { key: `${KEY} ` }]]);
    expect(document.body.innerHTML).not.toContain(KEY);
  });

  it("asks before deleting a key and says what happens after", async () => {
    const { fetch } = show(KEYS_STATE, KEYS_CONFIG, (method, path) => (method === "DELETE" && path === "/llm-keys/deepseek"
      ? [200, { ...KEYS_STATE, workers_notified: false, providers: [OPENROUTER_ROW, row({ key: { source: "none", last4: null, updated_at: null } })] }]
      : undefined));
    fireEvent.click(within(await item("deepseek")).getByRole("button", { name: "ลบคีย์ของ deepseek" }));
    expect(screen.getByText(/หลังลบจะใช้คีย์จาก .env ถ้ามี/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันลบคีย์" }));
    await waitFor(() => expect(fetch.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(true));
    expect(await screen.findByText(/แจ้ง worker ไม่สำเร็จ/)).toBeInTheDocument();
    expect(await item("deepseek")).toHaveTextContent("ยังไม่มีคีย์");
  });

  it("is read-only without a usable secret, but a key can still be deleted", async () => {
    show({ ...KEYS_STATE, writable: false, reason: "no_secret" });
    expect(await screen.findByText("ยังใส่หรือเปลี่ยนคีย์จากหน้านี้ไม่ได้: เซิร์ฟเวอร์ไม่มี LLM_KEYS_SECRET")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /ใส่คีย์ของ|เปลี่ยนคีย์ของ/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ลบคีย์ของ deepseek" })).toBeInTheDocument();
  });

  it("asks for a saved version before a key for a provider that is only in the draft", async () => {
    const draft = { ...KEYS_CONFIG, providers: { ...KEYS_CONFIG.providers, groq: { kind: "openai_compatible", base_url: "https://api.groq.com/openai/v1" } } };
    const { setDraft } = show(KEYS_STATE, draft);
    const groq = await item("groq");
    expect(groq).toHaveTextContent("บันทึกเวอร์ชันก่อนจึงใส่คีย์ได้");
    expect(within(groq).queryByRole("button", { name: /คีย์/ })).not.toBeInTheDocument();
    fireEvent.click(within(groq).getByRole("button", { name: "เอา groq ออกจากร่าง" }));
    expect(setDraft.mock.calls[0][0].providers.groq).toBeUndefined();
  });

  it("warns that moving a provider to another origin in the draft silences its stored key", async () => {
    const moved = { ...KEYS_CONFIG, providers: { ...KEYS_CONFIG.providers, deepseek: { kind: "openai_compatible", base_url: "https://api.other.example/v1" } } };
    show(KEYS_STATE, moved);
    expect(await item("deepseek")).toHaveTextContent("เมื่อบันทึก คีย์ที่เก็บไว้จะหยุดใช้");
    const path = { ...KEYS_CONFIG, providers: { ...KEYS_CONFIG.providers, deepseek: { kind: "openai_compatible", base_url: "https://api.deepseek.com/beta" } } };
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
    show(KEYS_STATE, path);
    expect(await item("deepseek")).not.toHaveTextContent("เมื่อบันทึก");  // a path change keeps the key
  });

  it("adds a provider from a template, or a custom one, to the draft", async () => {
    const { setDraft } = show();
    await item("deepseek");
    fireEvent.change(screen.getByLabelText("แม่แบบ"), { target: { value: "groq" } });
    expect(screen.getByLabelText("ชื่อ")).toHaveValue("groq");
    expect(screen.getByLabelText("base URL")).toHaveValue("https://api.groq.com/openai/v1");
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มลงร่าง" }));
    expect(setDraft.mock.calls[0][0].providers.groq).toEqual(
      { kind: "openai_compatible", base_url: "https://api.groq.com/openai/v1", require_parameters: false });
    expect(screen.getByRole("status")).toHaveTextContent("เพิ่ม groq ลงร่างแล้ว");
    fireEvent.change(screen.getByLabelText("แม่แบบ"), { target: { value: "custom" } });
    fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "deepseek" } });
    fireEvent.change(screen.getByLabelText("base URL"), { target: { value: "https://x.example/v1" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มลงร่าง" }));
    expect(screen.getByRole("status")).toHaveTextContent("มีผู้ให้บริการชื่อ deepseek อยู่แล้ว");
    fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "Bad-Name" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มลงร่าง" }));
    expect(screen.getByRole("status")).toHaveTextContent("ชื่อใช้ได้เฉพาะ a-z");
    expect(setDraft).toHaveBeenCalledTimes(1);
  });

  it("tests a provider through a role that uses it, or a model typed for it", async () => {
    const unused = row({ name: "groq", used_by: [], origin: "https://api.groq.com" });
    const { fetch } = show({ ...KEYS_STATE, providers: [DEEPSEEK_ROW, unused] }, KEYS_CONFIG, (method, path) =>
      method === "POST" && path === "/llm-models/test" ? [200, { ok: true, latency_ms: 300, cost_usd: 0.0001, model: "m", error: null }] : undefined);
    fireEvent.click(within(await item("deepseek")).getByRole("button", { name: "ทดสอบ deepseek" }));
    expect(await screen.findByText(/ใช้ได้ · 300 ms/)).toBeInTheDocument();
    const groq = await item("groq");
    expect(within(groq).getByRole("button", { name: "ทดสอบ groq" })).toBeDisabled();
    fireEvent.change(within(groq).getByLabelText("model สำหรับทดสอบ groq"), { target: { value: "llama-3.3-70b" } });
    fireEvent.click(within(groq).getByRole("button", { name: "ทดสอบ groq" }));
    await waitFor(() => expect(fetch.mock.calls.filter(([, i]) => i?.method === "POST")).toHaveLength(2));
    const bodies = fetch.mock.calls.filter(([, i]) => i?.method === "POST").map(([, i]) => JSON.parse(String(i?.body)));
    expect(bodies).toEqual([{ role: "extractor" }, { provider: "groq", model: "llama-3.3-70b" }]);
  });

  it("lists keys left by removed providers, and which key revision each worker runs", async () => {
    show({ ...KEYS_STATE, orphans: [{ name: "together", last4: "9f0e", bound_origin: "https://api.together.xyz", updated_at: null, unreadable: false }],
      loaded: [...KEYS_STATE.loaded, { worker: "worker-2:9", version: "3", preset: "cheap", loaded_at: "2026-10-14T09:00:00Z", error: null, keys: "3" }] });
    expect(await screen.findByText(/••••9f0e/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ลบคีย์ของ together" })).toBeInTheDocument();
    expect(screen.getByText(/worker-2:9/)).toHaveTextContent("ยังใช้คีย์ชุดเดิม");
    expect(screen.getByText(/worker-1:7/)).toHaveTextContent("ตรงกับที่ใช้งาน");
  });
});

describe("ModelsProviders, Plan 31", () => {
  const probeFor = (answer: Record<string, unknown>) => (method: string, path: string) =>
    method === "POST" && path === "/llm-models/test" ? ([200, { ok: true, latency_ms: 300, model: "m", error: null, ...answer }] as [number, unknown]) : undefined;

  it("states the real cost of a test call and no longer promises a $0.05 ceiling", async () => {
    show();
    const deepseek = await item("deepseek");
    expect(deepseek).toHaveTextContent(PROBE_NOTE);
    expect(screen.queryByText(/\$0\.05/)).not.toBeInTheDocument();
  });

  it("shows an unpriced test as an unknown cost, never as $0.0000", async () => {
    show(KEYS_STATE, KEYS_CONFIG, probeFor({ priced: false, cost_usd: null }));
    fireEvent.click(within(await item("deepseek")).getByRole("button", { name: "ทดสอบ deepseek" }));
    expect(await screen.findByText(UNPRICED_COST, { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.0000/)).not.toBeInTheDocument();
  });

  it("offers an optional key for a keyless local provider, and none where a key may not be sent", async () => {
    const local = row({ name: "ollama", used_by: [], origin: "http://localhost:11434", keyless: true, key_allowed: true,
      key: { source: "none", last4: null, updated_at: null, updated_by: null } });
    const plain = row({ name: "lan", used_by: [], origin: "http://10.0.0.5:8000", keyless: true, key_allowed: false,
      key: { source: "none", last4: null, updated_at: null, updated_by: null } });
    show({ ...KEYS_STATE, providers: [local, plain] });
    const ollama = await item("ollama");
    expect(within(ollama).getByRole("button", { name: "ใส่คีย์ (ไม่บังคับ)ของ ollama" })).toBeInTheDocument();
    const lan = await item("lan");
    expect(within(lan).queryByRole("button", { name: /คีย์/ })).not.toBeInTheDocument();
    expect(lan).toHaveTextContent("ใส่คีย์ได้เฉพาะ https หรือเครื่องนี้");
  });

  it("removes a saved provider from the draft only when no role uses it, and never a legacy one", async () => {
    const groq = row({ name: "groq", used_by: [], origin: "https://api.groq.com" });
    const draft = { ...KEYS_CONFIG, providers: { ...KEYS_CONFIG.providers, groq: { kind: "openai_compatible", base_url: "https://api.groq.com/openai/v1" } } };
    const { setDraft } = show({ ...KEYS_STATE, providers: [OPENROUTER_ROW, DEEPSEEK_ROW, groq] }, draft);
    fireEvent.click(within(await item("groq")).getByRole("button", { name: "เอา groq ออกจากร่าง" }));
    expect(setDraft.mock.calls[0][0].providers.groq).toBeUndefined();
    expect(within(await item("deepseek")).getByRole("button", { name: "เอา deepseek ออกจากร่าง" })).toBeDisabled();
    expect(within(await item("openrouter")).queryByRole("button", { name: /ออกจากร่าง/ })).not.toBeInTheDocument();
  });

  it("keeps focus on the providers list after a removal, and ties the in-use hint to its disabled button", async () => {
    const groq = row({ name: "groq", used_by: [], origin: "https://api.groq.com" });
    const start = { ...KEYS_CONFIG, providers: { ...KEYS_CONFIG.providers,
      groq: { kind: "openai_compatible", base_url: "https://api.groq.com/openai/v1" },
      mistral: { kind: "openai_compatible", base_url: "https://api.mistral.ai/v1" } } };
    mockAdminFetch((method, path) => (method === "GET" && path === "/llm-keys" ? [200, { ...KEYS_STATE, providers: [OPENROUTER_ROW, DEEPSEEK_ROW, groq] }] : undefined));
    function Stateful() {
      const [draft, setDraft] = useState<LlmConfigDoc>(start);
      return <ModelsProviders draft={draft} setDraft={setDraft} fail={String} />;
    }
    render(<Stateful />);
    expect(within(await item("deepseek")).getByRole("button", { name: "เอา deepseek ออกจากร่าง" }))
      .toHaveAccessibleDescription("มี role ใช้อยู่ เปลี่ยน role ก่อน");
    const list = screen.getByRole("list", { name: "ผู้ให้บริการ" });
    fireEvent.click(within(await item("groq")).getByRole("button", { name: "เอา groq ออกจากร่าง" })); // saved row
    await waitFor(() => expect(screen.queryByRole("button", { name: "เอา groq ออกจากร่าง" })).not.toBeInTheDocument());
    expect(list).toHaveFocus();
    (document.activeElement as HTMLElement).blur();
    fireEvent.click(await screen.findByRole("button", { name: "เอา mistral ออกจากร่าง" })); // draft-only row
    await waitFor(() => expect(screen.queryByRole("button", { name: "เอา mistral ออกจากร่าง" })).not.toBeInTheDocument());
    expect(list).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });
});
