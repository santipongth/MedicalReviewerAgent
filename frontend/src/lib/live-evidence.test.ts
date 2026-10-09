import { describe, expect, it } from "vitest";
import { type Scene, initialScene, reduceScene } from "./agent-scene";
import { DIRECTION_ORDER, asDesign, asDirection, isPooledDesign, liveTally } from "./live-evidence";
import type { ReviewEvent } from "./types";

const ev = (seq: number, type: string, payload: Record<string, unknown> = {}): ReviewEvent => ({ seq, type, payload });
const run = (events: ReviewEvent[], s: Scene = initialScene({ language: "th" })): Scene =>
  events.reduce((acc, e) => reduceScene(acc, { kind: "event", ev: e }), s);

describe("asDirection / asDesign", () => {
  it("accepts only the five enum strings; the string \"null\" is a direction, JSON null is not", () => {
    expect(asDirection("null")).toBe("null");
    expect(asDirection(null)).toBeNull();
    expect(asDirection(undefined)).toBeNull();
    expect(asDirection("benefit")).toBeNull();
    expect(asDirection("Positive")).toBeNull();
    expect(asDirection(1)).toBeNull();
    for (const d of DIRECTION_ORDER) expect(asDirection(d)).toBe(d);
  });
  it("accepts only known design categories", () => {
    expect(asDesign("rct")).toBe("rct");
    expect(asDesign("sr_ma_mixed")).toBe("sr_ma_mixed");
    expect(asDesign("meta_analysis")).toBeNull();
    expect(asDesign("toString")).toBeNull();
    expect(asDesign(null)).toBeNull();
  });
  it("fixed order and pooled rule", () => {
    expect(DIRECTION_ORDER).toEqual(["positive", "negative", "null", "mixed", "unclear"]);
    expect(isPooledDesign("sr_ma_rct")).toBe(true);
    expect(isPooledDesign("sr_ma_observational")).toBe(true);
    expect(isPooledDesign("rct")).toBe(false);
    expect(isPooledDesign(null)).toBe(false);
  });
});

describe("liveTally", () => {
  const base = [ev(1, "screened", { kept: 6, total: 12 }),
    ...["P1", "P2", "P3", "P4", "P5", "P6"].map((r, i) => ev(2 + i, "reading", { ref: r, title: `T${r}` }))];

  it("groups finished reads by direction in doneKey order", () => {
    const s = run([...base,
      ev(20, "extracted", { ref: "P3", ok: true, direction: "positive", design: "rct" }),
      ev(21, "extracted", { ref: "P1", ok: true, direction: "positive", design: "sr_ma_rct" }),
      ev(22, "extracted", { ref: "P2", ok: true, uncertain: true, direction: "null", design: "cohort" }),
      ev(23, "extracted", { ref: "P4", ok: false, direction: "negative" }),
      ev(24, "extracted", { ref: "P5", ok: true }), // old event: no direction
    ]);
    const t = liveTally(s);
    expect(t.groups.positive.map((i) => i.ref)).toEqual(["P3", "P1"]);
    expect(t.groups.positive[0]).toEqual({ ref: "P3", direction: "positive", design: "rct", uncertain: false, key: 20, title: "TP3" });
    expect(t.groups.null).toMatchObject([{ ref: "P2", uncertain: true }]);
    expect(t.groups.negative).toEqual([]);
    expect(t.groups.unclear).toEqual([]);
    expect(t).toMatchObject({ counted: 3, noDirection: 1, failed: 1, uncertain: 1, pooled: 1, total: 6 });
  });
  it("old events without direction count as noDirection, never unclear", () => {
    const s = run([...base, ev(20, "extracted", { ref: "P1", ok: true }), ev(21, "extracted", { ref: "P2", ok: true, direction: "harm" })]);
    const t = liveTally(s);
    expect(t.noDirection).toBe(2);
    expect(t.groups.unclear).toEqual([]);
    expect(t.counted).toBe(0);
  });
  it("failed reads appear only in failed", () => {
    const t = liveTally(run([...base, ev(20, "extracted", { ref: "P1", ok: false, direction: "positive", design: "sr_ma_rct" })]));
    expect(t.failed).toBe(1);
    expect(t.counted + t.noDirection + t.pooled).toBe(0);
    expect(Object.values(t.groups).flat()).toEqual([]);
  });
  it("pooled counts every sr_ma_* design on the board", () => {
    const t = liveTally(run([...base,
      ev(20, "extracted", { ref: "P1", ok: true, direction: "positive", design: "sr_ma_rct" }),
      ev(21, "extracted", { ref: "P2", ok: true, direction: "mixed", design: "sr_ma_observational" }),
      ev(22, "extracted", { ref: "P3", ok: true, direction: "mixed", design: "sr_ma_mixed" }),
      ev(23, "extracted", { ref: "P4", ok: true, direction: "mixed", design: "narrative_review" })]));
    expect(t.pooled).toBe(3);
  });
  it("repeated extracted is idempotent", () => {
    const a = run([...base, ev(20, "extracted", { ref: "P1", ok: true, direction: "negative", design: "rct" })]);
    const b = run([ev(30, "extracted", { ref: "P1", ok: true, direction: "negative", design: "rct" })], a);
    expect(liveTally(b)).toEqual(liveTally(a));
    expect(liveTally(b).groups.negative[0].key).toBe(20);
  });
  it("empty scene", () => {
    expect(liveTally(initialScene())).toMatchObject({ counted: 0, noDirection: 0, failed: 0, uncertain: 0, pooled: 0, total: 0 });
  });
});
