import { describe, expect, it } from "vitest";
import { MAX_DOTS, PACKET_CAP, initialScene, reduceScene, type Scene } from "@/lib/agent-scene";
import {
  BUBBLE_END_LIFT, NAME_DROP, PILE_HALF, PILE_PITCH, PILE_STACK_DZ, TEAM_ORDER, arcKey, teamLayout3D, type Vec3,
} from "@/lib/agent-layout-3d";
import { handoffs, type MemberStatus, type Phase } from "@/lib/agent-team";
import { handoffDots } from "@/lib/team-motion";
import { DIRECTION_ORDER } from "@/lib/i18n";
import type { ReviewEvent } from "@/lib/types";
import {
  ARRIVAL_STAGGER_MS, FIT_MARGIN, FIT_MARGIN_V, FLIGHT_MS, PACKET_COLOR, PAN, PILE_BAR, PILE_COLOR, PILE_R, PILE_SHAPE,
  STAGE_ASPECT, STAGE_FOV, TILE_COLOR, VIEW_BACK, VIEW_UP, anyPinging, bubbleAnchor, bubbleLeader, easeInOut,
  easeToward, fitCamera, flightT, framePoints, makeFlights, memberVisual, nameAnchor, packetScale, pileCaptionAt,
  pileLabelAt, planArrivals, schedulePackets, teamCameraGoal, tileState,
} from "./model-3d";

const layout = teamLayout3D();
const ev = (seq: number, type: string, payload: Record<string, unknown> = {}): ReviewEvent => ({ seq, type, payload });
const run = (evs: ReviewEvent[]): Scene => evs.reduce((s, e) => reduceScene(s, { kind: "event", ev: e }), initialScene({ language: "th" }));

describe("member status -> visual", () => {
  it("speaking (or working) is solid primary; done ink; idle a rule body; failed err; paused warn; stopped muted", () => {
    const want: Record<MemberStatus, [string, string, boolean, string | null, boolean]> = {
      idle: ["rule", "muted", false, null, true],
      working: ["primary", "primary", true, null, false],
      done: ["surface", "ink", false, "done", false],
      failed: ["surface", "err", false, "failed", false],
      paused: ["surface", "warn", false, null, false],
      stopped: ["surface", "muted", false, null, true],
    };
    for (const [st, [fill, edge, ping, mark, dim]] of Object.entries(want)) {
      const v = memberVisual(st as MemberStatus, false);
      expect([v.fill, v.edge, v.ping, v.mark, v.dim], st).toEqual([fill, edge, ping, mark, dim]);
    }
    // the speaker is primary even in a gap between its own steps; only real work pings
    expect(memberVisual("working", true)).toMatchObject({ fill: "primary", ping: true });
    expect(memberVisual("idle", true)).toMatchObject({ fill: "primary", ping: false });
    expect(memberVisual("working", false).eyes).toBe("surface");
    expect(memberVisual("done", false).eyes).toBe("ink");
  });

  it("phase tiles: the current phase is active (primary), passed ones ink, the rest rule", () => {
    expect(TILE_COLOR).toEqual({ active: "primary", passed: "ink", rest: "rule" });
    const passed: Phase[] = ["think", "analyse"];
    expect(tileState("plan", "plan", passed)).toBe("active");
    expect(tileState("think", "plan", passed)).toBe("passed");
    expect(tileState("act", "plan", passed)).toBe("rest");
    expect(tileState("act", null, ["think", "analyse", "plan", "act"])).toBe("passed");
  });

  it("anyPinging only while a member works", () => {
    expect(anyPinging([{ status: "idle" }, { status: "done" }])).toBe(false);
    expect(anyPinging([{ status: "done" }, { status: "working" }])).toBe(true);
  });
});

