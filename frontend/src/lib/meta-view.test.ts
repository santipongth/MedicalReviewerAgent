import { describe, expect, it } from "vitest";
import { metaAnalysisFixture, metaReviewFixture } from "@/test/fixtures";
import {
  excludedGroups, fixed, GENERAL_WARNINGS, gradeReasonText, META_CODE_LABEL, metaAxis, metaCodeLabel, metaView, pText,
} from "./meta-view";
import type { MetaAnalysis, Pool } from "./types";

const result = metaReviewFixture.result!;
const rowsEn = result.synthesis_en!.comparison!;

const WARNINGS = ["abstract_only", "ci_assumed_95", "adjustment_unknown", "small_k", "high_heterogeneity",
  "md_units_assumed_equal", "other_measures_not_pooled", "duplicate_cohort_skipped"];
const REASONS = ["design_not_poolable", "measure_not_poolable", "missing_numbers", "invalid_numbers", "non_positive_ratio",
  "invalid_ci", "effect_outside_ci", "duplicate_study", "duplicate_cohort", "too_few_studies"];

describe("meta-view", () => {
  it("labels every backend warning and reason code in Thai and English (one map)", () => {
    for (const code of [...WARNINGS, ...REASONS]) {
      expect(META_CODE_LABEL[code]?.th.trim(), code).toBeTruthy();
      expect(META_CODE_LABEL[code]?.en.trim(), code).toBeTruthy();
      expect(metaCodeLabel(code, "th")).not.toBe(code);
    }
    expect(metaCodeLabel("brand_new_code", "th")).toBe("brand_new_code");
  });

  it("formats the stub pool at the prompt's rounding without computing anything new", () => {
    const v = metaView(metaAnalysisFixture, result.papers!, rowsEn, "th");
    expect(v.pools).toHaveLength(1);
    const p = v.pools[0];
    expect(p).toMatchObject({
      outcome: "ผลลัพธ์หลัก", measure: "HR", ratio: true, groupLabel: "งานเชิงสังเกต", k: 3,
      estText: "0.96", ciText: "0.78–1.17", i2Text: "81%", tau2Text: "0.025", qText: "10.61", df: 2, pText: "0.005", nullValue: 1,
      method: "DerSimonian-Laird random effects", version: "meta-1",
    });
    expect(p.warnings.map((w) => w.code)).toEqual(["small_k", "high_heterogeneity"]);
    expect(v.general.map((w) => w.code)).toEqual([...GENERAL_WARNINGS]);
  });

  it("keeps each study's verified numbers as the paper wrote them and finds its outcome, direction and year", () => {
    const [p3, p4, p7] = metaView(metaAnalysisFixture, result.papers!, rowsEn, "th").pools[0].studies;
    expect(p3).toMatchObject({ ref: "P3", label: "P3 · 2020", outcomeKey: "Primary outcome", effectText: "0.84", ciText: "0.72–0.98",
      direction: "positive", seText: "0.079", weightText: "33.2%" });
    expect(p4.direction).toBe("negative");
    expect(p7.weightText).toBe("36.6%");
  });

  it("uses the English outcome names when the reader switched a Thai review to English", () => {
    const v = metaView(metaAnalysisFixture, result.papers!, rowsEn, "en", true);
    expect(v.pools[0].outcome).toBe("Primary outcome");
    expect(v.pools[0].groupLabel).toBe("observational studies");
    expect(v.reference[0].outcome).toBe("Safety outcome");
  });

  it("summarises exclusions by reason with counts and refs per outcome", () => {
    const groups = excludedGroups(metaAnalysisFixture.excluded, "th");
    expect(groups).toEqual([{
      reason: "too_few_studies", label: META_CODE_LABEL.too_few_studies.th, count: 4,
      items: [{ outcome: "ผลลัพธ์หลัก", refs: ["P1", "P2"] }, { outcome: "ผลด้านความปลอดภัย", refs: ["P1", "P3"] }],
    }]);
    const mixed = excludedGroups([
      { outcome: "A", ref: "P9", measure: null, design_category: "rct", reason: "too_few_studies" },
      { outcome: "A", ref: "P8", measure: "r", design_category: "rct", reason: "measure_not_poolable" },
      { outcome: "A", ref: "P7", measure: "HR", design_category: "rct", reason: "missing_numbers" },
      { outcome: "B", ref: "P7", measure: "HR", design_category: "rct", reason: "missing_numbers" },
    ], "en");
    expect(mixed.map((g) => [g.reason, g.count])).toEqual([["measure_not_poolable", 1], ["missing_numbers", 2], ["too_few_studies", 1]]);
    expect(mixed[1].items).toEqual([{ outcome: "A", refs: ["P7"] }, { outcome: "B", refs: ["P7"] }]);
  });

  it("shows SR/MA reference rows with the paper's verified spelling, or none when the review has no number", () => {
    const v = metaView(metaAnalysisFixture, result.papers!, rowsEn, "th");
    expect(v.reference).toEqual([{ ref: "P5", outcome: "ผลด้านความปลอดภัย", design: "SR/MA ของ RCT", measure: "HR",
      outcomeKey: "Safety outcome", effectText: "0.81", ciText: "0.70–0.94" }]);
    const bare: MetaAnalysis = { ...metaAnalysisFixture, reference: [{ ...metaAnalysisFixture.reference[0], effect: null, ci_lower: null, ci_upper: null, measure: null }] };
    expect(metaView(bare, result.papers!, rowsEn, "th").reference[0]).toMatchObject({ effectText: null, ciText: null });
  });

  it("translates the GRADE-lite reasons it knows, naming the shown outcome and design group", () => {
    const v = metaView(metaAnalysisFixture, result.papers!, rowsEn, "th");
    expect(v.grade).toEqual([
      "ความไม่สอดคล้อง: งานวิจัยในค่ารวมของผลลัพธ์หลัก (งานเชิงสังเกต) ให้ผลต่างกันมาก (I² ตั้งแต่ 50%)",
      "ความไม่แม่นยำ: ช่วงความเชื่อมั่น 95% ของค่ารวมของผลลัพธ์หลัก (งานเชิงสังเกต) ครอบคลุมค่าที่แปลว่าไม่มีผล",
    ]);
    expect(gradeReasonText("imprecision (pooled analysis, already downgraded): the pooled 95% CI for X includes no effect", "th", "X", "rct"))
      .toContain("(ลดระดับในด้านนี้ไปแล้ว จึงไม่ลดซ้ำ)");
    expect(gradeReasonText("something new", "th", "X", null)).toBe("something new");
    expect(gradeReasonText(metaAnalysisFixture.grade!.reasons[0], "en", "X", null)).toBe(metaAnalysisFixture.grade!.reasons[0]);
  });

  it("puts the null line at 0 for differences, on a linear axis that contains it", () => {
    const md: Pool = {
      ...metaAnalysisFixture.pools[0], measure: "MD", scale: "raw", design_group: "rct", warnings: ["abstract_only", "md_units_assumed_equal"],
      studies: [
        { ref: "P1", effect: 2, ci_lower: 1, ci_upper: 3, y: 2, se: 0.5, variance: 0.25, weight: 50 },
        { ref: "P2", effect: 3, ci_lower: 2, ci_upper: 4, y: 3, se: 0.5, variance: 0.25, weight: 50 },
      ],
      pooled: { est: 2.5, ci_lower: 1.8, ci_upper: 3.2, y: 2.5, y_ci_lower: 1.8, y_ci_upper: 3.2, se: 0.35 },
    };
    const v = metaView({ ...metaAnalysisFixture, pools: [md] }, result.papers!, rowsEn, "th").pools[0];
    expect(v).toMatchObject({ ratio: false, nullValue: 0, estText: "2.50", ciText: "1.80–3.20" });
    expect(v.warnings.map((w) => w.code)).toEqual(["md_units_assumed_equal"]);
    const [lo, hi] = metaAxis(md);
    expect(lo).toBeLessThan(0);
    expect(hi).toBeGreaterThan(4);
    const [rlo, rhi] = metaAxis(metaAnalysisFixture.pools[0]);
    expect(rlo).toBeLessThan(0.72);
    expect(rhi).toBeGreaterThan(1.47);
  });

  it("formats without a negative zero and with a floor for tiny p", () => {
    expect(fixed(-0.0001, 2)).toBe("0.00");
    expect(fixed(-0.25, 2)).toBe("-0.25");
    expect(pText(0.0004)).toBe("< 0.001");
    expect(pText(0.0496)).toBe("0.050");
  });
});
