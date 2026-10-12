import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { adminApi } from "@/lib/admin-api";
import type { LlmConfigDoc, ValidateReport } from "@/lib/admin-types";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { CONFIG, REPORT_OK } from "@/test/admin-model-fixtures";
import { AdminGate } from "./admin-gate";
import { ModelsYaml } from "./models-yaml";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/models" }));
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); nav.replace.mockReset(); });

describe("ModelsYaml", () => {
  it("loads the draft as YAML, checks edited text and applies it to the draft", async () => {
    const setDraft = vi.fn();
    const edited = { ...CONFIG, active_preset: "better" };
    const fetch = mockAdminFetch((m, p, body) => {
      if (p !== "/llm-config/validate") return undefined;
      return (body as { config?: unknown }).config
        ? [200, REPORT_OK]
        : [200, { ...REPORT_OK, config: edited, yaml: "active_preset: better\n" }];
    });
    await renderAdmin(<ModelsYaml draft={CONFIG} setDraft={setDraft} />);
    const box = await screen.findByLabelText("YAML ของร่าง");
    await waitFor(() => expect(box).toHaveValue(REPORT_OK.yaml));
    fireEvent.change(box, { target: { value: "active_preset: better\n" } });
    fireEvent.click(screen.getByRole("button", { name: "ใช้ YAML นี้" }));
    await waitFor(() => expect(setDraft).toHaveBeenCalledWith(edited));
    const sent = fetch.mock.calls.map(([, i]) => JSON.parse(((i as RequestInit).body as string) ?? "{}"));
    expect(sent.some((b) => b.yaml === "active_preset: better\n")).toBe(true);
  });

  it("shows YAML errors and leaves the draft alone", async () => {
    const setDraft = vi.fn();
    mockAdminFetch((m, p, body) => {
      if (p !== "/llm-config/validate") return undefined;
      return (body as { yaml?: string }).yaml ? [422, { detail: "invalid YAML: mapping values are not allowed" }] : [200, REPORT_OK];
    });
    await renderAdmin(<ModelsYaml draft={CONFIG} setDraft={setDraft} />);
    fireEvent.change(await screen.findByLabelText("YAML ของร่าง"), { target: { value: "a: b: c" } });
    fireEvent.click(screen.getByRole("button", { name: "ใช้ YAML นี้" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("invalid YAML");
    expect(setDraft).not.toHaveBeenCalled();
  });

  it("starts from the conflict text when the save was refused", async () => {
    mockAdminFetch((m, p) => (p === "/llm-config/validate" ? [200, REPORT_OK] : undefined));
    await renderAdmin(<ModelsYaml draft={CONFIG} setDraft={() => {}} initialText={"active_preset: mine\n"} />);
    expect(await screen.findByLabelText("YAML ของร่าง")).toHaveValue("active_preset: mine\n");
  });

  it("checks the text without touching the draft, and lists the warnings", async () => {
    const setDraft = vi.fn();
    mockAdminFetch((m, p) => (p === "/llm-config/validate" ? [200, REPORT_OK] : undefined));
    await renderAdmin(<ModelsYaml draft={CONFIG} setDraft={setDraft} />);
    const box = await screen.findByLabelText("YAML ของร่าง");
    await waitFor(() => expect(box).toHaveValue(REPORT_OK.yaml));
    fireEvent.click(screen.getByRole("button", { name: "ตรวจ YAML" }));
    expect(await screen.findByRole("status")).toHaveTextContent("ใช้ได้ มีคำเตือน 1 ข้อ");
    expect(screen.getByText(/vendor\/better not found on OpenRouter/)).toBeInTheDocument();
    expect(setDraft).not.toHaveBeenCalled();
  });

  it("explains why there is no text when the draft itself does not validate", async () => {
    mockAdminFetch((m, p) => (p === "/llm-config/validate"
      ? [200, { ...REPORT_OK, ok: false, errors: ["config: Unknown preset 'x'"], config: null, yaml: null }] : undefined));
    await renderAdmin(<ModelsYaml draft={CONFIG} setDraft={() => {}} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown preset");
  });
});

describe("ModelsYaml pending text", () => {
  it("reports whether the box differs from the text last loaded or applied", async () => {
    const onPending = vi.fn();
    mockAdminFetch((m, p, body) => {
      if (p !== "/llm-config/validate") return undefined;
      return (body as { yaml?: string }).yaml ? [200, { ...REPORT_OK, yaml: "active_preset: better\n" }] : [200, REPORT_OK];
    });
    await renderAdmin(<ModelsYaml draft={CONFIG} setDraft={() => {}} onPendingChange={onPending} />);
    const box = await screen.findByLabelText("YAML ของร่าง");
    await waitFor(() => expect(box).toHaveValue(REPORT_OK.yaml));
    expect(onPending).toHaveBeenLastCalledWith(false); // loading the text is not an edit
    fireEvent.change(box, { target: { value: "active_preset: better\n" } });
    expect(onPending).toHaveBeenLastCalledWith(true);
    fireEvent.change(box, { target: { value: REPORT_OK.yaml } });
    expect(onPending).toHaveBeenLastCalledWith(false); // typed back to what it was
    fireEvent.change(box, { target: { value: "active_preset: better\n" } });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจ YAML" }));
    await screen.findByRole("status");
    expect(onPending).toHaveBeenLastCalledWith(true); // a check applies nothing
    fireEvent.click(screen.getByRole("button", { name: "ใช้ YAML นี้" }));
    await waitFor(() => expect(onPending).toHaveBeenLastCalledWith(false));
    expect(box).toHaveValue("active_preset: better\n"); // the admin's own text stays
  });

  it("stays pending when the text is edited while it is being applied", async () => {
    const onPending = vi.fn();
    const inner = mockAdminFetch((m, p, body) => (p === "/llm-config/validate"
      ? [200, (body as { yaml?: string }).yaml ? { ...REPORT_OK, yaml: "a\n" } : REPORT_OK] : undefined));
    await renderAdmin(<ModelsYaml draft={CONFIG} setDraft={() => {}} onPendingChange={onPending} />);
    const box = await screen.findByLabelText("YAML ของร่าง");
    await waitFor(() => expect(box).toHaveValue(REPORT_OK.yaml));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => { await gate; return inner(input, init); }));
    fireEvent.change(box, { target: { value: "first\n" } });
    fireEvent.click(screen.getByRole("button", { name: "ใช้ YAML นี้" }));
    fireEvent.change(box, { target: { value: "second\n" } });
    release();
    await screen.findByRole("status");
    expect(box).toHaveValue("second\n");
    expect(onPending).toHaveBeenLastCalledWith(true); // "second" was never applied
  });

  it("does not replace what the admin typed with the text that finishes loading afterwards", async () => {
    mockAdminFetch();
    let answer!: (r: ValidateReport) => void;
    const held = new Promise<ValidateReport>((resolve) => { answer = resolve; });
    vi.spyOn(adminApi, "validateLlm").mockReturnValue(held);
    const onPending = vi.fn();
    await renderAdmin(<ModelsYaml draft={CONFIG} setDraft={() => {}} onPendingChange={onPending} />);
    const box = await screen.findByLabelText("YAML ของร่าง");
    fireEvent.change(box, { target: { value: "typed early\n" } });
    // the component's own .then was registered first, so it has dealt with the answer when this await returns
    await act(async () => { answer(REPORT_OK); await held; });
    expect(box).toHaveValue("typed early\n");
    expect(onPending).toHaveBeenLastCalledWith(true);
  });

  it("does not replace text typed while a restart from the draft is on its way", async () => {
    const onFromDraft = vi.fn();
    const onPending = vi.fn();
    const spy = vi.spyOn(adminApi, "validateLlm").mockResolvedValueOnce(REPORT_OK);
    mockAdminFetch();
    await renderAdmin(<ModelsYaml draft={CONFIG} setDraft={() => {}} onFromDraft={onFromDraft} onPendingChange={onPending} />);
    const box = await screen.findByLabelText("YAML ของร่าง");
    await waitFor(() => expect(box).toHaveValue(REPORT_OK.yaml));
    let answer!: (r: ValidateReport) => void;
    const held = new Promise<ValidateReport>((resolve) => { answer = resolve; });
    spy.mockReturnValueOnce(held);
    fireEvent.click(screen.getByRole("button", { name: "เริ่มจากร่างปัจจุบัน" }));
    fireEvent.change(box, { target: { value: "typed meanwhile\n" } });
    await act(async () => { answer({ ...REPORT_OK, yaml: "from: draft\n" }); await held; });
    expect(box).toHaveValue("typed meanwhile\n");
    expect(onPending).toHaveBeenLastCalledWith(true); // still the admin's unapplied text
    expect(onFromDraft).not.toHaveBeenCalled();
  });

  it("restarts from the draft at once when nothing is pending", async () => {
    const onFromDraft = vi.fn();
    let yaml = "active_preset: cheap\n";
    mockAdminFetch((m, p) => (p === "/llm-config/validate" ? [200, { ...REPORT_OK, yaml }] : undefined));
    await renderAdmin(<ModelsYaml draft={CONFIG} setDraft={() => {}} onFromDraft={onFromDraft} />);
    const box = await screen.findByLabelText("YAML ของร่าง");
    await waitFor(() => expect(box).toHaveValue("active_preset: cheap\n"));
    yaml = "active_preset: better\n";
    fireEvent.click(screen.getByRole("button", { name: "เริ่มจากร่างปัจจุบัน" }));
    await waitFor(() => expect(box).toHaveValue("active_preset: better\n"));
    expect(onFromDraft).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("โหลดข้อความจากร่างปัจจุบันแล้ว")).toHaveFocus();
  });

  it("asks before it throws away typed text when restarting from the draft", async () => {
    const onFromDraft = vi.fn();
    const onPending = vi.fn();
    mockAdminFetch((m, p) => (p === "/llm-config/validate" ? [200, REPORT_OK] : undefined));
    await renderAdmin(<ModelsYaml draft={CONFIG} setDraft={() => {}} onFromDraft={onFromDraft} onPendingChange={onPending} />);
    const box = await screen.findByLabelText("YAML ของร่าง");
    await waitFor(() => expect(box).toHaveValue(REPORT_OK.yaml));
    fireEvent.change(box, { target: { value: "typed\n" } });
    fireEvent.click(screen.getByRole("button", { name: "เริ่มจากร่างปัจจุบัน" }));
    expect(box).toHaveValue("typed\n");
    expect(onFromDraft).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันทิ้งข้อความที่แก้" }));
    await waitFor(() => expect(box).toHaveValue(REPORT_OK.yaml));
    expect(onFromDraft).toHaveBeenCalledTimes(1);
    expect(onPending).toHaveBeenLastCalledWith(false);
    expect(await screen.findByText("โหลดข้อความจากร่างปัจจุบันแล้ว")).toHaveFocus(); // the confirm button is gone
    expect(within(screen.getByRole("region", { name: "YAML ขั้นสูง" })).getByRole("button", { name: "เริ่มจากร่างปัจจุบัน" })).toBeInTheDocument();
  });
});

describe("ModelsYaml when the draft changed after the text was loaded", () => {
  const EDITED: LlmConfigDoc = { ...CONFIG, presets: { ...CONFIG.presets, cheap: { ...CONFIG.presets.cheap, guard: { model: "vendor/elsewhere" } } } };
  const APPLIED: LlmConfigDoc = { ...CONFIG, active_preset: "better" };
  const CONFIRM = { name: "ใช้ YAML นี้ และทับการแก้ไขในแท็บอื่น" };
  const NOTE = "ร่างเปลี่ยนไปหลังจากโหลดข้อความนี้ (เช่น แก้ในแท็บ Presets หรือ Catalog) การใช้ YAML นี้จะทับการแก้ไขนั้น";
  const server = () => mockAdminFetch((m, p, body) => (p === "/llm-config/validate"
    ? [200, (body as { yaml?: string }).yaml ? { ...REPORT_OK, config: APPLIED, yaml: "active_preset: better\n" } : REPORT_OK] : undefined));

  it("applies at once while the draft is still the one the text came from", async () => {
    const setDraft = vi.fn();
    server();
    await renderAdmin(<ModelsYaml draft={CONFIG} setDraft={setDraft} />);
    const box = await screen.findByLabelText("YAML ของร่าง");
    await waitFor(() => expect(box).toHaveValue(REPORT_OK.yaml));
    fireEvent.change(box, { target: { value: "active_preset: better\n" } });
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ใช้ YAML นี้" }));
    await waitFor(() => expect(setDraft).toHaveBeenCalledWith(APPLIED));
    expect(screen.queryByRole("button", CONFIRM)).not.toBeInTheDocument();
  });

  it("warns while its text is pending, and asks before it replaces the edit made elsewhere", async () => {
    const setDraft = vi.fn();
    server();
    const { rerender } = await renderAdmin(<ModelsYaml draft={CONFIG} setDraft={setDraft} />);
    const box = await screen.findByLabelText("YAML ของร่าง");
    await waitFor(() => expect(box).toHaveValue(REPORT_OK.yaml));
    fireEvent.change(box, { target: { value: "active_preset: better\n" } });
    rerender(<AdminGate><ModelsYaml draft={EDITED} setDraft={setDraft} /></AdminGate>); // an edit in another tab
    expect(screen.getByText(NOTE)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "ใช้ YAML นี้" }));
    expect(setDraft).not.toHaveBeenCalled(); // the first click only asks
    expect(screen.getByText(NOTE, { selector: "span" })).toBeInTheDocument(); // and the confirm explains itself
    fireEvent.click(screen.getByRole("button", CONFIRM));
    await waitFor(() => expect(setDraft).toHaveBeenCalledWith(APPLIED));
    expect(await screen.findByText(/ใช้ YAML นี้เป็นร่างแล้ว/)).toHaveFocus(); // the control that was pressed may be gone
  });

  it("does not warn while the text is not pending, but still asks", async () => {
    const setDraft = vi.fn();
    server();
    const { rerender } = await renderAdmin(<ModelsYaml draft={CONFIG} setDraft={setDraft} />);
    await waitFor(() => expect(screen.getByLabelText("YAML ของร่าง")).toHaveValue(REPORT_OK.yaml));
    rerender(<AdminGate><ModelsYaml draft={EDITED} setDraft={setDraft} /></AdminGate>);
    expect(screen.queryByText(NOTE)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ใช้ YAML นี้" }));
    expect(screen.getByRole("button", CONFIRM)).toBeInTheDocument();
    expect(setDraft).not.toHaveBeenCalled();
  });

  it("measures the change from the draft the text was restarted from", async () => {
    server();
    const { rerender } = await renderAdmin(<ModelsYaml draft={CONFIG} setDraft={() => {}} />);
    await waitFor(() => expect(screen.getByLabelText("YAML ของร่าง")).toHaveValue(REPORT_OK.yaml));
    rerender(<AdminGate><ModelsYaml draft={EDITED} setDraft={() => {}} /></AdminGate>);
    fireEvent.click(screen.getByRole("button", { name: "เริ่มจากร่างปัจจุบัน" })); // the text is now the edited draft's
    await screen.findByText("โหลดข้อความจากร่างปัจจุบันแล้ว");
    fireEvent.click(screen.getByRole("button", { name: "ใช้ YAML นี้" }));
    expect(screen.queryByRole("button", CONFIRM)).not.toBeInTheDocument(); // nothing to overwrite: applied at once
  });

  it("measures the change from the draft at mount when it starts from the text of a refused save", async () => {
    server();
    const { rerender } = await renderAdmin(<ModelsYaml draft={CONFIG} setDraft={() => {}} initialText={"refused: draft\n"} />);
    expect(await screen.findByLabelText("YAML ของร่าง")).toHaveValue("refused: draft\n");
    rerender(<AdminGate><ModelsYaml draft={EDITED} setDraft={() => {}} initialText={"refused: draft\n"} /></AdminGate>);
    fireEvent.click(screen.getByRole("button", { name: "ใช้ YAML นี้" }));
    expect(screen.getByRole("button", CONFIRM)).toBeInTheDocument();
  });
});
