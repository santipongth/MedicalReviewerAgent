import { describe, expect, it } from "vitest";
import { isGraded, REVIEW_TYPE_LABEL, REVIEW_TYPES, reviewTypeOf, SECTIONS_BY_TYPE } from "./review-type";

describe("review-type", () => {
  it("lists the three types with SLR as the default label", () => {
    expect(REVIEW_TYPES).toEqual(["narrative", "slr", "scoping"]);
    expect(REVIEW_TYPE_LABEL.slr.th).toBe("การทบทวนวรรณกรรมอย่างเป็นระบบ");
    expect(REVIEW_TYPE_LABEL.scoping.en).toBe("Scoping review");
    expect(REVIEW_TYPE_LABEL.narrative.description).toContain("ไม่ประเมินความแข็งแรงของหลักฐาน");
  });
  it("reads the type from a result and treats a missing one as legacy", () => {
    expect(reviewTypeOf({ review_type: "scoping" })).toBe("scoping");
    expect(reviewTypeOf({})).toBe("legacy");
    expect(reviewTypeOf(null)).toBe("legacy");
    expect(reviewTypeOf({ review_type: "bogus" as never })).toBe("legacy");
  });
  it("grades only SLR and legacy results", () => {
    expect(isGraded("slr")).toBe(true);
    expect(isGraded("legacy")).toBe(true);
    expect(isGraded("narrative")).toBe(false);
    expect(isGraded("scoping")).toBe(false);
  });
  it("encodes the report sections per type", () => {
    expect(SECTIONS_BY_TYPE.scoping).toEqual(["summary", "evidence_map", "lit_matrix", "concept_map", "prisma"]);
    expect(SECTIONS_BY_TYPE.scoping).not.toContain("claims");
    expect(SECTIONS_BY_TYPE.scoping).not.toContain("forest");
    expect(SECTIONS_BY_TYPE.narrative).not.toContain("prisma");
    expect(SECTIONS_BY_TYPE.narrative).toContain("claims");
    expect(SECTIONS_BY_TYPE.slr).toEqual(["summary", "claims", "findings", "forest", "lit_matrix", "concept_map", "prisma"]);
    expect(SECTIONS_BY_TYPE.legacy).toEqual(["summary", "claims", "findings", "forest"]);
  });
});
