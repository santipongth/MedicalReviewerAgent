import { describe, expect, it } from "vitest";
import { asReported, isVerifiedEffect, pickReceipt } from "./evidence";
import type { Paper, ReviewResult } from "./types";

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

  it("pickReceipt returns the first verified effect with its quote and skips blanked ones", () => {
    const result: ReviewResult = {
      papers: [
        paper("P1", null, { numbers_verified: 0, numbers_total: 1, agreement: null, escalated: false, repaired: false,
          uncertain: false, unverified: [{ field: "effect", outcome: "CRC incidence" }] }),
        paper("P2", 0.8),
      ],
    };
    const r = pickReceipt(result);
    expect(r?.ref).toBe("P2");
    expect(r?.display).toBe("HR 0.80");
    expect(r?.quote).toBe(quote);
    expect(pickReceipt({ papers: [paper("P1", null)] })).toBeNull();
    expect(pickReceipt({})).toBeNull();
  });
});
