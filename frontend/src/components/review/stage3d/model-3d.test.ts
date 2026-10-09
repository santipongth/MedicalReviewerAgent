import { describe, expect, it } from "vitest";
import {
  MAX_DOTS, PACKET_CAP, PIPELINE, emptySlot, initialScene, planDots, reduceScene, takeFreshPulses, type AgentStatus, type Pulse,
  type Scene,
} from "@/lib/agent-scene";
import { PILE_HALF, PILE_PITCH, PILE_STACK_DZ, layout3dFor, type Vec3 } from "@/lib/agent-layout-3d";
import { DIRECTION_ORDER } from "@/lib/i18n";
import {
  ARRIVAL_STAGGER_MS, EDGE_COLOR, EDGE_RADIUS, FIT_MARGIN, FLIGHT_MS, NODE_VISUAL, PACKET_COLOR, PILE_BAR, PILE_COLOR, PILE_R, PILE_SHAPE,
  SLOT_COLOR, SLOT_SCALE, STAGE_ASPECT, STAGE_FOV, THOUGHT_LIFT, anySpinning, cameraAgent, cameraGoal, easeInOut,
  easeToward, fitCamera, flightT, makeFlights, packetScale, pileCaptionAt, pileLabelAt, planArrivals, poolLabelAt,
  poolSummary, schedulePackets, thoughtAnchor, thoughtLeader, visibleAgents,
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

  it("gives every reader-slot state its own silhouette (failed and uncertain are not colour-only)", () => {
    const shapes = Object.values(SLOT_SCALE).map((s) => s.join(","));
    expect(new Set(shapes).size).toBe(shapes.length);
    const [fx, fy, fz] = SLOT_SCALE.failed;
    const [ux, uy, uz] = SLOT_SCALE.uncertain;
    expect(fy).toBeGreaterThan(fx); // failed: tall and narrow
    expect(fx).toBe(fz);
    expect(ux).toBeGreaterThan(uy); // uncertain: a capsule lying along x, narrow in depth (not the round ok disc)
    expect(ux).toBeGreaterThan(uz);
    expect(SLOT_SCALE.ok[0]).toBe(SLOT_SCALE.ok[2]);
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
  it("frames the layout with no current agent and pans part-way toward the current one", () => {
    const centre = cameraGoal(layout, null);
    const cx = centre[0];
    const { min, max } = layout.bounds;
    expect(cx).toBeGreaterThan(min[0]);
    expect(cx).toBeLessThan(max[0]);
    expect(centre[4]).toBeGreaterThan(min[1]);
    expect(centre[4]).toBeLessThan(max[1]);
    expect(centre[1]).toBeGreaterThan(centre[4]); // above, looking down at the fixed elevation
    const g = cameraGoal(layout, "guard");
    const gx = layout.nodes.guard![0];
    expect(g[0]).toBeLessThan(cx);
    expect(g[0]).toBeGreaterThan(gx); // partial pan keeps the lane framed
    expect(g[0] - cx).toBeCloseTo((gx - (min[0] + max[0]) / 2) * 0.1, 6);
    expect(g[3]).toBe(g[0]);
    expect(g.slice(1, 3)).toEqual(centre.slice(1, 3));
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
  it("summarises the pool as counts only: unfinished (reading or queued), ok without uncertain, failed, uncertain", () => {
    const s: Scene = {
      ...initialScene(),
      slots: [
        { ...emptySlot("P1"), state: "reading" }, { ...emptySlot("P2"), state: "reading" }, { ...emptySlot("P3"), state: "reading" },
        { ...emptySlot("P4"), state: "reading" }, { ...emptySlot("P5"), state: "reading" }, { ...emptySlot("P6"), state: "ok" },
        { ...emptySlot("P7"), state: "uncertain" }, { ...emptySlot("P8"), state: "failed" }, emptySlot(null),
      ],
    };
    s.counts = { ...s.counts, readOk: 2, uncertain: 1, readFailed: 1 };
    const sum = poolSummary(s);
    expect(sum).toEqual({ pending: 6, ok: 1, failed: 1, uncertain: 1, total: 9 });
    expect(JSON.stringify(sum)).not.toMatch(/P\d/); // no refs presented as "being read now"
  });

  it("anchors the pool label left of the pool, none without slots", () => {
    expect(poolLabelAt(layout3dFor({ showLocalize: false, showExternal: false, slots: 0 }))).toBeNull();
    const at = poolLabelAt(layout)!;
    expect(at[0]).toBeLessThan(Math.min(...layout.slots.map((p) => p[0])));
    expect(at[1]).toBe(layout.slots[0][1]);
  });

  it("pile labels hang under their bases, the caption centred on their row; none without slots", () => {
    const l = layout3dFor({ showLocalize: true, showExternal: false, slots: 30 });
    for (const d of DIRECTION_ORDER) {
      const at = pileLabelAt(l, d)!;
      expect(at[0]).toBe(l.piles![d][0]);
      expect(at[1]).toBeLessThan(l.piles![d][1]);
      expect(at[1]).toBe(pileCaptionAt(l)![1]); // the caption shares the row; CSS pushes it below the labels
    }
    const empty = layout3dFor({ showLocalize: true, showExternal: false, slots: 0 });
    expect(pileLabelAt(empty, "positive")).toBeNull();
    expect(pileCaptionAt(empty)).toBeNull();
  });

  it("visible agents follow the pipeline, external last", () => {
    expect(visibleAgents(layout, PIPELINE)).toEqual(PIPELINE);
    const en = layout3dFor({ showLocalize: false, showExternal: true, slots: 0 });
    expect(visibleAgents(en, PIPELINE)).toEqual([...PIPELINE.filter((id) => id !== "localize"), "external"]);
  });
});

describe("evidence piles", () => {
  it("maps all five directions to a distinct glyph-matching shape and a finding colour", () => {
    expect(Object.keys(PILE_SHAPE).sort()).toEqual([...DIRECTION_ORDER].sort());
    expect(PILE_SHAPE).toEqual({ positive: "sphere", negative: "octahedron", null: "bar", mixed: "dome", unclear: "torus" });
    expect(new Set(Object.values(PILE_SHAPE)).size).toBe(5);
    expect(PILE_COLOR).toEqual({ positive: "sup", negative: "harm", null: "none", mixed: "mixed", unclear: "unclear" });
  });

  it("tokens are large enough to tell apart, yet stacks and neighbouring piles never touch", () => {
    // half-extents across (x) and in depth (z) of each token
    const half = [PILE_R.sphere, PILE_R.octahedron, PILE_R.dome, PILE_R.torus + PILE_R.torusTube, PILE_BAR[0] / 2];
    expect(Math.min(PILE_R.sphere, PILE_R.octahedron, PILE_R.dome, PILE_R.torus)).toBeGreaterThanOrEqual(0.09);
    expect(PILE_R.torusTube / PILE_R.torus).toBeGreaterThanOrEqual(0.25); // a thick ring, not a hairline
    expect(Math.max(...half)).toBeCloseTo(PILE_HALF, 6); // the layout's clearance uses the real widest token
    const depth = [PILE_R.sphere, PILE_R.octahedron, PILE_R.dome, PILE_R.torusTube, PILE_BAR[2] / 2];
    expect(2 * Math.max(...depth, PILE_R.torus + PILE_R.torusTube)).toBeLessThan(PILE_STACK_DZ);
    expect(2 * PILE_HALF).toBeLessThan(PILE_PITCH);
  });

  it("edges: idle and visited thin, live thicker", () => {
    expect(EDGE_RADIUS).toEqual({ idle: 0.012, visited: 0.012, live: 0.02 });
  });

  it("planArrivals: items seen at mount snap, a burst animates only the newest `cap` with a 60ms stagger", () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ key: i + 1 }));
    const replay = planArrivals(items, 30, PACKET_CAP);
    expect(replay.animate).toEqual([]);
    expect(replay.snap).toHaveLength(30);

    const burst = planArrivals(items, 0, PACKET_CAP);
    expect(burst.animate.map((a) => a.item.key)).toEqual(Array.from({ length: 12 }, (_, i) => 19 + i));
    expect(burst.animate.map((a) => a.delayMs)).toEqual(Array.from({ length: 12 }, (_, i) => i * ARRIVAL_STAGGER_MS));
    expect(burst.snap).toHaveLength(18);

    const two = planArrivals([{ key: 9 }, { key: 3 }, { key: 7 }], 5, PACKET_CAP);
    expect(two.animate.map((a) => [a.item.key, a.delayMs])).toEqual([[7, 0], [9, 60]]);
    expect(two.snap).toEqual([{ key: 3 }]);
  });
});

