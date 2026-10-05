import { describe, expect, it } from "vitest";
import { asReported, findReported, isVerifiedEffect } from "./evidence";
import type { Paper } from "./types";

const quote = "Metformin use was associated with a lower risk of colorectal cancer (HR 0.80, 95% CI 0.71–0.90).";

function paper(ref: string, effect: number | null, unverified: Paper["verification"] = null): Paper {
  return {
    ref, title: `Paper ${ref}`, year: 2021,
    card: {
      study_design: "cohort", population: "adults", intervention_or_exposure: "metformin", key_findings: [],
      limitations: [], risk_of_bias: "low", overall_direction: "positive",
      outcomes: [{ outcome: "CRC incidence", result: "lower", evidence_quote: quote, effect_measure: "HR",
        effect_value: effect, ci_lower: effect ? 0.71 : null, ci_upper: effect ? 0.9 : null, direction: "positive" }],
    },
    verification: unverified,
  };
}

describe("evidence helpers", () => {
  it("shows a number exactly as the paper wrote it", () => {
    expect(asReported(0.8, quote)).toBe("0.80");
    expect(asReported(0.71, quote)).toBe("0.71");
    expect(asReported(1234, "We enrolled 1,234 adults")).toBe("1,234");
    expect(asReported(0.5, "no such number")).toBe("0.5");
  });

  it("an effect counts as verified only when present and not blanked", () => {
    const p = paper("P1", 0.8, { numbers_verified: 1, numbers_total: 1, agreement: 1, escalated: false,
      repaired: false, uncertain: false, unverified: [] });
    expect(isVerifiedEffect(p, p.card!.outcomes[0])).toBe(true);
    expect(isVerifiedEffect(paper("P2", null), paper("P2", null).card!.outcomes[0])).toBe(false);
  });

  it("marks the occurrence followed by its own confidence interval when a value appears twice", () => {
    const q = "reduced ischaemic stroke (RR 0.73 [95% CI 0.58-0.90]) and MACE by 27% (with RR 0.73 [0.65-0.81]).";
    const second = q.lastIndexOf("0.73");
    expect(findReported(0.73, q)?.index).toBe(q.indexOf("0.73")); // without bounds: the first, as before
    expect(findReported(0.73, q, { lo: 0.65, hi: 0.81 })?.index).toBe(second);
    expect(findReported(0.73, q, { lo: 0.58, hi: 0.9 })?.index).toBe(q.indexOf("0.73"));
    expect(findReported(0.73, q, { lo: 0.1, hi: 0.2 })?.index).toBe(q.indexOf("0.73")); // no match: first occurrence
  });
});
