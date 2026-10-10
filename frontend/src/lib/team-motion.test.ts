import { describe, expect, it } from "vitest";
import type { Handoff } from "./agent-team";
import { handoffDots, lookToward } from "./team-motion";

const h = (key: number, n: number, from: Handoff["from"] = "screener", to: Handoff["to"] = "reader"): Handoff => ({ key, from, to, kind: "paper", n });

describe("handoffDots", () => {
  it("staggers the dots of a hand-off and offsets hand-offs", () => {
    const dots = handoffDots([h(1, 2, "planner", "researcher"), h(2, 1)], 12);
    expect(dots.map((d) => [d.from, d.to, d.delayMs])).toEqual([
      ["planner", "researcher", 0], ["screener", "reader", 60], ["planner", "researcher", 120],
    ]);
  });
  it("keeps the newest dots within the cap", () => {
    const dots = handoffDots([h(1, 8), h(2, 8)], 10);
    expect(dots).toHaveLength(10);
    expect(dots[0].delayMs).toBe(0); // timeline restarts at the oldest kept dot
  });
  it("draws at least one dot per hand-off and nothing for none", () => {
    expect(handoffDots([h(1, 0)], 12)).toHaveLength(1);
    expect(handoffDots([], 12)).toEqual([]);
  });
});

describe("lookToward", () => {
  it("picks the dominant axis", () => {
    expect(lookToward({ x: 0, y: 0 }, { x: 100, y: 10 })).toBe("r");
    expect(lookToward({ x: 100, y: 0 }, { x: 0, y: 10 })).toBe("l");
    expect(lookToward({ x: 0, y: 0 }, { x: 5, y: 120 })).toBe("d");
    expect(lookToward({ x: 0, y: 120 }, { x: 5, y: 0 })).toBe("u");
  });
});
