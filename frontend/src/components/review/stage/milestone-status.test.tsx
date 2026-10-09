import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AGENT_LABEL, initialScene, reduceScene, type Scene } from "@/lib/agent-scene";
import type { ReviewEvent } from "@/lib/types";
import { MilestoneStatus } from "./milestone-status";

const ev = (seq: number, type: string, payload: Record<string, unknown> = {}): ReviewEvent => ({ seq, type, payload });
function run(events: ReviewEvent[]): Scene {
  return events.reduce((a, e) => reduceScene(a, { kind: "event", ev: e }), initialScene({ language: "th" }));
}
const base = [ev(1, "queued", { topic: "x" }), ev(2, "started", { resume: false, elapsed_s: 0 }), ev(3, "checking_topic", { elapsed_s: 1 })];
const refining = [...base, ev(4, "refining", { elapsed_s: 2 })];

describe("MilestoneStatus", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("announces the current role immediately, then throttles with a trailing update", () => {
    const { rerender } = render(<MilestoneStatus scene={run(base)} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(AGENT_LABEL.guard.role);
    rerender(<MilestoneStatus scene={run(refining)} />);
    expect(status).toHaveTextContent(AGENT_LABEL.guard.role);
    act(() => { vi.advanceTimersByTime(4900); });
    expect(status).toHaveTextContent(AGENT_LABEL.guard.role);
    act(() => { vi.advanceTimersByTime(200); });
    expect(status).toHaveTextContent(AGENT_LABEL.refine.role);
  });

  it("ignores a burst of extracted events (no agent change)", () => {
    const reading = [...refining, ...Array.from({ length: 8 }, (_, i) => ev(5 + i, "reading", { ref: `P${i + 1}`, title: "t", elapsed_s: 3 }))];
    const { rerender } = render(<MilestoneStatus scene={run(reading)} />);
    const status = screen.getByRole("status");
    const text = status.textContent;
    const burst = [...reading];
    for (let i = 0; i < 6; i++) {
      burst.push(ev(20 + i, "extracted", { ref: `P${i + 1}`, ok: true, verified: 1, uncertain: false, elapsed_s: 4 + i }));
      rerender(<MilestoneStatus scene={run(burst)} />);
    }
    act(() => { vi.advanceTimersByTime(10000); });
    expect(status.textContent).toBe(text);
  });

  it("clears its timer on unmount", () => {
    const { rerender, unmount } = render(<MilestoneStatus scene={run(base)} />);
    rerender(<MilestoneStatus scene={run(refining)} />);
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
