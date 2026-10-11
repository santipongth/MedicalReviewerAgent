import { describe, expect, it } from "vitest";
import { isGraded, REVIEW_TYPE_LABEL, REVIEW_TYPES, reportLayout, reviewTypeOf, SECTION_ANCHOR, SECTION_BLOCKS, SECTIONS_BY_TYPE, type SectionId } from "./review-type";

describe("review-type", () => {
  it("lists the types with SLR as the default label", () => {
    expect(REVIEW_TYPES.slice(0, 3)).toEqual(["narrative", "slr", "scoping"]);
    expect(REVIEW_TYPE_LABEL.slr.th).toBe("การทบทวนวรรณกรรมอย่างเป็นระบบ");
    expect(REVIEW_TYPE_LABEL.scoping.en).toBe("Scoping review");
    // names only: the plain-language descriptions live in landing/type-description.tsx (Task 9 removed the unused copy)
    for (const t of REVIEW_TYPES) expect(Object.keys(REVIEW_TYPE_LABEL[t]).sort(), t).toEqual(["en", "th"]);
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
    expect(SECTIONS_BY_TYPE.scoping).not.toContain("claims");
    expect(SECTIONS_BY_TYPE.scoping).not.toContain("forest");
    expect(SECTIONS_BY_TYPE.scoping).not.toContain("sof");
    expect(SECTIONS_BY_TYPE.narrative).not.toContain("prisma");
    expect(SECTIONS_BY_TYPE.narrative).not.toContain("sof");
    expect(SECTIONS_BY_TYPE.narrative).toContain("claims");
    expect(SECTIONS_BY_TYPE.legacy).not.toContain("lit_matrix");
  });
  it("shows the risk-of-bias summary after the results for every type but scoping (Plan 20 Task 4)", () => {
    for (const t of ["narrative", "slr", "meta_analysis", "legacy"] as const) {
      const top = reportLayout(t).map((s) => s.id);
      expect(top.indexOf("rob"), t).toBe(top.indexOf("results") + 1);
    }
    expect(SECTIONS_BY_TYPE.scoping).not.toContain("rob");
  });
  it("puts every type in the answer-first order (Plan 20)", () => {
    const ORDER: SectionId[] = ["title", "bottom_line", "key_findings", "sof", "selection", "characteristics", "results", "rob",
      "consistency", "landscape", "limitations", "gaps", "discussion", "methods", "references", "downloads", "appendix"];
    for (const t of [...REVIEW_TYPES, "legacy"] as const) {
      const top = reportLayout(t).map((s) => s.id);
      expect(top, t).toEqual(ORDER.filter((id) => top.includes(id as never)));
      expect(top.slice(0, 2), t).toEqual(["title", "bottom_line"]);
      // Plan 20 Task 8: the verified-numbers appendix closes every report, after the downloads
      expect(top.slice(-2), t).toEqual(["downloads", "appendix"]);
    }
    expect(reportLayout("slr").map((s) => s.id)).toEqual(ORDER);
    expect(reportLayout("scoping").find((s) => s.id === "characteristics")?.blocks).toEqual(["evidence_map", "lit_matrix"]);
    expect(reportLayout("meta_analysis").find((s) => s.id === "results")?.blocks).toEqual(["findings", "forest", "meta"]);
    expect(reportLayout("slr").find((s) => s.id === "selection")?.blocks).toEqual(["prisma"]);
    expect(reportLayout("legacy").find((s) => s.id === "results")?.blocks).toEqual(["findings", "forest"]);
  });
  it("lists each block right after a group section that may hold it", () => {
    for (const t of [...REVIEW_TYPES, "legacy"] as const) {
      for (const s of reportLayout(t)) for (const b of s.blocks) expect(SECTION_BLOCKS[s.id], `${t} ${b}`).toContain(b);
    }
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
    expect(REVIEW_TYPE_LABEL.meta_analysis).toEqual({ th: "การวิเคราะห์อภิมาน", en: "Meta-analysis" });
    expect(reviewTypeOf({ review_type: "meta_analysis" })).toBe("meta_analysis");
    expect(isGraded("meta_analysis")).toBe(true);
    const meta = SECTIONS_BY_TYPE.meta_analysis;
    for (const id of SECTIONS_BY_TYPE.slr) expect(meta).toContain(id);
    expect(meta.indexOf("meta")).toBe(meta.indexOf("forest") + 1);
    expect(meta).toContain("citations");
    for (const t of ["narrative", "slr", "scoping", "legacy"] as const) expect(SECTIONS_BY_TYPE[t]).not.toContain("meta");
  });
  it("names one anchor per top-level section, shared by the report and its e2e checks (Task 9)", () => {
    for (const t of ["narrative", "slr", "scoping", "meta_analysis", "legacy"] as const) {
      for (const { id } of reportLayout(t)) if (id !== "title") expect(SECTION_ANCHOR[id], `${t} ${id}`).toMatch(/^h-[a-z-]+$/);
    }
    expect(SECTION_ANCHOR.bottom_line).toBe("h-answer");
    expect(SECTION_ANCHOR.references).toBe("h-papers");
    expect(new Set(Object.values(SECTION_ANCHOR)).size).toBe(Object.keys(SECTION_ANCHOR).length);
  });
});
