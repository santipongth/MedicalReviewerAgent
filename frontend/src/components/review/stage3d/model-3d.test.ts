import { describe, expect, it } from "vitest";
import {
  PIPELINE, initialScene, planDots, reduceScene, takeFreshPulses, type AgentStatus, type Pulse, type Scene,
} from "@/lib/agent-scene";
import { layout3dFor } from "@/lib/agent-layout-3d";
import { MAX_DOTS, PACKET_CAP } from "../stage/packet-layer";
import {
  CAMERA_BASE, EDGE_COLOR, FLIGHT_MS, NODE_VISUAL, PACKET_COLOR, SLOT_COLOR, anySpinning, cameraAgent, cameraGoal,
  easeInOut, easeToward, flightT, makeFlights, packetScale, poolLabelAt, poolSummary, schedulePackets, visibleAgents,
} from "./model-3d";

const layout = layout3dFor({ showLocalize: true, showExternal: false, slots: 12 });

describe("status -> visual", () => {
  it("maps every status to the brief's colour token and ring style", () => {
    const want: Record<AgentStatus, [string, string, boolean]> = {
      idle: ["rule", "solid", false], active: ["primary", "solid", false], working: ["primary", "dashed", true],
      done: ["ink", "solid", false], failed: ["err", "solid", false], skipped: ["muted", "wire", false],
      paused: ["warn", "solid", false],
    };
    for (const [st, [color, ring, spin]] of Object.entries(want)) {
      const v = NODE_VISUAL[st as AgentStatus];
      expect([v.color, v.ring, v.spin]).toEqual([color, ring, spin]);
    }
    expect(NODE_VISUAL.active.scale).toBe(1.12);
    expect(NODE_VISUAL.done.mark).toBe("done");
    expect(NODE_VISUAL.failed.mark).toBe("failed");
  });

  it("edges, slots and packets use the same tokens as the 2D stage", () => {
    expect(EDGE_COLOR).toEqual({ idle: "rule", visited: "ink", live: "primary" });
    expect(SLOT_COLOR).toEqual({ waiting: "rule", reading: "primary", ok: "ok", failed: "err", uncertain: "warn" });
    expect(PACKET_COLOR).toEqual({ query: "ink", paper: "ink", kept: "primary", card: "primary", failed: "err", signal: "muted" });
  });

  it("anySpinning is true only while a visible node is working", () => {
    const s = initialScene({ language: "th" });
    expect(anySpinning(s, layout)).toBe(false);
    expect(anySpinning({ ...s, agents: { ...s.agents, search: "working" } }, layout)).toBe(true);
    // external is not in this layout, so its status cannot keep the loop alive
    expect(anySpinning({ ...s, agents: { ...s.agents, external: "working" } }, layout)).toBe(false);
  });
});

describe("packet scheduling", () => {
  const edge = layout.edges[0];
  const pulses = (n: number, per = 1): Pulse[] =>
    Array.from({ length: n }, (_, i) => ({ key: i + 1, edge: edge.id, kind: "paper", n: per }));

  it("assigns dots round-robin with their delays and wraps the cursor", () => {
    const flights = makeFlights(4);
    const dots = planDots(takeFreshPulses(pulses(1, 3), 0, PACKET_CAP), MAX_DOTS);
    let c = schedulePackets(flights, 2, dots, layout.edges, 1000);
    expect(c).toBe(1);
    expect(flights.map((f) => f.start)).toEqual([1240, 0, 1000, 1120]);
    expect(flights[0].seg).toBe(edge.seg);
    expect(flights[1].seg).toBeNull();
    c = schedulePackets(flights, c, dots.slice(0, 1), layout.edges, 5000);
    expect(c).toBe(2);
    expect(flights[1].start).toBe(5000);
  });

  it("drops dots on edges the layout does not draw without taking a slot", () => {
    const flights = makeFlights(4);
    const c = schedulePackets(flights, 0, [{ edge: "read>external", kind: "signal", delayMs: 0 }], layout.edges, 0);
    expect(c).toBe(0);
    expect(flights.every((f) => f.seg === null)).toBe(true);
  });

  it("replays collapse: pulses seen at mount produce no dots, a burst is capped", () => {
    expect(takeFreshPulses(pulses(10), 10, PACKET_CAP)).toHaveLength(0);
    const dots = planDots(takeFreshPulses(pulses(30, 8), 0, PACKET_CAP), MAX_DOTS);
    expect(dots.length).toBeLessThanOrEqual(MAX_DOTS);
    const flights = makeFlights(MAX_DOTS);
    schedulePackets(flights, 0, dots, layout.edges, 0);
    expect(Math.max(...flights.map((f) => f.start))).toBeLessThan(5000);
  });

  it("flight progress: pending < 0, flying 0..1, finished > 1, idle Infinity", () => {
    const [f] = makeFlights(1);
    expect(flightT(f, 0)).toBe(Infinity);
    f.seg = edge.seg;
    f.start = 100;
    expect(flightT(f, 0)).toBeLessThan(0);
    expect(flightT(f, 100 + FLIGHT_MS / 2)).toBeCloseTo(0.5);
    expect(flightT(f, 101 + FLIGHT_MS)).toBeGreaterThan(1);
  });

  it("easing and scale stay in range and hide outside the flight", () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5);
    expect(easeInOut(-1)).toBe(0);
    expect(packetScale(-0.1)).toBe(0);
    expect(packetScale(1.1)).toBe(0);
    expect(packetScale(0.5)).toBe(1);
    expect(packetScale(0.05)).toBeCloseTo(0.5);
  });
});

