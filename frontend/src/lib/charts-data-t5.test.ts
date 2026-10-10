// Plan 20 Task 5: axes with nice ticks, the favours side, the diagnostic-accuracy family and the themes-review test.
import { describe, expect, it } from "vitest";
import { narrativeP20ReviewFixture, resultFixture } from "@/test/fixtures";
import {
  axisFraction, dtaData, dtaMetric, favoursSide, measureFamily, niceAxis, studyLabel, themesReview, tickText,
} from "./charts-data";
import type { OutcomeResult, Paper } from "./types";

describe("measureFamily", () => {
  it("ratio, difference and correlation measures; anything else has no family", () => {
    expect(["HR", "or", " RR "].map(measureFamily)).toEqual(["ratio", "ratio", "ratio"]);
    expect(["MD", "SMD", "RD"].map(measureFamily)).toEqual(["difference", "difference", "difference"]);
    expect(measureFamily("r")).toBe("correlation");
    expect([null, "", "none", "other", "sensitivity"].map(measureFamily)).toEqual([null, null, null, null, null]);
  });
});

describe("niceAxis", () => {
  it("ratio: log ticks from 0.25 · 0.5 · 1 · 2 · 4, the domain ends on a tick, 1 is never at an edge", () => {
    const a = niceAxis([0.71, 0.9, 0.77, 0.96], "ratio");
    expect(a).toMatchObject({ kind: "ratio", min: 0.5, max: 2, ticks: [0.5, 1, 2], nullValue: 1 });
    expect(niceAxis([0.3, 3.2], "ratio").ticks).toEqual([0.25, 0.5, 1, 2, 4]);
  });

  it("ratio: a wide range is thinned outward from 1 so the labels never collide (at most 7)", () => {
    const a = niceAxis([0.05, 20], "ratio");
    expect(a.min).toBe(0.05);
    expect(a.max).toBe(20);
    expect(a.ticks).toContain(1);
    expect(a.ticks.length).toBeLessThanOrEqual(7);
    for (let i = 1; i < a.ticks.length; i++) expect(a.ticks[i]).toBeGreaterThan(a.ticks[i - 1]);
  });

  it("difference: 1-2-5 steps, null 0 inside the domain", () => {
    const a = niceAxis([-2.4, -0.5, 0.3], "difference");
    expect(a).toMatchObject({ kind: "difference", min: -3, max: 1, ticks: [-3, -2, -1, 0, 1], nullValue: 0 });
    const pos = niceAxis([0.12, 0.31], "difference");
    expect(pos.ticks[0]).toBeLessThan(0); // all positive: one step below 0 so the null line is not the frame
    expect(pos.ticks).toContain(0);
    for (const t of pos.ticks) expect(Number.isInteger(Math.round(t * 1e9))).toBe(true);
    expect(pos.ticks.map(tickText)).toEqual(pos.ticks.map((t) => tickText(t))); // stable labels, no float noise
    expect(pos.ticks.map(tickText).every((s) => !/0000/.test(s))).toBe(true);
  });

  it("proportion: a fixed 0–100% axis without a null line", () => {
    expect(niceAxis([79, 87], "proportion")).toMatchObject({ min: 0, max: 100, ticks: [0, 25, 50, 75, 100], nullValue: null });
  });
});

describe("axisFraction and tickText", () => {
  it("log positions for ratios, linear otherwise, clamped to the frame", () => {
    const r = niceAxis([0.71, 0.96], "ratio");
    expect(axisFraction(1, r)).toBeCloseTo(0.5);
    expect(axisFraction(0.5, r)).toBe(0);
    expect(axisFraction(99, r)).toBe(1);
    const d = niceAxis([-2.4, 0.3], "difference");
    expect(axisFraction(0, d)).toBeCloseTo(0.75);
  });

  it("tick labels drop trailing zeros and use a true minus", () => {
    expect([0.25, 0.5, 1, 2, -3, 100].map(tickText)).toEqual(["0.25", "0.5", "1", "2", "−3", "100"]);
  });
});

describe("favoursSide", () => {
  it("left favours the intervention when supporting results sit left of the null and harms right", () => {
    expect(favoursSide([{ value: 0.8, direction: "positive" }, { value: 1.3, direction: "negative" }, { value: 1, direction: "positive" }], 1)).toBe("left");
    expect(favoursSide([{ value: 1.4, direction: "positive" }, { value: 0.7, direction: "negative" }], 1)).toBe("right");
  });

  it("unknown when the results disagree or none has a direction", () => {
    expect(favoursSide([{ value: 0.8, direction: "positive" }, { value: 1.2, direction: "positive" }], 1)).toBeNull();
    expect(favoursSide([{ value: 0.8, direction: "null" }, { value: 1.2, direction: "unclear" }], 1)).toBeNull();
    expect(favoursSide([], 0)).toBeNull();
  });
});

// --- Diagnostic accuracy ------------------------------------------------------------------------------------------------

