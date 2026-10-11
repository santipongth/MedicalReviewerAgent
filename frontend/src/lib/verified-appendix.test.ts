import { describe, expect, it } from "vitest";
import { metaReviewFixture, qualitativeReviewFixture, resultFixture } from "@/test/fixtures";
import type { Paper } from "./types";
import { appendixEntries, computedEntries, verifiedEntries } from "./verified-appendix";

const papers = resultFixture.papers!;

describe("verifiedEntries (Plan 20 Task 8 appendix)", () => {
  it("lists every verified number of every card, per paper in report order, with the sentence it was checked against", () => {
    const rows = verifiedEntries(papers, "th");
    expect(rows.map((r) => [r.ref, r.kind, r.outcome, r.value, r.ci])).toEqual([
      ["P1", "sample_size", null, "48,210", null],
      ["P1", "effect", "CRC incidence", "HR 0.86", "0.77–0.96"],
      ["P3", "sample_size", null, "1,234", null],
      ["P3", "effect", "CRC incidence", "HR 0.80", "0.71–0.90"],
      ["P4", "sample_size", null, "6,331", null],
      ["P4", "effect", "CRC incidence", "HR 1.28", "1.05–1.56"],
    ]);
    const p3 = rows.find((r) => r.ref === "P3" && r.kind === "effect")!;
    expect(p3.quote).toContain("HR 0.80, 95% CI 0.71–0.90");
    // the number is found in its quote at the place the verifier matched (for the highlight)
    expect(p3.mark).toEqual({ text: "0.80", index: p3.quote!.indexOf("0.80") });
    expect(rows.find((r) => r.ref === "P1" && r.kind === "sample_size")!.quote).toBe("The cohort included 48,210 adults with type 2 diabetes.");
  });

  it("never lists a blanked value, an outcome with no number, or an unread paper", () => {
    const rows = verifiedEntries(papers, "th");
    expect(rows.some((r) => r.ref === "P2")).toBe(false); // blanked by the verifier
    expect(rows.some((r) => r.outcome === "CRC mortality")).toBe(false); // no number
    expect(rows.some((r) => r.ref === "P5")).toBe(false); // no card
    const blankedN: Paper = { ...papers[0], verification: { ...papers[0].verification!, unverified: [{ field: "sample_size", outcome: null }] },
      card: { ...papers[0].card!, sample_size: null }, card_en: { ...papers[0].card_en!, sample_size: null } };
    expect(verifiedEntries([blankedN], "th").map((r) => r.kind)).toEqual(["effect"]);
  });

  it("a number with no stored verification quote is never listed as verified; it is counted as left out (fix round 1)", () => {
    const noQuote: Paper = { ...papers[2],
      card: { ...papers[2].card!, sample_size_quote: null, outcomes: papers[2].card!.outcomes.map((o) => ({ ...o, evidence_quote: null })) },
      card_en: { ...papers[2].card_en!, sample_size_quote: null, outcomes: papers[2].card_en!.outcomes.map((o) => ({ ...o, evidence_quote: null })) } };
    const { entries, omitted } = appendixEntries([noQuote, papers[0]], "th");
    expect(entries.map((e) => e.ref)).toEqual(["P1", "P1"]);
    expect(entries.every((e) => !!e.quote)).toBe(true);
    expect(omitted).toBe(2); // P3's sample size and its HR
  });

  it("a sample size the verifier blanked is never listed, even when a value is still on the card", () => {
    const blanked: Paper = { ...papers[0], verification: { ...papers[0].verification!, unverified: [{ field: "sample_size", outcome: null }] } };
    const { entries, omitted } = appendixEntries([blanked], "th");
    expect(entries.map((e) => e.kind)).toEqual(["effect"]);
    expect(omitted).toBe(0); // blanked is not "left out": it is not a verified number at all
  });

  it("themes (qualitative and mixed-methods cards) carry no numbers", () => {
    const qual = qualitativeReviewFixture.result!.papers!.filter((p) => ["qualitative", "mixed_methods"].includes((p.card_en ?? p.card)?.design_category ?? ""));
    expect(qual.length).toBeGreaterThan(0);
    // even a stray number on a theme never becomes an appendix row (reading.py strips them; the UI never shows one)
    const stray = qual.map((p) => {
      const c = { ...p.card_en!, outcomes: p.card_en!.outcomes.map((o) => ({ ...o, effect_value: 0.5, effect_measure: "OR" })) };
      return { ...p, card: c, card_en: c };
    });
    expect(verifiedEntries(stray, "th").filter((r) => r.kind === "effect")).toEqual([]);
  });

  it("an English view names outcomes from the English card; other comparisons are marked", () => {
    const other: Paper = { ...papers[2], card_en: { ...papers[2].card_en!, outcomes: [
      { ...papers[2].card_en!.outcomes[0], outcome: "CRC incidence vs insulin", matches_question: false, comparison: "metformin vs insulin" },
    ] }, card: { ...papers[2].card!, outcomes: [{ ...papers[2].card!.outcomes[0], outcome: "อุบัติการณ์ เทียบอินซูลิน", matches_question: false }] } };
    const th = verifiedEntries([other], "th").find((r) => r.kind === "effect")!;
    expect(th.outcome).toBe("อุบัติการณ์ เทียบอินซูลิน");
    expect(th.otherComparison).toBe(true);
    expect(verifiedEntries([other], "en").find((r) => r.kind === "effect")!.outcome).toBe("CRC incidence vs insulin");
  });
});

describe("computedEntries", () => {
  it("lists each pooled estimate with its inputs: k, the studies, and the heterogeneity it was computed with", () => {
    const r = metaReviewFixture.result!;
    const rows = computedEntries(r.meta_analysis, r.papers!, r.synthesis_en!.comparison!, "th");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: "ผลลัพธ์หลัก", measure: "HR", k: 3, est: "0.96", ci: "0.78–1.17", i2: "81%", refs: ["P3", "P4", "P7"] });
    expect(computedEntries(null, [], [], "th")).toEqual([]);
    expect(computedEntries(undefined, [], [], "en")).toEqual([]);
    expect(computedEntries(r.meta_analysis, r.papers!, r.synthesis_en!.comparison!, "en")[0].outcome).toBe("Primary outcome");
  });
});