describe("camera", () => {
  it("frames the lane centre with no current agent and pans part-way toward the current one", () => {
    const centre = cameraGoal(layout, null);
    const cx = (layout.bounds.min[0] + layout.bounds.max[0]) / 2;
    expect(centre[0]).toBeCloseTo(cx);
    expect(centre.slice(1, 3)).toEqual([CAMERA_BASE[1], CAMERA_BASE[2]]);
    const g = cameraGoal(layout, "guard");
    const gx = layout.nodes.guard![0];
    expect(g[0]).toBeLessThan(cx);
    expect(g[0]).toBeGreaterThan(gx); // partial pan keeps the lane framed
    expect(g[3]).toBe(g[0]);
  });

  it("writes into the provided buffer", () => {
    const out = new Array(6).fill(0);
    expect(cameraGoal(layout, "read", out)).toBe(out);
  });

  it("follows the scene's current agent", () => {
    let s: Scene = initialScene();
    expect(cameraAgent(s)).toBeNull();
    s = reduceScene(s, { kind: "event", ev: { seq: 1, type: "checking_topic", payload: {} } as never });
    expect(cameraAgent(s)).toBe("guard");
  });

  it("eases toward the goal, then snaps and reports settled; reduced motion jumps", () => {
    const cur = [0, 0, 0, 0, 0, 0];
    const goal = [1, 2, 3, 4, 5, 6];
    expect(easeToward(cur, goal, 1 / 60)).toBe(false);
    expect(cur[0]).toBeGreaterThan(0);
    expect(cur[0]).toBeLessThan(1);
    let settled = false;
    for (let i = 0; i < 600 && !settled; i++) settled = easeToward(cur, goal, 1 / 60);
    expect(settled).toBe(true);
    expect(cur).toEqual(goal);
    const c2 = [0, 0, 0, 0, 0, 0];
    expect(easeToward(c2, goal, 0, true)).toBe(true);
    expect(c2).toEqual(goal);
  });

  it("clamps a long idle gap so the first frame after a pause does not teleport", () => {
    const cur = [0];
    easeToward(cur, [1], 5);
    expect(cur[0]).toBeLessThan(0.5);
  });
});

describe("labels", () => {
  it("summarises the pool: reading refs (capped), ok without uncertain, failed, uncertain", () => {
    const s: Scene = {
      ...initialScene(),
      slots: [
        { ref: "P1", state: "reading" }, { ref: "P2", state: "reading" }, { ref: "P3", state: "reading" },
        { ref: "P4", state: "reading" }, { ref: "P5", state: "reading" }, { ref: "P6", state: "ok" },
        { ref: "P7", state: "uncertain" }, { ref: "P8", state: "failed" }, { ref: null, state: "waiting" },
      ],
    };
    s.counts = { ...s.counts, readOk: 2, uncertain: 1, readFailed: 1 };
    expect(poolSummary(s)).toEqual({ reading: ["P1", "P2", "P3", "P4"], more: 1, ok: 1, failed: 1, uncertain: 1, total: 9 });
  });

  it("anchors the pool label in front of the pool, none without slots", () => {
    expect(poolLabelAt(layout3dFor({ showLocalize: false, showExternal: false, slots: 0 }))).toBeNull();
    const at = poolLabelAt(layout)!;
    const zMax = Math.max(...layout.slots.map((p) => p[2]));
    expect(at[2]).toBeGreaterThan(zMax);
    expect(at[1]).toBeLessThan(layout.slots[0][1]);
  });

  it("visible agents follow the pipeline, external last", () => {
    expect(visibleAgents(layout, PIPELINE)).toEqual(PIPELINE);
    const en = layout3dFor({ showLocalize: false, showExternal: true, slots: 0 });
    expect(visibleAgents(en, PIPELINE)).toEqual([...PIPELINE.filter((id) => id !== "localize"), "external"]);
  });
});