describe("hand-off packets", () => {
  // planning -> searching makes a plan>search pulse: a hand-off from the planner to the researcher
  const pre = [ev(1, "started"), ev(2, "checking_topic"), ev(3, "refining"), ev(4, "question_refined"), ev(5, "planning", { queries: ["a", "b"] })];
  const scene = run([...pre, ev(6, "searching", { found: 40 })]);

  it("packets use the 2D stage's tokens", () => {
    expect(PACKET_COLOR).toEqual({ query: "ink", paper: "ink", kept: "primary", card: "primary", failed: "err", signal: "muted" });
  });

  it("assigns dots round-robin onto the head-to-head arc, with their delays, and wraps the cursor", () => {
    const fresh = handoffs(scene, 0);
    expect(fresh.length).toBeGreaterThan(0);
    const dots = handoffDots([{ key: 9, from: "planner", to: "researcher", kind: "query", n: 3 }], MAX_DOTS);
    const flights = makeFlights(4);
    let c = schedulePackets(flights, 2, dots, layout.arcs, 1000);
    expect(c).toBe(1);
    expect(flights.map((f) => f.start)).toEqual([1240, 0, 1000, 1120]);
    expect(flights[0].seg).toBe(layout.arcs[arcKey("planner", "researcher")]);
    expect(flights[0].seg!.a).toEqual(layout.members.planner.ball);
    expect(flights[0].seg!.b).toEqual(layout.members.researcher.ball);
    expect(flights[1].seg).toBeNull();
    c = schedulePackets(flights, c, dots.slice(0, 1), layout.arcs, 5000);
    expect(c).toBe(2);
    expect(flights[1].start).toBe(5000);
  });

  it("drops a dot with no arc without taking a slot", () => {
    const flights = makeFlights(4);
    const c = schedulePackets(flights, 0, [{ from: "reader", to: "reader", kind: "signal", delayMs: 0 }], layout.arcs, 0);
    expect(c).toBe(0);
    expect(flights.every((f) => f.seg === null)).toBe(true);
  });

  it("replays collapse: hand-offs seen at mount produce no dots, a burst stays capped", () => {
    expect(handoffs(scene, scene.lastSeq)).toEqual([]);
    const burst = Array.from({ length: 30 }, (_, i) => ({ key: i + 1, from: "screener" as const, to: "reader" as const, kind: "kept" as const, n: 8 }));
    const dots = handoffDots(burst.slice(-PACKET_CAP), MAX_DOTS);
    expect(dots.length).toBeLessThanOrEqual(MAX_DOTS);
    const flights = makeFlights(MAX_DOTS);
    schedulePackets(flights, 0, dots, layout.arcs, 0);
    expect(Math.max(...flights.map((f) => f.start))).toBeLessThan(5000);
  });

  it("flight progress: pending < 0, flying 0..1, finished > 1, idle Infinity", () => {
    const [f] = makeFlights(1);
    expect(flightT(f, 0)).toBe(Infinity);
    f.seg = layout.arcs[arcKey("reader", "synthesizer")];
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

describe("evidence piles", () => {
  it("maps all five directions to a distinct glyph-matching shape and a finding colour", () => {
    expect(Object.keys(PILE_SHAPE).sort()).toEqual([...DIRECTION_ORDER].sort());
    expect(PILE_SHAPE).toEqual({ positive: "sphere", negative: "octahedron", null: "bar", mixed: "dome", unclear: "torus" });
    expect(new Set(Object.values(PILE_SHAPE)).size).toBe(5);
    expect(PILE_COLOR).toEqual({ positive: "sup", negative: "harm", null: "none", mixed: "mixed", unclear: "unclear" });
  });

  it("tokens are large enough to tell apart, yet stacks and neighbouring piles never touch", () => {
    const half = [PILE_R.sphere, PILE_R.octahedron, PILE_R.dome, PILE_R.torus + PILE_R.torusTube, PILE_BAR[0] / 2];
    expect(Math.min(PILE_R.sphere, PILE_R.octahedron, PILE_R.dome, PILE_R.torus)).toBeGreaterThanOrEqual(0.09);
    expect(PILE_R.torusTube / PILE_R.torus).toBeGreaterThanOrEqual(0.25);
    expect(Math.max(...half)).toBeCloseTo(PILE_HALF, 6);
    const depth = [PILE_R.sphere, PILE_R.octahedron, PILE_R.dome, PILE_R.torusTube, PILE_BAR[2] / 2];
    expect(2 * Math.max(...depth, PILE_R.torus + PILE_R.torusTube)).toBeLessThan(PILE_STACK_DZ);
    expect(2 * PILE_HALF).toBeLessThan(PILE_PITCH);
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

describe("label anchors", () => {
  it("names hang just under each member's feet", () => {
    for (const id of TEAM_ORDER) {
      const f = layout.members[id].feet;
      expect(nameAnchor(layout, id)).toEqual([f[0], -NAME_DROP, f[2]]);
    }
  });

  it("the bubble's tail sits above the tiles; the end members' is lifted, with a leader down to the tiles", () => {
    for (const id of TEAM_ORDER) {
      const m = layout.members[id];
      const at = bubbleAnchor(layout, id);
      expect(at).toEqual([m.feet[0], m.bubbleY, m.feet[2]]);
      expect(at[1]).toBeGreaterThan(m.tilesTop);
      const leader = bubbleLeader(layout, id);
      if (id === "planner" || id === "synthesizer") {
        expect(m.bubbleY - m.tilesTop).toBeGreaterThan(BUBBLE_END_LIFT);
        expect(leader![0][1]).toBeGreaterThan(m.tilesTop);
        expect(leader![1]).toEqual(at);
      } else {
        expect(leader).toBeNull();
      }
    }
  });

  it("pile labels hang in front of the table under their piles, the caption centred on their row", () => {
    for (const d of DIRECTION_ORDER) {
      const at = pileLabelAt(layout, d)!;
      expect(at[0]).toBe(layout.piles[d][0]);
      expect(at[1]).toBeLessThan(layout.piles[d][1]);
      expect(at[2]).toBeGreaterThan(layout.piles[d][2]);
      expect(at[1]).toBe(pileCaptionAt(layout)![1]);
    }
    expect(pileCaptionAt(layout)![0]).toBeCloseTo(0, 9);
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

const LIM_X = 1 - FIT_MARGIN + 1e-6;
const LIM_Y = 1 - FIT_MARGIN_V + 1e-6;
const SPEAKERS = [null, ...TEAM_ORDER] as const;

describe("camera", () => {
  it("uses a slimmer vertical margin than the side margin (the flat box is height-bound)", () => {
    expect(FIT_MARGIN_V).toBeLessThan(FIT_MARGIN);
    expect(FIT_MARGIN_V).toBeGreaterThan(0);
  });

  it("fitCamera projects every bounds corner inside the margins, one touching a margin", () => {
    const cam = fitCamera(layout.bounds);
    let edge = 0;
    for (const p of corners(layout.bounds)) {
      const [x, y, depth] = project(cam, p, STAGE_FOV, STAGE_ASPECT);
      expect(depth).toBeGreaterThan(0);
      expect(Math.abs(x)).toBeLessThanOrEqual(LIM_X);
      expect(Math.abs(y)).toBeLessThanOrEqual(LIM_Y);
      edge = Math.max(edge, Math.abs(x) / (1 - FIT_MARGIN), Math.abs(y) / (1 - FIT_MARGIN_V));
    }
    expect(edge).toBeCloseTo(1, 3);
  });

  it("keeps the fixed elevation for every speaker and centres the projected extent", () => {
    for (const who of SPEAKERS) {
      const cam = fitCamera(layout.bounds, STAGE_ASPECT, STAGE_FOV, undefined, framePoints(layout, who));
      expect(Math.atan2(cam[1] - cam[4], cam[2] - cam[5])).toBeCloseTo(Math.atan2(VIEW_UP, VIEW_BACK), 6);
      expect(cam[0]).toBe(cam[3]);
      const ys = framePoints(layout, who).map((p) => project(cam, p, STAGE_FOV, STAGE_ASPECT)[1]);
      expect(Math.min(...ys) + Math.max(...ys)).toBeCloseTo(0, 2);
    }
  });

  it("frames the team plus only the speaker's bubble", () => {
    expect(framePoints(layout, null)).toBe(layout.frame);
    const pts = framePoints(layout, "reader");
    expect(pts).toHaveLength(layout.frame.length + 2);
    expect(pts.slice(-2)).toEqual(layout.bubbles.reader);
  });

  it("teamCameraGoal keeps every frame point and the speaker's bubble in view, whoever speaks", () => {
    for (const who of SPEAKERS) {
      const cam = teamCameraGoal(layout, who);
      for (const p of framePoints(layout, who)) {
        const [x, y, depth] = project(cam, p, STAGE_FOV, STAGE_ASPECT);
        expect(depth).toBeGreaterThan(0);
        expect(Math.abs(x), `${who} x`).toBeLessThanOrEqual(LIM_X);
        expect(Math.abs(y), `${who} y`).toBeLessThanOrEqual(LIM_Y);
      }
    }
  });

  it("eases toward the speaking member: a partial pan along x, look-at and position together", () => {
    const centre = teamCameraGoal(layout, null);
    const { min, max } = layout.bounds;
    const cx = (min[0] + max[0]) / 2;
    expect(centre[1]).toBeGreaterThan(centre[4]); // above, looking down
    const left = teamCameraGoal(layout, "planner");
    const right = teamCameraGoal(layout, "synthesizer");
    const px = layout.members.planner.feet[0];
    expect(left[3]).toBeLessThan(right[3]);
    expect(left[0]).toBe(left[3]);
    expect(left[0]).toBeGreaterThan(px); // partial: the far end stays framed
    const unpanned = fitCamera(layout.bounds, STAGE_ASPECT, STAGE_FOV, undefined, framePoints(layout, "planner"),
      Math.max(...TEAM_ORDER.map((id) => Math.abs(layout.members[id].feet[0] - cx) * PAN)));
    expect(left[0] - unpanned[0]).toBeCloseTo((px - cx) * PAN, 6);
  });

  it("writes into the provided buffer", () => {
    const out = new Array(6).fill(0);
    expect(teamCameraGoal(layout, "reader", out)).toBe(out);
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

  it("falls back to a finite camera for empty bounds and writes into `out`", () => {
    const out = new Array(6).fill(0);
    const cam = fitCamera({ min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }, STAGE_ASPECT, STAGE_FOV, out);
    expect(cam).toBe(out);
    expect(cam.every(Number.isFinite)).toBe(true);
  });
});
