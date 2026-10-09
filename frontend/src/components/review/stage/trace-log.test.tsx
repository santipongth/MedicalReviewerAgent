import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { type Scene, initialScene, reduceScene } from "@/lib/agent-scene";
import type { ReviewEvent } from "@/lib/types";
import { nearBottom, TraceLog } from "./trace-log";

const ev = (seq: number, type: string, payload: Record<string, unknown> = {}): ReviewEvent => ({ seq, type, payload });
const run = (events: ReviewEvent[], s: Scene = initialScene({ language: "th" })): Scene =>
  events.reduce((acc, e) => reduceScene(acc, { kind: "event", ev: e }), s);

const HEAD: ReviewEvent[] = [
  ev(1, "queued"), ev(2, "started", { elapsed_s: 0.1 }), ev(3, "checking_topic", { elapsed_s: 0.5 }),
  ev(4, "refining", { elapsed_s: 0.8 }), ev(5, "question_refined", { elapsed_s: 4 }),
  ev(6, "planning", { queries: ["a", "b", "c"], elapsed_s: 6 }), ev(7, "searching", { found: 41, queries: 3, failed: 0, elapsed_s: 9 }),
];
const SCREEN: ReviewEvent[] = [ev(8, "enriching", { candidates: 20, elapsed_s: 11 }), ev(9, "screening", { batch: 10, elapsed_s: 12 })];
const group = (a: string) => document.querySelector(`[data-trace-group="${a}"]`) as HTMLElement;

describe("TraceLog", () => {
  it("shows real durations on finished steps and only a start time on the running one", () => {
    render(<TraceLog scene={run([...HEAD, ...SCREEN])} />);
    expect(within(group("plan")).getByText("ใช้เวลา 0:02")).toBeInTheDocument();
    expect(within(group("plan")).getByText("3 คำค้น")).toBeInTheDocument();
    expect(within(group("screen")).getByText("กำลังทำ · เริ่ม 0:11")).toBeInTheDocument();
    expect(within(group("screen")).queryByText(/ใช้เวลา/)).toBeNull();
  });

  it("collapses finished groups, expands the current one, and lets the user toggle", () => {
    render(<TraceLog scene={run([...HEAD, ...SCREEN])} />);
    const planBtn = within(group("plan")).getByRole("button", { name: "ดู 1 รายการ" });
    expect(planBtn).toHaveAttribute("aria-expanded", "false");
    const list = document.getElementById(planBtn.getAttribute("aria-controls")!)!;
    expect(list).toHaveAttribute("hidden");
    expect(list.querySelectorAll("[data-trace-row]")).toHaveLength(1); // stays in the DOM
    fireEvent.click(planBtn);
    expect(list).not.toHaveAttribute("hidden");
    const cur = within(group("screen")).getByRole("button", { name: "ซ่อนรายการ" });
    expect(cur).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps a user-opened group open when new events arrive", () => {
    const { rerender } = render(<TraceLog scene={run(HEAD)} />);
    fireEvent.click(within(group("plan")).getByRole("button", { name: "ดู 1 รายการ" }));
    rerender(<TraceLog scene={run([ev(8, "enriching", { candidates: 20, elapsed_s: 11 })], run(HEAD))} />);
    expect(within(group("plan")).getByRole("button", { name: "ซ่อนรายการ" })).toHaveAttribute("aria-expanded", "true");
    expect(within(group("search")).getByRole("button", { name: "ดู 1 รายการ" })).toHaveAttribute("aria-expanded", "false");
  });

  it("renders merged repeat counts and a status line without a toggle or type tag", () => {
    const base = run([ev(1, "queued"), ev(2, "started", { elapsed_s: 0.1 })]);
    const s: Scene = { ...base, trace: [...base.trace, { key: 9, type: "extracted", text: "อ่านบทความ", elapsed: 75, repeat: 6, agent: "read" }] };
    render(<TraceLog scene={s} />);
    expect(screen.getByText(/×6/)).toBeInTheDocument();
    expect(screen.queryByText(/×1\b/)).toBeNull();
    expect(screen.getByText("1:15")).toBeInTheDocument();
    expect(screen.queryByText("[extracted]")).toBeNull();
    expect(within(group("status")).queryByRole("button")).toBeNull();
  });

  it("limits an expanded read group to its last 6 rows until asked for all", () => {
    const base = run(HEAD);
    const rows = Array.from({ length: 9 }, (_, i) => ({ key: 100 + i, type: "extracted", text: `p${i}`, elapsed: 20 + i, repeat: 1, agent: "read" as const }));
    const s: Scene = { ...base, trace: [...base.trace, ...rows] };
    render(<TraceLog scene={s} />);
    fireEvent.click(within(group("read")).getByRole("button", { name: "ดู 9 รายการ" }));
    expect(group("read").querySelectorAll("[data-trace-row]")).toHaveLength(6);
    fireEvent.click(screen.getByRole("button", { name: "ดูทั้งหมด 9 รายการ" }));
    expect(group("read").querySelectorAll("[data-trace-row]")).toHaveLength(9);
  });

  it("is a named focusable scroll region and not live", () => {
    const { container } = render(<TraceLog scene={run(HEAD)} />);
    const box = screen.getByRole("region", { name: "บันทึกการทำงาน" }).querySelector("div")!;
    expect(box).toHaveAttribute("tabindex", "0");
    expect(box).toHaveAttribute("aria-labelledby", "h-trace");
    expect(container.querySelector("[aria-live]")).toBeNull();
  });

  it("nearBottom is true only within the slack", () => {
    expect(nearBottom({ scrollHeight: 1000, scrollTop: 700, clientHeight: 288 })).toBe(true);
    expect(nearBottom({ scrollHeight: 1000, scrollTop: 100, clientHeight: 288 })).toBe(false);
  });

  it("keeps following while the reader stays at the bottom, and stops after they scroll up", () => {
    const geom = { scrollHeight: 500, clientHeight: 288 };
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => geom.scrollHeight });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => geom.clientHeight });
    try {
      const base = run(HEAD);
      const mk = (n: number): Scene => ({
        ...base,
        trace: [...base.trace, ...Array.from({ length: n }, (_, i) => ({ key: 100 + i, type: "extracted", text: "t", elapsed: i, repeat: 1, agent: "read" as const }))],
      });
      const { rerender } = render(<TraceLog scene={mk(3)} />);
      const box = screen.getByRole("region", { name: "บันทึกการทำงาน" }).querySelector("div")!;
      for (let n = 4; n < 8; n++) {
        geom.scrollHeight += 100;
        fireEvent.scroll(box); // content grew mid-scroll: distance > slack, but not a user scroll up
        rerender(<TraceLog scene={mk(n)} />);
        expect(box.scrollTop).toBe(geom.scrollHeight);
      }
      box.scrollTop = 0;
      fireEvent.scroll(box);
      geom.scrollHeight += 100;
      rerender(<TraceLog scene={mk(9)} />);
      expect(box.scrollTop).toBe(0);
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
    }
  });
});
