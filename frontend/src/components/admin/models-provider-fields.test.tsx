import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmConfigDoc } from "@/lib/admin-types";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { KEYS_CONFIG, KEYS_STATE } from "@/test/admin-keys-fixtures";
import { STATE, VERSIONS } from "@/test/admin-model-fixtures";
import { ModelsPresets } from "./models-presets";
import { ModelsView } from "./models-view";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/models" }));
const SEEN = Date.parse("2026-10-14T09:00:00Z");
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SEEN + 30_000); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function presets(draft: LlmConfigDoc, knownPrices?: Record<string, [number, number]>) {
  const setDraft = vi.fn();
  render(<ModelsPresets draft={draft} setDraft={setDraft} fail={String} knownPrices={knownPrices} />);
  return setDraft;
}

describe("Presets tab provider and prices (Plan 23e)", () => {
  it("picks a role's provider from the draft's providers, with the default as the empty choice", () => {
    const setDraft = presets(KEYS_CONFIG);
    const select = screen.getByLabelText("provider ของ guard");
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual(
      ["ค่าเริ่มต้น (openrouter)", "openrouter (OpenRouter)", "deepseek (OpenAI-compatible)"]);
    fireEvent.change(select, { target: { value: "deepseek" } });
    expect(setDraft.mock.calls[0][0].presets.cheap.guard.provider).toBe("deepseek");
    fireEvent.change(screen.getByLabelText("provider ของ extractor"), { target: { value: "" } });
    expect(setDraft.mock.calls[1][0].presets.cheap.extractor.provider).toBeNull();
  });

  it("asks for prices off OpenRouter and shows a missing one", () => {
    const unpriced = { ...KEYS_CONFIG, presets: { ...KEYS_CONFIG.presets,
      cheap: { ...KEYS_CONFIG.presets.cheap, extractor: { model: "deepseek-chat", provider: "deepseek" } } } };
    const setDraft = presets(unpriced);
    expect(screen.queryByLabelText(/ราคา input ของ guard/)).not.toBeInTheDocument();  // OpenRouter: the catalog prices it
    expect(screen.getByText("ต้องใส่ราคา input และ output (USD ต่อ 1M token)")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("ราคา input ของ extractor (USD ต่อ 1M token)"), { target: { value: "0.27" } });
    expect(setDraft.mock.calls[0][0].presets.cheap.extractor.price_in).toBe(0.27);
  });

  it("shows an Anthropic model's known price as the placeholder and needs no typed price for it", () => {
    const direct = { ...KEYS_CONFIG, providers: { ...KEYS_CONFIG.providers, anthropic: {} },
      presets: { ...KEYS_CONFIG.presets, cheap: { ...KEYS_CONFIG.presets.cheap, guard: { model: "claude-haiku-4-5", provider: "anthropic" } } } };
    presets(direct, { "claude-haiku-4-5": [1, 5] });
    expect(screen.getByLabelText("ราคา input ของ guard (USD ต่อ 1M token)")).toHaveAttribute("placeholder", "1");
    expect(screen.getByLabelText("ราคา output ของ guard (USD ต่อ 1M token)")).toHaveAttribute("placeholder", "5");
    expect(screen.queryByText(/ต้องใส่ราคา/)).not.toBeInTheDocument();
  });
});

describe("ModelsView providers tab (Plan 23e)", () => {
  const routes = (method: string, path: string): [number, unknown] | undefined => {
    if (path === "/llm-config") {
      return [200, { ...STATE, config: KEYS_CONFIG, key_status: { openrouter: "env", deepseek: "origin_mismatch" }, known_prices: {} }];
    }
    if (path.startsWith("/llm-config/versions")) return [200, VERSIONS];
    if (path === "/llm-keys") return [200, KEYS_STATE];
    return undefined;
  };

  it("has the tab after Presets, warns in the header about an unusable key and keeps the save bar", async () => {
    mockAdminFetch(routes);
    await renderAdmin(<ModelsView />);
    expect(await screen.findByText("deepseek: คีย์ที่เก็บไว้ผูกกับ origin อื่น: role ที่ใช้ provider นี้จะรันไม่ได้")).toBeInTheDocument();
    const tabs = screen.getAllByRole("button", { pressed: false }).concat(screen.getAllByRole("button", { pressed: true }))
      .filter((b) => b.closest('[aria-label="ส่วนของหน้า"]')).map((b) => b.textContent);
    expect(tabs).toContain("ผู้ให้บริการและคีย์");
    fireEvent.click(screen.getByRole("button", { name: "ผู้ให้บริการและคีย์" }));
    expect(await screen.findByRole("list", { name: "ผู้ให้บริการ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "บันทึกเป็นเวอร์ชันใหม่" })).toBeInTheDocument();
  });
});
