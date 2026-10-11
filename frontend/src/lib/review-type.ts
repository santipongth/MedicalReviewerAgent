// Review types (Plan 14a): labels, grading and which report sections each type shows. Pure data, no React.
import { isNonQuantitative } from "./charts-data";
import type { ReviewResult, ReviewType } from "./types";

export const REVIEW_TYPES: ReviewType[] = ["narrative", "slr", "scoping", "meta_analysis"];
export const DEFAULT_REVIEW_TYPE: ReviewType = "slr";

/** A result without `review_type` (stored before Plan 14a) behaves as today's SLR report. */
export type ReviewTypeOrLegacy = ReviewType | "legacy";

export const REVIEW_TYPE_LABEL: Record<ReviewType, { th: string; en: string }> = {
  narrative: { th: "การทบทวนแบบบรรยาย", en: "Narrative review" },
  slr: { th: "การทบทวนวรรณกรรมอย่างเป็นระบบ", en: "Systematic review" },
  scoping: { th: "การทบทวนขอบเขต", en: "Scoping review" },
  meta_analysis: { th: "การวิเคราะห์อภิมาน", en: "Meta-analysis" },
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

/** Top-level report sections (Plan 20 answer-first order). Each gets one H2 and one table-of-contents entry. */
export type TopSectionId =
  | "title" | "bottom_line" | "key_findings" | "sof" | "selection" | "characteristics" | "results" | "rob"
  | "consistency" | "landscape" | "limitations" | "gaps" | "discussion" | "methods" | "references" | "downloads"
  | "appendix";

/** Content blocks (Plan 10–14b sections) drawn inside a group section, under their own H3. */
export type BlockId =
  | "claims" | "findings" | "evidence_map" | "lit_matrix" | "concept_map" | "forest" | "prisma" | "meta" | "citations";

export type SectionId = TopSectionId | BlockId;

/** The H2 anchor of each top-level section: the table of contents links here (report.tsx) and e2e checks the order. */
export const SECTION_ANCHOR: Record<Exclude<TopSectionId, "title">, string> = {
  bottom_line: "h-answer", key_findings: "h-key-findings", sof: "h-sof", selection: "h-selection",
  characteristics: "h-characteristics", results: "h-results", rob: "h-rob", consistency: "h-claims", landscape: "h-landscape",
  limitations: "h-limitations", gaps: "h-gaps", discussion: "h-discussion", methods: "h-method", references: "h-papers",
  downloads: "h-downloads", appendix: "h-appendix",
};

/** Which blocks each group section may hold (a block is listed in SECTIONS_BY_TYPE right after its group). */
export const SECTION_BLOCKS: Partial<Record<TopSectionId, readonly BlockId[]>> = {
  selection: ["prisma"],
  characteristics: ["evidence_map", "lit_matrix"],
  results: ["findings", "forest", "meta"],
  consistency: ["claims"],
  landscape: ["concept_map", "citations"],
};

/**
 * Report sections per type, in display order (Plan 20: answer first, methods and references last). A group section
 * (selection, characteristics, results, consistency, landscape) is followed by the blocks it holds; report.tsx renders
 * and builds its table of contents from this list, and a section with nothing to show is left out.
 * "rob" is the risk-of-bias summary (Plan 20 Task 4; never for scoping, which appraises nothing); "citations" (Plan 14b) shows only when
 * result.citations is present; "sof" (summary of findings) is for the graded types that pool or grade per outcome.
 * "appendix" (Plan 20 Task 8) closes every report: each verified number with its source sentence, and the computed
 * (pooled) numbers apart.
 */
export const SECTIONS_BY_TYPE: Record<ReviewTypeOrLegacy, SectionId[]> = {
  narrative: ["title", "bottom_line", "key_findings", "characteristics", "lit_matrix", "results", "findings", "forest",
    "rob", "consistency", "claims", "landscape", "concept_map", "citations", "limitations", "gaps", "discussion",
    "methods", "references", "downloads", "appendix"],
  slr: ["title", "bottom_line", "key_findings", "sof", "selection", "prisma", "characteristics", "lit_matrix",
    "results", "findings", "forest", "rob", "consistency", "claims", "landscape", "concept_map", "citations",
    "limitations", "gaps", "discussion", "methods", "references", "downloads", "appendix"],
  // Scoping maps what exists: the evidence map is a study characteristic, and there are no results by outcome.
  scoping: ["title", "bottom_line", "key_findings", "selection", "prisma", "characteristics", "evidence_map",
    "lit_matrix", "landscape", "concept_map", "citations", "limitations", "gaps", "discussion", "methods",
    "references", "downloads", "appendix"],
  // An SLR plus the pooled analysis, after the per-study findings and forest plot in the results.
  meta_analysis: ["title", "bottom_line", "key_findings", "sof", "selection", "prisma", "characteristics",
    "lit_matrix", "results", "findings", "forest", "meta", "rob", "consistency", "claims", "landscape",
    "concept_map", "citations", "limitations", "gaps", "discussion", "methods", "references", "downloads", "appendix"],
  // Results stored before Plan 14a: the same blocks as before (claims, findings, forest, prisma), in the new order.
  legacy: ["title", "bottom_line", "key_findings", "selection", "prisma", "results", "findings", "forest", "rob",
    "consistency", "claims", "limitations", "gaps", "discussion", "methods", "references", "downloads", "appendix"],
};

export function showsSection(type: ReviewTypeOrLegacy, id: SectionId): boolean {
  return SECTIONS_BY_TYPE[type].includes(id);
}

export function isBlock(id: SectionId): id is BlockId {
  return Object.values(SECTION_BLOCKS).some((blocks) => blocks.includes(id as BlockId));
}

/** SECTIONS_BY_TYPE as top-level sections, each with the blocks listed after it. */
export function reportLayout(type: ReviewTypeOrLegacy): { id: TopSectionId; blocks: BlockId[] }[] {
  const out: { id: TopSectionId; blocks: BlockId[] }[] = [];
  for (const id of SECTIONS_BY_TYPE[type]) {
    if (isBlock(id)) out.at(-1)?.blocks.push(id);
    else out.push({ id, blocks: [] });
  }
  return out;
}

/** Scoping reviews map what exists and never tally or draw a direction of effect. */
export function showsDirection(type: ReviewTypeOrLegacy): boolean {
  return type !== "scoping";
}

/** Whether one paper shows a direction (glyph, label, tally): never in scoping, never for a qualitative or
 * mixed-methods card (themes, not effects). Every per-paper direction in the UI goes through this gate. */
export function showsCardDirection(type: ReviewTypeOrLegacy, card: { design_category?: string | null } | null | undefined): boolean {
  return showsDirection(type) && !isNonQuantitative(card);
}

type PoolInput = Pick<ReviewResult, "review_type" | "meta_analysis" | "papers"> | null | undefined;

/**
 * A meta-analysis with papers but no pooled estimate, and why: "none" = the step ran and no outcome qualified
 * (`pools: []`); "failed" = the step did not complete (`meta_analysis` null or absent). Null otherwise.
 */
export function metaPoolGap(result: PoolInput): "none" | "failed" | null {
  if (reviewTypeOf(result) !== "meta_analysis" || !result?.papers?.length) return null;
  if (result.meta_analysis == null) return "failed";
  return result.meta_analysis.pools?.length ? null : "none";
}

/** The pooling step ran and pooled nothing (never true when the step failed: that is `metaPoolGap(...) === "failed"`). */
export function isMetaNotPooled(result: PoolInput): boolean {
  return metaPoolGap(result) === "none";
}

/** Scoping does no quality appraisal, so no risk-of-bias label or filter is shown. */
export function showsRiskOfBias(type: ReviewTypeOrLegacy): boolean {
  return type !== "scoping";
}