const q = "Sensitivity was 97.4% (95% CI 94.0-98.9) and specificity 86.5% (95% CI 82.1-90.1); AUC 0.93 (95% CI 0.90-0.96).";
const out = (o: Partial<OutcomeResult>): OutcomeResult => ({ outcome: "x", result: "r", direction: "positive", evidence_quote: q, effect_measure: "other", ...o });
function dtaPaper(ref: string, outcomes: OutcomeResult[], extra: Partial<Paper> = {}): Paper {
  const card = {
    study_design: "diagnostic accuracy study", design_category: "cross_sectional" as const, population: "adults", sample_size: 512,
    sample_size_quote: "We included 512 patients.", intervention_or_exposure: "AI", outcomes, key_findings: [], limitations: [],
    risk_of_bias: "low" as const, overall_direction: "positive" as const,
  };
  return { ref, title: `Study ${ref}`, year: 2024, authors: ["Chen L"], card, card_en: card,
    verification: { numbers_verified: 3, numbers_total: 3, agreement: 1, escalated: false, repaired: false, uncertain: false, unverified: [] }, ...extra };
}

describe("dtaMetric", () => {
  it("names sensitivity, specificity and AUC; a combined or unrelated outcome is none", () => {
    expect(dtaMetric("Diagnostic accuracy - Sensitivity")).toBe("sens");
    expect(dtaMetric("Diagnostic accuracy (specificity)")).toBe("spec");
    expect(dtaMetric("Area under the ROC curve")).toBe("auc");
    expect(dtaMetric("AUROC")).toBe("auc");
    expect(dtaMetric("Sensitivity and specificity")).toBeNull();
    expect(dtaMetric("Sensitivity analysis of mortality")).toBeNull();
    expect(dtaMetric("Positive predictive value (PPV)")).toBeNull();
  });
});

describe("dtaData", () => {
  const p1 = dtaPaper("P1", [
    out({ outcome: "Sensitivity", effect_value: 97.4, ci_lower: 94, ci_upper: 98.9 }),
    out({ outcome: "Specificity", effect_value: 86.5, ci_lower: 82.1, ci_upper: 90.1 }),
    out({ outcome: "AUC", effect_value: 0.93, ci_lower: 0.9, ci_upper: 0.96 }),
    out({ outcome: "PPV", effect_value: 82.3 }),
  ]);
  const p2 = dtaPaper("P2", [out({ outcome: "Sensitivity", effect_value: 0.79, ci_lower: 0.71, ci_upper: 0.88,
    evidence_quote: "sensitivity 0.79 (95%CI 0.71-0.88)" }), out({ outcome: "Specificity", effect_value: 0.87 })],
  { verification: { numbers_verified: 1, numbers_total: 2, agreement: 1, escalated: false, repaired: false, uncertain: false,
    unverified: [{ field: "effect", outcome: "Specificity" }] } });

  it("one row per study with its verified values as written; percentages and proportions share a 0–100 position", () => {
    const d = dtaData([p1, p2], "en")!;
    expect(d.has).toEqual({ sens: true, spec: true, auc: true });
    const [r1, r2] = d.studies;
    expect(r1.label).toBe("P1 · Chen 2024");
    expect(r1.sens).toEqual([expect.objectContaining({ kind: "verified", text: "97.4", percent: true, ci: "94.0–98.9", pos: 97.4, lo: 94, hi: 98.9 })]);
    expect(r1.auc[0]).toMatchObject({ kind: "verified", text: "0.93", percent: false, pos: 93 });
    expect(r1.n).toEqual({ kind: "value", text: "512" });
    expect(r2.sens[0]).toMatchObject({ kind: "verified", text: "0.79", pos: 79, lo: 71, hi: 88 });
    // a value the verifier blanked is a gap, never a number; nothing derived (no PPV column, no pooled value)
    expect(r2.spec).toEqual([{ kind: "blanked", outcomeKey: "Specificity", outcome: "Specificity" }]);
    expect(Object.keys(r1)).not.toContain("ppv");
  });

  it("null when no study reports a diagnostic-accuracy value; themes and other comparisons never count", () => {
    expect(dtaData(resultFixture.papers!, "en")).toBeNull();
    const other = dtaPaper("P3", [out({ outcome: "Sensitivity", effect_value: 90, matches_question: false })]);
    expect(dtaData([other], "en")).toBeNull();
    const qual = dtaPaper("P4", [out({ outcome: "Sensitivity", effect_value: 90 })]);
    qual.card = qual.card_en = { ...qual.card!, design_category: "qualitative" };
    expect(dtaData([qual], "en")).toBeNull();
  });
});

describe("studyLabel and themesReview", () => {
  it("labels a study by ref, first author's surname and year", () => {
    expect(studyLabel(resultFixture.papers![2])).toBe("P3 · Lindqvist 2021");
    expect(studyLabel(resultFixture.papers![0])).toBe("P1 · 2019");
  });

  it("a themes review: qualitative or mixed-methods studies are at least half of the read papers", () => {
    expect(themesReview(narrativeP20ReviewFixture.result!.papers!)).toBe(true);
    expect(themesReview(resultFixture.papers!)).toBe(false);
  });
});
