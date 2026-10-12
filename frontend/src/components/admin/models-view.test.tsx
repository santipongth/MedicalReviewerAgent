import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmConfigDoc } from "@/lib/admin-types";
import { mockAdminFetch, renderAdmin } from "@/test/admin-fetch";
import { CONFIG, STATE, VERSIONS } from "@/test/admin-model-fixtures";
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
    expect(screen.getByText(/w:1/)).toHaveTextContent("ไม่ตรงกับเวอร์ชันที่ใช้");
  });

  it("shows no warning on a worker that is on the active version and reporting", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<ModelsView />);
    const worker = await screen.findByText(/worker-1:7/);
    expect(worker).not.toHaveClass("bg-warn-bg");
    expect(worker).not.toHaveTextContent("ไม่ได้รายงาน");
    expect(worker).not.toHaveTextContent("ไม่ตรงกับเวอร์ชันที่ใช้");
  });
});

describe("ModelsView key warnings", () => {
  // The shipped llm.yaml declares three providers; the active preset uses openrouter only.
  const THREE: LlmConfigDoc = {
    ...CONFIG,
    providers: {
      openrouter: { base_url: "https://openrouter.ai/api/v1", api_key_env: "OPENROUTER_API_KEY" },
      anthropic: { api_key_env: "ANTHROPIC_API_KEY" },
      openai_compatible: { base_url: "http://localhost:11434/v1", api_key_env: "OPENAI_COMPATIBLE_API_KEY" },
    },
  };

  it("does not warn about the key of a provider no role of the active preset uses", async () => {
    mockAdminFetch(routes({ ...STATE, config: THREE, keys_present: {
      OPENROUTER_API_KEY: true, ANTHROPIC_API_KEY: false, OPENAI_COMPATIBLE_API_KEY: false,
    } }));
    await renderAdmin(<ModelsView />);
    await screen.findByText(/ใช้เวอร์ชัน 3 จาก DB/);
    expect(screen.queryByText(/ยังไม่ได้ตั้ง/)).not.toBeInTheDocument();
  });

  it("warns about the key of the provider the roles use, and only that one", async () => {
    mockAdminFetch(routes({ ...STATE, config: THREE, keys_present: {
      OPENROUTER_API_KEY: false, ANTHROPIC_API_KEY: false, OPENAI_COMPATIBLE_API_KEY: false,
    } }));
    await renderAdmin(<ModelsView />);
    expect(await screen.findByText(/OPENROUTER_API_KEY ยังไม่ได้ตั้ง/)).toBeInTheDocument();
    expect(screen.queryByText(/ANTHROPIC_API_KEY/)).not.toBeInTheDocument();
    expect(screen.queryByText(/OPENAI_COMPATIBLE_API_KEY/)).not.toBeInTheDocument();
  });
});

describe("ModelsView tabs", () => {
  it("shows the history list under the ประวัติ tab", async () => {
    mockAdminFetch(routes());
    await renderAdmin(<ModelsView />);
    const tab = await screen.findByRole("button", { name: "ประวัติ" });
    expect(screen.queryByRole("listitem", { name: /เวอร์ชัน 3/ })).not.toBeInTheDocument();
    fireEvent.click(tab);
    expect(tab).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("listitem", { name: /เวอร์ชัน 3/ })).toHaveTextContent("cheaper");
  });

  it("re-reads the config after a restore, and the history refetches for the new base", async () => {
    let active = 3;
    const calls: string[] = [];
    mockAdminFetch((m, p) => {
      calls.push(`${m} ${p}`);
      if (m === "GET" && p === "/llm-config") {
        return [200, { ...STATE, version: active, loaded: [{ ...STATE.loaded[0], version: String(active) }] }];
      }
      if (m === "GET" && p.startsWith("/llm-config/versions")) {
        const restored = { ...VERSIONS.items[0], id: 4, source: "restore", restored_from: 2 };
        return [200, active === 3 ? VERSIONS : { items: [restored, ...VERSIONS.items], next: null }];
      }
      if (m === "POST" && p === "/llm-config/versions/2/restore") {
        active = 4;
        return [201, { ...VERSIONS.items[0], id: 4, source: "restore", restored_from: 2, workers_notified: true }];
      }
    });
    await renderAdmin(<ModelsView />);
    fireEvent.click(await screen.findByRole("button", { name: "ประวัติ" }));
    const v2 = await screen.findByRole("listitem", { name: /เวอร์ชัน 2/ });
    fireEvent.click(within(v2).getByRole("button", { name: "ย้อนกลับไปเวอร์ชันนี้" }));
    fireEvent.click(within(v2).getByRole("button", { name: "ยืนยันย้อนกลับ" }));
    expect(await screen.findByText(/ใช้เวอร์ชัน 4 จาก DB/)).toBeInTheDocument();
    expect(await screen.findByRole("listitem", { name: /เวอร์ชัน 4/ })).toHaveTextContent("ใช้งานอยู่");
    expect(calls.filter((c) => c === "GET /llm-config")).toHaveLength(2);
    expect(calls.filter((c) => c === "GET /llm-config/versions")).toHaveLength(2);
    expect(calls.indexOf("POST /llm-config/versions/2/restore")).toBeLessThan(calls.lastIndexOf("GET /llm-config"));
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

describe("ModelsHeader workers", () => {
  const worker = (loaded_at: string) => ({ ...STATE, loaded: [{ ...STATE.loaded[0], loaded_at }] });

  it("says the time is the last report", () => {
    render(<ModelsHeader state={worker("2026-10-12T10:00:00Z")} now={SEEN + 30_000} />);
    expect(screen.getByText(/worker-1:7/)).toHaveTextContent(/รายงานล่าสุด/);
  });

  it("marks a worker on another version in words as well as colour", () => {
    render(<ModelsHeader state={{ ...STATE, loaded: [{ ...STATE.loaded[0], version: "2" }] }} now={SEEN + 30_000} />);
    const line = screen.getByText(/worker-1:7/);
    expect(line).toHaveTextContent("ไม่ตรงกับเวอร์ชันที่ใช้");
    expect(line).toHaveClass("bg-warn-bg");
  });

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
