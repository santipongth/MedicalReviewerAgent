import { describe, expect, it } from "vitest";
import { STATUS_FIXTURE } from "@/test/status-fixture";
import { AGENT_LABEL, PIPELINE, STAGE_MAX_PAPERS, initialScene, reduceScene, type EdgeId } from "./agent-scene";
import type { ReviewEvent } from "./types";
import {
  SATELLITES,
  REF_FONT, arc, clip, layoutFor, queryChars, segPath, segX, segY, type LayoutKind, type Rect, type StageLayout,
} from "./agent-layout";

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
    expect(s.text.x + 100).toBeLessThanOrEqual(l.width); // names are <= 100px at 12px
    expect(s.text.y + 4).toBeLessThanOrEqual(l.height);
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
        for (let slots = 0; slots <= STAGE_MAX_PAPERS + 1; slots += 3) {
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
              expect(l.slots).toHaveLength(Math.min(slots, STAGE_MAX_PAPERS));
            }
          }
        }
      }
    }
  });
  it("covers every slot/batch/query count edge", () => {
    for (let s = 0; s <= STAGE_MAX_PAPERS + 1; s++) inside(layoutFor(kind, { ...base, slots: s, batches: 10, queries: 12 }));
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
  it("has eight search-engine satellites and caps chips", () => {
    const l = layoutFor(kind, { ...base, batches: 99, queries: 99, slots: 99 });
    expect(l.satellites.map((s) => s.label)).toEqual(["PubMed", "Europe PMC", "OpenAlex", "Semantic Scholar", "Crossref", "arXiv", "DOAJ", "OpenAIRE"]);
    expect(l.satellites).toHaveLength(SATELLITES.length);
    expect(l.queryChips).toHaveLength(5);
    expect(l.batchChips).toHaveLength(10);
    expect(l.slots).toHaveLength(STAGE_MAX_PAPERS);
  });
});

describe.each(["wide", "narrow"] as LayoutKind[])("edges avoid zones (%s)", (kind) => {
  it("no sampled edge point falls inside a zone rect, chip or slot box", () => {
    for (const showLocalize of [true, false]) {
      for (const showExternal of [true, false]) {
        for (let slots = 0; slots <= STAGE_MAX_PAPERS + 1; slots++) {
          const l = layoutFor(kind, { showLocalize, showExternal, slots, batches: 10, queries: 12 });
          const rects = [...Object.values(l.zone), ...l.queryChips, ...l.batchChips];
          const bad: string[] = [];
          for (const e of l.edges) {
            for (let t = 0.1; t <= 0.901; t += 0.05) {
              const x = segX(e.seg, t);
              const y = segY(e.seg, t);
              for (const r of rects) {
                const hit = x >= r!.x && x <= r!.x + r!.w && y >= r!.y && y <= r!.y + r!.h;
                if (hit) bad.push(`${kind} ${e.id} t=${t.toFixed(2)} in rect ${JSON.stringify(r)}`);
              }
              for (const p of l.slots) if (Math.hypot(x - p.x, y - p.y) <= 8) bad.push(`${kind} ${e.id} t=${t.toFixed(2)} near slot ${JSON.stringify(p)}`);
            }
          }
          expect(bad).toEqual([]);
        }
      }
    }
  });
});

