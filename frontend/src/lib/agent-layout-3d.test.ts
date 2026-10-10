import { describe, expect, it } from "vitest";
import {
  BALL_Y, BODY_R, BUBBLE_END_LIFT, BUBBLE_TAIL_IN, BUBBLE_W, PILE_CAP, PILE_HALF, PILE_RISE, PILE_STACK, PILE_STACK_DZ,
  TABLE_R, TABLE_STRETCH, TABLE_TOP, TEAM_ORDER, TILE, TILE_RAISE, arc3, arc3X, arc3Y, arc3Z, arcKey, bubbleSpan,
  pileSpot, teamLayout3D, type Vec3,
} from "./agent-layout-3d";
import { TEAM } from "./agent-team";
import { DIRECTION_ORDER } from "./i18n";

const layout = teamLayout3D();
/** How far outside the (stretched) table ellipse a point on the floor is, in units of the table's radius (>1 = outside). */
const tableR = (x: number, z: number): number => Math.hypot(x / (TABLE_R * TABLE_STRETCH), z / TABLE_R);

describe("arc3", () => {
  it("lifts the midpoint by |b-a|*bend+0.6 along +y", () => {
    const s = arc3([0, 0, 0], [2, 0, 0]);
    expect(arc3Y(s, 0.5)).toBeCloseTo(2 * 0.18 + 0.6, 6);
    expect(arc3X(s, 0.5)).toBeCloseTo(1, 6);
    expect(arc3Z(s, 0.5)).toBeCloseTo(0, 6);
    expect([arc3X(s, 0), arc3Y(s, 0), arc3Z(s, 0)]).toEqual([0, 0, 0]);
    expect([arc3X(s, 1), arc3Y(s, 1), arc3Z(s, 1)]).toEqual([2, 0, 0]);
  });
});

