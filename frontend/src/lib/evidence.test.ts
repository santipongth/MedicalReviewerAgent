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

  // Plan 19 final review finding 5: the same formats the backend verifier accepts
  it("finds a leading-dot p-value", () => {
    const q = "lower risk (HR 0.80, 95% CI 0.71-0.90; P = .003)";
    expect(findReported(0.003, q)).toEqual({ text: ".003", index: q.indexOf(".003") });
    expect(asReported(0.003, q)).toBe(".003");
  });

  it("finds space and thin-space thousands", () => {
    expect(asReported(111725, "A total of 111 725 adults were followed")).toBe("111 725");
    expect(asReported(111725, "A total of 111 725 adults")).toBe("111 725");
    expect(asReported(111725, "A total of 111 725 adults")).toBe("111 725");
    expect(asReported(1234, "n = 1 234")).toBe("1 234");
  });

  it("reads decimal commas only in a quote without a decimal point", () => {
    expect(asReported(0.85, "HR 0,85 (IC 95 % 0,72-0,99)")).toBe("0,85");
    expect(asReported(0.99, "HR 0,85 (IC 95 % 0,72-0,99)")).toBe("0,99");
    // a decimal-point quote: "0,85" is unreadable, never 0 and 85 nor 0.85
    expect(findReported(0.85, "HR 0,85 and OR 1.20")).toBeNull();
    expect(findReported(85, "HR 0,85 and OR 1.20")).toBeNull();
    expect(asReported(1234, "We enrolled 1,234 adults")).toBe("1,234"); // thousands, not 1.234
  });

  it("keeps a spaced unicode minus negative", () => {
    const q = "MD − 0.5 (95% CI −0.9 to −0.1)";
    expect(findReported(-0.5, q)).toEqual({ text: "− 0.5", index: q.indexOf("− 0.5") });
    expect(findReported(0.5, q)).toBeNull();
    expect(asReported(-0.9, q)).toBe("−0.9");
    expect(findReported(-0.9, "CI 0.71-0.90")).toBeNull(); // a range dash is not a minus
    expect(asReported(-0.3, "MD -0.3 (-0.5 to -0.1)")).toBe("-0.3");
  });

  it("finds the Lancet middle dot as written", () => {
    expect(asReported(0.85, "HR 0·85 (0·72–0·99)")).toBe("0·85");
    expect(asReported(0.99, "HR 0·85 (0·72–0·99)")).toBe("0·99");
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
