import { describe, expect, it } from "vitest";
import { isGraded, REVIEW_TYPE_LABEL, REVIEW_TYPES, reviewTypeOf, SECTIONS_BY_TYPE } from "./review-type";

describe("review-type", () => {
  it("lists the types with SLR as the default label", () => {
    expect(REVIEW_TYPES.slice(0, 3)).toEqual(["narrative", "slr", "scoping"]);
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
    expect(SECTIONS_BY_TYPE.scoping).toEqual(["summary", "evidence_map", "lit_matrix", "concept_map", "citations", "prisma"]);
    expect(SECTIONS_BY_TYPE.scoping).not.toContain("claims");
    expect(SECTIONS_BY_TYPE.scoping).not.toContain("forest");
    expect(SECTIONS_BY_TYPE.narrative).not.toContain("prisma");
    expect(SECTIONS_BY_TYPE.narrative).toContain("claims");
    expect(SECTIONS_BY_TYPE.slr).toEqual(["summary", "claims", "findings", "forest", "prisma", "lit_matrix", "concept_map", "citations"]);
    expect(SECTIONS_BY_TYPE.legacy).toEqual(["summary", "claims", "findings", "forest", "prisma"]);
  });
  it("shows the citation network after the concept map for every type except legacy", () => {
    for (const t of ["narrative", "slr", "scoping", "meta_analysis"] as const) {
      const s = SECTIONS_BY_TYPE[t];
      expect(s.indexOf("citations"), t).toBe(s.indexOf("concept_map") + 1);
    }
    expect(SECTIONS_BY_TYPE.legacy).not.toContain("citations");
  });
  it("adds the meta-analysis: SLR sections plus the pooled section right after the forest plot, graded", () => {
    expect(REVIEW_TYPES).toEqual(["narrative", "slr", "scoping", "meta_analysis"]);
    expect(REVIEW_TYPE_LABEL.meta_analysis).toEqual({
      th: "การวิเคราะห์อภิมาน", en: "Meta-analysis",
      description: "รวมผลเชิงตัวเลขจากงานวิจัยหลักที่วัดผลแบบเดียวกัน (ตั้งแต่ 3 ฉบับ) ด้วยวิธี random effects ตัวเลขรวมคำนวณโดยระบบ ไม่ใช่ผลจากงานใดงานหนึ่ง",
    });
    expect(reviewTypeOf({ review_type: "meta_analysis" })).toBe("meta_analysis");
    expect(isGraded("meta_analysis")).toBe(true);
    const meta = SECTIONS_BY_TYPE.meta_analysis;
    for (const id of SECTIONS_BY_TYPE.slr) expect(meta).toContain(id);
    expect(meta.indexOf("meta")).toBe(meta.indexOf("forest") + 1);
    expect(meta).toContain("citations");
    for (const t of ["narrative", "slr", "scoping", "legacy"] as const) expect(SECTIONS_BY_TYPE[t]).not.toContain("meta");
  });
});