describe("teamLayout3D", () => {
  it("places the five members in team order, left to right, symmetric about the table", () => {
    expect(TEAM_ORDER).toEqual(TEAM.map((m) => m.id));
    const xs = TEAM_ORDER.map((id) => layout.members[id].feet[0]);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThan(1.5);
    expect(xs[0]).toBeCloseTo(-xs[4], 9);
    expect(xs[1]).toBeCloseTo(-xs[3], 9);
    expect(xs[2]).toBeCloseTo(0, 9);
    for (const id of TEAM_ORDER) expect(layout.members[id].feet[1]).toBe(0);
  });

  it("stands around the table, on its far side, never touching it; the middle member furthest back", () => {
    for (const id of TEAM_ORDER) {
      const [x, , z] = layout.members[id].feet;
      expect(z).toBeLessThanOrEqual(1e-9); // behind or beside the table, open toward the camera
      expect(tableR(x, z), id).toBeGreaterThan(1 + (BODY_R + 0.3) / TABLE_R);
    }
    const zs = TEAM_ORDER.map((id) => layout.members[id].feet[2]);
    expect(Math.min(...zs)).toBe(layout.members.screener.feet[2]);
    expect(layout.table).toEqual({ at: [0, TABLE_TOP, 0], r: TABLE_R, stretch: TABLE_STRETCH });
    expect(TABLE_TOP).toBeLessThan(0.5); // low: below a robot's waist
  });

  it("turns each member toward the viewer's side of the table", () => {
    expect(layout.members.planner.yaw).toBeGreaterThan(0); // left members turn right
    expect(layout.members.researcher.yaw).toBeGreaterThan(0);
    expect(layout.members.screener.yaw).toBeCloseTo(0, 9);
    expect(layout.members.reader.yaw).toBeCloseTo(-layout.members.researcher.yaw, 9);
    expect(layout.members.synthesizer.yaw).toBeLessThan(0);
    for (const id of TEAM_ORDER) expect(Math.abs(layout.members[id].yaw)).toBeLessThan(Math.PI / 2);
  });

  it("four phase tiles on a shallow arc above the antenna, left to right; the raised one TILE_RAISE higher", () => {
    for (const id of TEAM_ORDER) {
      const m = layout.members[id];
      expect(m.tiles).toHaveLength(4);
      expect(m.raised).toHaveLength(4);
      expect(m.tileRot).toHaveLength(4);
      for (let i = 0; i < 4; i++) {
        expect(m.tiles[i][1] - TILE / 2).toBeGreaterThan(BALL_Y);
        expect(m.raised[i]).toEqual([m.tiles[i][0], m.tiles[i][1] + TILE_RAISE, m.tiles[i][2]]);
        expect(m.tilesTop).toBeGreaterThanOrEqual(m.raised[i][1] + TILE / 2 - 1e-9);
        if (i > 0) expect(m.tiles[i][0] - m.tiles[i - 1][0]).toBeGreaterThan(TILE); // never overlapping
      }
      expect(m.tiles[1][1]).toBeGreaterThan(m.tiles[0][1]); // an arc: the middle tiles higher
      expect(m.tiles[2][1]).toBeCloseTo(m.tiles[1][1], 9);
      expect(m.tiles[3][1]).toBeCloseTo(m.tiles[0][1], 9);
      expect(m.ball).toEqual([m.feet[0], BALL_Y, m.feet[2]]);
    }
  });

  it("end members' bubbles grow inward from a lifted tail; the others are centred over their tiles", () => {
    expect(TEAM_ORDER.map((id) => layout.members[id].bubble)).toEqual(["start", "center", "center", "center", "end"]);
    expect(bubbleSpan(layout.members.planner)).toEqual([-BUBBLE_TAIL_IN, BUBBLE_W - BUBBLE_TAIL_IN]);
    expect(bubbleSpan(layout.members.synthesizer)).toEqual([BUBBLE_TAIL_IN - BUBBLE_W, BUBBLE_TAIL_IN]);
    expect(bubbleSpan(layout.members.reader)).toEqual([-BUBBLE_W / 2, BUBBLE_W / 2]);
    const gap = (id: (typeof TEAM_ORDER)[number]) => layout.members[id].bubbleY - layout.members[id].tilesTop;
    expect(gap("planner") - gap("reader")).toBeCloseTo(BUBBLE_END_LIFT, 9);
    expect(gap("synthesizer")).toBeCloseTo(gap("planner"), 9);
    for (const id of TEAM_ORDER) {
      const [a, b] = layout.bubbles[id];
      expect(a[1]).toBeGreaterThan(layout.members[id].bubbleY);
      expect(b[0] - a[0]).toBeCloseTo(BUBBLE_W, 9);
    }
  });

  it("hand-off arcs run antenna to antenna for every ordered pair, lifted in the middle", () => {
    for (const p of TEAM_ORDER) {
      for (const q of TEAM_ORDER) {
        const s = layout.arcs[arcKey(p, q)];
        if (p === q) {
          expect(s).toBeUndefined();
          continue;
        }
        expect(s.a).toEqual(layout.members[p].ball);
        expect(s.b).toEqual(layout.members[q].ball);
        expect(arc3Y(s, 0.5)).toBeGreaterThan(BALL_Y + 0.5);
      }
    }
  });

  it("piles: five bases in direction order across the table top", () => {
    const xs = DIRECTION_ORDER.map((d) => layout.piles[d][0]);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1] + 2 * PILE_HALF);
    expect(xs[0]).toBeCloseTo(-xs[4], 9);
    for (const d of DIRECTION_ORDER) expect(layout.piles[d][1]).toBeGreaterThan(TABLE_TOP);
  });

  it("every pile spot, full piles included, stays on the table", () => {
    const out: Vec3 = [0, 0, 0];
    for (const d of DIRECTION_ORDER) {
      for (let i = 0; i < PILE_CAP; i++) {
        const p = pileSpot(layout, d, i, out)!;
        expect(tableR(Math.abs(p[0]) + PILE_HALF, Math.abs(p[2]) + PILE_HALF), `${d} ${i}`).toBeLessThan(1);
      }
    }
  });

  it("pileSpot stacks PILE_STACK high at PILE_RISE, then starts stacks further back, without allocating", () => {
    const out: Vec3 = [0, 0, 0];
    const base = layout.piles.positive;
    expect(pileSpot(layout, "positive", 0, out)).toBe(out);
    expect(out).toEqual(base);
    pileSpot(layout, "positive", PILE_STACK - 1, out);
    expect(out[1]).toBeCloseTo(base[1] + (PILE_STACK - 1) * PILE_RISE, 9);
    pileSpot(layout, "positive", PILE_STACK, out);
    expect(out).toEqual([base[0], base[1], base[2] - PILE_STACK_DZ]);
    pileSpot(layout, "positive", 999, out); // clamped to the last token
    expect(out[2]).toBeCloseTo(base[2] - Math.floor((PILE_CAP - 1) / PILE_STACK) * PILE_STACK_DZ, 9);
    expect(pileSpot({ piles: null }, "positive", 0, out)).toBeNull();
  });

  it("bounds hold every frame point and every bubble; the frame holds the robots, tiles, table and hand-off arcs", () => {
    const { min, max } = layout.bounds;
    const inside = (p: Vec3) => p.every((v, k) => v >= min[k] - 1e-9 && v <= max[k] + 1e-9);
    for (const p of layout.frame) expect(inside(p)).toBe(true);
    for (const id of TEAM_ORDER) for (const p of layout.bubbles[id]) expect(inside(p)).toBe(true);
    const yTop = Math.max(...layout.frame.map((p) => p[1]));
    for (const id of TEAM_ORDER) expect(yTop).toBeGreaterThanOrEqual(layout.members[id].tilesTop);
    for (let i = 1; i < TEAM_ORDER.length; i++) {
      const s = layout.arcs[arcKey(TEAM_ORDER[i - 1], TEAM_ORDER[i])];
      expect(yTop).toBeGreaterThanOrEqual(arc3Y(s, 0.5) - 1e-9);
    }
  });

  it("is constant: the same layout every time", () => {
    expect(teamLayout3D()).toEqual(layout);
  });
});
