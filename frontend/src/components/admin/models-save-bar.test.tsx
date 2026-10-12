import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WORKERS_NOT_NOTIFIED } from "@/lib/admin-copy";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { CONFIG, REPORT_OK } from "@/test/admin-model-fixtures";
import { AdminGate } from "./admin-gate";
import { ModelsSaveBar } from "./models-save-bar";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/models" }));
afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

const SAVE = { name: "บันทึกเป็นเวอร์ชันใหม่" };
const saves = (fetch: ReturnType<typeof mockAdminFetch>) =>
  fetch.mock.calls.filter(([u, i]) => String(u).endsWith("/llm-config") && (i as RequestInit).method === "POST");

describe("ModelsSaveBar", () => {
  it("shows warnings and cost from validate", async () => {
    mockAdminFetch((m, p) => (p === "/llm-config/validate" ? [200, REPORT_OK] : undefined));
    await renderAdmin(<ModelsSaveBar base={3} draft={CONFIG} onSaved={() => {}} onConflict={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "ตรวจ" }));
    expect(await screen.findByText(/vendor\/better not found/)).toBeInTheDocument();
    expect(screen.getByText(/cheap: ~\$0\.012 ต่อรีวิว/)).toBeInTheDocument();
  });

  it("says a preset cannot be estimated when no model of it has a known price, and counts the unknown ones otherwise", async () => {
    mockAdminFetch((m, p) => (p === "/llm-config/validate" ? [200, {
      ...REPORT_OK,
      cost: {
        cheap: { total_usd: 0.0123, per_role: { guard: 0.01, planner: 0.0023 }, unknown_models: ["synthesizer: openrouter:vendor/typo"] },
        better: { total_usd: 0, per_role: {}, unknown_models: ["guard: openrouter:vendor/typo", "planner: openrouter:vendor/typo"] },
        free: { total_usd: 0, per_role: { guard: 0 }, unknown_models: [] },
      },
    }] : undefined));
    await renderAdmin(<ModelsSaveBar base={3} draft={CONFIG} onSaved={() => {}} onConflict={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "ตรวจ" }));
    expect(await screen.findByText("cheap: ~$0.012 ต่อรีวิว (ไม่ทราบราคา: 1 role)")).toBeInTheDocument();
    expect(screen.getByText("better: ประเมินไม่ได้ (ไม่ทราบราคา)")).toBeInTheDocument();
    expect(screen.getByText("free: ~$0.000 ต่อรีวิว")).toBeInTheDocument();
    expect(screen.queryByText(/better: ~\$/)).not.toBeInTheDocument();
  });

  it("hides the errors of the last check once the draft has changed", async () => {
    mockAdminFetch((m, p) => (p === "/llm-config/validate"
      ? [200, { ...REPORT_OK, ok: false, errors: ["config: Unknown preset 'x'"], config: null, yaml: null }] : undefined));
    const { rerender } = await renderAdmin(<ModelsSaveBar base={3} draft={CONFIG} onSaved={() => {}} onConflict={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "ตรวจ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown preset");
    rerender(<AdminGate><ModelsSaveBar base={3} draft={{ ...CONFIG, active_preset: "better" }} onSaved={() => {}} onConflict={() => {}} /></AdminGate>);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("hides the last check once the draft has changed, so an old cost is never read as the new one", async () => {
    mockAdminFetch((m, p) => (p === "/llm-config/validate" ? [200, REPORT_OK] : undefined));
    const { rerender } = await renderAdmin(<ModelsSaveBar base={3} draft={CONFIG} onSaved={() => {}} onConflict={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "ตรวจ" }));
    expect(await screen.findByText(/cheap: ~\$0\.012/)).toBeInTheDocument();
    const edited = { ...CONFIG, active_preset: "better" };
    rerender(<AdminGate><ModelsSaveBar base={3} draft={edited} onSaved={() => {}} onConflict={() => {}} /></AdminGate>);
    expect(screen.queryByText(/cheap: ~\$0\.012/)).not.toBeInTheDocument();
    // an equal copy of the draft (a re-read gives a new object) keeps it
    rerender(<AdminGate><ModelsSaveBar base={3} draft={JSON.parse(JSON.stringify(CONFIG))} onSaved={() => {}} onConflict={() => {}} /></AdminGate>);
    expect(screen.getByText(/cheap: ~\$0\.012/)).toBeInTheDocument();
  });

  it("saves with the base version and the note, after validating", async () => {
    const onSaved = vi.fn();
    const fetch = mockAdminFetch((m, p) => {
      if (p === "/llm-config/validate") return [200, REPORT_OK];
      if (m === "POST" && p === "/llm-config") return [201, { id: 4 }];
    });
    await renderAdmin(<ModelsSaveBar base={3} draft={CONFIG} onSaved={onSaved} onConflict={() => {}} />);
    fireEvent.change(screen.getByLabelText("หมายเหตุ"), { target: { value: "cheaper" } });
    fireEvent.click(screen.getByRole("button", SAVE));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    const [post] = saves(fetch);
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ config: CONFIG, base_version: 3, note: "cheaper" });
    expect(screen.getByLabelText("หมายเหตุ")).toHaveValue("");
  });

  it("sends the base it was given as base_version, a number or null, and no note when it is blank", async () => {
    const fetch = mockAdminFetch((m, p) => {
      if (p === "/llm-config/validate") return [200, REPORT_OK];
      if (m === "POST" && p === "/llm-config") return [201, { id: 8 }];
    });
    const onSaved = vi.fn();
    const { rerender } = await renderAdmin(<ModelsSaveBar base={7} draft={CONFIG} onSaved={onSaved} onConflict={() => {}} />);
    fireEvent.click(screen.getByRole("button", SAVE));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    rerender(<AdminGate><ModelsSaveBar base={null} draft={CONFIG} onSaved={onSaved} onConflict={() => {}} /></AdminGate>);
    fireEvent.click(screen.getByRole("button", SAVE));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(2));
    const bodies = saves(fetch).map(([, i]) => JSON.parse((i as RequestInit).body as string));
    expect(bodies).toEqual([{ config: CONFIG, base_version: 7 }, { config: CONFIG, base_version: null }]);
  });

  it("says which version was saved", async () => {
    mockAdminFetch((m, p) => {
      if (p === "/llm-config/validate") return [200, REPORT_OK];
      if (m === "POST" && p === "/llm-config") return [201, { id: 4, workers_notified: true }];
    });
    await renderAdmin(<ModelsSaveBar base={3} draft={CONFIG} onSaved={() => {}} onConflict={() => {}} />);
    fireEvent.click(screen.getByRole("button", SAVE));
    const note = await screen.findByText("บันทึกเป็นเวอร์ชัน 4 แล้ว");
    expect(note).not.toHaveClass("bg-warn-bg");
    expect(screen.queryByText(WORKERS_NOT_NOTIFIED)).not.toBeInTheDocument();
  });

  it("warns when the workers could not be told, in words and in the warning tint", async () => {
    mockAdminFetch((m, p) => {
      if (p === "/llm-config/validate") return [200, REPORT_OK];
      if (m === "POST" && p === "/llm-config") return [201, { id: 4, workers_notified: false }];
    });
    await renderAdmin(<ModelsSaveBar base={3} draft={CONFIG} onSaved={() => {}} onConflict={() => {}} />);
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByText("บันทึกเป็นเวอร์ชัน 4 แล้ว")).toBeInTheDocument();
    expect(screen.getByText(WORKERS_NOT_NOTIFIED)).toHaveClass("bg-warn-bg");
  });

  it("moves focus to the saved note, so it is never left on a disabled button", async () => {
    mockAdminFetch((m, p) => {
      if (p === "/llm-config/validate") return [200, REPORT_OK];
      if (m === "POST" && p === "/llm-config") return [201, { id: 4, workers_notified: true }];
    });
    await renderAdmin(<ModelsSaveBar base={3} draft={CONFIG} onSaved={() => {}} onConflict={() => {}} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument(); // no empty live region sits there before a save
    fireEvent.click(screen.getByRole("button", SAVE));
    await screen.findByText("บันทึกเป็นเวอร์ชัน 4 แล้ว");
    expect(screen.getByRole("status")).toHaveFocus();
  });

  it("hides the saved note once the draft changes again, and keeps it for the draft that was saved or is now in use", async () => {
    mockAdminFetch((m, p) => {
      if (p === "/llm-config/validate") return [200, REPORT_OK];
      if (m === "POST" && p === "/llm-config") return [201, { id: 4, workers_notified: true }];
    });
    const bar = (draft: typeof CONFIG, serverConfig?: typeof CONFIG) => (
      <AdminGate><ModelsSaveBar base={3} draft={draft} serverConfig={serverConfig} onSaved={() => {}} onConflict={() => {}} /></AdminGate>
    );
    const { rerender } = await renderAdmin(<ModelsSaveBar base={3} draft={CONFIG} onSaved={() => {}} onConflict={() => {}} />);
    fireEvent.click(screen.getByRole("button", SAVE));
    await screen.findByText("บันทึกเป็นเวอร์ชัน 4 แล้ว");
    const edited = { ...CONFIG, active_preset: "better" };
    // the page re-read the server: the draft is now what the server holds (maybe written slightly differently)
    rerender(bar(edited, edited));
    expect(screen.getByText("บันทึกเป็นเวอร์ชัน 4 แล้ว")).toBeInTheDocument();
    // an edit on top of that
    rerender(bar({ ...edited, default_provider: "anthropic" }, edited));
    expect(screen.queryByText("บันทึกเป็นเวอร์ชัน 4 แล้ว")).not.toBeInTheDocument();
    // and put back
    rerender(bar(CONFIG));
    expect(screen.getByText("บันทึกเป็นเวอร์ชัน 4 แล้ว")).toBeInTheDocument();
  });

  it("passes the saved document to the page and stays busy until the page has re-read", async () => {
    let finish: () => void = () => {};
    const onSaved = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    mockAdminFetch((m, p) => {
      if (p === "/llm-config/validate") return [200, REPORT_OK];
      if (m === "POST" && p === "/llm-config") return [201, { id: 4, workers_notified: true }];
    });
    await renderAdmin(<ModelsSaveBar base={3} draft={CONFIG} onSaved={onSaved} onConflict={() => {}} />);
    fireEvent.click(screen.getByRole("button", SAVE));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(CONFIG));
    expect(screen.getByRole("button", SAVE)).toBeDisabled();
    expect(screen.getByRole("button", { name: "ตรวจ" })).toBeDisabled();
    await act(async () => { finish(); });
    expect(screen.getByRole("button", SAVE)).toBeEnabled();
  });

  it("blocks the save when validate reports errors", async () => {
    const fetch = mockAdminFetch((m, p) => (p === "/llm-config/validate"
      ? [200, { ...REPORT_OK, ok: false, errors: ["config: Unknown preset 'x'"], config: null, yaml: null }] : undefined));
    await renderAdmin(<ModelsSaveBar base={3} draft={CONFIG} onSaved={() => {}} onConflict={() => {}} />);
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown preset");
    expect(saves(fetch)).toHaveLength(0);
  });

  it("does not save when the check itself fails", async () => {
    const fetch = mockAdminFetch((m, p) => (p === "/llm-config/validate" ? [500, { detail: "down" }] : undefined));
    const onSaved = vi.fn();
    await renderAdmin(<ModelsSaveBar base={3} draft={CONFIG} onSaved={onSaved} onConflict={() => {}} />);
    fireEvent.click(screen.getByRole("button", SAVE));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(saves(fetch)).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("hands a conflict to the page with the draft as YAML", async () => {
    const onConflict = vi.fn();
    mockAdminFetch((m, p) => {
      if (p === "/llm-config/validate") return [200, REPORT_OK];
      if (m === "POST" && p === "/llm-config") return [409, { detail: "version 5 is in use now" }];
    });
    await renderAdmin(<ModelsSaveBar base={3} draft={CONFIG} onSaved={() => {}} onConflict={onConflict} />);
    fireEvent.click(screen.getByRole("button", SAVE));
    await waitFor(() => expect(onConflict).toHaveBeenCalledWith(REPORT_OK.yaml));
    expect(screen.getByRole("alert")).toHaveTextContent("มีผู้ดูแลอื่นบันทึกเวอร์ชันใหม่ก่อน");
  });

  it("hands over the YAML of the check it just ran, not one from an earlier render", async () => {
    const onConflict = vi.fn();
    const fresh = "active_preset: cheap\n# fresh\n";
    mockAdminFetch((m, p) => {
      if (p === "/llm-config/validate") return [200, { ...REPORT_OK, yaml: fresh }];
      if (m === "POST" && p === "/llm-config") return [409, { detail: "stale" }];
    });
    await renderAdmin(<ModelsSaveBar base={3} draft={CONFIG} onSaved={() => {}} onConflict={onConflict} />);
    // the very first action is the save: nothing was checked before, so a stale state would hand over ""
    fireEvent.click(screen.getByRole("button", SAVE));
    await waitFor(() => expect(onConflict).toHaveBeenCalledTimes(1));
    expect(onConflict).toHaveBeenCalledWith(fresh);
  });
});
