import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKERS_NOT_NOTIFIED } from "@/lib/admin-copy";
import type { AdminReply } from "@/test/admin-fetch";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { SETTINGS, SETTINGS_VERSIONS, SPECS, WORKER } from "@/test/admin-runtime-fixtures";
import { SettingsView, draftValues } from "./settings-view";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/settings" }));

// The fixture worker was last seen at 10:00:00Z; pin Date 30 s later (only Date: findBy and waitFor keep real timers).
const SEEN = Date.parse(WORKER.loaded_at);
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SEEN + 30_000); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); nav.replace.mockReset(); });

const QUEUE = "รีวิวที่รอคิวได้สูงสุด";
const SAVE = { name: "บันทึกเป็นเวอร์ชันใหม่" };
const routes = (state = SETTINGS) => (m: string, p: string): AdminReply | undefined =>
  m === "GET" && p === "/settings" ? [200, state] : m === "GET" && p.startsWith("/settings/versions") ? [200, SETTINGS_VERSIONS] : undefined;
const savedAs = (version: number, notified = true): AdminReply =>
  [201, { ...SETTINGS_VERSIONS.items[0], version, workers_notified: notified }];

describe("draftValues", () => {
  it("sends numbers as numbers, rates as typed, and leaves out the env rows", () => {
    expect(draftValues(SPECS, { review_rate_limit: " 9/hour ", max_queued_reviews: "90", max_usd_per_day: null, llm_concurrency: "x" }))
      .toEqual({ review_rate_limit: "9/hour", max_queued_reviews: 90, llm_concurrency: "x" });
  });
});

