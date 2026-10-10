import { describe, expect, it } from "vitest";
import { directionTally, isNonQuantitative } from "./charts-data";
import { litRows } from "./lit-matrix";
import type { Paper } from "./types";

function paper(ref: string, design: string, direction = "positive"): Paper {
  return {
    ref, title: `Paper ${ref}`, year: 2020,
    card: {
      design_category: design, study_design: design, population: "adults", intervention_or_exposure: "x", comparator: "",
      outcomes: [], key_findings: ["theme"], limitations: [], overall_direction: direction, risk_of_bias: "moderate",
      sample_size: null, sample_size_quote: null,
    },
  } as unknown as Paper;
}

describe("qualitative and mixed-methods studies (Plan 17a)", () => {
  it("are recognised by design category", () => {
    expect(isNonQuantitative({ design_category: "qualitative" })).toBe(true);
    expect(isNonQuantitative({ design_category: "mixed_methods" })).toBe(true);
    expect(isNonQuantitative({ design_category: "rct" })).toBe(false);
    expect(isNonQuantitative(null)).toBe(false);
  });
  it("are never counted in the direction tally", () => {
    const tally = directionTally([paper("P1", "rct"), paper("P2", "qualitative"), paper("P3", "mixed_methods")]);
    expect(tally.positive).toBe(1);
  });
  it("show no direction in the literature matrix but keep their themes", () => {
    const [rct, qual] = litRows([paper("P1", "rct"), paper("P2", "qualitative", "unclear")], "th", null);
    expect(rct.direction).toBe("positive");
    expect(qual.direction).toBeNull();
    expect(qual.findings).toContain("theme");
  });
});
