import { describe, expect, it } from "vitest";
import { layoutFor, SLOT_R } from "./agent-layout";
import { STAGE_MAX_PAPERS as SCENE_MAX } from "./agent-scene";
import { POOL_COLS, POOL_PITCH, STAGE_MAX_PAPERS, stageRowsFor, stageSizeFor } from "./stage-size";

const base = { showLocalize: true, showExternal: true, batches: 10, queries: 12 };

describe("stageRowsFor / stageSizeFor (Plan 21 fix round 1: one box per run, every view)", () => {
  it("reserves max(3, ceil(N / 10)) pool rows; unknown N is the service default (30, three rows); N clamps to the cap", () => {
    expect([null, undefined, 1, 5, 30, 31, 40, 41, 50, 99].map(stageRowsFor)).toEqual([3, 3, 3, 3, 3, 4, 4, 5, 5, 5]);
    expect(SCENE_MAX).toBe(STAGE_MAX_PAPERS);
  });

  it("is 960/288 up to 30 papers, one pool pitch taller per extra row", () => {
    expect(stageSizeFor(30)).toEqual({ width: 960, height: 288 });
    expect(stageSizeFor(40)).toEqual({ width: 960, height: 288 + POOL_PITCH });
    expect(stageSizeFor(50)).toEqual({ width: 960, height: 288 + 2 * POOL_PITCH });
  });

  for (const n of [5, 30, 50]) {
    it(`N = ${n}: the wide steps layout has the run's box at every slot count from 0 to N, and never more rows than reserved`, () => {
      const size = stageSizeFor(n);
      for (let slots = 0; slots <= n + 1; slots++) {
        for (const showExternal of [true, false]) {
          const l = layoutFor("wide", { ...base, showExternal, slots, requested: n });
          expect({ width: l.width, height: l.height }, `slots ${slots}`).toEqual(size);
          // I2: the live pool never needs more rows than the run reserved (the clamp keeps a stray extra slot inside)
          const rows = new Set(l.slots.map((p) => p.y)).size;
          expect(rows).toBeLessThanOrEqual(stageRowsFor(n));
          expect(Math.ceil(Math.min(slots, stageRowsFor(n) * POOL_COLS) / POOL_COLS)).toBeLessThanOrEqual(stageRowsFor(n));
          for (const p of l.slots) expect(p.y + SLOT_R).toBeLessThanOrEqual(l.height);
        }
      }
    });
  }

  it("the steps view's synth caption clears the reader zone (Thai marks reach ~1.3em above the baseline) and stays inside the box (M2)", () => {
    for (const n of [5, 30, 31, 40, 41, 50]) {
      const l = layoutFor("wide", { ...base, slots: n, requested: n });
      const z = l.zone.read!;
      expect(l.notes.synth.y - 16, `N ${n}`).toBeGreaterThanOrEqual(z.y + z.h);
      expect(l.notes.synth.y + 4).toBeLessThanOrEqual(l.height);
    }
  });
});
