import { describe, expect, it } from "vitest";
import { isNotEvidence, isRelatedReport } from "./trial-reports";

describe("isNotEvidence", () => {
  it("is true for a further report of a trial and for a paper read as a design outside the ticked study types", () => {
    expect(isNotEvidence({ related_to: "P1" })).toBe(true);
    expect(isNotEvidence({ design_excluded: true })).toBe(true);
    expect(isNotEvidence({ related_to: null, design_excluded: false })).toBe(false);
    expect(isNotEvidence({})).toBe(false);
    expect(isNotEvidence(null)).toBe(false);
    // a design-excluded paper is not a related report: the two notes stay apart
    expect(isRelatedReport({ related_to: null })).toBe(false);
  });
});
