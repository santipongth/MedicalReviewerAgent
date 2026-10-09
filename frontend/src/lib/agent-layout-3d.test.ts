import { describe, expect, it } from "vitest";
import { initialScene, reduceScene, type EdgeId } from "./agent-scene";
import type { ReviewEvent } from "./types";
import { arc3, arc3X, arc3Y, arc3Z, layout3dFor } from "./agent-layout-3d";

const base = { showLocalize: true, showExternal: true, slots: 0 };

describe("arc3", () => {
  it("lifts the midpoint by |b-a|*bend+0.6 along +y", () => {
    const s = arc3([0, 0, 0], [4, 0, 0]);
    expect(arc3X(s, 0.5)).toBeCloseTo(2, 6);
    expect(arc3Y(s, 0.5)).toBeCloseTo(4 * 0.18 + 0.6, 6);
    expect(arc3Z(s, 0.5)).toBeCloseTo(0, 6);
    expect(arc3X(s, 0)).toBe(0);
    expect(arc3Y(s, 1)).toBe(0);
  });
  it("helpers return finite numbers at the ends and in between", () => {
    const s = arc3([1, 2, 3], [-4, 0.5, -2], 0.3);
    for (const t of [0, 0.25, 0.5, 1]) {
      expect(Number.isFinite(arc3X(s, t))).toBe(true);
      expect(Number.isFinite(arc3Y(s, t))).toBe(true);
      expect(Number.isFinite(arc3Z(s, t))).toBe(true);
    }
    expect(arc3Z(s, 1)).toBe(-2);
  });
});

describe("layout3dFor", () => {
  it("keeps nodes at least 1.2 apart, centred on x=0, external above read", () => {
    for (const showLocalize of [true, false]) {
      for (const showExternal of [true, false]) {
        const l = layout3dFor({ showLocalize, showExternal, slots: 30 });
        const ns = Object.values(l.nodes);
        for (let i = 0; i < ns.length; i++) {
          for (let j = i + 1; j < ns.length; j++) {
            expect(Math.hypot(ns[i]![0] - ns[j]![0], ns[i]![1] - ns[j]![1], ns[i]![2] - ns[j]![2])).toBeGreaterThanOrEqual(1.2);
          }
        }
        const lane = Object.entries(l.nodes).filter(([k]) => k !== "external").map(([, p]) => p![0]);
        expect(lane.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 6);
        expect(l.nodes.localize !== undefined).toBe(showLocalize);
        expect(l.nodes.external !== undefined).toBe(showExternal);
        if (showExternal) expect(l.nodes.external![1]).toBe(1.6);
      }
    }
  });
  it("slot count is min(n, 30) and slots keep a 0.35 pitch on the y=-2.3 plane", () => {
    for (const n of [0, 1, 7, 30, 99, -3, Number.NaN]) {
      const l = layout3dFor({ ...base, slots: n });
      expect(l.slots).toHaveLength(Number.isFinite(n) ? Math.max(0, Math.min(n, 30)) : 0);
      for (const s of l.slots) expect(s[1]).toBe(-2.3);
    }
    const l = layout3dFor({ ...base, slots: 30 });
    expect(l.slots[1][0] - l.slots[0][0]).toBeCloseTo(0.35, 6);
    expect(l.slots[6][2] - l.slots[0][2]).toBeCloseTo(0.35, 6);
  });
  it("bounds contain every node, slot and edge sample", () => {
    const l = layout3dFor({ ...base, slots: 30 });
    const inB = (x: number, y: number, z: number) => {
      const { min, max } = l.bounds;
      expect(x).toBeGreaterThanOrEqual(min[0]); expect(x).toBeLessThanOrEqual(max[0]);
      expect(y).toBeGreaterThanOrEqual(min[1]); expect(y).toBeLessThanOrEqual(max[1]);
      expect(z).toBeGreaterThanOrEqual(min[2]); expect(z).toBeLessThanOrEqual(max[2]);
    };
    for (const p of [...Object.values(l.nodes), ...l.slots]) inB(p![0], p![1], p![2]);
    for (const e of l.edges) for (let k = 0; k <= 10; k++) inB(arc3X(e.seg, k / 10), arc3Y(e.seg, k / 10), arc3Z(e.seg, k / 10));
  });
  it("drops localize and adds synth>finish when localize is hidden", () => {
    const l = layout3dFor({ ...base, showLocalize: false });
    expect(l.edges.some((e) => e.id === "synth>finish")).toBe(true);
    expect(l.edges.some((e) => e.id === "synth>localize")).toBe(false);
    const full = layout3dFor(base).edges.map((e) => e.id);
    expect(full).toContain("synth>localize");
    expect(full).toContain("localize>finish");
    expect(full).toContain("read>external");
    expect(full).toContain("external>synth");
    expect(layout3dFor({ ...base, showExternal: false }).edges.some((e) => e.id === "read>external")).toBe(false);
  });
});

describe("scene edge ids exist in 3D layout", () => {
  const E = (seq: number, type: string, payload: Record<string, unknown> = {}): ReviewEvent => ({ seq, type, payload });
  const walk = (withLocalize: boolean): ReviewEvent[] => [
    E(1, "started"), E(2, "checking_topic"), E(3, "refining"), E(4, "question_refined"), E(5, "planning", { queries: ["a"] }),
    E(6, "searching", { found: 3 }), E(7, "enriching", { candidates: 3 }), E(8, "screening"), E(9, "screened", { kept: 1, total: 3 }),
    E(10, "external_lookup"), E(11, "reading", { ref: "P1" }), E(12, "extracted", { ref: "P1", ok: true }),
    E(13, "synthesizing", { papers: 1 }), ...(withLocalize ? [E(14, "localizing")] : []), E(15, "finalizing"), E(16, "done"),
  ];
  for (const [language, withLocalize] of [["th", true], ["en", false], ["th", false]] as const) {
    it(`every edge the scene emits is drawable (${language}, localizing=${withLocalize})`, () => {
      let s = initialScene({ language });
      const emitted = new Set<string>();
      for (const ev of walk(withLocalize)) {
        s = reduceScene(s, { kind: "event", ev });
        s.pulses.forEach((p) => emitted.add(p.edge));
        Object.keys(s.edges).forEach((k) => emitted.add(k));
      }
      const ids = new Set(layout3dFor({ ...base, showLocalize: s.expectLocalize }).edges.map((e) => e.id));
      for (const id of emitted) expect(ids.has(id as EdgeId), id).toBe(true);
    });
  }
});