describe("thought label", () => {
  const withExt = layout3dFor({ showLocalize: true, showExternal: true, slots: 30 });
  it("floats THOUGHT_LIFT (0.85) above the agent's node", () => {
    const at = thoughtAnchor(layout, "screen")!;
    const n = layout.nodes.screen!;
    expect(at).toEqual([n[0], n[1] + 0.85, n[2]]);
    expect(THOUGHT_LIFT).toBe(0.85);
  });
  it("goes above the external node for read while external is shown, without a leader line", () => {
    const ext = withExt.nodes.external!;
    expect(thoughtAnchor(withExt, "read")).toEqual([ext[0], ext[1] + 0.85, ext[2]]);
    expect(thoughtLeader(withExt, "read")).toBeNull();
    expect(thoughtAnchor(layout, "read")![1]).toBeCloseTo(layout.nodes.read![1] + 0.85);
  });
  it("leader runs from the node's ring up to the label; nothing for an undrawn or missing agent", () => {
    const [a, b] = thoughtLeader(layout, "search")!;
    const n = layout.nodes.search!;
    expect(a[0]).toBe(n[0]);
    expect(a[1]).toBeGreaterThan(n[1]);
    expect(b[1]).toBeGreaterThan(a[1]);
    expect(b[1]).toBeLessThan(n[1] + 0.85);
    expect(thoughtAnchor(layout, null)).toBeNull();
    expect(thoughtAnchor(layout, "external")).toBeNull(); // not in this layout
    expect(thoughtLeader(layout, "external")).toBeNull();
  });
  it("stays inside the bounds' headroom", () => {
    for (const l of [layout, withExt]) {
      for (const id of Object.keys(l.nodes) as (keyof typeof l.nodes)[]) {
        expect(thoughtAnchor(l, id)![1]).toBeLessThanOrEqual(l.bounds.max[1]);
      }
    }
  });
});

