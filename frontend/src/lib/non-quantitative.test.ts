import { describe, expect, it } from "vitest";
import { directionTally, forestData, isNonQuantitative, studyPoints } from "./charts-data";
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
  it("never get a forest row or a study-map point, even with a verified OR (defensive: the backend strips them)", () => {
    const withOr = (ref: string, design: string): Paper => {
      const p = paper(ref, design);
      return {
        ...p,
        card: {
          ...p.card!, sample_size: 120, sample_size_quote: "120 adults",
          outcomes: [{ outcome: "uptake", result: "higher", evidence_quote: "OR 1.8 (95% CI 1.2-2.7)", effect_size: "OR 1.8",
            effect_measure: "OR", effect_value: 1.8, ci_lower: 1.2, ci_upper: 2.7, p_value: null, direction: "positive" }],
        },
      } as Paper;
    };
    const papers = [withOr("P1", "rct"), withOr("P2", "mixed_methods"), withOr("P3", "qualitative")];
    const rows = forestData(papers, "en").groups.flatMap((g) => g.rows.map((r) => r.ref));
    expect(rows).toEqual(["P1"]);
    const map = studyPoints(papers);
    expect(map.points.map((pt) => pt.ref)).toEqual(["P1"]);
    expect(map.missing).toBe(0); // left out by design, not counted as missing a year or sample size
  });
});