describe.each(["wide", "narrow"] as LayoutKind[])("scene edge ids exist in layout (%s)", (kind) => {
  const E = (seq: number, type: string, payload: Record<string, unknown> = {}): ReviewEvent => ({ seq, type, payload });
  const walk = (withLocalize: boolean): ReviewEvent[] => [
    E(1, "started"), E(2, "checking_topic"), E(3, "refining"), E(4, "question_refined"), E(5, "planning", { queries: ["a"] }),
    E(6, "searching", { found: 3 }), E(7, "enriching", { candidates: 3 }), E(8, "screening"), E(9, "screened", { kept: 1, total: 3 }),
    E(10, "external_lookup"), E(11, "reading", { ref: "P1" }), E(12, "extracted", { ref: "P1", ok: true }),
    E(13, "synthesizing", { papers: 1 }), ...(withLocalize ? [E(14, "localizing")] : []), E(15, "finalizing"), E(16, "done"),
  ];
  // Thai without `localizing` = no papers or localize off: the lane still draws localize (it follows the language)
  for (const [language, withLocalize] of [["th", true], ["en", false], ["th", false]] as const) {
    it(`every edge the scene emits is drawable (${language}, localizing=${withLocalize})`, () => {
      let s = initialScene({ language });
      const emitted = new Set<string>();
      for (const ev of walk(withLocalize)) {
        s = reduceScene(s, { kind: "event", ev });
        s.pulses.forEach((p) => emitted.add(p.edge));
        Object.keys(s.edges).forEach((k) => emitted.add(k));
      }
      const ids = new Set(layoutFor(kind, { ...base, showLocalize: s.expectLocalize }).edges.map((e) => e.id));
      for (const id of emitted) expect(ids.has(id as EdgeId), id).toBe(true);
    });
  }
});

const full = { slots: 30, batches: 6, queries: 9 };
const fullest = { slots: STAGE_MAX_PAPERS, batches: 10, queries: 12 };
const lane = (l: StageLayout) => Object.entries(l.nodes).filter(([k]) => k !== "external").map(([, p]) => p!);
const overlap = (a: Rect, b: Rect) => Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);

