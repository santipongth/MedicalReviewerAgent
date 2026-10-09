// Review types (Plan 14a): labels, grading and which report sections each type shows. Pure data, no React.
import type { ReviewResult, ReviewType } from "./types";

export const REVIEW_TYPES: ReviewType[] = ["narrative", "slr", "scoping"];
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
};

export function isReviewType(v: unknown): v is ReviewType {
  return typeof v === "string" && (REVIEW_TYPES as string[]).includes(v);
}

export function reviewTypeOf(result: Pick<ReviewResult, "review_type"> | null | undefined): ReviewTypeOrLegacy {
  const t = result?.review_type;
  return isReviewType(t) ? t : "legacy";
}

/** Only SLR (and legacy results, which are SLR-shaped) grade the certainty of evidence. */
export function isGraded(type: ReviewTypeOrLegacy): boolean {
  return type === "slr" || type === "legacy";
}

export type SectionId =
  | "summary" | "claims" | "findings" | "evidence_map" | "lit_matrix" | "concept_map" | "forest" | "prisma";

/** Report sections per type, in display order (Task 6 consumes this). Legacy = today's report exactly. */
export const SECTIONS_BY_TYPE: Record<ReviewTypeOrLegacy, SectionId[]> = {
  narrative: ["summary", "claims", "findings", "lit_matrix", "concept_map", "forest"],
  slr: ["summary", "claims", "findings", "forest", "lit_matrix", "concept_map", "prisma"],
  scoping: ["summary", "evidence_map", "lit_matrix", "concept_map", "prisma"],
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
