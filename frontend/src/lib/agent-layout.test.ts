import { describe, expect, it } from "vitest";
import { arc, clip, layoutFor, segPath, segX, segY, type LayoutKind, type StageLayout } from "./agent-layout";

const base = { showLocalize: true, showExternal: true, slots: 0, batches: 0, queries: 0 };

describe("arc", () => {
  it("lifts a horizontal pair by |dx|*0.18+6 and passes through the lifted midpoint", () => {
    const s = arc({ x: 0, y: 100 }, { x: 100, y: 100 });
    expect(segX(s, 0.5)).toBeCloseTo(50, 6);
    expect(segY(s, 0.5)).toBeCloseTo(100 - (100 * 0.18 + 6), 6);
    expect(segX(s, 0)).toBe(0);
    expect(segY(s, 1)).toBe(100);
  });
  it("bulges right for vertical edges", () => {
    const s = arc({ x: 10, y: 0 }, { x: 10, y: 100 });
    expect(segX(s, 0.5)).toBeCloseTo(10 + 24, 6);
    expect(segY(s, 0.5)).toBeCloseTo(50, 6);
  });
  it("segPath is stable", () => {
    expect(segPath(arc({ x: 0, y: 0 }, { x: 100, y: 0 }))).toBe("M 0.0 0.0 Q 50.0 -48.0 100.0 0.0");
  });
});

describe("clip", () => {
  it("keeps short text and ellipsizes long text", () => {
    expect(clip("abc", 3)).toBe("abc");
    expect(clip("abcdef", 4)).toBe("abc…");
  });
});

function inside(l: StageLayout) {
  const pts = [...Object.values(l.nodes), ...l.slots];
  for (const p of pts) {
    expect(p!.x - 22).toBeGreaterThanOrEqual(0);
    expect(p!.y - 22).toBeGreaterThanOrEqual(0);
    expect(p!.x + 22).toBeLessThanOrEqual(l.width);
    expect(p!.y + 22).toBeLessThanOrEqual(l.height);
  }
  for (const s of l.satellites) {
    expect(s.at.x).toBeGreaterThanOrEqual(0);
    expect(s.at.y).toBeGreaterThanOrEqual(0);
    expect(s.at.x).toBeLessThanOrEqual(l.width);
  }
  for (const r of [...l.queryChips, ...l.batchChips]) {
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(l.width);
    expect(r.y + r.h).toBeLessThanOrEqual(l.height);
  }
}

describe.each(["wide", "narrow"] as LayoutKind[])("layoutFor %s", (kind) => {
  it("keeps everything inside the viewBox and nodes apart", () => {
    for (const showLocalize of [true, false]) {
      for (const showExternal of [true, false]) {
        for (let slots = 0; slots <= 30; slots += 3) {
          for (let batches = 0; batches <= 10; batches += 2) {
            for (let queries = 0; queries <= 12; queries += 3) {
              const l = layoutFor(kind, { showLocalize, showExternal, slots, batches, queries });
              inside(l);
              if (kind === "narrow") expect(l.width).toBeLessThanOrEqual(360);
              const ns = Object.values(l.nodes);
              for (let i = 0; i < ns.length; i++) {
                for (let j = i + 1; j < ns.length; j++) {
                  expect(Math.hypot(ns[i]!.x - ns[j]!.x, ns[i]!.y - ns[j]!.y)).toBeGreaterThanOrEqual(44);
                }
              }
              expect(l.slots).toHaveLength(Math.min(slots, 30));
            }
          }
        }
      }
    }
  });
  it("covers every slot/batch/query count edge", () => {
    for (let s = 0; s <= 30; s++) inside(layoutFor(kind, { ...base, slots: s, batches: 10, queries: 12 }));
    for (let b = 0; b <= 10; b++) inside(layoutFor(kind, { ...base, batches: b }));
    for (let q = 0; q <= 12; q++) inside(layoutFor(kind, { ...base, queries: q }));
  });
  it("drops localize and adds synth>finish when localize is hidden", () => {
    const l = layoutFor(kind, { ...base, showLocalize: false });
    expect(l.nodes.localize).toBeUndefined();
    expect(l.edges.some((e) => e.id === "synth>finish")).toBe(true);
    expect(l.edges.some((e) => e.id === "synth>localize")).toBe(false);
  });
  it("shows localize edges and external edges when enabled", () => {
    const l = layoutFor(kind, base);
    const ids = l.edges.map((e) => e.id);
    expect(ids).toContain("synth>localize");
    expect(ids).toContain("localize>finish");
    expect(ids).toContain("read>external");
    expect(layoutFor(kind, { ...base, showExternal: false }).nodes.external).toBeUndefined();
  });
  it("has five search-engine satellites and caps chips", () => {
    const l = layoutFor(kind, { ...base, batches: 99, queries: 99, slots: 99 });
    expect(l.satellites.map((s) => s.label)).toEqual(["PubMed", "arXiv", "Semantic Scholar", "OpenAlex", "Crossref"]);
    expect(l.queryChips).toHaveLength(5);
    expect(l.batchChips).toHaveLength(10);
    expect(l.slots).toHaveLength(30);
  });
});

describe("wide specifics", () => {
  it("is a single lane", () => {
    const l = layoutFor("wide", base);
    expect(new Set(Object.entries(l.nodes).filter(([k]) => k !== "external").map(([, p]) => p!.y)).size).toBe(1);
    expect(l.width).toBe(960);
  });
});
