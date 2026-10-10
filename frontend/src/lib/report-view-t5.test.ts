// Plan 20 Task 5: forest panels per outcome (the summary-of-findings grouping) and the findings-matrix default view.
import { describe, expect, it } from "vitest";
import { metaP20ReviewFixture, narrativeP20ReviewFixture, slrP20ReviewFixture } from "@/test/fixtures";
import { forestPanels, matrixView, type OutcomeContext } from "./report-view";
import type { ComparisonRow, OutcomeResult, Paper, Review } from "./types";

function ctxOf(review: Review, lang: "th" | "en" = "th"): OutcomeContext {
  const r = review.result!;
  return { rows: r.synthesis!.comparison ?? [], enRows: r.synthesis_en?.comparison ?? [], papers: r.papers ?? [], meta: r.meta_analysis, lang };
}

function paper(ref: string, o: Partial<OutcomeResult>): Paper {
  const outcome: OutcomeResult = { outcome: "Weight", result: `result ${ref}`, direction: "positive", evidence_quote: null, ...o };
  const card = {
    study_design: "cohort", design_category: "cohort" as const, population: "adults", sample_size: null, intervention_or_exposure: "x",
    outcomes: [outcome], key_findings: [], limitations: [], risk_of_bias: "low" as const, overall_direction: "positive" as const,
  };
  return { ref, title: ref, year: 2020, card, card_en: card, verification: { numbers_verified: 1, numbers_total: 1, agreement: 1, escalated: false,
    repaired: false, uncertain: false, unverified: [] } };
}
const rowOf = (outcome: string, refs: string[]): ComparisonRow => ({ outcome, cells: refs.map((ref) => ({ ref, finding: `result ${ref}`, direction: "positive" })) });
const ctxFor = (rows: ComparisonRow[], papers: Paper[]): OutcomeContext => ({ rows, enRows: [], papers, meta: null, lang: "en" });

