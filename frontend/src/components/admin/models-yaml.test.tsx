import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { CONFIG, REPORT_OK } from "@/test/admin-model-fixtures";
import { ModelsYaml } from "./models-yaml";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/models" }));
afterEach(() => { vi.unstubAllGlobals(); nav.replace.mockReset(); });

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
    const inner = mockAdminFetch((m, p) => (p === "/llm-config/validate" ? [200, REPORT_OK] : undefined));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith("/llm-config/validate")) await gate;
      return inner(input, init);
    }));
    const onPending = vi.fn();
    await renderAdmin(<ModelsYaml draft={CONFIG} setDraft={() => {}} onPendingChange={onPending} />);
    const box = await screen.findByLabelText("YAML ของร่าง");
    fireEvent.change(box, { target: { value: "typed early\n" } });
    release();
    await waitFor(() => expect(inner.mock.calls.some(([u]) => String(u).endsWith("/validate"))).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 20)); // let the held answer land
    expect(box).toHaveValue("typed early\n");
    expect(onPending).toHaveBeenLastCalledWith(true);
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
