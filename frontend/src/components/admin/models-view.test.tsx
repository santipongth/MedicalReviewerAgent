import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { STATE, VERSIONS } from "@/test/admin-model-fixtures";
import { ModelsHeader, ModelsView } from "./models-view";

const nav = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav, usePathname: () => "/admin/models" }));

// The fixtures' workers were last seen at 10:00:00Z. Pin the clock (Date only, so waitFor/findBy keep real timers)
// 30 seconds after that, so the header tests stay about versions and warnings and not about staleness.
const SEEN = Date.parse("2026-10-12T10:00:00Z");
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(SEEN + 30_000); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); nav.replace.mockReset(); });

const routes = (state = STATE) => (m: string, p: string) =>
  p === "/llm-config" ? [200, state] as [number, unknown] : p.startsWith("/llm-config/versions") ? [200, VERSIONS] as [number, unknown] : undefined;

describe("ModelsView header", () => {
  it("says which version is in use, the active preset and what each worker loaded", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<ModelsView />);
    expect(await screen.findByText(/ใช้เวอร์ชัน 3 จาก DB/)).toBeInTheDocument();
    expect(screen.getByText(/preset ที่ใช้งาน: cheap/)).toBeInTheDocument();
    expect(screen.getByText(/worker-1:7/)).toHaveTextContent("เวอร์ชัน 3");
  });

  it("warns about the file source, LLM_PRESET, missing keys and a worker on another version", async () => {
    mockAdminFetch(routes({
      ...STATE, source: "file", version: null, env_preset: "budget", keys_present: { OPENROUTER_API_KEY: false },
      loaded: [{ worker: "w:1", version: "2", preset: "cheap", loaded_at: "2026-10-12T10:00:00Z", error: "boom" }],
    }));
    await renderAdmin(<ModelsView />);
    expect(await screen.findByText(/ใช้ llm.yaml \(ยังไม่มีเวอร์ชันที่บันทึก\)/)).toBeInTheDocument();
    expect(screen.getByText(/LLM_PRESET=budget/)).toBeInTheDocument();
    expect(screen.getByText(/OPENROUTER_API_KEY ยังไม่ได้ตั้ง/)).toBeInTheDocument();
    expect(screen.getByText(/w:1/)).toHaveTextContent("boom");
  });

  it("shows no warning on a worker that is on the active version and reporting", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<ModelsView />);
    const worker = await screen.findByText(/worker-1:7/);
    expect(worker).not.toHaveClass("bg-warn-bg");
    expect(worker).not.toHaveTextContent("ไม่ได้รายงาน");
  });
});

describe("ModelsView worker staleness", () => {
  it("measures a worker's last report against the time the page read it", async () => {
    vi.setSystemTime(SEEN + 3 * 60_000);
    mockAdminFetch(routes());
    await renderAdmin(<ModelsView />);
    const line = await screen.findByText(/worker-1:7/);
    expect(line).toHaveTextContent("ไม่ได้รายงานเกิน 2 นาที (worker อาจหยุดทำงาน)");
    expect(line).toHaveClass("bg-warn-bg");
  });
});

describe("ModelsHeader workers that stopped reporting", () => {
  const worker = (loaded_at: string) => ({ ...STATE, loaded: [{ ...STATE.loaded[0], loaded_at }] });

  it("marks a worker last seen more than 2 minutes ago", () => {
    render(<ModelsHeader state={worker("2026-10-12T10:00:00Z")} now={SEEN + 3 * 60_000} />);
    const line = screen.getByText(/worker-1:7/);
    expect(line).toHaveTextContent("ไม่ได้รายงานเกิน 2 นาที (worker อาจหยุดทำงาน)");
    expect(line).toHaveClass("bg-warn-bg");
  });

  it("does not mark a worker last seen 30 seconds ago", () => {
    render(<ModelsHeader state={worker("2026-10-12T10:00:00Z")} now={SEEN + 30_000} />);
    const line = screen.getByText(/worker-1:7/);
    expect(line).not.toHaveTextContent("ไม่ได้รายงาน");
    expect(line).not.toHaveClass("bg-warn-bg");
  });

  it("does not mark a worker whose time does not parse", () => {
    render(<ModelsHeader state={worker("not a time")} now={SEEN + 3 * 60_000} />);
    expect(screen.getByText(/worker-1:7/)).not.toHaveTextContent("ไม่ได้รายงาน");
  });
});
