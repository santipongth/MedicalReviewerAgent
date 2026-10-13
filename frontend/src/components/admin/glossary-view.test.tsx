import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WORKERS_NOT_NOTIFIED } from "@/lib/admin-copy";
import type { GlossaryTerm } from "@/lib/admin-types";
import type { AdminReply } from "@/test/admin-fetch";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { GLOSSARY, GLOSSARY_VERSIONS, WORKER } from "@/test/admin-runtime-fixtures";
import { GlossaryView } from "./glossary-view";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/glossary" }));
const SEEN = Date.parse(WORKER.loaded_at);
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SEEN + 30_000); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); nav.replace.mockReset(); });

const SAVE = { name: "บันทึกเป็นเวอร์ชันใหม่" };
const routes = (state = GLOSSARY) => (m: string, p: string): AdminReply | undefined =>
  m === "GET" && p === "/glossary" ? [200, state] : m === "GET" && p.startsWith("/glossary/versions") ? [200, GLOSSARY_VERSIONS] : undefined;

describe("GlossaryView", () => {
  it("shows the source, the terms and their notes", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<GlossaryView />);
    expect(await screen.findByText("ใช้อภิธานศัพท์เวอร์ชัน 4 จาก DB")).toBeInTheDocument();
    expect(screen.getByLabelText("English คำที่ 2")).toHaveValue("placebo");
    expect(screen.getByLabelText("หมายเหตุ คำที่ 2")).toHaveValue("ไม่ใช่ยาจริง");
    expect(screen.getByText(/worker-1:7/)).toHaveTextContent("ตรงกับที่ใช้งาน");
  });

  it("adds a term, shows a cell error, previews and saves the terms on the version they came from", async () => {
    const posted: unknown[] = [];
    mockAdminFetch((m, p, body) => {
      if (m === "POST" && p === "/glossary/validate") {
        const terms = (body as { terms: GlossaryTerm[] }).terms;
        return terms[2].th === ""
          ? [200, { ok: false, errors: [{ field: "terms.2.th", message: "terms.2.th: required" }], warnings: [], preview: null, chars: null }]
          : [200, { ok: true, errors: [], warnings: [],
              preview: "hazard ratio = อัตราส่วนฮาซาร์ด (HR); placebo = ยาหลอก; mortality = อัตราการเสียชีวิต", chars: 80 }];
      }
      if (m === "POST" && p === "/glossary") {
        posted.push(body);
        return [201, { ...GLOSSARY_VERSIONS.items[0], version: 5, workers_notified: true }];
      }
      return routes()(m, p);
    });
    await renderAdmin(<GlossaryView />);
    await screen.findByLabelText("English คำที่ 1");
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มคำ" }));
    const en = screen.getByLabelText("English คำที่ 3");
    await waitFor(() => expect(en).toHaveFocus());
    fireEvent.change(en, { target: { value: "mortality" } });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจ" }));
    expect(await screen.findByText("terms.2.th: required")).toBeInTheDocument();
    expect(screen.getByLabelText("ภาษาไทย คำที่ 3")).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(screen.getByLabelText("ภาษาไทย คำที่ 3"), { target: { value: "อัตราการเสียชีวิต" } });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจ" }));
    expect(await screen.findByText(/mortality = อัตราการเสียชีวิต/)).toBeInTheDocument();
    expect(screen.getByText("80 / 4000 ตัวอักษร")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText("บันทึกเป็นเวอร์ชัน 5 แล้ว")).toBeInTheDocument();
    expect(posted).toEqual([{ base_version: 4, terms: [
      { en: "hazard ratio", th: "อัตราส่วนฮาซาร์ด", abbr: "HR", note: null },
      { en: "placebo", th: "ยาหลอก", abbr: null, note: "ไม่ใช่ยาจริง" },
      { en: "mortality", th: "อัตราการเสียชีวิต", abbr: null, note: null }] }]);
  });

  it("filters the table, removes a term and puts focus on the add button", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<GlossaryView />);
    fireEvent.change(await screen.findByLabelText("ค้นหาคำ"), { target: { value: "placebo" } });
    expect(screen.queryByLabelText("English คำที่ 1")).toBeNull();
    fireEvent.change(screen.getByLabelText("ค้นหาคำ"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "ลบคำที่ 1" }));
    expect(screen.getByLabelText("English คำที่ 1")).toHaveValue("placebo");
    await waitFor(() => expect(screen.getByRole("button", { name: "เพิ่มคำ" })).toHaveFocus());
  });

  it("keeps the row being edited on screen under a filter until the filter changes", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<GlossaryView />);
    const search = await screen.findByLabelText("ค้นหาคำ");
    fireEvent.change(search, { target: { value: "placebo" } });
    fireEvent.change(screen.getByLabelText("English คำที่ 2"), { target: { value: "placeb" } });
    expect(screen.getByLabelText("English คำที่ 2")).toHaveValue("placeb");
    fireEvent.change(search, { target: { value: "placebo " } });
    expect(screen.queryByLabelText("English คำที่ 2")).toBeNull();
  });

  it("re-reads after a 409 and keeps the draft, which can be discarded after the confirm", async () => {
    let version = 4;
    mockAdminFetch((m, p) => {
      if (m === "GET" && p === "/glossary") return [200, { ...GLOSSARY, version }];
      if (m === "POST" && p === "/glossary") { version = 6; return [409, { detail: "version 6 is in use now; reload the latest version and try again" }]; }
      return routes()(m, p);
    });
    await renderAdmin(<GlossaryView />);
    fireEvent.change(await screen.findByLabelText("ภาษาไทย คำที่ 2"), { target: { value: "ยาเปล่า" } });
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByRole("alert")).toHaveTextContent("มีผู้ดูแลอีกคนบันทึกเวอร์ชันใหม่ก่อน");
    expect(await screen.findByText("ร่างนี้แก้จากเวอร์ชัน 4 แต่ตอนนี้ใช้เวอร์ชัน 6 อยู่")).toBeInTheDocument();
    expect(screen.getByLabelText("ภาษาไทย คำที่ 2")).toHaveValue("ยาเปล่า");
    fireEvent.click(screen.getByRole("button", { name: "ทิ้งการแก้ไข" }));
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันทิ้งการแก้ไข" }));
    expect(await screen.findByText("ทิ้งการแก้ไขแล้ว: ร่างตรงกับเวอร์ชัน 6")).toBeInTheDocument();
    expect(screen.getByLabelText("ภาษาไทย คำที่ 2")).toHaveValue("ยาหลอก");
  });

  it("a save the server refuses marks every cell it names beside its input, as a check does", async () => {
    const TH = "terms.0.th: must contain Thai";
    const ABBR = "terms.1.abbr: no brackets (the abbreviation has its own field)";
    const posted: unknown[] = [];
    mockAdminFetch((m, p, body) => {
      if (m === "POST" && p === "/glossary") {
        posted.push(body);
        return [422, { detail: TH, errors: [{ field: "terms.0.th", message: TH }, { field: "terms.1.abbr", message: ABBR }] }];
      }
      return routes()(m, p);
    });
    await renderAdmin(<GlossaryView />);
    const th = await screen.findByLabelText("ภาษาไทย คำที่ 1");
    const abbr = screen.getByLabelText("ตัวย่อ คำที่ 2");
    fireEvent.change(th, { target: { value: "hazard ratio" } });
    fireEvent.change(abbr, { target: { value: "(PL)" } });
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByRole("alert")).toHaveTextContent("ยังบันทึกไม่ได้");
    expect(th).toHaveAttribute("aria-invalid", "true");
    expect(abbr).toHaveAttribute("aria-invalid", "true");
    expect(th).toHaveAccessibleDescription(TH);
    expect(abbr).toHaveAccessibleDescription(ABBR);
    expect(screen.getByLabelText("English คำที่ 1")).not.toHaveAttribute("aria-invalid");
    expect(posted).toHaveLength(1);
    expect(screen.queryByText(/บันทึกเป็นเวอร์ชัน \d+ แล้ว/)).toBeNull();
    // the errors belong to the draft that was sent: an edit takes them away
    fireEvent.change(th, { target: { value: "อัตราส่วนฮาซาร์ด" } });
    expect(th).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a refused save that answers after the rows were edited still shows its message", async () => {
    const TH = "terms.0.th: must contain Thai";
    let answer: () => void = () => {};
    const inner = mockAdminFetch((m, p) => (m === "POST" && p === "/glossary"
      ? [422, { detail: TH, errors: [{ field: "terms.0.th", message: TH }] }]
      : routes()(m, p)));
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") await new Promise<void>((resolve) => { answer = resolve; });
      return inner(input, init);
    });
    await renderAdmin(<GlossaryView />);
    const th = await screen.findByLabelText("ภาษาไทย คำที่ 1");
    fireEvent.change(th, { target: { value: "hazard ratio" } });
    fireEvent.click(screen.getByRole("button", SAVE));
    fireEvent.change(th, { target: { value: "hazard ratio x" } }); // edited while the save is in flight
    await act(async () => { answer(); });
    expect(await screen.findByRole("alert")).toHaveTextContent(TH); // the notice, not a hidden cell error
    expect(th).not.toHaveAttribute("aria-invalid");
  });

  it("keeps a row with an error on screen while a filter would hide it, and states document-wide errors in the alert", async () => {
    const ROW = "terms.0.th: must contain Thai";
    const WHOLE = "the glossary renders to 4100 characters; at most 4000 fit the prompt";
    mockAdminFetch((m, p) => (m === "POST" && p === "/glossary"
      ? [422, { detail: WHOLE, errors: [{ field: "terms.0.th", message: ROW }, { field: "terms", message: WHOLE }] }]
      : routes()(m, p)));
    await renderAdmin(<GlossaryView />);
    fireEvent.change(await screen.findByLabelText("ค้นหาคำ"), { target: { value: "placebo" } });
    expect(screen.queryByLabelText("English คำที่ 1")).toBeNull();
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByRole("alert")).toHaveTextContent(WHOLE);
    expect(screen.getByLabelText("ภาษาไทย คำที่ 1")).toHaveAccessibleDescription(ROW);
    expect(screen.getByLabelText("English คำที่ 2")).toBeInTheDocument();
  });

  it("announces a passed check as a status with its warnings in the warning tint", async () => {
    const WARN = "terms.0 and terms.1 share one Thai term";
    mockAdminFetch((m, p) => (m === "POST" && p === "/glossary/validate"
      ? [200, { ok: true, errors: [], warnings: [WARN], preview: "a = b", chars: 5 }]
      : routes()(m, p)));
    await renderAdmin(<GlossaryView />);
    await screen.findByLabelText("English คำที่ 1");
    fireEvent.click(screen.getByRole("button", { name: "ตรวจ" }));
    const warning = await screen.findByText(WARN);
    expect(warning.closest("ul")).toHaveClass("bg-warn-bg");
    const status = screen.getByText("ผ่านการตรวจ").closest("[role=status]");
    expect(status).toContainElement(warning);
    expect(status).toHaveTextContent("5 / 4000 ตัวอักษร");
    // the preview (up to 4000 characters) is a focusable region of its own, not part of what the check announces
    const preview = screen.getByRole("region", { name: "ตัวอย่างข้อความ glossary ใน prompt" });
    expect(preview).toHaveTextContent("a = b");
    expect(preview).toHaveAttribute("tabindex", "0");
    expect(status).not.toContainElement(preview);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("lists a message the server sends twice for one cell twice, without a key warning", async () => {
    const DUP = "terms.0.en: also listed in terms.0";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mockAdminFetch((m, p) => (m === "POST" && p === "/glossary/validate"
      ? [200, { ok: false, errors: [{ field: "terms.0.en", message: DUP }, { field: "terms.0.en", message: DUP },
        { field: null, message: "same" }, { field: null, message: "same" }], warnings: [], preview: null, chars: null }]
      : routes()(m, p)));
    await renderAdmin(<GlossaryView />);
    fireEvent.click(await screen.findByRole("button", { name: "ตรวจ" }));
    await screen.findByRole("alert");
    expect(screen.getAllByText(DUP)).toHaveLength(2);
    expect(screen.getAllByText("same")).toHaveLength(2);
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it("says so when the filter matches no term", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<GlossaryView />);
    const search = await screen.findByLabelText("ค้นหาคำ");
    expect(screen.queryByText("ไม่พบคำที่ตรงกับคำค้น")).toBeNull();
    fireEvent.change(search, { target: { value: "zzz" } });
    expect(screen.getByRole("status")).toHaveTextContent("ไม่พบคำที่ตรงกับคำค้น");
    // the table scrolls sideways on a phone and now holds no input: the region itself must take focus
    expect(screen.queryAllByRole("textbox", { name: /^English / })).toHaveLength(0);
    expect(screen.getByRole("region", { name: "ตารางคำในอภิธานศัพท์" })).toHaveAttribute("tabindex", "0");
    fireEvent.change(search, { target: { value: "" } });
    expect(screen.queryByText("ไม่พบคำที่ตรงกับคำค้น")).toBeNull();
  });

  it("removing a middle term keeps what was typed in the other rows, on the same inputs", async () => {
    const three = { ...GLOSSARY, terms: [...GLOSSARY.terms, { en: "mortality", th: "อัตราการเสียชีวิต", abbr: null, note: null }] };
    mockAdminFetch(routes(three));
    await renderAdmin(<GlossaryView />);
    fireEvent.change(await screen.findByLabelText("ตัวย่อ คำที่ 1"), { target: { value: "HRx" } });
    const third = screen.getByLabelText("หมายเหตุ คำที่ 3");
    fireEvent.change(third, { target: { value: "typed in 3" } });
    fireEvent.click(screen.getByRole("button", { name: "ลบคำที่ 2" }));
    expect(screen.queryByLabelText("English คำที่ 3")).toBeNull();
    expect(screen.getByLabelText("ตัวย่อ คำที่ 1")).toHaveValue("HRx");
    expect(screen.getByLabelText("English คำที่ 2")).toHaveValue("mortality");
    expect(screen.getByLabelText("หมายเหตุ คำที่ 2")).toBe(third); // the same input moved up, it was not rebuilt
    expect(third).toHaveValue("typed in 3");
  });

  it("shows the workers-not-notified notice when the save was stored but the publish failed", async () => {
    mockAdminFetch((m, p) => (m === "POST" && p === "/glossary"
      ? [201, { ...GLOSSARY_VERSIONS.items[0], version: 5, workers_notified: false }]
      : routes()(m, p)));
    await renderAdmin(<GlossaryView />);
    await screen.findByLabelText("English คำที่ 1");
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText("บันทึกเป็นเวอร์ชัน 5 แล้ว")).toBeInTheDocument();
    expect(screen.getByText(WORKERS_NOT_NOTIFIED)).toBeInTheDocument();
  });
});