/** Pinhole projection of `p` for a camera at pos looking at target (world up +y), vertical fov, aspect = w/h. */
function project(cam: number[], p: Vec3, fovDeg: number, aspect: number): [number, number, number] {
  const f = [cam[3] - cam[0], cam[4] - cam[1], cam[5] - cam[2]];
  const fl = Math.hypot(f[0], f[1], f[2]);
  for (let k = 0; k < 3; k++) f[k] /= fl;
  let r = [f[1] * 0 - f[2] * 1, f[2] * 0 - f[0] * 0, f[0] * 1 - f[1] * 0]; // f x up(0,1,0)
  const rl = Math.hypot(r[0], r[1], r[2]);
  r = r.map((v) => v / rl);
  const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
  const q = [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]];
  const depth = q[0] * f[0] + q[1] * f[1] + q[2] * f[2];
  const x = q[0] * r[0] + q[1] * r[1] + q[2] * r[2];
  const y = q[0] * u[0] + q[1] * u[1] + q[2] * u[2];
  const t = Math.tan((fovDeg * Math.PI) / 360);
  return [x / (depth * t * aspect), y / (depth * t), depth];
}

const corners = (b: { min: Vec3; max: Vec3 }): Vec3[] =>
  Array.from({ length: 8 }, (_, c) => [(c & 1) ? b.max[0] : b.min[0], (c & 2) ? b.max[1] : b.min[1], (c & 4) ? b.max[2] : b.min[2]] as Vec3);

