import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmConfigDoc } from "@/lib/admin-types";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { CONFIG } from "@/test/admin-model-fixtures";
import { AdminGate } from "./admin-gate";
import { ModelsCatalog } from "./models-catalog";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/models" }));
afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

const ITEMS = [
  { id: "qwen/qwen3.5-flash", context_length: 128000, price_in_per_m: 0.1, price_out_per_m: 0.4, structured: true, tools: true, reasoning: true },
  { id: "google/gemini-3.1-flash-lite", context_length: 1000000, price_in_per_m: 0.1, price_out_per_m: 0.4, structured: true, tools: true, reasoning: false },
];
const USE = { name: "ใช้กับ role ที่เลือก" };

describe("ModelsCatalog", () => {
  it("searches with filters and puts a model into a role of the draft", async () => {
    const setDraft = vi.fn();
    const fetch = mockAdminFetch((m, p) => (p.startsWith("/llm-models") ? [200, { items: ITEMS, available: true }] : undefined));
    await renderAdmin(<ModelsCatalog draft={CONFIG} setDraft={setDraft} />);
    fireEvent.change(screen.getByLabelText("ค้นหาโมเดล"), { target: { value: "qwen" } });
    fireEvent.click(screen.getByLabelText("รองรับ structured output"));
    fireEvent.click(screen.getByRole("button", { name: "ค้นหา" }));
    await waitFor(() => expect(fetch.mock.calls.some(([u]) => String(u) === "/api/v1/admin/llm-models?q=qwen&structured=true")).toBe(true));
    const row = await screen.findByRole("row", { name: /qwen\/qwen3\.5-flash/ });
    expect(row).toHaveTextContent("0.1");
    fireEvent.change(screen.getByLabelText("ใส่ใน role"), { target: { value: "cheap.synthesizer" } });
    fireEvent.click(within(row).getByRole("button", { name: "ใช้กับ role ที่เลือก" }));
    expect((setDraft.mock.calls[0][0] as LlmConfigDoc).presets.cheap.synthesizer.model).toBe("qwen/qwen3.5-flash");
    expect(screen.getByRole("status")).toHaveTextContent("cheap.synthesizer");
  });

  it("says when the catalog is unavailable", async () => {
    mockAdminFetch((m, p) => (p.startsWith("/llm-models") ? [200, { items: [], available: false }] : undefined));
    await renderAdmin(<ModelsCatalog draft={CONFIG} setDraft={() => {}} />);
    expect(await screen.findByText(/ดึง catalog ของ OpenRouter ไม่ได้/)).toBeInTheDocument();
  });

  it("changes only the model of a role that already uses OpenRouter", async () => {
    const setDraft = vi.fn();
    mockAdminFetch((m, p) => (p.startsWith("/llm-models") ? [200, { items: ITEMS, available: true }] : undefined));
    await renderAdmin(<ModelsCatalog draft={CONFIG} setDraft={setDraft} />);
    fireEvent.click(within(await screen.findByRole("row", { name: /qwen\/qwen3\.5-flash/ })).getByRole("button", USE));
    expect((setDraft.mock.calls[0][0] as LlmConfigDoc).presets.cheap.synthesizer).toEqual({ model: "qwen/qwen3.5-flash", max_tokens: 4096 });
    expect(screen.getByRole("status")).not.toHaveTextContent("provider");
  });

  it("moves a role of another provider to openrouter, since every model here is an OpenRouter model, and says so", async () => {
    const setDraft = vi.fn();
    const draft: LlmConfigDoc = {
      ...CONFIG,
      providers: { ...CONFIG.providers, anthropic: { api_key_env: "ANTHROPIC_API_KEY" } },
      presets: { ...CONFIG.presets, cheap: { ...CONFIG.presets.cheap, synthesizer: { model: "claude-x", provider: "anthropic" } } },
    };
    mockAdminFetch((m, p) => (p.startsWith("/llm-models") ? [200, { items: ITEMS, available: true }] : undefined));
    await renderAdmin(<ModelsCatalog draft={draft} setDraft={setDraft} />);
    fireEvent.click(within(await screen.findByRole("row", { name: /qwen\/qwen3\.5-flash/ })).getByRole("button", USE));
    expect((setDraft.mock.calls[0][0] as LlmConfigDoc).presets.cheap.synthesizer)
      .toEqual({ model: "qwen/qwen3.5-flash", provider: "openrouter" });
    expect(screen.getByRole("status")).toHaveTextContent("provider เป็น openrouter (เดิม anthropic)");
  });

  it("falls back to a role the draft has when the chosen one is no longer in it", async () => {
    const setDraft = vi.fn();
    mockAdminFetch((m, p) => (p.startsWith("/llm-models") ? [200, { items: ITEMS, available: true }] : undefined));
    const { rerender } = await renderAdmin(<ModelsCatalog draft={CONFIG} setDraft={setDraft} />);
    const row = await screen.findByRole("row", { name: /qwen\/qwen3\.5-flash/ });
    fireEvent.change(screen.getByLabelText("ใส่ใน role"), { target: { value: "better.guard" } });
    const onlyCheap: LlmConfigDoc = { ...CONFIG, presets: { cheap: CONFIG.presets.cheap } };
    rerender(<AdminGate><ModelsCatalog draft={onlyCheap} setDraft={setDraft} /></AdminGate>);
    expect(screen.getByLabelText("ใส่ใน role")).toHaveValue("cheap.guard"); // what the select shows is what is used
    fireEvent.click(within(row).getByRole("button", USE));
    const out = setDraft.mock.calls[0][0] as LlmConfigDoc;
    expect(Object.keys(out.presets)).toEqual(["cheap"]);
    expect(out.presets.cheap.guard.model).toBe("qwen/qwen3.5-flash");
  });
});
