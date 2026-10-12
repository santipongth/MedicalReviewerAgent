import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LlmConfigDoc } from "@/lib/admin-types";
import { CONFIG } from "@/test/admin-model-fixtures";
import { ModelsPresets } from "./models-presets";

const test = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/admin-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/admin-api")>()),
  adminApi: { ...(await orig<typeof import("@/lib/admin-api")>()).adminApi, testLlm: test.run },
}));
afterEach(() => test.run.mockReset());

function Harness({ onChange }: { onChange: (d: LlmConfigDoc) => void }) {
  const [draft, setDraft] = useState(CONFIG);
  return <ModelsPresets draft={draft} setDraft={(d) => { setDraft(d); onChange(d); }} fail={(e) => String(e)} />;
}

const OK = { ok: true, latency_ms: 812, cost_usd: 0.0002, model: "vendor/cheap", error: null };

describe("ModelsPresets", () => {
  it("edits a role's model and settings in the draft", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const row = screen.getByRole("row", { name: /synthesizer/ });
    fireEvent.change(within(row).getByLabelText("model ของ synthesizer"), { target: { value: "vendor/big" } });
    fireEvent.change(within(row).getByLabelText("max_tokens ของ synthesizer"), { target: { value: "16000" } });
    const last = onChange.mock.calls.at(-1)![0] as LlmConfigDoc;
    expect(last.presets.cheap.synthesizer).toMatchObject({ model: "vendor/big", max_tokens: 16000 });
  });

  it("leaves a cleared number out so the backend default applies, and stores an empty temperature as null", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const row = screen.getByRole("row", { name: /guard/ });
    fireEvent.change(within(row).getByLabelText("max_tokens ของ guard"), { target: { value: "" } });
    fireEvent.change(within(row).getByLabelText("temperature ของ guard"), { target: { value: "0.3" } });
    expect((onChange.mock.calls.at(-1)![0] as LlmConfigDoc).presets.cheap.guard.temperature).toBe(0.3);
    fireEvent.change(within(row).getByLabelText("temperature ของ guard"), { target: { value: "" } });
    const guard = (onChange.mock.calls.at(-1)![0] as LlmConfigDoc).presets.cheap.guard;
    expect(JSON.parse(JSON.stringify(guard))).toEqual({ model: "vendor/cheap", temperature: null });
  });

  it("switches the active preset and refuses to delete it", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("preset ที่กำลังแก้"), { target: { value: "better" } });
    fireEvent.click(screen.getByRole("button", { name: "ตั้งเป็น preset ที่ใช้งาน" }));
    expect((onChange.mock.calls.at(-1)![0] as LlmConfigDoc).active_preset).toBe("better");
    expect(screen.getByRole("button", { name: "ลบ preset" })).toBeDisabled();
  });

  it("keeps focus on the preset picker when making a preset active disables the button", () => {
    render(<Harness onChange={() => {}} />);
    fireEvent.change(screen.getByLabelText("preset ที่กำลังแก้"), { target: { value: "better" } });
    fireEvent.click(screen.getByRole("button", { name: "ตั้งเป็น preset ที่ใช้งาน" }));
    expect(screen.getByLabelText("preset ที่กำลังแก้")).toHaveFocus();
  });

  it("copies a preset under a new name", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("ชื่อ preset ใหม่"), { target: { value: "trial" } });
    fireEvent.click(screen.getByRole("button", { name: "คัดลอก preset" }));
    expect(Object.keys((onChange.mock.calls.at(-1)![0] as LlmConfigDoc).presets)).toContain("trial");
    expect(screen.getByLabelText("preset ที่กำลังแก้")).toHaveValue("trial");
  });

  it("refuses a bad or taken preset name with a message", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("ชื่อ preset ใหม่"), { target: { value: "Bad Name" } });
    fireEvent.click(screen.getByRole("button", { name: "คัดลอก preset" }));
    expect(screen.getByRole("alert")).toHaveTextContent("ชื่อ preset ใช้ได้เฉพาะ");
    fireEvent.change(screen.getByLabelText("ชื่อ preset ใหม่"), { target: { value: "better" } });
    fireEvent.click(screen.getByRole("button", { name: "คัดลอก preset" }));
    expect(screen.getByRole("alert")).toHaveTextContent("มี preset ชื่อ better อยู่แล้ว");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("deletes a preset that is not active after asking again, and puts focus on the picker", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("preset ที่กำลังแก้"), { target: { value: "better" } });
    fireEvent.click(screen.getByRole("button", { name: "ลบ preset" }));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันลบ preset" }));
    expect(Object.keys((onChange.mock.calls.at(-1)![0] as LlmConfigDoc).presets)).toEqual(["cheap"]);
    expect(screen.getByLabelText("preset ที่กำลังแก้")).toHaveValue("cheap");
    expect(screen.getByLabelText("preset ที่กำลังแก้")).toHaveFocus();
  });

  it("tests one role and shows the outcome", async () => {
    test.run.mockResolvedValue(OK);
    render(<Harness onChange={() => {}} />);
    fireEvent.click(within(screen.getByRole("row", { name: /guard/ })).getByRole("button", { name: "ทดสอบ" }));
    expect(await screen.findByText(/ใช้ได้ · 812 ms/)).toBeInTheDocument();
    expect(test.run).toHaveBeenCalledWith({ config: CONFIG, preset: "cheap", role: "guard" });
  });

  it("shows why a test failed, and a failed call as the page's error", async () => {
    test.run.mockResolvedValueOnce({ ...OK, ok: false, error: "401 unauthorized" });
    render(<Harness onChange={() => {}} />);
    const guard = () => within(screen.getByRole("row", { name: /guard/ }));
    fireEvent.click(guard().getByRole("button", { name: "ทดสอบ" }));
    expect(await screen.findByText(/ใช้ไม่ได้: 401 unauthorized/)).toBeInTheDocument();
    test.run.mockRejectedValueOnce("boom");
    fireEvent.click(guard().getByRole("button", { name: "ทดสอบ" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
  });

  it("forgets a role's test result once the role is edited", async () => {
    test.run.mockResolvedValue(OK);
    render(<Harness onChange={() => {}} />);
    const guard = within(screen.getByRole("row", { name: /guard/ }));
    fireEvent.click(guard.getByRole("button", { name: "ทดสอบ" }));
    expect(await screen.findByText(/ใช้ได้ · 812 ms/)).toBeInTheDocument();
    fireEvent.change(guard.getByLabelText("model ของ guard"), { target: { value: "vendor/other" } });
    expect(screen.queryByText(/ใช้ได้ · 812 ms/)).not.toBeInTheDocument();
  });

  it("drops the answer of a test that was still running when the role was edited", async () => {
    let answer: (r: typeof OK) => void = () => {};
    test.run.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    render(<Harness onChange={() => {}} />);
    const guard = within(screen.getByRole("row", { name: /guard/ }));
    fireEvent.click(guard.getByRole("button", { name: "ทดสอบ" }));
    expect(await screen.findByText("กำลังทดสอบ…")).toBeInTheDocument();
    fireEvent.change(guard.getByLabelText("model ของ guard"), { target: { value: "vendor/other" } });
    await act(async () => { answer(OK); });
    expect(screen.queryByText(/ใช้ได้ · 812 ms/)).not.toBeInTheDocument();
    expect(screen.queryByText("กำลังทดสอบ…")).not.toBeInTheDocument();
  });

  it("does not show one preset's test result under another preset", async () => {
    test.run.mockResolvedValue(OK);
    render(<Harness onChange={() => {}} />);
    fireEvent.click(within(screen.getByRole("row", { name: /guard/ })).getByRole("button", { name: "ทดสอบ" }));
    expect(await screen.findByText(/ใช้ได้ · 812 ms/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("preset ที่กำลังแก้"), { target: { value: "better" } });
    expect(screen.queryByText(/ใช้ได้ · 812 ms/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("preset ที่กำลังแก้"), { target: { value: "cheap" } });
    expect(screen.getByText(/ใช้ได้ · 812 ms/)).toBeInTheDocument();
  });
});