describe("fitted framing", () => {
  const cases = [
    layout3dFor({ showLocalize: true, showExternal: true, slots: 30 }),
    layout3dFor({ showLocalize: false, showExternal: false, slots: 30 }),
    layout3dFor({ showLocalize: true, showExternal: false, slots: 0 }),
  ];
  it("projects every bounds corner within NDC +-0.95 (8% margin), and at least one corner touches the margin", () => {
    for (const l of cases) {
      const cam = fitCamera(l.bounds);
      let edge = 0;
      for (const p of corners(l.bounds)) {
        const [x, y, depth] = project(cam, p, STAGE_FOV, STAGE_ASPECT);
        expect(depth).toBeGreaterThan(0);
        expect(Math.abs(x)).toBeLessThanOrEqual(0.95);
        expect(Math.abs(y)).toBeLessThanOrEqual(0.95);
        edge = Math.max(edge, Math.abs(x), Math.abs(y));
      }
      expect(edge).toBeCloseTo(1 - FIT_MARGIN, 3); // fills the wrapper: not further away than needed
    }
  });
  it("keeps the fixed elevation and centres the projected extent", () => {
    for (const l of cases) {
      for (const pts of [null, l.frame]) {
        const cam = fitCamera(l.bounds, STAGE_ASPECT, STAGE_FOV, undefined, pts);
        expect(Math.atan2(cam[1] - cam[4], cam[2] - cam[5])).toBeCloseTo(Math.atan2(4.2, 7), 6);
        expect(cam[0]).toBe(cam[3]);
        const ys = (pts ?? corners(l.bounds)).map((p) => project(cam, p, STAGE_FOV, STAGE_ASPECT)[1]);
        expect(Math.min(...ys) + Math.max(...ys)).toBeCloseTo(0, 2);
      }
    }
  });
  it("fits the frame points (not the deep bounding box) so the layout fills the wrapper", () => {
    for (const l of cases) {
      const cam = fitCamera(l.bounds, STAGE_ASPECT, STAGE_FOV, undefined, l.frame);
      let edge = 0;
      for (const p of l.frame) {
        const [x, y, depth] = project(cam, p, STAGE_FOV, STAGE_ASPECT);
        expect(depth).toBeGreaterThan(0);
        expect(Math.abs(x)).toBeLessThanOrEqual(0.95);
        expect(Math.abs(y)).toBeLessThanOrEqual(0.95);
        edge = Math.max(edge, Math.abs(x), Math.abs(y));
      }
      expect(edge).toBeCloseTo(1 - FIT_MARGIN, 2);
      const box = fitCamera(l.bounds);
      const dist = (c: number[]) => Math.hypot(c[0] - c[3], c[1] - c[4], c[2] - c[5]);
      expect(dist(cam)).toBeLessThan(dist(box)); // closer than fitting the box corners
    }
  });
  it("cameraGoal keeps every frame point inside the view even when panned toward an end node", () => {
    for (const l of cases) {
      for (const id of [null, "guard", "finish", "read"] as const) {
        const cam = cameraGoal(l, id);
        for (const p of l.frame) {
          const [x, y] = project(cam, p, STAGE_FOV, STAGE_ASPECT);
          expect(Math.abs(x)).toBeLessThanOrEqual(0.95);
          expect(Math.abs(y)).toBeLessThanOrEqual(0.95);
        }
      }
    }
  });
  it("falls back to a finite camera for empty bounds and writes into `out`", () => {
    const out = new Array(6).fill(0);
    const cam = fitCamera({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }, STAGE_ASPECT, STAGE_FOV, out);
    expect(cam).toBe(out);
    expect(cam.every(Number.isFinite)).toBe(true);
  });
});
