// Review types (Plan 14a): labels, grading and which report sections each type shows. Pure data, no React.
import type { ReviewResult, ReviewType } from "./types";

export const REVIEW_TYPES: ReviewType[] = ["narrative", "slr", "scoping", "meta_analysis"];
export const DEFAULT_REVIEW_TYPE: ReviewType = "slr";

/** A result without `review_type` (stored before Plan 14a) behaves as today's SLR report. */
export type ReviewTypeOrLegacy = ReviewType | "legacy";

export const REVIEW_TYPE_LABEL: Record<ReviewType, { th: string; en: string; description: string }> = {
  narrative: {
    th: "การทบทวนแบบบรรยาย",
    en: "Narrative review",
    description: "สรุปภาพรวมความรู้จากงานวิจัยหลายชนิด รวมบทความทบทวน เหมาะกับการทำความเข้าใจหัวข้ออย่างรวดเร็ว ไม่ประเมินความแข็งแรงของหลักฐาน",
  },
  slr: {
    th: "การทบทวนวรรณกรรมอย่างเป็นระบบ",
    en: "Systematic review",
    description: "ค้นและคัดกรองตามเกณฑ์ที่ชัดเจน รายงานขั้นตอนแบบ PRISMA และประเมินความแข็งแรงของหลักฐาน (ค่าเริ่มต้น)",
  },
  scoping: {
    th: "การทบทวนขอบเขต",
    en: "Scoping review",
    description: "สำรวจว่ามีงานวิจัยอะไร ชนิดใด ปีใด ด้วยกรอบ PCC ไม่ประเมินคุณภาพหรือสรุปว่าได้ผลหรือไม่",
  },
  meta_analysis: {
    th: "การวิเคราะห์อภิมาน",
    en: "Meta-analysis",
    description: "รวมผลเชิงตัวเลขจากงานวิจัยหลักที่วัดผลแบบเดียวกัน (ตั้งแต่ 3 ฉบับ) ด้วยวิธี random effects ตัวเลขรวมคำนวณโดยระบบ ไม่ใช่ผลจากงานใดงานหนึ่ง",
  },
};

export function isReviewType(v: unknown): v is ReviewType {
  return typeof v === "string" && (REVIEW_TYPES as string[]).includes(v);
}

export function reviewTypeOf(result: Pick<ReviewResult, "review_type"> | null | undefined): ReviewTypeOrLegacy {
  const t = result?.review_type;
  return isReviewType(t) ? t : "legacy";
}

/** SLR, meta-analysis (an SLR plus pooling) and legacy results (SLR-shaped) grade the certainty of evidence. */
export function isGraded(type: ReviewTypeOrLegacy): boolean {
  return type === "slr" || type === "meta_analysis" || type === "legacy";
}

export type SectionId =
  | "summary" | "claims" | "findings" | "evidence_map" | "lit_matrix" | "concept_map" | "forest" | "prisma" | "meta"
  | "citations";

/** Report sections per type, in display order; report.tsx renders and numbers its nav from this list (forest and
 * prisma are drawn together by Charts, at the position of whichever comes first). Legacy = today's report exactly. */
export const SECTIONS_BY_TYPE: Record<ReviewTypeOrLegacy, SectionId[]> = {
  // "citations" (Plan 14b) is the citation network; it shows only when result.citations is present.
  narrative: ["summary", "claims", "findings", "lit_matrix", "concept_map", "citations", "forest"],
  slr: ["summary", "claims", "findings", "forest", "prisma", "lit_matrix", "concept_map", "citations"],
  scoping: ["summary", "evidence_map", "lit_matrix", "concept_map", "citations", "prisma"],
  // An SLR plus the pooled analysis, right after the per-study findings and forest plot (Charts holds forest + prisma,
  // so the pooled section follows that block).
  meta_analysis: ["summary", "claims", "findings", "forest", "meta", "prisma", "lit_matrix", "concept_map", "citations"],
  // The study map renders with forest/prisma exactly as it does today (charts.tsx).
  legacy: ["summary", "claims", "findings", "forest", "prisma"],
};

export function showsSection(type: ReviewTypeOrLegacy, id: SectionId): boolean {
  return SECTIONS_BY_TYPE[type].includes(id);
}

/** Scoping reviews map what exists and never tally or draw a direction of effect. */
export function showsDirection(type: ReviewTypeOrLegacy): boolean {
  return type !== "scoping";
}

/** Scoping does no quality appraisal, so no risk-of-bias label or filter is shown. */
export function showsRiskOfBias(type: ReviewTypeOrLegacy): boolean {
  return type !== "scoping";
}