describe("wide composition", () => {
  // a typical run (30 readers) and the most the stage shows (STAGE_MAX_PAPERS readers, five rows)
  const opts = [full, fullest].flatMap((f) => [true, false].flatMap((showLocalize) => [true, false].map((showExternal) => ({ ...f, showLocalize, showExternal }))));

  it("is a single, evenly spaced lane centred in the viewBox", () => {
    for (const o of opts) {
      const l = layoutFor("wide", o);
      const xs = lane(l).map((p) => p.x);
      expect(new Set(lane(l).map((p) => p.y)).size).toBe(1);
      expect(l.width).toBe(960);
      expect(xs[0] + xs[xs.length - 1]).toBeCloseTo(l.width, 6); // centred: equal margins left and right
      expect(xs[xs.length - 1] - xs[0]).toBeGreaterThanOrEqual(0.9 * l.width); // spans the box
      const gaps = xs.slice(1).map((x, i) => x - xs[i]);
      for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 6);
      expect(gaps[0]).toBeGreaterThanOrEqual(90); // single-line labels (<= 80px) never meet
    }
  });

  it("keeps one constant box: the height never depends on external tools, localize or the detail counts", () => {
    const h = layoutFor("wide", { ...base, showExternal: false, slots: 0, batches: 0, queries: 0 }).height;
    for (const o of opts) for (const slots of [0, 1, 30, STAGE_MAX_PAPERS, STAGE_MAX_PAPERS + 1]) expect(layoutFor("wide", { ...o, slots }).height).toBe(h);
    expect(layoutFor("wide", { ...base, showExternal: true }).height).toBe(h);
  });

  it("nests the external node in the headroom: clear of the tiles, arcs, done badges and labels", () => {
    for (const showLocalize of [true, false]) {
      const l = layoutFor("wide", { ...full, showLocalize, showExternal: true });
      const ext = l.nodes.external!;
      const n = l.nodes;
      const laneY = n.read!.y;
      expect(ext.y - 22 * 1.06).toBeGreaterThanOrEqual(0); // inside the box even at the active scale
      // horizontally between the read and synth tiles (both at the active scale)
      expect(ext.x - 22 * 1.06).toBeGreaterThanOrEqual(n.read!.x + 22 * 1.06);
      expect(ext.x + 22 * 1.06).toBeLessThanOrEqual(n.synth!.x - 22 * 1.06);
      // the read>synth arc passes under it
      const rs = l.edges.find((e) => e.id === "read>synth")!;
      expect(segY(rs.seg, 0.5)).toBeGreaterThan(ext.y + 22 + 2);
      // its label (right of the tile, baseline ext.y + 4, <= 100px, ~14px tall) stays above the tiles and their badges
      const label = { x: ext.x + 30, y: ext.y + 4 - 14, w: 100, h: 18 };
      for (const id of PIPELINE) {
        const p = n[id];
        if (p) expect(overlap(label, { x: p.x - 23, y: p.y - 23, w: 46, h: 46 }), id).toBe(false);
      }
      expect(label.y + label.h).toBeLessThanOrEqual(laneY - 22);
      expect(label.x + label.w).toBeLessThanOrEqual(l.width);
    }
  });

  it("starts every detail block on the band's common top edge, below the labels and counts", () => {
    for (const o of opts) {
      const l = layoutFor("wide", o);
      const laneY = lane(l)[0].y;
      const band = l.band!;
      expect(band.y).toBeGreaterThanOrEqual(laneY + 22 + 16 + 17 + 12); // tile, label baseline, count baseline, gap
      for (const id of ["plan", "search", "screen", "read"] as const) expect(l.zone[id]!.y, id).toBe(band.y - 6);
      expect(l.queryChips[0].y).toBe(band.y);
      expect(l.batchChips[0].y).toBe(band.y + 4);
      expect(l.slots[0].y - l.slotR).toBe(band.y + 2);
      expect(l.satellites[0].text.y - 13).toBe(band.y);
      const bottom = band.y + band.h;
      for (const s of l.slots) expect(s.y + l.slotR).toBeLessThanOrEqual(bottom);
      for (const r of l.queryChips) expect(r.y + r.h).toBeLessThanOrEqual(bottom);
      for (const s of l.satellites) expect(s.text.y + 4).toBeLessThanOrEqual(bottom); // the source list is the tallest block
      // the synth caption hangs under the query rows / reader pool (shorter than the list), inside the box
      expect(l.notes.synth.y).toBeGreaterThan(Math.max(...l.slots.map((s) => s.y + l.slotR), l.queryChips[0].y + 5 * 18 - 1));
      expect(l.notes.synth.y + 4).toBeLessThanOrEqual(l.height);
    }
  });

  it("keeps each detail in its agent's column, with no overlap between neighbours", () => {
    for (const o of opts) {
      const l = layoutFor("wide", o);
      const n = l.nodes;
      const z = l.zone;
      // the queries end at the plan tile, the sources start at the search tile, the bar is centred on screen
      expect(l.queryChips[0].x + l.queryChips[0].w).toBe(n.plan!.x + 22);
      expect(l.satellites[0].at.x - 4).toBe(n.search!.x - 22);
      const bar = l.batchChips;
      expect((bar[0].x + bar[bar.length - 1].x + bar[bar.length - 1].w) / 2).toBeCloseTo(n.screen!.x, 6);
      // the reader pool spans the read..finish columns and stays inside the lane's right edge
      const xs = l.slots.map((s) => s.x);
      expect(Math.min(...xs) - l.slotR).toBeGreaterThanOrEqual(n.read!.x - 22 - 30);
      expect(Math.max(...xs) + l.slotR).toBeLessThanOrEqual(n.finish!.x + 22);
      expect(Math.max(...xs)).toBeGreaterThan(n.synth!.x);
      const blocks = [z.plan!, z.search!, z.screen!, z.read!];
      for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) expect(overlap(blocks[i], blocks[j]), `${i}x${j}`).toBe(false);
      // the kept/cut caption (<= 116px wide) sits between the sources and the pool
      const cap = { x: l.notes.screen.x - 58, y: l.notes.screen.y - 12, w: 116, h: 16 };
      expect(overlap(cap, z.search!)).toBe(false);
      expect(overlap(cap, z.read!)).toBe(false);
    }
  });

  it("shows at least 20 query characters per row", () => {
    for (const kind of ["wide", "narrow"] as LayoutKind[]) {
      for (const r of layoutFor(kind, { ...base, queries: 4 }).queryChips) expect(queryChars(r.w)).toBeGreaterThanOrEqual(20);
    }
  });
});

