import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmKeysState } from "@/lib/admin-types";
import { mockAdminFetch } from "@/test/admin-fetch";
import { DEEPSEEK_ROW, KEYS_CONFIG, KEYS_STATE, OPENROUTER_ROW } from "@/test/admin-keys-fixtures";
import { ModelsProviders } from "./models-providers";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const fail = (e: unknown) => (e instanceof Error ? e.message : String(e));
const item = async (name: string) => {
  const list = await screen.findByRole("list", { name: "ผู้ให้บริการ" });
  return within(list).getAllByRole("listitem").find((li) => li.textContent?.startsWith(name))!;
};

describe("ModelsProviders follow-up (Plan 23e fix round 1)", () => {
  it("re-reads the keys when the saved config version changes", async () => {
    const fetch = mockAdminFetch((method, path) => (method === "GET" && path === "/llm-keys" ? [200, KEYS_STATE] : undefined));
    const { rerender } = render(<ModelsProviders draft={KEYS_CONFIG} setDraft={vi.fn()} fail={fail} version={3} />);
    await item("deepseek");
    const reads = () => fetch.mock.calls.filter(([url]) => String(url).endsWith("/llm-keys")).length;
    expect(reads()).toBe(1);
    rerender(<ModelsProviders draft={KEYS_CONFIG} setDraft={vi.fn()} fail={fail} version={4} />);
    await waitFor(() => expect(reads()).toBe(2));
  });

  it("settles the worker line after a key write: changing first, then matching once workers report the revision", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const behind = (keys: string): LlmKeysState => ({ ...KEYS_STATE, keys_version: 5,
      loaded: [{ ...KEYS_STATE.loaded[0], keys }] });
    let workerKeys = "4";
    const fetch = mockAdminFetch((method, path) => {
      if (method === "PUT") return [200, { ...behind(workerKeys), workers_notified: true }];
      if (method === "GET" && path === "/llm-keys") return [200, behind(workerKeys)];
      return undefined;
    });
    render(<ModelsProviders draft={KEYS_CONFIG} setDraft={vi.fn()} fail={fail} version={3} />);
    fireEvent.click(within(await item("openrouter")).getByRole("button", { name: "ใส่คีย์ของ openrouter" }));
    fireEvent.change(screen.getByLabelText("คีย์ของ openrouter"), { target: { value: "sk-test-abcd" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกคีย์" }));
    const worker = await screen.findByText(/worker-1:7/);
    expect(worker).toHaveTextContent("กำลังเปลี่ยนเป็น 5");
    expect(worker).not.toHaveClass("bg-warn-bg");
    workerKeys = "5";
    const reads = () => fetch.mock.calls.filter(([url, init]) => String(url).endsWith("/llm-keys") && (init?.method ?? "GET") === "GET").length;
    const before = reads();
    await act(async () => { vi.advanceTimersByTime(10_000); });
    await waitFor(() => expect(reads()).toBeGreaterThan(before));
    await waitFor(() => expect(screen.getByText(/worker-1:7/)).toHaveTextContent("ตรงกับที่ใช้งาน"));
  });

  it("moves focus into the key field on open, and back to the button on save and on cancel", async () => {
    mockAdminFetch((method, path) => {
      if (method === "PUT") return [200, { ...KEYS_STATE, workers_notified: true,
        providers: [{ ...OPENROUTER_ROW, key: { ...DEEPSEEK_ROW.key, last4: "abcd" } }, DEEPSEEK_ROW] }];
      return method === "GET" && path === "/llm-keys" ? [200, KEYS_STATE] : undefined;
    });
    render(<ModelsProviders draft={KEYS_CONFIG} setDraft={vi.fn()} fail={fail} version={3} />);
    const li = await item("openrouter");
    fireEvent.click(within(li).getByRole("button", { name: "ใส่คีย์ของ openrouter" }));
    const field = screen.getByLabelText("คีย์ของ openrouter");
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("autocomplete", "new-password");
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(screen.getByRole("button", { name: "ใส่คีย์ของ openrouter" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "ใส่คีย์ของ openrouter" }));
    fireEvent.change(screen.getByLabelText("คีย์ของ openrouter"), { target: { value: "sk-test-abcd" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกคีย์" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "เปลี่ยนคีย์ของ openrouter" })).toHaveFocus());
  });
});
