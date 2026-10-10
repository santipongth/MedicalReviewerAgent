// Plan 17 review fixes: reduced motion, first mount and replays show final states; the ripple is ranked per burst.
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EdgeState, ReaderSlot, SlotState } from "@/lib/agent-scene";
import { layoutFor } from "@/lib/agent-layout";
import { AgentNode } from "./agent-node";
import { CountUp } from "./count-up";
import { StageMotion } from "./motion";
import { ReaderPool, burstRanks } from "./reader-pool";
import { StageEdge } from "./stage-edge";

const reducedMotion = vi.hoisted(() => ({ value: false }));
vi.mock("motion/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("motion/react")>()),
  useReducedMotion: () => reducedMotion.value,
}));

afterEach(() => {
  reducedMotion.value = false;
});

const wrap = (el: React.ReactNode) => <StageMotion><svg>{el}</svg></StageMotion>;

describe("ping ring", () => {
  it("is drawn for an agent at work, and never under reduced motion (the dashed outline stays)", () => {
    const working = render(wrap(<AgentNode id="read" at={{ x: 0, y: 0 }} status="working" label={["อ่าน"]} />)).container;
    expect(working.querySelector("[data-ping]")).not.toBeNull();
    reducedMotion.value = true;
    for (const status of ["working", "active"] as const) {
      const c = render(wrap(<AgentNode id="read" at={{ x: 0, y: 0 }} status={status} label={["อ่าน"]} />)).container;
      expect(c.querySelector("[data-ping]")).toBeNull();
      if (status === "working") expect(c.querySelector("rect")?.getAttribute("stroke-dasharray")).toBe("4 3");
    }
  });
});

describe("edge draw-in", () => {
  const edge = (state: EdgeState) => wrap(<StageEdge d="M0 0 L10 0" state={state} />);

  it("does not draw on first mount (finished or replayed run)", () => {
    const { container } = render(edge("live"));
    expect(container.querySelector("[data-edge-draw]")?.getAttribute("data-edge-draw")).toBe("final");
  });

  it("draws when the edge goes live after mount", () => {
    const { container, rerender } = render(edge("idle"));
    rerender(edge("live"));
    expect(container.querySelector("[data-edge-draw]")?.getAttribute("data-edge-draw")).toBe("in");
  });

  it("never draws under reduced motion", () => {
    reducedMotion.value = true;
    const { container, rerender } = render(edge("idle"));
    rerender(edge("live"));
    expect(container.querySelector("[data-edge-draw]")?.getAttribute("data-edge-draw")).toBe("final");
  });
});

describe("reader slot pop", () => {
  const layout = layoutFor("wide", { showLocalize: false, showExternal: false, slots: 3, batches: 1, queries: 1 });
  const slots = (...states: SlotState[]): ReaderSlot[] => states.map((state, i) => ({
    ref: `P${i + 1}`, state, title: null, direction: null, design: null, verified: null, doneKey: null,
  }) as ReaderSlot);
  const pool = (s: ReaderSlot[]) => wrap(<ReaderPool slots={s} layout={layout} />);
  const pops = (c: HTMLElement) => [...c.querySelectorAll("[data-pop]")].map((g) => g.getAttribute("data-pop"));

  it("does not pop on first mount, pops a slot that changes live", () => {
    const { container, rerender } = render(pool(slots("ok", "reading", "waiting")));
    expect(pops(container)).toEqual(["0", "0", "0"]);
    rerender(pool(slots("ok", "reading", "reading")));
    expect(pops(container)).toEqual(["0", "0", "1"]);
  });

  it("never pops under reduced motion", () => {
    reducedMotion.value = true;
    const { container, rerender } = render(pool(slots("waiting", "waiting", "waiting")));
    rerender(pool(slots("reading", "ok", "failed")));
    expect(pops(container)).toEqual(["0", "0", "0"]);
  });

  it("ranks the ripple within the burst, so a slot that starts alone waits 0 ms", () => {
    const prev = slots(...Array<SlotState>(30).fill("waiting"));
    const alone = prev.map((s, i) => (i === 29 ? { ...s, state: "reading" as const } : s));
    expect([...burstRanks(prev, alone)]).toEqual([[29, 0]]);
    const burst = prev.map((s, i) => (i >= 27 ? { ...s, state: "reading" as const } : s));
    expect([...burstRanks(prev, burst)]).toEqual([[27, 0], [28, 1], [29, 2]]);
    expect(burstRanks(burst, burst).size).toBe(0); // already reading: no delay
  });
});

describe("CountUp cleanup", () => {
  it("restores the latest text, never the one its effect started with", async () => {
    const { container, rerender } = render(<svg><CountUp text="12/30" /></svg>);
    rerender(<svg><CountUp text="13/30" /></svg>); // starts an animation
    await act(async () => { rerender(<svg><CountUp text="13" /></svg>); }); // different number count: no new animation
    expect(container.querySelector("text")?.textContent).toBe("13");
  });
});