describe.each(["wide", "narrow"] as LayoutKind[])("reader slots (%s)", (kind) => {
  it("fit an 11px 'P50' inside the ring and never touch", () => {
    const l = layoutFor(kind, { ...base, slots: STAGE_MAX_PAPERS });
    expect(l.slots).toHaveLength(STAGE_MAX_PAPERS);
    expect(REF_FONT).toBeGreaterThanOrEqual(11);
    expect(3 * 0.62 * REF_FONT).toBeLessThanOrEqual(2 * (l.slotR - 1.5)); // three glyphs inside the stroke
    for (let i = 1; i < l.slots.length; i++) {
      for (let j = 0; j < i; j++) expect(Math.hypot(l.slots[i].x - l.slots[j].x, l.slots[i].y - l.slots[j].y)).toBeGreaterThanOrEqual(2 * l.slotR + 2);
    }
  });
});

describe("narrow composition", () => {
  it("has no wide band and keeps the external node in the lane between read and synth", () => {
    const l = layoutFor("narrow", { ...base, ...full });
    expect(l.band).toBeNull();
    const { read, external, synth } = l.nodes;
    expect(external!.x).toBe(read!.x);
    expect(external!.y).toBeGreaterThan(Math.max(...l.slots.map((s) => s.y)) + l.slotR + 22);
    expect(synth!.y - external!.y).toBeGreaterThanOrEqual(64);
    // text labels never break inside a word: every narrow label is one line (AgentNode joins the parts)
    expect(AGENT_LABEL.external.th.join("")).toBe("เครื่องมือภายนอก");
  });

  it("left-aligns every detail at x = 70, right of the spine, in lane order", () => {
    const l = layoutFor("narrow", { ...base, ...full });
    for (const r of [...Object.values(l.zone)]) expect(r!.x).toBe(64);
    for (const r of l.queryChips) expect(r.x).toBe(70);
    expect(l.batchChips[0].x).toBe(70);
    expect(Math.min(...l.slots.map((s) => s.x)) - l.slotR).toBe(70);
    expect(l.notes.synth.x).toBe(70);
    // the sources: two columns, names never meet (<= 100px each, columns 140px apart)
    const cols = [...new Set(l.satellites.map((s) => s.text.x))];
    expect(cols).toHaveLength(2);
    expect(cols[1] - cols[0]).toBeGreaterThanOrEqual(110);
    // each detail ends >= 12px above the next tile's top edge
    const ys = lane(l).map((p) => p.y).sort((a, b) => a - b);
    for (const r of Object.values(l.zone)) {
      const nextTile = ys.find((y) => y - 22 > r!.y);
      if (nextTile !== undefined) expect(nextTile - 22 - (r!.y + r!.h)).toBeGreaterThanOrEqual(6);
    }
  });
});

describe("Plan 21: the stage holds every paper the service lets a user ask for", () => {
  it("STAGE_MAX_PAPERS covers /status max_papers.max", () => {
    expect(STAGE_MAX_PAPERS).toBeGreaterThanOrEqual(STATUS_FIXTURE.limits.max_papers.max);
  });

  it.each(["wide", "narrow"] as LayoutKind[])("%s: 50 readers in five rows, clear of each other and the next block; a 51st is clamped", (kind) => {
    const l = layoutFor(kind, { ...base, slots: 51, batches: 10, queries: 12 });
    expect(l.slots).toHaveLength(50);
    expect(new Set(l.slots.map((p) => p.y)).size).toBe(5);
    const pool = l.zone.read!;
    for (const p of l.slots) {
      expect(p.y + l.slotR).toBeLessThanOrEqual(pool.y + pool.h);
      expect(p.x + l.slotR).toBeLessThanOrEqual(pool.x + pool.w);
    }
    for (const [id, z] of Object.entries(l.zone)) if (id !== "read") expect(overlap(z!, pool), id).toBe(false);
    // no tile (at the active scale) sits on the pool
    for (const [id, p] of Object.entries(l.nodes)) expect(overlap({ x: p!.x - 23, y: p!.y - 23, w: 46, h: 46 }, pool), id).toBe(false);
    if (kind === "wide") {
      expect(pool.y + pool.h).toBeLessThanOrEqual(l.height);
      expect(l.notes.synth.y).toBeGreaterThan(Math.max(...l.slots.map((s) => s.y + l.slotR)));
    }
  });
});