describe("forestPanels", () => {
  it("SLR: one panel per outcome and measure; primary studies first, SR/MA apart, a blanked effect as a gap", () => {
    const { panels, unplaced } = forestPanels(ctxOf(slrP20ReviewFixture));
    expect(panels).toHaveLength(1);
    const [p] = panels;
    expect(p).toMatchObject({ outcome: "อุบัติการณ์มะเร็งลำไส้ใหญ่", outcomeKey: "CRC incidence", measure: "HR", family: "ratio" });
    expect(p.primary.map((r) => [r.ref, r.num, r.ci, r.value, r.lo, r.hi, r.direction])).toEqual([
      ["P1", "0.86", "0.77–0.96", 0.86, 0.77, 0.96, "positive"],
      ["P3", "0.80", "0.71–0.90", 0.8, 0.71, 0.9, "positive"],
    ]);
    expect(p.primary[1]).toMatchObject({ label: "P3 · Lindqvist 2021", outcomeKey: "CRC incidence" });
    expect(p.reviews.map((r) => r.ref)).toEqual(["P4"]);
    expect(p.blanked).toEqual([expect.objectContaining({ ref: "P2", outcomeKey: "CRC incidence", review: false })]);
    expect(p.pools).toEqual([]);
    expect(unplaced).toEqual([]);
  });

  it("never mixes measures (or scales) on one axis", () => {
    const papers = [
      paper("P1", { effect_measure: "HR", effect_value: 0.8, ci_lower: 0.7, ci_upper: 0.9 }),
      paper("P2", { effect_measure: "OR", effect_value: 1.2, ci_lower: 1.0, ci_upper: 1.5 }),
      paper("P3", { effect_measure: "MD", effect_value: -2.1, ci_lower: -3, ci_upper: -1.2 }),
      paper("P4", { effect_measure: "other", effect_value: 12 }),
    ];
    const { panels } = forestPanels(ctxFor([rowOf("Weight", ["P1", "P2", "P3", "P4"])], papers));
    expect(panels.map((p) => [p.measure, p.family, p.primary.map((r) => r.ref)])).toEqual([
      ["HR", "ratio", ["P1"]], ["OR", "ratio", ["P2"]], ["MD", "difference", ["P3"]],
    ]);
  });

  it("meta-analysis: the outcome's pool joins its panel as computed text (k, I², τ², Q), the SR/MA-only outcome keeps its block", () => {
    const { panels } = forestPanels(ctxOf(metaP20ReviewFixture));
    const primary = panels.find((p) => p.outcomeKey === "Primary outcome")!;
    expect(primary.primary.map((r) => r.ref)).toEqual(["P1", "P2", "P3", "P4", "P7"]);
    expect(primary.pools).toEqual([expect.objectContaining({
      group: "งานเชิงสังเกต", k: 3, estText: "0.96", ciText: "0.78–1.17", i2Text: "81%", tau2Text: "0.025", qText: "10.61", df: 2, pText: "0.005",
    })]);
    expect(primary.pools[0].est).toBeCloseTo(0.9566, 3);
    const safety = panels.find((p) => p.outcomeKey === "Safety outcome")!;
    expect(safety.primary).toEqual([]);
    expect(safety.reviews.map((r) => r.ref)).toEqual(["P5"]);
  });

  it("narrative: an outcome needs at least 3 ratio or difference effects to get a panel", () => {
    expect(forestPanels(ctxOf(narrativeP20ReviewFixture, "en"), { minEffects: 3 }).panels).toEqual([]);
    const papers = ["P1", "P2", "P3"].map((r, i) => paper(r, { effect_measure: "HR", effect_value: 0.8 + i / 10, ci_lower: 0.6, ci_upper: 1.2 }));
    expect(forestPanels(ctxFor([rowOf("Weight", ["P1", "P2", "P3"])], papers), { minEffects: 3 }).panels).toHaveLength(1);
    expect(forestPanels(ctxFor([rowOf("Weight", ["P1", "P2"])], papers), { minEffects: 3 }).panels).toEqual([]);
  });

  it("qualitative studies, other comparisons and non-positive ratios never become rows", () => {
    const n = narrativeP20ReviewFixture.result!;
    const { panels } = forestPanels(ctxOf(narrativeP20ReviewFixture, "en"));
    expect(panels.flatMap((p) => [...p.primary, ...p.reviews].map((r) => r.ref))).toEqual(["P3"]);
    expect(n.papers!.filter((p) => p.ref === "P1" || p.ref === "P2").every((p) => p.card?.design_category !== "cohort")).toBe(true);
    const bad = [paper("P1", { effect_measure: "HR", effect_value: 0, ci_lower: 0, ci_upper: 1 }),
      paper("P2", { effect_measure: "HR", effect_value: 0.9, matches_question: false })];
    expect(forestPanels(ctxFor([rowOf("Weight", ["P1", "P2"])], bad)).panels).toEqual([]);
  });

  it("a blanked effect whose outcome has no panel is listed as left out", () => {
    const p = paper("P1", { effect_measure: "HR", effect_value: null });
    p.verification = { ...p.verification!, unverified: [{ field: "effect", outcome: "Weight" }] };
    expect(forestPanels(ctxFor([rowOf("Weight", ["P1"])], [p])).unplaced).toEqual([{ ref: "P1", outcome: "Weight" }]);
  });

  it("only the given (filtered) papers are drawn", () => {
    const c = ctxOf(slrP20ReviewFixture);
    const { panels } = forestPanels({ ...c, papers: c.papers.filter((p) => p.ref !== "P1") });
    expect(panels[0].primary.map((r) => r.ref)).toEqual(["P3"]);
  });
});

describe("matrixView", () => {
  const rows: ComparisonRow[] = [rowOf("A", ["P1"]), rowOf("B", ["P1", "P2"]), rowOf("C", ["P1", "P2", "P3"]), rowOf("D", ["P4"])];
  const refs = ["P1", "P2", "P3", "P4"];

  it("by default: outcomes two or more studies report, most studies first, and only their studies as columns", () => {
    const v = matrixView(rows, refs, false);
    expect(v.rows.map((r) => [r.row.outcome, r.k])).toEqual([["C", 3], ["B", 2]]);
    expect(v.refs).toEqual(["P1", "P2", "P3"]);
    expect(v).toMatchObject({ total: 4, hidden: 2 });
  });

  it("show all: every outcome, still by k", () => {
    const v = matrixView(rows, refs, true);
    expect(v.rows.map((r) => r.row.outcome)).toEqual(["C", "B", "A", "D"]);
    expect(v.refs).toEqual(refs);
    expect(v.hidden).toBe(0);
  });

  it("k counts only the visible (filtered) studies; when no outcome has two, everything shows", () => {
    const v = matrixView(rows, ["P1", "P4"], false);
    expect(v.rows.map((r) => [r.row.outcome, r.k])).toEqual([["A", 1], ["B", 1], ["C", 1], ["D", 1]]);
    expect(v.hidden).toBe(0);
  });
});