describe("SettingsView", () => {
  it("shows the source, the workers and each setting with its env value and the value in force", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<SettingsView />);
    expect(await screen.findByText("ใช้เวอร์ชัน 2 จาก DB")).toBeInTheDocument();
    const row = screen.getByRole("row", { name: new RegExp(QUEUE) });
    expect(row).toHaveTextContent("50");
    expect(row).toHaveTextContent("80");
    expect(within(row).getByLabelText(`ค่าใหม่: ${QUEUE}`)).toHaveValue("80");
    const worker = screen.getByText(/worker-1:7/);
    expect(worker).toHaveTextContent("ตรงกับที่ใช้งาน");
    expect(worker).not.toHaveClass("bg-warn-bg");
    // each group's table scrolls inside a named region a keyboard can reach, as on the glossary and harness pages
    const region = screen.getByRole("region", { name: "ตารางค่า ความจุ" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toContainElement(row);
  });

  it("marks a worker on another version, one that failed to reload, and one that went quiet", async () => {
    mockAdminFetch(routes({ ...SETTINGS, loaded: [
      { ...WORKER, worker: "behind:1", settings: "1" },
      { ...WORKER, worker: "broken:2", runtime_error: "graph build failed" },
      { ...WORKER, worker: "quiet:3", loaded_at: new Date(SEEN - 5 * 60_000).toISOString() },
    ] }));
    await renderAdmin(<SettingsView />);
    expect(await screen.findByText(/behind:1/)).toHaveTextContent("ยังใช้ 1");
    expect(screen.getByText(/broken:2/)).toHaveTextContent("โหลดไม่สำเร็จ: graph build failed");
    expect(screen.getByText(/quiet:3/)).toHaveTextContent("ไม่ได้รายงานเกิน 2 นาที");
    for (const name of [/behind:1/, /broken:2/, /quiet:3/]) expect(screen.getByText(name)).toHaveClass("bg-warn-bg");
  });

  it("validates, shows a field error beside its input, then saves on the version the draft came from", async () => {
    const posted: unknown[] = [];
    mockAdminFetch((m, p, body) => {
      if (m === "POST" && p === "/settings/validate") {
        const values = (body as { values: Record<string, unknown> }).values;
        return values.max_queued_reviews === 0
          ? [200, { ok: false, errors: [{ field: "max_queued_reviews", message: "max_queued_reviews: must be between 1 and 1000" }],
              warnings: [], values: null, worst_case_review_usd: null }]
          : [200, { ok: true, errors: [], warnings: ["llm_concurrency applies to reviews that start after the workers reload"],
              values: SETTINGS.values, worst_case_review_usd: 0.4 }];
      }
      if (m === "POST" && p === "/settings") { posted.push(body); return savedAs(3); }
      return routes()(m, p);
    });
    await renderAdmin(<SettingsView />);
    const input = await screen.findByLabelText(`ค่าใหม่: ${QUEUE}`);
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจ" }));
    expect(await screen.findByText("max_queued_reviews: must be between 1 and 1000")).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("ยังบันทึกไม่ได้"); // the refused check is announced
    fireEvent.change(input, { target: { value: "90" } });
    expect(screen.queryByText("max_queued_reviews: must be between 1 and 1000")).toBeNull(); // the check was of another draft
    fireEvent.click(screen.getByRole("checkbox", { name: "ตั้งค่าเอง: LLM call พร้อมกันต่อ worker" }));
    fireEvent.change(screen.getByLabelText("ค่าใหม่: LLM call พร้อมกันต่อ worker"), { target: { value: "8" } });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจ" }));
    const warning = await screen.findByText(/llm_concurrency applies/);
    expect(warning.closest("ul")).toHaveClass("bg-warn-bg"); // warnings are a warning tint, as on the models page
    expect(screen.getByText("ผ่านการตรวจ").closest('[role="status"]')).toContainElement(warning);
    fireEvent.change(screen.getByLabelText("หมายเหตุ (ไม่บังคับ)"), { target: { value: "more workers" } });
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText("บันทึกเป็นเวอร์ชัน 3 แล้ว")).toBeInTheDocument();
    expect(posted).toEqual([{ values: { max_queued_reviews: 90, llm_concurrency: 8 }, base_version: 2, note: "more workers" }]);
  });

  it("a save the server refuses marks every field it names beside its input, as a check does", async () => {
    const MAX = "max_queued_reviews: must be between 1 and 1000";
    const CONC = "llm_concurrency: must be between 1 and 64";
    mockAdminFetch((m, p) => (m === "POST" && p === "/settings"
      ? [422, { detail: MAX, errors: [{ field: "max_queued_reviews", message: MAX }, { field: "llm_concurrency", message: CONC }] }]
      : routes()(m, p)));
    await renderAdmin(<SettingsView />);
    const queue = await screen.findByLabelText(`ค่าใหม่: ${QUEUE}`);
    fireEvent.change(queue, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "ตั้งค่าเอง: LLM call พร้อมกันต่อ worker" }));
    const concurrency = screen.getByLabelText("ค่าใหม่: LLM call พร้อมกันต่อ worker");
    fireEvent.change(concurrency, { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByRole("alert")).toHaveTextContent("ยังบันทึกไม่ได้");
    expect(queue).toHaveAttribute("aria-invalid", "true");
    expect(concurrency).toHaveAttribute("aria-invalid", "true");
    expect(queue).toHaveAccessibleDescription(MAX);
    expect(concurrency).toHaveAccessibleDescription(CONC);
    expect(screen.queryByText(/บันทึกเป็นเวอร์ชัน \d+ แล้ว/)).toBeNull();
  });

  it("a refused save that answers after the draft was edited still shows its message", async () => {
    const MAX = "max_queued_reviews: must be between 1 and 1000";
    let answer: () => void = () => {};
    const inner = mockAdminFetch((m, p) => (m === "POST" && p === "/settings"
      ? [422, { detail: MAX, errors: [{ field: "max_queued_reviews", message: MAX }] }]
      : routes()(m, p)));
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") await new Promise<void>((resolve) => { answer = resolve; });
      return inner(input, init);
    });
    await renderAdmin(<SettingsView />);
    const queue = await screen.findByLabelText(`ค่าใหม่: ${QUEUE}`);
    fireEvent.change(queue, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", SAVE));
    fireEvent.change(queue, { target: { value: "70" } }); // edited while the save is in flight
    await act(async () => { answer(); });
    expect(await screen.findByRole("alert")).toHaveTextContent(MAX); // the notice, not a hidden field error
    expect(queue).not.toHaveAttribute("aria-invalid");
  });

  it("lists a message the server sends twice twice, in the notice and among the warnings, without a key warning", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockAdminFetch((m, p) => {
      if (m === "POST" && p === "/settings/validate") {
        return [200, { ok: true, errors: [], warnings: ["twice", "twice"], values: SETTINGS.values, worst_case_review_usd: 0.4 }];
      }
      if (m === "POST" && p === "/settings") {
        return [422, { detail: "refused", errors: [{ field: null, message: "once more" }, { field: null, message: "once more" }] }];
      }
      return routes()(m, p);
    });
    await renderAdmin(<SettingsView />);
    await screen.findByLabelText(`ค่าใหม่: ${QUEUE}`);
    fireEvent.click(screen.getByRole("button", { name: "ตรวจ" }));
    expect(await screen.findAllByText("twice")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findAllByText("once more")).toHaveLength(2);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("turning off ตั้งค่าเอง drops the override", async () => {
    const posted: unknown[] = [];
    mockAdminFetch((m, p, body) => {
      if (m === "POST" && p === "/settings") { posted.push(body); return savedAs(3); }
      return routes()(m, p);
    });
    await renderAdmin(<SettingsView />);
    fireEvent.click(await screen.findByRole("checkbox", { name: `ตั้งค่าเอง: ${QUEUE}` }));
    expect(screen.queryByLabelText(`ค่าใหม่: ${QUEUE}`)).toBeNull();
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText("บันทึกเป็นเวอร์ชัน 3 แล้ว")).toBeInTheDocument();
    expect(posted).toEqual([{ values: {}, base_version: 2 }]);
  });

  it("says when the workers were not told", async () => {
    mockAdminFetch((m, p) => (m === "POST" && p === "/settings" ? savedAs(3, false) : routes()(m, p)));
    await renderAdmin(<SettingsView />);
    fireEvent.change(await screen.findByLabelText(`ค่าใหม่: ${QUEUE}`), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText(WORKERS_NOT_NOTIFIED)).toBeInTheDocument();
  });

  it("re-reads after a 409, keeps the draft on its old base, and saves on the latest version once asked to", async () => {
    let version = 2;
    const posted: { base_version: number | null }[] = [];
    mockAdminFetch((m, p, body) => {
      if (m === "GET" && p === "/settings") return [200, { ...SETTINGS, version }];
      if (m === "POST" && p === "/settings") {
        posted.push(body as { base_version: number | null });
        if (posted.length === 1) { version = 5; return [409, { detail: "version 5 is in use now; reload the latest version and try again" }]; }
        return savedAs(6);
      }
      return routes()(m, p);
    });
    await renderAdmin(<SettingsView />);
    const input = await screen.findByLabelText(`ค่าใหม่: ${QUEUE}`);
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByRole("alert")).toHaveTextContent("มีผู้ดูแลอีกคนบันทึกเวอร์ชันใหม่ก่อน");
    expect(await screen.findByText("ใช้เวอร์ชัน 5 จาก DB")).toBeInTheDocument();
    expect(screen.getByLabelText(`ค่าใหม่: ${QUEUE}`)).toHaveValue("99");
    expect(screen.getByText("ร่างนี้แก้จากเวอร์ชัน 2 แต่ตอนนี้ใช้เวอร์ชัน 5 อยู่")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ใช้ร่างนี้ต่อจากเวอร์ชันล่าสุด" }));
    const note = await screen.findByText("ร่างนี้ใช้เวอร์ชัน 5 เป็นฐานแล้ว: บันทึกต่อจากเวอร์ชันนั้นได้");
    await waitFor(() => expect(note).toHaveFocus());
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText("บันทึกเป็นเวอร์ชัน 6 แล้ว")).toBeInTheDocument();
    expect(posted.map((b) => b.base_version)).toEqual([2, 5]);
  });

  it("discards the edits only after the in-page confirm", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<SettingsView />);
    const input = await screen.findByLabelText(`ค่าใหม่: ${QUEUE}`);
    fireEvent.change(input, { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิกการแก้ไข" }));
    expect(input).toHaveValue("99");
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันยกเลิกการแก้ไข" }));
    expect(await screen.findByLabelText(`ค่าใหม่: ${QUEUE}`)).toHaveValue("80");
  });

  it("moves focus to the draft note when it appears, not when the edit tab comes back", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<SettingsView />);
    fireEvent.change(await screen.findByLabelText(`ค่าใหม่: ${QUEUE}`), { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิกการแก้ไข" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันยกเลิกการแก้ไข" }));
    const NOTE = "ทิ้งการแก้ไขแล้ว: ร่างตรงกับเวอร์ชัน 2";
    await waitFor(() => expect(screen.getByText(NOTE)).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "ประวัติ" }));
    await screen.findByRole("listitem", { name: "เวอร์ชัน 2" });
    const editTab = screen.getByRole("button", { name: "แก้ไข" });
    editTab.focus();
    fireEvent.click(editTab);
    expect(await screen.findByText(NOTE)).toBeInTheDocument();
    expect(editTab).toHaveFocus();
  });
});

