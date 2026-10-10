// Plan 20 Task 5: axes with nice ticks, the favours side, the diagnostic-accuracy family and the themes-review test.
import { describe, expect, it } from "vitest";
import { narrativeP20ReviewFixture, resultFixture } from "@/test/fixtures";
import {
  armLabels, axisFraction, dtaData, dtaMetric, dtaMetricOf, measureFamily, niceAxis, studyLabel, themesReview, tickText,
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
    // a 2-point inset on each side keeps a marker at 0% or 100% inside the frame
    expect(niceAxis([79, 87], "proportion")).toMatchObject({ min: -2, max: 102, ticks: [0, 25, 50, 75, 100], nullValue: null });
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

describe("armLabels (fix round 1: measure semantics only, never 'favours')", () => {
  it("ratios: < 1 lower and > 1 higher in the intervention group, with a space before a Latin name", () => {
    expect(armLabels("ratio", "metformin", "th")).toEqual(["< 1 · ต่ำกว่าในกลุ่ม metformin", "> 1 · สูงกว่าในกลุ่ม metformin"]);
    expect(armLabels("ratio", "เมตฟอร์มิน", "th")).toEqual(["< 1 · ต่ำกว่าในกลุ่มเมตฟอร์มิน", "> 1 · สูงกว่าในกลุ่มเมตฟอร์มิน"]);
    expect(armLabels("ratio", "metformin", "en")).toEqual(["< 1 · lower with metformin", "> 1 · higher with metformin"]);
  });

  it("differences use 0; without an intervention name the treated/exposed group; correlations get none", () => {
    expect(armLabels("difference", null, "th")).toEqual(["< 0 · ต่ำกว่าในกลุ่มที่ได้รับการรักษา/สัมผัส", "> 0 · สูงกว่าในกลุ่มที่ได้รับการรักษา/สัมผัส"]);
    expect(armLabels("difference", "  ", "en")).toEqual(["< 0 · lower in the treated/exposed group", "> 0 · higher in the treated/exposed group"]);
    expect(armLabels("correlation", "x", "en")).toBeNull();
  });

  it("a harm/exposure question reads the same: the label never claims which side is better", () => {
    // "do PPIs increase fracture risk?": supporting studies have OR > 1; the axis still only says higher/lower with PPI
    const [left, right] = armLabels("ratio", "proton pump inhibitors", "en")!;
    expect(right).toBe("> 1 · higher with proton pump inhibitors");
    expect(`${left} ${right}`).not.toMatch(/favou?rs?|better|worse|benefit/i);
    expect(armLabels("ratio", "ยาลดกรด", "th")!.join(" ")).not.toMatch(/เอื้อต่อ|ดีกว่า|แย่กว่า/);
  });

  it("long names are cut on a word boundary", () => {
    const [left] = armLabels("ratio", "metformin extended release once daily with lifestyle advice", "en")!;
    expect(left.endsWith("…")).toBe(true);
    expect(left.length).toBeLessThan(50);
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
    // fix round 1: no bare "recall", no qualified sensitivity
    expect(dtaMetric("Symptom recall")).toBeNull();
    expect(dtaMetric("Recall bias")).toBeNull();
    expect(dtaMetric("Insulin sensitivity (HOMA)")).toBeNull();
    expect(dtaMetric("Contrast sensitivity")).toBeNull();
  });
});

describe("dtaMetricOf (fix round 1: the card's measure field and the paper's own label decide, not the name alone)", () => {
  it("a DTA value is stored with measure 'other' and labelled so in its quote, right before the number", () => {
    expect(dtaMetricOf(out({ outcome: "Sensitivity", effect_value: 97.4 }))).toBe("sens");
    expect(dtaMetricOf(out({ outcome: "Specificity", effect_value: 86.5 }))).toBe("spec");
    expect(dtaMetricOf(out({ outcome: "AUC", effect_value: 0.93 }))).toBe("auc");
  });

  it("an effect measure (MD, HR …) or 'none' is never a DTA value, whatever the name", () => {
    expect(dtaMetricOf(out({ outcome: "Insulin sensitivity", effect_measure: "MD", effect_value: 0.45,
      evidence_quote: "Insulin sensitivity improved (MD 0.45, 95% CI 0.2-0.7)." }))).toBeNull();
    expect(dtaMetricOf(out({ outcome: "Sensitivity", effect_measure: "MD", effect_value: 97.4 }))).toBeNull();
    expect(dtaMetricOf(out({ outcome: "Sensitivity", effect_measure: "none", effect_value: 97.4 }))).toBeNull();
    expect(dtaMetricOf(out({ outcome: "Sensitivity", effect_measure: null, effect_value: 97.4 }))).toBeNull();
  });

  it("'recall' and qualified sensitivities are not DTA even with measure 'other'", () => {
    expect(dtaMetricOf(out({ outcome: "Recall", effect_value: 62, evidence_quote: "Recall was 62% at one year." }))).toBeNull();
    expect(dtaMetricOf(out({ outcome: "Sensitivity", effect_value: 0.45,
      evidence_quote: "Insulin sensitivity rose to 0.45 after training." }))).toBeNull();
  });

  it("the quote's label must agree with the name (a 'sensitivity' whose number the paper calls specificity is not trusted)", () => {
    expect(dtaMetricOf(out({ outcome: "Sensitivity", effect_value: 86.5 }))).toBeNull();
    expect(dtaMetricOf(out({ outcome: "Sensitivity", effect_value: 97.4, evidence_quote: "The test was positive in 97.4% of cases." }))).toBeNull();
  });

  it("dtaData leaves a non-DTA 'insulin sensitivity' MD out entirely", () => {
    const p = dtaPaper("P9", [out({ outcome: "Insulin sensitivity", effect_measure: "MD", effect_value: 0.45, ci_lower: 0.2, ci_upper: 0.7,
      evidence_quote: "Insulin sensitivity improved (MD 0.45, 95% CI 0.2-0.7)." })]);
    expect(dtaData([p], "en")).toBeNull();
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