/** After a save the page re-reads every 10 s while a worker lags (the models page's rule, Plan 23b). */
describe("SettingsView follows the workers after a save", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"], now: SEEN + 30_000 });
    vi.stubGlobal("jest", { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
  });
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it("polls every 10 s until the workers report the new version, then stops", async () => {
    const s = { version: 2, worker: "2", gets: 0 };
    mockAdminFetch((m, p) => {
      if (m === "GET" && p === "/settings") {
        s.gets += 1;
        return [200, { ...SETTINGS, version: s.version, loaded: [{ ...WORKER, settings: s.worker, loaded_at: new Date(Date.now()).toISOString() }] }];
      }
      if (m === "POST" && p === "/settings") { s.version = 3; return savedAs(3); }
      return routes()(m, p);
    });
    await renderAdmin(<SettingsView />);
    fireEvent.change(await screen.findByLabelText(`ค่าใหม่: ${QUEUE}`), { target: { value: "70" } });
    fireEvent.click(screen.getByRole("button", SAVE));
    await screen.findByText("บันทึกเป็นเวอร์ชัน 3 แล้ว");
    await advance(0);
    const worker = () => screen.getByText(/worker-1:7/);
    expect(worker()).toHaveTextContent("กำลังเปลี่ยนเป็น 3 (ภายใน 30 วินาที)");
    const afterSave = s.gets;
    await advance(10_000);
    expect(s.gets).toBe(afterSave + 1);
    s.worker = "3";
    await advance(10_000);
    expect(worker()).toHaveTextContent("ตรงกับที่ใช้งาน");
    await advance(5 * 60_000);
    expect(s.gets).toBe(afterSave + 2);
  });
});
